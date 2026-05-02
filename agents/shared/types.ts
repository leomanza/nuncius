/// Message envelopes exchanged over AXL.
/// Every payload sent through `/send` is JSON.stringify(NunciusMessage).

export type MessageType =
  | "PROPOSAL_BROADCAST"
  | "DELIBERATION_UPDATE"
  | "VOTE_COMPLETE"
  | "RESOLUTION_EVENT";

export interface NunciusMessage {
  type: MessageType;
  from: string;       // e.g. "coordinator", "agent-3"
  proposalId: number;
  timestamp: number;
  payload: unknown;
}

export interface ProposalBroadcastPayload {
  proposalId: number;
  description: string;
  contractAddress: string;
  groupId: string;
  scope: string; // proposalId as decimal string — what proofs MUST commit to
}

export interface DeliberationUpdatePayload {
  from: string;
  proposalId: number;
  reasoning: string;   // intermediate thoughts shared with the swarm — NOT the vote
  confidence: number;  // 0..1
}

export interface VoteCompletePayload {
  from: string;        // agent identifier (NOT linked to the anonymous vote)
  proposalId: number;
  txHash: string;      // on-chain submitProof tx; recipients can audit but not link
}

export interface DeliberationResult {
  decision: "Approve" | "Reject";
  reasoning: string;
  confidence: number;
}
