/// Local agent HTTP fetchers — each persona's voter process exposes:
///   GET /health             → { agent, axlApi, dao, ... }
///   GET /status             → { state, proposalId?, decision?, txHash? }
///   GET /last-deliberation  → { decision, reasoning, confidence, source, elapsedMs }
///   GET /last-vote          → { txHash, blockNumber, gasUsed, ... }
///
/// All requests are best-effort with a small timeout — agent offline is the
/// common dev case and should render as a dim star, not an exception screen.

import { PERSONAS } from "./personas";

export type AgentState =
  | "idle"
  | "deliberating"
  | "voting"
  | "voted"
  | "error";

export interface AgentStatus {
  agentIndex: number;
  state: AgentState;
  proposalId?: number;
  description?: string;
  decision?: "Approve" | "Reject";
  reasoning?: string;
  confidence?: number;
  txHash?: string;
  source?: "0g-compute" | "ollama";
  online: boolean;
  walletAddress?: string | null;
}

export interface AgentHealth {
  agent: string;
  displayName: string;
  ensSubname: string;
  walletAddress: string | null;
  httpPort: number;
  axlApi: string;
  dao: string;
  skipVote: boolean;
  timestamp: number;
}

export interface AgentDeliberation {
  decision: "Approve" | "Reject";
  reasoning: string;
  confidence: number;
  source: "0g-compute" | "ollama";
  elapsedMs: number;
  displayName?: string;
}

const TIMEOUT_MS = 1500;

function getAgentBase(agentIndex: number): string {
  const env = process.env[`NEXT_PUBLIC_AGENT_${agentIndex}_URL`];
  if (env) return env;
  const persona = PERSONAS.find((p) => p.agentIndex === agentIndex)!;
  return `http://localhost:${persona.port}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAgentStatus(agentIndex: number): Promise<AgentStatus> {
  const base = getAgentBase(agentIndex);
  const [status, health] = await Promise.all([
    fetchJson<Partial<AgentStatus & { state: AgentState }>>(`${base}/status`),
    fetchJson<AgentHealth>(`${base}/health`),
  ]);
  if (!status) {
    return { agentIndex, state: "idle", online: false, walletAddress: health?.walletAddress ?? null };
  }
  return {
    agentIndex,
    state: (status.state as AgentState) || "idle",
    proposalId: typeof status.proposalId === "number" ? status.proposalId : undefined,
    description: status.description,
    decision: status.decision,
    reasoning: status.reasoning,
    confidence: typeof status.confidence === "number" ? status.confidence : undefined,
    txHash: status.txHash,
    source: status.source,
    online: true,
    walletAddress: health?.walletAddress ?? null,
  };
}

export async function fetchAgentDeliberation(
  agentIndex: number,
): Promise<AgentDeliberation | null> {
  const base = getAgentBase(agentIndex);
  const d = await fetchJson<AgentDeliberation & { empty?: boolean }>(
    `${base}/last-deliberation`,
  );
  if (!d || (d as any).empty) return null;
  return d;
}

export async function fetchAllAgentStatuses(): Promise<AgentStatus[]> {
  const list = await Promise.all(
    PERSONAS.map((p) => fetchAgentStatus(p.agentIndex)),
  );
  return list;
}
