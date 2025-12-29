export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const name = (body?.name || "").trim();
    const email = (body?.email || "").trim();
    const message = (body?.message || "").trim();
    const page = (body?.page || "").trim();

    if (!name || !email || !message) {
      return json({ error: "Missing fields." }, 400);
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Invalid email." }, 400);
    }

    const TO = env.CONTACT_TO;
    if (!TO) {
      console.log("Missing CONTACT_TO");
      return json({ error: "Server misconfigured." }, 500);
    }

    // IMPORTANT: hard-coded sender
    const FROM = "no-reply@nozack.pages.dev";

    const send = async (payload) => {
      const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    };

    const adminPayload = {
      personalizations: [{ to: [{ email: TO }] }],
      from: { email: FROM, name: "nozack.com" },
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
      from: { email: FROM, name: "nozack.com" },
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
      return json({ error: "Mail send failed." }, 502);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.log("Server error", e);
    return json({ error: "Server error." }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
