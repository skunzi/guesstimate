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
const INVITE_CODE_RE = /^[a-z0-9]{8}$/;
const DISPLAY_NAME_RE = /^[\p{L}\p{N}\p{Emoji}_\- ]{1,20}$/u;
const LEADERBOARD_NAME_RE = /^.{1,30}$/;

const MAX_LEADERBOARDS_PER_USER = 20;
const MAX_MEMBERS_PER_LEADERBOARD = 50;

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  }
  return {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function generateInviteCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
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
    const path = url.pathname;

    // Existing endpoints
    if (request.method === 'GET' && path === '/distribution') {
      return handleDistribution(url, env, corsHeaders, ctx);
    }

    if (request.method === 'POST' && path === '/events') {
      return handleEvents(request, env, corsHeaders);
    }

    // Leaderboard endpoints
    if (request.method === 'PUT' && path === '/users') {
      return handleSetUser(request, env, corsHeaders);
    }

    if (request.method === 'POST' && path === '/scores') {
      return handleSubmitScore(request, env, corsHeaders);
    }

    if (request.method === 'POST' && path === '/leaderboards') {
      return handleCreateLeaderboard(request, env, corsHeaders);
    }

    if (request.method === 'GET' && path === '/leaderboards') {
      return handleListLeaderboards(url, env, corsHeaders);
    }

    const joinMatch = path.match(/^\/leaderboards\/([a-z0-9]{8})\/join$/);
    if (request.method === 'POST' && joinMatch) {
      return handleJoinLeaderboard(request, env, corsHeaders, joinMatch[1]);
    }

    const inviteMatch = path.match(/^\/leaderboards\/([a-z0-9]{8})$/);
    if (request.method === 'GET' && inviteMatch) {
      return handleGetLeaderboardByCode(env, corsHeaders, inviteMatch[1]);
    }

    const standingsMatch = path.match(/^\/leaderboards\/(\d+)\/standings$/);
    if (request.method === 'GET' && standingsMatch) {
      return handleGetStandings(url, env, corsHeaders, parseInt(standingsMatch[1]));
    }

    const leaveMatch = path.match(/^\/leaderboards\/(\d+)\/leave$/);
    if (request.method === 'DELETE' && leaveMatch) {
      return handleLeaveLeaderboard(request, env, corsHeaders, parseInt(leaveMatch[1]));
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  }
};

// --- User management ---

async function handleSetUser(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const { user_id, display_name } = body;
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }
  if (!display_name || !DISPLAY_NAME_RE.test(display_name.trim())) {
    return jsonResponse({ error: 'Invalid display_name (1-20 characters)' }, 422, corsHeaders);
  }

  const name = display_name.trim();
  await env.DB.prepare(`
    INSERT INTO users (user_id, display_name) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name = ?, updated_at = datetime('now')
  `).bind(user_id, name, name).run();

  return jsonResponse({ ok: true, display_name: name }, 200, corsHeaders);
}

// --- Score submission ---

async function handleSubmitScore(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 100) {
      return jsonResponse({ error: 'Send 1-100 scores per request' }, 400, corsHeaders);
    }
    for (const s of body) {
      const err = validateScore(s);
      if (err) return jsonResponse({ error: err }, 422, corsHeaders);
    }
    const stmt = env.DB.prepare(`
      INSERT INTO scores (user_id, round_date, total_score) VALUES (?, ?, ?)
      ON CONFLICT(user_id, round_date) DO UPDATE SET total_score = ?, submitted_at = datetime('now')
    `);
    const batch = body.map(s => stmt.bind(s.user_id, s.round_date, s.total_score, s.total_score));
    await env.DB.batch(batch);
    return jsonResponse({ ok: true, inserted: body.length }, 200, corsHeaders);
  }

  const err = validateScore(body);
  if (err) return jsonResponse({ error: err }, 422, corsHeaders);

  await env.DB.prepare(`
    INSERT INTO scores (user_id, round_date, total_score) VALUES (?, ?, ?)
    ON CONFLICT(user_id, round_date) DO UPDATE SET total_score = ?, submitted_at = datetime('now')
  `).bind(body.user_id, body.round_date, body.total_score, body.total_score).run();

  return jsonResponse({ ok: true }, 200, corsHeaders);
}

