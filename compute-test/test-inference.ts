import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config({ path: "../.env" });
dotenv.config({ path: "../.env.secrets" });

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("Wallet :", wallet.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "OG");

  console.log("\n[1/5] Creating broker ...");
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log("[2/5] Funding compute ledger (3 OG — MIN_LEDGER_BALANCE_OG=3) ...");
  try {
    await broker.ledger.addLedger(3.0);
    console.log("       ledger funded");
  } catch (e: any) {
    if (String(e?.message || e).match(/already exists|exists/i)) {
      console.log("       ledger already exists, ok");
    } else {
      console.log("       addLedger error (non-fatal, may already exist):", e?.shortMessage || e?.message || e);
    }
  }

  console.log("[3/5] Listing providers ...");
  const providers = await broker.inference.listService();
  console.log("       got", providers.length, "providers");
  providers.slice(0, 5).forEach((p: any, i: number) => {
    console.log(`       [${i}] model=${p.model} url=${p.url} provider=${p.provider}`);
  });
  if (providers.length === 0) throw new Error("no providers online");

  // Pick first available provider — do NOT hard-code DeepSeek-R1-70B
  const target = providers[0];
  const model: string = target.model;
  console.log("       picked:", model, "@", target.url);

  console.log("[4/5] Acknowledging provider + getting metadata + headers ...");
  try {
    await broker.inference.acknowledgeProviderSigner(target.provider);
  } catch (e: any) {
    console.log("       ack non-fatal:", e?.shortMessage || e?.message || e);
  }

  const meta = await broker.inference.getServiceMetadata(target.provider);
  console.log("       meta endpoint:", meta.endpoint, "model:", meta.model);

  const userMessage = "Reply with exactly one word: hello";
  const headers = await broker.inference.getRequestHeaders(target.provider, userMessage);

  console.log("[5/5] Calling inference ...");
  const t0 = Date.now();
  // SDK-provided endpoint already includes the chat-completions path
  const inferenceUrl = meta.endpoint.endsWith("/chat/completions")
    ? meta.endpoint
    : `${meta.endpoint.replace(/\/+$/, "")}/chat/completions`;
  console.log("       POST", inferenceUrl);
  const res = await fetch(inferenceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 32,
    }),
  });
  console.log("       status:", res.status, "after", Date.now() - t0, "ms");
  if (!res.ok) {
    const text = await res.text();
    console.log("       body:", text.slice(0, 400));
    throw new Error(`compute returned ${res.status}`);
  }
  const data: any = await res.json();
  const replyText: string = data.choices?.[0]?.message?.content || "";
  console.log("       reply:", JSON.stringify(replyText));

  // processResponse(providerAddress, chatID?, content?) — caches estimated fee for next billing
  try {
    const chatID: string | undefined = data.id;
    const content: string = replyText;
    await broker.inference.processResponse(target.provider, chatID, content);
    console.log("       processResponse: ok");
  } catch (e: any) {
    console.log("       processResponse non-fatal:", e?.shortMessage || e?.message || e);
  }

  const result = {
    network: "0G Galileo",
    chainId: 16602,
    wallet: wallet.address,
    provider: target.provider,
    model,
    endpoint: target.url,
    request: userMessage,
    response: replyText,
    elapsedMs: Date.now() - t0,
    timestamp: new Date().toISOString(),
  };
  console.log("\n=== RESULT ===\n" + JSON.stringify(result, null, 2));
  fs.writeFileSync("./compute-result.json", JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
