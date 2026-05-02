import { AXLClient, InboundMessage, sendDirect } from "../../shared/axl-client";
import {
  NunciusMessage,
  ProposalBroadcastPayload,
  VoteCompletePayload,
} from "../../shared/types";
import { deliberate } from "./deliberate";
import { castAnonymousVote, CastResult } from "./vote";
import { writeAgentState, AgentState } from "../../shared/0g-kv-client";
import { getPersonaByIndex } from "../../shared/personas";

export type StatusUpdater = (s: AgentState) => void;

export function isProposalBroadcast(msg: NunciusMessage): msg is NunciusMessage & { payload: ProposalBroadcastPayload } {
  return msg && msg.type === "PROPOSAL_BROADCAST" && typeof msg.payload === "object" && msg.payload !== null;
}

export interface HandleProposalOpts {
  /// Coordinator's peer id, so we can echo VOTE_COMPLETE back on the same channel.
  coordinatorPeerId?: string;
  axl?: AXLClient;
  /// Skip the on-chain submit entirely (Session 3 mode); when false (default),
  /// run the full Session 4 pipeline: deliberate → generate proof → submit on-chain.
  skipVote?: boolean;
  onDeliberation?: (r: any) => void;
  onVote?: (r: CastResult) => void;
}

export async function handleProposal(
  agentIndex: number,
  msg: InboundMessage<NunciusMessage>,
  daoAddress: string,
  setStatus: StatusUpdater,
  opts: HandleProposalOpts = {},
): Promise<void> {
  const persona = getPersonaByIndex(agentIndex);
  const tag = persona.displayName;
  const env = msg.payload;
  if (!isProposalBroadcast(env)) {
    console.warn(`[${tag}] ignored non-proposal message: type=${env?.type}`);
    return;
  }
  const payload = env.payload as ProposalBroadcastPayload;
  const proposalId = payload.proposalId;
  console.log(`[${tag}] received proposal #${proposalId}: ${payload.description}`);

  // ── 1) Deliberate ─────────────────────────────────────────────────
  setStatus({
    state: "deliberating",
    proposalId,
    description: payload.description,
    startedAt: Date.now(),
  });
  void writeAgentState(daoAddress, agentIndex, {
    state: "deliberating",
    proposalId,
    description: payload.description,
    startedAt: Date.now(),
  }).catch((e) => console.warn(`[${tag}] kv write (deliberating) failed:`, String(e)));

  const deliberation = await deliberate(agentIndex, payload.description);
  console.log(`[${tag}] decision=${deliberation.decision} confidence=${deliberation.confidence.toFixed(2)} src=${deliberation.source} elapsed=${deliberation.elapsedMs}ms`);
  console.log(`[${tag}] reasoning: ${deliberation.reasoning}`);
  opts.onDeliberation?.(deliberation);

  void writeAgentState(daoAddress, agentIndex, {
    state: "voting",
    proposalId,
    reasoning: deliberation.reasoning,
    confidence: deliberation.confidence,
    decision: deliberation.decision,
    source: deliberation.source as any,
    updatedAt: Date.now(),
  }).catch((e) => console.warn(`[${tag}] kv write (voting) failed:`, String(e)));
  setStatus({
    state: "voting",
    proposalId,
    reasoning: deliberation.reasoning,
    confidence: deliberation.confidence,
    decision: deliberation.decision,
    source: deliberation.source as any,
    updatedAt: Date.now(),
  });

  if (opts.skipVote) {
    console.log(`[${tag}] skipVote=true — stopping after deliberation`);
    return;
  }

  // ── 2) Generate Semaphore proof + submit on-chain (Session 4) ─────
  let cast: CastResult;
  try {
    cast = await castAnonymousVote(agentIndex, proposalId, deliberation.decision, daoAddress);
    console.log(
      `[${tag}] PROOF SUBMITTED tx=${cast.txHash} block=${cast.blockNumber} ` +
      `proofGen=${cast.proofGenerationMs}ms total=${cast.totalElapsedMs}ms wallet=${cast.agentWalletAddress.slice(0, 10)}…`,
    );
    opts.onVote?.(cast);
  } catch (err: any) {
    const msg = err?.shortMessage || err?.message || String(err);
    console.error(`[${tag}] vote submission failed: ${msg}`);
    setStatus({ state: "error", proposalId, error: msg, updatedAt: Date.now() });
    void writeAgentState(daoAddress, agentIndex, {
      state: "error",
      proposalId,
      error: msg,
      updatedAt: Date.now(),
    }).catch((e) => console.warn(`[${tag}] kv write (error) failed:`, String(e)));
    return;
  }

  setStatus({
    state: "voted",
    proposalId,
    txHash: cast.txHash,
    decision: deliberation.decision,
    reasoning: deliberation.reasoning,
    confidence: deliberation.confidence,
    source: deliberation.source as any,
    updatedAt: Date.now(),
  });
  void writeAgentState(daoAddress, agentIndex, {
    state: "voted",
    proposalId,
    txHash: cast.txHash,
    decision: deliberation.decision,
    updatedAt: Date.now(),
  }).catch((e) => console.warn(`[${tag}] kv write (voted) failed:`, String(e)));

  // ── 3) Notify the coordinator over AXL (does NOT reveal the vote) ─
  if (opts.coordinatorPeerId && opts.axl) {
    const ack: NunciusMessage = {
      type: "VOTE_COMPLETE",
      from: `agent-${agentIndex}`,
      proposalId,
      timestamp: Date.now(),
      payload: <VoteCompletePayload>{
        from: `agent-${agentIndex}`,
        proposalId,
        txHash: cast.txHash,
      },
    };
    sendDirect(opts.axl, opts.coordinatorPeerId, ack).catch((e) =>
      console.warn(`[${tag}] VOTE_COMPLETE ack failed: ${e}`),
    );
  }
}
