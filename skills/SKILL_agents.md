# SKILL: Voter Agent Implementation
## Session 3 (Part 2) + Session 4 — The AI Deliberation Loop

Read `SKILL_axl.md`, `SKILL_0g_compute.md`, and `SKILL_semaphore.md` first.
This skill describes the complete voter agent: one TypeScript process per agent, running on its own AXL node.

---

## Agent Overview

Each voter agent is a Hono HTTP server that:
1. **Listens on its AXL node** for broadcast messages
2. **Receives a proposal** via AXL GossipSub
3. **Deliberates** using 0G Compute (AI inference)
4. **Writes working state** to 0G Storage KV
5. **Generates a Semaphore proof** for its vote
6. **Submits the proof on-chain**
7. **Broadcasts completion** to the mesh via AXL

Five identical processes run simultaneously, one per agent wallet and AXL node. They are parametrized by environment variables.

---

## Package Setup

```bash
cd agents/
npm init -y
npm install hono @hono/node-server ethers @semaphore-protocol/core @0gfoundation/0g-ts-sdk @0glabs/0g-serving-broker dotenv
npm install --save-dev typescript ts-node @types/node
```

### `agents/package.json` scripts
```json
{
  "scripts": {
    "start:1": "AGENT_INDEX=1 AXL_API_URL=http://127.0.0.1:10001 ts-node voter/src/index.ts",
    "start:2": "AGENT_INDEX=2 AXL_API_URL=http://127.0.0.1:10002 ts-node voter/src/index.ts",
    "start:3": "AGENT_INDEX=3 AXL_API_URL=http://127.0.0.1:10003 ts-node voter/src/index.ts",
    "start:4": "AGENT_INDEX=4 AXL_API_URL=http://127.0.0.1:10004 ts-node voter/src/index.ts",
    "start:5": "AGENT_INDEX=5 AXL_API_URL=http://127.0.0.1:10005 ts-node voter/src/index.ts",
    "start:all": "concurrently \"npm run start:1\" \"npm run start:2\" \"npm run start:3\" \"npm run start:4\" \"npm run start:5\""
  }
}
```

---

## `agents/voter/src/index.ts` — Main Entry Point

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { createAXLClient, subscribe } from "../../shared/axl-client";
import { handleProposalBroadcast } from "./axl-handler";
import { ZKSwarmMessage } from "../../shared/types";

const AGENT_INDEX = parseInt(process.env.AGENT_INDEX || "1");
const AXL_API_URL = process.env.AXL_API_URL || "http://127.0.0.1:10001";
const HTTP_PORT = 4000 + AGENT_INDEX;

const app = new Hono();

// ── Health endpoint (for frontend + demo)
app.get("/health", (c) => c.json({
  agent: `agent-${AGENT_INDEX}`,
  axlApi: AXL_API_URL,
  status: "running",
  timestamp: Date.now(),
}));

// ── Status endpoint (what is this agent currently doing?)
let currentStatus: object = { state: "idle" };
app.get("/status", (c) => c.json(currentStatus));

const setStatus = (state: object) => { currentStatus = state; };

async function main() {
  console.log(`[Agent ${AGENT_INDEX}] Starting...`);

  // Connect to this agent's AXL node
  const axlClient = await createAXLClient(AXL_API_URL);
  console.log(`[Agent ${AGENT_INDEX}] AXL node ID: ${axlClient.nodeId}`);

  // Subscribe to the DAO proposal topic
  await subscribe(axlClient, "nuncius:proposals", async (msg: ZKSwarmMessage) => {
    if (msg.type === "PROPOSAL_BROADCAST") {
      console.log(`[Agent ${AGENT_INDEX}] Received proposal: ${msg.payload}`);
      setStatus({ state: "deliberating", proposalId: msg.proposalId });

      try {
        const txHash = await handleProposalBroadcast(AGENT_INDEX, msg, axlClient, setStatus);
        setStatus({ state: "voted", proposalId: msg.proposalId, txHash });
      } catch (err) {
        console.error(`[Agent ${AGENT_INDEX}] Error:`, err);
        setStatus({ state: "error", error: String(err) });
      }
    }
  });

  // Start HTTP server
  serve({ fetch: app.fetch, port: HTTP_PORT }, () => {
    console.log(`[Agent ${AGENT_INDEX}] HTTP server on port ${HTTP_PORT}`);
    console.log(`[Agent ${AGENT_INDEX}] Ready. Listening for proposals on AXL.`);
  });
}

