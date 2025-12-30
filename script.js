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
  window.addEventListener('orientationchange', fitHero, { passive: true });
  window.addEventListener('pageshow', fitHero, { passive: true });
  fitHero();

  // ==========================
  // HERO BREAK APART (iOS-safe)
  // ==========================
  const letters = Array.from(document.querySelectorAll('.letter'));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getScrollY() {
    // Most reliable cross-browser
    return (
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  // Fallback animation (no GSAP required)
  function setupVanillaBreakApart() {
    if (!letters.length || reduceMotion) return;

    const hero = document.getElementById('hero');
    if (!hero) return;

    let ticking = false;

    function apply(progress) {
      // progress: 0..1
      const p = Math.max(0, Math.min(1, progress));

      // Make it “aggressive” immediately
      // (starts breaking on the tiniest scroll)
      letters.forEach((el, i) => {
        const center = (i - (letters.length - 1) / 2);

        // movement targets (tweakable)
        const tx = center * 130 * p;
        const ty = (560 + i * 82) * p;
        const rot = center * 44 * p;

        // solid black -> fade as it breaks
        const opacity = 1 - (0.94 * p); // ends ~0.06

        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg) scaleX(${1 - 0.035 * p}) scaleY(${1 + 0.04 * p})`;
        el.style.opacity = String(opacity);
      });
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;

        const rect = hero.getBoundingClientRect();
        const heroTopOnPage = getScrollY() + rect.top;

        // Start as soon as scroll is touched:
        // progress increases over first ~260px of scroll
        const range = 260;
        const y = getScrollY();
        const p = (y - heroTopOnPage) / range;

        // When hero is at top of viewport, p ~ 0.
        // As you scroll down, p goes to 1 quickly.
        apply(p);
      });
    }

    // Set initial
    apply(0);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('orientationchange', onScroll, { passive: true });
    window.addEventListener('pageshow', onScroll, { passive: true });

    // iOS sometimes needs a first interaction before it repaints transforms smoothly
    window.addEventListener('touchstart', onScroll, { passive: true, once: true });
  }

  // GSAP version (if available)
  function setupGsapBreakApart() {
    if (!letters.length || reduceMotion) return false;

    if (!window.gsap || !window.ScrollTrigger) return false;

    gsap.registerPlugin(ScrollTrigger);

    ScrollTrigger.config({ ignoreMobileResize: true });

    // Normalize scroll can throw depending on GSAP build; keep guarded
    try { ScrollTrigger.normalizeScroll(true); } catch(e) {}

    gsap.set(letters, { x: 0, y: 0, rotation: 0, opacity: 1, transformOrigin: '50% 50%' });

    gsap.timeline({
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: '+=260',
        scrub: true
      }
    })
    .to(letters, { scaleX: 0.965, scaleY: 1.04, stagger: 0.01, ease: 'none' }, 0)
    .to(letters, {
      y: (i) => 560 + i * 82,
      x: (i) => (i - 2.5) * 130,
      rotation: (i) => (i - 2.5) * 44,
      opacity: 0.06,
      stagger: 0.015,
      ease: 'none'
    }, 0.02);

    const refreshSoon = () => setTimeout(() => ScrollTrigger.refresh(), 250);
    window.addEventListener('load', refreshSoon, { passive: true });
    window.addEventListener('orientationchange', refreshSoon, { passive: true });
    window.addEventListener('pageshow', refreshSoon, { passive: true });
    window.addEventListener('touchstart', refreshSoon, { passive: true, once: true });

    return true;
  }

  // Prefer GSAP, fallback to vanilla (this makes iPhone work no matter what)
  const gsapOk = setupGsapBreakApart();
  if (!gsapOk) setupVanillaBreakApart();

  // ==========================
  // Contact form submit — Formspree
  // ==========================
  const form = document.getElementById('contactForm');
  const note = document.getElementById('formNote');

  async function postToFormspree(formEl) {
    const endpoint = formEl.getAttribute('action');
    if (!endpoint || !endpoint.includes('formspree.io/f/')) {
      throw new Error('Missing Formspree endpoint on the form action="" attribute.');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      body: new FormData(formEl),
      headers: { 'Accept': 'application/json' }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.errors?.[0]?.message || data?.error || 'Failed to send.';
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
        console.log('Formspree error:', err?.message || err);
      }
    });
  }
})();
