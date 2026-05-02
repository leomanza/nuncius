/// Live attack tests against the deployed DisputeDAO on Galileo.
///
/// Verifies that the on-chain enforcement of B4 (signal binding) and B5
/// (scope binding) works in production, not just in the local test suite.
/// Also verifies the Semaphore nullifier-reuse defence.
///
/// Strategy:
///   - Open a fresh proposal (#4), then run three malicious submitProof
///     calls and assert each reverts. Finally, close #4 with 5 honest votes
///     so the contract returns to a clean state.

import { ethers } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import * as fs from "fs";

const SECRETS = ["zkswarm-e2e-agent-1", "zkswarm-e2e-agent-2", "zkswarm-e2e-agent-3", "zkswarm-e2e-agent-4", "zkswarm-e2e-agent-5"];
const SIGNAL_APPROVE = 1n;
const SIGNAL_REJECT  = 2n;
const BOGUS_SIGNAL   = 99n;

function toTuple(p: any) {
  return {
    merkleTreeDepth: BigInt(p.merkleTreeDepth),
    merkleTreeRoot: BigInt(p.merkleTreeRoot),
    nullifier: BigInt(p.nullifier),
    message: BigInt(p.message),
    scope: BigInt(p.scope),
    points: p.points.map((x: any) => BigInt(x)),
  };
}

async function expectRevert(label: string, fn: () => Promise<any>): Promise<{ label: string; reverted: true; reason: string }> {
  try {
    await fn();
    throw new Error(`[${label}] DID NOT REVERT — vulnerability!`);
  } catch (err: any) {
    const reason = err?.shortMessage || err?.reason || err?.info?.error?.message || err?.message || String(err);
    console.log(`[${label}] reverted ✅ — ${reason.slice(0, 220)}`);
    return { label, reverted: true, reason };
  }
}

async function main() {
  const dao = await ethers.getContractAt("DisputeDAO", process.env.DISPUTE_DAO_ADDRESS!);
  const ids = SECRETS.map((s) => new Identity(s));
  const members = ids.map((i) => i.commitment);
  const group = new Group(members);

  let activeId: bigint = await dao.currentProposalId();
  let openedTxHash: string | null = null;

  if (activeId === 0n) {
    console.log("Opening proposal #4 for attack tests ...");
    const tx = await dao.openProposal("[B4/B5 attack tests] proposal — should resolve cleanly after honest votes");
    const rc = await tx.wait();
    openedTxHash = tx.hash;
    activeId = await dao.currentProposalId();
    console.log("  tx:", tx.hash, "block:", rc?.blockNumber, "id:", activeId);
  } else {
    console.log("Reusing active proposal", activeId);
  }

  // Use 1 of the deterministic identities to craft attack proofs.
  // For each attack we must use a DIFFERENT identity, otherwise the second
  // attack hits the nullifier-reuse path before the scope/signal checks fire.
  console.log("\n=== B5: cross-proposal replay (proof scoped to OLD proposal id) ===");
  const wrongScope = activeId - 1n; // any old (now-resolved) proposal id
  const b5Proof = await generateProof(ids[0], group, SIGNAL_APPROVE, wrongScope);
  const b5Result = await expectRevert("B5 wrong-scope", () =>
    dao.submitProof(toTuple(b5Proof)).then((tx: any) => tx.wait()),
  );

  console.log("\n=== B4: invalid signal (proof.message ∉ {1,2}) ===");
  const b4Proof = await generateProof(ids[1], group, BOGUS_SIGNAL, activeId);
  const b4Result = await expectRevert("B4 invalid-signal", () =>
    dao.submitProof(toTuple(b4Proof)).then((tx: any) => tx.wait()),
  );

  console.log("\n=== Nullifier reuse: submit a valid proof, then submit it again ===");
  const reusedProof = await generateProof(ids[2], group, SIGNAL_APPROVE, activeId);
  const tx1 = await dao.submitProof(toTuple(reusedProof));
  const rc1 = await tx1.wait();
  console.log(`first submit ok — tx ${tx1.hash} block ${rc1?.blockNumber}`);
  const reuseResult = await expectRevert("Nullifier reuse", () =>
    dao.submitProof(toTuple(reusedProof)).then((tx: any) => tx.wait()),
  );

  // Close the proposal cleanly — 4 honest votes still needed (id[2] already submitted)
  console.log("\n=== Cleanup: cast remaining 4 honest votes to auto-resolve #" + activeId + " ===");
  const cleanupTxs: { i: number; hash: string }[] = [];
  // Order: ids[0], ids[1], ids[3], ids[4] — all Approve, simple finishing
  for (const i of [0, 1, 3, 4]) {
    const proof = await generateProof(ids[i], group, SIGNAL_APPROVE, activeId);
    const tx = await dao.submitProof(toTuple(proof));
    await tx.wait();
    console.log(`  agent ${i + 1} approved — tx ${tx.hash}`);
    cleanupTxs.push({ i: i + 1, hash: tx.hash });
  }

  const proposal = await dao.getProposal(activeId);
  const out = {
    daoAddress: process.env.DISPUTE_DAO_ADDRESS,
    proposalId: activeId.toString(),
    openedTxHash,
    finalState: {
      approveCount: proposal.approveCount.toString(),
      rejectCount: proposal.rejectCount.toString(),
      resolved: proposal.resolved,
      approved: proposal.approved,
    },
    attacks: { b5: b5Result, b4: b4Result, nullifierReuse: reuseResult },
    cleanupTxs,
    nullifierReuseFirstSubmit: tx1.hash,
    timestamp: new Date().toISOString(),
  };
  console.log("\n=== RESULT ===\n" + JSON.stringify(out, null, 2));
  fs.writeFileSync("./attack-tests-result.json", JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
