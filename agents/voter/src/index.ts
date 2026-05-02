import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import * as dotenv from "dotenv";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { createAXLClient, startReceiveLoop, InboundMessage } from "../../shared/axl-client";
import { NunciusMessage } from "../../shared/types";
import { AgentState } from "../../shared/0g-kv-client";
import { handleProposal } from "./axl-handler";
import { getPersonaByIndex } from "../../shared/personas";

const AGENT_INDEX = parseInt(process.env.AGENT_INDEX || "1", 10);
const PERSONA = getPersonaByIndex(AGENT_INDEX);
const TAG = PERSONA.displayName;
const AXL_API_URL = process.env.AXL_API_URL || `http://127.0.0.1:${10000 + AGENT_INDEX}`;
const HTTP_PORT = parseInt(process.env.HTTP_PORT || `${4000 + AGENT_INDEX}`, 10);
const DAO_ADDRESS = process.env.DISPUTE_DAO_ADDRESS;
const SKIP_VOTE = process.env.AGENT_SKIP_VOTE === "1";

if (!DAO_ADDRESS) {
  console.error(`[${TAG}] DISPUTE_DAO_ADDRESS missing in .env`);
  process.exit(1);
}

let currentStatus: AgentState = { state: "idle" };
const setStatus = (s: AgentState) => { currentStatus = s; };

let lastDeliberation: any = null;
let lastVote: any = null;

// Dedupe so a single agent never tries to submit twice for the same proposal
// even if AXL re-delivers the broadcast (defense-in-depth on top of the
// contract-level nullifier protection).
const seenProposalIds = new Set<number>();

const app = new Hono();
// Allow the frontend dashboard to fetch /status, /last-deliberation, /last-vote
// from a different origin (Next dev runs on :3000; agents on :4001..:4005).
app.use("*", cors({ origin: "*" }));
const AGENT_WALLET_ADDR = (() => {
  const pk = process.env[`AGENT_${AGENT_INDEX}_PRIVATE_KEY`];
  if (!pk) return null;
  try {
    // Cheap derivation without ethers dep at top of file
    const { ethers } = require("ethers");
    return new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk).address;
  } catch { return null; }
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

  const axl = await createAXLClient(AXL_API_URL);
  console.log(`[${TAG}] AXL peer id: ${axl.ourPeerId.slice(0, 16)}…`);

  startReceiveLoop<NunciusMessage>(
    axl,
    async (msg: InboundMessage<NunciusMessage>) => {
      const env = msg.payload;
      if (!env || typeof env !== "object" || env.type !== "PROPOSAL_BROADCAST") {
        console.log(`[${TAG}] ignoring inbound (type=${(env as any)?.type})`);
        return;
      }
      const pid = (env as any).proposalId;
      if (typeof pid === "number" && seenProposalIds.has(pid)) {
        console.log(`[${TAG}] duplicate proposal #${pid}, ignoring`);
        return;
      }
      if (typeof pid === "number") seenProposalIds.add(pid);

      try {
        await handleProposal(AGENT_INDEX, msg, DAO_ADDRESS!, setStatus, {
          coordinatorPeerId: msg.fromPeerIdPrefix, // truncated prefix is what AXL wants for /send too
          axl,
          skipVote: SKIP_VOTE,
          onDeliberation: (r) => { lastDeliberation = r; },
          onVote: (r) => { lastVote = r; },
        });
      } catch (err: any) {
        console.error(`[${TAG}] handler error:`, err);
        setStatus({ state: "error", error: err?.message || String(err), updatedAt: Date.now() });
      }
    },
    {
      intervalMs: 250,
      onError: (e) => console.warn(`[${TAG}] recv loop err:`, String(e)),
    },
  );

  serve({ fetch: app.fetch, port: HTTP_PORT }, (info) => {
    console.log(`[${TAG}] HTTP up on ${info.port} — ready, listening on AXL`);
  });
}

main().catch((err) => {
  console.error(`[${TAG}] fatal:`, err);
  process.exit(1);
});
