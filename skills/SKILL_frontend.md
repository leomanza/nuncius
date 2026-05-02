# SKILL: Demo Dashboard
## Session 6 — The Visual That Wins the Demo Video

The frontend is not an afterthought. Judges watch 3-minute demo videos. The visual story of five agents deliberating and casting anonymous proofs is the thing they remember. Build this to be genuinely impressive.

---

## Design Direction

**Aesthetic: Dark terminal meets cryptographic precision.**

Think: deep charcoal backgrounds (#0d0f14), monospace type for data values, thin cyan/green accent lines for the "network" feel, and stark white for critical state. Agent cards look like server health monitors. The proof feed looks like a live blockchain log. The network graph looks like a real P2P mesh diagram. No gradients, no gradients, no generic "crypto purple."

Fonts: `JetBrains Mono` for data/addresses, `Space Mono` or `IBM Plex Mono` for UI labels, loaded from Google Fonts.

Accent palette: `#00ffa3` (mint green, "active/approved"), `#ff4d6d` (red, "rejected"), `#00bcd4` (cyan, "network/connecting"), `#888` (neutral/idle).

---

## Tech Stack

```bash
cd frontend/
npx create-next-app@latest . --typescript --tailwind --app
npm install ethers viem wagmi @tanstack/react-query
npm install framer-motion  # for animations
npm install react-force-graph  # for the network graph
```

---

## Page Structure

```
/
├── components/
│   ├── NetworkGraph.tsx      ← 5 nodes, live connection lines
│   ├── ProposalCard.tsx      ← Current proposal + status
│   ├── AgentGrid.tsx         ← 5 agent cards
│   ├── AgentCard.tsx         ← Individual agent status
│   ├── ProofFeed.tsx         ← Live on-chain proof events
│   └── ResolutionBanner.tsx  ← Shows when proposal resolves
└── page.tsx                  ← Main dashboard
```

---

## `frontend/src/app/page.tsx`

```tsx
"use client";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import NetworkGraph from "./components/NetworkGraph";
import ProposalCard from "./components/ProposalCard";
import AgentGrid from "./components/AgentGrid";
import ProofFeed from "./components/ProofFeed";
import ResolutionBanner from "./components/ResolutionBanner";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const DAO_ADDRESS = process.env.NEXT_PUBLIC_DISPUTE_DAO_ADDRESS!;

const DAO_ABI = [
  "function getCurrentProposal() view returns (tuple(uint256 id, string description, uint256 approveCount, uint256 rejectCount, bool resolved, bool approved, uint256 createdAt, uint256 resolvedAt))",
  "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)",
  "event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp)",
  "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];

export interface ProofEvent {
  proposalId: number;
  signal: number; // 1 = Approve, 2 = Reject
  nullifier: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

export interface AgentStatus {
  index: number;
  state: "idle" | "deliberating" | "voting" | "voted" | "error";
  reasoning?: string;
  txHash?: string;
}

export default function Dashboard() {
  const [proposal, setProposal] = useState<any>(null);
  const [proofEvents, setProofEvents] = useState<ProofEvent[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>(
    [1,2,3,4,5].map(i => ({ index: i, state: "idle" }))
  );
  const [resolution, setResolution] = useState<any>(null);

  useEffect(() => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const dao = new ethers.Contract(DAO_ADDRESS, DAO_ABI, provider);

    // Poll for current proposal
    const pollProposal = async () => {
      try {
        const p = await dao.getCurrentProposal();
        if (p.id > 0n) setProposal(p);
      } catch {}
    };

    // Listen for on-chain events
    dao.on("ProofVerified", (proposalId, signal, nullifier, event) => {
      setProofEvents(prev => [{
        proposalId: Number(proposalId),
        signal: Number(signal),
        nullifier: nullifier.toString(16).slice(0, 16) + "...",
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
        timestamp: Date.now(),
      }, ...prev].slice(0, 20));
    });

    dao.on("ProposalResolved", (proposalId, approved, approveCount, rejectCount) => {
      setResolution({ proposalId: Number(proposalId), approved, approveCount: Number(approveCount), rejectCount: Number(rejectCount) });
    });

    pollProposal();
    const interval = setInterval(pollProposal, 3000);

    // Poll agent HTTP endpoints for status
    const pollAgents = async () => {
      const statuses = await Promise.all(
        [1,2,3,4,5].map(async (i) => {
          try {
            const res = await fetch(`http://localhost:${4000 + i}/status`);
            const data = await res.json();
            return { index: i, ...data };
          } catch {
            return { index: i, state: "idle" };
          }
        })
      );
      setAgentStatuses(statuses);
    };

    const agentInterval = setInterval(pollAgents, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(agentInterval);
      dao.removeAllListeners();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white font-mono">
      {/* Header */}
      <header className="border-b border-[#1e2230] px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-widest text-[#00ffa3]">ZK SWARM</h1>
          <p className="text-xs text-[#555] mt-0.5">Anonymous DAO Governance · Semaphore V4 · Gensyn AXL · 0G Chain</p>
        </div>
        <div className="text-right text-xs text-[#555]">
          <div>Contract: <span className="text-[#00bcd4]">{DAO_ADDRESS?.slice(0, 10)}...</span></div>
          <div>Network: <span className="text-[#00ffa3]">0G Galileo</span></div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6 p-8">
        {/* Left column: Network + Proposal */}
        <div className="col-span-4 space-y-6">
          <NetworkGraph agentStatuses={agentStatuses} />
          <ProposalCard proposal={proposal} />
        </div>

        {/* Center column: Agent Grid */}
        <div className="col-span-5">
          <AgentGrid agentStatuses={agentStatuses} />
        </div>

        {/* Right column: Proof Feed */}
        <div className="col-span-3">
          <ProofFeed events={proofEvents} />
        </div>
      </div>

      {/* Resolution Banner */}
      {resolution && <ResolutionBanner resolution={resolution} />}
    </div>
  );
}
```

---

## `components/AgentCard.tsx`

```tsx
import { motion } from "framer-motion";
import { AgentStatus } from "../page";

