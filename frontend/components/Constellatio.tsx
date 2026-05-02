"use client";

import { PERSONAS } from "@/lib/personas";
import type { AgentStatus } from "@/lib/agents";
import { PlatePanel } from "./PlatePanel";

interface ConstellatioProps {
  statuses: AgentStatus[];
}

const STATE_TONE: Record<AgentStatus["state"], { fill: string; ring: string; pulse: boolean; label: string }> = {
  idle:         { fill: "#5a6a85", ring: "rgba(212, 161, 60, 0.15)", pulse: false, label: "Idle" },
  deliberating: { fill: "#d4a13c", ring: "rgba(212, 161, 60, 0.55)", pulse: true,  label: "Reasoning" },
  voting:       { fill: "#fff8e7", ring: "rgba(255, 248, 231, 0.7)", pulse: true,  label: "Proving" },
  voted:        { fill: "#7d9b76", ring: "rgba(125, 155, 118, 0.55)", pulse: false, label: "Voted" },
  error:        { fill: "#a3361b", ring: "rgba(163, 54, 27, 0.5)", pulse: false,  label: "Error" },
};

export function Constellatio({ statuses }: ConstellatioProps) {
  // Pentagon vertex coordinates in a 320×260 viewBox. Top vertex at (160, 30).
  const W = 320;
  const H = 260;
  const cx = W / 2;
  const cy = H / 2 + 8;
  const r = 92;
  const points = PERSONAS.map((p, i) => {
    const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    return {
      persona: p,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  // Line activity = at least one endpoint is active (deliberating/voting).
  const stateOf = (idx: number) =>
    statuses.find((s) => s.agentIndex === idx)?.state ?? "idle";
  const isActive = (idx: number) => {
    const s = stateOf(idx);
    return s === "deliberating" || s === "voting";
  };

  return (
    <PlatePanel
      plate={1}
      title="Oracle Network"
      latinTitle="Constellatio"
      caption="P2P mesh · 5 nodes"
      variant="lapis"
    >
      <div className="flex flex-col items-center gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[420px]" aria-label="Persona constellation">
          {/* connecting lines (full mesh, fade in when endpoints are active) */}
          <g stroke="currentColor" strokeWidth={0.7} className="text-star-dim">
            {points.map((p, i) =>
              points.slice(i + 1).map((q, j) => {
                const k = i + j + 1;
                const active =
                  isActive(p.persona.agentIndex) || isActive(q.persona.agentIndex);
                return (
                  <line
                    key={`${i}-${k}`}
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    strokeOpacity={active ? 0.45 : 0.12}
                    className={active ? "animate-constellation" : ""}
                  />
                );
              }),
            )}
          </g>

          {/* stars + halos */}
          {points.map(({ persona, x, y }) => {
            const state = stateOf(persona.agentIndex);
            const tone = STATE_TONE[state];
            const status = statuses.find((s) => s.agentIndex === persona.agentIndex);
            return (
              <g key={persona.agentIndex}>
                {/* halo ring */}
                <circle
                  cx={x}
                  cy={y}
                  r={14}
                  fill="none"
                  stroke={tone.ring}
                  strokeWidth={1.2}
                  className={tone.pulse ? "animate-twinkle" : ""}
                />
                {/* star core */}
                <circle
                  cx={x}
                  cy={y}
                  r={5}
                  fill={tone.fill}
                  className={tone.pulse ? "animate-twinkle-slow" : ""}
                />
                {/* glyph icon — SVG <image> handles a remote SVG cleanly */}
                <image
                  href={persona.glyph}
                  x={x - 16}
                  y={y - 50}
                  width={32}
                  height={32}
                  opacity={status?.online === false ? 0.45 : 1}
                  style={{
                    filter: `drop-shadow(0 0 4px ${persona.starColor}cc)`,
                    color: persona.starColor,
                  }}
                />
                {/* label below */}
                <text
                  x={x}
                  y={y + 28}
                  textAnchor="middle"
                  fontFamily="var(--font-serif)"
                  fontSize="13"
                  fill="var(--star)"
                  fillOpacity={status?.online === false ? 0.4 : 0.95}
                  fontStyle="italic"
                >
                  {persona.displayName}
                </text>
              </g>
            );
          })}
        </svg>

        {/* legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-[10px] tracking-[0.12em] uppercase text-star-dim/80">
          {(["idle", "deliberating", "voting", "voted", "error"] as const).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: STATE_TONE[s].fill }}
              />
              {STATE_TONE[s].label}
            </div>
          ))}
        </div>
      </div>
    </PlatePanel>
  );
}
