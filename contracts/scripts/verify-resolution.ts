import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS!;
  const dao = await ethers.getContractAt("DisputeDAO", daoAddress);

  const memberCount = await dao.memberCount();
  const proposalCount = await dao.proposalCount();
  const currentId = await dao.currentProposalId();
  console.log("memberCount      :", memberCount.toString());
  console.log("proposalCount    :", proposalCount.toString());
  console.log("currentProposalId:", currentId.toString());

  for (let i = 1n; i <= proposalCount; i++) {
    const p = await dao.getProposal(i);
    console.log(`\nproposal #${i}`);
    console.log("  description :", p.description);
    console.log("  approve     :", p.approveCount.toString());
    console.log("  reject      :", p.rejectCount.toString());
    console.log("  resolved    :", p.resolved);
    console.log("  approved    :", p.approved);
    console.log("  createdAt   :", new Date(Number(p.createdAt) * 1000).toISOString());
    console.log("  resolvedAt  :", p.resolvedAt > 0n ? new Date(Number(p.resolvedAt) * 1000).toISOString() : "—");
  }

  // Pull events for nicer reporting
  const startBlock = 30620000; // a few blocks before today's deploy
  const verifiedEvents = await dao.queryFilter(dao.filters.ProofVerified(), startBlock, "latest");
  const resolvedEvents = await dao.queryFilter(dao.filters.ProposalResolved(), startBlock, "latest");
  const openedEvents = await dao.queryFilter(dao.filters.ProposalOpened(), startBlock, "latest");

  const summary = {
    daoAddress,
    memberCount: memberCount.toString(),
    proposalCount: proposalCount.toString(),
    currentProposalId: currentId.toString(),
    proposals: await Promise.all(
      Array.from({ length: Number(proposalCount) }, (_, i) => i + 1).map(async (i) => {
        const p = await dao.getProposal(BigInt(i));
        return {
          id: p.id.toString(),
          description: p.description,
          approveCount: p.approveCount.toString(),
          rejectCount: p.rejectCount.toString(),
          resolved: p.resolved,
          approved: p.approved,
          createdAt: p.createdAt.toString(),
          resolvedAt: p.resolvedAt.toString(),
        };
      })
    ),
    proposalOpenedEvents: openedEvents.map((e) => ({
      tx: e.transactionHash, block: e.blockNumber,
      proposalId: e.args.proposalId.toString(),
      description: e.args.description,
    })),
    proofVerifiedEvents: verifiedEvents.map((e) => ({
      tx: e.transactionHash, block: e.blockNumber,
      proposalId: e.args.proposalId.toString(),
      signal: e.args.signal.toString(),
      nullifier: "0x" + e.args.nullifier.toString(16),
    })),
    proposalResolvedEvents: resolvedEvents.map((e) => ({
      tx: e.transactionHash, block: e.blockNumber,
      proposalId: e.args.proposalId.toString(),
      approved: e.args.approved,
      approveCount: e.args.approveCount.toString(),
      rejectCount: e.args.rejectCount.toString(),
    })),
    timestamp: new Date().toISOString(),
  };
  console.log("\n=== ON-CHAIN STATE ===");
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync("./e2e-result.json", JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
