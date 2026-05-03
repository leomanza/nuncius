/// force-resolve-and-open.ts
///
/// 1. Calls forceResolve() to clear any stuck active proposal.
/// 2. If PROPOSAL_DESCRIPTION is set (env var or argv[2]), opens a new
///    proposal and fans out to all 5 agent peers via AXL.
///    If not set, stops after resolving so the UI can pose the next question.

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { createAXLClient, fanout } from "../shared/axl-client";
import { NunciusMessage, ProposalBroadcastPayload } from "../shared/types";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const COORDINATOR_AXL = process.env.COORDINATOR_AXL || "http://127.0.0.1:10001";
const PEER_IDS_PATH =
  process.env.AXL_PEER_IDS_PATH ||
  path.join(REPO_ROOT, "logs", "axl-peer-ids.json");

const DAO_ABI = [
  "function currentProposalId() view returns (uint256)",
  "function openProposal(string description) returns (uint256)",
  "function getProposal(uint256 id) view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
  "function forceResolve()",
  "function groupId() view returns (uint256)",
  "event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)",
  "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];

async function main() {
  const description = process.env.PROPOSAL_DESCRIPTION || process.argv[2] || "";

  const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
  if (!daoAddress) throw new Error("DISPUTE_DAO_ADDRESS missing");
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const dao = new ethers.Contract(daoAddress, DAO_ABI, signer);

  console.log("Coordinator   :", signer.address);
  console.log("DAO           :", daoAddress);

  // ── 1) forceResolve any stuck proposal ────────────────────────────
  const stuckId: bigint = await dao.currentProposalId();
  if (stuckId !== 0n) {
    const stuck = await dao.getProposal(stuckId);
    console.log(`\nForce-resolving stuck proposal #${stuckId}: "${stuck.description}"`);
    const tx = await dao.forceResolve();
    const receipt = await tx.wait();
    console.log(`  forceResolve tx: ${tx.hash}  (block ${receipt.blockNumber})`);
  } else {
    console.log("\nNo active proposal — nothing to resolve.");
  }

  // ── 2) Open new proposal (only if PROPOSAL_DESCRIPTION provided) ──
  if (!description) {
    console.log("\nNo PROPOSAL_DESCRIPTION set — slot cleared. Use the UI to pose the next question.");
    return;
  }
  console.log(`\nOpening proposal: "${description}"`);
  const openTx = await dao.openProposal(description);
  const openReceipt = await openTx.wait();
  const newId: bigint = await dao.currentProposalId();
  console.log(`  openProposal tx: ${openTx.hash}  (block ${openReceipt.blockNumber})`);
  console.log(`  New proposal ID: #${newId}`);

  const groupId: bigint = await dao.groupId();

  // ── 3) Fan-out via AXL ────────────────────────────────────────────
  if (!fs.existsSync(PEER_IDS_PATH)) {
    throw new Error(`peer ids file missing: ${PEER_IDS_PATH}. Run scripts/start-axl.sh first.`);
  }
  const peers: Record<string, { api: string; peer_id: string }> = JSON.parse(
    fs.readFileSync(PEER_IDS_PATH, "utf-8")
  );
  const peerIds = Object.values(peers).map((p) => p.peer_id);
  console.log(`\n${peerIds.length} agent peers loaded`);

  const axl = await createAXLClient(COORDINATOR_AXL);
  console.log(`Coordinator AXL: ${COORDINATOR_AXL} (peer ${axl.ourPeerId.slice(0, 16)}…)`);

  const payload: ProposalBroadcastPayload = {
    proposalId: Number(newId),
    description,
    contractAddress: daoAddress,
    groupId: groupId.toString(),
    scope: newId.toString(),
  };
  const envelope: NunciusMessage = {
    type: "PROPOSAL_BROADCAST",
    from: "coordinator",
    proposalId: Number(newId),
    timestamp: Date.now(),
    payload,
  };
  const { ok, failed } = await fanout(axl, peerIds, envelope);
  console.log(`Fan-out  : ok=${ok} failed=${failed}`);

  const outPath = path.join(REPO_ROOT, "logs", `trigger-proposal-${newId}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        daoAddress,
        forcedResolvedId: stuckId.toString(),
        proposalId: newId.toString(),
        description,
        groupId: groupId.toString(),
        openTxHash: openTx.hash,
        openBlock: openReceipt.blockNumber,
        coordinatorAxl: COORDINATOR_AXL,
        coordinatorPeerId: axl.ourPeerId,
        fanout: { ok, failed, peerIds },
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
