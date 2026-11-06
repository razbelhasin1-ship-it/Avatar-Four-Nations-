import type { GameContext, GameSystem } from '../core/GameContext';
import { h } from '../ui/dom';

/**
 * Passing time (the pause menu's "Pass Time"): wait until a chosen hour — skip the night, wait
 * for dusk. The clock runs forward only, never more than a day; on confirming, the world plays a
 * short time-lapse (the sun or moon wheels across the sky, everything driven by the clock follows:
 * NPC routines, the moon's day count and phases, lights) behind a clock overlay, with the player's
 * controls held. Not while enemies are near, in mid-air, riding or defeated.
 */

/** Hours from `from` forward to `to` on a 24-hour clock, in [0, 24). */
export function hoursUntil(from: number, to: number): number {
  return (((to - from) % 24) + 24) % 24;
}

/** "06:00" */
export function formatClock(hour: number): string {
  const m = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "8 h 20 min" */
export function formatSpan(hours: number): string {
  const m = Math.round(hours * 60);
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

/** Sky-matching names for the parts of the day. */
export function partOfDay(hour: number): string {
  const x = ((hour % 24) + 24) % 24;
  if (x < 5) return 'Night';
  if (x < 7) return 'Dawn';
  if (x < 11) return 'Morning';
  if (x < 13.5) return 'Midday';
  if (x < 17.5) return 'Afternoon';
  if (x < 20.5) return 'Evening';
  return 'Night';
}

/** Is it dark (as the sky has it: NPCs sleep, the moon is up)? */
export function isNightHour(hour: number): boolean {
  const x = ((hour % 24) + 24) % 24;
  return x < 5.5 || x > 20.5;
}

/** Quick choices offered by the pause menu. */
export const TIME_PRESETS: ReadonlyArray<{ label: string; hour: number }> = [
  { label: 'Dawn', hour: 6 },
  { label: 'Morning', hour: 9 },
  { label: 'Noon', hour: 12 },
  { label: 'Afternoon', hour: 15 },
  { label: 'Sunset', hour: 18.5 },
  { label: 'Night', hour: 22 },
];

/** Where "skip the night" wakes you. */
export const SUNRISE_HOUR = 6;

/** Seconds the time-lapse takes for a wait of `hours`. */
export function lapseSeconds(hours: number): number {
  return Math.min(3.4, 1.2 + hours * 0.12);
}

interface Lapse {
  from: number;
  hours: number;
  to: number;
  t: number;
  dur: number;
}

export class TimeSkipSystem implements GameSystem {
  private ctx!: GameContext;
  private lapse: Lapse | null = null;
  private overlay: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    injectCSS();
    // Test hooks (the debug API is installed after the modules start).
    if (typeof window === 'undefined') return;
    const install = (): boolean => {
      const g = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
      if (!g) return false;
      g.debug = g.debug ?? {};
      g.debug.time = {
        skipTo: (hour: number) => this.skipTo(hour),
        blockReason: () => this.blockReason(),
        state: () => ({ hour: ctx.world.sky.timeOfDay, passing: !!this.lapse, to: this.lapse?.to ?? null }),
      };
      return true;
    };
    if (!install()) {
      const iv = setInterval(() => {
        if (install()) clearInterval(iv);
      }, 200);
    }
  }

  get hour(): number {
    return this.ctx.world.sky.timeOfDay;
  }

  /** True while the time-lapse runs. */
  get passing(): boolean {
    return !!this.lapse;
  }

  /** Why time cannot pass right now (null: it can). */
  blockReason(): string | null {
    const ctx = this.ctx;
    if (!ctx.session.active) return 'Start a journey first.';
    if (this.lapse) return 'Time is already passing.';
    const p = ctx.player;
    if (!p) return 'No traveller.';
    if (p.defeated) return 'You cannot rest while defeated.';
    if (p.mountAnchor) return 'Dismount first.';
    if (p.glider || (p.body && !p.body.grounded && !p.body.swimming)) return 'Land first.';
    if (ctx.entities.queryRadius(p.position, 35, { teams: ['hostile'], aliveOnly: true }).length > 0) return 'You cannot rest while enemies are near.';
    return null;
  }

  /** Wait until `hour` (forward, up to a day). Returns false (and does nothing) when blocked. */
  skipTo(hour: number): boolean {
    if (this.blockReason()) return false;
    const from = this.hour;
    const hours = hoursUntil(from, hour);
    if (hours < 1 / 60) return false;
    const to = (((hour % 24) + 24) % 24);
    this.lapse = { from, hours, to, t: 0, dur: lapseSeconds(hours) };
    const p = this.ctx.player;
    if (p) {
      p.controlLock = Math.max(p.controlLock, this.lapse.dur + 0.2);
      if (p.body) p.body.move.set(0, 0, 0);
    }
    this.showOverlay();
    return true;
  }

  update(dt: number): void {
    const L = this.lapse;
    if (!L) return;
    L.t += dt;
    const k = Math.min(1, L.t / L.dur);
    const e = k * k * (3 - 2 * k);
    const sky = this.ctx.world.sky;
    sky.timeOfDay = (L.from + L.hours * e) % 24;
    if (this.clockEl) this.clockEl.textContent = formatClock(sky.timeOfDay);
    if (k >= 1) {
      sky.timeOfDay = L.to;
      this.lapse = null;
      const p = this.ctx.player;
      if (p) p.controlLock = 0;
      this.hideOverlay();
      this.ctx.events.emit('time:skipped', { from: L.from, to: L.to, hours: L.hours });
      this.ctx.ui.showBanner(partOfDay(L.to), `${formatClock(L.to)} · ${formatSpan(L.hours)} passed`);
    }
  }

  onSessionEnd(): void {
    this.lapse = null;
    this.hideOverlay();
  }

  private showOverlay(): void {
    this.hideOverlay();
    const L = this.lapse!;
    this.clockEl = h('div.ts-clock', formatClock(L.from));
    this.subEl = h('div.ts-sub', `Time passes… until ${formatClock(L.to)}`);
    this.overlay = h('div.ts-overlay', h('div.ts-box', this.clockEl, this.subEl));
    this.ctx.ui.layers.overlay.appendChild(this.overlay);
    requestAnimationFrame(() => this.overlay?.classList.add('on'));
  }

  private hideOverlay(): void {
    const el = this.overlay;
    this.overlay = null;
    this.clockEl = null;
    this.subEl = null;
    if (!el) return;
    el.classList.remove('on');
    setTimeout(() => el.remove(), 450);
  }
}

const CSS = `
.ts-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity .4s ease;
  background:radial-gradient(ellipse at center,rgba(8,10,18,0) 30%,rgba(8,10,18,.55) 100%);z-index:30}
.ts-overlay.on{opacity:1}
.ts-box{text-align:center;color:#f2ead6;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.ts-clock{font:600 64px var(--font-display,'Cinzel',serif);letter-spacing:.06em}
.ts-sub{font:16px var(--font-body,sans-serif);opacity:.85;margin-top:4px}
#ui.touch-on .ts-clock{font-size:48px}
`;

let injected = false;
function injectCSS(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.module = 'timeskip';
  s.textContent = CSS;
  document.head.appendChild(s);
}
