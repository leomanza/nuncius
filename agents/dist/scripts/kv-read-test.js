"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(REPO_ROOT, ".env.secrets") });
const _0g_kv_client_1 = require("../shared/0g-kv-client");
async function main() {
    const dao = process.env.DISPUTE_DAO_ADDRESS;
    for (let i = 1; i <= 5; i++) {
        const sid = (0, _0g_kv_client_1.getStreamId)(dao, i);
        const state = await (0, _0g_kv_client_1.readAgentState)(dao, i);
        console.log(`agent ${i}: streamId=${sid.slice(0, 18)}…  state=${state ? JSON.stringify({ s: state.state, d: state.decision, src: state.source }) : "null (KV read returned nothing — may take a few minutes for indexer to sync)"}`);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