main().catch(console.error);
```

---

## `agents/voter/src/axl-handler.ts` — Proposal Handler

```typescript
import { AXLClient, broadcast } from "../../shared/axl-client";
import { ZKSwarmMessage, ProposalBroadcast } from "../../shared/types";
import { deliberate } from "./deliberate";
import { castAnonymousVote } from "./vote";
import { writeAgentState } from "../../shared/0g-storage-client";

export async function handleProposalBroadcast(
  agentIndex: number,
  msg: ZKSwarmMessage,
  axlClient: AXLClient,
  setStatus: (s: object) => void
): Promise<string> {
  const payload = msg.payload as ProposalBroadcast;
  const { proposalId, description } = payload;

  // Step 1: Write initial state to 0G Storage
  await writeAgentState(agentIndex, {
    state: "deliberating",
    proposalId,
    startedAt: Date.now(),
  });

  // Step 2: Deliberate using AI
  setStatus({ state: "deliberating", proposalId, description });
  console.log(`[Agent ${agentIndex}] Deliberating on: "${description}"`);

  const { decision, reasoning, confidence } = await deliberate(agentIndex, description);

  console.log(`[Agent ${agentIndex}] Decision: ${decision} (confidence: ${confidence})`);

  // Step 3: Optionally share reasoning over AXL (not the vote — just the reasoning)
  await broadcast(axlClient, "nuncius:deliberation", {
    type: "DELIBERATION_UPDATE",
    from: `agent-${agentIndex}`,
    proposalId,
    reasoning,
    confidence,
    timestamp: Date.now(),
  });

  // Step 4: Write deliberation result to 0G Storage
  await writeAgentState(agentIndex, {
    state: "voting",
    proposalId,
    reasoning,
    confidence,
    decision,
    decidedAt: Date.now(),
  });

  // Step 5: Cast anonymous vote on-chain via Semaphore
  setStatus({ state: "voting", proposalId, decision });
  const txHash = await castAnonymousVote(agentIndex, proposalId, decision);

  // Step 6: Write final state to 0G Storage
  await writeAgentState(agentIndex, {
    state: "voted",
    proposalId,
    txHash,
    votedAt: Date.now(),
  });

  // Step 7: Broadcast completion to mesh
  await broadcast(axlClient, "nuncius:proposals", {
    type: "VOTE_COMPLETE",
    from: `agent-${agentIndex}`,
    proposalId,
    txHash,
    timestamp: Date.now(),
  });

  return txHash;
}
```

---

## `agents/voter/src/deliberate.ts` — AI Reasoning

```typescript
import { callComputeInference } from "../../shared/0g-compute-client";

export interface DeliberationResult {
  decision: "Approve" | "Reject";
  reasoning: string;
  confidence: number; // 0–1
}

// Each agent has a different "personality" that influences how it deliberates.
// This creates realistic diversity in the swarm's reasoning.
const AGENT_PERSONAS: Record<number, string> = {
  1: "You are a fiscally conservative analyst. You scrutinize all spending proposals carefully and prefer proven approaches with clear ROI.",
  2: "You are an innovation advocate. You support proposals that push the ecosystem forward and are comfortable with some uncertainty.",
  3: "You are a risk manager. You evaluate proposals by their potential downside scenarios and regulatory implications.",
  4: "You are a community advocate. You prioritize proposals that benefit the broadest set of stakeholders.",
  5: "You are a technical reviewer. You assess proposals based on their technical feasibility and implementation quality.",
};

const DAO_MANIFESTO = `
Nuncius DAO Manifesto:
- We fund proposals that advance decentralized AI governance
- All spending must have clear accountability mechanisms
- We favor proposals with measurable outcomes over vague mandates
- Security and privacy are non-negotiable requirements
- We operate transparently except where privacy protects members
`;

