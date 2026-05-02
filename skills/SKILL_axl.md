# SKILL: Gensyn AXL Integration
## Session 3 (Part 1) — P2P Agent Mesh

Read `SKILL_environment.md` and `SKILL_contracts.md` first. AXL binary must be verified working before this session.

---

## AXL Architecture in Nuncius

```
AXL Node 1 (Agent 1, port 9002/api 10001)
AXL Node 2 (Agent 2, port 9003/api 10002)
AXL Node 3 (Agent 3, port 9004/api 10003)
AXL Node 4 (Agent 4, port 9005/api 10004)
AXL Node 5 (Agent 5, port 9006/api 10005)
```

All 5 nodes form a mesh. When a new proposal opens, the coordinator (external script or the owner's wallet) broadcasts to all nodes via GossipSub. Each agent receives, deliberates independently, and sends its proof directly to the contract — **no central coordinator handles votes**. This is the architectural requirement for Gensyn's prize.

---

## Node Config Files

Create `agents/axl-configs/node-{1-5}.json`. Pattern:

```json
{
  "private_key_path": "../../keys/private-1.pem",
  "listen_addr": "0.0.0.0:9002",
  "api_addr": "127.0.0.1:10001",
  "bootstrap_peers": []
}
```

For nodes 2–5, add node 1 as bootstrap peer after starting it:
```json
{
  "private_key_path": "../../keys/private-2.pem",
  "listen_addr": "0.0.0.0:9003",
  "api_addr": "127.0.0.1:10002",
  "bootstrap_peers": ["<NODE_1_PEER_ID>@127.0.0.1:9002"]
}
```

Get node 1's peer ID after starting it: `curl http://127.0.0.1:10001/id`

---

## `agents/shared/axl-client.ts`

```typescript
// AXL HTTP API wrapper
// AXL exposes a local HTTP API on the api_addr port.
// Your TypeScript app talks to localhost — AXL handles all P2P routing.

export interface AXLMessage {
  peer_id: string;
  topic?: string;   // for GossipSub broadcast
  data: string;     // JSON string
}

export interface AXLClient {
  nodeId: string;
  apiUrl: string;
}

export async function createAXLClient(apiUrl: string): Promise<AXLClient> {
  const res = await fetch(`${apiUrl}/id`);
  const { id } = await res.json();
  return { nodeId: id, apiUrl };
}

/// Send a direct message to a specific peer
export async function sendDirect(
  client: AXLClient,
  peerId: string,
  payload: object
): Promise<void> {
  const res = await fetch(`${client.apiUrl}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      peer_id: peerId,
      data: JSON.stringify(payload),
    }),
  });
  if (!res.ok) throw new Error(`AXL send failed: ${res.statusText}`);
}

/// Broadcast to all peers subscribed to a topic (GossipSub)
export async function broadcast(
  client: AXLClient,
  topic: string,
  payload: object
): Promise<void> {
  const res = await fetch(`${client.apiUrl}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      data: JSON.stringify(payload),
    }),
  });
  if (!res.ok) throw new Error(`AXL publish failed: ${res.statusText}`);
}

/// Subscribe to a GossipSub topic, receive messages via callback
export async function subscribe(
  client: AXLClient,
  topic: string,
  onMessage: (msg: object) => void
): Promise<void> {
  // Subscribe
  await fetch(`${client.apiUrl}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });

  // Poll for messages (AXL uses SSE or polling depending on version)
  // Check AXL docs for the exact receive endpoint
  const poll = async () => {
    try {
      const res = await fetch(`${client.apiUrl}/receive?topic=${topic}`);
      if (res.ok) {
        const messages = await res.json();
        for (const msg of messages) {
          try {
            onMessage(JSON.parse(msg.data));
          } catch {}
        }
      }
    } catch {}
    setTimeout(poll, 500); // poll every 500ms
  };

  poll();
}
```

**Note:** AXL's exact API surface (SSE vs polling, endpoint names) may differ from the above. Check the actual AXL binary by running `curl http://127.0.0.1:10001/` after starting a node to list available endpoints. Adjust the client accordingly.

---

## Message Protocol

All AXL messages in Nuncius use this envelope:

