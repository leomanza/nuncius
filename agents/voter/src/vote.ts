import { ethers } from "ethers";
import {
  createIdentity,
  fetchGroupMembers,
  generateVoteProof,
  submitVoteOnChain,
} from "../../shared/semaphore-utils";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";

export interface CastResult {
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  proofGenerationMs: number;
  totalElapsedMs: number;
  decision: "Approve" | "Reject";
  agentWalletAddress: string;
  alreadyVoted?: boolean;
  alreadyResolved?: boolean;
}

export async function castAnonymousVote(
  agentIndex: number,
  proposalId: number,
  decision: "Approve" | "Reject",
  daoAddress: string,
): Promise<CastResult> {
  const t0 = Date.now();
  const agentPk = process.env[`AGENT_${agentIndex}_PRIVATE_KEY`];
  const semaphoreSecret = process.env[`AGENT_${agentIndex}_SEMAPHORE_SECRET`];
  if (!agentPk) throw new Error(`AGENT_${agentIndex}_PRIVATE_KEY missing`);
  if (!semaphoreSecret) throw new Error(`AGENT_${agentIndex}_SEMAPHORE_SECRET missing`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(agentPk, provider);

  const balance = await provider.getBalance(signer.address);
  if (balance < ethers.parseEther("0.005")) {
    throw new Error(
      `agent ${agentIndex} wallet ${signer.address} has only ${ethers.formatEther(balance)} OG — refund via scripts/setup-agent-wallets.ts`,
    );
  }

  const identity = createIdentity(semaphoreSecret);

  // Pull the live on-chain group so the local Merkle tree matches what the
  // contract verifier holds. Cheaper than maintaining a local cache.
  const members = await fetchGroupMembers(daoAddress, provider);
  if (!members.includes(identity.commitment)) {
    throw new Error(
      `agent ${agentIndex} commitment ${identity.commitment} is NOT a registered member — addVoter step skipped?`,
    );
  }

  const built = await generateVoteProof(identity, members, BigInt(proposalId), decision);
  const onchain = await submitVoteOnChain(built.proofTuple, daoAddress, signer);

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
