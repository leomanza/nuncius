"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/use-polling";
import { fetchAllAgentStatuses, fetchAgentDeliberation, type AgentStatus, type AgentDeliberation } from "@/lib/agents";
import {
  fetchCurrentProposal,
  fetchLastProposalSnapshot,
  fetchRecentEvents,
  DAO_ADDRESS,
  type ProposalView,
  type ProposalResolvedEvent,
  type ProposalOpenedEvent,
  type ProofVerifiedEvent,
} from "@/lib/dao";
import { PERSONAS } from "@/lib/personas";
import { truncHex, explorerAddrUrl } from "@/lib/format";
import { Constellatio } from "@/components/Constellatio";
import { Quaestio } from "@/components/Quaestio";
import { PersonaCard } from "@/components/PersonaCard";
import { Ephemeris } from "@/components/Ephemeris";
import { Verdict } from "@/components/Verdict";
import { PlatePanel } from "@/components/PlatePanel";
import { StackBanner } from "@/components/StackBanner";
import { PoseQuestion } from "@/components/PoseQuestion";

export default function ObservatoriumPage() {
  // Live data
  const statusesFetch = useCallback(async () => fetchAllAgentStatuses(), []);
  const proposalFetch = useCallback(async () => fetchCurrentProposal(), []);
  const lastResolvedFetch = useCallback(async () => fetchLastProposalSnapshot(), []);
  const eventsFetch = useCallback(async () => fetchRecentEvents(200_000), []);

  const { data: statuses } = usePolling<AgentStatus[]>(statusesFetch, 1000);
  const { data: liveProposal } = usePolling<ProposalView | null>(proposalFetch, 3000);
  const { data: lastSnapshot } = usePolling<ProposalView | null>(lastResolvedFetch, 5000);
  const { data: events } = usePolling(eventsFetch, 5000);

  // Per-agent deliberations — poll lightly
  const [deliberations, setDeliberations] = useState<Record<number, AgentDeliberation | null>>({});
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next: Record<number, AgentDeliberation | null> = {};
      for (const p of PERSONAS) {
        next[p.agentIndex] = await fetchAgentDeliberation(p.agentIndex);
        if (!active) return;
      }
      if (active) setDeliberations(next);
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Verdict overlay — auto-show ONLY for resolutions that are recent
  // (within ~5 minutes / 100 blocks on Galileo). Stale resolutions from
  // earlier sessions sit quietly in the Ephemeris log instead.
  const VERDICT_RECENT_BLOCKS = 100;
  const [dismissedResolutionTxs, setDismissedResolutionTxs] = useState<Set<string>>(new Set());

  const latestResolution = useMemo<ProposalResolvedEvent | null>(() => {
    const r = events?.resolved ?? [];
    if (r.length === 0) return null;
    return [...r].sort((a, b) => b.blockNumber - a.blockNumber)[0];
  }, [events]);

  const liveOverlay = useMemo(() => {
    if (!latestResolution || !events) return null;
    if (dismissedResolutionTxs.has(latestResolution.txHash)) return null;
    const blocksAgo = events.head - latestResolution.blockNumber;
    if (blocksAgo > VERDICT_RECENT_BLOCKS) return null;
    return latestResolution;
  }, [latestResolution, dismissedResolutionTxs, events]);

  const total = PERSONAS.length;
  const onlineCount = (statuses ?? []).filter((s) => s.online).length;
  const verifiedFor: ProofVerifiedEvent[] = events?.verified ?? [];
  const openedFor: ProposalOpenedEvent[] = events?.opened ?? [];
  const resolvedFor: ProposalResolvedEvent[] = events?.resolved ?? [];

  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 starfield opacity-40 pointer-events-none" aria-hidden />
      <div className="relative z-10 px-6 lg:px-10 py-8 max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <Link href="/" className="font-serif text-3xl tracking-[0.18em] text-star block hover:text-star-dim transition-colors">
              NUNCIUS
            </Link>
            <div className="marginalia-dark mt-1 text-star-dim/85">
              Observatorium · live demo
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] tracking-[0.2em] uppercase text-star-dim/80">
              0G Galileo · chainId 16602
            </div>
            <a
              href={explorerAddrUrl(DAO_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="mono text-star-dim/90 hover:text-star transition-colors underline decoration-star-dim/40"
            >
              DAO {truncHex(DAO_ADDRESS, 8, 6)}
            </a>
            <div className="mt-1 text-[10px] text-star-dim/70 tracking-[0.14em] uppercase">
              {onlineCount} of {total} oracles online
            </div>
          </div>
        </header>

        {/* Stack banner: every sponsor layer + activity indicator */}
        <div className="mb-6">
          <StackBanner statuses={statuses ?? []} proposal={liveProposal ?? null} events={events ?? null} />
        </div>

        {/* Top row: Constellatio | Quaestio | Ephemeris */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
          <div className="lg:col-span-4 animate-fade-rise">
            <Constellatio statuses={statuses ?? []} />
          </div>
          <div className="lg:col-span-5 animate-fade-rise delay-1">
            <Quaestio
              proposal={liveProposal ?? null}
              totalAgents={total}
              fallbackResolved={lastSnapshot ?? null}
            />
          </div>
          <div className="lg:col-span-3 animate-fade-rise delay-2">
            <Ephemeris
              opened={openedFor}
              verified={verifiedFor}
              resolved={resolvedFor}
            />
          </div>
        </div>

        {/* Pose a question */}
        <div className="mb-6 animate-fade-rise delay-3">
          <PoseQuestion
            hasActiveProposal={!!liveProposal && !liveProposal.resolved}
            activeId={liveProposal?.id}
          />
        </div>

        {/* Voces — 5 persona cards */}
        <PlatePanel
          plate={4}
          title="The Five Agents"
          latinTitle="Voces"
          caption="Reasoning · proofs · identity"
          variant="vellum"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
            {PERSONAS.map((p, i) => {
              const status = (statuses ?? []).find((s) => s.agentIndex === p.agentIndex);
              const deliberation = deliberations[p.agentIndex] ?? null;
              return (
                <div key={p.agentIndex} className={`animate-fade-rise delay-${i + 1}`}>
                  <PersonaCard
                    persona={p}
                    status={status}
                    deliberation={deliberation}
                  />
                </div>
              );
            })}
          </div>
        </PlatePanel>

        <footer className="mt-10 mb-6 text-center text-star-dim/60 text-xs tracking-[0.18em] uppercase">
          ZK proofs settle on 0G Galileo · ENS subnames live on Sepolia
        </footer>
      </div>

      {liveOverlay && (
        <Verdict
          resolution={liveOverlay}
          onDismiss={() => {
            setDismissedResolutionTxs((s) => {
              const next = new Set(s);
              next.add(liveOverlay.txHash);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
