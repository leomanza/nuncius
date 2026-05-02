"use strict";
/// AXL HTTP API client.
///
/// AXL surface verified against gensyn-ai/axl@9cba555 and Phase B of Session 1:
///   GET  /topology               → { our_public_key, peers, ... }
///   POST /send                   → header X-Destination-Peer-Id, raw body, 200 OK
///   GET  /recv                   → 200 + raw body + X-From-Peer-Id, or 204 if empty
///
/// IMPORTANT: there is no /publish, /subscribe, /receive (with `s`), or GossipSub.
/// The skill file's `axl-client.ts` is fabricated — see SESSION_0_REVIEW.md B3.
/// Broadcast = coordinator-side fan-out: iterate peers, send to each.
Object.defineProperty(exports, "__esModule", { value: true });
exports.startReceiveLoop = exports.tryReceive = exports.fanout = exports.sendDirect = exports.getTopology = exports.createAXLClient = void 0;
async function createAXLClient(apiUrl) {
    const top = await getTopology(apiUrl);
    return { apiUrl, ourPeerId: top.our_public_key };
}
exports.createAXLClient = createAXLClient;
async function getTopology(apiUrl) {
    const res = await fetch(`${apiUrl}/topology`);
    if (!res.ok)
        throw new Error(`AXL ${apiUrl}/topology failed: ${res.status}`);
    return (await res.json());
}
exports.getTopology = getTopology;
/// Send a JSON-serializable object to a specific peer. Returns when the
/// transport accepts the bytes — does NOT confirm receipt.
async function sendDirect(client, peerId, payload) {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const res = await fetch(`${client.apiUrl}/send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/octet-stream",
            "X-Destination-Peer-Id": peerId,
        },
        body,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`AXL send → ${peerId.slice(0, 12)}… failed: ${res.status} ${text}`);
    }
}
exports.sendDirect = sendDirect;
/// Coordinator-side fan-out helper. Failures are logged but not rethrown so a
/// single offline peer does not break the whole broadcast.
///
/// `skipSelf` defaults to false because in the MVP the coordinator and agent-1
/// share AXL node-1, so sending to ourselves *is* sending to agent-1. Set it
/// true once the coordinator runs on its own dedicated AXL node.
async function fanout(client, peerIds, payload, opts = {}) {
    let ok = 0, failed = 0;
    await Promise.all(peerIds.map(async (pid) => {
        if (opts.skipSelf && pid === client.ourPeerId)
            return;
        try {
            await sendDirect(client, pid, payload);
            ok += 1;
        }
        catch (err) {
            console.error("[axl] fanout failed for", pid.slice(0, 12) + "…", String(err));
            failed += 1;
        }
    }));
    return { ok, failed };
}
exports.fanout = fanout;
/// Single non-blocking poll. Returns null when no message available.
async function tryReceive(client) {
    const res = await fetch(`${client.apiUrl}/recv`);
    if (res.status === 204)
        return null;
    if (!res.ok)
        throw new Error(`AXL recv failed: ${res.status}`);
    const fromPeerIdPrefix = res.headers.get("x-from-peer-id") || "";
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch (err) {
        throw new Error(`AXL recv: payload not JSON (${buf.byteLength} bytes): ${err}`);
    }
    return { fromPeerIdPrefix, payload, rawBytes: buf.byteLength };
}
exports.tryReceive = tryReceive;
/// Long-running poll loop. Calls `onMessage` for each delivered envelope.
/// Returns a stop function.
function startReceiveLoop(client, onMessage, opts = {}) {
    let stopped = false;
    const interval = opts.intervalMs ?? 250;
    (async () => {
        while (!stopped) {
            try {
                const msg = await tryReceive(client);
                if (msg) {
                    // Don't await — keep polling regardless of handler latency.
                    Promise.resolve(onMessage(msg)).catch((e) => opts.onError?.(e));
                    continue; // pull next message immediately
                }
            }
            catch (e) {
                opts.onError?.(e);
            }
            await sleep(interval);
        }
    })();
    return () => { stopped = true; };
}
exports.startReceiveLoop = startReceiveLoop;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
