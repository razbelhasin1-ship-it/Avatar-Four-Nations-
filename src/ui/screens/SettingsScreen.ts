import type { GameContext } from '../../core/GameContext';
import { ACTION_LABELS, codeLabel, type Action } from '../../core/Input';
import type { QualityPreset } from '../../core/Settings';
import { clear, h } from '../dom';
import type { Screen, UIManager } from '../UIManager';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay';

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
  private listening: Action | null = null;

  constructor(private readonly ui: UIManager) {
    this.tabsEl = h('div.tabs');
    this.body = h('div.scroll', { style: { flex: '1', minHeight: '0', marginTop: '12px', paddingRight: '8px' } });
    this.box = h('div.modal.panel', { style: { height: 'min(720px, calc(100vh - 32px))' } }, h('div.modal-header', h('h2.title', 'Settings'), h('div.spacer'), h('button.btn.small', { onclick: () => this.ui.close(), 'data-action': 'close-settings' }, 'Close')), this.tabsEl, this.body);
    this.el = h('div.modal-backdrop', this.box);
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.render();
  }

  onClose(): void {
    this.listening = null;
    this.ctx.input.captureNextCode(null);
  }

  private render(): void {
    clear(this.tabsEl);
    for (const [id, label] of [['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['gameplay', 'Gameplay']] as const) {
      this.tabsEl.append(h(`button.tab${this.tab === id ? '.active' : ''}`, { onclick: () => { this.tab = id; this.render(); } }, label));
    }
    clear(this.body);
    if (this.tab === 'graphics') this.renderGraphics();
    else if (this.tab === 'audio') this.renderAudio();
    else if (this.tab === 'controls') this.renderControls();
    else this.renderGameplay();
  }

  private grid(): HTMLElement {
    const g = h('div.settings-grid');
    this.body.append(g);
    return g;
  }

  private rowSlider(g: HTMLElement, label: string, path: string, min: number, max: number, step: number, fmt: (v: number) => string, desc = ''): void {
    const s = this.ctx.settings;
    const parts = path.split('.');
    const val = (s.data as any)[parts[0]][parts[1]] as number;
    const out = h('span.muted', fmt(val));
    g.append(
      h('label', label, desc ? h('div.muted.setting-desc', { style: { fontSize: '12px' } }, desc) : null),
      h('input', {
        type: 'range',
        min,
        max,
        step,
        value: val,
        'data-setting': path,
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

  private rowToggle(g: HTMLElement, label: string, path: string, desc = ''): void {
    const s = this.ctx.settings;
    const parts = path.split('.');
    const val = !!(s.data as any)[parts[0]][parts[1]];
    g.append(
      h('label', label, desc ? h('div.muted.setting-desc', { style: { fontSize: '12px' } }, desc) : null),
      h(`div.toggle${val ? '.on' : ''}`, {
        'data-setting': path,
        onclick: () => {
          s.set(path, !val);
          this.render();
        },
      }),
      h('span'),
    );
  }

  private rowSelect(g: HTMLElement, label: string, path: string, options: Array<[string, string]>, desc = ''): void {
    const s = this.ctx.settings;
    const parts = path.split('.');
    const val = String((s.data as any)[parts[0]][parts[1]]);
    g.append(
      h('label', label, desc ? h('div.muted.setting-desc', { style: { fontSize: '12px' } }, desc) : null),
      h(
        'select',
        {
          'data-setting': path,
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
    const presets = h('div.row', { style: { marginBottom: '14px', flexWrap: 'wrap' } }, h('span', { style: { marginRight: '8px' } }, 'Quality preset:'));
    for (const p of ['low', 'medium', 'high', 'ultra'] as const) {
      presets.append(h(`button.btn.small${s.data.graphics.preset === p ? '.primary' : ''}`, { 'data-preset': p, onclick: () => { s.applyPreset(p); this.render(); } }, p[0].toUpperCase() + p.slice(1)));
    }
    if ((s.data.graphics.preset as QualityPreset) === 'custom') presets.append(h('span.muted', '(custom)'));
    this.body.append(presets);
    const g = this.grid();
    this.rowSlider(g, 'Render scale', 'graphics.renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`, 'Internal resolution');
    this.rowSlider(g, 'Max pixel ratio', 'graphics.maxPixelRatio', 1, 2, 0.25, (v) => `${v}×`, 'Sharpness on high-DPI screens');
    this.rowSelect(g, 'Shadows', 'graphics.shadows', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    this.rowSlider(g, 'Draw distance', 'graphics.drawDistance', 300, 1800, 50, (v) => `${v} m`);
    this.rowSlider(g, 'Detail falloff', 'graphics.lodBias', 0, 1, 0.05, (v) => (v < 0.2 ? 'Sharp' : v < 0.5 ? 'Balanced' : 'Fast'), 'Terrain level-of-detail bias');
    this.rowSlider(g, 'Particle density', 'graphics.particleDensity', 0.2, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowSlider(g, 'Grass density', 'graphics.grassDensity', 0, 1.5, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
    this.rowSlider(g, 'Foliage & props', 'graphics.foliageDensity', 0.3, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowSelect(g, 'Bending effects', 'graphics.effectsQuality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    this.rowToggle(g, 'Post-processing', 'graphics.postProcessing', 'Bloom, tone mapping pass, MSAA');
    this.rowToggle(g, 'Bloom glow', 'graphics.bloom');
    this.rowToggle(g, 'Ambient effects', 'graphics.ambientEffects', 'Clouds, weather particles, footprints');
    this.rowToggle(g, 'Dynamic lights', 'graphics.dynamicLights', 'Fire and flashes light the world');
    this.rowToggle(g, 'Anti-aliasing', 'graphics.antialias');
    this.rowToggle(g, 'Show FPS', 'graphics.showFps');
  }

  private renderAudio(): void {
    const g = this.grid();
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.rowSlider(g, 'Master volume', 'audio.master', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Music', 'audio.music', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Sound effects', 'audio.sfx', 0, 1, 0.05, pct);
    this.rowSlider(g, 'Ambience', 'audio.ambient', 0, 1, 0.05, pct);
    this.rowToggle(g, 'Mute all', 'audio.muted');
  }

  private renderControls(): void {
    const s = this.ctx.settings;
    const g = this.grid();
    this.rowSlider(g, 'Mouse sensitivity', 'controls.mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    this.rowSlider(g, 'Touch sensitivity', 'controls.touchSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    this.rowToggle(g, 'Invert vertical look', 'controls.invertY');
    this.rowSlider(g, 'Camera shake', 'controls.cameraShake', 0, 1, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
    this.rowSlider(g, 'Camera distance', 'controls.cameraDistance', 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.rowSlider(g, 'Field of view', 'controls.fov', 50, 90, 1, (v) => `${v}°`);
    this.rowToggle(g, 'Aim assist', 'controls.autoTarget', 'Snap techniques toward enemies near the crosshair');
    this.rowSelect(g, 'Touch controls', 'controls.touchControls', [['auto', 'Automatic'], ['on', 'Always'], ['off', 'Never']]);
    this.body.append(h('div.divider'), h('div.row', h('h3.title', { style: { margin: '6px 0', fontSize: '16px' } }, 'Key bindings'), h('div.spacer'), h('button.btn.small', { onclick: () => { s.resetBindings(); this.render(); } }, 'Reset to defaults')));
    const bg = h('div.settings-grid');
    const b = s.data.controls.bindings;
    for (const action of Object.keys(ACTION_LABELS) as Action[]) {
      const codes = b[action] ?? [];
      const primary = codes.find((c) => !c.startsWith('Pad')) ?? '';
      const btn = h(`button.btn.small.binding${this.listening === action ? '.listening' : ''}`, {
        'data-bind': action,
        onclick: () => this.listen(action),
      }, this.listening === action ? 'Press a key…' : primary ? codeLabel(primary) : '—');
      bg.append(h('label', ACTION_LABELS[action]), btn, h('span.muted', { style: { fontSize: '12px' } }, codes.filter((c) => c !== primary).map(codeLabel).join(' · ')));
    }
    this.body.append(bg);
  }

  private listen(action: Action): void {
    this.listening = action;
    this.render();
    const s = this.ctx.settings;
    this.ctx.input.captureNextCode((code) => {
      this.listening = null;
      if (code !== 'Escape' || action === 'pause') {
        const codes = s.data.controls.bindings[action].filter((c) => c.startsWith('Pad') !== code.startsWith('Pad') && c !== code);
        // Remove the code from other actions to avoid conflicts.
        for (const a of Object.keys(s.data.controls.bindings) as Action[]) {
          if (a !== action && s.data.controls.bindings[a].includes(code)) s.setBinding(a, s.data.controls.bindings[a].filter((c) => c !== code));
        }
        s.setBinding(action, [code, ...codes]);
      }
      this.render();
    });
  }

  private renderGameplay(): void {
    const g = this.grid();
    this.rowSelect(g, 'Difficulty', 'gameplay.difficulty', [['story', 'Story'], ['balanced', 'Balanced'], ['challenging', 'Challenging']]);
    this.rowToggle(g, 'Tutorial hints', 'gameplay.tutorialHints');
    this.rowToggle(g, 'Damage numbers', 'gameplay.damageNumbers');
    this.rowToggle(g, 'Compass', 'gameplay.compass');
    this.rowSlider(g, 'HUD scale', 'gameplay.hudScale', 0.75, 1.3, 0.05, (v) => `${Math.round(v * 100)}%`);
    this.body.append(h('div.divider'), h('button.btn.small.danger', { onclick: () => this.ui.confirm('Reset every setting to its default?', [{ text: 'Reset', danger: true, onClick: () => { this.ctx.settings.resetAll(); this.render(); } }, { text: 'Cancel', primary: true }]) }, 'Reset all settings'));
  }

  onKey(e: KeyboardEvent): boolean {
    return !!this.listening && e.key !== undefined;
  }
}
