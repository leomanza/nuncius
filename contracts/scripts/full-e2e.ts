import { ethers } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import * as fs from "fs";
import * as path from "path";

const SIGNAL_APPROVE = 1n;
const SIGNAL_REJECT = 2n;

/**
 * Full proposal lifecycle on the live DisputeDAO:
 *   1. Generate 5 deterministic Semaphore identities.
 *   2. addVoter for each (idempotent: skipped if memberCount already >= 5).
 *   3. openProposal (idempotent: reuse currentProposalId if non-zero).
 *   4. For each identity: build group, generate Groth16 proof, submitProof.
 *   5. Watch for ProposalResolved emitted by the auto-resolution path.
 *
 * Single deployer signs every tx — this is just a smoke test for the contract.
 * Session 3/4 will swap in 5 separate agent wallets.
 */
async function main() {
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
  if (!daoAddress) throw new Error("DISPUTE_DAO_ADDRESS missing in .env");
  const description = process.argv[2] ||
    "[E2E smoke] Fund 50k USDC audit for Protocol X";

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("DAO     :", daoAddress);

  const dao = await ethers.getContractAt("DisputeDAO", daoAddress);

  // ── 1) Identities ─────────────────────────────────────────────────
  const ids: Identity[] = [];
  for (let i = 1; i <= 5; i++) ids.push(new Identity(`zkswarm-e2e-agent-${i}`));
  console.log("\n[1/4] Identities:");
  ids.forEach((id, i) => console.log(`  agent ${i + 1} commitment: ${id.commitment.toString().slice(0, 24)}...`));

  // ── 2) Register voters (idempotent) ────────────────────────────────
  const memberCount = await dao.memberCount();
  console.log(`\n[2/4] Members already registered: ${memberCount}/${ids.length}`);
  if (memberCount === 0n) {
    console.log("       Adding 5 voters ...");
    for (let i = 0; i < 5; i++) {
      const tx = await dao.addVoter(ids[i].commitment);
      const rc = await tx.wait();
      console.log(`       voter ${i + 1} added — tx ${tx.hash} block ${rc?.blockNumber}`);
    }
  } else if (memberCount < BigInt(ids.length)) {
    throw new Error(`Group is partially populated (${memberCount} of 5). Refusing — fix manually.`);
  } else {
    console.log("       Group already populated. Reusing existing commitments must match — assuming a previous E2E run.");
  }

  // ── 3) Open or reuse proposal ─────────────────────────────────────
  let activeId = await dao.currentProposalId();
  console.log(`\n[3/4] Active proposal: ${activeId}`);
  if (activeId === 0n) {
    const tx = await dao.openProposal(description);
    const rc = await tx.wait();
    activeId = await dao.currentProposalId();
    console.log(`       Opened proposal #${activeId} — tx ${tx.hash} block ${rc?.blockNumber}`);
  } else {
    console.log("       Reusing existing active proposal");
  }

  // ── 4) Vote ───────────────────────────────────────────────────────
  console.log("\n[4/4] Generating + submitting 5 anonymous proofs ...");
  const group = new Group(ids.map((i) => i.commitment));
  const decisions = [SIGNAL_APPROVE, SIGNAL_APPROVE, SIGNAL_REJECT, SIGNAL_APPROVE, SIGNAL_REJECT];
  const txs: { i: number; hash: string; block: number; signal: bigint }[] = [];

  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const proof = await generateProof(ids[i], group, decisions[i], activeId);
    console.log(`       agent ${i + 1} (${decisions[i] === SIGNAL_APPROVE ? "Approve" : "Reject"}) proof in ${Date.now() - t0}ms`);

    const tuple = {
      merkleTreeDepth: BigInt(proof.merkleTreeDepth),
      merkleTreeRoot: BigInt(proof.merkleTreeRoot),
      nullifier: BigInt(proof.nullifier),
      message: BigInt(proof.message),
      scope: BigInt(proof.scope),
      points: proof.points.map((p) => BigInt(p)),
    };

    let tx;
    try {
      tx = await dao.submitProof(tuple as any);
    } catch (err: any) {
      console.error(`       submit failed for agent ${i + 1}: ${err?.shortMessage || err?.message || err}`);
      throw err;
    }
    const rc = await tx.wait();
    txs.push({ i: i + 1, hash: tx.hash, block: rc!.blockNumber, signal: decisions[i] });
    console.log(`       agent ${i + 1} submitted — tx ${tx.hash} block ${rc?.blockNumber}`);
  }

  // ── Outcome ───────────────────────────────────────────────────────
  const proposal = await dao.getProposal(activeId);
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({
    proposalId: activeId.toString(),
    description: proposal.description,
    approveCount: proposal.approveCount.toString(),
    rejectCount: proposal.rejectCount.toString(),
    resolved: proposal.resolved,
    approved: proposal.approved,
    txs,
  }, null, 2));

  fs.writeFileSync(path.join(__dirname, "..", "e2e-result.json"), JSON.stringify({
    proposalId: activeId.toString(),
    description: proposal.description,
    approveCount: proposal.approveCount.toString(),
    rejectCount: proposal.rejectCount.toString(),
    resolved: proposal.resolved,
    approved: proposal.approved,
    txs,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
