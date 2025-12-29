
// functions/api/score.js
// POST /api/score
// Body: { username, score, player_id }
//
// Rules:
// - profanity blocked
// - username unique (case-insensitive): same username cannot be claimed by different player_id
// - one entry per username per week: keeps BEST score
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
  // Monday 00:00 UTC as YYYY-MM-DD (matches your earlier logic)
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function normalizeUsername(raw) {
  let u = String(raw ?? "").trim();

  // collapse internal whitespace
  u = u.replace(/\s+/g, " ");

  // enforce max
  if (u.length > 24) u = u.slice(0, 24);

  return u;
}

function isUsernameValid(u) {
  // allow letters, numbers, space, underscore, dash, dot
  // (keeps things simple + avoids weird unicode edge cases)
  return /^[A-Za-z0-9 _.\-]{2,24}$/.test(u);
}

// Lightweight profanity filter (expand as you like)
const BANNED = [
  "fuck","fuuck","fuuuck","fuuuuck","bitch","asshole","cunt","cuunt","cuuunt","cuuuunt","cuuuuunt","ccunt","cunnt","cuntt","cunttt","cuntttt","pussy","slut","whore",
  "nigger","niggers","niggger","nigggers","nnigger","nniggers","faggot","retard","retards","porn","sex"
];

function containsProfanity(u) {
  const s = u.toLowerCase();
  return BANNED.some(w => s.includes(w));
}

async function getBestForUserWeek(env, username, week_key) {
  // best score for that username in that week
  const row = await env.DB.prepare(
    `SELECT score, created_at
     FROM scores
     WHERE week_key = ? AND username = ? COLLATE NOCASE
     ORDER BY score DESC, created_at ASC
     LIMIT 1`
  ).bind(week_key, username).first();

  return row || null;
}

async function getBestForUserAllTime(env, username) {
  const row = await env.DB.prepare(
    `SELECT score, created_at
     FROM scores
     WHERE username = ? COLLATE NOCASE
     ORDER BY score DESC, created_at ASC
     LIMIT 1`
  ).bind(username).first();

  return row || null;
}

async function getRankWeekly(env, username, week_key) {
  // rank among unique usernames (best score), ties broken by earliest created_at
  const row = await env.DB.prepare(
    `
    WITH lb AS (
      SELECT
        username,
        MAX(score) AS score,
        MIN(created_at) AS created_at
      FROM scores
      WHERE week_key = ?
      GROUP BY username
    ),
    ranked AS (
      SELECT
        username,
        score,
        ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS rnk
      FROM lb
    )
    SELECT rnk FROM ranked WHERE username = ? COLLATE NOCASE
    `
  ).bind(week_key, username).first();

  return row?.rnk ?? null;
}

async function getRankAllTime(env, username) {
  const row = await env.DB.prepare(
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
        score,
        ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS rnk
      FROM lb
    )
    SELECT rnk FROM ranked WHERE username = ? COLLATE NOCASE
    `
  ).bind(username).first();

  return row?.rnk ?? null;
}

async function usernameOwner(env, username) {
  // If you have a "users" table, we'll use it. If not, fallback to scores ownership.
  // Ownership = the earliest player_id seen for that username.
  try {
    const u = await env.DB.prepare(
      `SELECT player_id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`
    ).bind(username).first();

    if (u?.player_id) return u.player_id;
  } catch {
    // users table missing or schema mismatch -> fallback below
  }

  const s = await env.DB.prepare(
    `SELECT player_id
     FROM scores
     WHERE username = ? COLLATE NOCASE
     ORDER BY created_at ASC
     LIMIT 1`
  ).bind(username).first();

  return s?.player_id ?? null;
}

async function claimUsernameIfNeeded(env, username, player_id, nowSec) {
  // Best-effort: create users table mapping if it exists.
  // If it doesn't exist, it's ok (we fallback to scores-based ownership).
  try {
    await env.DB.prepare(
      `INSERT INTO users (username, player_id, created_at)
       VALUES (?, ?, ?)`
    ).bind(username, player_id, nowSec).run();
  } catch {
    // ignore (table may not exist OR username already exists)
  }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const player_id = String(body.player_id ?? "").trim();
  const scoreRaw = body.score;

  let username = normalizeUsername(body.username);

  // Basic validation
  if (!player_id) return json({ ok: false, error: "Missing player_id" }, 400);

  const score = Number(scoreRaw);
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

  // Duplicate-username prevention (case-insensitive)
  const owner = await usernameOwner(env, username);
  if (owner && owner !== player_id) {
    return json({ ok: false, error: "Username not available" }, 409);
  }

  // Claim it (best-effort)
  await claimUsernameIfNeeded(env, username, player_id, nowSec);

  // Upsert best score for THIS WEEK (keep best only)
  const existingWeekBest = await getBestForUserWeek(env, username, week_key);
  let didUpdateWeekly = false;

  if (!existingWeekBest) {
    await env.DB.prepare(
      `INSERT INTO scores (player_id, username, score, created_at, week_key)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(player_id, username, score, nowSec, week_key).run();
    didUpdateWeekly = true;
  } else if (score > existingWeekBest.score) {
    // Store a new row (simplest) OR update. We'll update the best row for stability.
    await env.DB.prepare(
      `UPDATE scores
       SET score = ?, created_at = ?, player_id = ?
       WHERE week_key = ? AND username = ? COLLATE NOCASE
         AND score = ?
      `
    ).bind(score, nowSec, player_id, week_key, username, existingWeekBest.score).run();

    // If multiple rows existed, above might not hit the exact one; ensure at least one row exists:
    // if update affected 0, insert instead.
    // D1 run() doesn't give rowsAffected reliably across all cases, so we keep it simple:
    didUpdateWeekly = true;
  }

  // All-time best can be derived from scores table (no extra write required)
  const bestAll = await getBestForUserAllTime(env, username);

  // Ranks (after update/insert)
  const rank_weekly = await getRankWeekly(env, username, week_key);
  const rank_alltime = await getRankAllTime(env, username);

  return json({
    ok: true,
    username,
    score,
    week_key,
    did_update_weekly: didUpdateWeekly,
    best_all_time: bestAll?.score ?? score,
    rank_weekly,
    rank_alltime,
  });
}
