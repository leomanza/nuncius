# SKILL: Semaphore V4 — Anonymous ZK Voting
## Session 4 — Anonymous Proof Generation + On-Chain Verification

Read `SKILL_contracts.md` first. `DisputeDAO.sol` must be deployed before this session.

---

## What Semaphore Does in Nuncius

Each voter agent has a Semaphore identity (an EdDSA keypair on Baby Jubjub). The identity commitment (a hash of the public key) is registered in the on-chain Semaphore group. When an agent votes, it generates a Groth16 ZK proof that proves:

1. **Membership**: "I hold a private key whose commitment is in the group" — without revealing which commitment
2. **Non-duplication**: "I have not voted on this proposal before" — via a deterministic nullifier `Poseidon(proposalId, secret)` that is unique per proposal but unlinkable across proposals
3. **Signal binding**: "I am committing to signal = 1 (Approve) or signal = 2 (Reject)"

On-chain, `semaphore.validateProof(groupId, proof)` verifies the proof and reverts on invalid proofs or reused nullifiers. The contract sees: a valid anonymous vote arrived. It does not see: which agent voted.

---

## Identity Generation

### `agents/shared/semaphore-utils.ts`

```typescript
import { Identity } from "@semaphore-protocol/core";
import { Group } from "@semaphore-protocol/core";
import { generateProof, SemaphoreProof } from "@semaphore-protocol/core";
import { ethers } from "ethers";

// ═══════════════════════════════════════════════════════════
// Identity Management
// ═══════════════════════════════════════════════════════════

/// Create a Semaphore identity from a secret string.
/// The secret should be stored in .env — it's not the wallet private key.
/// It's the agent's "soul" — losing it means losing the ability to vote.
export function createIdentity(secret: string): Identity {
  return new Identity(secret);
}

/// Get the identity commitment (what goes on-chain in the Semaphore group)
export function getCommitment(identity: Identity): bigint {
  return identity.commitment;
}

// ═══════════════════════════════════════════════════════════
// Proof Generation
// ═══════════════════════════════════════════════════════════

export interface VoteProof {
  semaphoreProof: SemaphoreProof;
  signal: bigint;
}

/// Generate an anonymous Semaphore proof for a vote.
///
/// @param identity - The agent's Semaphore identity
/// @param groupMembers - Array of all group member commitments (fetch from contract events)
/// @param proposalId - The proposal being voted on (used as scope for nullifier)
/// @param vote - 1n = Approve, 2n = Reject
/// @returns A proof ready to submit to DisputeDAO.submitProof()
export async function generateVoteProof(
  identity: Identity,
  groupMembers: bigint[],
  proposalId: bigint,
  vote: 1n | 2n
): Promise<VoteProof> {
  // Build the Merkle group from all member commitments
  const group = new Group(groupMembers);

  // The signal is the vote (1 = Approve, 2 = Reject)
  const signal = vote;

  // The scope is the proposalId — this makes nullifiers unique per proposal
  // but an agent can vote on proposal #2 even after voting on proposal #1
  const scope = proposalId;

  console.log(`Generating Semaphore proof for proposal ${proposalId}, vote ${vote === 1n ? 'Approve' : 'Reject'}...`);
  const start = Date.now();

  // This runs Groth16 proof generation in WASM — takes 1–3 seconds
  const proof = await generateProof(identity, group, signal, scope);

  console.log(`Proof generated in ${Date.now() - start}ms`);

  return { semaphoreProof: proof, signal };
}

// ═══════════════════════════════════════════════════════════
// On-Chain Submission
// ═══════════════════════════════════════════════════════════

/// Submit the anonymous vote proof to the DisputeDAO contract.
/// The contract verifies the proof and tallies the vote.
/// No one can link this transaction to the agent's identity.
export async function submitVoteOnChain(
  voteProof: VoteProof,
  daoContractAddress: string,
  signer: ethers.Signer
): Promise<string> {
  const daoAbi = [
    "function submitProof((uint256 merkleTreeDepth, uint256 merkleTreeRoot, uint256 nullifier, uint256 message, uint256 scope, uint256[8] points) proof, uint256 signal) external",
    "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)"
  ];

  const dao = new ethers.Contract(daoContractAddress, daoAbi, signer);

  // Format proof for the contract
  const { semaphoreProof, signal } = voteProof;

  const tx = await dao.submitProof(
    {
      merkleTreeDepth: semaphoreProof.merkleTreeDepth,
      merkleTreeRoot: semaphoreProof.merkleTreeRoot,
      nullifier: semaphoreProof.nullifier,
      message: semaphoreProof.message,
      scope: semaphoreProof.scope,
      points: semaphoreProof.points,
    },
    signal
  );

  const receipt = await tx.wait();
  console.log(`Vote submitted on-chain. Tx: ${tx.hash}`);

  return tx.hash;
}

// ═══════════════════════════════════════════════════════════
// Group Member Fetching
// ═══════════════════════════════════════════════════════════

/// Fetch all group member commitments from contract events.
/// We need all member commitments to build the Merkle tree for proof generation.
export async function fetchGroupMembers(
  daoContractAddress: string,
  provider: ethers.Provider
): Promise<bigint[]> {
  const daoAbi = [
    "event VoterAdded(uint256 indexed identityCommitment)"
  ];

  const dao = new ethers.Contract(daoContractAddress, daoAbi, provider);

  const filter = dao.filters.VoterAdded();
  const events = await dao.queryFilter(filter, 0, "latest");

  const commitments = events.map((e: any) => e.args.identityCommitment as bigint);
  console.log(`Fetched ${commitments.length} group member commitments`);

  return commitments;
}
```

