#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-local-webhook-secret}"

echo "1) Health check"
curl --fail --silent "$BASE_URL/healthz"
echo

echo "2) Successful event"
curl --fail --silent -X POST "$BASE_URL/api/webhooks/events" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H 'X-Delivery-ID: demo-script-success' \
  -d '{"type":"demo.success","source":"demo-script"}'
echo

echo "3) Event that fails once and succeeds on retry"
curl --fail --silent -X POST "$BASE_URL/api/webhooks/events" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H 'X-Delivery-ID: demo-script-retry' \
  -d '{"type":"demo.retry","simulateFailureOnAttempt":1}'
echo

echo "4) Duplicate delivery (should report duplicate=true)"
curl --fail --silent -X POST "$BASE_URL/api/webhooks/events" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H 'X-Delivery-ID: demo-script-success' \
  -d '{"type":"demo.success","source":"demo-script"}'
echo

echo "Open $BASE_URL, sign in, inspect demo-script-retry, and press Retry."

