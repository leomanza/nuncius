"use client";

import type { ProposalResolvedEvent } from "@/lib/dao";
import { explorerTxUrl, truncHex } from "@/lib/format";

interface VerdictProps {
  resolution: ProposalResolvedEvent | null;
  onDismiss: () => void;
}

export function Verdict({ resolution, onDismiss }: VerdictProps) {
  if (!resolution) return null;
  const approved = resolution.approved;
  const capital = approved ? "A" : "R";
  const headline = approved ? "APPROVED" : "REJECTED";
  const flourish = approved ? "Approbatur" : "Reprobatur";
  const tone = approved ? "celadon" : "vermilion";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-lapis-deep/85 backdrop-blur-sm animate-fade-rise"
        aria-hidden
      />
      {/* sepia ink wash circle behind the capital */}
      <div
        className={`absolute w-[600px] h-[600px] rounded-full pointer-events-none animate-ink-wash ${
          tone === "celadon" ? "bg-celadon/20" : "bg-vermilion/20"
        }`}
        style={{
          filter: "blur(40px)",
        }}
        aria-hidden
      />

      <div
        className="relative z-10 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center animate-capital">
          <div
            className={`font-serif leading-none select-none ${
              tone === "celadon" ? "text-celadon" : "text-vermilion"
            }`}
            style={{ fontSize: "14rem", textShadow: "0 4px 16px rgba(0,0,0,0.6)" }}
          >
            {capital}
          </div>
          <div
            className="font-serif text-3xl tracking-[0.4em] text-star mt-2"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}
          >
            {headline}
          </div>
          <div className="marginalia-dark text-star-dim/70 mt-2 text-sm font-serif italic tracking-[0.2em]">
            {flourish}
          </div>
          <div className="mt-6 text-star-dim text-sm font-serif italic">
            Proposal № {resolution.proposalId} resolved {resolution.approveCount} ·{" "}
            {resolution.rejectCount}
          </div>
          <a
            href={explorerTxUrl(resolution.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mono text-star-dim/80 hover:text-star inline-block mt-3 underline decoration-star-dim/40"
          >
            block {resolution.blockNumber} · tx {truncHex(resolution.txHash, 8, 6)}
          </a>
          <div className="mt-6">
            <button
              onClick={onDismiss}
              className="text-[11px] tracking-[0.2em] uppercase text-star-dim/70 hover:text-star border border-star-dim/40 hover:border-star px-4 py-2 rounded-sm transition-colors"
            >
              Close the codex
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
