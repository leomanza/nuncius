"use strict";
/// trigger-proposal.ts
///
/// Coordinator side of the protocol:
///   1. Either open a fresh proposal on-chain via DisputeDAO.openProposal,
///      OR (if currentProposalId != 0) reuse the active one.
///   2. Read the 5 agent peer ids from logs/axl-peer-ids.json (produced by
///      scripts/start-axl.sh).
///   3. Build a PROPOSAL_BROADCAST envelope and fan it out via AXL /send to
///      each agent. Coordinator uses node-1's AXL API since node-1 is the
///      bootstrap and reaches every agent through the mesh.
///
/// AXL has no GossipSub; this fan-out is the manual broadcast layer.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });
const axl_client_1 = require("../shared/axl-client");
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const COORDINATOR_AXL = process.env.COORDINATOR_AXL || "http://127.0.0.1:10001";
const PEER_IDS_PATH = process.env.AXL_PEER_IDS_PATH || path.join(REPO_ROOT, "logs", "axl-peer-ids.json");
const DAO_ABI = [
    "function currentProposalId() view returns (uint256)",
    "function openProposal(string description) returns (uint256)",
    "function getProposal(uint256 id) view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
    "function groupId() view returns (uint256)",
    "event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)",
];
async function main() {
    const description = process.env.PROPOSAL_DESCRIPTION
        || process.argv[2]
        || "Fund a 50,000 USDC security audit for Protocol X";
    const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
    if (!daoAddress)
        throw new Error("DISPUTE_DAO_ADDRESS missing");
    if (!process.env.PRIVATE_KEY)
        throw new Error("PRIVATE_KEY missing");
    const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const dao = new ethers_1.ethers.Contract(daoAddress, DAO_ABI, signer);
    console.log("Coordinator   :", signer.address);
    console.log("DAO           :", daoAddress);
    // ── 1) Open or reuse proposal ──────────────────────────────────────
    let activeId = await dao.currentProposalId();
    let openedTxHash = null;
    let openedBlock = null;
    if (activeId === 0n) {
        console.log(`\nopenProposal(${JSON.stringify(description)})`);
        const tx = await dao.openProposal(description);
        const rc = await tx.wait();
        openedTxHash = tx.hash;
        openedBlock = rc?.blockNumber ?? null;
        activeId = await dao.currentProposalId();
        console.log("  tx     :", tx.hash);
        console.log("  block  :", openedBlock);
        console.log("  id     :", activeId.toString());
    }
    else {
        console.log(`\nReusing active proposal #${activeId} (already open)`);
    }
    const proposal = await dao.getProposal(activeId);
    const groupId = await dao.groupId();
    console.log("  desc   :", proposal.description);
    console.log("  group  :", groupId.toString());
    // ── 2) Load peer ids ──────────────────────────────────────────────
    if (!fs.existsSync(PEER_IDS_PATH)) {
        throw new Error(`peer ids file missing: ${PEER_IDS_PATH}. Run scripts/start-axl.sh first.`);
    }
    const peers = JSON.parse(fs.readFileSync(PEER_IDS_PATH, "utf-8"));
    const peerIds = Object.values(peers).map((p) => p.peer_id);
    console.log(`\n${peerIds.length} agent peers loaded from ${path.relative(REPO_ROOT, PEER_IDS_PATH)}`);
    for (const [name, info] of Object.entries(peers)) {
        console.log(`  ${name}: ${info.peer_id.slice(0, 16)}…`);
    }
    // ── 3) Fan out via AXL /send ──────────────────────────────────────
    const axl = await (0, axl_client_1.createAXLClient)(COORDINATOR_AXL);
    console.log(`\nCoordinator AXL: ${COORDINATOR_AXL} (peer ${axl.ourPeerId.slice(0, 16)}…)`);
    const payload = {
        proposalId: Number(activeId),
        description: proposal.description,
        contractAddress: daoAddress,
        groupId: groupId.toString(),
        scope: activeId.toString(),
    };
    const envelope = {
        type: "PROPOSAL_BROADCAST",
        from: "coordinator",
        proposalId: Number(activeId),
        timestamp: Date.now(),
        payload,
    };
    const { ok, failed } = await (0, axl_client_1.fanout)(axl, peerIds, envelope);
    console.log(`Fan-out  : ok=${ok} failed=${failed}`);
    const summary = {
        daoAddress,
        proposalId: activeId.toString(),
        description: proposal.description,
        groupId: groupId.toString(),
        openedTxHash,
        openedBlock,
        coordinatorAxl: COORDINATOR_AXL,
        coordinatorPeerId: axl.ourPeerId,
        fanout: { ok, failed, peerIds },
        timestamp: new Date().toISOString(),
    };
    const outPath = path.join(REPO_ROOT, "logs", `trigger-proposal-${activeId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
