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

import {
  Indexer,
  Batcher,
  KvClient,
  getFlowContract,
} from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = process.env.ZG_STORAGE_INDEXER || "https://indexer-storage-testnet-turbo.0g.ai";
const KV_RPC = process.env.ZG_KV_RPC || "http://3.101.147.150:6789";
const FLOW_ADDRESS = process.env.ZG_FLOW_ADDRESS || "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";

const STATE_KEY = "state";

export function getStreamId(daoAddress: string, agentIndex: number): string {
  if (!daoAddress) throw new Error("daoAddress required for stream id salting");
  const salted = ethers.keccak256(
    ethers.solidityPacked(["address", "string", "uint8"], [daoAddress, "agent", agentIndex]),
  );
  return salted; // already 0x + 64 hex chars
}

let indexerSingleton: Indexer | null = null;
let signerSingleton: ethers.Wallet | null = null;
function getIndexer() {
  if (!indexerSingleton) indexerSingleton = new Indexer(INDEXER_RPC);
  return indexerSingleton;
}
function getSigner() {
  if (!signerSingleton) {
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    signerSingleton = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  }
  return signerSingleton;
}

export interface AgentState {
  state: "idle" | "deliberating" | "voting" | "voted" | "error";
  proposalId?: number;
  description?: string;
  reasoning?: string;
  confidence?: number;
  decision?: "Approve" | "Reject";
  txHash?: string;
  source?: "0g-compute" | "ollama";
  startedAt?: number;
  updatedAt?: number;
  error?: string;
}

export async function writeAgentState(
  daoAddress: string,
  agentIndex: number,
  state: AgentState,
): Promise<{ ok: true; tx: string } | { ok: false; error: string }> {
  try {
    const indexer = getIndexer();
    const [nodes, err] = await indexer.selectNodes(1);
    if (err !== null) return { ok: false, error: `selectNodes: ${err}` };

    const flow = getFlowContract(FLOW_ADDRESS, getSigner());
    const batcher = new Batcher(1, nodes, flow, RPC_URL);
    const streamId = getStreamId(daoAddress, agentIndex);
    const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, "utf-8"));
    const valueBytes = Uint8Array.from(
      Buffer.from(JSON.stringify({ ...state, agentIndex, updatedAt: Date.now() }), "utf-8"),
    );

    batcher.streamDataBuilder.set(streamId, keyBytes, valueBytes);
    const [tx, batchErr] = await batcher.exec();
    if (batchErr !== null) return { ok: false, error: `exec: ${batchErr}` };

    return { ok: true, tx: typeof tx === "string" ? tx : (tx as any)?.txHash || JSON.stringify(tx) };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function readAgentState(
  daoAddress: string,
  agentIndex: number,
): Promise<AgentState | null> {
  try {
    const kvClient = new KvClient(KV_RPC);
    const streamId = getStreamId(daoAddress, agentIndex);
    const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, "utf-8"));
    // SDK type says Bytes = ArrayLike<number> but the docs example passes the
    // base64-encoded key as a string and the underlying RPC accepts that.
    const value = await kvClient.getValue(streamId, ethers.encodeBase64(keyBytes) as any);
    if (!value) return null;
    // Value is base64 string per SDK
    const decoded = Buffer.from(value as unknown as string, "base64").toString("utf-8");
    return JSON.parse(decoded) as AgentState;
  } catch (err) {
    console.warn("[0g-kv] read failed for agent", agentIndex, String(err));
    return null;
  }
}
