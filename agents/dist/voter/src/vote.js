"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.castAnonymousVote = void 0;
const ethers_1 = require("ethers");
const semaphore_utils_1 = require("../../shared/semaphore-utils");
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
async function castAnonymousVote(agentIndex, proposalId, decision, daoAddress) {
    const t0 = Date.now();
    const agentPk = process.env[`AGENT_${agentIndex}_PRIVATE_KEY`];
    const semaphoreSecret = process.env[`AGENT_${agentIndex}_SEMAPHORE_SECRET`];
    if (!agentPk)
        throw new Error(`AGENT_${agentIndex}_PRIVATE_KEY missing`);
    if (!semaphoreSecret)
        throw new Error(`AGENT_${agentIndex}_SEMAPHORE_SECRET missing`);
    const provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers_1.ethers.Wallet(agentPk, provider);
    const balance = await provider.getBalance(signer.address);
    if (balance < ethers_1.ethers.parseEther("0.005")) {
        throw new Error(`agent ${agentIndex} wallet ${signer.address} has only ${ethers_1.ethers.formatEther(balance)} OG — refund via scripts/setup-agent-wallets.ts`);
    }
    const identity = (0, semaphore_utils_1.createIdentity)(semaphoreSecret);
    // Pull the live on-chain group so the local Merkle tree matches what the
    // contract verifier holds. Cheaper than maintaining a local cache.
    const members = await (0, semaphore_utils_1.fetchGroupMembers)(daoAddress, provider);
    if (!members.includes(identity.commitment)) {
        throw new Error(`agent ${agentIndex} commitment ${identity.commitment} is NOT a registered member — addVoter step skipped?`);
    }
    const built = await (0, semaphore_utils_1.generateVoteProof)(identity, members, BigInt(proposalId), decision);
    const onchain = await (0, semaphore_utils_1.submitVoteOnChain)(built.proofTuple, daoAddress, signer);
    return {
        ...onchain,
        proofGenerationMs: built.generationMs,
        totalElapsedMs: Date.now() - t0,
        decision,
        agentWalletAddress: signer.address,
        alreadyVoted: onchain.alreadyVoted,
        alreadyResolved: onchain.alreadyResolved,
    };
}
exports.castAnonymousVote = castAnonymousVote;
