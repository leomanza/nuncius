import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { ethers } from "ethers";

const PROOF_TIMEOUT_MS  = 90_000;
const MEMBERS_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

const DAO_ABI = [
  "function submitProof((uint256 merkleTreeDepth,uint256 merkleTreeRoot,uint256 nullifier,uint256 message,uint256 scope,uint256[8] points) proof)",
  "function currentProposalId() view returns (uint256)",
  "function groupId() view returns (uint256)",
  "event VoterAdded(uint256 indexed identityCommitment, uint256 memberIndex)",
  "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)",
  "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];

export const SIGNAL_APPROVE = 1n;
export const SIGNAL_REJECT = 2n;

export function createIdentity(secret: string): Identity {
  return new Identity(secret);
}

export function getCommitment(identity: Identity): bigint {
  return identity.commitment;
}

export function getBabyJubjubHex(identity: Identity): string {
  const pk = (identity as any).publicKey as [bigint, bigint] | undefined;
  if (!Array.isArray(pk) || pk.length !== 2) throw new Error("Identity.publicKey not [bigint,bigint]");
  return "0x" + pk[0].toString(16).padStart(64, "0") + pk[1].toString(16).padStart(64, "0");
}

/// Fetch the on-chain Semaphore group members for a DAO. Reads VoterAdded
/// events directly so the local Merkle root computed in `Group(commitments)`
/// matches what the contract stores.
export async function fetchGroupMembers(
  daoAddress: string,
  provider: ethers.Provider,
): Promise<bigint[]> {
  const dao = new ethers.Contract(daoAddress, DAO_ABI, provider);
  const filter = dao.filters.VoterAdded();
  const events = await withTimeout(
    dao.queryFilter(filter, 0, "latest"),
    MEMBERS_TIMEOUT_MS,
    "fetchGroupMembers",
  );
  // The VoterAdded event carries (identityCommitment, memberIndex). We sort
  // by memberIndex so the Merkle tree below matches the on-chain insertion order.
  type Row = { commitment: bigint; index: bigint; block: number };
  const rows: Row[] = events.map((e: any) => ({
    commitment: BigInt(e.args.identityCommitment),
    index: BigInt(e.args.memberIndex),
    block: e.blockNumber,
  }));
  rows.sort((a, b) => Number(a.index - b.index));
  return rows.map((r) => r.commitment);
}

export interface BuiltVoteProof {
  proof: SemaphoreProof;
  proofTuple: {
    merkleTreeDepth: bigint;
    merkleTreeRoot: bigint;
    nullifier: bigint;
    message: bigint;
    scope: bigint;
    points: bigint[];
  };
  generationMs: number;
  decision: "Approve" | "Reject";
}

export async function generateVoteProof(
  identity: Identity,
  groupMembers: bigint[],
  proposalId: bigint,
  decision: "Approve" | "Reject",
): Promise<BuiltVoteProof> {
  const group = new Group(groupMembers);
  const message = decision === "Approve" ? SIGNAL_APPROVE : SIGNAL_REJECT;
  const scope = proposalId;

  const t0 = Date.now();
  const proof = await withTimeout(
    generateProof(identity, group, message, scope),
    PROOF_TIMEOUT_MS,
    "generateProof",
  );
  const generationMs = Date.now() - t0;

  // Defensive: verify the proof off-chain before paying gas to submit it.
  // Avoids the failure mode where the local group differs from the on-chain
  // group (e.g. wrong member ordering) and the tx reverts wasting gas.
  const ok = await verifyProof(proof);
  if (!ok) throw new Error("local verifyProof failed — group mismatch or proof invalid");

  return {
    proof,
    proofTuple: {
      merkleTreeDepth: BigInt(proof.merkleTreeDepth),
      merkleTreeRoot: BigInt(proof.merkleTreeRoot),
      nullifier: BigInt(proof.nullifier),
      message: BigInt(proof.message),
      scope: BigInt(proof.scope),
      points: proof.points.map((p) => BigInt(p)),
    },
    generationMs,
    decision,
  };
}

/// Submit a generated proof on-chain. The signer is the AGENT wallet — NOT
/// the deployer — so the on-chain tx-graph cannot link the agent's known
/// address back to the anonymous vote.
///
/// Retries once on transient RPC errors. Known contract reverts that are
/// non-fatal (nullifier already used = already voted; proposal already
/// resolved = another agent closed it first) are surfaced as typed results
/// so callers can log them without treating them as failures.
export async function submitVoteOnChain(
  proofTuple: BuiltVoteProof["proofTuple"],
  daoAddress: string,
  signer: ethers.Wallet,
): Promise<{ txHash: string; blockNumber: number; gasUsed: string; alreadyVoted?: boolean; alreadyResolved?: boolean }> {
  const dao = new ethers.Contract(daoAddress, DAO_ABI, signer);

  const attempt = async () => {
    const tx = await dao.submitProof(proofTuple);
    const rc = await tx.wait();
    return { txHash: tx.hash, blockNumber: rc!.blockNumber, gasUsed: rc!.gasUsed.toString() };
  };

  try {
    return await attempt();
  } catch (err: any) {
    const msg: string = err?.shortMessage || err?.message || String(err);

    // Non-fatal contract reverts — treat as completed, not error.
    if (/NullifierAlreadyUsed|nullifier.*used/i.test(msg)) {
      console.warn("[semaphore] nullifier already used — agent already voted this proposal");
      return { txHash: "", blockNumber: 0, gasUsed: "0", alreadyVoted: true };
    }
    if (/AlreadyResolved|already.*resolved/i.test(msg)) {
      console.warn("[semaphore] proposal already resolved — another agent closed quorum first");
      return { txHash: "", blockNumber: 0, gasUsed: "0", alreadyResolved: true };
    }

    // Transient RPC error — retry once after a short pause.
    if (/network|timeout|ECONNRESET|502|503|ETIMEDOUT/i.test(msg)) {
      console.warn("[semaphore] transient RPC error, retrying in 3s:", msg);
      await new Promise((r) => setTimeout(r, 3000));
      return await attempt();
    }

    throw err;
  }
}
