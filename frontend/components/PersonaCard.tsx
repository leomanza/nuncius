"use client";

import { useState } from "react";
import type { Persona } from "@/lib/personas";
import type { AgentStatus, AgentDeliberation } from "@/lib/agents";
import { truncHex, explorerTxUrl, explorerAddrUrl } from "@/lib/format";

interface PersonaCardProps {
  persona: Persona;
  status: AgentStatus | undefined;
  deliberation: AgentDeliberation | null | undefined;
}

const STATE_LABEL: Record<AgentStatus["state"], string> = {
  idle:         "IDLE",
  deliberating: "REASONING",
  voting:       "PROVING (ZK)",
  voted:        "VOTED",
  error:        "ERROR",
};

const STATE_TONE: Record<AgentStatus["state"], string> = {
  idle:         "border-ink-soft/30 text-ink-soft",
  deliberating: "border-star-dim/60 text-ink-warm bg-star-dim/15",
  voting:       "border-ink/60 text-ink bg-paper-shade/25",
  voted:        "border-celadon/60 text-celadon bg-celadon/10",
  error:        "border-vermilion/60 text-vermilion bg-vermilion/10",
};

const ENS_BASE = "https://app.ens.domains";

export function PersonaCard({ persona, status, deliberation }: PersonaCardProps) {
  const state = status?.state ?? "idle";
  const online = status?.online ?? false;
  const tone = STATE_TONE[state];
  const label = STATE_LABEL[state];
  const [showFullReasoning, setShowFullReasoning] = useState(false);

  const reasoning = deliberation?.reasoning ?? "";
  const isLong = reasoning.length > 220;
  const visibleReasoning =
    !isLong || showFullReasoning ? reasoning : reasoning.slice(0, 220).trimEnd() + "…";

  return (
    <article
      className={`vellum rounded-sm p-5 ink-bloom transition-opacity ${
        online ? "opacity-100" : "opacity-65"
      }`}
    >
      <div className="flex items-start gap-3 relative z-10">
        <div
          className="shrink-0 w-12 h-12 flex items-center justify-center"
          style={{ color: persona.starColor }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={persona.glyph}
            alt={persona.displayName}
            className="w-12 h-12"
            style={{
              filter:
                "invert(15%) sepia(38%) saturate(640%) hue-rotate(347deg) brightness(55%)",
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-serif text-xl text-ink leading-none">
              {persona.displayName}
            </h4>
            <span
              className={`text-[9px] tracking-[0.18em] uppercase border rounded-sm px-1.5 py-0.5 shrink-0 ${tone}`}
            >
              {label}
            </span>
          </div>
          <div className="marginalia mt-1 italic">{persona.blurb}</div>
        </div>
      </div>

      {/* Identity links */}
      <div className="mt-3 pt-3 border-t border-ink-soft/20 relative z-10 space-y-2">
        <IdentityField
          label="ENS"
          value={persona.ensSubname}
          href={`${ENS_BASE}/${persona.ensSubname}?network=sepolia`}
          mono
          emphasis
        />
        {status?.walletAddress && (
          <IdentityField
            label="Wallet"
            value={truncHex(status.walletAddress, 6, 4)}
            href={explorerAddrUrl(status.walletAddress)}
            mono
          />
        )}
        {deliberation?.source && (
          <div className="text-[10px] text-ink-soft flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="tracking-[0.16em] uppercase opacity-70">Model</span>
            <span className="mono text-ink-warm">
              {deliberation.source === "0g-compute" ? "0G Compute · qwen-2.5-7b" : "Ollama · llama3.2"}
            </span>
            {deliberation.elapsedMs && (
              <span className="text-ink-soft/70">· {(deliberation.elapsedMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </div>

      {/* Decision + reasoning */}
      {deliberation && (
        <div className="mt-3 pt-3 border-t border-ink-soft/20 relative z-10">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase text-ink-soft mb-2">
            Decision
            <span
              className={`px-1.5 py-0.5 rounded-sm border ${
                deliberation.decision === "Approve"
                  ? "border-celadon/60 text-celadon"
                  : "border-vermilion/60 text-vermilion"
              }`}
            >
              {deliberation.decision}
            </span>
            <span className="text-ink-soft normal-case tracking-normal">
              · confidence {deliberation.confidence.toFixed(2)}
            </span>
          </div>
          <p className="font-serif italic text-ink-warm text-[13px] leading-snug">
            &ldquo;{visibleReasoning}&rdquo;
          </p>
          {isLong && (
            <button
              onClick={() => setShowFullReasoning((v) => !v)}
              className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-soft hover:text-ink transition-colors"
            >
              {showFullReasoning ? "show less" : "read full reasoning"}
            </button>
          )}
        </div>
      )}

      {/* Vote tx */}
      {status?.txHash && (
        <div className="mt-3 pt-3 border-t border-ink-soft/20 relative z-10">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase text-ink-soft">
            Anonymous vote tx
          </div>
          <a
            href={explorerTxUrl(status.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mono text-ink-warm hover:text-ink transition-colors underline decoration-ink-soft/40 break-all"
          >
            {truncHex(status.txHash, 14, 10)}
          </a>
        </div>
      )}
    </article>
  );
}

function IdentityField({
  label,
  value,
  href,
  mono = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  href: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] tracking-[0.18em] uppercase text-ink-soft/75">
        {label}
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`block ${mono ? "mono" : "font-serif"} ${
          emphasis ? "text-ink text-[12px]" : "text-ink-warm text-[11px]"
        } hover:text-ink underline decoration-ink-soft/40 break-all`}
      >
        {value}
      </a>
    </div>
  );
}
