import { sepolia, mainnet } from "viem/chains";

export type Net = "sepolia" | "mainnet";

export const NETWORK: Net = (process.env.ENS_NETWORK as Net) || "sepolia";

export const RPC_URL: string = process.env.ENS_RPC_URL ||
  (NETWORK === "mainnet" ? "https://eth.llamarpc.com" : "https://ethereum-sepolia.publicnode.com");

export const CHAIN = NETWORK === "mainnet" ? mainnet : sepolia;

// Verified by `cast code ${addr} --rpc-url ${RPC_URL}` returning non-empty
// bytecode 2026-04-30.
export const ADDRESSES = NETWORK === "mainnet"
  ? {
      ENSRegistry:            "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
      NameWrapper:            "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401",
      PublicResolver:         "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63",
      ETHRegistrarController: "0x253553366Da8546fC250F225fe3d25d0C782303b",
    }
  : {
      ENSRegistry:            "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
      NameWrapper:            "0x0635513f179D50A207757E05759CbD106d7dFcE8",
      PublicResolver:         "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD",
      ETHRegistrarController: "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72",
    };

export const PARENT_NAME = process.env.ENS_PARENT_NAME || "nuncius.eth";

/// Agent personas — subname label ↔ display name ↔ persona ↔ agent index.
/// agentIndex MUST match the on-chain DisputeDAO group ordering (see Session 4).
/// Display names live in the ENS `name` text record; subname labels are ASCII.
export const PERSONAS: Array<{
  agentIndex: number;
  label: string;
  displayName: string;
  persona: string;
}> = [
  { agentIndex: 1, label: "pythia",       displayName: "Pythia",       persona: "Fiscal conservative analyst — careful, deliberative, demands clear ROI" },
  { agentIndex: 2, label: "ziggy",        displayName: "Ziggy",        persona: "Innovation advocate — embraces transformative bets, comfortable with uncertainty" },
  { agentIndex: 3, label: "capitan-beto", displayName: "Capitán Beto", persona: "Risk manager — Spinetta's lone astronaut who knows the void; weighs downside" },
  { agentIndex: 4, label: "hypatia",      displayName: "Hypatia",      persona: "Community advocate — Alexandrian polymath; prioritizes the broadest stakeholder set" },
  { agentIndex: 5, label: "ada",          displayName: "Ada",          persona: "Technical reviewer — Lovelace; assesses feasibility and implementation quality" },
];
