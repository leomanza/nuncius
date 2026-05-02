/// POST /api/propose
///
/// Server-side coordinator. Reads PRIVATE_KEY (deployer / DAO owner) from
/// .env.local, opens a new proposal on DisputeDAO, then fans out a
/// PROPOSAL_BROADCAST envelope to all 5 agents via the local AXL node 1
/// HTTP API.
///
/// This mirrors what `agents/scripts/trigger-proposal.ts` does — but in-process
/// so the dashboard "Pose a question" button can drive the demo without a
/// terminal.

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://evmrpc-testnet.0g.ai";
const DAO_ADDRESS = process.env.DISPUTE_DAO_ADDRESS || process.env.NEXT_PUBLIC_DISPUTE_DAO_ADDRESS;
const COORDINATOR_AXL = process.env.COORDINATOR_AXL || "http://127.0.0.1:10001";
const PEER_IDS_PATH =
  process.env.AXL_PEER_IDS_PATH ||
  path.resolve(process.cwd(), "..", "logs", "axl-peer-ids.json");

const DAO_ABI = [
  "function currentProposalId() view returns (uint256)",
  "function openProposal(string description) returns (uint256)",
  "function getProposal(uint256 id) view returns (tuple(uint256 id,string description,uint256 approveCount,uint256 rejectCount,bool resolved,bool approved,uint256 createdAt,uint256 resolvedAt))",
  "function groupId() view returns (uint256)",
];

interface ProposeRequest {
  description: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProposeRequest;
    const description = (body.description ?? "").toString().trim();
    if (!description) {
      return NextResponse.json({ error: "description required" }, { status: 400 });
    }
    if (description.length > 500) {
      return NextResponse.json({ error: "description too long (max 500 chars)" }, { status: 400 });
    }
    if (!DAO_ADDRESS) {
      return NextResponse.json({ error: "DISPUTE_DAO_ADDRESS missing on server" }, { status: 500 });
    }
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      return NextResponse.json(
        {
          error:
            "PRIVATE_KEY missing on server. Add it to .env.local (NOT NEXT_PUBLIC_) so this route can sign on behalf of the deployer.",
        },
        { status: 500 },
      );
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
    const dao = new ethers.Contract(DAO_ADDRESS, DAO_ABI, signer);

    let activeId: bigint = await dao.currentProposalId();
    let openedTxHash: string | null = null;
    let openedBlock: number | null = null;

    if (activeId === BigInt(0)) {
      const tx = await dao.openProposal(description);
      const rc = await tx.wait();
      openedTxHash = tx.hash;
      openedBlock = rc?.blockNumber ?? null;
      activeId = await dao.currentProposalId();
    } else {
      // An active proposal exists; refuse rather than reuse with a different
      // description (would mismatch what's on-chain).
      const proposal = await dao.getProposal(activeId);
      return NextResponse.json(
        {
          error: "active-proposal",
          message: `Proposal #${activeId} is still open. Wait for it to resolve before posing another.`,
          activeId: Number(activeId),
          activeDescription: proposal.description,
        },
        { status: 409 },
      );
    }

    // Fan out via AXL — best effort; failures here don't roll back the chain tx.
    let fanoutOk = 0;
    let fanoutFailed = 0;
    let fanoutSkipped = false;
    try {
      if (!fs.existsSync(PEER_IDS_PATH)) {
        fanoutSkipped = true;
      } else {
        const peers = JSON.parse(fs.readFileSync(PEER_IDS_PATH, "utf-8")) as Record<
          string,
          { peer_id: string }
        >;
        const peerIds = Object.values(peers).map((p) => p.peer_id);
        // Get our coordinator peer id
        const top = await fetch(`${COORDINATOR_AXL}/topology`).then((r) => r.json()).catch(() => null);
        const ourPeerId = top?.our_public_key ?? null;
        const proposal = await dao.getProposal(activeId);
        const groupId: bigint = await dao.groupId();
        const envelope = {
          type: "PROPOSAL_BROADCAST" as const,
          from: "coordinator",
          proposalId: Number(activeId),
          timestamp: Date.now(),
          payload: {
            proposalId: Number(activeId),
            description: proposal.description,
            contractAddress: DAO_ADDRESS,
            groupId: groupId.toString(),
            scope: activeId.toString(),
          },
        };
        const body = new TextEncoder().encode(JSON.stringify(envelope));
        await Promise.all(
          peerIds.map(async (pid) => {
            try {
              const res = await fetch(`${COORDINATOR_AXL}/send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Destination-Peer-Id": pid,
                },
                body,
              });
              if (res.ok) fanoutOk += 1;
              else fanoutFailed += 1;
            } catch {
              fanoutFailed += 1;
            }
          }),
        );
        if (ourPeerId && !peerIds.includes(ourPeerId)) {
          // optional: log to server stdout
        }
      }
    } catch (err) {
      // swallow — chain tx already landed
      fanoutSkipped = true;
    }

    return NextResponse.json({
      proposalId: Number(activeId),
      description,
      openedTxHash,
      openedBlock,
      fanout: { ok: fanoutOk, failed: fanoutFailed, skipped: fanoutSkipped },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "exception",
        message: err?.shortMessage || err?.message || String(err),
      },
      { status: 500 },
    );
  }
}
