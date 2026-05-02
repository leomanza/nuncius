# Architecture

A technical companion to the [`README`](./README.md). This document explains *why* Nuncius is shaped the way it is and *what* we proved on-chain — including the patches we applied to the original spec after live testing on Galileo.

---

## 1. The thesis

ERC-8004 (Feb 2026) gave on-chain agents public, persistent identities. That is a strict improvement over anonymous bots — but it creates a new problem: **public identity creates retaliation risk in coordination games.**

A small voter agent in a DAO has every incentive to vote with the largest agent in the room, even when its honest vote would have been the opposite, because a public vote against a powerful agent means a public reputation hit later. This is the same reason secret ballots exist for humans. Semaphore solved it for humans in 2020. **Nuncius is the equivalent layer for agent swarms.**

The core property we want is: **the contract verifies each vote was cast by a member of the registered group, with a unique nullifier, against the current proposal — but cannot link any vote to a specific member.** Aggregate tally on-chain, individual vote unlinkable.

---

## 2. End-to-end flow

A single proposal lifecycle, real values from proposal #6 (block 30807052 → 30807142, ~90s wall clock):

```
[Coordinator]                                          [0G Galileo]
  │
  │  openProposal(description)
  ├────────────────────────────────────────────────────────►  ProposalOpened(id=6)
  │
  │  fan-out PROPOSAL_BROADCAST envelopes
  │  via AXL /send to each peer
  ▼
[Agent 1..5]
  │  (each receives over Yggdrasil-encrypted P2P)
  │
  │  ── 0G Compute: deliberate (qwen-2.5-7b, persona prompt, temp=0)
  │     decision: { signal: 1|2, confidence, reasoning }
  │
  │  ── 0G Storage KV: write { phase, decision, lastReasoning } to
  │     keccak256(daoAddress ‖ "agent" ‖ index)
  │
  │  ── Semaphore: generate Groth16 proof
  │     scope = currentProposalId, message = signal, ~470ms warm
  │
  │  submitProof(SemaphoreProof)
  │  signed by agent's OWN wallet (not the deployer)
  └────────────────────────────────────────────────────────►  ProofVerified ×5
                                                                ProposalResolved(approved=true, 5-0)
                                                                in the 5th vote tx
```

**Anonymity invariant.** Inspecting the 5 vote txs on chainscan-galileo reveals 5 distinct `from` addresses — none of which is the deployer. The contract can verify each proof is valid against group id 1, but it has no way to bind a `from` address to a specific commitment in the Merkle tree. Verified live on proposal #3 (Session 4) and again on proposal #6 (Session 6).

---

## 3. Component deep dives

### 3.1 `DisputeDAO.sol` — the settlement layer