const STATE_COLORS = {
  idle: "#444",
  deliberating: "#00bcd4",
  voting: "#ffd700",
  voted: "#00ffa3",
  error: "#ff4d6d",
};

const STATE_LABELS = {
  idle: "IDLE",
  deliberating: "DELIBERATING...",
  voting: "GENERATING PROOF",
  voted: "PROOF SUBMITTED",
  error: "ERROR",
};

export default function AgentCard({ agent }: { agent: AgentStatus }) {
  const color = STATE_COLORS[agent.state];
  const label = STATE_LABELS[agent.state];

  return (
    <motion.div
      className="border rounded-lg p-4 relative overflow-hidden"
      style={{ borderColor: color + "44" }}
      animate={{ borderColor: agent.state === "deliberating" ? [color + "44", color + "cc", color + "44"] : color + "44" }}
      transition={{ duration: 1.5, repeat: agent.state === "deliberating" ? Infinity : 0 }}
    >
      {/* Glow effect when active */}
      {agent.state !== "idle" && (
        <div
          className="absolute inset-0 opacity-5"
          style={{ background: `radial-gradient(ellipse at center, ${color}, transparent 70%)` }}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#555] tracking-widest">VOTER {agent.index}</span>
        <span className="text-xs font-bold" style={{ color }}>{label}</span>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-2">
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
          animate={agent.state === "deliberating" ? { opacity: [1, 0.3, 1] } : {}}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
        <span className="text-xs text-[#666]">
          {agent.state === "deliberating" ? "AI inference running..." : 
           agent.state === "voting" ? "ZK proof generation..." :
           agent.state === "voted" ? `Tx: ${agent.txHash?.slice(0, 12)}...` :
           "Awaiting proposal"}
        </span>
      </div>

      {/* Reasoning snippet (non-identifying) */}
      {agent.reasoning && (
        <p className="text-[10px] text-[#555] leading-relaxed line-clamp-2 mt-2 italic">
          "{agent.reasoning.slice(0, 100)}..."
        </p>
      )}
    </motion.div>
  );
}
```

---

## `components/ProofFeed.tsx`

```tsx
import { motion, AnimatePresence } from "framer-motion";
import { ProofEvent } from "../page";

export default function ProofFeed({ events }: { events: ProofEvent[] }) {
  return (
    <div className="border border-[#1e2230] rounded-lg p-4 h-full">
      <h3 className="text-xs tracking-widest text-[#555] mb-4">ANONYMOUS PROOF FEED</h3>

      {events.length === 0 && (
        <p className="text-xs text-[#333] text-center mt-8">Awaiting proofs...</p>
      )}

      <AnimatePresence>
        {events.map((event, i) => (
          <motion.div
            key={event.txHash + i}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-3 pb-3 border-b border-[#1e2230] last:border-0"
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: event.signal === 1 ? "#00ffa3" : "#ff4d6d" }}
              />
              <span className="text-xs font-bold" style={{ color: event.signal === 1 ? "#00ffa3" : "#ff4d6d" }}>
                {event.signal === 1 ? "APPROVE" : "REJECT"}
              </span>
              <span className="text-[10px] text-[#444] ml-auto">#{event.blockNumber}</span>
            </div>
            <div className="text-[10px] text-[#444] font-mono">
              <div>nullifier: {event.nullifier}</div>
              <div>tx: {event.txHash?.slice(0, 16)}...</div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

---

## `components/NetworkGraph.tsx`

Use `react-force-graph` for an animated P2P network visualization:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { AgentStatus } from "../page";

const STATE_COLORS = {
  idle: "#333",
  deliberating: "#00bcd4",
  voting: "#ffd700",
  voted: "#00ffa3",
  error: "#ff4d6d",
};

export default function NetworkGraph({ agentStatuses }: { agentStatuses: AgentStatus[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simple canvas-based P2P mesh (5 nodes in a pentagon, animated edges)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.35;

    // Node positions: pentagon
    const nodes = agentStatuses.map((agent, i) => {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        agent,
      };
    });

    let frame = 0;
    const animate = () => {
      ctx.clearRect(0, 0, W, H);

      // Draw edges (mesh connections)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const active = nodes[i].agent.state !== "idle" || nodes[j].agent.state !== "idle";
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = active
            ? `rgba(0, 188, 212, ${0.1 + 0.1 * Math.sin(frame * 0.05 + i + j)})`
            : "rgba(40, 44, 56, 0.8)";
          ctx.lineWidth = active ? 1.5 : 0.5;
          ctx.stroke();
        }
      }

      // Draw nodes
      nodes.forEach((node) => {
        const color = STATE_COLORS[node.agent.state];

        // Outer ring (pulsing when active)
        if (node.agent.state !== "idle") {
          const pulse = 0.6 + 0.4 * Math.sin(frame * 0.1);
          ctx.beginPath();
          ctx.arc(node.x, node.y, 18 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = color + "44";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        ctx.fillStyle = "#888";
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`V${node.agent.index}`, node.x, node.y + 24);
      });

      frame++;
      requestAnimationFrame(animate);
    };

    animate();
  }, [agentStatuses]);

  return (
    <div className="border border-[#1e2230] rounded-lg p-4">
      <h3 className="text-xs tracking-widest text-[#555] mb-3">AXL P2P MESH</h3>
      <canvas ref={canvasRef} width={280} height={200} className="w-full" />
      <div className="flex gap-4 mt-2 justify-center">
        {Object.entries(STATE_COLORS).slice(1).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[9px] text-[#444] uppercase">{state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Session 6 Deliverables Checklist

- [ ] `frontend/` Next.js app starts with `npm run dev`
- [ ] Dashboard shows all 5 agents in real-time
- [ ] Network graph animates with agent state changes
- [ ] Proof feed shows live `ProofVerified` events
- [ ] Resolution banner appears when `ProposalResolved` fires
- [ ] Demo can be triggered: run `scripts/trigger-proposal.ts`, watch dashboard animate
- [ ] Looks good on 1080p screen (for screen recording demo video)

## Demo Video Tips

- Record at 1920×1080, 60fps
- Open two terminals side-by-side: one with `start-all.sh` output, one with `trigger-proposal.ts`
- Let the dashboard be the main focus; use the terminal output as confirmation
- The key moment: 5 proof entries appear in the feed in rapid succession, then the resolution banner fires
- Narrate the nullifiers: "Five valid anonymous proofs — no way to know who voted what"
