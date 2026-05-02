import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEPLOY_LOG = path.join(REPO_ROOT, "DEPLOY_LOG.md");
const DEPLOY_RESULT = path.join(__dirname, "..", "deploy-result.json");

async function main() {
  const semaphoreAddress = process.env.SEMAPHORE_ADDRESS;
  if (!semaphoreAddress) {
    throw new Error("SEMAPHORE_ADDRESS missing — set in .env (Session 1 deployed it)");
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(balance), "OG/ETH");
  if (balance === 0n) throw new Error("Deployer has 0 balance");

  const network = await ethers.provider.getNetwork();
  console.log("Network :", network.name, "chainId", network.chainId.toString());
  console.log("Linking against Semaphore:", semaphoreAddress);

  const DisputeDAO = await ethers.getContractFactory("DisputeDAO");
  const dao = await DisputeDAO.deploy(semaphoreAddress);
  console.log("\nDeploy tx:", dao.deploymentTransaction()?.hash);
  await dao.waitForDeployment();

  const daoAddress = await dao.getAddress();
  const groupId = await dao.groupId();
  const owner = await dao.owner();

  console.log("\nDisputeDAO @", daoAddress);
  console.log("Owner      :", owner);
  console.log("Group id   :", groupId.toString());

  const result = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    semaphore: semaphoreAddress,
    disputeDAO: daoAddress,
    groupId: groupId.toString(),
    deployTx: dao.deploymentTransaction()?.hash,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(DEPLOY_RESULT, JSON.stringify(result, null, 2));
  console.log("\nWrote", DEPLOY_RESULT);

  const md = `

## Session 2 — DisputeDAO Deployment (${result.timestamp})

- Network: ${result.network} (chainId ${result.chainId})
- Deployer: ${result.deployer}
- Semaphore (Session 1): ${result.semaphore}
- DisputeDAO: ${result.disputeDAO}
- Group id: ${result.groupId}
- Deploy tx: ${result.deployTx}
- Explorer: https://chainscan-galileo.0g.ai/address/${result.disputeDAO}
`;
  fs.appendFileSync(DEPLOY_LOG, md);
  console.log("Appended deploy block to", DEPLOY_LOG);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