export async function deliberate(
  agentIndex: number,
  proposalDescription: string
): Promise<DeliberationResult> {
  const persona = AGENT_PERSONAS[agentIndex] || AGENT_PERSONAS[1];

  const systemPrompt = `${persona}

${DAO_MANIFESTO}

You are voting on DAO proposals as an anonymous AI agent. Your vote will be submitted as a zero-knowledge proof — your individual vote is never revealed, only the aggregate tally is public.

Analyze the proposal carefully and respond with JSON only, no other text:
{
  "decision": "Approve" | "Reject",
  "reasoning": "<2-3 sentences explaining your reasoning>",
  "confidence": <0.0 to 1.0>
}`;

  const userMessage = `Proposal: ${proposalDescription}

Deliberate and vote. Return JSON only.`;

  const responseText = await callComputeInference(systemPrompt, userMessage);

  try {
    // Parse the JSON response
    const cleaned = responseText.replace(/```json\n?|```/g, "").trim();
    const result = JSON.parse(cleaned);

    if (!["Approve", "Reject"].includes(result.decision)) {
      throw new Error(`Invalid decision: ${result.decision}`);
    }

    return {
      decision: result.decision as "Approve" | "Reject",
      reasoning: result.reasoning || "No reasoning provided",
      confidence: Math.min(1, Math.max(0, result.confidence || 0.7)),
    };
  } catch (err) {
    console.error(`[Agent ${agentIndex}] Failed to parse AI response:`, responseText);
    // Fallback: parse decision from text
    const isApprove = responseText.toLowerCase().includes("approve");
    return {
      decision: isApprove ? "Approve" : "Reject",
      reasoning: "Deliberation parsing failed — defaulting to text analysis",
      confidence: 0.5,
    };
  }
}
```

---

## External Proposal Trigger

A simple script to broadcast a new proposal to all agents via AXL (simulating the on-chain event trigger):

### `scripts/trigger-proposal.ts`
```typescript
import { ethers } from "ethers";

async function main() {
  const description = process.argv[2] || "Fund a 50,000 USDC security audit for Protocol X";

  // Open proposal on-chain
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const dao = new ethers.Contract(
    process.env.DISPUTE_DAO_ADDRESS!,
    ["function openProposal(string) external", "event ProposalOpened(uint256 indexed, string, uint256)"],
    signer
  );

  const tx = await dao.openProposal(description);
  const receipt = await tx.wait();

  // Get the proposal ID from the event
  const event = receipt.logs
    .map((log: any) => { try { return dao.interface.parseLog(log); } catch { return null; } })
    .find((e: any) => e?.name === "ProposalOpened");

  const proposalId = event?.args[0];
  console.log(`Proposal #${proposalId} opened on-chain. Tx: ${tx.hash}`);

  // Broadcast to all AXL nodes
  const axlApis = [
    "http://127.0.0.1:10001",
    "http://127.0.0.1:10002",
    "http://127.0.0.1:10003",
    "http://127.0.0.1:10004",
    "http://127.0.0.1:10005",
  ];

  for (const api of axlApis) {
    try {
      await fetch(`${api}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: "nuncius:proposals",
          data: JSON.stringify({
            type: "PROPOSAL_BROADCAST",
            from: "coordinator",
            proposalId: Number(proposalId),
            timestamp: Date.now(),
            payload: {
              proposalId: Number(proposalId),
              description,
              contractAddress: process.env.DISPUTE_DAO_ADDRESS,
            }
          })
        })
      });
    } catch (err) {
      console.error(`Failed to broadcast to ${api}:`, err);
    }
  }

  console.log("Proposal broadcast to all AXL nodes. Agents are deliberating...");
}

main().catch(console.error);
```

---

## Session 3 Agent Deliverables Checklist

- [ ] `agents/package.json` with all deps installed
- [ ] `agents/voter/src/index.ts` — runs without error
- [ ] `agents/voter/src/axl-handler.ts` — handles `PROPOSAL_BROADCAST`
- [ ] `agents/voter/src/deliberate.ts` — returns valid `DeliberationResult`
- [ ] `agents/voter/src/vote.ts` — calls `castAnonymousVote` (from SKILL_semaphore.md)
- [ ] `scripts/trigger-proposal.ts` — broadcasts a proposal
- [ ] **End-to-end test**: run `scripts/trigger-proposal.ts`, watch all 5 agents log deliberation and vote
- [ ] All 5 `ProofVerified` events appear on Galileo explorer
