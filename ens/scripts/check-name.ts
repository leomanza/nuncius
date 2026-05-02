/// Check whether the parent ENS name is available for registration on the
/// active network. Reports rent price for 1 year if available, or current
/// owner if already taken. Idempotent — safe to re-run.

import { createPublicClient, http, namehash } from "viem";
import * as dotenv from "dotenv";
import * as path from "path";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { ADDRESSES, RPC_URL, CHAIN, PARENT_NAME, NETWORK } from "./_addresses";

const REGISTRAR_CONTROLLER_ABI = [
  { type: "function", stateMutability: "view", name: "available", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", stateMutability: "view", name: "rentPrice",
    inputs: [{ name: "name", type: "string" }, { name: "duration", type: "uint256" }],
    outputs: [{ name: "price", type: "tuple", components: [{ name: "base", type: "uint256" }, { name: "premium", type: "uint256" }] }] },
  { type: "function", stateMutability: "view", name: "minCommitmentAge", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "maxCommitmentAge", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const REGISTRY_ABI = [
  { type: "function", stateMutability: "view", name: "owner", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

async function main() {
  const label = PARENT_NAME.endsWith(".eth") ? PARENT_NAME.slice(0, -".eth".length) : PARENT_NAME;
  const fullName = label + ".eth";

  const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  console.log(`Network: ${NETWORK}`);
  console.log(`Name   : ${fullName}`);

  const owner = await client.readContract({
    address: ADDRESSES.ENSRegistry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [namehash(fullName)],
  });
  console.log(`Registry.owner    : ${owner}`);

  const available = await client.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: REGISTRAR_CONTROLLER_ABI,
    functionName: "available",
    args: [label],
  });
  console.log(`available()       : ${available}`);

  if (available) {
    const oneYear = 365n * 24n * 60n * 60n;
    const price = await client.readContract({
      address: ADDRESSES.ETHRegistrarController as `0x${string}`,
      abi: REGISTRAR_CONTROLLER_ABI,
      functionName: "rentPrice",
      args: [label, oneYear],
    }) as { base: bigint; premium: bigint };
    const total = price.base + price.premium;
    console.log(`rentPrice (1 yr)  : ${total} wei (base=${price.base}, premium=${price.premium})`);
  }

  const minAge = await client.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: REGISTRAR_CONTROLLER_ABI,
    functionName: "minCommitmentAge",
  });
  const maxAge = await client.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: REGISTRAR_CONTROLLER_ABI,
    functionName: "maxCommitmentAge",
  });
  console.log(`commitment window : ${minAge}s … ${maxAge}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
