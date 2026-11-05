import { reducedMotion } from './dom';

export type Route = 'home' | 'features' | 'about' | 'play';
const ROUTES: Route[] = ['home', 'features', 'about', 'play'];

export interface RouterHooks {
  /** A view is about to show (before its first paint). */
  onRoute(route: Route, prev: Route | null): void;
  /** Smooth scroll to a y position (the smooth-scroll module, or the browser). */
  scrollTo(y: number, smooth: boolean): void;
}

interface Resolved {
  route: Route;
  target: HTMLElement | null;
}

function resolve(name: string): Resolved {
  if ((ROUTES as string[]).includes(name)) return { route: name as Route, target: null };
  const el = name ? document.getElementById(name) : null;
  const view = el?.closest<HTMLElement>('[data-view]')?.dataset.view as Route | undefined;
  if (el && view) return { route: view, target: el };
  return { route: 'home', target: null };
}

/**
 * Hash routing between the site's tabs (#home, #features, #about, #play). Anchors to sections
 * (#nations, #bending, …) open the tab that holds them and scroll there.
 */
export function initRouter(hooks: RouterHooks): { current(): Route; go(name: string, animate?: boolean): void } {
  // The router places the page itself (a hash can name a whole tab, not just a spot on it).
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const views = Array.from(document.querySelectorAll<HTMLElement>('[data-view]'));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-route]'));
  const ink = document.querySelector<HTMLElement>('.tabs__ink');
  let current: Route | null = null;

  const moveInk = () => {
    if (!ink) return;
    const active = document.querySelector<HTMLElement>(`.tabs__link[data-route="${current}"]`);
    if (!active) {
      ink.style.opacity = '0';
      return;
    }
    ink.style.opacity = '1';
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  addEventListener('resize', moveInk);
  document.fonts?.ready.then(moveInk).catch(() => {});

  const targetY = (el: HTMLElement) => {
    const top = el.getBoundingClientRect().top + scrollY;
    const offset = (document.querySelector('.topbar')?.getBoundingClientRect().height ?? 64) + (el.closest('.view--page') && document.querySelector('.chips') ? 70 : 16);
    return Math.max(0, top - offset);
  };

  const show = (r: Resolved, animate: boolean) => {
    const prev = current;
    if (r.route !== current) {
      current = r.route;
      const swap = () => {
        hooks.onRoute(r.route, prev);
        for (const v of views) v.hidden = v.dataset.view !== r.route;
        for (const l of links) {
          if (l.dataset.route === r.route) l.setAttribute('aria-current', 'page');
          else l.removeAttribute('aria-current');
        }
        hooks.scrollTo(r.target ? targetY(r.target) : 0, false);
        moveInk();
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
      if (animate && prev && doc.startViewTransition && !reducedMotion()) {
        doc.startViewTransition(swap);
      } else {
        swap();
        if (animate && prev && !reducedMotion()) {
          const v = views.find((x) => x.dataset.view === r.route);
          v?.classList.remove('is-entering');
          void v?.offsetWidth;
          v?.classList.add('is-entering');
        }
      }
      // Move keyboard and screen-reader focus to the new page's heading.
      if (prev) {
        const heading = views.find((v) => v.dataset.view === r.route)?.querySelector<HTMLElement>('h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      }
    } else if (r.target) {
      hooks.scrollTo(targetY(r.target), true);
    } else {
      hooks.scrollTo(0, true);
    }
  };

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
    if (!a) return;
    const name = a.getAttribute('href')!.slice(1);
    e.preventDefault();
    if (`#${name}` !== location.hash) history.pushState(null, '', `#${name}`);
    show(resolve(name), true);
  });
  addEventListener('popstate', () => show(resolve(location.hash.slice(1)), true));
  addEventListener('hashchange', () => show(resolve(location.hash.slice(1)), true));

  show(resolve(location.hash.slice(1)), false);
  return {
    current: () => current ?? 'home',
    go: (name: string, animate = true) => {
      if (`#${name}` !== location.hash) history.pushState(null, '', `#${name}`);
      show(resolve(name), animate);
    },
  };
}
