import type { GameContext } from '../../core/GameContext';
import { ACTION_LABELS, codeLabel, type Action } from '../../core/Input';
import type { QualityPreset } from '../../core/Settings';
import { clear, h } from '../dom';
import type { Screen, UIManager } from '../UIManager';
import { fullscreen } from '../../core/Device';
import { fullscreenButton, gamepadNav } from './MainMenu';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay';
type Device = 'kbm' | 'pad';

const TABS: Array<[Tab, string]> = [
  ['graphics', 'Graphics'],
  ['audio', 'Audio'],
  ['controls', 'Controls'],
  ['gameplay', 'Gameplay & UI'],
];

/** Interface settings that live outside any one screen (UI scale). Installed once by UIManager. */
export function installInterfaceSettings(ctx: GameContext): void {
  const apply = () => {
    const s = Math.max(0.6, Math.min(1.6, ctx.settings.data.gameplay.hudScale || 1));
    ctx.ui.root.style.setProperty('--ui-scale', String(s));
  };
  apply();
  ctx.events.on('settings:changed', apply);
}

const isPad = (c: string) => c.startsWith('Pad');

export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private box: HTMLElement;
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  private ctx!: GameContext;
  private tab: Tab = 'graphics';
  private listening: { action: Action; device: Device } | null = null;
  /** Key that ended a capture: swallowed so UIManager does not also act on it (Escape would close the screen). */
  private swallow: string | null = null;
  private hint: HTMLElement;

  constructor(private readonly ui: UIManager) {
    this.tabsEl = h('div.tabs', { role: 'tablist' });
    this.body = h('div.scroll.settings-body');
    this.hint = h('div.settings-hint.muted');
    this.box = h(
      'div.modal.panel.settings-panel',
      h('div.modal-header', h('h2.title', 'Settings'), h('div.spacer'), h('button.btn.small', { onclick: () => this.ui.close(), 'data-action': 'close-settings' }, 'Close')),
      this.tabsEl,
      this.body,
      this.hint,
    );
    this.el = h('div.modal-backdrop', this.box);
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.render();
    this.installDebug();
  }

  onClose(): void {
    this.stopListening();
  }

  update(): void {
    if (this.ui.currentScreen === this.id && !this.listening) gamepadNav(this.box, () => this.ui.close());
  }

  private render(): void {
    clear(this.tabsEl);
    for (const [id, label] of TABS) {
      this.tabsEl.append(h(`button.tab${this.tab === id ? '.active' : ''}`, { role: 'tab', 'data-tab': id, onclick: () => { this.stopListening(); this.tab = id; this.render(); } }, label));
    }
    const top = this.body.scrollTop;
    clear(this.body);
    if (this.tab === 'graphics') this.renderGraphics();
    else if (this.tab === 'audio') this.renderAudio();
    else if (this.tab === 'controls') this.renderControls();
    else this.renderGameplay();
    this.body.scrollTop = top;
    this.hint.textContent = this.listening
      ? this.listening.device === 'pad'
        ? 'Press a gamepad button… (Esc cancels, Backspace clears)'
        : 'Press a key or mouse button… (Esc cancels, Backspace clears)'
      : 'Changes apply immediately and are saved in this browser.';
  }

  private grid(title?: string): HTMLElement {
    if (title) this.body.append(h('h3.settings-section', title));
    const g = h('div.settings-grid');
    this.body.append(g);
    return g;
  }

  private get(path: string): unknown {
    const [a, b] = path.split('.');
    return (this.ctx.settings.data as unknown as Record<string, Record<string, unknown>>)[a][b];
  }

  private label(label: string, desc: string): HTMLElement {
    return h('label', label, desc ? h('div.muted.setting-desc', desc) : null);
  }

  private rowSlider(g: HTMLElement, label: string, path: string, min: number, max: number, step: number, fmt: (v: number) => string, desc = ''): void {
    const s = this.ctx.settings;
    const val = this.get(path) as number;
    const out = h('span.setting-val', fmt(val));
    g.append(
      this.label(label, desc),
      h('input', {
        type: 'range',
        min,
        max,
        step,
        value: val,
        'data-setting': path,
        'aria-label': label,
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          out.textContent = fmt(v);
          s.set(path, v);
        },
        onchange: () => this.render(),
      }),
      out,
    );
  }

  private rowToggle(g: HTMLElement, label: string, path: string, desc = '', disabled = false): void {
    const s = this.ctx.settings;
    const val = !!this.get(path);
    g.append(
      this.label(label, desc),
      h(`button.toggle${val ? '.on' : ''}`, {
        role: 'switch',
        'aria-checked': String(val),
        'aria-label': label,
        'data-setting': path,
        disabled,
        onclick: () => {
          s.set(path, !val);
          this.render();
        },
      }),
      h('span.setting-val', val ? 'On' : 'Off'),
    );
  }

  private rowSelect(g: HTMLElement, label: string, path: string, options: Array<[string, string]>, desc = ''): void {
    const s = this.ctx.settings;
    const val = String(this.get(path));
    g.append(
      this.label(label, desc),
      h(
        'select',
        {
          'data-setting': path,
          'aria-label': label,
          onchange: (e: Event) => {
            s.set(path, (e.target as HTMLSelectElement).value);
            this.render();
          },
        },
        options.map(([v, l]) => h('option', { value: v, selected: v === val }, l)),
      ),
      h('span'),
    );
  }

  private renderGraphics(): void {
    const s = this.ctx.settings;
    const g0 = s.data.graphics;
    const presets = h('div.preset-row', h('span.preset-label', 'Quality preset'));
    for (const p of ['low', 'medium', 'high', 'ultra'] as const) {
      presets.append(h(`button.btn.small${g0.preset === p ? '.primary' : ''}`, { 'data-preset': p, 'aria-pressed': String(g0.preset === p), onclick: () => { s.applyPreset(p); this.render(); } }, p[0].toUpperCase() + p.slice(1)));
    }
    if ((g0.preset as QualityPreset) === 'custom') presets.append(h('span.chip.active', 'Custom'));
    this.body.append(presets);
    const r = this.ctx.render;
    if (s.device.mobile) this.body.append(h('div.muted.settings-note', s.mobileDefaultsApplied ? 'Phone / tablet detected: mobile-friendly defaults were applied on first launch (Low, 70 % render scale, shorter draw distance).' : 'Phone / tablet detected: Low or Medium keeps the game smooth and the battery cool.'));
    this.body.append(h('div.muted.settings-note', `Rendering at ${Math.round(r.viewportWidth * r.pixelRatio)}×${Math.round(r.viewportHeight * r.pixelRatio)} · shadows ${g0.shadows === 'off' ? 'off' : g0.shadows} · ${g0.postProcessing ? 'post-processing on' : 'no post-processing'}`));
    let g = this.grid('Resolution & lighting');
    this.rowSlider(g, 'Render scale', 'graphics.renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`, 'Internal resolution');
    this.rowSlider(g, 'Max pixel ratio', 'graphics.maxPixelRatio', 1, 2, 0.25, (v) => `${v}×`, 'Sharpness on high-DPI screens');
    this.rowSelect(g, 'Shadows', 'graphics.shadows', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    this.rowToggle(g, 'Post-processing', 'graphics.postProcessing', 'Tone mapping pass, bloom, MSAA');
    this.rowToggle(g, 'Bloom glow', 'graphics.bloom', g0.postProcessing ? 'Glow around fire, lightning and spirit light' : 'Needs post-processing', !g0.postProcessing);
    this.rowToggle(g, 'Anti-aliasing', 'graphics.antialias');
    this.rowToggle(g, 'Dynamic lights', 'graphics.dynamicLights', 'Fire and flashes light the world');
    g = this.grid('World detail');
    this.rowSlider(g, 'Draw distance', 'graphics.drawDistance', 300, 1800, 50, (v) => `${v} m`);
    this.rowSlider(g, 'Detail falloff', 'graphics.lodBias', 0, 1, 0.05, (v) => (v < 0.2 ? 'Sharp' : v < 0.5 ? 'Balanced' : 'Fast'), 'Terrain level-of-detail bias');
    this.rowSlider(g, 'Grass density', 'graphics.grassDensity', 0, 1.5, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
    this.rowSlider(g, 'Foliage & props', 'graphics.foliageDensity', 0.3, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    g = this.grid('Effects');
    this.rowSelect(g, 'Bending effects', 'graphics.effectsQuality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    this.rowSlider(g, 'Particle density', 'graphics.particleDensity', 0.2, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowToggle(g, 'Ambient effects', 'graphics.ambientEffects', 'Clouds, weather particles, footprints');
    this.rowToggle(g, 'Show FPS', 'graphics.showFps');
  }

  private renderAudio(): void {
    const g = this.grid('Volume');
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.rowSlider(g, 'Master volume', 'audio.master', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Music', 'audio.music', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Sound effects', 'audio.sfx', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Ambience', 'audio.ambient', 0, 1, 0.05, pct);
    this.rowToggle(g, 'Mute all', 'audio.muted');
  }

  private renderControls(): void {
    const s = this.ctx.settings;
    let g = this.grid('Camera & aiming');
    this.rowSlider(g, 'Mouse sensitivity', 'controls.mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    this.rowToggle(g, 'Invert vertical look', 'controls.invertY');
    this.rowSlider(g, 'Field of view', 'controls.fov', 50, 90, 1, (v) => `${v}°`);
    this.rowSlider(g, 'Camera shake', 'controls.cameraShake', 0, 1, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
    this.rowSlider(g, 'Camera distance', 'controls.cameraDistance', 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowToggle(g, 'Aim assist', 'controls.autoTarget', 'Snap techniques toward enemies near the crosshair');
    g = this.grid('Touch controls');
    this.rowSelect(g, 'On-screen controls', 'controls.touchControls', [['auto', 'Automatic'], ['on', 'Always'], ['off', 'Never']], 'Automatic shows them on phones, tablets and after a touch');
    this.rowSlider(g, 'Look sensitivity', 'controls.touchSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2), 'Drag-to-look speed');
    this.rowSlider(g, 'Button size', 'controls.touchButtonSize', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`, 'Never smaller than a fingertip (44 px)');
    this.rowSlider(g, 'Button opacity', 'controls.touchOpacity', 0.3, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowToggle(g, 'Left-handed layout', 'controls.touchLeftHanded', 'Move stick on the right, actions on the left');
    this.body.append(
      h(
        'div.bind-head',
        h('h3.settings-section', 'Controls'),
        h('div.spacer'),
        h('button.btn.small', { 'data-action': 'reset-bindings', onclick: () => this.ui.confirm('Reset every key and button binding to the defaults?', [{ text: 'Reset', danger: true, onClick: () => { s.resetBindings(); this.render(); } }, { text: 'Cancel', primary: true }]) }, 'Reset to defaults'),
      ),
    );
    const bg = h('div.bind-grid', h('span.bind-col', 'Action'), h('span.bind-col', 'Keyboard & mouse'), h('span.bind-col', 'Gamepad'));
    const b = s.data.controls.bindings;
    for (const action of Object.keys(ACTION_LABELS) as Action[]) {
      const codes = b[action] ?? [];
      const kb = codes.filter((c) => !isPad(c));
      const pad = codes.find(isPad) ?? '';
      const cell = (device: Device, main: string, extra: string[]) => {
        const on = this.listening?.action === action && this.listening.device === device;
        return h(
          'div.bind-cell',
          h(`button.btn.small.binding${on ? '.listening' : ''}${main ? '' : '.unbound'}`, { 'data-bind': action, 'data-device': device, 'aria-label': `${ACTION_LABELS[action]} (${device === 'pad' ? 'gamepad' : 'keyboard and mouse'})`, onclick: () => this.listen(action, device) }, on ? 'Press…' : main ? codeLabel(main) : '—'),
          extra.length ? h('span.bind-alt', extra.map(codeLabel).join(' · ')) : null,
        );
      };
      bg.append(h('span.bind-name', ACTION_LABELS[action]), cell('kbm', kb[0] ?? '', kb.slice(1)), cell('pad', pad, []));
    }
    this.body.append(bg);
  }

  private renderGameplay(): void {
    let g = this.grid('Gameplay');
    this.rowSelect(g, 'Difficulty', 'gameplay.difficulty', [['story', 'Story'], ['balanced', 'Balanced'], ['challenging', 'Challenging']]);
    this.rowToggle(g, 'Tutorial hints', 'gameplay.tutorialHints');
    g = this.grid('Interface');
    this.rowSlider(g, 'UI scale', 'gameplay.hudScale', 0.75, 1.3, 0.05, (v) => `${Math.round(v * 100)}%`, 'Size of the HUD: vitals, techniques, quest tracker, compass');
    this.rowToggle(g, 'Damage numbers', 'gameplay.damageNumbers');
    this.rowToggle(g, 'Compass', 'gameplay.compass');
    if (fullscreen.supported) g.append(this.label('Fullscreen', this.ctx.settings.device.mobile ? 'Also locks landscape on phones and tablets' : ''), fullscreenButton('btn.small', () => this.ctx), h('span'));
    this.body.append(
      h('div.divider'),
      h('button.btn.small.danger', { 'data-action': 'reset-all', onclick: () => this.ui.confirm('Reset every setting to its default?', [{ text: 'Reset', danger: true, onClick: () => { this.ctx.settings.resetAll(); this.render(); } }, { text: 'Cancel', primary: true }]) }, 'Reset all settings'),
    );
  }

  // ---------------------------------------------------------------------------
  // Rebinding
  // ---------------------------------------------------------------------------

  private onMouse = (e: MouseEvent): void => {
    if (!this.listening || this.listening.device !== 'kbm') return;
    e.preventDefault();
    e.stopPropagation();
    this.captured('Mouse' + e.button);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.listening || this.listening.device !== 'kbm') return;
    e.preventDefault();
    this.captured(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  };

  private listen(action: Action, device: Device): void {
    this.stopListening();
    this.listening = { action, device };
    this.render();
    // Keys and gamepad buttons come through Input; mouse buttons / wheel are caught here (the panel sits above the canvas).
    this.ctx.input.captureNextCode((code) => this.captured(code));
    if (device === 'kbm') {
      // Attached synchronously: the click that started listening has already had its mousedown,
      // and a deferred attach could miss the very next press (input outranks timers).
      window.addEventListener('mousedown', this.onMouse, true);
      window.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    }
  }

  private stopListening(): void {
    this.listening = null;
    this.ctx?.input.captureNextCode(null);
    window.removeEventListener('mousedown', this.onMouse, true);
    window.removeEventListener('wheel', this.onWheel, true);
  }

  private captured(code: string): void {
    const l = this.listening;
    if (!l) return;
    this.stopListening();
    if (!code.startsWith('Mouse') && !code.startsWith('Wheel') && !isPad(code)) this.swallow = code;
    const s = this.ctx.settings;
    if (code === 'Escape' && !(l.action === 'pause' && l.device === 'kbm')) {
      this.render();
      return;
    }
    if (code === 'Backspace' || code === 'Delete') {
      s.setBinding(l.action, s.data.controls.bindings[l.action].filter((c) => (l.device === 'pad' ? !isPad(c) : isPad(c))));
      this.render();
      return;
    }
    if ((l.device === 'pad') !== isPad(code)) {
      // Wrong device for this column: keep waiting.
      this.listen(l.action, l.device);
      return;
    }
    const other = (Object.keys(s.data.controls.bindings) as Action[]).find((a) => a !== l.action && s.data.controls.bindings[a].includes(code));
    if (other) {
      this.render();
      this.ui.confirm(`${codeLabel(code)} is already used for “${ACTION_LABELS[other]}”. Use it for “${ACTION_LABELS[l.action]}” instead? “${ACTION_LABELS[other]}” loses this binding.`, [
        { text: 'Reassign', primary: true, onClick: () => this.assign(l.action, l.device, code, other) },
        { text: 'Cancel' },
      ]);
      return;
    }
    this.assign(l.action, l.device, code, null);
  }

  private assign(action: Action, device: Device, code: string, takeFrom: Action | null): void {
    const s = this.ctx.settings;
    const b = s.data.controls.bindings;
    if (takeFrom) s.setBinding(takeFrom, b[takeFrom].filter((c) => c !== code));
    const cur = b[action].filter((c) => c !== code);
    const kb = cur.filter((c) => !isPad(c));
    const pads = cur.filter(isPad);
    if (device === 'pad') pads.splice(0, pads.length, code);
    else kb.splice(0, 1, code);
    s.setBinding(action, [...kb.slice(0, device === 'pad' ? 2 : 3 - Math.min(1, pads.length)), ...pads.slice(0, 1)]);
    this.render();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.swallow && e.code === this.swallow) {
      this.swallow = null;
      return true;
    }
    this.swallow = null;
    return !!this.listening;
  }

  /** Test hooks: window.__game.debug.settings */
  private installDebug(): void {
    const api = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!api) return;
    api.debug = api.debug ?? {};
    api.debug.settings = {
      listening: () => this.listening,
      /** Feed a physical code to the open capture (e.g. 'Pad4' without a real gamepad). */
      feed: (code: string) => this.captured(code),
      tab: (t: Tab) => {
        this.tab = t;
        this.render();
      },
    };
  }
}
