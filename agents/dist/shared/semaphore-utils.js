"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitVoteOnChain = exports.generateVoteProof = exports.fetchGroupMembers = exports.getBabyJubjubHex = exports.getCommitment = exports.createIdentity = exports.SIGNAL_REJECT = exports.SIGNAL_APPROVE = void 0;
const identity_1 = require("@semaphore-protocol/identity");
const group_1 = require("@semaphore-protocol/group");
const proof_1 = require("@semaphore-protocol/proof");
const ethers_1 = require("ethers");
const DAO_ABI = [
    "function submitProof((uint256 merkleTreeDepth,uint256 merkleTreeRoot,uint256 nullifier,uint256 message,uint256 scope,uint256[8] points) proof)",
    "function currentProposalId() view returns (uint256)",
    "function groupId() view returns (uint256)",
    "event VoterAdded(uint256 indexed identityCommitment, uint256 memberIndex)",
    "event ProofVerified(uint256 indexed proposalId, uint256 signal, uint256 nullifier)",
    "event ProposalResolved(uint256 indexed proposalId, bool approved, uint256 approveCount, uint256 rejectCount)",
];
exports.SIGNAL_APPROVE = 1n;
exports.SIGNAL_REJECT = 2n;
function createIdentity(secret) {
    return new identity_1.Identity(secret);
}
exports.createIdentity = createIdentity;
function getCommitment(identity) {
    return identity.commitment;
}
exports.getCommitment = getCommitment;
function getBabyJubjubHex(identity) {
    const pk = identity.publicKey;
    if (!Array.isArray(pk) || pk.length !== 2)
        throw new Error("Identity.publicKey not [bigint,bigint]");
    return "0x" + pk[0].toString(16).padStart(64, "0") + pk[1].toString(16).padStart(64, "0");
}
exports.getBabyJubjubHex = getBabyJubjubHex;
/// Fetch the on-chain Semaphore group members for a DAO. Reads VoterAdded
/// events directly so the local Merkle root computed in `Group(commitments)`
/// matches what the contract stores.
async function fetchGroupMembers(daoAddress, provider) {
    const dao = new ethers_1.ethers.Contract(daoAddress, DAO_ABI, provider);
    const filter = dao.filters.VoterAdded();
    const events = await dao.queryFilter(filter, 0, "latest");
    const rows = events.map((e) => ({
        commitment: BigInt(e.args.identityCommitment),
        index: BigInt(e.args.memberIndex),
        block: e.blockNumber,
    }));
    rows.sort((a, b) => Number(a.index - b.index));
    return rows.map((r) => r.commitment);
}
exports.fetchGroupMembers = fetchGroupMembers;
async function generateVoteProof(identity, groupMembers, proposalId, decision) {
    const group = new group_1.Group(groupMembers);
    const message = decision === "Approve" ? exports.SIGNAL_APPROVE : exports.SIGNAL_REJECT;
    const scope = proposalId;
    const t0 = Date.now();
    const proof = await (0, proof_1.generateProof)(identity, group, message, scope);
    const generationMs = Date.now() - t0;
    // Defensive: verify the proof off-chain before paying gas to submit it.
    // Avoids the failure mode where the local group differs from the on-chain
    // group (e.g. wrong member ordering) and the tx reverts wasting gas.
    const ok = await (0, proof_1.verifyProof)(proof);
    if (!ok)
        throw new Error("local verifyProof failed — group mismatch or proof invalid");
    return {
        proof,
        proofTuple: {
            merkleTreeDepth: BigInt(proof.merkleTreeDepth),
            merkleTreeRoot: BigInt(proof.merkleTreeRoot),
            nullifier: BigInt(proof.nullifier),
            message: BigInt(proof.message),
            scope: BigInt(proof.scope),
            points: proof.points.map((p) => BigInt(p)),
        },
        generationMs,
        decision,
    };
}
exports.generateVoteProof = generateVoteProof;
/// Submit a generated proof on-chain. The signer is the AGENT wallet — NOT
/// the deployer — so the on-chain tx-graph cannot link the agent's known
/// address back to the anonymous vote.
async function submitVoteOnChain(proofTuple, daoAddress, signer) {
    const dao = new ethers_1.ethers.Contract(daoAddress, DAO_ABI, signer);
    const tx = await dao.submitProof(proofTuple);
    const rc = await tx.wait();
    return { txHash: tx.hash, blockNumber: rc.blockNumber, gasUsed: rc.gasUsed.toString() };
}
exports.submitVoteOnChain = submitVoteOnChain;
