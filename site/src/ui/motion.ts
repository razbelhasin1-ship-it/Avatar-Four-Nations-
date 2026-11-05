import { finePointer, reducedMotion } from './dom';

/**
 * Smooth wheel scrolling for mouse users (native scrolling everywhere else), the top bar's glass
 * state, and reveal-on-scroll for browsers without scroll-driven animations.
 */
export interface Motion {
  scrollTo(y: number, smooth: boolean): void;
  setEnabled(on: boolean): void;
}

export function initMotion(): Motion {
  const topbar = document.getElementById('topbar');
  const smoothOn = finePointer() && !reducedMotion();
  let enabled = true;
  let target = scrollY;
  let current = scrollY;
  let running = false;
  let last = 0;

  const maxY = () => document.documentElement.scrollHeight - innerHeight;
  const clamp = (y: number) => Math.max(0, Math.min(maxY(), y));

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    current += (target - current) * (1 - Math.exp(-dt * 9.5));
    if (Math.abs(target - current) < 0.4) {
      current = target;
      running = false;
    }
    window.scrollTo(0, current);
    if (running) requestAnimationFrame(loop);
  };
  const start = () => {
    if (running) return;
    running = true;
    current = scrollY;
    last = performance.now();
    requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    target = current = scrollY;
  };

  const scrollsItself = (el: Element | null, dy: number): boolean => {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (!/(auto|scroll)/.test(s.overflowY)) continue;
      if (n.scrollHeight <= n.clientHeight + 1) continue;
      if ((dy < 0 && n.scrollTop > 0) || (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return true;
    }
    return false;
  };

  if (smoothOn) {
    addEventListener(
      'wheel',
      (e) => {
        if (!enabled || e.ctrlKey || e.defaultPrevented) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        if (scrollsItself(e.target as Element, e.deltaY)) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 36 : e.deltaMode === 2 ? innerHeight : 1;
        if (!running) target = scrollY;
        target = clamp(target + e.deltaY * unit);
        start();
      },
      { passive: false },
    );
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stop();
    });
    addEventListener('pointerdown', () => running && stop());
  }

  // The top bar turns to glass once the page has moved under it.
  let barTick = false;
  const updateBar = () => {
    barTick = false;
    const onHome = !document.getElementById('view-home')?.hidden;
    topbar?.classList.toggle('is-solid', !onHome || scrollY > 40);
  };
  addEventListener(
    'scroll',
    () => {
      if (!running) target = current = scrollY;
      if (!barTick) {
        barTick = true;
        requestAnimationFrame(updateBar);
      }
    },
    { passive: true },
  );
  updateBar();

  // Reveal fallback: only for browsers without scroll-driven animations. Elements already on
  // screen are never hidden; the rest arrive as they scroll in.
  if (!CSS.supports('animation-timeline: view()') && !reducedMotion() && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.remove('is-pending');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    const arm = () => {
      document.querySelectorAll<HTMLElement>('.reveal').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top > innerHeight * 0.92 && el.offsetParent) {
          el.classList.add('is-pending');
          io.observe(el);
        }
      });
    };
    arm();
    // Safety net: nothing stays faded if an observer never fires.
    setTimeout(() => document.querySelectorAll('.reveal.is-pending').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight) el.classList.remove('is-pending');
    }), 4000);
  }

  return {
    scrollTo(y: number, smooth: boolean) {
      if (!smooth || reducedMotion()) {
        running = false;
        window.scrollTo(0, y);
        target = current = scrollY;
        requestAnimationFrame(updateBar);
        return;
      }
      if (smoothOn) {
        target = clamp(y);
        start();
      } else {
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) stop();
      requestAnimationFrame(updateBar);
    },
  };
}
