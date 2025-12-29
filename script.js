// NOZACK — fit-to-width hero (inside margins) + aggressive scroll breakup + contact form submit (Formspree)
(() => {
  // Fit NOZACK to full width INSIDE margins
  const word = document.getElementById('titleWord');

  function fitHero() {
    if (!word) return;
    const stage = word.closest('.titleStage');
    const stageW = (stage?.clientWidth || window.innerWidth);

    const cs = stage ? getComputedStyle(stage) : null;
    const padL = cs ? parseFloat(cs.paddingLeft || '0') : 0;
    const padR = cs ? parseFloat(cs.paddingRight || '0') : 0;

    const maxW = Math.max(0, stageW - padL - padR - 4);

    let lo = 24, hi = 900;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      document.documentElement.style.setProperty('--heroSize', mid + 'px');
      const w = word.scrollWidth;
      if (w > maxW) hi = mid; else lo = mid;
    }

    let size = lo * 0.955;
    document.documentElement.style.setProperty('--heroSize', size + 'px');

    for (let i = 0; i < 10; i++) {
      if (word.scrollWidth <= maxW) break;
      size *= 0.98;
      document.documentElement.style.setProperty('--heroSize', size + 'px');
    }
  }

  window.addEventListener('resize', fitHero, { passive: true });
  fitHero();

  // Scroll breakup (iOS-friendly)
const letters = Array.from(document.querySelectorAll('.letter'));
if (letters.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.registerPlugin(ScrollTrigger);

  // Helps iOS Safari behave more consistently with scroll + viewport changes
  ScrollTrigger.config({ ignoreMobileResize: true });
  try { ScrollTrigger.normalizeScroll(true); } catch(e) {}

  gsap.set(letters, { x: 0, y: 0, rotation: 0, opacity: 1, transformOrigin: '50% 50%' });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      end: '+=260',     // slightly longer than before
      scrub: true
    }
  });

  tl.to(letters, { scaleX: 0.965, scaleY: 1.04, stagger: 0.01, ease: 'none' }, 0)
    .to(letters, {
      y: (i) => 560 + i * 82,
      x: (i) => (i - 2.5) * 130,
      rotation: (i) => (i - 2.5) * 44,
      opacity: 0.06,
      stagger: 0.015,
      ease: 'none'
    }, 0.02);

  // iOS Safari needs refreshes after load / orientation changes
  const refreshSoon = () => setTimeout(() => ScrollTrigger.refresh(), 250);
  window.addEventListener('load', refreshSoon, { passive: true });
  window.addEventListener('orientationchange', refreshSoon, { passive: true });
  window.addEventListener('pageshow', refreshSoon, { passive: true });

  // Also refresh after first touch (sometimes iOS doesn't “settle” until interaction)
  window.addEventListener('touchstart', refreshSoon, { passive: true, once: true });
}

  /*// Contact form submit — Formspree
  const form = document.getElementById('contactForm');
  const note = document.getElementById('formNote');*/

  async function postToFormspree(formEl) {
    // Uses the <form action="https://formspree.io/f/..."> you add in index.html
    const endpoint = formEl.getAttribute('action');
    if (!endpoint || !endpoint.includes('formspree.io/f/')) {
      throw new Error('Missing Formspree endpoint on the form action="" attribute.');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      body: new FormData(formEl),
      headers: { 'Accept': 'application/json' }
    });

    // Formspree returns JSON on Accept: application/json
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // If Formspree returns a validation error, include it
      const msg =
        data?.errors?.[0]?.message ||
        data?.error ||
        'Failed to send.';
      throw new Error(msg);
    }
    return data;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (note) note.textContent = 'Sending…';

      try {
        await postToFormspree(form);
        if (note) note.textContent = 'Sent. Thanks — we’ll get back to you shortly.';
        form.reset();
      } catch (err) {
        if (note) note.textContent = 'Sorry — could not send. Please try again in a minute.';
        // Optional: log the actual reason for debugging
        console.log('Formspree error:', err?.message || err);
      }
    });
  }
})();
