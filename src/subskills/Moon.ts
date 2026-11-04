import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import { MOON, MOON_PHASES } from '../data/subskills';
import { h } from '../ui/dom';

/**
 * Lunar cycle tied to the game clock (world.sky.timeOfDay): a day counter, 8 phases, one
 * full-moon night every MOON.cycleNights nights. The moon is up from moonrise to sunrise; a night
 * belongs to the evening it began (before noon you are still in last night).
 *
 * Waterbending peaks under the moon: +10% power while it is up, +25% on the full-moon night
 * (a CombatSystem power modifier, for every waterbender). Shows the phase on the sky's moon disc
 * and a small moon-and-clock chip on the HUD; a hint when a full moon rises. Persistent (saveKey
 * 'moon'): the day count and the phase offset (debug "set the moon phase").
 */
export class MoonSystem implements GameSystem, Persistable {
  readonly saveKey = 'moon';
  /** Whole days since the journey began. */
  day = 0;
  /** Phase offset in nights (debug / tests). */
  offset = 0;
  private lastHour = -1;
  private ctx!: GameContext;
  private chip: HTMLElement | null = null;
  private chipIcon: HTMLElement | null = null;
  private chipText: HTMLElement | null = null;
  private chipT = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.combat.powerMods.push((_c, def) => (def.element === 'water' ? this.waterBoost() : 1));
    this.buildChip();
  }

  // ---------------------------------------------------------------------------
  // Clock & phase
  // ---------------------------------------------------------------------------

  get hour(): number {
    return this.ctx?.world?.sky?.timeOfDay ?? 12;
  }

  /** The night in progress (or the coming one, by day): before noon it is still last night. */
  nightIndex(hour = this.hour): number {
    return hour >= 12 ? this.day : this.day - 1;
  }

  /** Position in the cycle, 0 .. cycleNights-1; cycleNights/2 is the full moon. */
  cyclePos(night = this.nightIndex()): number {
    const n = MOON.cycleNights;
    return (((night - MOON.firstFullNight + Math.floor(n / 2) + this.offset) % n) + n) % n;
  }

  /** 0 new, 1 waxing crescent, ... 4 full ... 7 waning crescent. */
  phaseIndex(night = this.nightIndex()): number {
    const n = MOON.cycleNights;
    const q = this.cyclePos(night);
    if (q === Math.floor(n / 2)) return 4;
    let i = Math.floor((q * 8) / n + 0.5) % 8;
    if (i === 4) i = q < n / 2 ? 3 : 5;
    return i;
  }

  phaseName(night = this.nightIndex()): string {
    return MOON_PHASES[this.phaseIndex(night)];
  }

  /** 0 new .. 0.5 full .. 1 (for the sky disc). */
  phaseFraction(night = this.nightIndex()): number {
    return this.cyclePos(night) / MOON.cycleNights;
  }

  /** Tonight (or last night, before noon) is the full-moon night. */
  get isFullMoonNight(): boolean {
    return this.phaseIndex() === 4;
  }

  get moonUp(): boolean {
    const hr = this.hour;
    return hr >= MOON.moonriseHour || hr < MOON.sunriseHour;
  }

  /** The full moon is in the sky right now (bloodbending's window). */
  get fullMoonUp(): boolean {
    return this.moonUp && this.isFullMoonNight;
  }

  /** Nights until the next full moon (0 = tonight). */
  nightsToFull(): number {
    const n = MOON.cycleNights;
    return (((Math.floor(n / 2) - this.cyclePos()) % n) + n) % n;
  }

  /** Waterbending power multiplier from the moon. */
  waterBoost(): number {
    if (!this.ctx?.session?.active || !this.moonUp) return 1;
    if (this.isFullMoonNight) return MOON.boostFullMoon;
    return this.phaseIndex() === 0 ? 1 : MOON.boostMoonUp;
  }

  /** Day of the year and whether it is a solstice (spirits draw near). */
  get isSolstice(): boolean {
    const d = ((this.day % MOON.yearDays) + MOON.yearDays) % MOON.yearDays;
    return MOON.solsticeDays.includes(d);
  }

  /** Debug/tests: make the current night have phase `i` (0-7; 4 = full). */
  setPhase(i: number): void {
    const n = MOON.cycleNights;
    const want = Math.round((((i % 8) + 8) % 8) * n / 8) % n;
    this.offset = 0;
    const base = this.cyclePos();
    this.offset = (((want - base) % n) + n) % n;
    this.syncSky();
  }

  // ---------------------------------------------------------------------------

  /** Did the clock pass hour `h` going forward from a to b (less than a day)? */
  private static crossed(a: number, b: number, hr: number): boolean {
    if (a < 0) return false;
    return b >= a ? a < hr && hr <= b : hr > a || hr <= b;
  }

  update(dt: number, ctx: GameContext): void {
    const hr = this.hour;
    const last = this.lastHour;
    if (last >= 0 && hr < last - 12) this.day++;
    if (MoonSystem.crossed(last, hr, MOON.sunriseHour)) ctx.events.emit('moon:sunrise', { night: this.nightIndex(hr) });
    if (MoonSystem.crossed(last, hr, MOON.moonriseHour)) {
      const full = this.isFullMoonNight;
      ctx.events.emit('moon:rise', { phase: this.phaseIndex(), full, night: this.nightIndex() });
      if (full && ctx.session.kind === 'campaign') ctx.events.emit('ui:notify', { text: 'The moon is full.', kind: 'info', icon: '🌕', duration: 5 });
    }
    this.lastHour = hr;
    this.syncSky();
    this.chipT -= dt;
    if (this.chipT <= 0) {
      this.chipT = 0.5;
      this.updateChip();
    }
  }

  private syncSky(): void {
    const sky = this.ctx?.world?.sky;
    if (sky) sky.moonPhase = this.phaseFraction();
  }

  // ---------------------------------------------------------------------------
  // HUD chip: moon phase + clock
  // ---------------------------------------------------------------------------

  private buildChip(): void {
    if (typeof document === 'undefined' || !this.ctx.ui?.layers) return;
    injectCSS();
    this.chipIcon = h('span.moon-ic');
    this.chipText = h('span.moon-tx');
    this.chip = h('div.moon-chip.hidden', { title: 'Moon and time of day' }, this.chipIcon, this.chipText);
    this.ctx.ui.layers.hud.appendChild(this.chip);
  }

  private updateChip(): void {
    const el = this.chip;
    if (!el) return;
    const show = this.ctx.session.active && this.ctx.session.kind === 'campaign';
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const hr = this.hour;
    const hh = Math.floor(hr);
    const mm = Math.floor((hr - hh) * 60);
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const f = this.phaseFraction();
    // A shadow disc slides off the lit one (waxing: lit on the right).
    const lit = 0.5 - 0.5 * Math.cos(f * Math.PI * 2);
    this.chipIcon!.style.setProperty('--moon-x', `${(f < 0.5 ? -1 : 1) * lit * 100}%`);
    const up = this.moonUp;
    this.chipText!.textContent = `${time} · ${this.phaseName()}${this.isFullMoonNight && up ? ' ✦' : ''}`;
    el.classList.toggle('up', up);
    el.classList.toggle('full', this.isFullMoonNight && up);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    return { v: 1, day: this.day, offset: this.offset };
  }

  deserialize(data: unknown): void {
    const d = data as { day?: unknown; offset?: unknown } | undefined;
    if (d && typeof d.day === 'number' && Number.isFinite(d.day)) this.day = Math.max(0, Math.floor(d.day));
    if (d && typeof d.offset === 'number' && Number.isFinite(d.offset)) this.offset = Math.floor(d.offset);
    this.lastHour = -1;
  }

  reset(): void {
    this.day = 0;
    this.offset = 0;
    this.lastHour = -1;
  }
}

