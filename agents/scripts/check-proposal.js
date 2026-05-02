const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });
require("dotenv").config({ path: "../.env.secrets" });
const ABI = [
  "function getProposal(uint256 id) view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
  "function currentProposalId() view returns (uint256)",
];
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const c = new ethers.Contract(process.env.DISPUTE_DAO_ADDRESS, ABI, p);
  const id = process.argv[2] ? BigInt(process.argv[2]) : await c.currentProposalId();
  const pr = await c.getProposal(id);
  console.log("current id:", id.toString());
  console.log("desc       :", pr.description);
  console.log("approve    :", pr.approveCount.toString());
  console.log("reject     :", pr.rejectCount.toString());
  console.log("resolved   :", pr.resolved);
  console.log("approved   :", pr.approved);
  console.log("createdAt  :", new Date(Number(pr.createdAt)*1000).toISOString());
  if (pr.resolvedAt > 0) console.log("resolvedAt :", new Date(Number(pr.resolvedAt)*1000).toISOString());
})();
