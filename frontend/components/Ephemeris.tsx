"use client";

import type {
  ProofVerifiedEvent,
  ProposalOpenedEvent,
  ProposalResolvedEvent,
} from "@/lib/dao";
import { truncHex, explorerTxUrl } from "@/lib/format";
import { PlatePanel } from "./PlatePanel";

interface EphemerisProps {
  opened: ProposalOpenedEvent[];
  verified: ProofVerifiedEvent[];
  resolved: ProposalResolvedEvent[];
}

type Entry =
  | { kind: "opened"; data: ProposalOpenedEvent }
  | { kind: "verified"; data: ProofVerifiedEvent }
  | { kind: "resolved"; data: ProposalResolvedEvent };

function entryKey(e: Entry): string {
  return `${e.kind}:${e.data.txHash}:${(e.data as any).nullifier ?? ""}`;
}

export function Ephemeris({ opened, verified, resolved }: EphemerisProps) {
  const entries: Entry[] = [
    ...opened.map((d) => ({ kind: "opened", data: d } as Entry)),
    ...verified.map((d) => ({ kind: "verified", data: d } as Entry)),
    ...resolved.map((d) => ({ kind: "resolved", data: d } as Entry)),
  ].sort((a, b) => b.data.blockNumber - a.data.blockNumber);

  return (
    <PlatePanel
      plate={3}
      title="On-chain Log"
      latinTitle="Ephemeris"
      caption="Galileo events"
      variant="lapis"
    >
      {entries.length === 0 ? (
        <div className="marginalia-dark text-center py-8">
          No events yet. Pose a question to start the swarm.
        </div>
      ) : (
        <ol className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
          {entries.slice(0, 30).map((e) => (
            <li key={entryKey(e)} className="animate-fade-rise">
              <EntryRow entry={e} />
            </li>
          ))}
        </ol>
      )}
    </PlatePanel>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === "verified") {
    const v = entry.data;
    const isApprove = v.signal === 1;
    const tone = isApprove ? "text-celadon" : "text-vermilion";
    return (
      <div className="flex items-start gap-3">
        <ReticleIcon className={`w-5 h-5 shrink-0 mt-0.5 ${tone} animate-quill`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[10px] tracking-[0.18em] uppercase ${tone}`}>
              {isApprove ? "Approve" : "Reject"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-star-dim/70">
              ZK proof verified
            </span>
            <span className="text-[10px] text-star-dim/60">
              prop #{v.proposalId} · block {v.blockNumber}
            </span>
          </div>
          <div className="mono text-star/70 truncate">
            nullifier {truncHex(v.nullifier, 10, 6)}
          </div>
          <a
            href={explorerTxUrl(v.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mono text-star-dim/70 hover:text-star transition-colors underline decoration-star-dim/30 truncate block"
          >
            tx {truncHex(v.txHash, 10, 6)}
          </a>
        </div>
      </div>
    );
  }

  if (entry.kind === "opened") {
    const v = entry.data;
    return (
      <div className="flex items-start gap-3">
        <CrescentIcon className="w-5 h-5 shrink-0 mt-0.5 text-star-dim animate-twinkle-slow" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] tracking-[0.18em] uppercase text-star-dim">
              Proposal opened
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-star-dim/70">
              #{v.proposalId} · block {v.blockNumber}
            </span>
          </div>
          <p className="text-[12px] text-star/85 italic line-clamp-2">
            &ldquo;{v.description}&rdquo;
          </p>
          <a
            href={explorerTxUrl(v.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mono text-star-dim/70 hover:text-star underline decoration-star-dim/30 truncate block"
          >
            tx {truncHex(v.txHash, 10, 6)}
          </a>
        </div>
      </div>
    );
  }

  // resolved
  const v = entry.data;
  const tone = v.approved ? "text-celadon" : "text-vermilion";
  return (
    <div className="flex items-start gap-3">
      <FullMoonIcon className={`w-5 h-5 shrink-0 mt-0.5 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-[10px] tracking-[0.18em] uppercase ${tone}`}>
            {v.approved ? "Resolved · Approved" : "Resolved · Rejected"}
          </span>
          <span className="text-[10px] text-star-dim/60">
            #{v.proposalId} · block {v.blockNumber}
          </span>
        </div>
        <div className="text-[12px] text-star/80">
          {v.approveCount} for, {v.rejectCount} against
        </div>
        <a
          href={explorerTxUrl(v.txHash)}
          target="_blank"
          rel="noreferrer"
          className="mono text-star-dim/70 hover:text-star underline decoration-star-dim/30 truncate block"
        >
          tx {truncHex(v.txHash, 10, 6)}
        </a>
      </div>
    </div>
  );
}

/// Inline tiny SVGs so we don't fetch on every render.
function ReticleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      className={className}
    >
      <circle cx="16" cy="16" r="11" />
      <circle cx="16" cy="16" r="5" />
      <path d="M16 1 L16 8 M16 24 L16 31 M1 16 L8 16 M24 16 L31 16" />
      <circle cx="16" cy="16" r="0.8" fill="currentColor" />
    </svg>
  );
}

function CrescentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      className={className}
    >
      <circle cx="16" cy="16" r="11" />
      <path
        d="M22 16 a11 11 0 1 1 -8 -10 a8 8 0 1 0 8 10 z"
        fill="currentColor"
        fillOpacity={0.7}
        stroke="none"
      />
    </svg>
  );
}

function FullMoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      className={className}
    >
      <circle cx="16" cy="16" r="11" fill="currentColor" fillOpacity={0.85} />
    </svg>
  );
}
