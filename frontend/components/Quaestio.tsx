"use client";

import type { ProposalView } from "@/lib/dao";
import { PlatePanel } from "./PlatePanel";

interface QuaestioProps {
  proposal: ProposalView | null;
  totalAgents: number;
  /// Show last RESOLVED proposal when no live one (so the codex never sits empty
  /// during a demo recording).
  fallbackResolved: ProposalView | null;
}

function stripBracketTag(s: string): string {
  return s.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/^[—–\-\s"“”']+/, "");
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function moonGlyphFor(votes: number, total: number, resolved: boolean): { src: string; label: string } {
  if (resolved) return { src: "/glyphs/moon-full.svg", label: "Resolved" };
  if (total === 0 || votes === 0) return { src: "/glyphs/moon-new.svg", label: "Open" };
  const frac = votes / total;
  if (frac < 0.4) return { src: "/glyphs/moon-crescent.svg", label: "Reasoning" };
  if (frac < 0.7) return { src: "/glyphs/moon-half.svg", label: "Voting" };
  return { src: "/glyphs/moon-gibbous.svg", label: "Quorum near" };
}

export function Quaestio({ proposal, totalAgents, fallbackResolved }: QuaestioProps) {
  const live = proposal && !proposal.resolved;
  const view = proposal ?? fallbackResolved;

  if (!view) {
    return (
      <PlatePanel
        plate={2}
        title="Proposal"
        latinTitle="Quaestio"
        caption="Awaiting question"
      >
        <div className="marginalia">
          No active proposal. Pose a question below to wake the oracles.
        </div>
      </PlatePanel>
    );
  }

  const totalVotes = view.approveCount + view.rejectCount;
  const phase = moonGlyphFor(totalVotes, totalAgents || 5, view.resolved);

  return (
    <PlatePanel
      plate={2}
      title="Proposal"
      latinTitle="Quaestio"
      caption={live ? "Open" : view.resolved ? `Resolved ${view.approved ? "Approve" : "Reject"}` : "Pending"}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={phase.src}
            alt={phase.label}
            className="w-14 h-14"
            style={{
              filter:
                "invert(15%) sepia(38%) saturate(540%) hue-rotate(347deg) brightness(60%)",
            }}
          />
          <div className="text-center text-[9px] tracking-[0.2em] uppercase text-ink-soft mt-1">
            {phase.label}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink-soft mb-2">
            Proposal № {view.id}
          </div>
          <p className="drop-cap text-ink leading-snug font-serif text-[15px]">
            {capitalizeFirst(stripBracketTag(view.description))}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Tally label="Approve" count={view.approveCount} tone="celadon" />
            <Tally label="Reject"  count={view.rejectCount} tone="vermilion" />
            <Tally label="Quorum"  count={`${totalVotes} / ${totalAgents || 5}`} tone="neutral" />
          </div>

          {view.resolved && (
            <div className="mt-4 marginalia">
              {view.approved ? "Approved." : "Rejected."}{" "}
              <span className="text-ink-warm">
                {view.approveCount} for, {view.rejectCount} against.
              </span>
            </div>
          )}
        </div>
      </div>
    </PlatePanel>
  );
}

function Tally({
  label,
  count,
  tone,
}: {
  label: string;
  count: number | string;
  tone: "celadon" | "vermilion" | "neutral";
}) {
  const palette =
    tone === "celadon"
      ? "border-celadon/40 text-celadon"
      : tone === "vermilion"
      ? "border-vermilion/40 text-vermilion"
      : "border-ink-soft/30 text-ink-warm";
  return (
    <div className={`border rounded-sm py-2 ${palette}`}>
      <div className="text-2xl font-serif tabular-nums">{count}</div>
      <div className="text-[9px] tracking-[0.18em] uppercase opacity-80">
        {label}
      </div>
    </div>
  );
}