const CSS = `
.moon-chip{position:absolute;top:10px;right:14px;display:flex;align-items:center;gap:6px;padding:3px 9px 3px 5px;border-radius:12px;
  background:rgba(10,14,22,.55);border:1px solid rgba(255,255,255,.12);color:#e9e4d4;font:12px var(--font-body,sans-serif);pointer-events:none;z-index:4}
.moon-chip.hidden{display:none}
.moon-chip .moon-ic{position:relative;width:15px;height:15px;border-radius:50%;background:#f3f0e2;overflow:hidden;box-shadow:0 0 4px rgba(255,255,240,.35)}
.moon-chip .moon-ic::after{content:'';position:absolute;inset:0;border-radius:50%;background:#1b2130;transform:translateX(var(--moon-x,0%))}
.moon-chip:not(.up){opacity:.7}
.moon-chip.full{border-color:rgba(200,225,255,.55);box-shadow:0 0 10px rgba(190,215,255,.35)}
.moon-chip.full .moon-ic{box-shadow:0 0 9px rgba(225,238,255,.9)}
#ui.touch-on .moon-chip{top:calc(6px + env(safe-area-inset-top,0px));right:auto;left:50%;transform:translateX(-50%);font-size:11px}
`;

let injected = false;
function injectCSS(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.module = 'moon';
  s.textContent = CSS;
  document.head.appendChild(s);
}
