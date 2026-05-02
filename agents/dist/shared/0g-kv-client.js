"use strict";
/// 0G-KV client.
///
/// Resolves SESSION_0_REVIEW.md fix B8 by:
///   1. Pulling Galileo's Flow contract address from 0G testnet docs
///      (https://docs.0g.ai/developer-hub/testnet/testnet-overview):
///         Flow: 0x22E03a6A89B950F1c82ec5e74F8eCa321a105296
///   2. Constructing it via the SDK's getFlowContract(address, signer) util
///      and passing it explicitly to `new Batcher(...)`. The skill's
///      `null as any` workaround crashes at exec time.
///
/// Stream id derivation per SESSION_0_REVIEW.md fix W1:
///   keccak256(daoAddress || "agent" || agentIndex)[:32]
/// — salts the stream so two hackathon teams using the same agent index don't
/// stomp each other on a global namespace.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAgentState = exports.writeAgentState = exports.getStreamId = void 0;
const _0g_ts_sdk_1 = require("@0gfoundation/0g-ts-sdk");
const ethers_1 = require("ethers");
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = process.env.ZG_STORAGE_INDEXER || "https://indexer-storage-testnet-turbo.0g.ai";
const KV_RPC = process.env.ZG_KV_RPC || "http://3.101.147.150:6789";
const FLOW_ADDRESS = process.env.ZG_FLOW_ADDRESS || "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";
const STATE_KEY = "state";
function getStreamId(daoAddress, agentIndex) {
    if (!daoAddress)
        throw new Error("daoAddress required for stream id salting");
    const salted = ethers_1.ethers.keccak256(ethers_1.ethers.solidityPacked(["address", "string", "uint8"], [daoAddress, "agent", agentIndex]));
    return salted; // already 0x + 64 hex chars
}
exports.getStreamId = getStreamId;
let indexerSingleton = null;
let signerSingleton = null;
function getIndexer() {
    if (!indexerSingleton)
        indexerSingleton = new _0g_ts_sdk_1.Indexer(INDEXER_RPC);
    return indexerSingleton;
}
function getSigner() {
    if (!signerSingleton) {
        if (!process.env.PRIVATE_KEY)
            throw new Error("PRIVATE_KEY missing");
        const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        signerSingleton = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
    }
    return signerSingleton;
}
async function writeAgentState(daoAddress, agentIndex, state) {
    try {
        const indexer = getIndexer();
        const [nodes, err] = await indexer.selectNodes(1);
        if (err !== null)
            return { ok: false, error: `selectNodes: ${err}` };
        const flow = (0, _0g_ts_sdk_1.getFlowContract)(FLOW_ADDRESS, getSigner());
        const batcher = new _0g_ts_sdk_1.Batcher(1, nodes, flow, RPC_URL);
        const streamId = getStreamId(daoAddress, agentIndex);
        const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, "utf-8"));
        const valueBytes = Uint8Array.from(Buffer.from(JSON.stringify({ ...state, agentIndex, updatedAt: Date.now() }), "utf-8"));
        batcher.streamDataBuilder.set(streamId, keyBytes, valueBytes);
        const [tx, batchErr] = await batcher.exec();
        if (batchErr !== null)
            return { ok: false, error: `exec: ${batchErr}` };
        return { ok: true, tx: typeof tx === "string" ? tx : tx?.txHash || JSON.stringify(tx) };
    }
    catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}
exports.writeAgentState = writeAgentState;
async function readAgentState(daoAddress, agentIndex) {
    try {
        const kvClient = new _0g_ts_sdk_1.KvClient(KV_RPC);
        const streamId = getStreamId(daoAddress, agentIndex);
        const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, "utf-8"));
        // SDK type says Bytes = ArrayLike<number> but the docs example passes the
        // base64-encoded key as a string and the underlying RPC accepts that.
        const value = await kvClient.getValue(streamId, ethers_1.ethers.encodeBase64(keyBytes));
        if (!value)
            return null;
        // Value is base64 string per SDK
        const decoded = Buffer.from(value, "base64").toString("utf-8");
        return JSON.parse(decoded);
    }
    catch (err) {
        console.warn("[0g-kv] read failed for agent", agentIndex, String(err));
        return null;
    }
}
exports.readAgentState = readAgentState;
