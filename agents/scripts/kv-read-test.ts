import * as dotenv from "dotenv";
import * as path from "path";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });

import { readAgentState, getStreamId } from "../shared/0g-kv-client";

async function main() {
  const dao = process.env.DISPUTE_DAO_ADDRESS!;
  for (let i = 1; i <= 5; i++) {
    const sid = getStreamId(dao, i);
    const state = await readAgentState(dao, i);
    console.log(`agent ${i}: streamId=${sid.slice(0, 18)}…  state=${state ? JSON.stringify({s: state.state, d: state.decision, src: state.source}) : "null (KV read returned nothing — may take a few minutes for indexer to sync)"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
