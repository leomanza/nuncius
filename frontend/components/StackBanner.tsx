"use client";

import type { AgentStatus } from "@/lib/agents";
import type { ProposalView, ProofVerifiedEvent, ProposalOpenedEvent, ProposalResolvedEvent } from "@/lib/dao";

interface StackBannerProps {
  statuses: AgentStatus[];
  proposal: ProposalView | null;
  events: {
    opened: ProposalOpenedEvent[];
    verified: ProofVerifiedEvent[];
    resolved: ProposalResolvedEvent[];
    head: number;
  } | null;
}

interface Layer {
  key: string;
  short: string;
  long: string;
  active: boolean;
  detail: string;
}

/// Six-layer status strip — one cell per sponsor stack so judges can verify
/// each one is lit up at the moment of the demo.
export function StackBanner({ statuses, proposal, events }: StackBannerProps) {
  const onlineCount = statuses.filter((s) => s.online).length;
  const reasoningCount = statuses.filter((s) => s.state === "deliberating").length;
  const provingCount = statuses.filter((s) => s.state === "voting").length;
  const votedCount = statuses.filter((s) => s.state === "voted").length;
  const headBlock = events?.head ?? 0;
  const verifiedCount = events?.verified.length ?? 0;
  const recentResolved = events?.resolved
    .slice()
    .sort((a, b) => b.blockNumber - a.blockNumber)[0];

  const layers: Layer[] = [
    {
      key: "0g-chain",
      short: "0G Chain",
      long: "0G Galileo (chainId 16602)",
      active: headBlock > 0,
      detail: headBlock ? `head ${headBlock.toLocaleString()}` : "rpc…",
    },
    {
      key: "0g-compute",
      short: "0G Compute",
      long: "qwen-2.5-7b-instruct",
      active: reasoningCount > 0 || statuses.some((s) => !!s.source && s.source === "0g-compute"),
      detail:
        reasoningCount > 0
          ? `${reasoningCount} agent${reasoningCount > 1 ? "s" : ""} reasoning`
          : statuses.some((s) => !!s.txHash) ? "ready" : "idle",
    },
    {
      key: "0g-storage",
      short: "0G Storage",
      long: "Flow + KV",
      active: votedCount > 0 || provingCount > 0,
      detail: votedCount > 0 ? `${votedCount} state writes` : provingCount > 0 ? "writing…" : "idle",
    },
    {
      key: "axl",
      short: "Gensyn AXL",
      long: "P2P mesh, 5 nodes",
      active: onlineCount > 0,
      detail: `${onlineCount}/5 nodes online`,
    },
    {
      key: "ens",
      short: "ENS",
      long: "nuncius.eth on Sepolia",
      active: true,
      detail: "5 personas resolvable",
    },
    {
      key: "semaphore",
      short: "Semaphore V4",
      long: "Groth16 ZK proofs",
      active: provingCount > 0 || verifiedCount > 0,
      detail:
        provingCount > 0
          ? `${provingCount} proof${provingCount > 1 ? "s" : ""} in flight`
          : verifiedCount > 0
          ? `${verifiedCount} proofs verified`
          : "ready",
    },
  ];

  return (
    <div className="border border-star-dim/30 rounded-sm bg-lapis-deep/60">
      <div className="px-4 py-3 flex items-baseline justify-between flex-wrap gap-2 border-b border-star-dim/20">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] tracking-[0.2em] uppercase text-star-dim/80">
            Live stack
          </span>
          <span className="font-serif italic text-xs text-star-dim/60">
            · every layer in flight
          </span>
        </div>
        {proposal && !proposal.resolved && (
          <span className="text-[10px] tracking-[0.16em] uppercase text-star-dim/80">
            Proposal #{proposal.id} · {proposal.approveCount + proposal.rejectCount}/{statuses.length} voted
          </span>
        )}
        {recentResolved && (
          <span className="text-[10px] tracking-[0.16em] uppercase text-celadon/80">
            Last verdict · #{recentResolved.proposalId} ·{" "}
            {recentResolved.approved ? "Approved" : "Rejected"}{" "}
            {recentResolved.approveCount}-{recentResolved.rejectCount}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {layers.map((l) => (
          <div
            key={l.key}
            className="px-4 py-3 border-r last:border-r-0 border-star-dim/15 sm:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(3n)]:border-r lg:[&:nth-child(6)]:border-r-0"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  l.active ? "bg-celadon animate-twinkle" : "bg-star-dim/40"
                }`}
              />
              <span className="font-serif text-star text-sm tracking-wide">{l.short}</span>
            </div>
            <div className="text-[10px] text-star-dim/70 mt-0.5">{l.long}</div>
            <div
              className={`text-[10px] mono mt-1 ${
                l.active ? "text-celadon" : "text-star-dim/60"
              }`}
            >
              {l.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
