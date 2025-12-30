// functions/api/leaderboard.js
function weekKeyUTC(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "25", 10), 100);
  const wk = weekKeyUTC(Date.now());

  // Weekly: due to unique index in score.js, this is already one row per username/week
  const weekly = await env.DB.prepare(
    `
    SELECT username, score, created_at
    FROM scores
    WHERE week_key = ?
    ORDER BY score DESC, created_at ASC
    LIMIT ?
    `
  ).bind(wk, limit).all();

  // All-time: best score per username
  const alltime = await env.DB.prepare(
    `
    WITH lb AS (
      SELECT
        username,
        MAX(score) AS score,
        MIN(created_at) AS created_at
      FROM scores
      GROUP BY username
    )
    SELECT username, score, created_at
    FROM lb
    ORDER BY score DESC, created_at ASC
    LIMIT ?
    `
  ).bind(limit).all();

  return new Response(JSON.stringify({
    ok: true,
    week_key: wk,
    weekly: weekly.results || [],
    alltime: alltime.results || []
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
