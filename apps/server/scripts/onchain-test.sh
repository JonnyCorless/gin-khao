#!/usr/bin/env bash
# Builds the escrow program, boots a local validator with it, runs the on-chain integration test.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KEY="${PROGRAM_KEYPAIR:-$ROOT/keys/program.json}"
[ -f "$KEY" ] || { mkdir -p "$ROOT/keys"; solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null; echo "generated $KEY: put its pubkey into declare_id!/Anchor.toml/PROGRAM_ID"; }
PID="$(solana-keygen pubkey "$KEY")"
grep -q "$PID" "$ROOT/programs/escrow/programs/escrow/src/lib.rs" || { echo "declare_id! does not match $KEY ($PID)"; exit 1; }

LEDGER="$(mktemp -d)"
# test build has a 6s settle timeout and goes to a temp dir so it can never be deployed by mistake
(cd "$ROOT/programs/escrow" && cargo build-sbf --features short-timeout --sbf-out-dir "$LEDGER/sbf")
solana-test-validator --reset --quiet --ledger "$LEDGER/ledger" --bpf-program "$PID" "$LEDGER/sbf/escrow.so" >"$LEDGER/validator.log" 2>&1 &
VAL=$!
trap 'kill $VAL 2>/dev/null || true; rm -rf "$LEDGER"' EXIT
for i in $(seq 1 90); do curl -s localhost:8899/health | grep -q ok && break; sleep 1; done
cd "$ROOT" && ONCHAIN=1 PROGRAM_ID="$PID" npx tsx --test apps/server/test/onchain.test.ts
