"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliberate = void 0;
const _0g_compute_client_1 = require("../../shared/0g-compute-client");
const personas_1 = require("../../shared/personas");
const MANIFESTO = `Nuncius DAO manifesto:
- Fund proposals that advance decentralized AI governance.
- All spending must have clear accountability mechanisms.
- Favor proposals with measurable outcomes over vague mandates.
- Security and privacy are non-negotiable.`;
const RESPONSE_SHAPE = `Reply with ONLY a JSON object — no markdown, no commentary:
{
  "decision": "Approve" | "Reject",
  "reasoning": "<2-3 sentence explanation>",
  "confidence": <number between 0.0 and 1.0>
}`;
/// Strip reasoning-model think blocks then parse JSON.
function extractJson(raw) {
    let cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/```json\s*|```/g, "")
        .trim();
    // Some models emit prose before/after the JSON — extract the first {...} block.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start)
        cleaned = cleaned.slice(start, end + 1);
    return JSON.parse(cleaned);
}
async function deliberate(agentIndex, proposalDescription) {
    const p = (0, personas_1.getPersonaByIndex)(agentIndex);
    const system = `${p.systemPrompt}\n\n${MANIFESTO}\n\nYou are voting as an anonymous AI agent. Your individual vote is unlinkable; only the aggregate tally is public.\n\n${RESPONSE_SHAPE}`;
    const user = `Proposal: ${proposalDescription}\n\nReply with the JSON object only.`;
    const result = await (0, _0g_compute_client_1.callComputeInference)(system, user, { maxTokens: 400, temperature: 0 });
    let parsed;
    try {
        parsed = extractJson(result.text);
    }
    catch (err) {
        console.warn(`[agent ${agentIndex}] JSON parse failed (${err}); falling back to keyword sniff`);
        const lower = result.text.toLowerCase();
        parsed = {
            decision: lower.includes("approve") && !lower.includes("reject") ? "Approve" : "Reject",
            reasoning: result.text.slice(0, 240),
            confidence: 0.5,
        };
    }
    const decision = parsed.decision === "Approve" ? "Approve" : "Reject";
    const confidence = typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "[no reasoning provided]";
    return {
        decision,
        reasoning,
        confidence,
        source: result.source,
        elapsedMs: result.elapsedMs,
        rawText: result.text,
        displayName: p.displayName,
    };
}
exports.deliberate = deliberate;
