import type { GameContext } from '../../core/GameContext';
import { ACTION_LABELS, type Action } from '../../core/Input';
import { ELEMENT_INFO } from '../../core/types';
import { clear, h } from '../dom';
import { emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';
import { focusables, guardGhostClicks, moveFocus, pollPad, type Dir } from './gsBase';
import { fullscreenButton } from './MainMenu';
import { formatClock, formatSpan, hoursUntil, isNightHour, partOfDay, SUNRISE_HOUR, TIME_PRESETS, type TimeSkipSystem } from '../../world/TimeSkip';

const SHORTCUTS: Array<[string, Action, string, string]> = [
  ['map', 'map', 'World Map', '🗺'],
  ['journal', 'journal', 'Journal', '📜'],
  ['techniques', 'techniques', 'Techniques', '✦'],
  ['inventory', 'inventory', 'Inventory', '🎒'],
  ['character', 'character', 'Character', '👘'],
  ['companions', 'companions', 'Companions', '🐾'],
];

/** Pause menu: resume, save/load, settings, controls, shortcuts to every journal screen, exit with save prompt. */
export class PauseScreen implements Screen {
  readonly id = 'pause';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private box: HTMLElement;
  private ctx!: GameContext;
  private view: 'main' | 'controls' | 'time' = 'main';
  /** The Pass Time view's slider (left/right adjusts it instead of moving focus). */
  private slider: HTMLInputElement | null = null;

  constructor(private readonly ui: UIManager) {
    this.box = h('div.ps-menu.panel', { role: 'dialog', 'aria-label': 'Paused' });
    this.el = h('div.modal-backdrop.ps-backdrop', this.box);
    this.disarm = guardGhostClicks(this.el);
  }

  private disarm: () => void;

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.disarm();
    this.renderMain();
  }

  private renderMain(): void {
    const ctx = this.ctx;
    this.view = 'main';
    this.slider = null;
    const tutorial = ctx.session.kind === 'tutorial';
    clear(this.box);
    const b = (label: string, fn: () => void, cls = '', action?: string, sub?: string) =>
      h(`button.btn.ps-btn${cls}`, { type: 'button', onclick: () => (ctx.audio.play('ui_click', { bus: 'ui' }), fn()), 'data-action': action }, h('span', label), sub ? h('span.ps-sub', sub) : null);
    const p = ctx.player;
    const reg = p ? ctx.world.regionAt(p.position.x, p.position.z) : null;
    const tracked = ctx.quests.objectiveText();
    const main = h(
      'div.ps-col',
      b('Resume', () => ctx.game.setPaused(false), '.primary', 'resume'),
      tutorial ? null : b('Save Journey', () => this.ui.open('saveload', { mode: 'save' }), '', 'save'),
      tutorial ? null : b('Load Journey', () => this.ui.open('saveload', { mode: 'load' }), '', 'load'),
      tutorial ? null : b('Pass Time', () => this.renderTime(), '', 'time', `${isNightHour(ctx.world.sky.timeOfDay) ? '☾' : '☀'} ${formatClock(ctx.world.sky.timeOfDay)} · ${partOfDay(ctx.world.sky.timeOfDay)}`),
      b('Settings', () => this.ui.open('settings'), '', 'settings'),
      b('Controls', () => this.renderControls(), '', 'controls'),
      fullscreenButton('btn.ps-btn', () => this.ctx), // [front end] hidden where the Fullscreen API is missing
      h('div.divider'),
      b(tutorial ? 'Leave Tutorial' : 'Exit to Main Menu', () => this.exit(), '.danger', 'exit'),
    );
    const tiles = h('div.ps-tiles', { role: 'group', 'aria-label': 'Journal shortcuts' });
    for (const [screen, action, label, icon] of SHORTCUTS) {
      tiles.append(h('button.ps-tile', { type: 'button', 'data-open': screen, onclick: () => (ctx.audio.play('ui_click', { bus: 'ui' }), this.ui.open(screen)) }, h('span.ps-tile-icon', icon), h('span.ps-tile-label', label), h('span.kbd', ctx.input.label(action))));
    }
    this.box.append(
      h('div.ps-head', p ? emblem(p.element, 'emblem ps-emblem') : null, h('div', h('h2.title', 'Paused'), h('div.ps-meta', p ? `${p.characterName} · Level ${ctx.progression.level} · ${ELEMENT_INFO[p.element].name}` : '', reg ? ` · ${reg.name}` : ''))),
      h('div.ps-grid', main, h('div.ps-col', h('div.ps-label', 'Journal'), tiles, tracked ? h('div.ps-quest', h('div.ps-label', 'Tracked quest'), h('b', tracked.title), ...tracked.lines.filter((l) => !l.done).slice(0, 2).map((l) => h('div.muted', `◇ ${l.text}${l.progress ? ` (${l.progress})` : ''}`))) : null)),
    );
    requestAnimationFrame(() => (this.box.querySelector('[data-action="resume"]') as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  /**
   * Pass Time: the day as a dial (night, dawn, day, dusk; the sun or moon where the clock stands
   * now, a knob at the hour to wait for), a slider and quick choices, Skip the Night after dark.
   * Waiting closes the menu and plays the time-lapse (world/TimeSkip).
   */
  private renderTime(): void {
    const ctx = this.ctx;
    const ts = ctx.extra.get('timeskip') as TimeSkipSystem | undefined;
    if (!ts) return;
    clear(this.box);
    this.view = 'time';
    const now = ctx.world.sky.timeOfDay;
    const snap = (x: number) => (Math.round(x * 4) / 4) % 24;
    let target = isNightHour(now) ? SUNRISE_HOUR : snap(now + 3);
    const block = ts.blockReason();
    const dial = h('div.ts-dial', { role: 'img' });
    const nowLine = h('div.ts-now');
    const waitLine = h('div.ts-wait');
    const slider = h('input.ts-slider', { type: 'range', min: '0', max: '23.75', step: '0.25', 'aria-label': 'Wait until', 'data-action': 'slider' }) as HTMLInputElement;
    this.slider = slider;
    const confirm = h('button.btn.primary.ps-btn', { type: 'button', 'data-action': 'wait', onclick: () => go(target) }) as HTMLButtonElement;
    const refresh = () => {
      const span = hoursUntil(now, target);
      dial.innerHTML = dialSvg(now, target);
      dial.setAttribute('aria-label', `Now ${formatClock(now)}, waiting until ${formatClock(target)}`);
      nowLine.textContent = `Now ${formatClock(now)} · ${partOfDay(now)}`;
      waitLine.textContent = span < 1 / 60 ? 'Pick a later hour' : `Until ${formatClock(target)} · ${partOfDay(target)} — ${formatSpan(span)}`;
      confirm.textContent = `Wait until ${formatClock(target)}`;
      confirm.disabled = !!block || span < 1 / 60;
      slider.value = String(target);
    };
    const setTarget = (x: number) => {
      target = ((snap(x) % 24) + 24) % 24;
      refresh();
    };
    slider.oninput = () => setTarget(Number(slider.value));
    // Drag round the dial to pick the hour.
    const fromPointer = (e: PointerEvent) => {
      const r = dial.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (dx * dx + dy * dy < 16) return;
      // Midnight at the bottom, noon at the top, the hours running clockwise.
      const a = Math.atan2(-dx, dy);
      setTarget((((a / (Math.PI * 2)) * 24) + 24) % 24);
    };
    dial.addEventListener('pointerdown', (e) => {
      dial.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    dial.addEventListener('pointermove', (e) => {
      if (dial.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    const go = (hour: number) => {
      if (ts.skipTo(hour)) ctx.game.setPaused(false);
      else ctx.events.emit('ui:notify', { text: ts.blockReason() ?? 'Pick a later hour.', kind: 'warning' });
    };
    const presets = h(
      'div.ts-presets',
      TIME_PRESETS.map((p) => h('button.btn.small.ts-preset', { type: 'button', 'data-hour': String(p.hour), onclick: () => setTarget(p.hour) }, h('b', p.label), ' ', formatClock(p.hour))),
    );
    const night = isNightHour(now);
    const skipNight = night ? h('button.btn.primary.ps-btn', { type: 'button', 'data-action': 'skip-night', disabled: block ? true : undefined, onclick: () => go(SUNRISE_HOUR) }, h('span', 'Skip the Night'), h('span.ps-sub', `Wake at ${formatClock(SUNRISE_HOUR)}`)) : null;
    const parts: Array<HTMLElement | null> = [
      h('h2.title', 'Pass Time'),
      h('div.ts-panel', dial, h('div.ts-info', nowLine, waitLine, slider, presets)),
      block ? h('p.ts-block', block) : null,
      h('div.ts-actions', skipNight, confirm, h('button.btn.ps-btn', { type: 'button', 'data-action': 'back', onclick: () => this.renderMain() }, 'Back')),
    ];
    this.box.append(...parts.filter((x): x is HTMLElement => !!x));
    refresh();
    requestAnimationFrame(() => ((skipNight ?? (block ? this.box.querySelector('[data-action="back"]') : confirm)) as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  private renderControls(): void {
    this.slider = null;
    clear(this.box);
    this.view = 'controls';
    const input = this.ctx.input;
    const order: Action[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'dodge', 'attack', 'aim', 'ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'elementNext', 'drawWater', 'avatarState', 'lockOn', 'interact', 'companion', 'map', 'journal', 'techniques', 'inventory', 'companions', 'character', 'pause'];
    this.box.append(
      h('h2.title', 'Controls'),
      h('div.scroll.ps-controls', order.map((a) => h('div.ps-ctrl', h('span', ACTION_LABELS[a]), h('span.kbd', input.label(a))))),
      h('p.muted', { style: { fontSize: '13px' } }, 'Remap any control in Settings → Controls.'),
      h('button.btn', { type: 'button', 'data-action': 'back', onclick: () => this.renderMain() }, 'Back'),
    );
    requestAnimationFrame(() => (this.box.querySelector('[data-action="back"]') as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  onKey(e: KeyboardEvent): boolean {
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, Dir>)[e.key];
    // The Pass Time slider takes left/right itself.
    if (this.slider && document.activeElement === this.slider && (dir === 'left' || dir === 'right')) return false;
    if (dir) {
      e.preventDefault();
      moveFocus(this.box, dir);
      return true;
    }
    if (e.key === 'Escape') {
      // Acted on in update() with the 'pause' action (see GameScreen.update).
      this.escPending = true;
      return true;
    }
    return false;
  }

  private escPending = false;
  private wasTop = false;
  private confirmSeen = false;

  private back(): void {
    if (this.view === 'controls' || this.view === 'time') this.renderMain();
    else this.ctx.game.setPaused(false);
  }

  update(dt: number): void {
    if (this.ui.currentScreen !== this.id) {
      this.wasTop = false;
      this.escPending = false;
      return;
    }
    const input = this.ctx.input;
    const confirm = document.querySelector('.confirm') as HTMLElement | null;
    if (!this.wasTop) {
      this.wasTop = true;
      this.escPending = false;
      input.consume('pause');
    } else if (this.escPending || input.wasPressed('pause')) {
      input.consume('pause');
      this.escPending = false;
      if (!confirm && !this.confirmSeen) {
        this.back();
        return;
      }
    }
    this.confirmSeen = !!confirm;
    const p = pollPad(dt);
    if (!p) return;
    const scope = confirm ?? this.box;
    if (p.dir && this.slider && document.activeElement === this.slider && (p.dir === 'left' || p.dir === 'right')) {
      const s = this.slider;
      s.value = String((Number(s.value) + (p.dir === 'left' ? -0.25 : 0.25) + 24) % 24);
      s.dispatchEvent(new Event('input'));
    } else if (p.dir) moveFocus(scope, p.dir);
    if (p.edge(0) && document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)) document.activeElement.click();
    if (p.edge(1)) {
      if (confirm) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else this.back();
    }
    if (!scope.contains(document.activeElement)) focusables(scope)[0]?.focus({ preventScroll: true });
  }

  private exit(): void {
    const ctx = this.ctx;
    if (ctx.session.kind === 'tutorial') {
      ctx.game.exitToMenu(false);
      return;
    }
    this.ui.confirm('Return to the main menu? Unsaved progress since your last save will be lost unless you save now.', [
      { text: 'Save & Exit', primary: true, onClick: () => ctx.game.exitToMenu(true) },
      { text: 'Exit without Saving', danger: true, onClick: () => ctx.game.exitToMenu(false) },
      { text: 'Cancel' },
    ]);
    requestAnimationFrame(() => (document.querySelector('.confirm .btn.primary') as HTMLElement | null)?.focus());
  }
}

/**
 * The day as a 24-hour dial (midnight at the bottom, noon at the top, clockwise): night, dawn,
 * day and dusk bands round the rim; the span to wait drawn inside it; the sun (or moon) where
 * the clock stands now; a bright knob at the hour to wait for, read out in the middle.
 */
function dialSvg(now: number, target: number): string {
  const c = 100, R = 82, r = 64;
  const pt = (hour: number, rad: number) => {
    const a = (hour / 24) * Math.PI * 2;
    return [c - rad * Math.sin(a), c + rad * Math.cos(a)] as const;
  };
  const arc = (h1: number, h2: number, rad: number) => {
    const span = (((h2 - h1) % 24) + 24) % 24;
    const [x1, y1] = pt(h1, rad), [x2, y2] = pt(h1 + span, rad);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${rad} ${rad} 0 ${span > 12 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const bands: Array<[number, number, string]> = [
    [20.5, 5.5, '#1d2544'],
    [5.5, 7, '#d98a5a'],
    [7, 18, '#8fbbe3'],
    [18, 20.5, '#d9784e'],
  ];
  let out = `<svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">`;
  out += `<circle cx="${c}" cy="${c}" r="${R + 11}" fill="rgba(0,0,0,.28)"/>`;
  for (const [a, b, col] of bands) out += `<path d="${arc(a, b, R)}" stroke="${col}" stroke-width="14" fill="none"/>`;
  for (let i = 0; i < 24; i++) {
    const [x1, y1] = pt(i, R + 8), [x2, y2] = pt(i, R + (i % 6 === 0 ? 2 : 5));
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(242,234,214,${i % 6 === 0 ? 0.9 : 0.35})" stroke-width="${i % 6 === 0 ? 2 : 1}"/>`;
  }
  // Hour numbers inside the wait arc (which runs at radius r).
  for (const i of [0, 6, 12, 18]) {
    const [x, y] = pt(i, r - 13);
    out += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(242,234,214,.6)">${i}</text>`;
  }
  if (hoursUntil(now, target) > 1 / 60) out += `<path d="${arc(now, target, r)}" stroke="#f2d38a" stroke-width="5" stroke-linecap="round" fill="none" opacity=".9"/>`;
  const [nx, ny] = pt(now, R);
  out += isNightHour(now)
    ? `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="8" fill="#e8ecf5"/><circle cx="${(nx + 3.5).toFixed(1)}" cy="${(ny - 2.5).toFixed(1)}" r="7" fill="#1d2544"/>`
    : `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="8" fill="#ffd36b" stroke="#fff3c4" stroke-width="2"/>`;
  const [tx, ty] = pt(target, R);
  out += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="9" fill="none" stroke="#fff" stroke-width="3"/>`;
  out += `<text x="${c}" y="${c + 4}" text-anchor="middle" font-size="26" font-weight="600" fill="#f2ead6">${formatClock(target)}</text>`;
  out += `<text x="${c}" y="${c + 22}" text-anchor="middle" font-size="11" fill="rgba(242,234,214,.7)">${partOfDay(target)}</text>`;
  return out + '</svg>';
}
