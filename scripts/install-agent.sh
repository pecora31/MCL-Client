#!/usr/bin/env bash
# Installs mcl-agent as a systemd service on a Linux VPS: downloads the prebuilt binary from
# the latest MCL Client release, no Rust toolchain or build step needed.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo bash
#
# Override the data directory or port first if the defaults don't suit:
#   sudo MCL_AGENT_DIR=/opt/mcl-agent MCL_AGENT_PORT=9000 bash -c "$(curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh)"
set -euo pipefail

REPO="pecora31/MCL-Client"
DATA_DIR="${MCL_AGENT_DIR:-/var/lib/mcl-agent}"
PORT="${MCL_AGENT_PORT:-8642}"
BIND="${MCL_AGENT_BIND:-0.0.0.0}"
BIN_PATH="/usr/local/bin/mcl-agent"
SERVICE_PATH="/etc/systemd/system/mcl-agent.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "This needs root, it installs a systemd service and a binary under /usr/local/bin." >&2
  echo "Re-run with sudo." >&2
  exit 1
fi

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  echo "Only x86_64 Linux has a prebuilt mcl-agent binary right now (found: $ARCH)." >&2
  echo "Build from source instead, see the MCL Agent documentation page." >&2
  exit 1
fi

echo "Downloading the latest mcl-agent build..."
curl -fsSL "https://github.com/$REPO/releases/latest/download/mcl-agent-linux-x86_64" -o "$BIN_PATH"
chmod +x "$BIN_PATH"

mkdir -p "$DATA_DIR"

cat > "$SERVICE_PATH" <<SERVICE_EOF
[Unit]
Description=MCL Agent, remote Minecraft server control for MCL Client
After=network.target

[Service]
ExecStart=$BIN_PATH
Environment=MCL_AGENT_DIR=$DATA_DIR
Environment=MCL_AGENT_PORT=$PORT
Environment=MCL_AGENT_BIND=$BIND
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable --now mcl-agent

echo "Waiting for the agent to generate its token and certificate..."
for _ in $(seq 1 20); do
  if [ -f "$DATA_DIR/agent-token.txt" ] && [ -f "$DATA_DIR/agent-cert.pem" ]; then
    break
  fi
  sleep 0.5
done

if [ ! -f "$DATA_DIR/agent-token.txt" ]; then
  echo "The agent did not start in time. Check what happened with: systemctl status mcl-agent" >&2
  exit 1
fi

PUBLIC_IP="$(curl -fsSL --max-time 3 ifconfig.me 2>/dev/null || echo "<this-server-ip>")"

echo ""
echo "mcl-agent is installed and running as a systemd service."
echo ""
echo "Paste these into MCL when adding this host:"
echo ""
echo "URL:   https://$PUBLIC_IP:$PORT"
echo "Token: $(cat "$DATA_DIR/agent-token.txt")"
echo ""
echo "Certificate ($DATA_DIR/agent-cert.pem):"
echo ""
cat "$DATA_DIR/agent-cert.pem"
echo ""
echo "Open port $PORT in this server's firewall and, if it's a cloud VPS, its security group,"
echo "separately from Minecraft's own port (25565 by default)."