Solidity 0.8.23, deployed on 0G Galileo at [`0x650c0749…64D9`](https://chainscan-galileo.0g.ai/address/0x650c074910bC5855f6573f9d62EE5b8bA90664D9). Built around the `ISemaphore` interface from `@semaphore-protocol/contracts`.

**Lifecycle:**
- `openProposal(description)` — owner-only. Reverts with `ActiveProposalExists` if a proposal is still open. Sets `currentProposalId` to a new id and emits `ProposalOpened`.
- `addVoter(commitment)` — owner-only. Adds the commitment to the underlying Semaphore group (the contract IS the group admin, so only it can mutate membership).
- `submitProof(SemaphoreProof)` — anyone, but verified.
- `forceResolve()` — owner fallback once `QUORUM` (3) votes are in. Auto-resolution at full membership runs in the last `submitProof`.

**Two patches relative to the original spec, both motivated by attack reasoning during Session 0 review and verified by live tests in Session 4:**

| ID | Spec said | Problem | Patch in `DisputeDAO.sol` |
|---|---|---|---|
| **B4** | `submitProof(proof, signal)` — pass signal as a separate arg | A valid "Approve" proof could be replayed as "Reject" because the tallied signal isn't bound to the proof. | Drop the `signal` arg. Tally `proof.message` directly. Reject any `proof.message ∉ {1, 2}` with `InvalidSignal`. |
| **B5** | Trust Semaphore's nullifier to prevent replay | Semaphore's nullifier is *scope-specific*. If a proof is minted for proposal #1, and later proposal #2 uses the same group, the nullifier check alone wouldn't block a cross-proposal replay. | Require `proof.scope == currentProposalId`. Revert with `WrongScope` otherwise. |

**Verified on-chain (Session 4, proposal #4):**
- Cross-proposal replay (B5): submit a proof with `scope=3` against active id `4` → reverted with `WrongScope`.
- Bogus signal (B4): submit a proof with `proof.message=99` → reverted with `InvalidSignal`.
- Nullifier reuse: re-submit identical proof bytes → reverted with `Semaphore__YouAreUsingTheSameNullifierTwice`.

All three reverts captured in `logs/session4-attacks.log` and `contracts/attack-tests-result.json`.

**Auto-resolution in the same tx as the final vote.** When the Nth vote arrives and `totalVotes == memberCount`, `_resolve` runs in the same call. This is what fires `ProposalResolved` inside the 5th `submitProof` tx — convenient for the dashboard's verdict animation, since one event subscription catches both proof and resolution.

### 3.2 Semaphore V4 on 0G Galileo — proven, with a deploy patch

The original plan had a fallback to Base Sepolia in case BN254 pairing precompiles misbehaved on Galileo. They don't — Semaphore V4 deployed cleanly and a real Groth16 fixture proof verified in `validateProof` (tx `0x07f478f6…f71e468`, block 30607505).

**One spec patch:** the Session 0 plan listed a 2-step deploy (Verifier → Semaphore). The real path is **3 steps**: PoseidonT3 (library) → SemaphoreVerifier → Semaphore (linked against PoseidonT3). The linked library is required because the upstream Semaphore contract references PoseidonT3 by external library symbol. Without this step, `createGroup` reverts on the first call. Documented in [`DEPLOY_LOG.md`](./DEPLOY_LOG.md) and called out for future builders in [`FEEDBACK.md`](./FEEDBACK.md).

**Proof generation timing.** Cold call ~1500ms (zkey/wasm download). Warm calls 423–510ms across the 5 agents in the live E2E. The cache warms on the agent's first proof — by demo time the per-vote latency budget is dominated by AXL deliver + 0G Compute (~7–24s) and Galileo gas confirmation (~2s), not proof gen.

### 3.3 Gensyn AXL — peer-to-peer agent mesh

Five separate AXL nodes, one per agent, in a spoke topology (node-1 listens on `tls://0.0.0.0:9001`; nodes 2–5 dial it). Each node has a unique `api_port` (10001…10005) and all share `tcp_port: 7000` over Yggdrasil's gVisor stack — that's the dial port over Yggdrasil's encrypted overlay, not a host port, so the shared value is correct.

**Validated:** multi-hop routing — a `/send` from node-2 to node-5 (which has no direct peer entry to node-2) succeeds via node-1. Captured in `logs/axl-mesh-boot.log`.

**Real API surface, vs. the documented one** (notes from Session 1):
- AXL config schema is `{ PrivateKeyPath, Peers, Listen, api_port, bridge_addr, tcp_port }` — the snake_case shape some docs imply does not match the binary at commit `9cba555`.
- AXL has **no GossipSub primitive**. The "broadcast" verb is implemented by the coordinator iterating peers and issuing per-peer `/send` calls. This is fine for 5 nodes; for larger swarms a dedicated pubsub layer would be needed.
- `X-From-Peer-Id` header on `/recv` is **truncated and right-padded with `f`s** — only the first ~26 hex chars match the actual sender pk. Routing is fine, but downstream code must use prefix matching, not full-string equality. We hit this and fixed it in `agents/shared/axl-client.ts`.

All three findings are fed back to Gensyn in [`FEEDBACK.md`](./FEEDBACK.md).

### 3.4 0G Storage KV — agent working memory

Each agent writes its phase transitions (`IDLE → DELIBERATING → PROVING → VOTED`), its last decision, and the tail of its reasoning to a per-agent KV stream:

```
streamId = keccak256(daoAddress ‖ "agent" ‖ agentIndex)
```

Salting with the DAO address is intentional (review item W1): without it, deploying a second DAO would alias agent-1's state across deployments. Each agent emitted multiple Flow contract txs during Session 3 — see `logs/agents-stdout.log` for the hash trail.

**One known gap.** The KV reader endpoint published in 0G's docs (`http://3.101.147.150:6789`) is silent on Galileo today (writes land on-chain via the Flow contract; the documented reader doesn't reply). Rather than block on this, the dashboard reads `ProposalOpened`/`ProofVerified`/`ProposalResolved` events directly from the Galileo RPC — the most judge-visible animation source anyway — and treats KV writes as committed off-chain working memory. The "uses 0G Storage KV" prize qualification is satisfied by the writes themselves; reads happen through agent HTTP. Documented in [`FEEDBACK.md`](./FEEDBACK.md).

### 3.5 0G Compute — deliberation

Deliberation runs on 0G Compute against `qwen/qwen-2.5-7b-instruct` (provider `0xa48f0128…7836`). The original plan named `deepseek-ai/DeepSeek-R1-70B`; that model isn't online on Galileo right now, so the agent's compute client picks the live qwen provider via `listService()` at startup — surviving provider rotation without code changes.

**Two sharp edges, both worth a doc note** (see [`FEEDBACK.md`](./FEEDBACK.md)):
- The chat-completions URL is `<getServiceMetadata.endpoint>/chat/completions`, not `<url>/v1/chat/completions`. The provider's URL already contains a `/v1/proxy` segment that `getServiceMetadata` returns. Hard-coding `/v1/chat/completions` against the bare URL gives a 404.
- `broker.inference.processResponse(...)` returned a "getting signature error" on every call — non-fatal (the inference itself was billed correctly via headers) but noisy. We log and continue.

**Persona implementation.** `agents/shared/personas.ts` is the single source of truth: each persona has an index, ENS label, display name, system prompt, and Identity seed. The system prompt nudges each persona toward a different vote-weighing posture (fiscal conservative, innovation advocate, risk manager, community advocate, technical reviewer). At `temperature=0` the qwen model rarely role-plays disagreement strongly — see Session 3 / 6 logs where all five converged on Approve. This is a model behavior, not a bug; livelier demos would warrant temp ≥0.3 or stronger veto-leaning prompts.

### 3.6 ENS — discoverable anonymous keys

The clever bit: each persona's anonymous-voting public key is published to a human-readable name. You can paste `pythia.nuncius.eth` into `app.ens.domains` (network: Sepolia) and read out the Baby Jubjub pubkey directly from the resolver, without trusting any indexer.

**Records per subname (10):**

| Key | Value |
|---|---|
| `semaphore.pubkey` | Baby Jubjub pubkey, `0x` + 128 hex chars (pkX ‖ pkY) |
| `semaphore.commitment` | Identity commitment (decimal) |
| `semaphore.groupId` | DisputeDAO group id, `1` |
| `zkswarm.agentIndex` | 1..5 |
| `zkswarm.role` | `voter` |
| `zkswarm.dao` | DisputeDAO address on **0G Galileo** — cross-chain pointer |
| `url` | repo link |
| `description` | human-readable persona blurb |
| `avatar` | persona glyph URL |
| `name` | display name |

**Cross-chain pointer.** A subname on Sepolia ENS resolves a verifier-side address on 0G Galileo. ENS becomes the directory for an off-chain cryptographic identity that's *used* on a different chain. (Mainnet path is identical: `ENS_NETWORK=mainnet npm run register-parent` — same script, same code, same address book.)

**On-chain verification.** All 50 text records (10 keys × 5 personas) read back correctly via `PublicResolver.text()`. The Baby Jubjub pubkey on each record matches the value re-derived from the secret seed independently, so the pubkey-↔-commitment binding is provable from public data only.

---

## 4. Threat model

The properties we claim and what backs each one:

| Property | Backed by | Verified |
|---|---|---|
| Vote unlinkability | Semaphore Groth16 + on-chain group; agents sign txs from per-agent wallets | 5 distinct signers on proposals #3 and #6, none = deployer |
| No double-voting (per proposal) | Semaphore nullifier, scope-bound | Live nullifier-reuse attack reverted (Session 4) |
| No cross-proposal replay | `proof.scope == currentProposalId` check | Live wrong-scope attack reverted (B5) |
| No signal forgery | Tally reads `proof.message` directly | Live invalid-signal attack reverted (B4) |
| No central message broker | Gensyn AXL multi-hop routing on Yggdrasil | node-2 → node-5 via node-1 captured in logs |
| Anonymous keys publicly discoverable | ENS PublicResolver text records | 50/50 records read back, pubkey ↔ commitment derivation cross-checked |

What we explicitly **don't** claim:
- **Sybil resistance.** Membership is owner-gated (`addVoter`). Production usage would gate on something like ERC-8004 reputation; the MVP is owner-of-DAO.
- **Coercion resistance.** A coordinating attacker who controls multiple agents' secret seeds can correlate their proofs off-chain. The protocol prevents *the contract* from linking — it doesn't prevent collusion among agents who trust each other off-chain.
- **Front-running anonymity.** A determined observer of mempool patterns may glean weak signal from tx ordering. Out of scope for the MVP.

---

## 5. Design decisions and tradeoffs

**Why scope = proposalId, not a fresh group per proposal?**
Cheaper. A fresh Semaphore group per proposal would cost an `addMember` per voter per proposal — 5× more `O(log n)` Merkle work and 5× more on-chain calls. Scope-binding the proof against the current proposal id achieves the same isolation without group churn. The only place this falls down is if you wanted *different membership per proposal*, which the MVP doesn't need.

**Why one active proposal at a time?**
Same scope variable. `currentProposalId` doubles as the scope every proof must commit to. Supporting concurrent proposals would require either per-proposal scope passing (fine, just bookkeeping) or per-proposal groups (expensive). Easy follow-up if needed.

**Why HTTP from frontend → agent, instead of dashboard reading 0G KV directly?**
The 0G KV reader endpoint is silent right now (Section 3.4). Polling agents over HTTP is a localhost fallback that keeps the dashboard responsive; KV writes still happen and still satisfy the prize qualification. When the reader endpoint stabilizes, swap `frontend/lib/agents.ts` to read KV instead — single file change.

**Why agents sign their own vote txs, not the deployer?**
Anonymity. If the deployer signed every vote tx, the on-chain `from` field would link every vote to the same address — even though the proofs are unlinkable, the gas-payer pattern would leak. Each agent has its own funded wallet (Session 4) so the 5 vote txs come from 5 distinct signers.

---

## 6. What we'd build next

In order of reach:

1. **Plug ERC-8004 in front of `addVoter`.** Replace the owner gate with a reputation threshold check. The membership story becomes "agents above reputation X can join this DAO's voter group" — and Nuncius becomes the privacy layer that makes ERC-8004 reputation actually usable in coordination.
2. **Concurrent proposals.** Pass scope explicitly per proposal (small refactor to `submitProof`). Group remains shared.
3. **Working KV reader path.** Either find the live 0G KV endpoint or run a self-hosted reader. Move dashboard to consume KV directly.
4. **Stronger persona disagreement at temp=0.** Re-tune prompts toward veto-leaning behavior, or move to a model that role-plays better at low temperatures. The technical pipeline is fine; the demo just looks more interesting when 5-0 is sometimes 3-2.
5. **Coercion-resistant variant.** A path that makes even off-chain collusion harder — likely involves a shared randomness beacon or per-vote freshness tokens.

---

## Appendix — file map

| Layer | Path |
|---|---|
| Solidity contract | `contracts/contracts/DisputeDAO.sol` |
| Deploy + attack scripts | `contracts/scripts/{deploy,full-e2e,live-attack-tests,verify-resolution,open-proposal,force-close}.ts` |
| Voter agent runtime | `agents/voter/src/{index,axl-handler,deliberate,vote}.ts` |
| Shared agent utilities | `agents/shared/{axl-client,semaphore-utils,0g-compute-client,0g-kv-client,personas,types}.ts` |
| AXL configs (5 nodes) | `axl/node-{1..5}.json` |
| AXL boot script | `scripts/start-axl.sh` |
| ENS scripts | `ens/scripts/{register-parent,register-subnames,verify-records,_addresses}.ts` |
| Dashboard | `frontend/app/{page,observatorium/page}.tsx` + `frontend/components/*.tsx` |
| Test runs (raw logs, screenshots) | `logs/` |
| Per-session decisions and tx hashes | `DEPLOY_LOG.md` |
