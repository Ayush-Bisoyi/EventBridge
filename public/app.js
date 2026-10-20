const state = { events: new Map(), authenticated: false, selectedId: null };
const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[character]));

const formatDate = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value));

const statusClass = (status) => status.toLowerCase();

const renderEvents = () => {
  const events = [...state.events.values()].sort((a, b) => {
    const timeDifference = new Date(b.createdAt) - new Date(a.createdAt);
    return timeDifference || b.id.localeCompare(a.id);
  });
  $('#event-count').textContent = events.length;
  if (events.length === 0) {
    $('#events').innerHTML = '<div class="empty">Waiting for the first webhook…</div>';
    return;
  }
  $('#events').innerHTML = events.map((event) => `
    <button class="event-row ${state.selectedId === event.id ? 'selected' : ''}" data-event-id="${event.id}">
      <span class="event-main"><strong>${escapeHtml(event.id.slice(0, 8))}…</strong><small>${formatDate(event.createdAt)}</small></span>
      <span class="event-meta"><span class="status ${statusClass(event.status)}">${escapeHtml(event.status)}</span><small>${event.attemptCount} attempt${event.attemptCount === 1 ? '' : 's'}</small></span>
    </button>`).join('');
  document.querySelectorAll('[data-event-id]').forEach((row) => row.addEventListener('click', () => selectEvent(row.dataset.eventId)));
};

const renderDetail = (event) => {
  $('#detail-title').textContent = event ? event.id.slice(0, 8) : 'Select an event';
  if (!event) {
    $('#detail').innerHTML = '<div class="detail-empty">Sign in, then select an event to view its stored payload and failure reason.</div>';
    return;
  }
  if (!state.authenticated) {
    $('#detail').innerHTML = '<div class="detail-empty">Sign in to unlock the stored payload and retry controls.</div>';
    return;
  }
  const retry = event.status === 'Failed' && !event.processing
    ? `<button id="retry" type="button">Retry failed event</button>` : '';
  $('#detail').innerHTML = `
    <dl class="facts"><div><dt>Status</dt><dd><span class="status ${statusClass(event.status)}">${escapeHtml(event.status)}</span></dd></div>
    <div><dt>Attempts</dt><dd>${event.attemptCount}</dd></div><div><dt>Created</dt><dd>${formatDate(event.createdAt)}</dd></div></dl>
    ${event.failureReason ? `<div class="failure"><strong>Failure reason</strong><p>${escapeHtml(event.failureReason)}</p></div>` : ''}
    <h3>Stored payload</h3><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>${retry}`;
  $('#retry')?.addEventListener('click', retrySelected);
};

const selectEvent = async (id) => {
  state.selectedId = id;
  renderEvents();
  if (!state.authenticated) return renderDetail(state.events.get(id));
  const response = await fetch(`/api/events/${encodeURIComponent(id)}`);
  if (!response.ok) return renderDetail(state.events.get(id));
  const { event } = await response.json();
  state.events.set(id, event);
  renderDetail(event);
};

const updateAuthUi = () => {
  $('#auth-state').textContent = state.authenticated
    ? 'Signed in. Payloads and retry controls are available.'
    : 'Not signed in. Payloads and retry controls are hidden.';
  $('#login-form').classList.toggle('hidden', state.authenticated);
  $('#logout').classList.toggle('hidden', !state.authenticated);
  renderDetail(state.selectedId ? state.events.get(state.selectedId) : null);
};

const checkAuth = async () => {
  const response = await fetch('/api/auth/me');
  state.authenticated = (await response.json()).authenticated;
  updateAuthUi();
};

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: $('#password').value })
  });
  $('#password').value = '';
  if (!response.ok) return alert('Invalid password');
  state.authenticated = true;
  updateAuthUi();
  if (state.selectedId) selectEvent(state.selectedId);
});

$('#logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.authenticated = false;
  updateAuthUi();
});

const retrySelected = async () => {
  if (!state.selectedId) return;
  const response = await fetch(`/api/events/${encodeURIComponent(state.selectedId)}/retry`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return alert(body.error ?? 'Could not start retry');
  }
  alert('Retry started. The status will update live.');
};

const loadEvents = async () => {
  const response = await fetch('/api/events');
  const { events } = await response.json();
  events.forEach((event) => state.events.set(event.id, event));
  renderEvents();
};

const connectStream = () => {
  const stream = new EventSource('/api/events/stream');
  stream.onopen = () => { $('#connection-dot').className = 'dot online'; $('#connection-label').textContent = 'Live updates on'; };
  stream.onerror = () => { $('#connection-dot').className = 'dot offline'; $('#connection-label').textContent = 'Reconnecting…'; };
  stream.addEventListener('event', async (message) => {
    const event = JSON.parse(message.data);
    state.events.set(event.id, { ...(state.events.get(event.id) ?? {}), ...event });
    renderEvents();
    if (state.selectedId === event.id && state.authenticated) await selectEvent(event.id);
  });
};

const init = async () => {
  await Promise.all([loadEvents(), checkAuth()]);
  connectStream();
};

init();

