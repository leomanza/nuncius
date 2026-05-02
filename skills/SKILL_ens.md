# SKILL: ENS Integration
## Session 5 — Agent Subnames + Semaphore Pubkeys in Text Records

This session is fast (~1 hour) but qualifies for the **ENS Most Creative Use** prize ($750–$1,250). The creative angle: storing a Baby Jubjub ZK public key in an ENS text record, enabling external parties to discover an agent's Semaphore group membership without knowing its voting history.

---

## What to Build

1. Register `zkswarm.eth` as your parent ENS name (or use a name you already own on mainnet)
2. Create 5 subnames: `voter1.zkswarm.eth` through `voter5.zkswarm.eth`
3. Set text record `semaphore.pubkey` on each to the agent's Baby Jubjub hex public key

**Why this is genuinely creative**: ENS text records are usually used for URLs, descriptions, or social handles. Using them to store a ZK cryptographic commitment (a Baby Jubjub public key that maps to a Semaphore group membership) is a novel use that judges will remember. Any smart contract or agent can now call `ens.resolve("voter1.zkswarm.eth")` and immediately know which Semaphore group that agent belongs to — without accessing any off-chain database.

---

## Prerequisites

- ETH on Ethereum mainnet (small amount for registration fees)
- OR: use ENS testnets (Sepolia ENS) for zero-cost testing
- The 5 agents' Baby Jubjub public keys (generated in Session 4 via `Identity.publicKey`)

---

## Getting the Baby Jubjub Public Keys

After generating Semaphore identities in Session 4:

```typescript
import { Identity } from "@semaphore-protocol/core";

const secrets = [
  process.env.AGENT_1_SEMAPHORE_SECRET!,
  // ... etc
];

for (let i = 0; i < 5; i++) {
  const identity = new Identity(secrets[i]);
  // publicKey is a [BigInt, BigInt] tuple (Baby Jubjub coordinates)
  const [pkX, pkY] = identity.publicKey;
  const hexKey = `0x${pkX.toString(16).padStart(64, "0")}${pkY.toString(16).padStart(64, "0")}`;
  console.log(`Agent ${i+1} Baby Jubjub pubkey: ${hexKey}`);
}
```

Save these 5 hex strings — they go into the ENS text records.

---

## Option A: ENS Mainnet (real, preferred for judges)

### Step 1: Register `zkswarm.eth`
- Go to https://app.ens.domains
- Search for `zkswarm.eth` — if taken, use `zkswarm-dao.eth` or `zkswarm-protocol.eth`
- Register for 1 year (~$5 USD in ETH)

### Step 2: Create subnames programmatically

```typescript
// scripts/register-ens.ts
import { createPublicClient, createWalletClient, http, namehash, encodeFunctionData } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config({ path: "../.env" });

// ENS NameWrapper ABI (simplified for subname creation)
const NAME_WRAPPER_ABI = [
  {
    name: "setSubnodeOwner",
    type: "function",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "node", type: "bytes32" }],
  }
] as const;

// ENS Public Resolver ABI (for text records)
const RESOLVER_ABI = [
  {
    name: "setText",
    type: "function",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  }
] as const;

const NAME_WRAPPER = "0xD4416b431e75376a1E5B2e4410f7E7Cc0FD8c1d"; // Mainnet
const PUBLIC_RESOLVER = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"; // Mainnet

async function main() {
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  });

  const parentName = process.env.ENS_PARENT_NAME || "zkswarm.eth";
  const parentNode = namehash(parentName);

  // Baby Jubjub pubkeys from Session 4
  const pubkeys = [
    process.env.AGENT_1_BABYJUBJUB_PUBKEY!,
    process.env.AGENT_2_BABYJUBJUB_PUBKEY!,
    process.env.AGENT_3_BABYJUBJUB_PUBKEY!,
    process.env.AGENT_4_BABYJUBJUB_PUBKEY!,
    process.env.AGENT_5_BABYJUBJUB_PUBKEY!,
  ];

  for (let i = 0; i < 5; i++) {
    const label = `voter${i + 1}`;
    const subnodeName = `${label}.${parentName}`;
    const subnode = namehash(subnodeName);

    console.log(`Creating subname: ${subnodeName}`);

    // Create subname
    await client.writeContract({
      address: NAME_WRAPPER,
      abi: NAME_WRAPPER_ABI,
      functionName: "setSubnodeOwner",
      args: [parentNode, label, account.address, 0, BigInt(2099999999)],
    });

    console.log(`  Setting semaphore.pubkey text record...`);

    // Set text record
    await client.writeContract({
      address: PUBLIC_RESOLVER,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [subnode, "semaphore.pubkey", pubkeys[i]],
    });

    console.log(`  ✓ ${subnodeName}: semaphore.pubkey = ${pubkeys[i].slice(0, 20)}...`);
  }

  console.log("\nAll 5 ENS subnames registered with Semaphore pubkeys.");
  console.log("Verify at: https://app.ens.domains/<name>");
}

main().catch(console.error);
```

---

## Option B: ENS Sepolia Testnet (zero-cost for development)

```typescript
// Use Sepolia testnet ENS for dev/testing
// ENS is deployed on Sepolia at the same addresses
// Just change the chain to sepolia and RPC to https://rpc.sepolia.org
```

For the final submission, use mainnet ENS — judges can verify it at `app.ens.domains`.

---

## Verifying in the Demo

Add this to your demo video or README:

```
ENS Resolution Demo:
voter1.zkswarm.eth → text(semaphore.pubkey) → 0x1234...abcd (Baby Jubjub key)
```

Screenshot of the ENS app showing the text records is compelling demo evidence. Also show in ARCHITECTURE.md: "Any agent can resolve another agent's Semaphore group membership via ENS, enabling reputation-gated group admission without revealing which member holds which commitment."

---

## Additional ENS Text Records (optional, nice touch)

While you're at it, add these records too — they cost the same gas and make the agent profiles richer:

| Key | Value |
|---|---|
| `semaphore.pubkey` | Baby Jubjub hex (required for ENS Creative prize) |
| `semaphore.groupId` | The Semaphore group ID (from DisputeDAO contract) |
| `zkswarm.agentIndex` | "1" through "5" |
| `zkswarm.role` | "voter" |
| `url` | Link to the Nuncius GitHub repo |
| `description` | "Nuncius anonymous voter agent" |

---

## Session 5 Deliverables Checklist

- [ ] `zkswarm.eth` (or alternative) registered and owned by your wallet
- [ ] 5 subnames created: `voter1.zkswarm.eth` through `voter5.zkswarm.eth`
- [ ] `text(semaphore.pubkey)` set on each subname
- [ ] Resolvable on `app.ens.domains` (screenshot saved for demo)
- [ ] `DEPLOY_LOG.md` updated with ENS names + transaction hashes
- [ ] `scripts/register-ens.ts` committed to repo so judges can reproduce
