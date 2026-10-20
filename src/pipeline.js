import { callDownstream } from './downstream.js';
import { claimInitialEvent, claimRetryEvent, markCompleted, markFailed } from './db.js';
import { validatePayload } from './validation.js';

export const processClaimedEvent = async (event, broadcast) => {
  try {
    const validation = validatePayload(event.payload);
    if (!validation.ok) throw new Error(validation.reason);
    await callDownstream(event.payload, event.id, event.attempt_count);
    broadcast(await markCompleted(event.id));
  } catch (error) {
    broadcast(await markFailed(event.id, error instanceof Error ? error.message : String(error)));
  }
};

export const processInitialEvent = async (id, broadcast) => {
  const event = await claimInitialEvent(id);
  if (!event) return false;
  broadcast(event);
  await processClaimedEvent(event, broadcast);
  return true;
};

export const processRetryEvent = async (id, broadcast) => {
  const event = await claimRetryEvent(id);
  if (!event) return false;
  broadcast(event);
  await processClaimedEvent(event, broadcast);
  return true;
};

