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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }
  return {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/distribution') {
      return handleDistribution(url, env, corsHeaders, ctx);
    }

    if (request.method === 'POST' && url.pathname === '/events') {
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

const BASE_SYNTHETIC = [0, 0, 0, 2, 5, 9, 14, 18, 20, 20, 18, 14, 9, 5, 0, 0];
const BLEND_THRESHOLD = 30;
const BIN_COUNT = 16;
const BIN_WIDTH = 250;

function hashDate(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h) + dateStr.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function getSyntheticDistribution(date) {
  const seed = hashDate(date);
  const rng = seededRandom(seed);

  const shiftAmount = rng() * 4 - 2;
  const noised = new Array(BIN_COUNT);
  for (let i = 0; i < BIN_COUNT; i++) {
    const srcIdx = i - shiftAmount;
    const lo = Math.floor(srcIdx);
    const hi = lo + 1;
    const frac = srcIdx - lo;
    const loVal = (lo >= 0 && lo < BIN_COUNT) ? BASE_SYNTHETIC[lo] : 0;
    const hiVal = (hi >= 0 && hi < BIN_COUNT) ? BASE_SYNTHETIC[hi] : 0;
    const base = loVal * (1 - frac) + hiVal * frac;
    const noise = (rng() - 0.5) * 4;
    noised[i] = Math.max(0, Math.round(base + noise));
  }
  return noised;
}

async function handleDistribution(url, env, corsHeaders, ctx) {
  const date = url.searchParams.get('date');
  if (!date || !DATE_RE.test(date)) {
    return jsonResponse({ error: 'Invalid or missing date parameter' }, 400, corsHeaders);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date > today) {
    return jsonResponse({ error: 'Cannot query future dates' }, 400, corsHeaders);
  }

  const cacheKey = new Request(`https://cache-internal/distribution/${date}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const result = await env.DB.prepare(`
    SELECT
      CAST(total_score / ? AS INTEGER) AS bin,
      COUNT(DISTINCT user_id) AS count
    FROM events
    WHERE event_type = 'game_complete'
      AND round_date = ?
    GROUP BY bin
    ORDER BY bin
  `).bind(BIN_WIDTH, date).all();

  const realBins = new Array(BIN_COUNT).fill(0);
  let totalPlayers = 0;
  for (const row of result.results) {
    const idx = Math.min(row.bin, BIN_COUNT - 1);
    realBins[idx] = row.count;
    totalPlayers += row.count;
  }

  const synth = getSyntheticDistribution(date);
  const realWeight = Math.min(1, totalPlayers / BLEND_THRESHOLD);
  const synthWeight = 1 - realWeight;
  const synthSum = synth.reduce((a, b) => a + b, 0) || 1;

  const bins = new Array(BIN_COUNT);
  for (let i = 0; i < BIN_COUNT; i++) {
    bins[i] = Math.round(
      realBins[i] * realWeight +
      synth[i] * synthWeight * (BLEND_THRESHOLD / synthSum)
    );
  }

  const responseData = {
    date,
    bins,
    bin_width: BIN_WIDTH,
    total_players: totalPlayers,
  };

  const responseBody = JSON.stringify(responseData);
  const response = new Response(responseBody, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60', ...corsHeaders },
  });

  ctx.waitUntil(cache.put(cacheKey, new Response(responseBody, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' },
  })));

  return response;
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