function validateScore(s) {
  if (!s || typeof s !== 'object') return 'Score must be an object';
  if (!s.user_id || !UUID_RE.test(s.user_id)) return 'Invalid user_id';
  if (!s.round_date || !DATE_RE.test(s.round_date)) return 'Invalid round_date';
  if (!Number.isInteger(s.total_score) || s.total_score < 0 || s.total_score > 4000) return 'Invalid total_score';
  return null;
}

// --- Leaderboard CRUD ---

async function handleCreateLeaderboard(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const { user_id, name } = body;
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }
  if (!name || !LEADERBOARD_NAME_RE.test(name.trim())) {
    return jsonResponse({ error: 'Invalid name (1-30 characters)' }, 422, corsHeaders);
  }

  const user = await env.DB.prepare('SELECT user_id FROM users WHERE user_id = ?').bind(user_id).first();
  if (!user) {
    return jsonResponse({ error: 'User must set a display name first' }, 403, corsHeaders);
  }

  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM leaderboard_members WHERE user_id = ?'
  ).bind(user_id).first();
  if (countResult.cnt >= MAX_LEADERBOARDS_PER_USER) {
    return jsonResponse({ error: `Maximum ${MAX_LEADERBOARDS_PER_USER} leaderboards per user` }, 429, corsHeaders);
  }

  const invite_code = generateInviteCode();
  const lbName = name.trim();

  const result = await env.DB.prepare(`
    INSERT INTO leaderboards (name, invite_code, created_by) VALUES (?, ?, ?)
  `).bind(lbName, invite_code, user_id).run();

  const leaderboard_id = result.meta.last_row_id;

  await env.DB.prepare(`
    INSERT INTO leaderboard_members (leaderboard_id, user_id) VALUES (?, ?)
  `).bind(leaderboard_id, user_id).run();

  return jsonResponse({ id: leaderboard_id, name: lbName, invite_code }, 201, corsHeaders);
}

async function handleListLeaderboards(url, env, corsHeaders) {
  const user_id = url.searchParams.get('user_id');
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }

  const results = await env.DB.prepare(`
    SELECT l.id, l.name, l.invite_code,
      (SELECT COUNT(*) FROM leaderboard_members WHERE leaderboard_id = l.id) as member_count
    FROM leaderboards l
    JOIN leaderboard_members m ON m.leaderboard_id = l.id
    WHERE m.user_id = ?
    ORDER BY l.created_at DESC
  `).bind(user_id).all();

  return jsonResponse({ leaderboards: results.results }, 200, corsHeaders);
}

async function handleGetLeaderboardByCode(env, corsHeaders, invite_code) {
  const lb = await env.DB.prepare(`
    SELECT l.id, l.name, l.created_by, u.display_name as created_by_name,
      (SELECT COUNT(*) FROM leaderboard_members WHERE leaderboard_id = l.id) as member_count
    FROM leaderboards l
    LEFT JOIN users u ON u.user_id = l.created_by
    WHERE l.invite_code = ?
  `).bind(invite_code).first();

  if (!lb) {
    return jsonResponse({ error: 'Leaderboard not found' }, 404, corsHeaders);
  }

  return jsonResponse({
    id: lb.id,
    name: lb.name,
    member_count: lb.member_count,
    created_by_name: lb.created_by_name,
  }, 200, corsHeaders);
}

async function handleJoinLeaderboard(request, env, corsHeaders, invite_code) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const { user_id } = body;
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }

  const user = await env.DB.prepare('SELECT user_id FROM users WHERE user_id = ?').bind(user_id).first();
  if (!user) {
    return jsonResponse({ error: 'User must set a display name first' }, 403, corsHeaders);
  }

  const lb = await env.DB.prepare('SELECT id, name FROM leaderboards WHERE invite_code = ?').bind(invite_code).first();
  if (!lb) {
    return jsonResponse({ error: 'Leaderboard not found' }, 404, corsHeaders);
  }

  const memberCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM leaderboard_members WHERE leaderboard_id = ?'
  ).bind(lb.id).first();
  if (memberCount.cnt >= MAX_MEMBERS_PER_LEADERBOARD) {
    return jsonResponse({ error: `Leaderboard is full (max ${MAX_MEMBERS_PER_LEADERBOARD} members)` }, 429, corsHeaders);
  }

  const userLbCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM leaderboard_members WHERE user_id = ?'
  ).bind(user_id).first();
  if (userLbCount.cnt >= MAX_LEADERBOARDS_PER_USER) {
    return jsonResponse({ error: `You are in too many leaderboards (max ${MAX_LEADERBOARDS_PER_USER})` }, 429, corsHeaders);
  }

  const existing = await env.DB.prepare(
    'SELECT 1 FROM leaderboard_members WHERE leaderboard_id = ? AND user_id = ?'
  ).bind(lb.id, user_id).first();
  if (existing) {
    return jsonResponse({ ok: true, leaderboard: { id: lb.id, name: lb.name }, already_member: true }, 200, corsHeaders);
  }

  await env.DB.prepare(
    'INSERT INTO leaderboard_members (leaderboard_id, user_id) VALUES (?, ?)'
  ).bind(lb.id, user_id).run();

  return jsonResponse({ ok: true, leaderboard: { id: lb.id, name: lb.name } }, 200, corsHeaders);
}

