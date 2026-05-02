/// Read every text record we set and assert it matches the canonical Baby
/// Jubjub pubkey derived from .env.secrets. Independent verification path:
///   resolve via app.ens.domains  ←→  what this script reads via raw RPC.

import { createPublicClient, http, namehash, parseAbi } from "viem";
import { Identity } from "../../agents/node_modules/@semaphore-protocol/identity";
import * as dotenv from "dotenv";
import * as path from "path";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { ADDRESSES, RPC_URL, CHAIN, PARENT_NAME, NETWORK, PERSONAS } from "./_addresses";

const RESOLVER_ABI = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

const TEXT_KEYS = [
  "name",
  "persona",
  "semaphore.pubkey",
  "semaphore.commitment",
  "semaphore.groupId",
  "nuncius.agentIndex",
  "nuncius.role",
  "nuncius.dao",
  "url",
  "description",
];

async function main() {
  const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const parent = PARENT_NAME.endsWith(".eth") ? PARENT_NAME : PARENT_NAME + ".eth";
  console.log(`Network: ${NETWORK}`);
  console.log(`Parent : ${parent}\n`);

  let ok = 0, mismatch = 0;
  for (const p of PERSONAS) {
    const subname = `${p.label}.${parent}`;
    const subnode = namehash(subname);
    console.log(`--- ${subname} (${p.displayName}, agent ${p.agentIndex}) ---`);

    const secret = process.env[`AGENT_${p.agentIndex}_SEMAPHORE_SECRET`]!;
    const id = new Identity(secret);
    const pk = (id as any).publicKey as [bigint, bigint];
    const expectedPubkey = "0x" + pk[0].toString(16).padStart(64, "0") + pk[1].toString(16).padStart(64, "0");
    const expectedCommit = id.commitment.toString();

    for (const key of TEXT_KEYS) {
      const value = await client.readContract({
        address: ADDRESSES.PublicResolver as `0x${string}`,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [subnode, key],
      });
      let mark = "  ";
      if (key === "semaphore.pubkey" && value !== expectedPubkey) {
        mark = "✗ "; mismatch++;
      } else if (key === "semaphore.commitment" && value !== expectedCommit) {
        mark = "✗ "; mismatch++;
      } else {
        ok++;
      }
      const display = value.length > 80 ? value.slice(0, 80) + "…" : value;
      console.log(`  ${mark}${key.padEnd(22)}: ${display}`);
    }
    console.log();
  }
  console.log(`Result: ok=${ok} mismatch=${mismatch}`);
  if (mismatch > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
