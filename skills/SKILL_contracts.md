# SKILL: Smart Contracts
## Session 2 — DisputeDAO.sol on 0G Chain

Read `SKILL_environment.md` first. The Semaphore verifier must be deployed before this session.

> **STATUS (2026-04-30):** Session 2 has been executed. The patched DisputeDAO is live on
> Galileo at `0x650c074910bC5855f6573f9d62EE5b8bA90664D9` (group id 1). Sessions 3+ should
> import this contract via the address in `.env` (`DISPUTE_DAO_ADDRESS`). The historical
> snippet below is preserved for reference but **does NOT match the deployed contract**:
> the deployed version drops the redundant `signal` argument and enforces
> `proof.scope == currentProposalId`. See SESSION_0_REVIEW.md fixes B4 + B5 and
> `contracts/contracts/DisputeDAO.sol` for the actual ABI. The agent code in Sessions 3+
> must call `submitProof(proof)` (one argument) and set the proof's `scope` to the
> current proposal id and `message` to 1 (Approve) or 2 (Reject).

---

## What to Build

`DisputeDAO.sol` — a DAO proposal contract that:
1. Accepts proposals from the owner
2. Maintains a Semaphore group of authorized voter agents
3. Accepts anonymous ZK proofs as votes
4. Resolves proposals when quorum reached (≥3 of 5 proofs submitted)
5. Emits events that the frontend and agents can index

This contract must deploy on **0G Galileo testnet (Chain ID 16602)**.

---

## Hardhat Project Setup

```bash
cd contracts/
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox typescript ts-node
npm install @semaphore-protocol/contracts @semaphore-protocol/core ethers
npx hardhat init  # TypeScript project
```

### `hardhat.config.ts`
```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config({ path: "../.env" });

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    galileo: {
      url: process.env.RPC_URL || "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: 3000000,
      gasPrice: 1000000000,  // 1 gwei
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    }
  }
};

export default config;
```

---

