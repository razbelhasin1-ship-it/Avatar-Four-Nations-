import type { GameContext } from '../../core/GameContext';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { h, clear } from '../dom';
import { ELEMENT_COLORS, emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';

const ELEMENTS_ORDER: Element[] = ['water', 'earth', 'fire', 'air'];

function fmtTime(s: number): string {
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return hrs ? `${hrs}h ${m}m` : `${m}m`;
}

// -----------------------------------------------------------------------------
// Vistas: snapshots of the start cities taken by the menu tour (card art for the
// new-journey element cards). Persisted per element in localStorage.
// -----------------------------------------------------------------------------

const VISTA_KEY = 'a4n.vista.';
const vistas = new Map<string, string>();

export function getVista(e: Element): string | null {
  if (vistas.has(e)) return vistas.get(e)!;
  try {
    const v = localStorage.getItem(VISTA_KEY + e);
    if (v) vistas.set(e, v);
    return v;
  } catch {
    return null;
  }
}

function storeVista(id: string, src: HTMLCanvasElement): void {
  if (!(ELEMENTS as readonly string[]).includes(id) || !src.width || !src.height) return;
  try {
    const cv = document.createElement('canvas');
    cv.width = 480;
    cv.height = 270;
    const g = cv.getContext('2d');
    if (!g) return;
    // Cover-fit the snapshot into 16:9.
    const sr = src.width / src.height;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sr > 16 / 9) {
      sw = src.height * (16 / 9);
      sx = (src.width - sw) / 2;
    } else {
      sh = src.width / (16 / 9);
      sy = (src.height - sh) / 2;
    }
    g.drawImage(src, sx, sy, sw, sh, 0, 0, 480, 270);
    const url = cv.toDataURL('image/jpeg', 0.8);
    vistas.set(id, url);
    localStorage.setItem(VISTA_KEY + id, url);
  } catch {
    /* storage full / tainted: keep the in-memory copy only */
  }
}

// -----------------------------------------------------------------------------
// Gamepad navigation for menus: D-pad / left stick moves focus, A activates, B goes back.
// -----------------------------------------------------------------------------

const padState = { prev: [] as boolean[], axis: 0 };

export function gamepadNav(root: HTMLElement, onBack?: () => void): void {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let gp: Gamepad | null = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return;
  const edges: Record<number, boolean> = {};
  for (const i of [0, 1, 12, 13, 14, 15]) {
    const now = !!gp.buttons[i]?.pressed;
    edges[i] = now && !padState.prev[i];
    padState.prev[i] = now;
  }
  const ay = gp.axes[1] ?? 0;
  const a = ay < -0.6 ? -1 : ay > 0.6 ? 1 : 0;
  let dir = edges[12] || edges[14] ? -1 : edges[13] || edges[15] ? 1 : 0;
  if (!dir && a !== padState.axis) dir = a;
  padState.axis = a;
  const scope = (document.querySelector('.confirm') as HTMLElement | null) ?? root;
  if (dir) {
    const items = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')).filter((el) => el.offsetParent !== null);
    if (items.length) {
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[i < 0 ? 0 : (i + dir + items.length) % items.length].focus();
    }
  }
  if (edges[0] && document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)) document.activeElement.click();
  if (edges[1]) onBack?.();
}

/** Arrow-key focus movement inside a list of buttons. Returns true if handled. */
export function arrowNav(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled)')).filter((el) => el.offsetParent !== null);
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const dir = e.key === 'ArrowDown' ? 1 : -1;
  items[i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length].focus();
  e.preventDefault();
  return true;
}

// -----------------------------------------------------------------------------

type View = 'root' | 'enter' | 'farewell';

export class MainMenu implements Screen {
  readonly id = 'mainMenu';
  readonly el: HTMLElement;
  modal = true;
  private list: HTMLElement;
  private content: HTMLElement;
  private farewellEl: HTMLElement;
  private xfade: HTMLCanvasElement;
  private locName: HTMLElement;
  private locSub: HTMLElement;
  private locDots: HTMLElement;
  private locEl: HTMLElement;
  private ctx!: GameContext;
  private view: View = 'root';
  private subscribed = false;

