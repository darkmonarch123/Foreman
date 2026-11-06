#!/usr/bin/env bash
# Runs the end-to-end suite (tests/e2e) against a running Foreman and a REAL Supabase project.
#
#   ./scripts/run-e2e.sh                         # app at http://localhost:3000
#   E2E_BASE_URL=https://foreman-xtor.onrender.com ./scripts/run-e2e.sh
#
# Asks for any missing E2E_* value (passwords are not echoed and not saved anywhere).
# Every run creates boards, an invitation and comments in that project; use test accounts.
set -euo pipefail

export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"

ask() { # name, prompt, secret
  local name="$1" prompt="$2" secret="${3:-}" value
  if [ -z "${!name:-}" ]; then
    if [ -n "$secret" ]; then read -r -s -p "$prompt: " value; echo; else read -r -p "$prompt: " value; fi
    export "$name=$value"
  fi
}
ask E2E_OWNER_EMAIL "Owner account email"
ask E2E_OWNER_PASSWORD "Owner account password" secret
ask E2E_COLLABORATOR_EMAIL "Collaborator account email"
ask E2E_COLLABORATOR_PASSWORD "Collaborator account password" secret

if [ "$E2E_OWNER_EMAIL" = "$E2E_COLLABORATOR_EMAIL" ]; then
  echo "The owner and collaborator must be two different accounts." >&2
  exit 1
fi

echo "Checking $E2E_BASE_URL/api/health ..."
if ! health="$(curl -fsS --max-time 60 "$E2E_BASE_URL/api/health")"; then
  echo "Foreman is not answering at $E2E_BASE_URL. Start it first (npm run build && npm run start)." >&2
  exit 1
fi
case "$health" in
  *'"supabaseConfigured":true'*) echo "OK: $health" ;;
  *) echo "Foreman is running but Supabase is not configured: $health" >&2; exit 1 ;;
esac

npx playwright test --project=e2e "$@"
