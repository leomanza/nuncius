/// One-shot setup for Session 4:
///   1. Generate 5 fresh ethereum wallets (one per agent) and fund each
///      with 0.1 OG from the deployer wallet. Each agent submits its own
///      anonymous vote tx, so the on-chain tx-graph cannot be used to
///      link an agent's known address back to a specific vote.
///   2. Pin the deterministic Semaphore secrets we used in Session 2's
///      full-e2e.ts (the same identities the contract registered) so
///      proof generation in Session 4 matches the on-chain group.
///   3. Compute Baby Jubjub public keys for each identity (Session 5
///      ENS text records).
///   4. Append everything to .env.secrets idempotently.
///
/// Idempotent: re-runs detect existing AGENT_{i}_PRIVATE_KEY and skip
/// regeneration / re-funding.

import { ethers } from "ethers";
import { Identity } from "@semaphore-protocol/identity";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

const SECRETS_PATH = path.join(REPO_ROOT, ".env.secrets");
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const FUND_AMOUNT_OG = 0.1; // ~50 vote txs of headroom per agent

const AGENT_LABELS = [1, 2, 3, 4, 5];
const SEMAPHORE_SEED_PREFIX = "zkswarm-e2e-agent-"; // matches Session 2 full-e2e.ts

function appendIfMissing(lines: string[]) {
  const existing = fs.existsSync(SECRETS_PATH) ? fs.readFileSync(SECRETS_PATH, "utf-8") : "";
  const out: string[] = [];
  for (const line of lines) {
    const key = line.split("=")[0];
    if (!new RegExp(`^${key}=`, "m").test(existing)) out.push(line);
  }
  if (out.length === 0) return false;
  fs.appendFileSync(SECRETS_PATH, "\n" + out.join("\n") + "\n");
  fs.chmodSync(SECRETS_PATH, 0o600);
  return true;
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing — cannot fund agent wallets");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(await provider.getBalance(deployer.address)), "OG");

  const records: Array<{
    index: number;
    walletAddress: string;
    walletPrivateKey: string;
    semaphoreSecret: string;
    commitment: string;
    babyJubjubHex: string;
    funded: { txHash: string; amountOG: number } | null;
  }> = [];

  // ── Wallets + Semaphore identities + pubkeys ──────────────────────
  const lines: string[] = [];
  for (const i of AGENT_LABELS) {
    const existingPk = process.env[`AGENT_${i}_PRIVATE_KEY`];
    let walletKey: string;
    let walletAddress: string;
    if (existingPk) {
      walletKey = existingPk;
      walletAddress = new ethers.Wallet(walletKey).address;
      console.log(`agent ${i}: reusing existing wallet ${walletAddress}`);
    } else {
      const w = ethers.Wallet.createRandom();
      walletKey = w.privateKey;
      walletAddress = w.address;
      console.log(`agent ${i}: new wallet ${walletAddress}`);
      lines.push(`AGENT_${i}_PRIVATE_KEY=${walletKey}`);
      lines.push(`AGENT_${i}_ADDRESS=${walletAddress}`);
    }

    const semaphoreSecret = process.env[`AGENT_${i}_SEMAPHORE_SECRET`] || `${SEMAPHORE_SEED_PREFIX}${i}`;
    if (!process.env[`AGENT_${i}_SEMAPHORE_SECRET`]) {
      lines.push(`AGENT_${i}_SEMAPHORE_SECRET=${semaphoreSecret}`);
    }
    const id = new Identity(semaphoreSecret);
    const commitment = id.commitment.toString();

    // Baby Jubjub public key — V4 Identity exposes `publicKey` as [bigint, bigint]
    const pk = (id as any).publicKey as [bigint, bigint] | undefined;
    let babyJubjubHex = "";
    if (Array.isArray(pk) && pk.length === 2) {
      const [pkX, pkY] = pk;
      babyJubjubHex = "0x" + pkX.toString(16).padStart(64, "0") + pkY.toString(16).padStart(64, "0");
    } else {
      console.warn(`agent ${i}: WARNING Identity.publicKey shape unexpected (${typeof pk}); ENS pubkey not derivable from this Identity instance`);
    }
    if (babyJubjubHex && !process.env[`AGENT_${i}_BABYJUBJUB_PUBKEY`]) {
      lines.push(`AGENT_${i}_BABYJUBJUB_PUBKEY=${babyJubjubHex}`);
    }
    if (!process.env[`AGENT_${i}_COMMITMENT`]) {
      lines.push(`AGENT_${i}_COMMITMENT=${commitment}`);
    }

    records.push({
      index: i,
      walletAddress,
      walletPrivateKey: walletKey,
      semaphoreSecret,
      commitment,
      babyJubjubHex,
      funded: null,
    });
  }

  if (lines.length) {
    const wrote = appendIfMissing(lines);
    console.log(wrote ? `\nAppended ${lines.length} lines to .env.secrets` : "\n.env.secrets already populated, no append");
  } else {
    console.log("\n.env.secrets already has all 5 agents — skipping append");
  }

  // ── Fund agent wallets that need it ──────────────────────────────
  const target = ethers.parseEther(FUND_AMOUNT_OG.toString());
  for (const r of records) {
    const bal = await provider.getBalance(r.walletAddress);
    if (bal >= target) {
      console.log(`agent ${r.index} already funded (${ethers.formatEther(bal)} OG)`);
      r.funded = { txHash: "<pre-existing>", amountOG: parseFloat(ethers.formatEther(bal)) };
      continue;
    }
    const need = target - bal;
    console.log(`agent ${r.index} funding ${ethers.formatEther(need)} OG → ${r.walletAddress}`);
    const tx = await deployer.sendTransaction({ to: r.walletAddress, value: need });
    const rc = await tx.wait();
    console.log(`  tx ${tx.hash} block ${rc?.blockNumber}`);
    r.funded = { txHash: tx.hash, amountOG: FUND_AMOUNT_OG };
  }

  const out = path.join(REPO_ROOT, "logs", "agent-wallets.json");
  fs.writeFileSync(out, JSON.stringify(records.map((r) => ({
    index: r.index,
    walletAddress: r.walletAddress,
    semaphoreCommitment: r.commitment,
    babyJubjubPubkey: r.babyJubjubHex,
    funded: r.funded,
  })), null, 2));
  console.log(`\nSummary saved to ${path.relative(REPO_ROOT, out)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