---

## Agent Semaphore Secrets Generation

### `scripts/generate-semaphore-secrets.ts`

```typescript
import { Identity } from "@semaphore-protocol/core";
import * as crypto from "crypto";
import * as fs from "fs";

async function main() {
  console.log("Generating 5 Semaphore identities...\n");

  const entries: string[] = [];

  for (let i = 1; i <= 5; i++) {
    // Generate a cryptographically random 32-byte secret
    const secret = "0x" + crypto.randomBytes(32).toString("hex");
    const identity = new Identity(secret);
    const commitment = identity.commitment;

    console.log(`Agent ${i}:`);
    console.log(`  Secret: ${secret}`);
    console.log(`  Commitment: ${commitment}`);
    console.log(`  (Add commitment to contract via scripts/add-voters.ts)\n`);

    entries.push(`AGENT_${i}_SEMAPHORE_SECRET=${secret}`);
  }

  // Append to .env.secrets (gitignored file for sensitive values)
  fs.appendFileSync(".env.secrets", entries.join("\n") + "\n");
  console.log("Secrets appended to .env.secrets");
  console.log("Next: run scripts/add-voters.ts to register commitments on-chain");
}

main().catch(console.error);
```

---

## Integration in the Vote Flow

Here's how the full Semaphore flow integrates with the agent's vote execution:

```typescript
// agents/voter/src/vote.ts

import { createIdentity, generateVoteProof, submitVoteOnChain, fetchGroupMembers } from "../../shared/semaphore-utils";
import { ethers } from "ethers";

export async function castAnonymousVote(
  agentIndex: number,     // 1–5
  proposalId: number,
  decision: "Approve" | "Reject"
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);

  // Each agent has its own wallet for gas — but this wallet is NOT linked to the vote
  const signer = new ethers.Wallet(
    process.env[`AGENT_${agentIndex}_PRIVATE_KEY`]!,
    provider
  );

  // The Semaphore identity is separate from the wallet — this is the anonymous identity
  const secret = process.env[`AGENT_${agentIndex}_SEMAPHORE_SECRET`]!;
  const identity = createIdentity(secret);

  // Fetch current group members from chain
  const members = await fetchGroupMembers(
    process.env.DISPUTE_DAO_ADDRESS!,
    provider
  );

  // Generate the anonymous proof
  const signal: 1n | 2n = decision === "Approve" ? 1n : 2n;
  const voteProof = await generateVoteProof(
    identity,
    members,
    BigInt(proposalId),
    signal
  );

  // Submit on-chain — this transaction comes from the agent's wallet,
  // but the proof itself reveals nothing about which identity voted
  const txHash = await submitVoteOnChain(
    voteProof,
    process.env.DISPUTE_DAO_ADDRESS!,
    signer
  );

  return txHash;
}
```

---

## Timing Expectations

| Step | Time |
|---|---|
| `fetchGroupMembers` | ~1–2s (one RPC call) |
| `generateVoteProof` (Groth16 in WASM) | 1–4s on modern hardware |
| `submitVoteOnChain` (tx + confirmation) | 2–5s on Galileo |
| **Total per agent** | **~5–10s** |

For the demo video, 5 agents voting sequentially takes ~30–50 seconds. That's fine — it gives you visual drama as each proof appears in the proof feed on the dashboard.

---

## Common Issues

**"Cannot find module @semaphore-protocol/core"**
```bash
npm install @semaphore-protocol/core @semaphore-protocol/contracts
# If TypeScript errors: npm install --save-dev @types/node
```

**"Proof verification failed on-chain"**
- Most common cause: the group members array used for proof generation doesn't match what's on-chain
- Fix: always call `fetchGroupMembers` fresh before generating a proof
- Second cause: wrong scope (proposalId) — make sure you pass `BigInt(proposalId)` not `proposalId`

**"Nullifier already used"**
- An agent tried to vote twice on the same proposal — this is Semaphore working correctly
- In tests, use a fresh proposalId for each test run

**Semaphore verifier incompatible with 0G EVM**
- Try deploying just the `SemaphoreVerifier.sol` contract and calling `verifyProof()` directly
- If it still fails: run Semaphore on Base Sepolia, use a separate `submitProofExternal()` function on DisputeDAO that accepts a signed message from the Base Sepolia verifier result

---

## Session 4 Deliverables Checklist

- [ ] `scripts/generate-semaphore-secrets.ts` run, `.env.secrets` populated
- [ ] `scripts/add-voters.ts` run, 5 commitments added to contract group
- [ ] `agents/shared/semaphore-utils.ts` implemented
- [ ] Manual test: one agent generates proof + submits on-chain
- [ ] `ProofVerified` event visible in Galileo explorer
- [ ] Verified: same agent cannot vote twice (nullifier reuse reverts)
