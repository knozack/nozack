// functions/api/leaderboard.js
// GET /api/leaderboard?limit=25
// Returns: { ok, week_key, weekly: [...], alltime: [...] }

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
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day); // Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.DB) {
      return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "25", 10), 100);
    const wk = weekKeyUTC(Date.now());

    // Weekly leaderboard: best score per (case-insensitive) username
    const weekly = await env.DB.prepare(
      `
      SELECT
        MIN(username) AS username,
        MAX(score)    AS score,
        MIN(created_at) AS created_at
      FROM scores
      WHERE week_key = ?
      GROUP BY lower(username)
      ORDER BY score DESC, created_at ASC
      LIMIT ?
      `
    ).bind(wk, limit).all();

    // All-time leaderboard: best score per (case-insensitive) username
    const alltime = await env.DB.prepare(
      `
      SELECT
        MIN(username) AS username,
        MAX(score)    AS score,
        MIN(created_at) AS created_at
      FROM scores
      GROUP BY lower(username)
      ORDER BY score DESC, created_at ASC
      LIMIT ?
      `
    ).bind(limit).all();

    return json({
      ok: true,
      week_key: wk,
      weekly: weekly.results || [],
      alltime: alltime.results || [],
    });
  } catch (err) {
    return json(
      { ok: false, error: "Leaderboard failed", detail: String(err?.message || err) },
      500
    );
  }
}
