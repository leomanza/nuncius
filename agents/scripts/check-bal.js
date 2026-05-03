const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });
require("dotenv").config({ path: "../.env.secrets" });
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.RPC_URL);
  for (let i = 1; i <= 5; i++) {
    const addr = process.env[`AGENT_${i}_ADDRESS`];
    const bal = await p.getBalance(addr);
    console.log(`agent-${i} ${addr}: ${ethers.formatEther(bal)} OG`);
  }
})();
