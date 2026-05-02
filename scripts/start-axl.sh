#!/usr/bin/env bash
# Boot the 5-node AXL mesh.
#
# Bootstrap (node 1) listens on tls://0.0.0.0:9001.
# Nodes 2..5 dial it as a peer; mesh forms via Yggdrasil's discovery.
# Each node has a unique api_port (10001..10005). All share tcp_port 7000
# (the dial port over Yggdrasil's gVisor stack — must match across nodes).
#
# Usage:
#   ./scripts/start-axl.sh         # foreground (Ctrl-C kills all)
#   BACKGROUND=1 ./scripts/start-axl.sh  # detach + write peer ids to logs/axl-peer-ids.json

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AXL_BIN="${AXL_BIN:-$REPO_ROOT/axl-src/node}"
CONFIG_DIR="$REPO_ROOT/axl"
LOG_DIR="$REPO_ROOT/logs"
PID_FILE="$LOG_DIR/axl.pids"

mkdir -p "$LOG_DIR"

if [[ ! -x "$AXL_BIN" ]]; then
  echo "AXL binary not found at $AXL_BIN — run \`(cd axl-src && make build)\`" >&2
  exit 1
fi

# Tear down any existing AXL processes before re-starting (idempotent).
pkill -f "axl-src/node" 2>/dev/null || true
sleep 1
: > "$PID_FILE"

echo "Starting 5-node AXL mesh ..."
for i in 1 2 3 4 5; do
  CFG="$CONFIG_DIR/node-$i.json"
  LOG="$LOG_DIR/axl-$i.log"
  "$AXL_BIN" -config "$CFG" > "$LOG" 2>&1 &
  PID=$!
  echo "$i $PID" >> "$PID_FILE"
  echo "  node $i started — pid $PID — log $LOG"
  # Slight stagger so node-1 is up before peers dial it.
  if [[ $i -eq 1 ]]; then sleep 2; else sleep 0.3; fi
done

# Wait for /topology on every node, then capture peer IDs.
sleep 3
echo ""
echo "Peer IDs (from /topology):"
PEER_IDS_JSON="$LOG_DIR/axl-peer-ids.json"
echo "{" > "$PEER_IDS_JSON"
for i in 1 2 3 4 5; do
  PORT=$((10000 + i))
  ID=$(curl -fsS "http://127.0.0.1:$PORT/topology" | jq -r '.our_public_key')
  PEER_COUNT=$(curl -fsS "http://127.0.0.1:$PORT/topology" | jq -r '.peers | length')
  echo "  node $i (api 127.0.0.1:$PORT): $ID ($PEER_COUNT peers)"
  COMMA=","; [[ $i -eq 5 ]] && COMMA=""
  echo "  \"agent-$i\": { \"api\": \"http://127.0.0.1:$PORT\", \"peer_id\": \"$ID\" }$COMMA" >> "$PEER_IDS_JSON"
done
echo "}" >> "$PEER_IDS_JSON"
echo ""
echo "Wrote $PEER_IDS_JSON"

if [[ -z "${BACKGROUND:-}" ]]; then
  echo ""
  echo "AXL nodes running in foreground. Ctrl-C to stop."
  trap 'pkill -f "axl-src/node" 2>/dev/null; echo " stopped"; exit 0' INT TERM
  wait
else
  echo ""
  echo "AXL detached. Stop with:  pkill -f \"axl-src/node\""
fi
