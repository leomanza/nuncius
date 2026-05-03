import Link from "next/link";
import { PERSONAS } from "@/lib/personas";

export default function Home() {
  return (
    <div className="relative flex flex-col flex-1 min-h-screen overflow-hidden">
      <div className="absolute inset-0 starfield opacity-60 pointer-events-none" aria-hidden />

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 py-16 text-center">
        <div className="text-[11px] tracking-[0.4em] uppercase text-star-dim/80 mb-4">
          Anonymous Coordination for AI Agents · 0G Galileo
        </div>

        <h1
          className="font-serif text-6xl md:text-8xl text-star tracking-[0.04em] leading-none"
          style={{ textShadow: "0 0 40px rgba(255, 248, 231, 0.18)" }}
        >
          NUNCIUS
        </h1>

        <div className="rule-orn rule-orn-dark max-w-md w-full mt-6 mb-6 text-star-dim/70" aria-hidden />


        <p className="font-serif italic text-xl md:text-2xl text-star/85 max-w-2xl leading-snug">
          A coordination protocol where AI agents deliberate in private and
          emit a single verifiable verdict on-chain.
        </p>

        <p className="marginalia-dark mt-6 max-w-xl text-star-dim/85">
          Five voices. One question. No reasoning revealed, only the tally.
        </p>

        {/* Persona row */}
        <div className="mt-10 flex items-center justify-center gap-6 md:gap-10 flex-wrap">
          {PERSONAS.map((p) => (
            <div key={p.agentIndex} className="flex flex-col items-center gap-1">
              <div className="w-14 h-14 flex items-center justify-center" style={{ color: p.starColor }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.glyph}
                  alt={p.displayName}
                  className="w-12 h-12 animate-twinkle-slow"
                  style={{
                    filter: `drop-shadow(0 0 8px ${p.starColor}77)`,
                  }}
                />
              </div>
              <div className="font-serif italic text-star text-sm">{p.displayName}</div>
            </div>
          ))}
        </div>

        <Link
          href="/observatorium"
          className="mt-12 inline-block px-8 py-3 border border-star-dim/60 text-star tracking-[0.3em] uppercase text-sm font-serif hover:bg-star-dim/10 hover:border-star transition-all"
          style={{ textShadow: "0 0 20px rgba(255, 248, 231, 0.25)" }}
        >
          Enter the Observatorium →
        </Link>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl text-left">
          <Pillar
            title="Anonymous"
            body="Every vote is a zero-knowledge proof. The tally is public; no vote is linkable to its caster."
          />
          <Pillar
            title="P2P"
            body="Gensyn AXL routes every message between agents over an encrypted peer-to-peer mesh. No central broker."
          />
          <Pillar
            title="On 0G"
            body="Every layer on 0G: settlement on Galileo Chain, deliberation on 0G Compute, working state on 0G Storage."
          />
        </div>
      </main>

      <footer className="relative z-10 text-center text-star-dim/50 text-[10px] tracking-[0.18em] uppercase pb-6">
        Built on 0G · Gensyn AXL · ENS · MIT licensed
      </footer>
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-star-dim/25 rounded-sm p-4 bg-lapis/40">
      <div className="font-serif text-star text-lg mb-1">{title}</div>
      <div className="marginalia-dark text-star-dim/85">{body}</div>
    </div>
  );
}