```typescript
// agents/shared/types.ts — AXL message types

export type MessageType =
  | "PROPOSAL_BROADCAST"   // coordinator → all agents: new proposal opened
  | "DELIBERATION_UPDATE"  // agent → all agents: sharing intermediate reasoning
  | "VOTE_COMPLETE"        // agent → all agents: I have submitted my proof
  | "RESOLUTION_EVENT"     // coordinator → all agents: proposal resolved

export interface ZKSwarmMessage {
  type: MessageType;
  from: string;         // agent ID (e.g., "agent-1")
  proposalId: number;
  timestamp: number;
  payload: object;
}

export interface ProposalBroadcast {
  type: "PROPOSAL_BROADCAST";
  proposalId: number;
  description: string;
  groupId: string;
  contractAddress: string;
}

export interface DeliberationUpdate {
  type: "DELIBERATION_UPDATE";
  from: string;
  proposalId: number;
  reasoning: string;    // intermediate thoughts (not the vote itself)
  confidence: number;   // 0–1
}

export interface VoteComplete {
  type: "VOTE_COMPLETE";
  from: string;
  proposalId: number;
  txHash: string;       // on-chain proof submission tx
  // NOTE: does NOT include the actual vote — that's anonymous
}
```

---

## `scripts/start-all.sh`

```bash
#!/bin/bash

AXL_BINARY=${AXL_BINARY_PATH:-./axl/node}
CONFIG_DIR=./agents/axl-configs
KEYS_DIR=./keys
LOG_DIR=./logs

mkdir -p $LOG_DIR

echo "Starting AXL nodes..."

# Start node 1 first (bootstrap)
$AXL_BINARY -config $CONFIG_DIR/node-1.json > $LOG_DIR/axl-1.log 2>&1 &
echo "AXL Node 1 started (PID $!)"
sleep 2  # wait for node 1 to be up before others try to connect

# Get node 1 peer ID and inject into other configs
NODE1_ID=$(curl -s http://127.0.0.1:10001/id | jq -r '.id')
echo "Node 1 peer ID: $NODE1_ID"

# Update configs 2-5 with bootstrap peer
for i in 2 3 4 5; do
  PORT=$((9001 + i))
  jq --arg peer "${NODE1_ID}@127.0.0.1:9002" \
     '.bootstrap_peers = [$peer]' \
     $CONFIG_DIR/node-$i.json > /tmp/node-$i-patched.json
  $AXL_BINARY -config /tmp/node-$i-patched.json > $LOG_DIR/axl-$i.log 2>&1 &
  echo "AXL Node $i started (PID $!)"
  sleep 0.5
done

sleep 3
echo ""
echo "All 5 AXL nodes running."
echo "Node APIs:"
for i in 1 2 3 4 5; do
  PORT=$((10000 + i))
  ID=$(curl -s http://127.0.0.1:$PORT/id | jq -r '.id' 2>/dev/null || echo "not ready")
  echo "  Node $i (127.0.0.1:$PORT): $ID"
done

echo ""
echo "Start agents with: npm run start:all (in agents/ directory)"
```

---

## Verifying for Gensyn Prize

The Gensyn qualification requirement is: **"Must demonstrate communication across separate AXL nodes, not just in-process."**

Include in your README a screenshot or log showing:
1. Five separate AXL processes running (show `ps aux | grep axl` or the start script output)
2. A message sent from node 1 received by node 3 (different processes, different ports)
3. Ideally: GossipSub broadcast received by all 5 nodes

In `ARCHITECTURE.md`, explicitly state: "Each voter agent runs as a separate OS process with its own AXL node. The AXL mesh is peer-to-peer with no central message broker. Killing any single agent does not break communication between the remaining agents."

---

## Session 3 (AXL) Deliverables Checklist

- [ ] `agents/axl-configs/node-{1-5}.json` created
- [ ] `scripts/start-all.sh` executable and working
- [ ] All 5 AXL nodes start cleanly
- [ ] `curl http://127.0.0.1:10001/id` returns a peer ID
- [ ] Test: broadcast from node 1 received by node 3 (logged in `logs/axl-3.log`)
- [ ] `agents/shared/axl-client.ts` implemented and tested
