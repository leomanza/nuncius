const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });
require("dotenv").config({ path: "../.env.secrets" });
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const dao = new ethers.Contract(process.env.DISPUTE_DAO_ADDRESS,
    ["event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)"], p);
  const filter = dao.filters.ProposalOpened(9);
  const events = await dao.queryFilter(filter, 31229000, 31230320);
  console.log("found events:", events.length);
  for (const e of events) console.log("openProposal #9 tx:", e.transactionHash, "block:", e.blockNumber);
})();