  constructor(private readonly ui: UIManager) {
    this.list = h('div.menu-list', { role: 'menu' });
    this.xfade = h('canvas.menu-xfade') as HTMLCanvasElement;
    this.locName = h('div.loc-name');
    this.locSub = h('div.loc-sub');
    this.locDots = h('div.loc-dots');
    this.locEl = h('div.menu-location', h('div.loc-kicker', 'The Four Nations'), this.locName, this.locSub, this.locDots);
    const brand = h(
      'div.menu-brand',
      h('div.brand-rule', h('i'), h('span', '◆'), h('i')),
      h('h1.logo', h('span.logo-main', 'AVATAR'), h('small', 'THE FOUR NATIONS')),
      h('div.emblems.menu-emblems', ELEMENTS_ORDER.map((e, i) => {
        const em = emblem(e);
        em.style.setProperty('--glow', ELEMENT_COLORS[e].shadow);
        em.style.animationDelay = `${i * 0.9}s`;
        em.title = ELEMENT_INFO[e].name;
        return em;
      })),
    );
    this.content = h('div.menu-content', brand, this.list);
    this.farewellEl = h('div.menu-farewell.hidden');
    this.el = h(
      'div.main-menu',
      this.xfade,
      h('div.menu-vignette'),
      this.content,
      this.farewellEl,
      this.locEl,
      h('div.menu-footer', h('span', 'Mouse & keyboard · gamepad · touch'), h('span.dot', '·'), h('span', 'A fan-made tribute adventure')),
    );
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    if (!this.subscribed) {
      this.subscribed = true;
      ctx.events.on('menu:tour', (e) => this.onTour(e));
    }
    this.farewellEl.classList.add('hidden');
    this.content.classList.remove('hidden');
    this.renderRoot();
    this.showLocation(ctx.game.menuTour.index, ctx.game.menuTour.name, ctx.game.menuTour.subtitle, ctx.game.menuTour.shots);
    this.installDebug();
  }

  // ---------------------------------------------------------------------------
  // Backdrop tour
  // ---------------------------------------------------------------------------

  private onTour(e: { phase: 'cut' | 'shot'; index: number; id: string; name: string; subtitle: string; blank?: boolean }): void {
    const cv = this.xfade;
    cv.classList.remove('fading');
    if (e.phase === 'cut') {
      const src = this.ctx.render.renderer.domElement;
      const w = Math.max(2, Math.min(src.width || 2, 1600));
      const hgt = Math.max(2, Math.round(((src.height || 2) * w) / (src.width || 2)));
      cv.width = w;
      cv.height = hgt;
      const g = cv.getContext('2d');
      if (g) {
        if (e.blank) {
          g.fillStyle = '#0b0a0c';
          g.fillRect(0, 0, w, hgt);
        } else {
          g.drawImage(src, 0, 0, w, hgt);
          storeVista(e.id, cv);
        }
      }
      cv.classList.add('holding');
      cv.style.opacity = '1';
      this.locEl.classList.add('out');
    } else {
      // Reveal the new place underneath with a slow cross-fade.
      void cv.offsetWidth;
      cv.classList.add('fading');
      cv.classList.remove('holding');
      cv.style.opacity = '0';
      this.showLocation(e.index, e.name, e.subtitle, this.ctx.game.menuTour.shots);
    }
  }

  private showLocation(index: number, name: string, sub: string, count: number): void {
    this.locName.textContent = name;
    this.locSub.textContent = sub;
    clear(this.locDots);
    for (let i = 0; i < count; i++) this.locDots.append(h(`i${i === index ? '.on' : ''}`));
    this.locEl.classList.remove('out');
  }

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  private btn(label: string, onClick: () => void, opts: { primary?: boolean; delay?: number; disabled?: boolean; id?: string; sub?: string } = {}): HTMLElement {
    const b = h(
      `button.btn.menu-btn${opts.primary ? '.primary' : ''}`,
      {
        onclick: () => {
          this.ctx.audio.play('ui_click', { bus: 'ui' });
          onClick();
        },
        disabled: opts.disabled,
        role: 'menuitem',
        'data-action': opts.id,
      },
      h('span.menu-btn-label', label),
      opts.sub ? h('span.menu-btn-sub', opts.sub) : null,
    );
    b.style.animationDelay = `${opts.delay ?? 0}s`;
    return b;
  }

  renderRoot(): void {
    this.view = 'root';
    clear(this.list);
    this.list.append(
      this.btn('Enter the World', () => this.renderEnter(), { primary: true, delay: 0.05, id: 'enter' }),
      this.btn('Tutorial', () => void this.ctx.game.startTutorial(), { delay: 0.1, id: 'tutorial' }),
      this.btn('Settings', () => this.ui.open('settings'), { delay: 0.15, id: 'settings' }),
      this.btn('Exit Game', () => this.exit(), { delay: 0.2, id: 'exit' }),
    );
    this.focusFirst();
  }

