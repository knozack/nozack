export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const name = (body?.name || "").toString().trim().slice(0, 80);
    const email = (body?.email || "").toString().trim().slice(0, 120);
    const message = (body?.message || "").toString().trim().slice(0, 2000);
    const page = (body?.page || "").toString().trim().slice(0, 500);

    if (!name || !email || !message) {
      return json({ error: "Missing fields." }, 400);
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Invalid email." }, 400);
    }

    // REQUIRE env vars (no silent fallback to no-reply)
    const TO = env.CONTACT_TO;
    const FROM = env.CONTACT_FROM;

    if (!TO || !FROM) {
      console.log("Missing env vars", { hasTO: !!TO, hasFROM: !!FROM });
      return json({ error: "Server not configured (missing email env vars)." }, 500);
    }

    const send = async (payload) => {
      const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text(); // capture error details
      return { ok: res.ok, status: res.status, text };
    };

    const adminPayload = {
      personalizations: [{ to: [{ email: TO }] }],
      from: { email: 'no-reply@nozack.pages.dev', name: 'nozack.com' },
      reply_to: { email, name },
      subject: `nozack.com contact: ${name}`,
      content: [
        {
          type: "text/plain",
          value:
            `New message from nozack.com\n\n` +
            `Name: ${name}\nEmail: ${email}\nPage: ${page}\n\n` +
            `Message:\n${message}\n`,
        },
      ],
    };

    const receiptPayload = {
      personalizations: [{ to: [{ email }] }],
      from: { email: 'no-reply@nozack.pages.dev', name: 'nozack.com' },
      subject: "We received your message",
      content: [
        {
          type: "text/plain",
          value:
            `Hi ${name},\n\n` +
            `Thanks for reaching out — we received your message and will get back to you shortly.\n\n` +
            `— nozack.com\n`,
        },
      ],
    };

    const r1 = await send(adminPayload);
    const r2 = await send(receiptPayload);

    if (!r1.ok || !r2.ok) {
      console.log("MailChannels failed", { r1, r2 });
      return json(
        { error: "Mail send failed.", details: { r1: pick(r1), r2: pick(r2) } },
        502
      );
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.log("Server error", String(e?.stack || e));
    return json({ error: "Server error." }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pick(r) {
  return { status: r.status, text: (r.text || "").slice(0, 500) };
}
