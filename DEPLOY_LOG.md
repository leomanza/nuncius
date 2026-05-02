# Nuncius — Deployment Log

This file is updated after each session. Claude Code appends to this file as deployments happen.

(Project was originally codenamed "ZK Swarm"; renamed to **Nuncius** on 2026-04-30 — see "Project rename" section below.)

---

## Session 1 — Environment

- Date: 2026-04-29 / 2026-04-30 (deploy run)
- Deployer wallet: 0x810A3048375EFe1e13F373b5118945Fe3Eac7f22
- 0G Galileo OG balance: 15.5 OG initially → 12.44 OG after Session 1 (3 OG to compute ledger
  + ~0.06 OG gas across 5 deploy/ack/validate txs)
- 0G Galileo chain id: 16602 (verified via `cast chain-id --rpc-url https://evmrpc-testnet.0g.ai`)
- 0G Galileo min gas price: 2 gwei (1 gwei rejected with "transaction gas price below minimum"
  — hardhat config pins 3 gwei for headroom)

### AXL — PASSED ✅
- Source: github.com/gensyn-ai/axl @ commit 9cba555 (built locally with go1.26.2)
- Binary: /Users/manza/Code/delibera-on-0g/axl-src/node
- Real config schema confirmed: `{"PrivateKeyPath","Peers","Listen","api_port","bridge_addr","tcp_port"}`
  — the snake_case shape in SKILL_axl.md is fabricated; flagged in SESSION_0_REVIEW.md B2.
- Both nodes MUST share the same `tcp_port` (it is the destination dial port over Yggdrasil's
  internal gVisor stack, not a local-only listener as the doc implies).
- 2-node round-trip captured: node 1 (pk `4ce84bce…b40f492f`) → node 2 (pk `6e01012f…3b29b83e`)
  - `POST /send` to 127.0.0.1:10001 with header `X-Destination-Peer-Id: <node2-pk>`, raw JSON body → 200
  - `GET /recv` on 127.0.0.1:10002 → 200, `X-From-Peer-Id: 4ce84bce87004a54cec449309c717ffff…`
    (NOTE: AXL truncates the `X-From-Peer-Id` header to a prefix and pads with `f`s — only the first
    ~26 hex chars match the actual sender pk. Routing is fine, but downstream code must not
    string-equality-compare to the full pk; truncation-aware matching needed.)
  - Body received verbatim: `{"type":"PROPOSAL_BROADCAST","msg":"hello from node 1","ts":2}`
  - Saved evidence: logs/axl-recv-headers.txt + logs/axl-recv-body.json
- AXL has NO GossipSub / pub-sub primitive. Coordinator must fan-out by iterating peers
  (already documented in SESSION_0_REVIEW.md B3).

### Semaphore V4 on 0G Galileo — PASSED ✅ (Plan B intact)
- Solc 0.8.23, evmVersion "london", optimizer 200 runs, gas price 3 gwei.
- BN254 pairing precompiles work: real Groth16 fixture proof verified on-chain.
  - PoseidonT3:        0xBa04c3B5A5Ba984A0E3DFA359b5F90566c313A1e
  - SemaphoreVerifier: 0xCa5dbA14bBB19a72F4A36c088c1d437d8C0Cb3E1
  - Semaphore:         0x3a546a753621100c7A569555FA2F081A3D761410
  - Fixture group id:  0
  - `verifyProof()` (view) returned: true
  - `validateProof()` tx: 0x07f478f6ff3a579e03762afa05cd24a6ed9a5bf4f06487979880fbbabf71e468
    block 30607505
- Confirms the 3-step deploy order: PoseidonT3 (library) → SemaphoreVerifier → Semaphore (linked)
  — SKILL_environment.md / MASTER_PLAN.md show only a 2-step deploy; PoseidonT3 must be added.
- Saved: semaphore-test/semaphore-deploy-result.json + logs/semaphore-deploy.log

### 0G Compute — PASSED ✅
- Compute ledger funded with 3 OG (MIN_LEDGER_BALANCE_OG = 3 in SDK).
- 2 providers online on Galileo (snapshot 2026-04-30):
  - qwen/qwen-2.5-7b-instruct  @ https://compute-network-6.integratenetwork.work
    provider 0xa48f01287233509FD694a22Bf840225062E67836
  - qwen/qwen-image-edit-2511 @ https://compute-network-17.integratenetwork.work
    provider 0x4b2a941929E39Adbea5316dDF2B9Bd8Ff3134389
- DeepSeek-R1-70B is NOT online on Galileo right now → MASTER_PLAN.md / SKILL_0g_storage_compute.md
  default of `deepseek-ai/DeepSeek-R1-70B` will fail; agents should pick from `listService()`.
- Test round-trip: prompt "Reply with exactly one word: hello" → "Hello" in 1.4s
  - chat-completions URL is `<getServiceMetadata.endpoint>/chat/completions`, not `<url>/v1/chat/completions`.
    The provider's base URL has a `/v1/proxy` segment that getServiceMetadata returns; hard-coding
    `/v1/chat/completions` against the bare URL gives 404.
