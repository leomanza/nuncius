"use client";

import { useState } from "react";
import { PlatePanel } from "./PlatePanel";

interface PoseQuestionProps {
  /// True iff there's an active proposal — disables the form.
  hasActiveProposal: boolean;
  activeId?: number;
  /// Called after a successful POST so the dashboard can refresh state.
  onPosed?: (proposalId: number) => void;
}

const PRESETS = [
  "Should the Nuncius treasury commit 50,000 USDC to a quarterly grant cycle for independent ZK research, prioritizing Semaphore V5 contributions?",
  "Should the protocol delay the v2 launch by 30 days to land an external Trail of Bits audit before mainnet?",
  "Should we allocate 200,000 USDC to subsidize gas for new voters during the next 90 days?",
  "Should the DAO accept the partnership proposal from Protocol X under the proposed revenue-share terms?",
];

export function PoseQuestion({ hasActiveProposal, activeId, onPosed }: PoseQuestionProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPosed, setLastPosed] = useState<{ id: number; tx: string | null } | null>(null);

  const disabled = hasActiveProposal || submitting;

  const submit = async () => {
    setError(null);
    if (!text.trim()) {
      setError("Write a question or pick a preset.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || data?.error || `error ${res.status}`);
        return;
      }
      setLastPosed({ id: data.proposalId, tx: data.openedTxHash });
      setText("");
      onPosed?.(data.proposalId);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PlatePanel
      plate={5}
      title="Pose a Question"
      latinTitle="Quaestionem ponere"
      caption={
        hasActiveProposal
          ? `Wait — proposal #${activeId} still open`
          : "Open a new on-chain proposal · fans out via AXL"
      }
      variant="vellum"
    >
      <div className="space-y-3 relative z-10">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            hasActiveProposal
              ? "An active proposal must resolve before posing another."
              : "Write a question for the five oracles…"
          }
          rows={3}
          maxLength={500}
          disabled={disabled}
          className="w-full px-3 py-2 bg-paper-shade/30 border border-ink-soft/30 rounded-sm
                     font-serif text-ink placeholder:text-ink-soft/60
                     focus:outline-none focus:border-ink-warm/60
                     disabled:opacity-50 disabled:cursor-not-allowed
                     resize-none"
        />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] text-ink-soft uppercase tracking-[0.14em]">
            {text.length}/500
          </div>
          <button
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="px-5 py-2 border border-ink-warm/60 text-ink hover:bg-ink-warm/10 hover:border-ink
                       transition-colors text-sm font-serif tracking-[0.18em] uppercase
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Posing…" : "Pose question"}
          </button>
        </div>

        {/* Presets */}
        {!hasActiveProposal && (
          <div className="pt-2 border-t border-ink-soft/15">
            <div className="text-[10px] tracking-[0.14em] uppercase text-ink-soft mb-1.5">
              Or pick a preset
            </div>
            <div className="space-y-1">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setText(p)}
                  disabled={submitting}
                  className="block w-full text-left text-[12px] font-serif italic text-ink-warm/85
                             hover:text-ink hover:bg-paper-shade/40 px-2 py-1 rounded-sm
                             transition-colors disabled:opacity-50"
                >
                  &ldquo;{p}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="text-[12px] text-vermilion font-serif italic">⚠ {error}</div>
        )}
        {lastPosed && (
          <div className="text-[12px] text-celadon font-serif italic">
            ✓ Proposal #{lastPosed.id} opened.{" "}
            {lastPosed.tx && (
              <a
                href={`https://chainscan-galileo.0g.ai/tx/${lastPosed.tx}`}
                target="_blank"
                rel="noreferrer"
                className="mono underline decoration-celadon/40 hover:text-celadon"
              >
                tx
              </a>
            )}{" "}
            — fanout sent to all 5 agents.
          </div>
        )}
      </div>
    </PlatePanel>
  );
}
