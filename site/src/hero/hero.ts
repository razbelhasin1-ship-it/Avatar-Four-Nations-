import { reducedMotion } from '../ui/dom';
import { HeroScene } from './HeroScene';

const CYCLE = 9; // seconds per element while nobody is choosing
/** How strongly the hero darkens behind the text in each mood (bright moods need more). */
const VEIL = [0.42, 0.66, 0.4, 0.7];
const IDLE_RESUME = 25; // seconds after a choice before the cycle resumes

/**
 * Wires the hero painting to the page: the four element buttons, an opening that lights
 * Water, Earth, Fire and Air in turn, a slow cycle through the four while idle, pointer
 * parallax and ripples, scroll, and pausing whenever the hero is out of view.
 */
export function initHero(): { setActive(on: boolean): void; setPaused(on: boolean): void; select(i: number): void; scene: HeroScene | null } {
  const hero = document.querySelector<HTMLElement>('.hero');
  const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement | null;
  const picks = Array.from(document.querySelectorAll<HTMLButtonElement>('.element-pick'));
  if (!hero || !canvas) return { setActive: () => {}, setPaused: () => {}, select: () => {}, scene: null };

  const reduced = reducedMotion();
  const scene = new HeroScene(canvas, { reducedMotion: reduced });
  let mood = 0;
  let cycleTimer = 0;
  let resumeTimer = 0;
  let active = true;
  let inView = true;

  const mark = (i: number, timing: boolean) => {
    mood = i;
    hero.dataset.mood = String(i);
    hero.style.setProperty('--veil', String(VEIL[i]));
    picks.forEach((p, j) => {
      p.setAttribute('aria-pressed', String(i === j));
      p.classList.remove('is-timing');
    });
    if (timing && !reduced) {
      const p = picks[i];
      void p.offsetWidth;
      p.style.setProperty('--cycle', `${CYCLE}s`);
      p.classList.add('is-timing');
    }
  };

  const go = (i: number, timing: boolean) => {
    mark(i, timing);
    scene.setMood(i);
  };

  const cycle = () => {
    clearTimeout(cycleTimer);
    if (reduced) return;
    cycleTimer = window.setTimeout(() => {
      if (active && inView && !document.hidden) go((mood + 1) % 4, true);
      cycle();
    }, CYCLE * 1000);
  };

  picks.forEach((p, i) =>
    p.addEventListener('click', () => {
      go(i, false);
      clearTimeout(cycleTimer);
      clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        go((mood + 1) % 4, true);
        cycle();
      }, IDLE_RESUME * 1000);
    }),
  );

  if (scene.ok) {
    hero.classList.add('is-live');
    scene.setMood(0, true);
    scene.start();
  } else {
    hero.classList.add('is-fallback');
  }
  mark(0, false);

  // The opening: each element lights in turn while the painting fades in, then the cycle begins.
  if (!reduced) {
    const els = document.querySelector('.elements');
    els?.classList.add('is-intro');
    setTimeout(() => {
      els?.classList.remove('is-intro');
      mark(0, true);
      cycle();
    }, 2300);
  }

  // Pointer: parallax and ripples on the water.
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    scene.pointer(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  });
  hero.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('a, button')) return;
    const r = hero.getBoundingClientRect();
    scene.splash(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  });

  // Scroll: the view rises as you leave the hero.
  let tick = false;
  addEventListener(
    'scroll',
    () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        tick = false;
        scene.setScroll(scrollY / Math.max(1, hero.offsetHeight));
      });
    },
    { passive: true },
  );

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      scene.setVisible(inView && active);
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', () => scene.setVisible(inView && active && !document.hidden));

  return {
    scene,
    setActive(on: boolean) {
      active = on;
      scene.setVisible(on && inView);
    },
    setPaused(on: boolean) {
      scene.setPaused(on);
    },
    select(i: number) {
      go(i, false);
    },
  };
}
