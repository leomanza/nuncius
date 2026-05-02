"use client";

import { ReactNode } from "react";
import { toRoman } from "@/lib/format";

interface PlatePanelProps {
  plate: number;
  /// English-first title — the primary read.
  title: string;
  /// Small italic Latin / scholarly subtitle (e.g. "Quaestio").
  latinTitle?: string;
  /// Right-side caption ("Open question", "Last 30 events", ...).
  caption?: string;
  /// "vellum" = paper-coloured codex card; "lapis" = night-sky inset.
  variant?: "vellum" | "lapis";
  className?: string;
  children: ReactNode;
}

export function PlatePanel({
  plate,
  title,
  latinTitle,
  caption,
  variant = "vellum",
  className = "",
  children,
}: PlatePanelProps) {
  const isVellum = variant === "vellum";
  return (
    <section
      className={`relative rounded-sm overflow-hidden ${isVellum ? "vellum" : ""} ${
        !isVellum ? "border border-star-dim/30 bg-lapis-deep/60" : ""
      } ${className}`}
    >
      <header className="flex items-baseline justify-between px-5 pt-4 relative z-10 gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className={`plate ${isVellum ? "" : "plate-dark"} shrink-0`}>
            Tab. {toRoman(plate)}
          </span>
          {latinTitle && (
            <span
              className={`font-serif italic text-xs ${
                isVellum ? "text-ink-soft" : "text-star-dim/70"
              }`}
            >
              · {latinTitle}
            </span>
          )}
        </div>
        {caption && (
          <span
            className={`text-[10px] tracking-[0.16em] uppercase shrink-0 ${
              isVellum ? "text-ink-soft" : "text-star-dim/80"
            }`}
          >
            {caption}
          </span>
        )}
      </header>
      <h3
        className={`px-5 pb-2 text-xl font-serif tracking-wide ${
          isVellum ? "text-ink" : "text-star"
        } relative z-10`}
      >
        {title}
      </h3>
      <div
        className={`mx-5 mb-3 rule-orn ${isVellum ? "" : "rule-orn-dark"}`}
        aria-hidden
      />
      <div className={`px-5 pb-5 relative z-10 ${isVellum ? "text-ink-warm" : "text-star/90"}`}>
        {children}
      </div>
    </section>
  );
}
