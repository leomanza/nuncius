"use strict";
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
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function findRepoRoot(start) {
    let dir = start;
    while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, ".env")) && fs.existsSync(path.join(dir, "axl-src")))
            return dir;
        dir = path.dirname(dir);
    }
    throw new Error("repo root with .env + axl-src not found from " + start);
}
const REPO_ROOT = findRepoRoot(__dirname);
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });
const axl_client_1 = require("../../shared/axl-client");
const axl_handler_1 = require("./axl-handler");
const personas_1 = require("../../shared/personas");
const AGENT_INDEX = parseInt(process.env.AGENT_INDEX || "1", 10);
const PERSONA = (0, personas_1.getPersonaByIndex)(AGENT_INDEX);
const TAG = PERSONA.displayName;
const AXL_API_URL = process.env.AXL_API_URL || `http://127.0.0.1:${10000 + AGENT_INDEX}`;
const HTTP_PORT = parseInt(process.env.HTTP_PORT || `${4000 + AGENT_INDEX}`, 10);
const DAO_ADDRESS = process.env.DISPUTE_DAO_ADDRESS;
const SKIP_VOTE = process.env.AGENT_SKIP_VOTE === "1";
if (!DAO_ADDRESS) {
    console.error(`[${TAG}] DISPUTE_DAO_ADDRESS missing in .env`);
    process.exit(1);
}
let currentStatus = { state: "idle" };
const setStatus = (s) => { currentStatus = s; };
let lastDeliberation = null;
let lastVote = null;
// Dedupe so a single agent never tries to submit twice for the same proposal
// even if AXL re-delivers the broadcast (defense-in-depth on top of the
// contract-level nullifier protection).
const seenProposalIds = new Set();
const app = new hono_1.Hono();
// Allow the frontend dashboard to fetch /status, /last-deliberation, /last-vote
// from a different origin (Next dev runs on :3000; agents on :4001..:4005).
app.use("*", (0, cors_1.cors)({ origin: "*" }));
const AGENT_WALLET_ADDR = (() => {
    const pk = process.env[`AGENT_${AGENT_INDEX}_PRIVATE_KEY`];
    if (!pk)
        return null;
    try {
        // Cheap derivation without ethers dep at top of file
        const { ethers } = require("ethers");
        return new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk).address;
    }
    catch {
        return null;
    }
})();
app.get("/health", (c) => c.json({
    agent: `agent-${AGENT_INDEX}`,
    displayName: PERSONA.displayName,
    ensSubname: `${PERSONA.label}.nuncius.eth`,
    walletAddress: AGENT_WALLET_ADDR,
    httpPort: HTTP_PORT,
    axlApi: AXL_API_URL,
    dao: DAO_ADDRESS,
    skipVote: SKIP_VOTE,
    timestamp: Date.now(),
}));
app.get("/status", (c) => c.json({ index: AGENT_INDEX, ...currentStatus }));
app.get("/last-deliberation", (c) => c.json(lastDeliberation || { empty: true }));
app.get("/last-vote", (c) => c.json(lastVote || { empty: true }));
async function main() {
    console.log(`[${TAG}] booting — AXL=${AXL_API_URL} http=${HTTP_PORT} dao=${DAO_ADDRESS} skipVote=${SKIP_VOTE}`);
    const axl = await (0, axl_client_1.createAXLClient)(AXL_API_URL);
    console.log(`[${TAG}] AXL peer id: ${axl.ourPeerId.slice(0, 16)}…`);
    (0, axl_client_1.startReceiveLoop)(axl, async (msg) => {
        const env = msg.payload;
        if (!env || typeof env !== "object" || env.type !== "PROPOSAL_BROADCAST") {
            console.log(`[${TAG}] ignoring inbound (type=${env?.type})`);
            return;
        }
        const pid = env.proposalId;
        if (typeof pid === "number" && seenProposalIds.has(pid)) {
            console.log(`[${TAG}] duplicate proposal #${pid}, ignoring`);
            return;
        }
        if (typeof pid === "number")
            seenProposalIds.add(pid);
        try {
            await (0, axl_handler_1.handleProposal)(AGENT_INDEX, msg, DAO_ADDRESS, setStatus, {
                coordinatorPeerId: msg.fromPeerIdPrefix, // truncated prefix is what AXL wants for /send too
                axl,
                skipVote: SKIP_VOTE,
                onDeliberation: (r) => { lastDeliberation = r; },
                onVote: (r) => { lastVote = r; },
            });
        }
        catch (err) {
            console.error(`[${TAG}] handler error:`, err);
            setStatus({ state: "error", error: err?.message || String(err), updatedAt: Date.now() });
        }
    }, {
        intervalMs: 250,
        onError: (e) => console.warn(`[${TAG}] recv loop err:`, String(e)),
    });
    (0, node_server_1.serve)({ fetch: app.fetch, port: HTTP_PORT }, (info) => {
        console.log(`[${TAG}] HTTP up on ${info.port} — ready, listening on AXL`);
    });
}
main().catch((err) => {
    console.error(`[${TAG}] fatal:`, err);
    process.exit(1);
});
