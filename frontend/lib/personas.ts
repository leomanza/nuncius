/// Mirror of agents/shared/personas.ts. Kept in-sync manually because cross-
/// workspace TypeScript imports add complexity disproportionate to a 5-row
/// constant.

export interface Persona {
  agentIndex: number;
  label: string;          // ENS subname label
  displayName: string;    // human-readable
  blurb: string;          // one-sentence persona quote
  glyph: string;          // path under /glyphs/
  port: number;           // local agent HTTP port
  ensSubname: string;     // full ENS subname under nuncius.eth
  starColor: string;      // tonal hue for the persona's star + accent
}

export const PERSONAS: Persona[] = [
  {
    agentIndex: 1,
    label: "pythia",
    displayName: "Pythia",
    blurb: "The Oracle weighs the auspices before pronouncing.",
    glyph: "/glyphs/pythia.svg",
    port: 4001,
    ensSubname: "pythia.nuncius.eth",
    starColor: "#d4a13c",
  },
  {
    agentIndex: 2,
    label: "ziggy",
    displayName: "Ziggy",
    blurb: "From the cosmos, transformation.",
    glyph: "/glyphs/ziggy.svg",
    port: 4002,
    ensSubname: "ziggy.nuncius.eth",
    starColor: "#fff8e7",
  },
  {
    agentIndex: 3,
    label: "capitan-beto",
    displayName: "Capitán Beto",
    blurb: "I have stared too long at the void to be fooled.",
    glyph: "/glyphs/capitan-beto.svg",
    port: 4003,
    ensSubname: "capitan-beto.nuncius.eth",
    starColor: "#7d9b76",
  },
  {
    agentIndex: 4,
    label: "hypatia",
    displayName: "Hypatia",
    blurb: "I teach all who come to the steps.",
    glyph: "/glyphs/hypatia.svg",
    port: 4004,
    ensSubname: "hypatia.nuncius.eth",
    starColor: "#4a6759",
  },
  {
    agentIndex: 5,
    label: "ada",
    displayName: "Ada",
    blurb: "Can it actually be built?",
    glyph: "/glyphs/ada.svg",
    port: 4005,
    ensSubname: "ada.nuncius.eth",
    starColor: "#a3361b",
  },
];

export function getPersonaByIndex(i: number): Persona {
  const p = PERSONAS.find((x) => x.agentIndex === i);
  if (!p) throw new Error(`No persona for agentIndex ${i}`);
  return p;
}
