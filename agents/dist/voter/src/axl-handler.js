"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProposal = exports.isProposalBroadcast = void 0;
const axl_client_1 = require("../../shared/axl-client");
const deliberate_1 = require("./deliberate");
const vote_1 = require("./vote");
const _0g_kv_client_1 = require("../../shared/0g-kv-client");
const personas_1 = require("../../shared/personas");
function isProposalBroadcast(msg) {
    return msg && msg.type === "PROPOSAL_BROADCAST" && typeof msg.payload === "object" && msg.payload !== null;
}
exports.isProposalBroadcast = isProposalBroadcast;
async function handleProposal(agentIndex, msg, daoAddress, setStatus, opts = {}) {
    const persona = (0, personas_1.getPersonaByIndex)(agentIndex);
    const tag = persona.displayName;
    const env = msg.payload;
    if (!isProposalBroadcast(env)) {
        console.warn(`[${tag}] ignored non-proposal message: type=${env?.type}`);
        return;
    }
    const payload = env.payload;
    const proposalId = payload.proposalId;
    console.log(`[${tag}] received proposal #${proposalId}: ${payload.description}`);
    // ── 1) Deliberate ─────────────────────────────────────────────────
    setStatus({
        state: "deliberating",
        proposalId,
        description: payload.description,
        startedAt: Date.now(),
    });
    void (0, _0g_kv_client_1.writeAgentState)(daoAddress, agentIndex, {
        state: "deliberating",
        proposalId,
        description: payload.description,
        startedAt: Date.now(),
    }).catch((e) => console.warn(`[${tag}] kv write (deliberating) failed:`, String(e)));
    const deliberation = await (0, deliberate_1.deliberate)(agentIndex, payload.description);
    console.log(`[${tag}] decision=${deliberation.decision} confidence=${deliberation.confidence.toFixed(2)} src=${deliberation.source} elapsed=${deliberation.elapsedMs}ms`);
    console.log(`[${tag}] reasoning: ${deliberation.reasoning}`);
    opts.onDeliberation?.(deliberation);
    void (0, _0g_kv_client_1.writeAgentState)(daoAddress, agentIndex, {
        state: "voting",
        proposalId,
        reasoning: deliberation.reasoning,
        confidence: deliberation.confidence,
        decision: deliberation.decision,
        source: deliberation.source,
        updatedAt: Date.now(),
    }).catch((e) => console.warn(`[${tag}] kv write (voting) failed:`, String(e)));
    setStatus({
        state: "voting",
        proposalId,
        reasoning: deliberation.reasoning,
        confidence: deliberation.confidence,
        decision: deliberation.decision,
        source: deliberation.source,
        updatedAt: Date.now(),
    });
    if (opts.skipVote) {
        console.log(`[${tag}] skipVote=true — stopping after deliberation`);
        return;
    }
    // ── 2) Generate Semaphore proof + submit on-chain (Session 4) ─────
    let cast;
    try {
        cast = await (0, vote_1.castAnonymousVote)(agentIndex, proposalId, deliberation.decision, daoAddress);
        if (cast.alreadyVoted) {
            console.log(`[${tag}] already voted on #${proposalId} — skipping duplicate`);
            setStatus({ state: "voted", proposalId, decision: deliberation.decision, updatedAt: Date.now() });
            return;
        }
        if (cast.alreadyResolved) {
            console.log(`[${tag}] proposal #${proposalId} already resolved — nothing to do`);
            setStatus({ state: "idle" });
            return;
        }
        console.log(`[${tag}] PROOF SUBMITTED tx=${cast.txHash} block=${cast.blockNumber} ` +
            `proofGen=${cast.proofGenerationMs}ms total=${cast.totalElapsedMs}ms wallet=${cast.agentWalletAddress.slice(0, 10)}…`);
        opts.onVote?.(cast);
    }
    catch (err) {
        const msg = err?.shortMessage || err?.message || String(err);
        console.error(`[${tag}] vote submission failed: ${msg}`);
        setStatus({ state: "error", proposalId, error: msg, updatedAt: Date.now() });
        void (0, _0g_kv_client_1.writeAgentState)(daoAddress, agentIndex, {
            state: "error",
            proposalId,
            error: msg,
            updatedAt: Date.now(),
        }).catch((e) => console.warn(`[${tag}] kv write (error) failed:`, String(e)));
        return;
    }
    setStatus({
        state: "voted",
        proposalId,
        txHash: cast.txHash,
        decision: deliberation.decision,
        reasoning: deliberation.reasoning,
        confidence: deliberation.confidence,
        source: deliberation.source,
        updatedAt: Date.now(),
    });
    void (0, _0g_kv_client_1.writeAgentState)(daoAddress, agentIndex, {
        state: "voted",
        proposalId,
        txHash: cast.txHash,
        decision: deliberation.decision,
        updatedAt: Date.now(),
    }).catch((e) => console.warn(`[${tag}] kv write (voted) failed:`, String(e)));
    // ── 3) Notify the coordinator over AXL (does NOT reveal the vote) ─
    if (opts.coordinatorPeerId && opts.axl) {
        const ack = {
            type: "VOTE_COMPLETE",
            from: `agent-${agentIndex}`,
            proposalId,
            timestamp: Date.now(),
            payload: {
                from: `agent-${agentIndex}`,
                proposalId,
                txHash: cast.txHash,
            },
        };
        (0, axl_client_1.sendDirect)(opts.axl, opts.coordinatorPeerId, ack).catch((e) => console.warn(`[${tag}] VOTE_COMPLETE ack failed: ${e}`));
    }
}
exports.handleProposal = handleProposal;
