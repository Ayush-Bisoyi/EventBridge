import { config } from './config.js';

export const callDownstream = async (payload, eventId, attemptCount) => {
  const url = config.downstreamUrl ?? `http://127.0.0.1:${config.port}/internal/downstream`;
  const headers = { 'content-type': 'application/json', 'x-event-id': eventId, 'x-event-attempt': String(attemptCount) };
  if (!config.downstreamUrl) headers['x-internal-token'] = config.sessionSecret;
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Downstream returned HTTP ${response.status}`);
};

