// NOZACK — fit-to-width hero (inside margins) + aggressive scroll breakup + contact form submit
(() => {
    // Fit NOZACK to full width INSIDE margins
  const word = document.getElementById('titleWord');
  function fitHero(){
    if (!word) return;
    const stage = word.closest('.titleStage');
    const stageW = (stage?.clientWidth || window.innerWidth);

    const cs = stage ? getComputedStyle(stage) : null;
    const padL = cs ? parseFloat(cs.paddingLeft || '0') : 0;
    const padR = cs ? parseFloat(cs.paddingRight || '0') : 0;

    const maxW = Math.max(0, stageW - padL - padR - 4);

    let lo = 24, hi = 900;
    for (let k = 0; k < 24; k++){
      const mid = (lo + hi) / 2;
      document.documentElement.style.setProperty('--heroSize', mid + 'px');
      // scrollWidth catches overflow better
      const w = word.scrollWidth;
      if (w > maxW) hi = mid; else lo = mid;
    }

    let size = lo * 0.955;
    document.documentElement.style.setProperty('--heroSize', size + 'px');

    for (let i = 0; i < 10; i++){
      if (word.scrollWidth <= maxW) break;
      size *= 0.98;
      document.documentElement.style.setProperty('--heroSize', size + 'px');
    }
  }

  window.addEventListener('resize', fitHero, { passive: true });
  fitHero();

  // Scroll breakup
  const letters = Array.from(document.querySelectorAll('.letter'));
  if (letters.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.set(letters, { x: 0, y: 0, rotation: 0, opacity: 1, transformOrigin: '50% 50%' });

    gsap.timeline({
      scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=220', scrub: true }
    })
    .to(letters, { scaleX: 0.965, scaleY: 1.04, stagger: 0.01, ease: 'none' }, 0)
    .to(letters, {
      y: (i) => 520 + i * 72,
      x: (i) => (i - 2.5) * 110,
      rotation: (i) => (i - 2.5) * 36,
      opacity: 0.08,
      stagger: 0.015,
      ease: 'none'
    }, 0.08);
  }

  // Contact form submit
  const form = document.getElementById('contactForm');
  const note = document.getElementById('formNote');

  async function postContact(payload){
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (note) note.textContent = 'Sending…';

      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        message: String(fd.get('message') || '').trim(),
        page: location.href
      };

      try {
        await postContact(payload);
        if (note) note.textContent = 'Sent. Thanks — we’ll get back to you shortly.';
        form.reset();
      } catch {
        if (note) note.textContent = 'Sorry — could not send. Please try again in a minute.';
      }
    });
  }
})();