  private renderEnter(): void {
    this.view = 'enter';
    clear(this.list);
    const latest = this.ctx.save.latest();
    this.list.append(h('div.menu-heading', 'Enter the World'));
    if (latest) {
      const info = ELEMENT_INFO[latest.startingElement];
      this.list.append(
        this.btn('Continue', () => void this.ctx.game.loadGame(latest.slot), {
          primary: true,
          id: 'continue',
          delay: 0.04,
          sub: `${latest.characterName} · ${info.name} Avatar · Lv ${latest.level} · ${latest.regionName} · ${fmtTime(latest.playTime)}`,
        }),
      );
    }
    this.list.append(
      this.btn('New Journey', () => this.ui.open('newGame'), { primary: !latest, id: 'new', delay: 0.08, sub: 'Choose your element and create your Avatar' }),
      this.btn('Load Journey', () => this.ui.open('saveload', { mode: 'load' }), { disabled: !latest, id: 'load', delay: 0.12, sub: latest ? undefined : 'No saved journeys yet' }),
      this.btn('Back', () => this.renderRoot(), { id: 'back', delay: 0.16 }),
    );
    this.focusFirst();
  }

  private focusFirst(): void {
    // Keyboard / gamepad users start on the first option (no visible ring for mouse users).
    const first = this.list.querySelector<HTMLElement>('button:not(:disabled)');
    if (first && this.ctx.input.lastDevice !== 'touch') first.focus({ preventScroll: true });
  }

  private exit(): void {
    const ctx = this.ctx;
    if (ctx.session.active && ctx.session.kind === 'campaign') {
      this.ui.confirm('Exit the game? Progress since your last save will be lost unless you save now.', [
        { text: 'Save & Exit', primary: true, onClick: () => { ctx.game.saveGame(); this.farewell(); } },
        { text: 'Exit without Saving', danger: true, onClick: () => this.farewell() },
        { text: 'Cancel' },
      ]);
      return;
    }
    this.ui.confirm('Leave the Four Nations? Your journeys are saved in this browser.', [
      { text: 'Exit Game', danger: true, onClick: () => this.farewell() },
      { text: 'Stay', primary: true },
    ]);
  }

  /** Safe shutdown: end any session, then try to close the window; browsers usually refuse, so say goodbye instead. */
  private farewell(): void {
    const ctx = this.ctx;
    if (ctx.session.active) ctx.game.endSession();
    ctx.settings.persist();
    this.view = 'farewell';
    this.content.classList.add('hidden');
    clear(this.farewellEl);
    this.farewellEl.append(
      h('div.emblems', ELEMENTS_ORDER.map((e) => emblem(e))),
      h('h2.title', 'Farewell, Avatar'),
      h('p', 'Your journeys are safely stored in this browser. You can close this tab now — the world will be waiting.'),
      h('button.btn.primary', { 'data-action': 'return', onclick: () => this.returnFromFarewell() }, 'Return to Main Menu'),
    );
    this.farewellEl.classList.remove('hidden');
    try {
      window.close();
    } catch {
      /* not allowed: the farewell screen stays */
    }
    (this.farewellEl.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private returnFromFarewell(): void {
    this.farewellEl.classList.add('hidden');
    this.content.classList.remove('hidden');
    this.renderRoot();
  }

  update(): void {
    if (this.ui.currentScreen !== this.id) return;
    gamepadNav(this.el, () => this.onBack());
  }

  private onBack(): void {
    if (this.view === 'enter') this.renderRoot();
    else if (this.view === 'farewell') this.returnFromFarewell();
  }

  onKey(e: KeyboardEvent): boolean {
    if (arrowNav(e, this.view === 'farewell' ? this.farewellEl : this.list)) return true;
    if (e.key === 'Escape') {
      this.onBack();
      return true;
    }
    return false;
  }

  /** Test hooks: window.__game.debug.menu */
  private installDebug(): void {
    const api = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!api) return;
    api.debug = api.debug ?? {};
    const game = this.ctx.game;
    api.debug.menu = {
      state: () => ({ ...game.menuTour, view: this.view, overlay: Number(this.xfade.style.opacity || 0), location: this.locName.textContent, auto: game.menuTourAuto }),
      next: () => game.menuCut(game.menuTour.index + 1),
      goto: (i: number) => game.menuCut(i),
      hold: (on = true) => {
        game.menuTourAuto = !on;
      },
      vistas: () => ELEMENTS.filter((e) => !!getVista(e)),
    };
  }
}

