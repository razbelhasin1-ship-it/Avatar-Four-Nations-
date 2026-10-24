import type { GameContext } from '../../core/GameContext';
import { clear, h } from '../dom';
import type { Screen, UIManager } from '../UIManager';
import './screens.css';

/**
 * Shared frame for the in-game screens (journal, techniques, map, inventory,
 * character, pause): ornamented panel, tab strip, footer with device-aware
 * control hints, and keyboard + gamepad navigation:
 *   Q/E or LB/RB      switch tabs
 *   arrows / D-pad    move focus spatially (left stick too)
 *   Enter/Space / A   activate
 *   Esc / B           back / close
 *   right stick       scroll the focused list (screens may override, e.g. map pan)
 */

export interface TabDef {
  id: string;
  label: string;
  icon?: HTMLElement | null;
  badge?: string | number | null;
  locked?: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not(:disabled), [tabindex="0"], input:not([type="hidden"]), select';

export function focusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null && !el.closest('[inert]'));
}

/** Move focus to the nearest focusable in a direction (grid-friendly). Returns true if focus moved. */
export function moveFocus(root: HTMLElement, dir: Dir): boolean {
  const items = focusables(root);
  if (!items.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || cur === document.body) {
    focusEl(items.find((el) => el.closest('.gs-body')) ?? items[0]);
    return true;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    let main: number, cross: number;
    if (dir === 'left' || dir === 'right') {
      main = dir === 'right' ? b.left - r.right + 1 : r.left - b.right + 1;
      if ((dir === 'right' ? x - cx : cx - x) <= 2) continue;
      cross = b.bottom < r.top ? r.top - b.bottom : b.top > r.bottom ? b.top - r.bottom : 0;
    } else {
      main = dir === 'down' ? b.top - r.bottom + 1 : r.top - b.bottom + 1;
      if ((dir === 'down' ? y - cy : cy - y) <= 2) continue;
      cross = b.right < r.left ? r.left - b.right : b.left > r.right ? b.left - r.right : 0;
      cross += Math.abs(x - cx) * 0.05;
    }
    const score = Math.max(0, main) + cross * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  focusEl(best);
  return true;
}

/**
 * Touch "ghost click" guard: a tap that opened a menu (e.g. the ☰ touch button)
 * is followed by a synthetic click at the same spot, which would land on
 * whatever the new menu shows there. Pointer clicks only count after a pointer
 * went down inside `root`; keyboard / gamepad / programmatic clicks (detail 0)
 * always pass. Call the returned function when the menu opens.
 */
export function guardGhostClicks(root: HTMLElement): () => void {
  let armed = true;
  root.addEventListener('pointerdown', () => (armed = true), true);
  root.addEventListener(
    'click',
    (e) => {
      if (!armed && e.detail > 0) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  return () => (armed = false);
}

/** True when the player is (most likely) using touch: wording says "tap", hover-only affordances get tap equivalents. */
export function touchUI(ctx: GameContext): boolean {
  if (ctx.input.lastDevice === 'gamepad') return false;
  if (ctx.input.lastDevice === 'touch' || ctx.ui.touch?.shown) return true;
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

export function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// -----------------------------------------------------------------------------
// Gamepad polling (edges), shared by whichever in-game screen is on top.
// -----------------------------------------------------------------------------

const pad = { prev: [] as boolean[], dir: '' as Dir | '', repeatT: 0 };

export interface PadFrame {
  /** Button went down this frame. */
  edge(i: number): boolean;
  held(i: number): boolean;
  axes: readonly number[];
  /** Repeating directional input from D-pad / left stick. */
  dir: Dir | null;
}

export function pollPad(dt: number): PadFrame | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let gp: Gamepad | null = null;
  for (const p of pads) if (p && p.connected) {
    gp = p;
    break;
  }
  if (!gp) return null;
  const now = gp.buttons.map((b) => !!b?.pressed);
  const prev = pad.prev;
  pad.prev = now;
  const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
  let d: Dir | '' = now[12] ? 'up' : now[13] ? 'down' : now[14] ? 'left' : now[15] ? 'right' : '';
  if (!d && Math.hypot(ax, ay) > 0.55) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
  let dir: Dir | null = null;
  if (d && d !== pad.dir) {
    dir = d;
    pad.repeatT = 0.38;
  } else if (d) {
    pad.repeatT -= dt;
    if (pad.repeatT <= 0) {
      dir = d;
      pad.repeatT = 0.12;
    }
  }
  pad.dir = d;
  return { edge: (i) => !!now[i] && !prev[i], held: (i) => !!now[i], axes: gp.axes, dir };
}

// -----------------------------------------------------------------------------

export abstract class GameScreen implements Screen {
  abstract readonly id: string;
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  protected ctx!: GameContext;
  protected frame: HTMLElement;
  protected head: HTMLElement;
  protected titleEl: HTMLElement;
  protected tabsEl: HTMLElement;
  protected body: HTMLElement;
  protected foot: HTMLElement;
  protected tab = '';

  constructor(protected readonly ui: UIManager, title: string, cls = '') {
    this.titleEl = h('h2.gs-title', title);
    this.tabsEl = h('nav.gs-tabs', { role: 'tablist' });
    const close = h('button.gs-close', { type: 'button', 'data-action': 'close', 'aria-label': 'Close', title: 'Close', onclick: () => this.closeSelf() }, '✕');
    this.head = h('header.gs-head', h('div.gs-titlewrap', h('span.gs-orn'), this.titleEl, h('span.gs-orn.r')), this.tabsEl, close);
    this.body = h('div.gs-body');
    this.foot = h('footer.gs-foot');
    this.frame = h(`section.gs-frame${cls ? '.' + cls : ''}`, { role: 'dialog', 'aria-label': title }, this.head, this.body, this.foot);
    this.el = h(`div.modal-backdrop.gs-backdrop.gs-${cls || 'screen'}`, this.frame);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.closeSelf();
    });
    this.disarm = guardGhostClicks(this.el);
  }

  private disarm: () => void;

  protected closeSelf(): void {
    this.ctx?.audio.play('ui_click', { bus: 'ui' });
    this.ui.close(this.id);
  }

  /** Tabs for the strip (empty = none). */
  protected tabs(): TabDef[] {
    return [];
  }

  /** Extra footer hints: [key label, action]. */
  protected hints(): Array<[string, string]> {
    return [];
  }

  protected abstract renderBody(): void;

  onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    this.disarm();
    const tabs = this.tabs();
    if (typeof arg === 'string' && tabs.some((t) => t.id === arg)) this.tab = arg;
    else if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0]?.id ?? '';
    this.refresh();
    requestAnimationFrame(() => {
      if (!this.el.isConnected) return;
      if (!this.frame.contains(document.activeElement)) {
        const first = focusables(this.body)[0] ?? focusables(this.frame)[0];
        first?.focus({ preventScroll: true });
      }
    });
  }

  refresh(): void {
    this.renderTabs();
    this.renderBody();
    this.renderFoot();
  }

  protected renderTabs(): void {
    clear(this.tabsEl);
    const tabs = this.tabs();
    this.tabsEl.classList.toggle('hidden', tabs.length === 0);
    for (const t of tabs) {
      this.tabsEl.append(
        h(
          `button.gs-tab${t.id === this.tab ? '.active' : ''}${t.locked ? '.locked' : ''}`,
          { type: 'button', role: 'tab', 'aria-selected': String(t.id === this.tab), 'data-tab': t.id, onclick: () => this.setTab(t.id) },
          t.icon ?? null,
          h('span', t.label),
          t.badge !== undefined && t.badge !== null && t.badge !== '' ? h('span.gs-badge', String(t.badge)) : null,
        ),
      );
    }
  }

  protected renderFoot(): void {
    clear(this.foot);
    const pad = this.ctx.input.lastDevice === 'gamepad';
    const base: Array<[string, string]> = [];
    if (this.tabs().length > 1) base.push([pad ? 'LB/RB' : 'Q/E', 'Tabs']);
    base.push([pad ? 'Ⓐ' : 'Enter', 'Select']);
    base.push([pad ? 'Ⓑ' : 'Esc', 'Close']);
    for (const [k, a] of [...this.hints(), ...base]) this.foot.append(h('span.gs-hint', h('span.kbd', k), h('span', a)));
  }

  setTab(id: string): void {
    if (this.tab === id) return;
    this.tab = id;
    this.ctx.audio.play('ui_click', { bus: 'ui', volume: 0.6 });
    this.refresh();
    this.body.scrollTop = 0;
  }

  cycleTab(d: number): void {
    const tabs = this.tabs();
    if (tabs.length < 2) return;
    const i = Math.max(0, tabs.findIndex((t) => t.id === this.tab));
    this.setTab(tabs[(i + d + tabs.length) % tabs.length].id);
    (this.tabsEl.querySelector('.gs-tab.active') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Screen-specific key handling; return true when handled. */
  protected key(e: KeyboardEvent): boolean {
    return false;
  }

  /** Screen-specific gamepad handling; return true when handled. */
  protected padInput(p: PadFrame, dt: number): boolean {
    return false;
  }

  /** Back / Escape: close (screens override, e.g. to cancel a pending pick first). */
  protected back(): void {
    this.closeSelf();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.key(e)) return true;
    if (e.key === 'Escape') {
      // Acted on in update() together with the 'pause' action, so the same press
      // cannot also re-open the pause menu once this screen has closed.
      this.escPending = true;
      return true;
    }
    if (e.key === 'q' || e.key === 'Q') {
      this.cycleTab(-1);
      return true;
    }
    if (e.key === 'e' || e.key === 'E') {
      this.cycleTab(1);
      return true;
    }
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, Dir>)[e.key];
    if (dir) {
      e.preventDefault();
      moveFocus(this.frame, dir);
      return true;
    }
    return false;
  }

  private escPending = false;
  private wasTop = false;
  private confirmSeen = false;

  update(dt: number): void {
    if (this.ui.currentScreen !== this.id) {
      this.wasTop = false;
      this.escPending = false;
      return;
    }
    const input = this.ctx.input;
    const confirm = document.querySelector('.confirm') as HTMLElement | null;
    if (!this.wasTop) {
      // Became the top screen this frame: a press that closed the screen above must not act here too.
      this.wasTop = true;
      this.escPending = false;
      input.consume('pause');
    } else if (this.escPending || input.wasPressed('pause')) {
      input.consume('pause');
      this.escPending = false;
      if (!confirm && !this.confirmSeen) {
        this.confirmSeen = false;
        this.back();
        return;
      }
    }
    this.confirmSeen = !!confirm;
    const p = pollPad(dt);
    if (!p) return;
    if (confirm) {
      if (p.dir) moveFocus(confirm, p.dir);
      if (p.edge(0) && document.activeElement instanceof HTMLElement && confirm.contains(document.activeElement)) document.activeElement.click();
      if (p.edge(1)) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }
    if (this.padInput(p, dt)) return;
    if (p.edge(4)) this.cycleTab(-1);
    if (p.edge(5)) this.cycleTab(1);
    if (p.dir) moveFocus(this.frame, p.dir);
    if (p.edge(0) && document.activeElement instanceof HTMLElement && this.frame.contains(document.activeElement)) document.activeElement.click();
    if (p.edge(1)) this.back();
    const ry = p.axes[3] ?? 0;
    if (Math.abs(ry) > 0.2) {
      const sc = (document.activeElement as HTMLElement | null)?.closest('.gs-scroll') ?? this.body.querySelector('.gs-scroll') ?? this.body;
      (sc as HTMLElement).scrollTop += ry * dt * 900;
    }
  }
}

// -----------------------------------------------------------------------------
// Small view helpers
// -----------------------------------------------------------------------------

export function meter(frac: number, cls = '', label?: string): HTMLElement {
  const f = Math.max(0, Math.min(1, frac));
  return h(`div.gs-meter${cls ? '.' + cls : ''}`, { role: 'progressbar', 'aria-valuenow': String(Math.round(f * 100)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div.gs-meter-fill', { style: { width: `${(f * 100).toFixed(1)}%` } }), label ? h('span.gs-meter-label', label) : null);
}

export function chip(label: string, active: boolean, onclick: () => void, extra: Record<string, string> = {}): HTMLElement {
  return h(`button.gs-chip${active ? '.active' : ''}`, { type: 'button', 'aria-pressed': String(active), onclick, ...extra }, label);
}

export function empty(text: string, sub = ''): HTMLElement {
  return h('div.gs-empty', h('div.gs-empty-mark', '❖'), h('p', text), sub ? h('p.muted', sub) : null);
}
