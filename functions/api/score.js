// functions/api/score.js
// POST /api/score
// Body: { username, score, player_id }
//
// Rules:
// - profanity blocked
// - username unique (case-insensitive): same username cannot be claimed by different player_id
// - weekly leaderboard: one row per (week_key, username), keeps BEST score
// - placement returned for weekly + all-time

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function weekKeyUTC(ms) {
  // Monday 00:00 UTC as YYYY-MM-DD
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function normalizeUsername(raw) {
  let u = String(raw ?? "").trim();
  u = u.replace(/\s+/g, " ");
  if (u.length > 24) u = u.slice(0, 24);
  return u;
}

function isUsernameValid(u) {
  // letters, numbers, space, underscore, dash, dot (2–24 chars)
  return /^[A-Za-z0-9 _.\-]{2,24}$/.test(u);
}

// Lightweight profanity filter (expand as you like)
const BANNED = [
  "fuck","fuuck","fuuuck","fuuuuck",
  "bitch","asshole","cunt","cuunt","cuuunt","cuuuunt","cuuuuunt","ccunt","cunnt","cuntt","cunttt","cuntttt",
  "pussy","slut","whore",
  "nigger","niggers","niggger","nigggers","nnigger","nniggers",
  "faggot","retard","retards",
  "porn","sex"
];

function containsProfanity(u) {
  const s = u.toLowerCase();
  return BANNED.some(w => s.includes(w));
}

async function ensureSchema(env) {
  // Make sure these exist (safe to run repeatedly)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      player_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `).run();

  // scores table should already exist, but we add helpful indexes/constraints.
  // IMPORTANT: For ON CONFLICT(username, week_key) to work, we need a UNIQUE index.
  await env.DB.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS scores_week_username
    ON scores(week_key, username COLLATE NOCASE);
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS scores_username_idx
    ON scores(username COLLATE NOCASE);
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS scores_week_idx
    ON scores(week_key);
  `).run();
}

async function claimOrCheckUsername(env, username, player_id, nowSec) {
  // Claim if free; if already claimed, verify owner matches.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (username, player_id, created_at) VALUES (?, ?, ?)`
  ).bind(username, player_id, nowSec).run();

  const row = await env.DB.prepare(
    `SELECT player_id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`
  ).bind(username).first();

  if (row?.player_id && row.player_id !== player_id) {
    return { ok: false, error: "Username not available" };
  }
  return { ok: true };
}

async function upsertWeeklyBest(env, username, player_id, score, nowSec, week_key) {
  // Requires UNIQUE index on (week_key, username COLLATE NOCASE)
  await env.DB.prepare(
    `
    INSERT INTO scores (player_id, username, score, created_at, week_key)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(week_key, username) DO UPDATE SET
      score = CASE WHEN excluded.score > scores.score THEN excluded.score ELSE scores.score END,
      created_at = CASE WHEN excluded.score > scores.score THEN excluded.created_at ELSE scores.created_at END,
      player_id = CASE WHEN excluded.score > scores.score THEN excluded.player_id ELSE scores.player_id END
    `
  ).bind(player_id, username, score, nowSec, week_key).run();
}

async function getBestAllTime(env, username) {
  const row = await env.DB.prepare(
    `
    SELECT MAX(score) AS score
    FROM scores
    WHERE username = ? COLLATE NOCASE
    `
  ).bind(username).first();
  return row?.score ?? null;
}

async function getRanks(env, username, week_key) {
  // Weekly rank over UNIQUE usernames (one row per username/week due to unique index)
  const weekly = await env.DB.prepare(
    `
    WITH lb AS (
      SELECT username, score, created_at
      FROM scores
      WHERE week_key = ?
    ),
    ranked AS (
      SELECT
        username,
        ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS rnk
      FROM lb
    )
    SELECT rnk FROM ranked WHERE username = ? COLLATE NOCASE
    `
  ).bind(week_key, username).first();

  // All-time rank using best score per username
  const alltime = await env.DB.prepare(
    `
    WITH lb AS (
      SELECT
        username,
        MAX(score) AS score,
        MIN(created_at) AS created_at
      FROM scores
      GROUP BY username
    ),
    ranked AS (
      SELECT
        username,
        ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS rnk
      FROM lb
    )
    SELECT rnk FROM ranked WHERE username = ? COLLATE NOCASE
    `
  ).bind(username).first();

  return {
    rank_weekly: weekly?.rnk ?? null,
    rank_alltime: alltime?.rnk ?? null,
  };
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const player_id = String(body.player_id ?? "").trim();
  const score = Number(body.score);
  const username = normalizeUsername(body.username);

  if (!player_id) return json({ ok: false, error: "Missing player_id" }, 400);
  if (!Number.isFinite(score) || score < 0 || score > 9999) {
    return json({ ok: false, error: "Invalid score" }, 400);
  }

  if (!username) return json({ ok: false, error: "Missing username" }, 400);
  if (!isUsernameValid(username)) {
    return json({ ok: false, error: "Username must be 2–24 chars (A–Z, 0–9, space, _ . -)" }, 400);
  }
  if (containsProfanity(username)) {
    return json({ ok: false, error: "Username not allowed" }, 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const week_key = weekKeyUTC(Date.now());

  // Ensure tables/indexes are ready
  await ensureSchema(env);

  // Unique username ownership
  const claim = await claimOrCheckUsername(env, username, player_id, nowSec);
  if (!claim.ok) return json({ ok: false, error: claim.error }, 409);

  // Store weekly best automatically
  await upsertWeeklyBest(env, username, player_id, score, nowSec, week_key);

  const best_all_time = await getBestAllTime(env, username);
  const ranks = await getRanks(env, username, week_key);

  return json({
    ok: true,
    username,
    score,
    week_key,
    best_all_time: best_all_time ?? score,
    ...ranks,
  });
}
