"use strict";
/// 0G Compute client.
///
/// Validated against @0glabs/0g-serving-broker@0.7.5 in Session 1:
///   - Use broker.inference.listService()  (NOT listProviders)
///   - Use broker.inference.getServiceMetadata(provider).endpoint as the
///     base for chat-completions — provider's bare URL gives 404 on
///     /v1/chat/completions because the real path is `<endpoint>/chat/completions`
///     where endpoint already contains a `/v1/proxy` segment.
///   - Headers from getRequestHeaders are single-use; regenerate every call.
///   - Don't hard-code DeepSeek-R1-70B — pick from listService(); on Galileo
///     today the only chat model online is qwen/qwen-2.5-7b-instruct.
///   - Ollama fallback (llama3.2:3b) for offline / provider-down cases.
Object.defineProperty(exports, "__esModule", { value: true });
exports.callComputeInference = void 0;
const _0g_serving_broker_1 = require("@0glabs/0g-serving-broker");
const ethers_1 = require("ethers");
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const COMPUTE_TIMEOUT_MS = parseInt(process.env.COMPUTE_TIMEOUT_MS || "20000");
let cached = null;
let cacheInflight = null;
async function withTimeout(p, ms, tag) {
    return await Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms)),
    ]);
}
async function getBroker() {
    if (cached)
        return cached;
    if (cacheInflight)
        return cacheInflight;
    cacheInflight = (async () => {
        if (!process.env.PRIVATE_KEY)
            throw new Error("PRIVATE_KEY missing — cannot init compute broker");
        const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const broker = await (0, _0g_serving_broker_1.createZGComputeNetworkBroker)(wallet);
        // Idempotent: addLedger throws "already exists" on second call — fine.
        try {
            await broker.ledger.addLedger(3.0);
        }
        catch { /* already funded */ }
        const services = await broker.inference.listService();
        const preferredModel = process.env.ZG_COMPUTE_MODEL;
        const target = preferredModel
            ? services.find((s) => s.model === preferredModel) || services[0]
            : services.find((s) => /qwen|llama|deepseek/i.test(s.model || "")) || services[0];
        if (!target)
            throw new Error("0G compute: no providers online");
        try {
            await broker.inference.acknowledgeProviderSigner(target.provider);
        }
        catch { /* ack idempotent */ }
        const meta = await broker.inference.getServiceMetadata(target.provider);
        cached = { broker, provider: target, endpoint: meta.endpoint, model: meta.model };
        return cached;
    })();
    try {
        return await cacheInflight;
    }
    finally {
        cacheInflight = null;
    }
}
async function callComputeInference(system, user, opts = {}) {
    const t0 = Date.now();
    try {
        const { broker, provider, endpoint, model } = (await withTimeout(getBroker(), 15000, "broker init"));
        const prompt = `${system}\n\n${user}`;
        const headers = await broker.inference.getRequestHeaders(provider.provider, prompt);
        const url = endpoint.endsWith("/chat/completions") ? endpoint : `${endpoint.replace(/\/+$/, "")}/chat/completions`;
        const res = await withTimeout(fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                max_tokens: opts.maxTokens ?? 400,
                temperature: opts.temperature ?? 0,
            }),
        }), COMPUTE_TIMEOUT_MS, "0g compute fetch");
        if (!res.ok)
            throw new Error(`0G compute HTTP ${res.status}`);
        const chatID = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key") || undefined;
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        const finalChatID = chatID || data.id;
        const usage = data.usage ? JSON.stringify(data.usage) : undefined;
        // Fire-and-forget billing settle — don't block on it.
        broker.inference.processResponse(provider.provider, finalChatID, usage).catch(() => { });
        return { text, source: "0g-compute", provider: provider.provider, model, elapsedMs: Date.now() - t0 };
    }
    catch (err) {
        console.warn("[compute] 0G failed, falling back to Ollama:", String(err));
        const text = await callOllama(system, user, opts);
        return { text, source: "ollama", model: OLLAMA_MODEL, elapsedMs: Date.now() - t0 };
    }
}
exports.callComputeInference = callComputeInference;
async function callOllama(system, user, opts) {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            stream: false,
            options: { temperature: opts.temperature ?? 0, num_predict: opts.maxTokens ?? 400 },
        }),
    });
    if (!res.ok)
        throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content || "";
}
