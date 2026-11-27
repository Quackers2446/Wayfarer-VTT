#!/usr/bin/env bash
# Create a Cloudflare Realtime TURN key and store short-lived-credential secrets
# on the wayfarer-vtt Pages project.
#
# Prerequisites:
#   - wrangler logged in (`npx wrangler login`) OR CLOUDFLARE_API_TOKEN set
#   - token needs Realtime / Calls Write permission
#   - ACCOUNT_ID of the Cloudflare account that owns wayfarer-vtt
#
# Usage:
#   ACCOUNT_ID=… ./scripts/setup-turn-secrets.sh
#   ACCOUNT_ID=… TURN_KEY_NAME=wayfarer-voice ./scripts/setup-turn-secrets.sh
set -euo pipefail

PROJECT="${PAGES_PROJECT:-wayfarer-vtt}"
KEY_NAME="${TURN_KEY_NAME:-wayfarer-voice}"

if [[ -z "${ACCOUNT_ID:-}" ]]; then
  echo "Set ACCOUNT_ID to your Cloudflare account id." >&2
  echo "Dashboard → account home → copy the Account ID." >&2
  exit 1
fi

AUTH_HEADER=()
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
elif [[ -f "${HOME}/.wrangler/config/default.toml" ]] || [[ -f "${HOME}/.config/.wrangler/config/default.toml" ]]; then
  echo "Using wrangler session via curl is not supported; set CLOUDFLARE_API_TOKEN." >&2
  echo "Create a token with Realtime permission, then re-run." >&2
  exit 1
else
  echo "Set CLOUDFLARE_API_TOKEN (Realtime / Calls Write)." >&2
  exit 1
fi

echo "Creating TURN key “${KEY_NAME}”…"
CREATE=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/calls/turn_keys" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d "{\"name\":\"${KEY_NAME}\"}")

ok=$(node -e 'const j=JSON.parse(process.argv[1]); if(!j.success){console.error(JSON.stringify(j.errors||j,null,2)); process.exit(1)} console.log(JSON.stringify(j.result))' "$CREATE")
KEY_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).uid)' "$ok")
KEY_SECRET=$(node -e 'const r=JSON.parse(process.argv[1]); console.log(r.secret||r.key||"")' "$ok")

if [[ -z "$KEY_ID" || -z "$KEY_SECRET" ]]; then
  echo "Cloudflare did not return a TURN key id/secret:" >&2
  echo "$CREATE" >&2
  exit 1
fi

echo "Storing Pages secrets on ${PROJECT}…"
printf '%s' "$KEY_ID" | npx wrangler pages secret put TURN_KEY_ID --project-name "$PROJECT"
printf '%s' "$KEY_SECRET" | npx wrangler pages secret put TURN_KEY_API_TOKEN --project-name "$PROJECT"

echo
echo "Done. Redeploy (or wait for the next deploy) so the worker sees the secrets."
echo "Join voice — the TURN warning should disappear when credentials mint successfully."
echo "First 1,000 GB/month of Realtime egress is free; STUN-only paths stay free."