/// Read-only DisputeDAO contract handle on 0G Galileo.
///
/// Two access paths:
///   - JsonRpcProvider for view calls (poll-based, e.g. getCurrentProposal)
///   - WebSocket-style subscription is not used; we layer events on a polling
///     `queryFilter` walk so we don't need a websocket endpoint and so the
///     dashboard works against any vanilla Galileo RPC.

import { ethers } from "ethers";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc-testnet.0g.ai";
export const DAO_ADDRESS =
  process.env.NEXT_PUBLIC_DISPUTE_DAO_ADDRESS ||
  "0x650c074910bC5855f6573f9d62EE5b8bA90664D9";

export const DAO_ABI = [
  "function currentProposalId() view returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function memberCount() view returns (uint256)",
  "function groupId() view returns (uint256)",
  "function getCurrentProposal() view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
  "function getProposal(uint256 id) view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
  "event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)",
  "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)",
  "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];

export interface ProposalView {
  id: number;
  description: string;
  approveCount: number;
  rejectCount: number;
  resolved: boolean;
  approved: boolean;
  createdAt: number;
  resolvedAt: number;
}

export interface ProofVerifiedEvent {
  proposalId: number;
  signal: 1 | 2;
  nullifier: string; // hex
  txHash: string;
  blockNumber: number;
  timestamp: number; // ms
}

export interface ProposalOpenedEvent {
  proposalId: number;
  description: string;
  timestamp: number;
  txHash: string;
  blockNumber: number;
}

export interface ProposalResolvedEvent {
  proposalId: number;
  approved: boolean;
  approveCount: number;
  rejectCount: number;
  txHash: string;
  blockNumber: number;
}

let providerSingleton: ethers.JsonRpcProvider | null = null;
let contractSingleton: ethers.Contract | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!providerSingleton) {
    providerSingleton = new ethers.JsonRpcProvider(RPC_URL);
  }
  return providerSingleton;
}

export function getDao(): ethers.Contract {
  if (!contractSingleton) {
    contractSingleton = new ethers.Contract(DAO_ADDRESS, DAO_ABI, getProvider());
  }
  return contractSingleton;
}

export async function fetchCurrentProposal(): Promise<ProposalView | null> {
  try {
    const dao = getDao();
    const p = await dao.getCurrentProposal();
    const id = Number(p.id);
    if (id === 0) return null; // no active proposal
    return {
      id,
      description: p.description,
      approveCount: Number(p.approveCount),
      rejectCount: Number(p.rejectCount),
      resolved: Boolean(p.resolved),
      approved: Boolean(p.approved),
      createdAt: Number(p.createdAt),
      resolvedAt: Number(p.resolvedAt),
    };
  } catch {
    return null;
  }
}

export async function fetchLastProposalSnapshot(): Promise<ProposalView | null> {
  try {
    const dao = getDao();
    const count = Number(await dao.proposalCount());
    if (count === 0) return null;
    const p = await dao.getProposal(count);
    return {
      id: Number(p.id),
      description: p.description,
      approveCount: Number(p.approveCount),
      rejectCount: Number(p.rejectCount),
      resolved: Boolean(p.resolved),
      approved: Boolean(p.approved),
      createdAt: Number(p.createdAt),
      resolvedAt: Number(p.resolvedAt),
    };
  } catch {
    return null;
  }
}

/// Pull recent DAO events. Galileo block time is ~3 s so 200_000 blocks ≈
/// 7 days — plenty for the demo and within Galileo's eth_getLogs limit.
export async function fetchRecentEvents(lookbackBlocks = 200_000): Promise<{
  opened: ProposalOpenedEvent[];
  verified: ProofVerifiedEvent[];
  resolved: ProposalResolvedEvent[];
  head: number;
}> {
  const provider = getProvider();
  const dao = getDao();
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - lookbackBlocks);

  const [openedRaw, verifiedRaw, resolvedRaw] = await Promise.all([
    dao.queryFilter(dao.filters.ProposalOpened(), from, head),
    dao.queryFilter(dao.filters.ProofVerified(), from, head),
    dao.queryFilter(dao.filters.ProposalResolved(), from, head),
  ]);

  const opened: ProposalOpenedEvent[] = [];
  for (const e of openedRaw as ethers.EventLog[]) {
    opened.push({
      proposalId: Number(e.args.proposalId),
      description: String(e.args.description),
      timestamp: Number(e.args.timestamp),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
    });
  }
  const verified: ProofVerifiedEvent[] = [];
  for (const e of verifiedRaw as ethers.EventLog[]) {
    verified.push({
      proposalId: Number(e.args.proposalId),
      signal: Number(e.args.signal) as 1 | 2,
      nullifier: "0x" + (e.args.nullifier as bigint).toString(16),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
      timestamp: 0, // we use blockNumber as the relative time axis
    });
  }
  const resolved: ProposalResolvedEvent[] = [];
  for (const e of resolvedRaw as ethers.EventLog[]) {
    resolved.push({
      proposalId: Number(e.args.proposalId),
      approved: Boolean(e.args.approved),
      approveCount: Number(e.args.approveCount),
      rejectCount: Number(e.args.rejectCount),
      txHash: e.transactionHash,
      blockNumber: e.blockNumber,
    });
  }

  return { opened, verified, resolved, head };
}

export const EXPLORER_BASE = "https://chainscan-galileo.0g.ai";