async function handleGetStandings(url, env, corsHeaders, leaderboard_id) {
  const user_id = url.searchParams.get('user_id');
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }

  const membership = await env.DB.prepare(
    'SELECT 1 FROM leaderboard_members WHERE leaderboard_id = ? AND user_id = ?'
  ).bind(leaderboard_id, user_id).first();
  if (!membership) {
    return jsonResponse({ error: 'Not a member of this leaderboard' }, 403, corsHeaders);
  }

  const lb = await env.DB.prepare('SELECT id, name FROM leaderboards WHERE id = ?').bind(leaderboard_id).first();
  if (!lb) {
    return jsonResponse({ error: 'Leaderboard not found' }, 404, corsHeaders);
  }

  const date = url.searchParams.get('date');
  let standings;

  if (date && DATE_RE.test(date)) {
    standings = await env.DB.prepare(`
      SELECT m.user_id, u.display_name, s.total_score as score
      FROM leaderboard_members m
      JOIN users u ON u.user_id = m.user_id
      LEFT JOIN scores s ON s.user_id = m.user_id AND s.round_date = ?
      WHERE m.leaderboard_id = ?
      ORDER BY s.total_score DESC NULLS LAST
    `).bind(date, leaderboard_id).all();
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    standings = await env.DB.prepare(`
      SELECT m.user_id, u.display_name, COALESCE(SUM(s.total_score), 0) as score,
        COUNT(s.total_score) as days_played
      FROM leaderboard_members m
      JOIN users u ON u.user_id = m.user_id
      LEFT JOIN scores s ON s.user_id = m.user_id AND s.round_date >= ? AND s.round_date <= ?
      WHERE m.leaderboard_id = ?
      GROUP BY m.user_id
      ORDER BY score DESC
    `).bind(weekAgo, today, leaderboard_id).all();
  }

  const ranked = standings.results.map((row, i) => ({
    ...row,
    rank: i + 1,
  }));

  return jsonResponse({
    leaderboard: { id: lb.id, name: lb.name },
    standings: ranked,
    period: date || 'week',
  }, 200, corsHeaders);
}

async function handleLeaveLeaderboard(request, env, corsHeaders, leaderboard_id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const { user_id } = body;
  if (!user_id || !UUID_RE.test(user_id)) {
    return jsonResponse({ error: 'Invalid user_id' }, 422, corsHeaders);
  }

  const membership = await env.DB.prepare(
    'SELECT 1 FROM leaderboard_members WHERE leaderboard_id = ? AND user_id = ?'
  ).bind(leaderboard_id, user_id).first();
  if (!membership) {
    return jsonResponse({ error: 'Not a member of this leaderboard' }, 404, corsHeaders);
  }

  await env.DB.prepare(
    'DELETE FROM leaderboard_members WHERE leaderboard_id = ? AND user_id = ?'
  ).bind(leaderboard_id, user_id).run();

  const remaining = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM leaderboard_members WHERE leaderboard_id = ?'
  ).bind(leaderboard_id).first();

  if (remaining.cnt === 0) {
    await env.DB.prepare('DELETE FROM leaderboards WHERE id = ?').bind(leaderboard_id).run();
  }

  return jsonResponse({ ok: true, deleted_leaderboard: remaining.cnt === 0 }, 200, corsHeaders);
}

// --- Existing: Analytics events ---

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

// --- Existing: Distribution ---

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
