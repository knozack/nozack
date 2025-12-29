// functions/api/score.js
const BANNED = [
  "fuck","fuuck","fuuuck","fuuuuck","bitch","asshole","cunt","cuunt","cuuunt","cuuuunt","cuuuuunt","ccunt","cunnt","cuntt","cunttt","cuntttt","pussy","slut","whore",
  "nigger","niggers","niggger","nigggers","nnigger","nniggers","faggot","retard","retards","porn","sex"
];

function cleanUsername(raw) {
  const s = (raw ?? "").toString().trim().slice(0, 20);
  return s.replace(/[^\w.\- ]/g, ""); // allow letters/numbers/space/._-
}
function normUsername(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isProfane(name) {
  const n = normUsername(name);
  return BANNED.some(w => n.includes(w));
}

// Monday (UTC) as YYYY-MM-DD
function weekKeyUTC(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const playerId = (body?.playerId ?? "").toString().trim();
    const rawMode = (body?.nameMode ?? "default").toString();
    const nameMode = rawMode === "custom" ? "custom" : "default";

    if (!playerId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing playerId" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const score = Number(body?.score);
    if (!Number.isFinite(score) || score < 0 || score > 9999) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid score" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    let username = cleanUsername(body?.username);
    if (!username) username = "Anonymous"; // fallback only (your game will send a generated default)

    if (isProfane(username)) {
      return new Response(JSON.stringify({ ok: false, error: "Username not allowed" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    // Enforce uniqueness ONLY for custom usernames
    if (nameMode === "custom") {
      const usernameNorm = normUsername(username);
      if (!usernameNorm) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid username" }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      const existing = await env.DB
        .prepare("SELECT player_id FROM users WHERE username_norm = ? LIMIT 1")
        .bind(usernameNorm)
        .first();

      if (existing && existing.player_id !== playerId) {
        return new Response(JSON.stringify({ ok: false, error: "Username not available" }), {
          status: 409, headers: { "Content-Type": "application/json" }
        });
      }

      // claim (idempotent)
      await env.DB.prepare(
        "INSERT OR IGNORE INTO users (player_id, username, username_norm, created_at) VALUES (?, ?, ?, ?)"
      ).bind(playerId, username, usernameNorm, Date.now()).run();
    }

    const createdAt = Date.now();
    const wk = weekKeyUTC(createdAt);

    // store score
    await env.DB.prepare(
      "INSERT INTO scores (player_id, username, score, created_at, week_key) VALUES (?, ?, ?, ?, ?)"
    ).bind(playerId, username, Math.floor(score), createdAt, wk).run();

    // compute ranks (simple + fast)
    const allRankRow = await env.DB.prepare(
      "SELECT 1 + COUNT(*) AS r FROM scores WHERE score > ?"
    ).bind(Math.floor(score)).first();

    const weekRankRow = await env.DB.prepare(
      "SELECT 1 + COUNT(*) AS r FROM scores WHERE week_key = ? AND score > ?"
    ).bind(wk, Math.floor(score)).first();

    return new Response(JSON.stringify({
      ok: true,
      username,
      week_key: wk,
      rank_alltime: allRankRow?.r ?? null,
      rank_weekly: weekRankRow?.r ?? null
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Server error" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
