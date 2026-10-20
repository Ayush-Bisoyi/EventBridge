# EventBridge — Webhook Processing and Live Monitoring

## Submission overview

This repository contains my implementation of the EventBridge task for the GDG x Iris recruitment challenge.

I built a full-stack webhook platform that accepts authenticated JSON events, stores them in PostgreSQL, processes them asynchronously, records failures, supports authenticated retries, and updates a live dashboard using Server-Sent Events.

The implementation follows the official [EventBridge challenge](https://github.com/WebClub-NITK/GDGxIris-Recruitments-2026/blob/main/Challenges/EventBridge.md).

## Architecture

```text
Sender
  ↓ authenticated POST request
Webhook endpoint
  ↓ verify secret and calculate idempotency key
PostgreSQL
  ↓ save event as Received
Asynchronous pipeline
  ↓ validate and call downstream HTTP service
Completed or Failed
  ↓
Live dashboard through SSE
```

I persist each event before calling the downstream service. This prevents a downstream failure or application crash from losing the original payload.

## Requirement mapping

| Challenge requirement | My implementation |
| --- | --- |
| Authenticate webhook requests | `X-Webhook-Secret` is checked before the webhook body is processed. |
| Persist events immediately | Events are inserted into PostgreSQL before asynchronous processing starts. |
| Assign unique event IDs | Node's cryptographically secure `randomUUID()` generates IDs. |
| Deduplicate deliveries | `X-Delivery-ID`, then `X-Idempotency-Key`, then SHA-256 of the raw body are used as the unique `delivery_key`. |
| Public live dashboard | `GET /api/events` exposes safe metadata. |
| Private payload details | `GET /api/events/:id` requires a signed viewer cookie. |
| Real-time updates | `GET /api/events/stream` provides Server-Sent Events. |
| Downstream processing | The pipeline validates the payload and calls an HTTP downstream service. |
| Failure handling | Errors become durable `Failed` rows with a failure reason. |
| Manual retry | Authenticated viewers can call `POST /api/events/:id/retry`. |
| Double-click protection | PostgreSQL atomically claims an event using `processing = FALSE`. |
| Restart persistence | PostgreSQL stores the event state and original JSON payload. |
| Public deployment support | `render.yaml` defines the Node service and PostgreSQL database. |

## Design decisions

### PostgreSQL

I used PostgreSQL instead of an in-memory array or local JSON file because event history must survive process restarts and deployments. PostgreSQL also provides the unique constraint and atomic update needed for idempotency and retry locking.

### Server-Sent Events

The dashboard only needs server-to-browser updates, so SSE is simpler than a bidirectional WebSocket connection. The browser first loads the current event list and then receives future changes through `EventSource`.

### Authentication

The webhook secret, admin password, and session secret are environment variables. After successful viewer login, the server creates an HMAC-signed, HTTP-only cookie. Payload details and retry operations are protected on the server, not merely hidden in the frontend.

### Internal downstream simulator

The default downstream step is a token-protected internal HTTP route so the complete pipeline can be demonstrated without a third-party account. A payload with `simulateFailureOnAttempt: 1` fails on its first attempt and succeeds when retried. A real service can be configured using `DOWNSTREAM_URL`.

## Event lifecycle

```text
Received → Completed
Received → Failed → Completed after retry
Received → Failed → Failed after retry
```

The `processing` boolean is an internal lock. The `attempt_count` increases whenever a database claim succeeds, including retries.

## Idempotency

Webhook senders may retry when a response is lost. Without deduplication, one real event could create multiple rows and trigger downstream work more than once.

The server chooses the delivery key in this order:

1. `X-Delivery-ID` from the sender.
2. `X-Idempotency-Key` from the sender.
3. SHA-256 of the exact raw request body.

The raw body is hashed before JSON parsing because parsing and reserializing JSON can change whitespace or key order. The database has a unique constraint on `delivery_key`, so PostgreSQL remains the final authority even when duplicate requests arrive simultaneously.

## Failure and retry handling

The pipeline follows this order:

```text
claim → validate → call downstream → mark Completed or Failed
```

Retry claiming uses an atomic database operation:

```sql
UPDATE events
SET processing = TRUE,
    attempt_count = attempt_count + 1
WHERE id = $1
  AND status = 'Failed'
  AND processing = FALSE
RETURNING *;
```

If two retry requests arrive together, only one can change `processing` from `FALSE` to `TRUE`. The other request receives a conflict response and does not start another downstream call.

## Security decisions

- Secrets are stored in environment variables and are not committed.
- `.env` is excluded by `.gitignore` and `.dockerignore`.
- The webhook secret is checked before the webhook body parser.
- Secret comparisons use `crypto.timingSafeEqual`.
- Viewer cookies are HTTP-only and HMAC-signed.
- Public responses and SSE messages exclude payload contents.
- Payload and retry routes enforce authentication on the backend.

This is a challenge-sized single-admin design. A production multi-user system would additionally use an identity provider, password hashing, rate limiting, CSRF protection, secret rotation, and structured audit logs.

## Project structure

```text
src/server.js       Express routes, SSE connections, startup and shutdown
src/config.js       Environment configuration and validation
src/auth.js         Signed sessions and constant-time secret checks
src/db.js           PostgreSQL access and atomic event claims
src/pipeline.js     Validation, downstream call, and final status updates
src/downstream.js   Downstream HTTP client with timeout handling
src/validation.js   Event payload validation
db/schema.sql       PostgreSQL schema and indexes
public/index.html   Dashboard HTML structure
public/app.js       Dashboard rendering, login, retry, and SSE client
public/styles.css   Dashboard styling
Dockerfile          Production container definition
docker-compose.yml  Local PostgreSQL and application services
render.yaml         Render deployment blueprint
scripts/demo.sh     Repeatable curl demonstration
test/               Unit tests
DESIGN.md           Dated engineering decisions
LEARNING.md         Concepts and interview preparation
```

## Local reproduction

### Prerequisites

- Docker Desktop, or
- Node.js 20+ and PostgreSQL

### Run with Docker

```bash
docker compose up --build
```

The application is available at `http://localhost:3000`.

The local Docker configuration uses:

```text
Webhook secret: local-webhook-secret
Viewer password: local-admin-password
```

These values are for local development only.

### Run without Docker

After starting PostgreSQL, I can run:

```bash
cp .env.example .env
npm install
npm run check
npm test
npm start
```

The database schema is initialized automatically during startup.

## Demonstration procedure

### Successful event

```bash
curl -i -X POST http://localhost:3000/api/webhooks/events \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: local-webhook-secret' \
  -H 'X-Delivery-ID: demo-success-001' \
  -d '{"type":"payment.succeeded","amount":499}'
```

The request receives `202 Accepted`. The dashboard shows `Received` and then `Completed`.

### Duplicate delivery

Send the same request again with the same delivery ID. The response contains `duplicate: true`, and no second database row is created.

### Failure followed by retry

```bash
curl -i -X POST http://localhost:3000/api/webhooks/events \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: local-webhook-secret' \
  -H 'X-Delivery-ID: demo-retry-001' \
  -d '{"type":"temporary.outage","simulateFailureOnAttempt":1}'
```

The first attempt becomes `Failed`. After signing in with `local-admin-password`, selecting the event, and choosing **Retry failed event**, attempt 2 succeeds and the event becomes `Completed`.

### Permanent failure

```bash
curl -i -X POST http://localhost:3000/api/webhooks/events \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: local-webhook-secret' \
  -H 'X-Delivery-ID: demo-failure-001' \
  -d '{"type":"payment.failed","simulateFailure":true}'
```

This event remains `Failed` after retry because the stored payload requests failure every time.

### Live stream

```bash
curl -N http://localhost:3000/api/events/stream
```

Two open dashboard tabs receive the same updates without a manual refresh.

## API reference

| Method | Route | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/webhooks/events` | `X-Webhook-Secret` | Accept and persist a webhook. |
| `GET` | `/api/events` | Public | List safe event metadata. |
| `GET` | `/api/events/stream` | Public | Subscribe to SSE updates. |
| `GET` | `/api/events/:id` | Signed viewer cookie | Read the original payload. |
| `POST` | `/api/events/:id/retry` | Signed viewer cookie | Retry a failed event. |
| `GET` | `/api/auth/me` | Cookie if present | Check viewer authentication. |
| `POST` | `/api/auth/login` | Password in request body | Create a signed viewer cookie. |
| `POST` | `/api/auth/logout` | None | Delete the viewer cookie. |
| `GET` | `/healthz` | Public | Check application and database health. |

## Deployment

I included `render.yaml` for a public deployment consisting of one Node.js web service and one managed PostgreSQL database. It configures generated webhook and session secrets, a privately supplied admin password, and `/healthz` as the deployment health check.

The deployed application URL and webhook secret should be shared with reviewers through the private submission channel, not committed to this repository. The repository itself should remain private until the recruitment team permits public visibility.

## Evaluator verification

1. Start the application with Docker Compose.
2. Open two dashboard browser tabs.
3. Send a successful webhook.
4. Confirm both tabs update without refreshing.
5. Send the same delivery twice and confirm one event row exists.
6. Send a payload that intentionally fails.
7. Sign in and retry the failed event.
8. Confirm the attempt count increases.
9. Confirm the event becomes `Completed` or remains `Failed` with a reason.
10. Reload the browser and restart the application to confirm PostgreSQL persistence.
11. Confirm unauthenticated requests cannot read payloads or trigger retries.

## Scope and future improvements

Possible production improvements include a processing lease for crash recovery, login rate limiting, a multi-user identity provider, password hashing, structured logs, request correlation IDs, pagination, shared pub/sub for multiple application instances, and integration tests using a temporary PostgreSQL database.

