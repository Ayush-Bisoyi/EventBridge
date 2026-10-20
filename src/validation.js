export const validatePayload = (payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'Payload must be a JSON object' };
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, reason: 'Payload must contain at least one field' };
  }

  return { ok: true };
};

