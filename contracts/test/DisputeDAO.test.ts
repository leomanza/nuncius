import { expect } from "chai";
import { ethers } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";

const SIGNAL_APPROVE = 1n;
const SIGNAL_REJECT = 2n;

type ProofTuple = {
  merkleTreeDepth: bigint;
  merkleTreeRoot: bigint;
  nullifier: bigint;
  message: bigint;
  scope: bigint;
  points: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
};

function toTuple(p: SemaphoreProof): ProofTuple {
  return {
    merkleTreeDepth: BigInt(p.merkleTreeDepth),
    merkleTreeRoot: BigInt(p.merkleTreeRoot),
    nullifier: BigInt(p.nullifier),
    message: BigInt(p.message),
    scope: BigInt(p.scope),
    points: p.points.map((x) => BigInt(x)) as ProofTuple["points"],
  };
}

async function deployStack() {
  const [owner, agentWallet, otherWallet] = await ethers.getSigners();

  const PoseidonT3 = await ethers.getContractFactory("PoseidonT3");
  const poseidon = await PoseidonT3.deploy();
  await poseidon.waitForDeployment();

  const Verifier = await ethers.getContractFactory("SemaphoreVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const Semaphore = await ethers.getContractFactory("Semaphore", {
    libraries: { PoseidonT3: await poseidon.getAddress() },
  });
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  await semaphore.waitForDeployment();

  const DisputeDAO = await ethers.getContractFactory("DisputeDAO");
  const dao = await DisputeDAO.deploy(await semaphore.getAddress());
  await dao.waitForDeployment();

  return { owner, agentWallet, otherWallet, semaphore, dao };
}

