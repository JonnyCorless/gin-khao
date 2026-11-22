#!/usr/bin/env bash
# One-command devnet (or localnet) deployment of the SolanaSmash escrow.
#
#   scripts/deploy-devnet.sh                      # devnet
#   CLUSTER=http://127.0.0.1:8899 scripts/deploy-devnet.sh   # local validator (used to test this script)
#
# Creates keys in ./keys (gitignored: NEVER commit them), deploys the program, initialises the config with
# fee = 3.3% (330 bps), funds the treasury + server authority, and writes ./.env.devnet for the server.
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CLUSTER="${CLUSTER:-https://api.devnet.solana.com}"
FEE_BPS="${FEE_BPS:-330}"
KEYS="$ROOT/keys"

case "$CLUSTER" in
  *devnet*|*127.0.0.1*|*localhost*) ;;
  *) [ "${I_UNDERSTAND_MAINNET:-}" = "yes" ] || { echo "Refusing to deploy to a non-devnet cluster ($CLUSTER)."; exit 1; } ;;
esac

command -v solana >/dev/null || { echo "Solana CLI not found. Install: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\""; exit 1; }
command -v cargo-build-sbf >/dev/null || { echo "cargo-build-sbf not found (comes with the Solana CLI)"; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) not found"; exit 1; }

mkdir -p "$KEYS"
chmod 700 "$KEYS"
gen() { [ -f "$KEYS/$1.json" ] || { solana-keygen new --no-bip39-passphrase -s -o "$KEYS/$1.json" >/dev/null; echo "generated keys/$1.json"; }; }
gen program; gen authority; gen admin
[ -n "${TREASURY:-}" ] || { gen treasury; TREASURY="$(solana-keygen pubkey "$KEYS/treasury.json")"; }

PROGRAM_ID="$(solana-keygen pubkey "$KEYS/program.json")"
ADMIN="$(solana-keygen pubkey "$KEYS/admin.json")"
AUTHORITY="$(solana-keygen pubkey "$KEYS/authority.json")"
echo "program   $PROGRAM_ID"
echo "admin     $ADMIN"
echo "authority $AUTHORITY"
echo "treasury  $TREASURY  (receives the 3.3% fee)"

# make the source use this program id
sed -i "s/declare_id!(\"[1-9A-HJ-NP-Za-km-z]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/escrow/programs/escrow/src/lib.rs
sed -i "s/^escrow = \"[1-9A-HJ-NP-Za-km-z]*\"/escrow = \"$PROGRAM_ID\"/" programs/escrow/Anchor.toml

balance() { solana balance "$1" -u "$CLUSTER" 2>/dev/null | awk '{print int($1)}'; }
need_sol() {  # need_sol <pubkey> <whole SOL wanted>
  local have; have="$(balance "$1" || echo 0)"
  local tries=0
  while [ "${have:-0}" -lt "$2" ] && [ $tries -lt 6 ]; do
    solana airdrop 2 "$1" -u "$CLUSTER" >/dev/null 2>&1 || { echo "airdrop rate-limited. Send devnet SOL to $1 via https://faucet.solana.com and re-run."; sleep 4; }
    have="$(balance "$1" || echo 0)"; tries=$((tries+1))
  done
  [ "${have:-0}" -ge "$2" ] || { echo "$1 has ${have:-0} SOL, needs $2. Fund it (https://faucet.solana.com) and re-run this script."; exit 1; }
}

echo "== funding admin (deploy rent is ~2 SOL, refundable by closing the program)"
need_sol "$ADMIN" 4

echo "== building program"
(cd programs/escrow && cargo build-sbf)

echo "== deploying"
solana program deploy -u "$CLUSTER" --keypair "$KEYS/admin.json" --program-id "$KEYS/program.json" programs/escrow/target/deploy/escrow.so

echo "== initialising config (fee ${FEE_BPS} bps)"
if ! ADMIN_KEYPAIR="$KEYS/admin.json" AUTHORITY="$AUTHORITY" TREASURY="$TREASURY" PROGRAM_ID="$PROGRAM_ID" RPC_URL="$CLUSTER" FEE_BPS="$FEE_BPS" \
     npx tsx apps/server/scripts/init-config.ts; then
  echo "(config may already exist from a previous run; use update_config to change it)"
fi

echo "== funding treasury (rent-exempt minimum) and server authority (pays settlement tx fees)"
solana transfer "$TREASURY" 0.01 -u "$CLUSTER" --keypair "$KEYS/admin.json" --allow-unfunded-recipient >/dev/null
solana transfer "$AUTHORITY" 0.5 -u "$CLUSTER" --keypair "$KEYS/admin.json" --allow-unfunded-recipient >/dev/null

cat > "$ROOT/.env.devnet" <<EOF
CHAIN_MODE=solana
RPC_URL=$CLUSTER
PROGRAM_ID=$PROGRAM_ID
TREASURY=$TREASURY
AUTHORITY_KEYPAIR_FILE=$KEYS/authority.json
FEE_BPS=$FEE_BPS
STAKE_LAMPORTS=10000000
PORT=8787
EOF
chmod 600 "$ROOT/.env.devnet"

echo
echo "DONE. Start the game (server + web client on one port):"
echo "  npm run build -w @solanasmash/client"
echo "  set -a; . ./.env.devnet; set +a; npm start"
echo "Then open http://localhost:8787 with Phantom set to Devnet (Settings > Developer Settings > Testnet Mode > Solana Devnet)."
echo "Back up ./keys somewhere safe (admin.json controls the config; authority.json settles matches)."