- `broker.inference.processResponse(...)` returned "getting signature error" — non-fatal for the
  inference itself (response was billed via headers); noted as a downstream concern when wiring agents.
- Saved: compute-test/compute-result.json + logs/compute-test.log
- Ollama fallback: installed (brew), running on 127.0.0.1:11434, model `llama3.2:3b` pulled
  (2.0 GB — used `3b` instead of the spec'd `llama3.1:8b` for faster pull during validation;
  swap to 8b before demo if quality matters).

---

## Session 2 — Contracts (PASSED ✅)

- Network: 0G Galileo (chainId 16602)
- PoseidonT3 (library): 0xBa04c3B5A5Ba984A0E3DFA359b5F90566c313A1e
- SemaphoreVerifier:    0xCa5dbA14bBB19a72F4A36c088c1d437d8C0Cb3E1
- Semaphore:            0x3a546a753621100c7A569555FA2F081A3D761410
- DisputeDAO:           0x650c074910bC5855f6573f9d62EE5b8bA90664D9
- DisputeDAO group id:  1
- Deploy tx:            0x793c3c44e78903a7646385d5069949b97ed800ffab58eae0314cfa53fb8c34e1
- Local test suite:     11/11 passing (real Groth16 proofs in-memory)
  - happy path 5-vote auto-resolve
  - B5: scope mismatch reverts (cross-proposal replay defended)
  - B4: invalid signal in `proof.message` reverts
  - nullifier reuse reverts
  - no-active / already-resolved guards
  - forceResolve owner + quorum gate
- Patches relative to SKILL_contracts.md (per SESSION_0_REVIEW.md):
  - submitProof signature is `submitProof(SemaphoreProof proof)` — no separate `signal` arg
  - revert if `proof.scope != currentProposalId` (B5)
  - revert if `proof.message ∉ {1,2}` (B4)
  - groupId set via `semaphore.createGroup(address(this))` so the DAO is the group admin
  - `openProposal` rejects when another proposal is active (verified live: tx reverts)
- Explorer links:
  - DisputeDAO:        https://chainscan-galileo.0g.ai/address/0x650c074910bC5855f6573f9d62EE5b8bA90664D9
  - PoseidonT3:        https://chainscan-galileo.0g.ai/address/0xBa04c3B5A5Ba984A0E3DFA359b5F90566c313A1e
  - SemaphoreVerifier: https://chainscan-galileo.0g.ai/address/0xCa5dbA14bBB19a72F4A36c088c1d437d8C0Cb3E1
  - Semaphore:         https://chainscan-galileo.0g.ai/address/0x3a546a753621100c7A569555FA2F081A3D761410

---

## Session 3 — AXL Mesh + Agents (PASSED ✅)

### AXL — 5-node mesh
- Source: github.com/gensyn-ai/axl @ 9cba555 (built locally with go1.26.2)
- Topology: spoke (node-1 listens `tls://0.0.0.0:9001`; nodes 2-5 dial it).
- Peer IDs (snapshot — see logs/axl-peer-ids.json):
  - agent-1: 4ce84bce87004a54cec449309c7169bbd34cd61a08716c4f44088922b40f492f (api 10001)
  - agent-2: 6e01012f929c775dd90060b9e8d41f8e5a336a5250ad7963cb07ef2a3b29b83e (api 10002)
  - agent-3: fa7b1365497a53f300f2454e2b18fc68cb5ff02c847fc6ec4cd40f51fd15512f (api 10003)
  - agent-4: 1ded5c5765c04f0ebc428294f89a8a77f3c7b63eac3a84e2ec874296f66ccf4e (api 10004)
  - agent-5: 859819e5d3abff9ba7c3087833914e5118fc2da577507943e538b17eadc37353 (api 10005)
- Routing validated: node-2 → node-5 via node-1 (2 hops) succeeded.
- start-all script: scripts/start-axl.sh (idempotent, captures peer ids to logs/axl-peer-ids.json).

