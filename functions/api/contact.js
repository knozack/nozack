export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const name = (body?.name || '').toString().trim().slice(0, 80);
    const email = (body?.email || '').toString().trim().slice(0, 120);
    const message = (body?.message || '').toString().trim().slice(0, 2000);
    const page = (body?.page || '').toString().trim().slice(0, 500);

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: 'Missing fields.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const TO = env.CONTACT_TO || 'krista@nozack.com';
    const FROM = env.CONTACT_FROM || 'no-reply@nozack.com';

    const send = (payload) => fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const adminPayload = {
      personalizations: [{ to: [{ email: TO }] }],
      from: { email: FROM, name: 'nozack.com' },
      reply_to: { email, name },
      subject: `nozack.com contact: ${name}`,
      content: [{
        type: 'text/plain',
        value: `New message from nozack.com\n\nName: ${name}\nEmail: ${email}\nPage: ${page}\n\nMessage:\n${message}\n`
      }]
    };

    const receiptPayload = {
      personalizations: [{ to: [{ email }] }],
      from: { email: FROM, name: 'nozack.com' },
      subject: 'We received your message',
      content: [{
        type: 'text/plain',
        value: `Hi ${name},\n\nThanks for reaching out — we received your message and will get back to you shortly.\n\n— nozack.com\n`
      }]
    };

    const r1 = await send(adminPayload);
    const r2 = await send(receiptPayload);

    if (!r1.ok || !r2.ok) {
      return new Response(JSON.stringify({ error: 'Mail send failed.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
