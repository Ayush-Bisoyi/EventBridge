# Design Log

This document records decisions instead of presenting the implementation as if every choice were obvious. Dates use the project date, 2026-10-18.

## 2026-10-18 — Use a single Node service

I chose one Express process that serves the static dashboard and API. I rejected separate React and API deployments because the challenge is about event reliability and real-time behavior, not frontend build tooling. One service reduces deployment variables and makes the request-to-database path easy to trace.

## 2026-10-18 — Use PostgreSQL as the source of truth

I chose PostgreSQL instead of an in-memory array or local JSON file. An in-memory store loses events on restart, while a local file is difficult to operate safely on a public host. PostgreSQL gives unique constraints, JSONB, atomic updates, and durable storage across web-service restarts.

## 2026-10-18 — Check the webhook secret before the body parser

I placed the authentication middleware before `express.raw`. I rejected a global JSON parser because the requirement explicitly asks for the header secret to be checked before the body is accepted. This also avoids wasting JSON parsing work on unauthorized requests.

## 2026-10-18 — Hash the raw body for fallback idempotency

I chose SHA-256 of the raw bytes when the sender omits a delivery key. I rejected hashing the parsed object because object key order and JSON formatting can change the bytes that the sender actually delivered. A sender-provided key remains preferred because two distinct deliveries can legitimately contain equal JSON.

## 2026-10-18 — Persist before downstream work

I insert the row before starting the asynchronous pipeline. I rejected calling the downstream service first because a downstream timeout or process crash could otherwise lose the original payload. The durable row is the recovery point.

## 2026-10-18 — Use a conditional database claim as the concurrency lock

I use `UPDATE ... WHERE processing = FALSE RETURNING *` to claim work. I rejected a JavaScript boolean lock because it would not coordinate multiple app processes and would disappear on restart. PostgreSQL evaluates the conditional update atomically, so two retry requests cannot both claim the same event.

## 2026-10-18 — Use SSE instead of WebSockets

I chose Server-Sent Events because the dashboard has one-way server-to-browser updates. I rejected WebSockets because bidirectional messaging is unnecessary here; login and retry are normal HTTP requests. SSE also reconnects through the browser's built-in `EventSource` API.

## 2026-10-18 — Keep payload access private while metadata is public

I expose event id, timestamps, status, and attempt count publicly, but require the signed viewer cookie for payloads and retries. I rejected showing the complete JSON in the public table because webhook payloads often contain customer or operational data.

## 2026-10-18 — Use a deterministic internal HTTP downstream by default

I made the default downstream step a token-protected local HTTP endpoint, with `simulateFailure: true` producing a known failure and `simulateFailureOnAttempt: 1` producing a successful retry. I rejected requiring a third-party API for local development because recruitment reviewers should be able to reproduce the failure and retry flow without another account. `DOWNSTREAM_URL` remains available for a real HTTP integration.

## 2026-10-18 — Treat retries as a new attempt over the original payload

The retry route never accepts a replacement payload. It reads the stored payload and reruns the same pipeline. I rejected allowing the browser to edit the payload because that would no longer test recovery of the original event and could let a viewer alter audit history.

## 2026-10-18 — Make infrastructure reproducible

I included Docker Compose for local PostgreSQL and a Render Blueprint for deployment. I rejected documentation that only says “install PostgreSQL” because a reviewer should be able to reproduce the same database shape with one command.

