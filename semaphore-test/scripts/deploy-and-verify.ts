import { ethers } from "hardhat";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(balance), "OG/ETH");
  if (balance === 0n) throw new Error("Deployer has 0 balance");

  const network = await ethers.provider.getNetwork();
  console.log("Network :", network.name, "chainId", network.chainId.toString());

  // ── Step 1: PoseidonT3 (library — Semaphore.sol has 6 link placeholders for it)
  console.log("\n[1/4] Deploying PoseidonT3 ...");
  const Poseidon = await ethers.getContractFactory("PoseidonT3");
  const poseidon = await Poseidon.deploy();
  await poseidon.waitForDeployment();
  const poseidonAddr = await poseidon.getAddress();
  console.log("       PoseidonT3        @", poseidonAddr);

  // ── Step 2: SemaphoreVerifier (Groth16 verifier with hard-coded BN254 keys)
  console.log("\n[2/4] Deploying SemaphoreVerifier ...");
  const VerifierFactory = await ethers.getContractFactory("SemaphoreVerifier");
  const verifier = await VerifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("       SemaphoreVerifier @", verifierAddr);

  // ── Step 3: Semaphore (linked to PoseidonT3, constructed with verifier)
  console.log("\n[3/4] Deploying Semaphore (linked) ...");
  const SemaphoreFactory = await ethers.getContractFactory("Semaphore", {
    libraries: { PoseidonT3: poseidonAddr },
  });
  const semaphore = await SemaphoreFactory.deploy(verifierAddr);
  await semaphore.waitForDeployment();
  const semaphoreAddr = await semaphore.getAddress();
  console.log("       Semaphore         @", semaphoreAddr);

  // ── Step 4: Real Groth16 fixture proof end-to-end (THE go/no-go test)
  console.log("\n[4/4] On-chain proof verification fixture (BN254 precompile go/no-go) ...");

  const ids = [new Identity(), new Identity(), new Identity()];
  const me = ids[0];
  const group = new Group(ids.map((i) => i.commitment));

  const message = 1n; // arbitrary signal (think: SIGNAL_APPROVE)
  const scope = 42n;  // arbitrary fixture scope

  console.log("       Generating Groth16 proof (downloads zkey/wasm on first run, may take 5-30s) ...");
  const t0 = Date.now();
  const proof = await generateProof(me, group, message, scope);
  console.log("       Proof generated in", Date.now() - t0, "ms");

  console.log("       Creating on-chain group + adding members ...");
  const tx1 = await semaphore["createGroup()"]();
  await tx1.wait();
  const groupCounter: bigint = await semaphore.groupCounter();
  const groupId = groupCounter - 1n;
  console.log("       Group id:", groupId.toString());

  for (let i = 0; i < ids.length; i++) {
    const tx = await semaphore.addMember(groupId, ids[i].commitment);
    await tx.wait();
    console.log("       member", i, "added (commit", ids[i].commitment.toString().slice(0, 16) + "...)");
  }

  const proofTuple = {
    merkleTreeDepth: BigInt(proof.merkleTreeDepth),
    merkleTreeRoot: BigInt(proof.merkleTreeRoot),
    nullifier: BigInt(proof.nullifier),
    message: BigInt(proof.message),
    scope: BigInt(proof.scope),
    points: proof.points.map((p) => BigInt(p)) as any,
  };

  console.log("       Calling verifyProof(view) — exercises BN254 pairing precompiles ...");
  const ok: boolean = await semaphore.verifyProof(groupId, proofTuple);
  console.log("       verifyProof returned:", ok);
  if (!ok) throw new Error("verifyProof returned false — pairing precompiles broken or proof invalid");

  console.log("       Calling validateProof(state-changing) ...");
  const txV = await semaphore.validateProof(groupId, proofTuple);
  const rcV = await txV.wait();
  console.log("       validateProof tx:", txV.hash, "block", rcV?.blockNumber, "gasUsed", rcV?.gasUsed.toString());

  const summary = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    poseidonT3: poseidonAddr,
    semaphoreVerifier: verifierAddr,
    semaphore: semaphoreAddr,
    fixtureGroupId: groupId.toString(),
    verifyProofResult: ok,
    validateProofTx: txV.hash,
    validateProofBlock: rcV?.blockNumber,
    timestamp: new Date().toISOString(),
  };
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync("./semaphore-deploy-result.json", JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
