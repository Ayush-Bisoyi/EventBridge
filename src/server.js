import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  closeDatabase,
  getEvent,
  initializeDatabase,
  insertOrFindEvent,
  listEvents,
  pingDatabase,
  claimRetryEvent,
  privateEvent,
  publicEvent
} from './db.js';
import { isViewer, loginViewer, logoutViewer, requireViewer, verifyAdminPassword, verifyInternalToken, verifyWebhookSecret } from './auth.js';
import { processClaimedEvent, processInitialEvent } from './pipeline.js';

const app = express();
const clients = new Set();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const jsonError = (res, status, error) => res.status(status).json({ error });

const broadcast = (event) => {
  const data = `event: event\ndata: ${JSON.stringify(publicEvent(event))}\n\n`;
  for (const response of clients) response.write(data);
};

const requireWebhookSecret = (req, res, next) => {
  if (!verifyWebhookSecret(req.get('x-webhook-secret'))) {
    return jsonError(res, 401, 'Invalid or missing X-Webhook-Secret');
  }
  return next();
};

// This middleware intentionally appears before the body parser. The server checks the
// header secret before reading/accepting the request body.
app.post('/api/webhooks/events', requireWebhookSecret, express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return jsonError(res, 400, 'Request body must be non-empty JSON');

  const rawBodyHash = crypto.createHash('sha256').update(req.body).digest('hex');
  const deliveryKey = req.get('x-delivery-id') || req.get('x-idempotency-key') || rawBodyHash;
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return jsonError(res, 400, 'Request body is not valid JSON');
  }

  try {
    const { event, duplicate } = await insertOrFindEvent({ deliveryKey, payload, rawBodyHash });
    broadcast(event);
    if (!duplicate) {
      // Do not make the webhook caller wait for the downstream service.
      void processInitialEvent(event.id, broadcast).catch((error) => console.error('Initial pipeline error:', error));
    }
    return res.status(duplicate ? 200 : 202).json({
      eventId: event.id,
      status: event.status,
      duplicate,
      message: duplicate ? 'Delivery already recorded' : 'Event accepted for processing'
    });
  } catch (error) {
    console.error('Webhook persistence error:', error);
    return jsonError(res, 500, 'Could not persist event');
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

// This private route is the default local HTTP downstream used to demonstrate the
// full pipeline without needing a third-party account. It is token-protected and
// can be replaced with DOWNSTREAM_URL in deployment.
app.post('/internal/downstream', (req, res) => {
  if (!verifyInternalToken(req.get('x-internal-token'))) return jsonError(res, 401, 'Internal route unavailable');
  const failureAttempt = Number(req.body?.simulateFailureOnAttempt);
  const shouldFail = req.body?.simulateFailure === true
    || req.body?.downstream?.fail === true
    || (Number.isInteger(failureAttempt) && failureAttempt === Number(req.get('x-event-attempt')));
  if (shouldFail) {
    return jsonError(res, 503, 'Simulated downstream failure requested by payload');
  }
  return res.status(204).send();
});

app.get('/healthz', async (_req, res) => {
  try {
    await pingDatabase();
    return res.json({ ok: true, database: 'up' });
  } catch {
    return res.status(503).json({ ok: false, database: 'down' });
  }
});

app.get('/api/auth/me', (req, res) => res.json({ authenticated: isViewer(req) }));

app.post('/api/auth/login', (req, res) => {
  if (!verifyAdminPassword(String(req.body?.password ?? ''))) {
    return jsonError(res, 401, 'Invalid password');
  }
  loginViewer(res);
  return res.json({ authenticated: true });
});

app.post('/api/auth/logout', (_req, res) => {
  logoutViewer(res);
  return res.json({ authenticated: false });
});

app.get('/api/events', async (_req, res) => {
  try {
    return res.json({ events: (await listEvents(config.maxEvents)).map(publicEvent) });
  } catch (error) {
    console.error('List events error:', error);
    return jsonError(res, 500, 'Could not load events');
  }
});

app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get('/api/events/:id', requireViewer, async (req, res) => {
  try {
    const event = await getEvent(req.params.id);
    if (!event) return jsonError(res, 404, 'Event not found');
    return res.json({ event: privateEvent(event) });
  } catch {
    return jsonError(res, 500, 'Could not load event');
  }
});

app.post('/api/events/:id/retry', requireViewer, async (req, res) => {
  try {
    const event = await getEvent(req.params.id);
    if (!event) return jsonError(res, 404, 'Event not found');
    if (event.status === 'Completed') return jsonError(res, 409, 'Completed events cannot be retried');
    if (event.processing) return jsonError(res, 409, 'Event is already being processed');
    if (event.status !== 'Failed') return jsonError(res, 409, 'Only failed events can be retried');

    // Claim synchronously so a second click receives a conflict instead of a false success.
    const claimed = await claimRetryEvent(event.id);
    if (!claimed) return jsonError(res, 409, 'Event is already being processed');
    broadcast(claimed);
    void processClaimedEvent(claimed, broadcast).catch((error) => console.error('Retry pipeline error:', error));
    return res.status(202).json({ message: 'Retry started', eventId: event.id });
  } catch (error) {
    console.error('Retry error:', error);
    return jsonError(res, 500, 'Could not start retry');
  }
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const start = async () => {
  await initializeDatabase();
  const server = app.listen(config.port, () => console.log(`EventBridge listening on port ${config.port}`));
  const shutdown = async () => {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});

export { app };

