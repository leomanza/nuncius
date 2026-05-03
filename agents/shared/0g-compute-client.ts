/// 0G Compute client.
///
/// Validated against @0glabs/0g-serving-broker@0.7.5 in Session 1:
///   - Use broker.inference.listService()  (NOT listProviders)
///   - Use broker.inference.getServiceMetadata(provider).endpoint as the
///     base for chat-completions — provider's bare URL gives 404 on
///     /v1/chat/completions because the real path is `<endpoint>/chat/completions`
///     where endpoint already contains a `/v1/proxy` segment.
///   - Headers from getRequestHeaders are single-use; regenerate every call.
///   - Don't hard-code DeepSeek-R1-70B — pick from listService(); on Galileo
///     today the only chat model online is qwen/qwen-2.5-7b-instruct.
///   - Ollama fallback (llama3.2:3b) for offline / provider-down cases.

import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const COMPUTE_TIMEOUT_MS = parseInt(process.env.COMPUTE_TIMEOUT_MS || "20000");

let cached: { broker: any; provider: any; endpoint: string; model: string } | null = null;
let cacheInflight: Promise<typeof cached> | null = null;

export interface InferenceResult {
  text: string;
  source: "0g-compute" | "ollama";
  provider?: string;
  model: string;
  elapsedMs: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms)),
  ]);
}

async function getBroker() {
  if (cached) return cached;
  if (cacheInflight) return cacheInflight;
  cacheInflight = (async () => {
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing — cannot init compute broker");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    const broker = await createZGComputeNetworkBroker(wallet);

    // Idempotent: addLedger throws "already exists" on second call — fine.
    try { await broker.ledger.addLedger(3.0); } catch { /* already funded */ }

    const services: any[] = await broker.inference.listService();
    const preferredModel = process.env.ZG_COMPUTE_MODEL;
    const target = preferredModel
      ? services.find((s) => s.model === preferredModel) || services[0]
      : services.find((s) => /qwen|llama|deepseek/i.test(s.model || "")) || services[0];
    if (!target) throw new Error("0G compute: no providers online");

    try { await broker.inference.acknowledgeProviderSigner(target.provider); } catch { /* ack idempotent */ }

    const meta = await broker.inference.getServiceMetadata(target.provider);
    cached = { broker, provider: target, endpoint: meta.endpoint, model: meta.model };
    return cached;
  })();
  try {
    return await cacheInflight;
  } finally {
    cacheInflight = null;
  }
}

/// Pre-warm the broker so the first inference call doesn't pay cold-start +
/// race against simultaneous broker init from other agents. Safe to call
/// multiple times — getBroker is idempotent.
export async function warmupBroker(): Promise<void> {
  try {
    await withTimeout(getBroker(), 30000, "broker warmup");
  } catch (err) {
    console.warn("[compute] broker warmup failed (will retry on first inference):", String(err));
  }
}

const RETRY_BACKOFFS_MS = [500, 1500, 4000]; // ~6s total — covers cold-start 429 burst

async function postChatCompletions(
  broker: any,
  provider: any,
  endpoint: string,
  model: string,
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number },
): Promise<Response> {
  const prompt = `${system}\n\n${user}`;
  const headers = await broker.inference.getRequestHeaders(provider.provider, prompt);
  const url = endpoint.endsWith("/chat/completions") ? endpoint : `${endpoint.replace(/\/+$/, "")}/chat/completions`;
  return await withTimeout(fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0,
    }),
  }), COMPUTE_TIMEOUT_MS, "0g compute fetch");
}

export async function callComputeInference(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<InferenceResult> {
  const t0 = Date.now();
  try {
    const { broker, provider, endpoint, model } = (await withTimeout(getBroker(), 15000, "broker init"))!;
    let res: Response | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
      try {
        const r = await postChatCompletions(broker, provider, endpoint, model, system, user, opts);
        if (r.ok) { res = r; break; }
        // 429 (rate limited) and 503 (transient) are retryable.
        if ((r.status === 429 || r.status === 503) && attempt < RETRY_BACKOFFS_MS.length) {
          const delay = RETRY_BACKOFFS_MS[attempt];
          console.warn(`[compute] 0G HTTP ${r.status}, retry ${attempt + 1}/${RETRY_BACKOFFS_MS.length} after ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`0G compute HTTP ${r.status}`);
      } catch (err: any) {
        lastErr = err;
        if (attempt >= RETRY_BACKOFFS_MS.length) throw err;
        // Network-level failure — also retry with backoff.
        const delay = RETRY_BACKOFFS_MS[attempt];
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!res) throw lastErr || new Error("0G compute exhausted retries");

    const chatID = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key") || undefined;
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const finalChatID = chatID || data.id;
    const usage = data.usage ? JSON.stringify(data.usage) : undefined;
    // Fire-and-forget billing settle — don't block on it.
    broker.inference.processResponse(provider.provider, finalChatID, usage).catch(() => {});
    return { text, source: "0g-compute", provider: provider.provider, model, elapsedMs: Date.now() - t0 };
  } catch (err) {
    console.warn("[compute] 0G exhausted retries, falling back to Ollama:", String(err));
    const text = await callOllama(system, user, opts);
    return { text, source: "ollama", model: OLLAMA_MODEL, elapsedMs: Date.now() - t0 };
  }
}

async function callOllama(system: string, user: string, opts: { maxTokens?: number; temperature?: number }): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      options: { temperature: opts.temperature ?? 0, num_predict: opts.maxTokens ?? 400 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data: any = await res.json();
  return data.message?.content || "";
}
