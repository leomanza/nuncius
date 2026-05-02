# SKILL: 0G Storage + Compute
## Sessions 3 & 4 — Off-Chain Memory + Verifiable Inference

**⚠️ UPDATED FROM ACTUAL DOCS — use this, not any prior version.**

---

## Critical: What 0G Storage Actually Is

0G Storage is **content-addressed file storage**, not a traditional KV database. Every write uploads a blob and returns a **Merkle root hash** — that root hash is the retrieval key. No mutable "set key → value" on the main layer.

**BUT:** There IS a real KV layer called **0G-KV**, accessed via `Batcher` + `KvClient`. This is what agents use for live state.

| Layer | What it is | Use in Nuncius |
|---|---|---|
| 0G-KV (`Batcher` + `KvClient`) | Mutable key-value via stream IDs | Live agent status (overwritten each stage) |
| 0G Storage (`MemData` + `indexer.upload`) | Immutable content-addressed blobs | Deliberation transcript (append log) |

---

## Installation

```bash
npm install @0gfoundation/0g-ts-sdk ethers
```

Imports to know:
```typescript
import { Indexer, Batcher, KvClient, MemData } from '@0gfoundation/0g-ts-sdk';
```

---

## Setup

```typescript
// Use TURBO indexer — faster for hackathon demo
const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';
const KV_RPC = 'http://3.101.147.150:6789'; // confirm with devrel for Galileo

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const indexer = new Indexer(INDEXER_RPC);
```

---

## Part 1A: 0G-KV — Live Agent State (Mutable)

Each agent writes to its own **stream** under a fixed key. The frontend reads these streams to show live progress.

```typescript
// agents/shared/0g-kv-client.ts
import { Indexer, Batcher, KvClient } from '@0gfoundation/0g-ts-sdk';
import { ethers } from 'ethers';

const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';
const KV_RPC = process.env.ZG_KV_RPC || 'http://3.101.147.150:6789';
const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const STATE_KEY = 'state';

// Deterministic stream ID per agent — frontend knows where to read
export function getStreamId(agentIndex: number): string {
  return '0x' + '00'.repeat(31) + agentIndex.toString(16).padStart(2, '0');
}

export async function writeAgentState(
  agentIndex: number,
  state: object,
  signer: ethers.Wallet
): Promise<string | null> {
  try {
    const indexer = new Indexer(INDEXER_RPC);
    const [nodes, err] = await indexer.selectNodes(1);
    if (err !== null) throw new Error(`Node selection: ${err}`);

    // flowContract: pass null — SDK auto-discovers from indexer
    // CONFIRM WITH DEVREL if this causes issues
    const batcher = new Batcher(1, nodes, null as any, RPC_URL);

    const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, 'utf-8'));
    const valueBytes = Uint8Array.from(
      Buffer.from(JSON.stringify({ ...state, updatedAt: Date.now() }), 'utf-8')
    );

    batcher.streamDataBuilder.set(getStreamId(agentIndex), keyBytes, valueBytes);

    const [tx, batchErr] = await batcher.exec();
    if (batchErr !== null) throw new Error(`KV write: ${batchErr}`);

    console.log(`[0G-KV] Agent ${agentIndex} state written. TX: ${tx}`);
    return tx;
  } catch (err) {
    console.error(`[0G-KV] Write failed agent ${agentIndex}:`, err);
    return null; // non-fatal — agent continues
  }
}

export async function readAgentState(agentIndex: number): Promise<object | null> {
  try {
    const kvClient = new KvClient(KV_RPC);
    const keyBytes = Uint8Array.from(Buffer.from(STATE_KEY, 'utf-8'));
    const value = await kvClient.getValue(
      getStreamId(agentIndex),
      ethers.encodeBase64(keyBytes)
    );
    if (!value) return null;
    return JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}
```

---

## Part 1B: 0G Storage (File) — Deliberation Transcript (Immutable Log)

Use `MemData` for in-memory blobs. **Must call `merkleTree()` before `upload()`** — non-obvious, documented requirement.

