# SKILL: Environment Setup
## Session 1 — Read This First Before Writing Any Code

This skill covers every environment prerequisite for Nuncius. Complete all steps before touching product code. The goal is to surface failures fast, not build on broken foundations.

---

## Step 1: Wallet + 0G Galileo Testnet

### Create a dedicated deployer wallet
```bash
# Generate a new wallet (or use an existing dev wallet)
cast wallet new
# Save the private key and address — you'll need both
```

### Get testnet OG tokens
1. Go to https://faucet.0g.ai
2. Enter your wallet address
3. Request OG tokens (you need at least 5 OG: 3 for compute ledger, 1 per sub-account, 1 for gas)
4. Verify receipt: `cast balance <your_address> --rpc-url https://evmrpc-testnet.0g.ai`

### 0G Galileo network config
```
Network Name: 0G-Galileo-Testnet
RPC URL: https://evmrpc-testnet.0g.ai
Chain ID: 16602
Currency: OG
Block Explorer: https://chainscan-galileo.0g.ai
```

Add to MetaMask or configure in Hardhat as shown in `SKILL_contracts.md`.

---

## Step 2: AXL Binary Setup

AXL is a single Go binary. No Docker needed unless on unusual OS.

### Download
```bash
# From Gensyn GitHub releases
git clone https://github.com/gensyn-ai/axl.git
cd axl
make build
# Binary produced at ./node (or ./axl on some builds)
```

If `make build` fails (Go not installed):
```bash
# Install Go first
brew install go          # macOS
sudo apt install golang  # Ubuntu
# Then retry make build
```

### Verify the binary works
```bash
./node --help
# Should print AXL usage info
```

### Generate 5 keypairs (one per agent)
```bash
for i in 1 2 3 4 5; do
  openssl genpkey -algorithm ed25519 -out keys/private-$i.pem
  openssl pkey -in keys/private-$i.pem -pubout -out keys/public-$i.pem
  echo "Generated keypair $i"
done
```

### Create node configs
Create `axl-configs/node-{1-5}.json`. Each node needs a unique port:

```json
{
  "private_key_path": "./keys/private-1.pem",
  "listen_addr": "0.0.0.0:9002",
  "api_addr": "127.0.0.1:10001"
}
```

Ports: node 1 → listen 9002, api 10001 | node 2 → 9003/10002 | node 3 → 9004/10003 | node 4 → 9005/10004 | node 5 → 9006/10005

### Start 2 nodes and verify inter-node messaging
```bash
# Terminal 1
./node -config axl-configs/node-1.json

# Terminal 2
./node -config axl-configs/node-2.json

# Terminal 3 — get node 1's peer ID
curl http://127.0.0.1:10001/id

# Terminal 3 — send from node 2 to node 1 (replace PEER_ID)
curl -X POST http://127.0.0.1:10002/send \
  -H 'Content-Type: application/json' \
  -d '{"peer_id": "<NODE_1_PEER_ID>", "data": "hello from node 2"}'

# Terminal 1 should show: received message from node 2
```

**GO/NO-GO: If this works, AXL is confirmed. If not, check firewall/NAT and retry with explicit peer addresses.**

---

## Step 3: Semaphore V4 on 0G Galileo — Critical Test

This is the highest-risk unknown. Run it immediately.

### Setup Semaphore Hardhat project
```bash
mkdir semaphore-test && cd semaphore-test
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @semaphore-protocol/contracts @semaphore-protocol/core
npx hardhat init  # choose TypeScript project
```

### Configure for 0G Galileo in `hardhat.config.ts`
```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
    settings: {
      evmVersion: "london",  // NOT cancun — 0G Galileo compatibility
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    galileo: {
      url: "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: [process.env.PRIVATE_KEY!],
    }
  }
};

export default config;
```

### Deploy the Semaphore verifier
```bash
# Create scripts/deploy-semaphore-test.ts
# Content: deploy SemaphoreVerifier from @semaphore-protocol/contracts
npx hardhat run scripts/deploy-semaphore-test.ts --network galileo
```

Minimal deploy script:
```typescript
import { ethers } from "hardhat";

async function main() {
  const SemaphoreVerifier = await ethers.getContractFactory("SemaphoreVerifier");
  const verifier = await SemaphoreVerifier.deploy();
  await verifier.waitForDeployment();
  console.log("SemaphoreVerifier deployed to:", await verifier.getAddress());

  const Semaphore = await ethers.getContractFactory("Semaphore");
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  await semaphore.waitForDeployment();
  console.log("Semaphore deployed to:", await semaphore.getAddress());
}

main().catch(console.error);
```

