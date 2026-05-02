import { ethers } from "hardhat";

async function main() {
  const dao = await ethers.getContractAt("DisputeDAO", process.env.DISPUTE_DAO_ADDRESS!);
  const id = await dao.currentProposalId();
  if (id === 0n) {
    console.log("no active proposal");
    return;
  }
  console.log("active proposal:", id.toString());
  try {
    const tx = await dao.forceResolve();
    const rc = await tx.wait();
    console.log("forceResolve tx:", tx.hash, "block", rc?.blockNumber);
  } catch (e: any) {
    console.log("forceResolve failed (likely <quorum):", e?.shortMessage || e?.message || e);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