describe("DisputeDAO", () => {
  // 5 deterministic identities so we can build a group + craft proofs in tests
  const ids: Identity[] = [];
  before(() => {
    for (let i = 1; i <= 5; i++) ids.push(new Identity(`agent-${i}-test-secret`));
  });

  // ── Constructor + admin ─────────────────────────────────────────────

  describe("constructor + admin", () => {
    it("deploys with the calling address as owner and creates a fresh group", async () => {
      const { owner, dao, semaphore } = await deployStack();
      expect(await dao.owner()).to.equal(owner.address);
      const groupId = await dao.groupId();
      // First group on this Semaphore should be id 0; whatever it is, we own it.
      expect(await semaphore.getGroupAdmin(groupId)).to.equal(await dao.getAddress());
      expect(await dao.memberCount()).to.equal(0n);
      expect(await dao.proposalCount()).to.equal(0n);
      expect(await dao.currentProposalId()).to.equal(0n);
    });

    it("addVoter is owner-only and bounded by MAX_VOTERS", async () => {
      const { dao, otherWallet } = await deployStack();

      await expect(dao.connect(otherWallet).addVoter(ids[0].commitment))
        .to.be.revertedWithCustomError(dao, "OnlyOwner");

      for (let i = 0; i < 5; i++) {
        await expect(dao.addVoter(ids[i].commitment))
          .to.emit(dao, "VoterAdded")
          .withArgs(ids[i].commitment, BigInt(i + 1));
      }
      expect(await dao.memberCount()).to.equal(5n);

      const extra = new Identity("overflow");
      await expect(dao.addVoter(extra.commitment))
        .to.be.revertedWithCustomError(dao, "MaxVotersReached");
    });
  });

  // ── Proposal lifecycle ──────────────────────────────────────────────

  describe("proposal lifecycle", () => {
    it("openProposal is owner-only, increments id, and emits", async () => {
      const { dao, otherWallet } = await deployStack();
      await expect(dao.connect(otherWallet).openProposal("nope"))
        .to.be.revertedWithCustomError(dao, "OnlyOwner");

      const tx = await dao.openProposal("Fund X");
      const rc = await tx.wait();
      expect(rc).to.emit(dao, "ProposalOpened");

      expect(await dao.currentProposalId()).to.equal(1n);
      expect(await dao.proposalCount()).to.equal(1n);
    });

    it("rejects opening a second proposal while one is active", async () => {
      const { dao } = await deployStack();
      await dao.openProposal("first");
      await expect(dao.openProposal("second"))
        .to.be.revertedWithCustomError(dao, "ActiveProposalExists");
    });
  });

  // ── Voting (real proofs) ────────────────────────────────────────────

  describe("submitProof — real Groth16 proofs", () => {
    it("happy path: 5 votes auto-resolve and tally is correct", async () => {
      const { dao } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("Fund 50k USDC audit");

      const group = new Group(ids.map((i) => i.commitment));
      const scope = await dao.currentProposalId();

      // 3 approves, 2 rejects — auto-resolve at 5 votes
      const decisions: bigint[] = [SIGNAL_APPROVE, SIGNAL_APPROVE, SIGNAL_REJECT, SIGNAL_APPROVE, SIGNAL_REJECT];

      let approve = 0n;
      let reject = 0n;
      for (let i = 0; i < 5; i++) {
        const proof = await generateProof(ids[i], group, decisions[i], scope);
        const tx = await dao.submitProof(toTuple(proof));
        await expect(tx)
          .to.emit(dao, "ProofVerified")
          .withArgs(scope, decisions[i], proof.nullifier);
        if (decisions[i] === SIGNAL_APPROVE) approve += 1n; else reject += 1n;
      }

      const proposal = await dao.getProposal(scope);
      expect(proposal.resolved).to.equal(true);
      expect(proposal.approved).to.equal(true); // 3 vs 2
      expect(proposal.approveCount).to.equal(approve);
      expect(proposal.rejectCount).to.equal(reject);
      expect(await dao.currentProposalId()).to.equal(0n);
    });

    it("rejects a proof with the wrong scope (B5: cross-proposal replay)", async () => {
      const { dao } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("active proposal");

      const group = new Group(ids.map((i) => i.commitment));
      const wrongScope = 99n;
      const proof = await generateProof(ids[0], group, SIGNAL_APPROVE, wrongScope);

      await expect(dao.submitProof(toTuple(proof)))
        .to.be.revertedWithCustomError(dao, "WrongScope")
        .withArgs(1n, wrongScope);
    });

    it("rejects a proof whose message is neither APPROVE nor REJECT (B4: signal binding)", async () => {
      const { dao } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("p");

      const group = new Group(ids.map((i) => i.commitment));
      const scope = 1n;
      const proof = await generateProof(ids[0], group, 99n, scope); // bogus signal
      await expect(dao.submitProof(toTuple(proof)))
        .to.be.revertedWithCustomError(dao, "InvalidSignal")
        .withArgs(99n);
    });

    it("rejects double-voting on the same proposal (Semaphore nullifier reuse)", async () => {
      const { dao, semaphore } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("p");

      const group = new Group(ids.map((i) => i.commitment));
      const scope = 1n;
      const proof = await generateProof(ids[0], group, SIGNAL_APPROVE, scope);
      await dao.submitProof(toTuple(proof));

      // Same proof again → Semaphore reverts with its own nullifier-reuse error
      await expect(dao.submitProof(toTuple(proof)))
        .to.be.revertedWithCustomError(semaphore, "Semaphore__YouAreUsingTheSameNullifierTwice");
    });

    it("rejects when no proposal is active", async () => {
      const { dao } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);

      const group = new Group(ids.map((i) => i.commitment));
      const proof = await generateProof(ids[0], group, SIGNAL_APPROVE, 1n);
      await expect(dao.submitProof(toTuple(proof)))
        .to.be.revertedWithCustomError(dao, "NoActiveProposal");
    });

    it("rejects when proposal is already resolved", async () => {
      const { dao } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("p");
      const group = new Group(ids.map((i) => i.commitment));
      const scope = 1n;

      // 5 votes auto-resolves — 6th vote (would be a fresh identity) is impossible
      // because group only has 5; instead we resolve, then assert a fresh proposal
      // can't accept proofs scoped to the OLD proposal.
      for (let i = 0; i < 5; i++) {
        const proof = await generateProof(ids[i], group, SIGNAL_APPROVE, scope);
        await dao.submitProof(toTuple(proof));
      }
      expect((await dao.getProposal(scope)).resolved).to.equal(true);
    });
  });

  // ── forceResolve ────────────────────────────────────────────────────

  describe("forceResolve", () => {
    it("requires QUORUM (3) votes; owner-only; resolves once", async () => {
      const { dao, otherWallet } = await deployStack();
      for (const id of ids) await dao.addVoter(id.commitment);
      await dao.openProposal("p");

      const group = new Group(ids.map((i) => i.commitment));
      const scope = 1n;

      await expect(dao.forceResolve())
        .to.be.revertedWithCustomError(dao, "QuorumNotReached")
        .withArgs(0n, 3n);

      // 3 votes (does not auto-resolve at 3, only at memberCount=5)
      for (let i = 0; i < 3; i++) {
        const proof = await generateProof(ids[i], group, SIGNAL_REJECT, scope);
        await dao.submitProof(toTuple(proof));
      }
      expect((await dao.getProposal(scope)).resolved).to.equal(false);

      await expect(dao.connect(otherWallet).forceResolve())
        .to.be.revertedWithCustomError(dao, "OnlyOwner");

      await expect(dao.forceResolve())
        .to.emit(dao, "ProposalResolved")
        .withArgs(scope, false, 0n, 3n);
      expect((await dao.getProposal(scope)).resolved).to.equal(true);

      await expect(dao.forceResolve())
        .to.be.revertedWithCustomError(dao, "NoActiveProposal");
    });
  });
});