**GO/NO-GO outcomes:**
- **Deploys successfully** → Save both addresses to `DEPLOY_LOG.md`, proceed with Plan B
- **Fails with EVM version error** → Try `evmVersion: "paris"` then `"berlin"` then `"istanbul"`, retry
- **Fails with gas estimation error** → Increase gas limit in Hardhat config; if still fails after 30 min → switch to Base Sepolia for ZK layer only
- **Base Sepolia fallback**: `https://sepolia.base.org`, chainId 84532 — Semaphore works perfectly here

---

## Step 4: 0G Compute — One Test Inference Call

```bash
npm install @0glabs/0g-serving-broker
```

Quick test (TypeScript):
```typescript
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const broker = await createZGComputeNetworkBroker(wallet);

// Fund compute ledger (one-time, needs 3 OG min)
await broker.ledger.addLedger(3n * BigInt(1e18));

// Get available models
const providers = await broker.inference.listProviders();
console.log("Available providers:", providers);

// Make a test call
const headers = await broker.inference.getRequestHeaders(
  providers[0].provider,
  "deepseek-ai/DeepSeek-R1-70B"
);

const response = await fetch(`${providers[0].endpoint}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({
    model: "deepseek-ai/DeepSeek-R1-70B",
    messages: [{ role: "user", content: "Reply with one word: hello" }],
    max_tokens: 10
  })
});

console.log(await response.json());
```

**If 0G Compute is slow to provision:** use local Ollama as fallback for development, switch to 0G Compute for the final demo. Install: `brew install ollama && ollama pull llama3.1:8b`.

---

## Step 5: Create `.env.example`

After Session 1, create this file at repo root:

```bash
# 0G Chain
PRIVATE_KEY=                          # Deployer wallet private key
RPC_URL=https://evmrpc-testnet.0g.ai  # 0G Galileo testnet
CHAIN_ID=16602

# Contract Addresses (filled after Session 2 deploy)
SEMAPHORE_ADDRESS=
DISPUTE_DAO_ADDRESS=

# 0G Compute
ZG_COMPUTE_KEY=                       # From 0G dashboard or funded wallet
ZG_COMPUTE_MODEL=deepseek-ai/DeepSeek-R1-70B

# 0G Storage
ZG_STORAGE_RPC=https://evmrpc-testnet.0g.ai
ZG_STORAGE_INDEXER=https://indexer-storage-testnet-standard.0g.ai

# Agent identities (Semaphore — generated in Session 4)
AGENT_1_PRIVATE_KEY=     # Wallet key for on-chain tx submission
AGENT_1_SEMAPHORE_SECRET= # Semaphore identity secret (NOT wallet key)
AGENT_2_PRIVATE_KEY=
AGENT_2_SEMAPHORE_SECRET=
AGENT_3_PRIVATE_KEY=
AGENT_3_SEMAPHORE_SECRET=
AGENT_4_PRIVATE_KEY=
AGENT_4_SEMAPHORE_SECRET=
AGENT_5_PRIVATE_KEY=
AGENT_5_SEMAPHORE_SECRET=

# AXL
AXL_BINARY_PATH=./axl/node
AXL_NODE_1_API=http://127.0.0.1:10001
AXL_NODE_2_API=http://127.0.0.1:10002
AXL_NODE_3_API=http://127.0.0.1:10003
AXL_NODE_4_API=http://127.0.0.1:10004
AXL_NODE_5_API=http://127.0.0.1:10005

# ENS (Session 5)
ENS_PARENT_NAME=zkswarm.eth
ENS_REGISTRY_ADDRESS=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e

# Frontend
NEXT_PUBLIC_DISPUTE_DAO_ADDRESS=
NEXT_PUBLIC_RPC_URL=https://evmrpc-testnet.0g.ai
```

---

## Session 1 Deliverables Checklist

- [ ] `DEPLOY_LOG.md` exists with:
  - [ ] Deployer wallet address
  - [ ] OG balance on Galileo (≥5 OG)
  - [ ] AXL binary path + "inter-node test: PASSED"
  - [ ] Semaphore verifier address on Galileo (or note: "deployed on Base Sepolia: <address>")
  - [ ] 0G Compute test: "inference call: PASSED" or "using Ollama fallback"
- [ ] `.env.example` created with all keys documented
- [ ] `keys/` directory with 5 keypair files

**If all green: proceed to Session 2 (contracts). If any red: see risk mitigations above.**
