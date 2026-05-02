/// Register the ENS parent name (e.g. nuncius.eth) via the
/// ETHRegistrarController commit-reveal flow.
///
/// Flow (per ENS docs):
///   1. compute commitment = makeCommitment(label, owner, duration, secret,
///        resolver, data, reverseRecord, ownerControlledFuses)
///   2. controller.commit(commitment)
///   3. wait at least minCommitmentAge (60s on Sepolia)
///   4. controller.register(...) sending rentPrice ETH
///   5. confirm Registry.owner(namehash(name)) == owner

import {
  createPublicClient, createWalletClient, http, encodePacked, keccak256, namehash,
  parseAbi, encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import * as path from "path";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { ADDRESSES, RPC_URL, CHAIN, PARENT_NAME, NETWORK } from "./_addresses";

// Subset of ETHRegistrarController v1.6+ ABI we need.
const CONTROLLER_ABI = parseAbi([
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns ((uint256 base, uint256 premium))",
  "function minCommitmentAge() view returns (uint256)",
  "function makeCommitment(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) pure returns (bytes32)",
  "function commitments(bytes32 commitment) view returns (uint256)",
  "function commit(bytes32 commitment)",
  "function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable",
]);

const REGISTRY_ABI = parseAbi([
  "function owner(bytes32 node) view returns (address)",
]);

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
  const pk = process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk as `0x${string}`);

  const label = PARENT_NAME.endsWith(".eth") ? PARENT_NAME.slice(0, -".eth".length) : PARENT_NAME;
  const fullName = label + ".eth";
  const node = namehash(fullName);
  console.log(`Network: ${NETWORK}`);
  console.log(`Name   : ${fullName}`);
  console.log(`Owner  : ${account.address}`);

  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

  // ── Idempotency: already owned? ─────────────────────────────────
  const existingOwner = await publicClient.readContract({
    address: ADDRESSES.ENSRegistry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  });
  if (existingOwner.toLowerCase() === account.address.toLowerCase()) {
    console.log(`✅ ${fullName} already owned by deployer — skipping`);
    return;
  }
  if (existingOwner.toLowerCase() !== ADDRESSES.NameWrapper.toLowerCase() &&
      existingOwner !== "0x0000000000000000000000000000000000000000") {
    // Note: when wrapped, registry owner is the NameWrapper. Verify via NameWrapper.ownerOf separately.
    console.log(`Registry.owner = ${existingOwner} — name might be wrapped or owned by someone else`);
  }
  const available = await publicClient.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "available",
    args: [label],
  });
  if (!available) throw new Error(`${fullName} is not available — pick a different ENS_PARENT_NAME`);

  const balance = await publicClient.getBalance({ address: account.address });
  const oneYear = 365n * 24n * 60n * 60n;
  const price = await publicClient.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "rentPrice",
    args: [label, oneYear],
  }) as { base: bigint; premium: bigint };
  const total = price.base + price.premium;
  // 5% buffer for ETH/USD price drift between commit and register.
  const sendValue = total + total / 20n;
  console.log(`rentPrice (1yr)   : ${total} wei`);
  console.log(`sendValue (+5%)   : ${sendValue} wei`);
  console.log(`balance           : ${balance} wei`);
  if (balance < sendValue + 1_000_000_000_000_000n /* gas headroom */) {
    throw new Error(`insufficient balance: have ${balance}, need ~${sendValue + 1_000_000_000_000_000n}`);
  }

  const minAge = await publicClient.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "minCommitmentAge",
  }) as bigint;

  // ── Build commitment ───────────────────────────────────────────
  // Random 32-byte secret. MUST be the same in commit() and register().
  const secretBytes = crypto.randomBytes(32);
  const secret = ("0x" + secretBytes.toString("hex")) as `0x${string}`;
  const resolver = ADDRESSES.PublicResolver as `0x${string}`;
  const reverseRecord = false;
  const ownerControlledFuses = 0; // 0 = no fuse restrictions (skill suggested 0)

  // The controller exposes setText via PublicResolver. We don't pre-set anything
  // here — subnames handle their own text records. Pass empty data array.
  const data: `0x${string}`[] = [];

  const commitment = await publicClient.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "makeCommitment",
    args: [label, account.address, oneYear, secret, resolver, data, reverseRecord, ownerControlledFuses],
  });
  console.log(`commitment        : ${commitment}`);

  const existing = await publicClient.readContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "commitments",
    args: [commitment],
  });
  if (existing > 0n) {
    console.log(`commitment already on-chain at timestamp ${existing} — will reuse`);
  } else {
    console.log(`\nSubmitting commit() ...`);
    const commitTx = await wallet.writeContract({
      address: ADDRESSES.ETHRegistrarController as `0x${string}`,
      abi: CONTROLLER_ABI,
      functionName: "commit",
      args: [commitment],
    });
    console.log(`  tx: ${commitTx}`);
    await publicClient.waitForTransactionReceipt({ hash: commitTx });
    console.log(`  confirmed ✓`);
  }

  // ── Wait minimum commitment age ────────────────────────────────
  const waitMs = (Number(minAge) + 5) * 1000;
  console.log(`\nWaiting ${waitMs / 1000}s for commitment to mature ...`);
  await sleep(waitMs);

  // ── Register ───────────────────────────────────────────────────
  console.log(`\nSubmitting register() with ${sendValue} wei ...`);
  const regTx = await wallet.writeContract({
    address: ADDRESSES.ETHRegistrarController as `0x${string}`,
    abi: CONTROLLER_ABI,
    functionName: "register",
    args: [label, account.address, oneYear, secret, resolver, data, reverseRecord, ownerControlledFuses],
    value: sendValue,
  });
  console.log(`  tx: ${regTx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: regTx });
  console.log(`  block: ${receipt.blockNumber}  status: ${receipt.status}`);

  // ── Confirm ───────────────────────────────────────────────────
  const newRegOwner = await publicClient.readContract({
    address: ADDRESSES.ENSRegistry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  });
  console.log(`\n✅ Registry.owner(${fullName}) = ${newRegOwner}`);
  console.log(`   (when wrapped, the registry owner is the NameWrapper contract address)`);
  console.log(`   App: https://app.ens.domains/${fullName}?network=${NETWORK}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
