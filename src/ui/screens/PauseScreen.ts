import type { GameContext } from '../../core/GameContext';
import { ACTION_LABELS, type Action } from '../../core/Input';
import { clear, h } from '../dom';
import type { Screen, UIManager } from '../UIManager';

export class PauseScreen implements Screen {
  readonly id = 'pause';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private box: HTMLElement;
  private ctx!: GameContext;

  constructor(private readonly ui: UIManager) {
    this.box = h('div.pause-menu.panel');
    this.el = h('div.modal-backdrop', this.box);
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.renderMain();
  }

  private renderMain(): void {
    const ctx = this.ctx;
    const tutorial = ctx.session.kind === 'tutorial';
    clear(this.box);
    const b = (label: string, fn: () => void, cls = '', action?: string) => h(`button.btn${cls}`, { onclick: () => { ctx.audio.play('ui_click', { bus: 'ui' }); fn(); }, 'data-action': action }, label);
    const items: Array<HTMLElement | null> = [
      h('h2.title', 'Paused'),
      b('Resume', () => ctx.game.setPaused(false), '.primary', 'resume'),
      tutorial ? null : b('Save Journey', () => this.ui.open('saveload', { mode: 'save' }), '', 'save'),
      tutorial ? null : b('Load Journey', () => this.ui.open('saveload', { mode: 'load' }), '', 'load'),
      b('Settings', () => this.ui.open('settings'), '', 'settings'),
      b('Controls', () => this.renderControls(), '', 'controls'),
      h('div.divider'),
      b(tutorial ? 'Leave Tutorial' : 'Exit to Main Menu', () => this.exit(), '.danger', 'exit'),
    ];
    this.box.append(...items.filter((x): x is HTMLElement => !!x));
  }

  private renderControls(): void {
    clear(this.box);
    const input = this.ctx.input;
    const order: Action[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'dodge', 'attack', 'aim', 'ability1', 'ability2', 'ability3', 'ability4', 'ability5', 'elementNext', 'drawWater', 'avatarState', 'lockOn', 'interact', 'companion', 'map', 'journal', 'techniques', 'inventory', 'companions', 'character', 'pause'];
    this.box.append(
      h('h2.title', 'Controls'),
      h(
        'div.scroll',
        { style: { maxHeight: '60vh' } },
        order.map((a) => h('div.row', { style: { justifyContent: 'space-between', padding: '3px 0' } }, h('span', ACTION_LABELS[a]), h('span.kbd', input.label(a)))),
      ),
      h('p.muted', { style: { fontSize: '13px' } }, 'Remap any control in Settings → Controls.'),
      h('button.btn', { onclick: () => this.renderMain() }, 'Back'),
    );
  }

  private exit(): void {
    const ctx = this.ctx;
    if (ctx.session.kind === 'tutorial') {
      ctx.game.exitToMenu(false);
      return;
    }
    this.ui.confirm('Return to the main menu?', [
      { text: 'Save & Exit', primary: true, onClick: () => ctx.game.exitToMenu(true) },
      { text: 'Exit without Saving', danger: true, onClick: () => ctx.game.exitToMenu(false) },
      { text: 'Cancel' },
    ]);
  }
}