## `contracts/DisputeDAO.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title DisputeDAO
/// @notice Privacy-preserving DAO where AI agents vote via anonymous Semaphore proofs.
///         Individual votes are never revealed — only the aggregate tally is public.
contract DisputeDAO {
    // ═══════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════

    ISemaphore public immutable semaphore;
    address public immutable owner;

    uint256 public groupId;
    uint256 public memberCount;

    // Signal encoding: 1 = Approve, 2 = Reject
    uint256 public constant SIGNAL_APPROVE = 1;
    uint256 public constant SIGNAL_REJECT  = 2;
    uint256 public constant QUORUM         = 3; // out of 5 agents

    struct Proposal {
        uint256 id;
        string  description;
        uint256 approveCount;
        uint256 rejectCount;
        bool    resolved;
        bool    approved;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    uint256 public currentProposalId; // active proposal (one at a time for MVP)

    // ═══════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════

    event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp);
    event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier);
    event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount);
    event VoterAdded(uint256 indexed identityCommitment);

    // ═══════════════════════════════════════════════════════════
    // Errors
    // ═══════════════════════════════════════════════════════════

    error OnlyOwner();
    error AlreadyResolved();
    error NoActiveProposal();
    error InvalidSignal();
    error QuorumNotReached();
    error MaxVotersReached();

    // ═══════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════

    constructor(address _semaphoreAddress) {
        semaphore = ISemaphore(_semaphoreAddress);
        owner = msg.sender;

        // Create the Semaphore group — this DAO's voter group
        groupId = semaphore.createGroup();
    }

    // ═══════════════════════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════════════════════

    /// @notice Add a voter agent to the Semaphore group.
    ///         In production: gated by ERC-8004 reputation check.
    ///         For hackathon MVP: owner-only allowlist.
    function addVoter(uint256 identityCommitment) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (memberCount >= 5) revert MaxVotersReached();

        semaphore.addMember(groupId, identityCommitment);
        memberCount++;

        emit VoterAdded(identityCommitment);
    }

    /// @notice Open a new proposal for the agent swarm to deliberate on.
    function openProposal(string calldata description) external {
        if (msg.sender != owner) revert OnlyOwner();

        proposalCount++;
        uint256 proposalId = proposalCount;

        proposals[proposalId] = Proposal({
            id:           proposalId,
            description:  description,
            approveCount: 0,
            rejectCount:  0,
            resolved:     false,
            approved:     false,
            createdAt:    block.timestamp,
            resolvedAt:   0
        });

        currentProposalId = proposalId;

        emit ProposalOpened(proposalId, description, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════
    // Voting
    // ═══════════════════════════════════════════════════════════

    /// @notice Submit an anonymous Semaphore proof as a vote.
    ///         signal = 1 (Approve) or 2 (Reject).
    ///         scope is set to the proposalId to prevent cross-proposal replay.
    function submitProof(ISemaphore.SemaphoreProof calldata proof, uint256 signal) external {
        if (currentProposalId == 0) revert NoActiveProposal();

        Proposal storage proposal = proposals[currentProposalId];
        if (proposal.resolved) revert AlreadyResolved();
        if (signal != SIGNAL_APPROVE && signal != SIGNAL_REJECT) revert InvalidSignal();

        // Verify the Semaphore proof.
        // scope = currentProposalId ensures nullifiers are scoped per proposal.
        // An agent can vote on proposal #2 even if they voted on proposal #1.
        semaphore.validateProof(groupId, proof);

        // Tally
        if (signal == SIGNAL_APPROVE) {
            proposal.approveCount++;
        } else {
            proposal.rejectCount++;
        }

        emit ProofVerified(currentProposalId, signal, proof.nullifier);

        // Auto-resolve when all 5 votes are in
        uint256 totalVotes = proposal.approveCount + proposal.rejectCount;
        if (totalVotes >= memberCount && memberCount > 0) {
            _resolve(currentProposalId);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Resolution
    // ═══════════════════════════════════════════════════════════

    /// @notice Manually trigger resolution (for MVP: owner can force resolve after timeout).
    function forceResolve() external {
        if (msg.sender != owner) revert OnlyOwner();
        if (currentProposalId == 0) revert NoActiveProposal();
        Proposal storage proposal = proposals[currentProposalId];
        if (proposal.resolved) revert AlreadyResolved();
        uint256 totalVotes = proposal.approveCount + proposal.rejectCount;
        if (totalVotes < QUORUM) revert QuorumNotReached();
        _resolve(currentProposalId);
    }

    function _resolve(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        proposal.resolved  = true;
        proposal.approved  = proposal.approveCount > proposal.rejectCount;
        proposal.resolvedAt = block.timestamp;
        currentProposalId  = 0;

        emit ProposalResolved(proposalId, proposal.approved, proposal.approveCount, proposal.rejectCount);
    }

    // ═══════════════════════════════════════════════════════════
    // Views
    // ═══════════════════════════════════════════════════════════

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getCurrentProposal() external view returns (Proposal memory) {
        return proposals[currentProposalId];
    }

    function getGroupId() external view returns (uint256) {
        return groupId;
    }
}
```

---

## Deploy Script

### `scripts/deploy.ts`
```typescript
import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "OG");

  // Use the Semaphore address deployed in Session 1
  const semaphoreAddress = process.env.SEMAPHORE_ADDRESS;
  if (!semaphoreAddress) throw new Error("SEMAPHORE_ADDRESS not set in .env");

  const DisputeDAO = await ethers.getContractFactory("DisputeDAO");
  const dao = await DisputeDAO.deploy(semaphoreAddress);
  await dao.waitForDeployment();

  const daoAddress = await dao.getAddress();
  console.log("DisputeDAO deployed to:", daoAddress);

  // Update DEPLOY_LOG.md
  const log = `
## Session 2 — Contract Deployment

- Network: 0G Galileo (chainId 16602)
- Deployer: ${deployer.address}
- DisputeDAO: ${daoAddress}
- Semaphore (from Session 1): ${semaphoreAddress}
- Deployed at: ${new Date().toISOString()}
- Explorer: https://chainscan-galileo.0g.ai/address/${daoAddress}
`;

  fs.appendFileSync("../DEPLOY_LOG.md", log);
  console.log("DEPLOY_LOG.md updated.");

  // Add agents to the group (5 identity commitments)
  // This is run as a separate script in Session 4 after Semaphore identities are generated
  console.log("Group ID:", await dao.getGroupId());
  console.log("Next step: run scripts/add-voters.ts after generating Semaphore identities in Session 4");
}

main().catch(console.error);
```

### `scripts/add-voters.ts`
```typescript
import { ethers } from "hardhat";
import { Identity } from "@semaphore-protocol/core";

async function main() {
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
  if (!daoAddress) throw new Error("DISPUTE_DAO_ADDRESS not set");

  const dao = await ethers.getContractAt("DisputeDAO", daoAddress);

  // Generate or load 5 Semaphore identities from env
  const secrets = [
    process.env.AGENT_1_SEMAPHORE_SECRET!,
    process.env.AGENT_2_SEMAPHORE_SECRET!,
    process.env.AGENT_3_SEMAPHORE_SECRET!,
    process.env.AGENT_4_SEMAPHORE_SECRET!,
    process.env.AGENT_5_SEMAPHORE_SECRET!,
  ];

  for (let i = 0; i < 5; i++) {
    const identity = new Identity(secrets[i]);
    const commitment = identity.commitment;
    console.log(`Agent ${i+1} identity commitment: ${commitment}`);

    const tx = await dao.addVoter(commitment);
    await tx.wait();
    console.log(`Agent ${i+1} added to group. Tx: ${tx.hash}`);
  }

  console.log("All 5 agents added to Semaphore group.");
}

main().catch(console.error);
```

### `scripts/open-proposal.ts`
```typescript
import { ethers } from "hardhat";

async function main() {
  const daoAddress = process.env.DISPUTE_DAO_ADDRESS;
  if (!daoAddress) throw new Error("DISPUTE_DAO_ADDRESS not set");

  const dao = await ethers.getContractAt("DisputeDAO", daoAddress);

  const proposal = process.argv[2] || "Fund a 50,000 USDC development grant for Protocol X security audit";
  const tx = await dao.openProposal(proposal);
  await tx.wait();

  console.log("Proposal opened:", proposal);
  console.log("Transaction:", tx.hash);

  const current = await dao.getCurrentProposal();
  console.log("Proposal ID:", current.id.toString());
}

main().catch(console.error);
```

---

## Testing the Contract

```bash
# Deploy
npx hardhat run scripts/deploy.ts --network galileo

# Verify on explorer (optional but nice for judges)
npx hardhat verify --network galileo <DAO_ADDRESS> <SEMAPHORE_ADDRESS>

# Open a test proposal
DISPUTE_DAO_ADDRESS=<address> npx hardhat run scripts/open-proposal.ts --network galileo
```

---

## Session 2 Deliverables Checklist

- [ ] `DisputeDAO.sol` compiled with no errors
- [ ] Contract deployed to 0G Galileo
- [ ] `DEPLOY_LOG.md` updated with `DISPUTE_DAO_ADDRESS`
- [ ] `.env` updated with `DISPUTE_DAO_ADDRESS`
- [ ] `scripts/open-proposal.ts` runs successfully and emits `ProposalOpened` event (visible in explorer)
- [ ] Contract verified on Galileo explorer (optional)

**If complete: proceed to Session 3 (AXL + Agents).**
