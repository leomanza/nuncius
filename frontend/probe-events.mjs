import { ethers } from "ethers";
const RPC = "https://evmrpc-testnet.0g.ai";
const DAO = "0x650c074910bC5855f6573f9d62EE5b8bA90664D9";
const ABI = [
  "event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)",
  "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)",
  "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];
const provider = new ethers.JsonRpcProvider(RPC);
const dao = new ethers.Contract(DAO, ABI, provider);
const head = await provider.getBlockNumber();
const from = Math.max(0, head - 20000);
console.log("head=", head, "from=", from);
try {
  const ev = await dao.queryFilter(dao.filters.ProofVerified(), from, head);
  console.log("verified count:", ev.length);
  console.log("first:", ev[0]?.transactionHash, ev[0]?.blockNumber);
} catch (err) {
  console.log("ERR:", err.message);
  console.log("info:", err.info);
}