```typescript
// agents/shared/0g-storage-client.ts
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

export async function appendDeliberationLog(
  proposalId: number,
  agentIndex: number,
  entry: object,
  signer: ethers.Wallet
): Promise<string | null> {
  try {
    const indexer = new Indexer(INDEXER_RPC);

    const data = new TextEncoder().encode(
      JSON.stringify({ proposalId, agentIndex, ...entry, timestamp: Date.now() })
    );
    const memData = new MemData(data);

    // REQUIRED before upload
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) throw new Error(`Merkle tree: ${treeErr}`);
    const rootHash = tree?.rootHash();

    const [tx, uploadErr] = await indexer.upload(memData, RPC_URL, signer);
    if (uploadErr !== null) throw new Error(`Upload: ${uploadErr}`);

    console.log(`[0G Storage] Log entry root hash: ${rootHash}`);
    return rootHash || null;
  } catch (err) {
    console.error('[0G Storage] Log write failed:', err);
    return null;
  }
}
```

---

## Part 2: 0G Compute — Verifiable Inference

Auth headers are **single-use per call** — generate fresh each time.

```typescript
// agents/shared/0g-compute-client.ts
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import { ethers } from 'ethers';

let brokerCache: any = null;
let providerCache: any = null;

async function getBroker() {
  if (brokerCache) return { broker: brokerCache, computeProvider: providerCache };

  const rpcProvider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, rpcProvider);
  const broker = await createZGComputeNetworkBroker(wallet);

  try { await broker.ledger.addLedger(3n * BigInt(1e18)); } catch {}

  const providers = await broker.inference.listProviders();
  const model = process.env.ZG_COMPUTE_MODEL || 'deepseek-ai/DeepSeek-R1-70B';
  const computeProvider = providers.find((p: any) =>
    p.model === model || p.models?.includes(model)
  ) || providers[0];

  try { await broker.inference.addAccount(computeProvider.provider, 1n * BigInt(1e18)); } catch {}

  brokerCache = broker;
  providerCache = computeProvider;
  return { broker, computeProvider };
}

export async function callComputeInference(system: string, user: string): Promise<string> {
  try {
    const { broker, computeProvider } = await getBroker();
    const model = process.env.ZG_COMPUTE_MODEL || 'deepseek-ai/DeepSeek-R1-70B';

    // Single-use headers — must regenerate every call
    const headers = await broker.inference.getRequestHeaders(
      computeProvider.provider, model
    );

    const res = await fetch(`${computeProvider.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!res.ok) throw new Error(`0G Compute: ${res.status}`);
    const data = await res.json();

    await broker.inference.settleFee(
      computeProvider.provider, model, data.usage?.total_tokens || 100
    );

    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.warn('[0G Compute] Fallback to Ollama:', err);
    return callOllamaFallback(system, user);
  }
}

async function callOllamaFallback(system: string, user: string): Promise<string> {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.1:8b',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
    }),
  });
  return (await res.json()).message?.content || '';
}
```

---

## Frontend Polling via 0G-KV

Replace HTTP polling of agent endpoints with direct 0G-KV reads:

```typescript
// Copy readAgentState to frontend/src/lib/0g-kv-client.ts
// Then in page.tsx:
const pollAgents = async () => {
  const statuses = await Promise.all(
    [1, 2, 3, 4, 5].map(async (i) => {
      const state = await readAgentState(i);
      return { index: i, ...(state || { state: 'idle' }) };
    })
  );
  setAgentStatuses(statuses);
};
```

This demonstrates genuine 0G-KV usage to judges rather than just hitting localhost.

---

## Questions to Confirm with DevRel

1. **`Batcher` flowContract** — pass `null` for auto-discovery or explicit testnet address?
2. **KV endpoint** — is `http://3.101.147.150:6789` correct for Galileo testnet?
3. **KV read latency** — how long after `batcher.exec()` before `kvClient.getValue()` reflects the new value?

---

## Session Deliverables Checklist

- [ ] `writeAgentState` + `readAgentState` working end-to-end (write → read matches)
- [ ] `appendDeliberationLog` using `MemData` — returns root hash without error
- [ ] `callComputeInference` returns valid JSON deliberation from 0G Compute
- [ ] Ollama fallback works (`ollama serve` + `ollama pull llama3.1:8b`)
- [ ] Frontend polls `readAgentState` from 0G-KV (not HTTP endpoints)
- [ ] `DEPLOY_LOG.md` updated with KV stream IDs and at least one root hash
