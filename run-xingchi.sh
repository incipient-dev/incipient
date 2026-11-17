#!/usr/bin/env bash
# Run INCIPIENT with the Xingchi endpoint (https://xingchiapi.com/v1).
# Fetches a fresh credential surrogate (the real key is never printed, logged,
# or written to disk) and passes it to INCIPIENT via env var, mirroring
# opencode-xingchi.sh. Usage:
#   ./run-xingchi.sh doctor
#   ./run-xingchi.sh plan "your task"
#   ./run-xingchi.sh run "your task" --yes
# Model: gpt-6.1-sol by default; override with INCIPIENT_MODEL=gpt-6-astra.
set -euo pipefail
KEY=$(python3 - <<'PY'
import sys
sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import dynamic_credential_entry
print(dynamic_credential_entry("custom.xingchiapi", "access_token")["surrogate"])
PY
)
export INCIPIENT_API_KEY="$KEY"
export INCIPIENT_BASE_URL="https://xingchiapi.com/v1"
export INCIPIENT_MODEL="${INCIPIENT_MODEL:-gpt-6.1-sol}"
exec node "$(dirname "$0")/dist/cli.js" "$@"
