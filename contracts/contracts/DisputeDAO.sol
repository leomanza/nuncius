// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title  DisputeDAO
/// @notice Privacy-preserving DAO where voter agents cast votes via anonymous
///         Semaphore V4 proofs. Individual votes are never linkable to the
///         agent — only the aggregate tally is public.
///
/// @dev    Patches relative to skills/SKILL_contracts.md, per SESSION_0_REVIEW.md:
///         B4 — drop redundant `signal` argument; tally `proof.message` directly,
///              so a valid proof for "Approve" cannot be replayed as "Reject".
///         B5 — assert `proof.scope == currentProposalId` so a proof minted for
///              proposal #1 cannot be replayed against proposal #2 (Semaphore's
///              nullifier is scope-specific, so the duplicate-vote check alone
///              would not catch this).
contract DisputeDAO {
    // ─────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────

    uint256 public constant SIGNAL_APPROVE = 1;
    uint256 public constant SIGNAL_REJECT  = 2;

    /// @notice Quorum required to call `forceResolve`. Auto-resolution at
    ///         `memberCount` votes does not consult this.
    uint256 public constant QUORUM = 3;

    /// @notice MVP cap. Group remains usable beyond this; the cap only applies
    ///         to admin `addVoter` calls so the demo cannot accidentally bloat
    ///         the Merkle tree past depth 16.
    uint256 public constant MAX_VOTERS = 5;

    // ─────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────

    ISemaphore public immutable semaphore;
    address    public immutable owner;
    uint256    public immutable groupId;

    uint256 public memberCount;
    uint256 public proposalCount;
    uint256 public currentProposalId; // 0 when no active proposal
    mapping(uint256 => Proposal) public proposals;

    // ─────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────

    event ProposalOpened(uint256 indexed proposalId, string description, uint256 timestamp);
    event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier);
    event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount);
    event VoterAdded(uint256 indexed identityCommitment, uint256 memberIndex);

    // ─────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────

    error OnlyOwner();
    error ActiveProposalExists();
    error AlreadyResolved();
    error NoActiveProposal();
    error InvalidSignal(uint256 signal);
    error WrongScope(uint256 expected, uint256 got);
    error QuorumNotReached(uint256 votes, uint256 required);
    error MaxVotersReached();

    // ─────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────

    constructor(address _semaphoreAddress) {
        semaphore = ISemaphore(_semaphoreAddress);
        owner = msg.sender;

        // The DisputeDAO IS the group admin — only this contract can mutate
        // membership. `addVoter` is the public surface, gated by the owner
        // modifier (we don't expose `removeMember` / `updateMember` for the MVP).
        groupId = semaphore.createGroup(address(this));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Register a voter agent's Semaphore identity commitment.
    /// @dev    Production gating belongs upstream (e.g. ERC-8004 reputation).
    ///         For the MVP this is owner-only and bounded by `MAX_VOTERS`.
    function addVoter(uint256 identityCommitment) external onlyOwner {
        if (memberCount >= MAX_VOTERS) revert MaxVotersReached();
        semaphore.addMember(groupId, identityCommitment);
        memberCount += 1;
        emit VoterAdded(identityCommitment, memberCount);
    }

    /// @notice Open a new proposal. Only one proposal can be active at a time
    ///         (MVP simplification — `currentProposalId` doubles as the scope
    ///         that proofs must commit to).
    function openProposal(string calldata description) external onlyOwner returns (uint256 proposalId) {
        if (currentProposalId != 0) revert ActiveProposalExists();

        proposalCount += 1;
        proposalId = proposalCount;
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

    // ─────────────────────────────────────────────────────────────────────
    // Voting
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Submit an anonymous Semaphore vote.
    /// @dev    Patches B4 + B5: there is no separate `signal` parameter — the
    ///         tally reads `proof.message` directly so the proven signal and
    ///         the tallied signal cannot diverge. `proof.scope` MUST equal
    ///         the current proposal id.
    function submitProof(ISemaphore.SemaphoreProof calldata proof) external {
        uint256 pid = currentProposalId;
        if (pid == 0) revert NoActiveProposal();

        Proposal storage p = proposals[pid];
        if (p.resolved) revert AlreadyResolved();
        if (proof.scope != pid) revert WrongScope(pid, proof.scope);
        if (proof.message != SIGNAL_APPROVE && proof.message != SIGNAL_REJECT) {
            revert InvalidSignal(proof.message);
        }

        // Reverts on invalid proof or reused nullifier.
        semaphore.validateProof(groupId, proof);

        if (proof.message == SIGNAL_APPROVE) {
            p.approveCount += 1;
        } else {
            p.rejectCount += 1;
        }

        emit ProofVerified(pid, proof.message, proof.nullifier);

        // Auto-resolve when every registered member has voted.
        uint256 totalVotes = p.approveCount + p.rejectCount;
        if (memberCount > 0 && totalVotes >= memberCount) {
            _resolve(pid);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resolution
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Owner-triggered fallback resolution once `QUORUM` votes are in
    ///         but the full membership has not yet voted.
    function forceResolve() external onlyOwner {
        uint256 pid = currentProposalId;
        if (pid == 0) revert NoActiveProposal();

        Proposal storage p = proposals[pid];
        if (p.resolved) revert AlreadyResolved();

        uint256 totalVotes = p.approveCount + p.rejectCount;
        if (totalVotes < QUORUM) revert QuorumNotReached(totalVotes, QUORUM);

        _resolve(pid);
    }

    function _resolve(uint256 proposalId) internal {
        Proposal storage p = proposals[proposalId];
        p.resolved   = true;
        p.approved   = p.approveCount > p.rejectCount;
        p.resolvedAt = block.timestamp;
        currentProposalId = 0;

        emit ProposalResolved(proposalId, p.approved, p.approveCount, p.rejectCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────

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
