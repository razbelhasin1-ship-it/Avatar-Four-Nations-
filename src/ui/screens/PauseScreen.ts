import type { GameContext } from '../../core/GameContext';
import { ACTION_LABELS, type Action } from '../../core/Input';
import { ELEMENT_INFO } from '../../core/types';
import { clear, h } from '../dom';
import { emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';
import { focusables, guardGhostClicks, moveFocus, pollPad, type Dir } from './gsBase';
import { fullscreenButton } from './MainMenu';

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
  private view: 'main' | 'controls' = 'main';

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

  private renderControls(): void {
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
    if (this.view === 'controls') this.renderMain();
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
    if (p.dir) moveFocus(scope, p.dir);
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
