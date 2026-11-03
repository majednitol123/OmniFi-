#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Starting OmniFi Automated Chaos Engineering Rehearsal..."
cd "${ROOT_DIR}"

# Execute typescript chaos runner using pnpm tsx or vitest
pnpm tsx "${ROOT_DIR}/scripts/chaos-rehearsal.ts"

echo "Chaos engineering drills completed successfully."

