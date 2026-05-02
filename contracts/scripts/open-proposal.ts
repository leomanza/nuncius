import { ethers } from "hardhat";

async function main() {
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
  if (!daoAddress) throw new Error("DISPUTE_DAO_ADDRESS missing in .env");

  const description = process.env.PROPOSAL_DESCRIPTION ||
    process.argv[2] ||
    "Fund a 50,000 USDC security audit for Protocol X";

  const dao = await ethers.getContractAt("DisputeDAO", daoAddress);
  const tx = await dao.openProposal(description);
  const rc = await tx.wait();

  const current = await dao.getCurrentProposal();
  console.log("Proposal opened   :", description);
  console.log("Tx hash           :", tx.hash);
  console.log("Block             :", rc?.blockNumber);
  console.log("Proposal id       :", current.id.toString());
  console.log("Active proposal id:", (await dao.currentProposalId()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