### Agent code
- Workspace: agents/ — Hono HTTP + AXL polling + 0G Compute + 0G-KV writes.
- Shared modules: axl-client.ts (real /send + /recv API, no GossipSub), 0g-compute-client.ts
  (dynamic provider via listService, getServiceMetadata.endpoint + Ollama fallback),
  0g-kv-client.ts (B8 RESOLVED — Galileo flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`,
  W1 RESOLVED — stream ids salted with DAO address), types.ts.
- Voter: voter/src/{index,axl-handler,deliberate}.ts — strips `<think>` blocks, JSON.parse with
  fallback to keyword sniff. Persona per agent. temperature=0.
- Coordinator: scripts/trigger-proposal.ts — opens (or reuses) on-chain proposal then fans
  out PROPOSAL_BROADCAST envelopes to all 5 peers via AXL /send.
- Type-checked clean (`npx tsc --noEmit`).

### W1 — stream id salting verified
- streamId = keccak256(daoAddress || "agent" || agentIndex), distinct per agent and per DAO.
- Stream ids for the deployed DAO (0x650c…64D9):
  - agent 1: 0xcb0e13aa388dd46134c4d9bd6a4a9bd54ca0b8c289325476d3bec0548272e319
  - agent 2: 0xd78531e673afc72aaecbdbbed49167d6c0a178666fbd4346992a18cef445f700
  - agent 3: 0x2782afd6d8c0ae8e650160ec873bda181577260cd7b950d038b98e4329306922
  - agent 4: 0x7e3aa1264371f433ea3c6a13572316fb50c44e6abae0d4a7bb20ad15c9bb4ec4
  - agent 5: 0x5289ec3342f3504250f4431be5c417f401009b6352fb4cdc7d2d35fc765323fd
- 0G Storage flow tx hashes (KV writes — each agent wrote multiple state transitions):
  - 0xf29667d635fe35ab89ef9a42a812ed2d22237dc5d12eabe94efcbbab5bdd5183 (txSeq 59832)
  - 0xb7d1183c8e498f5d127e8b4e5b8bd66c1bf6809ee7ca1e7ce0a443215b5e3bab
  - 0x0436f530c8ec00fab8408dc9b8b113f5ffcafa71254691f351d9d882834afa75
  - 0xee1bfdb729be1eac5d62653306ff60cbbd39dddc5440b75056e0ab58472903a5
  - 0xa952f0ca4c89abc86b4c624af9cc33863083da1264178fe210b827d659111be3
  - + ~5 more across 5 agents × 2 state transitions each (see logs/agents-stdout.log
    grep `Transaction submitted, hash`).

### KV-read endpoint is stale (NEW finding for SESSION_0_REVIEW.md)
- The KV reader RPC the docs publish (`http://3.101.147.150:6789`) does not respond on Galileo
  today. KV writes via the Flow contract land on-chain and the indexer accepts them, but the
  documented reader endpoint is silent (connection dropped without reply).
- Impact: Session 6 frontend needs an alternative read path. Options:
  1. Locate the current KV reader endpoint via 0G devrel / discord and override `ZG_KV_RPC`.
  2. Expose `/state` on each agent's Hono server (already done in this session) and have
     the frontend poll the agent HTTP endpoints — sacrifices the "frontend reads from 0G-KV"
     judging point but keeps the demo functional.
  3. Frontend reads ProposalOpened/ProofVerified/ProposalResolved events directly from the
     Galileo RPC (which works) — actually the most judge-visible path because the dashboard
     animations are driven by those events.
- Recommendation: do (3) for the demo, document KV writes as the off-chain working memory in
  the architecture diagram. The 0G prize qualification is "uses Storage KV" — writes are
  confirmed working, that satisfies the qualification even if reads go through the agent layer.

---

## Session 4 — Agent Identities + Anonymous Voting (PASSED ✅)

### Semaphore identities (deterministic; secrets in `.env.secrets`)
Secret seed pattern: `zkswarm-e2e-agent-{i}` (matches Session 2 full-e2e.ts).
Identity.publicKey shape on `@semaphore-protocol/identity@4.14.2`: `[bigint, bigint]` ✅ (review fix W9 RESOLVED).

| Agent | Commitment (decimal, prefix) | Baby Jubjub pubkey (Session 5 ENS payload) |
|---:|:---|:---|
| 1 | 2790444380512267305854693… | (`AGENT_1_BABYJUBJUB_PUBKEY` in .env.secrets) |
| 2 | 8678805245572910650300307… | (`AGENT_2_BABYJUBJUB_PUBKEY`) |
| 3 | 7478261768867593993458535… | (`AGENT_3_BABYJUBJUB_PUBKEY`) |
| 4 | 1527908185914128219244847… | (`AGENT_4_BABYJUBJUB_PUBKEY`) |
| 5 | 2063191896884234720241965… | (`AGENT_5_BABYJUBJUB_PUBKEY`) |

addVoter txs were issued during Session 2's full-e2e.ts (all 5 commitments registered in DAO group id 1).

### Per-agent wallets (Session 4 funding)
Each agent has its own ethereum wallet. The agent wallet — NOT the deployer — signs
its anonymous vote tx, so the on-chain tx-graph cannot link agent identity → vote.

| Agent | Wallet address | Funded with | Funding tx |
|---:|:---|---:|:---|
| 1 | 0x5f179FEA1505A873555d11e903991a42766B4a9F | 0.10 OG | 0xcda624be…f20a9 |
| 2 | 0x2654512aBaa5446F073010C8587C880438A4462C | 0.10 OG | 0x58a29fe8…090b80 |
| 3 | 0x6B12F53bB2d12d0A16f72d756a14c179FdfB9247 | 0.10 OG | 0x45e4691e…25e3f8d |
| 4 | 0x1C2fd9039c278abFf765eB3691140C7e8700becb | 0.10 OG | 0x00065248…dcea7d |
| 5 | 0xb7363826db77d030d1A7003C31ab33D2ffe077D4 | 0.10 OG | 0x41d25fb9…2cdf24 |

Setup script: `agents/scripts/setup-agent-wallets.ts` — idempotent. Summary at `logs/agent-wallets.json`.
Review fix W5 RESOLVED.

### Live full-pipeline E2E (proposal #3, agent-driven votes)
Each agent: AXL `/recv` → 0G Compute deliberation → Semaphore proof generation → submitProof
from its OWN wallet. Stack confirmed working end-to-end on Galileo.

- Proposal: "Should the DAO fund a 50,000 USDC security audit for Protocol X by Trail of Bits…" (id 3)
- 5 ProofVerified events on-chain (ALL signal=1 Approve; agents converged):
  - agent 3 → tx 0xd0c820d6951f81b8b8744cdad276df81d3f762ee3056f4f90530b5d0aa93a954 block 30696794
  - agent 5 → tx 0xa295764621354d541337bb24f9e5b3913ad5ecaae027f2a30d972fc1a6b2861f block 30696817
  - agent 4 → tx 0x102434799f2cd561d4c38efd5317557124fc7dc6365fce5cede6532df0221d52 block 30696831
  - agent 2 → tx 0x35e6d307c47403222a090c77c99a50f09cc3ebed0c49ad697c93b317db9372b6 block 30696851
  - agent 1 → tx 0x7ad77fd7953c547a3c66d24299e3974d12cab5f987570fa0a1e20084577394d2 block 30696876
- ProposalResolved (auto-fired in agent-1's tx): approved=true, 5-0
- Per-vote timing: proof generation 423-510 ms (zkey/wasm cache warmed in Session 2);
  total per-agent latency 11-15 s including AXL deliver, deliberation (0G Compute), gas wait.
- Gas used per anonymous vote: 304k–347k (Semaphore Groth16 + DAO tally).

### Live attack tests on Galileo (proposal #4)
All three malicious paths revert as expected. Saved at
`contracts/attack-tests-result.json` and `logs/session4-attacks.log`.

| Attack | Expected revert | Result | Notes |
|:---|:---|:---|:---|
| **B5** Cross-proposal replay (proof.scope=3 against active id=4) | `WrongScope` | ✅ reverted | Scope binding works on-chain |
| **B4** Bogus signal (`proof.message=99`)                      | `InvalidSignal` | ✅ reverted | Tally cannot diverge from proven signal |
| Nullifier reuse (resubmit a valid proof identical bytes)        | `Semaphore__YouAreUsingTheSameNullifierTwice` | ✅ reverted | First submit OK: tx 0xf99b5445…94b80c |

After attack tests, proposal #4 cleaned up with 4 honest votes (agents 1, 2, 4, 5; agent 3
already submitted during the nullifier-reuse first-submit step). Auto-resolved 5-0 Approved
in tx 0x613c0cdf131a4c67e7453e05780785b98f3a154c8f87e13a6d61b519848b0c68.

### Resolved review-checklist items
- W5 — agent wallets funded
- W8 — zkey/wasm cache pre-warmed by Session 2's full-e2e.ts; Session 4 proof generation
  averaged 471 ms (cold first call ~1500 ms); no CDN dependency at demo time
- W9 — `Identity.publicKey` is `[bigint, bigint]`, Baby Jubjub hex derivable

---

## Project rename — ZK Swarm → **Nuncius** (2026-04-30)

The hackathon project is now **Nuncius** (Latin for "messenger" — Galileo's *Sidereus Nuncius*
fits the 0G *Galileo* testnet narrative perfectly). Each agent is named after a real or
literary figure whose voice fits the persona's stance on a proposal:

| Agent | Subname | Persona | One-line vibe |
|---|---|---|---|
| 1 | `pythia.nuncius.eth` | Fiscal conservative analyst | The Oracle weighs auspices before pronouncing |
| 2 | `ziggy.nuncius.eth` | Innovation advocate | Cosmic transformation; embraces uncertainty |
| 3 | `capitan-beto.nuncius.eth` | Risk manager | Spinetta's lone astronaut; weighs the void |
| 4 | `hypatia.nuncius.eth` | Community advocate | Alexandrian polymath; broadest stakeholder set |
| 5 | `ada.nuncius.eth` | Technical reviewer | Lovelace; assesses feasibility |

**Code source of truth**: `agents/shared/personas.ts` — contains agentIndex, ENS label, display
name, persona description, system prompt, and the Identity seed. Imported by both `agents/` and
`ens/scripts/_addresses.ts`.

**Immutable on-chain identity**: the Semaphore Identity *secret seeds* (`zkswarm-e2e-agent-{i}`)
remain unchanged because their bytes hash into the commitments registered in DisputeDAO group
id 1 in Session 4. The display layer above them is what the rename touched.

---

## Session 5 — ENS (PASSED ✅, Sepolia; mainnet swap = 1 env var)

### Why Sepolia
- Deployer mainnet balance was 0 ETH at session start; Sepolia balance was 0.032 ETH.
- ENS Sepolia is real ENS protocol, viewable on https://app.ens.domains by switching the
  network in the top-right corner.
- Mainnet path is identical: `ENS_NETWORK=mainnet npm run register-parent`. Same script,
  different RPC + contract address book in `ens/scripts/_addresses.ts` (verified mainnet
  addresses already wired). Estimated mainnet cost: ~0.005 ETH for parent + ~0.05 ETH gas
  for 5 subnames + 40 setText calls.

### Parent name
- `zkswarm-on-0g.eth` registered for 1 year on Sepolia.
- Commit tx (Sepolia): 0x79279e4d32e96eca113016d0d3ce6ff07aedd6ca07c48187c55941eb48d7f55f
- Register tx (Sepolia): 0x41968b36fc6e2e7409672a83ef48d9538d719ba32d046685e950fe0d094eb810 (block 10762801)
- Cost: 3.28e15 wei (0.00328 ETH) = base 0.003125 + 5% buffer.
- Owner: 0x810A3048375EFe1e13F373b5118945Fe3Eac7f22 (registry shows wrapper address as
  expected for wrapped names).
- App: https://app.ens.domains/zkswarm-on-0g.eth?network=sepolia

### Subnames (each with 8 text records)
Records on every subname:
- `semaphore.pubkey` — Baby Jubjub public key, hex `0x` + 128 hex chars (pkX || pkY)
- `semaphore.commitment` — Identity commitment (decimal)
- `semaphore.groupId` — DisputeDAO group id (1)
- `zkswarm.agentIndex` — 1..5
- `zkswarm.role` — "voter"
- `zkswarm.dao` — DisputeDAO address on Galileo (cross-chain pointer)
- `url` — repo link
- `description` — human readable

| # | Subname | NameWrapper setSubnodeRecord tx |
|---:|:---|:---|
| 1 | voter1.zkswarm-on-0g.eth | 0xb73b… (see logs/ens-subnames.json) |
| 2 | voter2.zkswarm-on-0g.eth | 0xa62462530de1d247b18dff749da92290066aa731c2c22f8f199864b4120ec49c |
| 3 | voter3.zkswarm-on-0g.eth | 0x4bad140b6841b2917fdc76a2a365393f660c0d18fb82450da12726686848a544 |
| 4 | voter4.zkswarm-on-0g.eth | 0x8bcddcdd4969617d4384867d7ce71d66f44d0572d595b28ae3d898f7153e4fd3 |
| 5 | voter5.zkswarm-on-0g.eth | 0xddf793c17b2a902ca2f0f1aa46bdfd04684537fe654e1345659f43f302963a1a |

Total tx count Session 5: 1 commit + 1 register + 5 setSubnodeRecord + 40 setText = **47 txs on Sepolia**.

### On-chain verification
40/40 text records read back correctly via `PublicResolver.text()` — independent of `app.ens.domains`.
See `logs/ens-verify.log` for the full read-back. Pubkeys match the deterministic identities
(seed `zkswarm-e2e-agent-{i}`) registered in DisputeDAO group id 1.

### Verifiable URLs (judges paste these into `app.ens.domains`, switch network=Sepolia)
**Canonical (Nuncius — project rename, 2026-04-30):**
- https://app.ens.domains/pythia.nuncius.eth?network=sepolia       — Pythia
- https://app.ens.domains/ziggy.nuncius.eth?network=sepolia        — Ziggy
- https://app.ens.domains/capitan-beto.nuncius.eth?network=sepolia — Capitán Beto
- https://app.ens.domains/hypatia.nuncius.eth?network=sepolia      — Hypatia
- https://app.ens.domains/ada.nuncius.eth?network=sepolia          — Ada

`nuncius.eth` (Sepolia) — register tx: 0x9e9a16f8d7693b2522faad694e36d222af9c6cc457013660e1958d28e1251e5d (block 10764186)
50/50 text records verified on-chain (10 keys × 5 personas) — see logs/ens-nuncius-verify.log.

**Legacy (pre-rename, kept on Sepolia for chain-of-custody but no longer canonical):**
- https://app.ens.domains/voter1.zkswarm-on-0g.eth?network=sepolia
- https://app.ens.domains/voter2.zkswarm-on-0g.eth?network=sepolia
- https://app.ens.domains/voter3.zkswarm-on-0g.eth?network=sepolia
- https://app.ens.domains/voter4.zkswarm-on-0g.eth?network=sepolia
- https://app.ens.domains/voter5.zkswarm-on-0g.eth?network=sepolia

### Resolved review-checklist items
- W7 — funding obtained (Sepolia path; mainnet pending separate funding)
- W11 — ENS contract addresses verified by `cast code` returning non-empty bytecode for
  ENSRegistry, NameWrapper, PublicResolver, ETHRegistrarController on both Sepolia and Mainnet.
- W9 — confirmed: derived Baby Jubjub pubkey is `[bigint, bigint]` and the on-chain text
  record matches the value re-derived from the secret independently.

### Session 5 Files
- `ens/package.json`, `ens/tsconfig.json`
- `ens/scripts/_addresses.ts` (Sepolia + Mainnet contract address book)
- `ens/scripts/check-name.ts` (availability + price)
- `ens/scripts/register-parent.ts` (commit-reveal idempotent)
- `ens/scripts/register-subnames.ts` (5 subnames + 40 text records, idempotent)
- `ens/scripts/verify-records.ts` (RPC read-back)
- `logs/ens-parent.log`, `logs/ens-subnames.log`, `logs/ens-subnames.json`, `logs/ens-verify.log`

---

## Final Submission Addresses

| Contract          | Address                                      | Network    |
|-------------------|----------------------------------------------|------------|
| PoseidonT3 (lib)  | 0xBa04c3B5A5Ba984A0E3DFA359b5F90566c313A1e   | 0G Galileo |
| SemaphoreVerifier | 0xCa5dbA14bBB19a72F4A36c088c1d437d8C0Cb3E1   | 0G Galileo |
| Semaphore         | 0x3a546a753621100c7A569555FA2F081A3D761410   | 0G Galileo |
| DisputeDAO        | 0x650c074910bC5855f6573f9d62EE5b8bA90664D9   | 0G Galileo |

---

## Test Runs

### Run 1 — Session 2 bonus full E2E (single deployer signed all 5 anonymous votes)
- Proposal: "[E2E smoke] Fund 50k USDC audit for Protocol X" (id 1)
- Opened tx:    0x53171a6ddb0f6e0990b00a0f2ff4c04706f3a549efd06e844436889c6af205b0 (block 30624039)
- addVoter txs: 0x428895a8…1cc60e, 0x905be2b2…03b263, 0x61736185…cb85e, 0x3eefdb83…59e07, 0x3ef88c74…b0719d
- Proof 1 tx (Approve, agent 1): 0x10307fef2eff2e23ffc64b391183f6cf060ac215d348d37add9491b20311063a (block 30624060)
- Proof 2 tx (Approve, agent 2): 0xe5cdefcd211e614fdff44f4b5bd34e8dc64a63ea6d89020ed896510d2b5c616a (block 30624077)
- Proof 3 tx (Reject,  agent 3): 0xa777e622c7cc6aee46cc09ed234efba79f6b146d589b32a05cdce66d8dc602fe (block 30624095)
- Proof 4 tx (Approve, agent 4): 0x8d943c0ff8fe2c78ebb54e0b482119bbaeb6e570da4ac80e8a7bf2ef7f157699 (block 30624112)
- Proof 5 tx (Reject,  agent 5): 0x1f58c359aed3356f84287eaec337824ea659dcfe7d613ecb84b1869998564da9 (block 30624130)
- Resolution: emitted in proof-5 tx; ProposalResolved(approveCount=3, rejectCount=2, approved=true)
- Outcome: APPROVED 3-2

### Run 2 — Session 2 standalone open-proposal smoke
- Proposal: "[smoke] open-proposal.ts standalone test" (id 2, opened via scripts/open-proposal.ts)
- Opened tx: 0xa338a4a8c7593bde6325e601eb73e0c64882b3c022ff01fe94500e02439e75f2 (block 30624300)
- Status: ACTIVE — proposal #2 deliberately left open to demonstrate ActiveProposalExists guard
  (subsequent openProposal call reverted on-chain as expected)

### Run 3 — Session 3 cleanup (proposal #2 closed via 5 votes)
- Proposal: id 2 (still "[smoke] open-proposal.ts standalone test")
- Proof txs: 0xf8b951e3…3b2738 (A1 Approve), 0x71936a76…0b7192 (A2 Approve), 0xf3a14081…91f7ba (A3 Reject),
            0x3e2ab497…1f8b66 (A4 Approve), 0xd8b58263…0f0851d (A5 Reject)
- Resolution: emitted in proof-5 tx; ProposalResolved(approveCount=3, rejectCount=2, approved=true)
- Outcome: APPROVED 3-2

### Run 5 — Session 4 anonymous voting E2E (5 agents submit own anonymous proofs)
- Proposal: id 3 (re-used active proposal from Run 4)
- Each agent submits from its OWN wallet (NOT the deployer):
  - agent 3 (wallet 0x6B12F53b…) → tx 0xd0c820d6951f81b8b8744cdad276df81d3f762ee3056f4f90530b5d0aa93a954 (block 30696794)
  - agent 5 (wallet 0xb7363826…) → tx 0xa295764621354d541337bb24f9e5b3913ad5ecaae027f2a30d972fc1a6b2861f (block 30696817)
  - agent 4 (wallet 0x1C2fd903…) → tx 0x102434799f2cd561d4c38efd5317557124fc7dc6365fce5cede6532df0221d52 (block 30696831)
  - agent 2 (wallet 0x2654512a…) → tx 0x35e6d307c47403222a090c77c99a50f09cc3ebed0c49ad697c93b317db9372b6 (block 30696851)
  - agent 1 (wallet 0x5f179FEA…) → tx 0x7ad77fd7953c547a3c66d24299e3974d12cab5f987570fa0a1e20084577394d2 (block 30696876)
- Resolution (auto-fired in agent-1's tx): ProposalResolved(approved=true, 5-0)
- Outcome: APPROVED 5-0 (agents converged on Approve given the proposal's clear deliverable
  and Trail of Bits as auditor; lively split would require more contentious proposals)
- Anonymity property: scanning the 5 vote txs reveals 5 distinct signers, none of which is the
  deployer. The contract sees 5 valid Groth16 proofs against group id 1 — but cannot link any
  signer to a specific commitment.

### Run 6 — Session 4 live attack tests (proposal #4)
- Proposal: "[B4/B5 attack tests] proposal — should resolve cleanly after honest votes" (id 4)
- Opened tx: 0x4ba70d1ddd732fc41b35acc80b54df124e833fe775a1ecece00124ffafe81d5f
- Attack 1 (B5 wrong-scope): proof.scope=3 against active id=4 → reverted ✅
- Attack 2 (B4 invalid-signal): proof.message=99 → reverted ✅
- Attack 3 (nullifier reuse): first submit ok @ 0xf99b544548205b5315f17fdf5d7b626b4e710747562cb5ced7743955e494b80c,
  same proof submitted again → reverted ✅
- Cleanup: 4 honest Approve votes auto-resolve at vote 5 (counting the nullifier-reuse first submit):
  - agent 1: 0x5f7b412e9189c15e1e613d625e3411bfb9ae3e38037fde70c974edd04ea198fc
  - agent 2: 0xc6ceddafd1b46228be9a5145efe63296edadff8e08695365fa4257370c55d38c
  - agent 4: 0x8daeadc2b0acf09bdac8be7d59e3b3bf9088e3c210e4ba3e9f92b5d9de04c1e1
  - agent 5: 0x613c0cdf131a4c67e7453e05780785b98f3a154c8f87e13a6d61b519848b0c68
- Resolution: ProposalResolved(approved=true, 5-0)

### Run 4 — Session 3 full deliberation E2E (5 AXL nodes + 5 agents + 0G Compute)
- Proposal: "Should the DAO fund a 50,000 USDC security audit for Protocol X by Trail of Bits, payable on completion of report deliverables?" (id 3)
- Opened tx: 0x463fb81bb00980e66559cbd6272bb8f2c4119a5bd7167a8ce276c69d8d13eb35 (block 30682540)
- Status: ACTIVE — Session 3 stops at deliberation; Semaphore proof submission lands in Session 4.
- Deliberation outcomes (all via 0G Compute, model qwen/qwen-2.5-7b-instruct):
  - agent 1: Approve (conf 0.90, 7042ms) — fiscal-conservative persona
  - agent 2: Approve (conf 0.90, 6857ms) — innovation-advocate persona
  - agent 3: Approve (conf 0.95, 24420ms) — risk-manager persona
  - agent 4: Approve (conf 0.90, 9967ms) — community-advocate persona
  - agent 5: Approve (conf 0.90, 9905ms) — technical-reviewer persona
- Note: every persona converged on Approve at temp=0 — qwen-2.5-7b doesn't role-play disagreement
  strongly enough. For a livelier demo in Session 4, either pick a more contentious proposal,
  raise temperature, or strengthen each persona's veto-leaning system prompt.


## Session 2 — DisputeDAO Deployment (2026-04-30T02:41:21.505Z)

- Network: galileo (chainId 16602)
- Deployer: 0x810A3048375EFe1e13F373b5118945Fe3Eac7f22
- Semaphore (Session 1): 0x3a546a753621100c7A569555FA2F081A3D761410
- DisputeDAO: 0x650c074910bC5855f6573f9d62EE5b8bA90664D9
- Group id: 1
- Deploy tx: 0x793c3c44e78903a7646385d5069949b97ed800ffab58eae0314cfa53fb8c34e1
- Explorer: https://chainscan-galileo.0g.ai/address/0x650c074910bC5855f6573f9d62EE5b8bA90664D9

---

## Session 6 — Frontend Observatorium (PASSED ✅)

The dashboard centerpiece for the demo video. Sidereus Nuncius aesthetic — vellum codex
panels on a deep lapis night sky, EB Garamond + JetBrains Mono, ink-bloom on hover, quill-stroke
animation on new event entries, illuminated-capital APPROBATVR / REPROBATVR verdict overlay.

### Stack
- Next.js 16 (Turbopack) + React 19 + Tailwind CSS v4
- ethers v6 against Galileo RPC for view calls + queryFilter event scan
- EB Garamond and JetBrains Mono via `next/font/google`
- Custom monochrome SVG glyphs (5 personas + 5 moon phases + reticle + ornament)
- `usePolling` hook lifted from the prior Delibera frontend

### Pages built
- `/`               — landing hero: NUNCIUS title, narrative, 5 persona glyphs, CTA into observatorium
- `/observatorium`  — main dashboard, four plates: TAB. I Constellatio · TAB. II Quaestio ·
                      TAB. III Ephemeris · TAB. IV Voces; full-screen Verdict overlay on resolution

### Components
- `PlatePanel` — codex card with Roman plate number ("Tab. I"), italic Garamond title, ornamental rule
- `Constellatio` — pentagon SVG, 5 persona stars, full mesh of constellation lines that pulse when active
- `Quaestio` — proposal card with moon-phase glyph (New → Crescent → Half → Gibbous → Full = lifecycle),
              drop-cap on description, three-tile tally (Approbatur / Reprobatur / Quorum)
- `PersonaCard` (×5) — vellum card with persona glyph, name, italic blurb, ENS subname, decision
                       badge, italic reasoning, tx hash (linked to Galileo explorer)
- `Ephemeris` — event feed with reticle markers for ProofVerified, crescent for ProposalOpened, full
                moon for ProposalResolved; `stroke-dasharray` quill-stroke animation for new entries
- `Verdict` — modal overlay with massive illuminated capital `A` (celadon = APPROBATVR) or `R`
              (vermilion = REPROBATVR), Latin ceremonial title + English gloss, sepia ink-wash bloom
              behind. Auto-fires only when the latest ProposalResolved is within 100 blocks (≈5 min)
              so stale resolutions don't ambush page loads.

### Live E2E captured (proposal #6 on Galileo)
- Description: "Should the Nuncius DAO commit 50,000 USDC to a quarterly grant cycle for independent
  ZK research, prioritizing Semaphore V5 contributions?"
- Open tx     : 0x67cd25c45869eb0b81ed... (block 30807052)
- 5 anonymous votes from 5 distinct agent wallets:
  - Pythia       → tx 0xec467b16…d66988 (Approve, conf 0.85)
  - Ziggy        → tx 0xba257c84…99d627 (Approve, conf 0.90)
  - Capitán Beto → tx 0xf2eea048…8e3199 (Approve, conf 0.90)
  - Hypatia      → tx 0x0846a48a…35ccf9 (Approve, conf 0.90)
  - Ada          → tx 0xdf5036a0…8eb8be (Approve, conf 0.50)
- ProposalResolved: tx 0xec467b16…d66988 (auto-fired in 5th vote tx, block 30807142)
- Outcome: APPROBATVR 5-0
- Saved screenshots: logs/screenshot-deliberating-clean.png (mid-vote, 4/5 quorum visible),
  logs/screenshot-verdict-fresh.png (illuminated capital reveal),
  logs/screenshot-final-resolved.png (full dashboard post-verdict, all 5 personas voted).

### W2 (frontend reads from 0G-KV) — DEFERRED
The KV reader endpoint published in 0G docs (`http://3.101.147.150:6789`) remains silent on Galileo
(see Session 3 finding). Frontend instead reads `ProofVerified` / `ProposalResolved` events directly
from Galileo RPC — that's the most judge-visible animation source anyway, and KV writes already
satisfy the "uses 0G Storage KV" prize qualification. If a working KV reader endpoint surfaces, plug
it into `frontend/lib/agents.ts` as an alternative status path.

### CORS
Agents (Hono on :4001-:4005) needed `cors({ origin: "*" })` middleware so the dashboard at
:3000 can fetch /status, /last-deliberation, /last-vote. Patched in `agents/voter/src/index.ts`.

### Files
- `frontend/app/{layout,page}.tsx`, `frontend/app/observatorium/page.tsx`
- `frontend/app/globals.css` (Sidereus Nuncius palette + animations)
- `frontend/components/{PlatePanel,Constellatio,Quaestio,PersonaCard,Ephemeris,Verdict}.tsx`
- `frontend/lib/{use-polling,personas,dao,agents,format}.ts`
- `frontend/public/glyphs/{pythia,ziggy,capitan-beto,hypatia,ada,moon-{new,crescent,half,gibbous,full},reticle,ornament}.svg`
- `frontend/.env.local` (NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_DISPUTE_DAO_ADDRESS)
- `agents/voter/src/index.ts` — CORS middleware added

### How to record the demo (3-min video)
1. `BACKGROUND=1 ./scripts/start-axl.sh`
2. `(cd agents && npm run start:all)`
3. `(cd frontend && npm run dev)` then open http://localhost:3000/observatorium at 1920×1080
4. `(cd agents && PROPOSAL_DESCRIPTION="<question>" npm run trigger)`
5. The dashboard animates: Constellatio personas wake, Quaestio fills, Ephemeris streams 5 ProofVerified
   entries with quill-stroke writing, Verdict illuminated capital fires within ~90 s.
