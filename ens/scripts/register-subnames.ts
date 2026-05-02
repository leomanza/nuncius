/// Register persona subnames under the parent ENS name. Each persona maps to
/// one of the 5 deterministic Semaphore identities registered in DisputeDAO
/// group id 1 (see ens/scripts/_addresses.ts PERSONAS).
///
/// Subname labels are ASCII (pythia, ziggy, capitan-beto, hypatia, ada).
/// Display names with accents/spaces live in the `name` text record.
///
/// Pattern (NameWrapper for .eth subnames):
///   1. NameWrapper.setSubnodeRecord(parentNode, label, owner, resolver, ttl, fuses, expiry)
///   2. PublicResolver.setText(subnode, key, value) for each record:
///        - name              (display name with accents/spaces)
///        - persona           (one-line persona description)
///        - semaphore.pubkey  (Baby Jubjub public key, 0x + 128 hex)
///        - semaphore.commitment  (Identity commitment, decimal)
///        - semaphore.groupId
///        - nuncius.agentIndex
///        - nuncius.role     ("voter")
///        - nuncius.dao      (DisputeDAO address on Galileo — cross-chain pointer)
///        - url
///        - description

import { createPublicClient, createWalletClient, http, namehash, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Identity } from "../../agents/node_modules/@semaphore-protocol/identity";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { ADDRESSES, RPC_URL, CHAIN, PARENT_NAME, NETWORK, PERSONAS } from "./_addresses";

const NAME_WRAPPER_ABI = parseAbi([
  "function ownerOf(uint256 id) view returns (address)",
  "function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)",
]);

const RESOLVER_ABI = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
  "function setText(bytes32 node, string key, string value)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
  const pk = process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

  const parentName = PARENT_NAME.endsWith(".eth") ? PARENT_NAME : PARENT_NAME + ".eth";
  const parentNode = namehash(parentName);
  console.log(`Network    : ${NETWORK}`);
  console.log(`Parent     : ${parentName}`);
  console.log(`Owner      : ${account.address}`);

  const wrappedOwner = await publicClient.readContract({
    address: ADDRESSES.NameWrapper as `0x${string}`,
    abi: NAME_WRAPPER_ABI,
    functionName: "ownerOf",
    args: [BigInt(parentNode)],
  });
  if (wrappedOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`NameWrapper.ownerOf(${parentName}) = ${wrappedOwner}, deployer = ${account.address}`);
  }
  console.log(`Parent NFT owner: ${wrappedOwner} ✓\n`);

  const groupId = process.env.DISPUTE_DAO_GROUP_ID || "1";
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS || "";

  const results: any[] = [];

  for (const p of PERSONAS) {
    const subname = `${p.label}.${parentName}`;
    const subnode = namehash(subname);

    const semaphoreSecret = process.env[`AGENT_${p.agentIndex}_SEMAPHORE_SECRET`];
    if (!semaphoreSecret) throw new Error(`AGENT_${p.agentIndex}_SEMAPHORE_SECRET missing`);
    const id = new Identity(semaphoreSecret);
    const pkPair = (id as any).publicKey as [bigint, bigint];
    const babyJubjubHex = "0x" + pkPair[0].toString(16).padStart(64, "0") + pkPair[1].toString(16).padStart(64, "0");
    const commitment = id.commitment.toString();

    console.log(`=== ${subname} (${p.displayName}, agent ${p.agentIndex}) ===`);

    // Step 1: ensure subname exists with PublicResolver attached (idempotent).
    let subnodeWrapped: string | null = null;
    try {
      subnodeWrapped = await publicClient.readContract({
        address: ADDRESSES.NameWrapper as `0x${string}`,
        abi: NAME_WRAPPER_ABI,
        functionName: "ownerOf",
        args: [BigInt(subnode)],
      });
    } catch { subnodeWrapped = null; }

    let subnodeTx: `0x${string}` | "skipped" = "skipped";
    if (!subnodeWrapped || subnodeWrapped === "0x0000000000000000000000000000000000000000") {
      console.log(`  setSubnodeRecord(${p.label}) ...`);
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
      const tx = await wallet.writeContract({
        address: ADDRESSES.NameWrapper as `0x${string}`,
        abi: NAME_WRAPPER_ABI,
        functionName: "setSubnodeRecord",
        args: [parentNode, p.label, account.address, ADDRESSES.PublicResolver as `0x${string}`, 0n, 0, expiry],
      });
      console.log(`    tx ${tx}`);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      subnodeTx = tx;
      console.log(`    confirmed ✓`);
    } else {
      console.log(`  ${subname} already exists — skipping create`);
    }

    // Step 2: setText records (idempotent — skip if already current).
    const records: Record<string, string> = {
      "name":                  p.displayName,
      "persona":               p.persona,
      "semaphore.pubkey":      babyJubjubHex,
      "semaphore.commitment":  commitment,
      "semaphore.groupId":     groupId,
      "nuncius.agentIndex":    String(p.agentIndex),
      "nuncius.role":          "voter",
      "nuncius.dao":           daoAddress,
      "url":                   "https://github.com/manzanal/delibera-on-0g",
      "description":           `Nuncius anonymous voter — ${p.displayName} — anonymous DAO governance via Semaphore V4 on 0G Galileo`,
    };
    const textTxs: Record<string, string> = {};
    for (const [key, value] of Object.entries(records)) {
      const current = await publicClient.readContract({
        address: ADDRESSES.PublicResolver as `0x${string}`,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [subnode, key],
      });
      if (current === value) {
        console.log(`  text(${key}) already set ✓`);
        continue;
      }
      const display = value.length > 40 ? value.slice(0, 40) + "…" : value;
      console.log(`  setText(${key}) = ${display}`);
      const tx = await wallet.writeContract({
        address: ADDRESSES.PublicResolver as `0x${string}`,
        abi: RESOLVER_ABI,
        functionName: "setText",
        args: [subnode, key, value],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      textTxs[key] = tx;
    }

    results.push({
      agentIndex: p.agentIndex,
      label: p.label,
      displayName: p.displayName,
      persona: p.persona,
      subname,
      namehash: subnode,
      babyJubjubHex,
      commitment,
      subnodeRecordTx: subnodeTx,
      textTxs,
      appUrl: `https://app.ens.domains/${subname}?network=${NETWORK}`,
    });
  }

  const outPath = path.join(REPO_ROOT, "logs", "ens-nuncius-subnames.json");
  fs.writeFileSync(outPath, JSON.stringify({
    network: NETWORK,
    parent: parentName,
    agents: results,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(`\nSummary: ${path.relative(REPO_ROOT, outPath)}\n`);
  for (const r of results) console.log(`  ${r.subname.padEnd(28)} → ${r.displayName.padEnd(14)} → ${r.appUrl}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
