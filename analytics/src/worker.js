const ALLOWED_ORIGINS = [
  'https://guesstimate.offclock.dev',
  'http://localhost:8000',
  'http://localhost:3000',
  'http://127.0.0.1:8000',
];

const VALID_EVENT_TYPES = ['game_start', 'guess_submit', 'game_complete', 'progress_reset'];
const VALID_CATEGORIES = ['how_many', 'how_tall', 'how_old'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }
  return {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const url = new URL(request.url);

    if (url.pathname === '/events') {
      return handleEvents(request, env, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  }
};

function validateEvent(e) {
  if (!e || typeof e !== 'object') return 'Event must be an object';

  if (!e.user_id || !UUID_RE.test(e.user_id)) return 'Invalid user_id';

  if (!VALID_EVENT_TYPES.includes(e.event_type)) return 'Invalid event_type';

  if (e.event_type === 'progress_reset') {
    if (e.reset_count != null && (!Number.isInteger(e.reset_count) || e.reset_count < 1 || e.reset_count > 10000)) {
      return 'Invalid reset_count';
    }
    return null;
  }

  if (e.round_date && !DATE_RE.test(e.round_date)) return 'Invalid round_date format';

  if (e.category && !VALID_CATEGORIES.includes(e.category)) return 'Invalid category';

  if (e.photo_index != null && (!Number.isInteger(e.photo_index) || e.photo_index < 0 || e.photo_index > 3)) {
    return 'Invalid photo_index';
  }

  if (e.score != null && (!Number.isInteger(e.score) || e.score < 0 || e.score > 1000)) {
    return 'Invalid score';
  }

  if (e.total_score != null && (!Number.isInteger(e.total_score) || e.total_score < 0 || e.total_score > 4000)) {
    return 'Invalid total_score';
  }

  if (e.guess != null && (!Number.isInteger(e.guess) || e.guess < 0 || e.guess > 200000)) {
    return 'Invalid guess';
  }

  if (e.answer != null && (!Number.isInteger(e.answer) || e.answer < 0 || e.answer > 200000)) {
    return 'Invalid answer';
  }

  if (e.time_to_guess_ms != null && (!Number.isInteger(e.time_to_guess_ms) || e.time_to_guess_ms < 100 || e.time_to_guess_ms > 600000)) {
    return 'Invalid time_to_guess_ms';
  }

  if (e.round_hash != null && (typeof e.round_hash !== 'string' || e.round_hash.length > 20)) {
    return 'Invalid round_hash';
  }

  if (e.event_type === 'guess_submit') {
    if (e.photo_index == null || e.score == null || e.guess == null || e.answer == null) {
      return 'guess_submit requires photo_index, score, guess, answer';
    }
  }

  if (e.event_type === 'game_complete') {
    if (e.total_score == null) return 'game_complete requires total_score';
  }

  return null;
}

async function handleEvents(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const events = Array.isArray(body) ? body : [body];

  if (events.length === 0 || events.length > 50) {
    return jsonResponse({ error: 'Send 1-50 events per request' }, 400, corsHeaders);
  }

  const validEvents = [];
  for (const e of events) {
    const err = validateEvent(e);
    if (err) {
      return jsonResponse({ error: err }, 422, corsHeaders);
    }
    validEvents.push(e);
  }

  const stmt = env.DB.prepare(`
    INSERT INTO events (user_id, event_type, round_date, photo_index, category, score, guess, answer, time_to_guess_ms, round_hash, total_score, reset_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = validEvents.map(e => stmt.bind(
    e.user_id,
    e.event_type,
    e.round_date || null,
    e.photo_index ?? null,
    e.category || null,
    e.score ?? null,
    e.guess ?? null,
    e.answer ?? null,
    e.time_to_guess_ms ?? null,
    e.round_hash || null,
    e.total_score ?? null,
    e.reset_count ?? null
  ));

  try {
    await env.DB.batch(batch);
  } catch (err) {
    return jsonResponse({ error: 'Database error' }, 500, corsHeaders);
  }

  return jsonResponse({ ok: true, inserted: validEvents.length }, 200, corsHeaders);
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
