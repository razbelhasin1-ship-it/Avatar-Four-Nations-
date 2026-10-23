import type { GameContext } from '../../core/GameContext';
import { ELEMENT_INFO } from '../../core/types';
import { h, clear } from '../dom';
import { emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';

function fmtTime(s: number): string {
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return hrs ? `${hrs}h ${m}m` : `${m}m`;
}

export class MainMenu implements Screen {
  readonly id = 'mainMenu';
  readonly el: HTMLElement;
  modal = true;
  private list: HTMLElement;
  private ctx!: GameContext;

  constructor(private readonly ui: UIManager) {
    this.list = h('div.menu-list');
    this.el = h(
      'div.main-menu',
      h('h1.logo', 'AVATAR', h('small', 'THE FOUR NATIONS')),
      h('div.emblems', emblem('water'), emblem('earth'), emblem('fire'), emblem('air')),
      this.list,
      h('div.menu-footer', 'Click to focus · Mouse & keyboard, gamepad or touch · A fan-made tribute adventure'),
    );
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.renderRoot();
  }

  private btn(label: string, onClick: () => void, opts: { primary?: boolean; delay?: number; disabled?: boolean; id?: string } = {}): HTMLElement {
    const b = h(`button.btn${opts.primary ? '.primary' : ''}`, {
      onclick: () => {
        this.ctx.audio.play('ui_click', { bus: 'ui' });
        onClick();
      },
      disabled: opts.disabled,
      'data-action': opts.id,
    }, label);
    b.style.animationDelay = `${opts.delay ?? 0}s`;
    return b;
  }

  renderRoot(): void {
    clear(this.list);
    this.list.append(
      this.btn('Enter the World', () => this.renderEnter(), { primary: true, delay: 0.05, id: 'enter' }),
      this.btn('Tutorial', () => this.ctx.game.startTutorial(), { delay: 0.1, id: 'tutorial' }),
      this.btn('Settings', () => this.ui.open('settings'), { delay: 0.15, id: 'settings' }),
      this.btn('Exit Game', () => this.exit(), { delay: 0.2, id: 'exit' }),
    );
  }

  private renderEnter(): void {
    clear(this.list);
    const latest = this.ctx.save.latest();
    if (latest) {
      const info = ELEMENT_INFO[latest.startingElement];
      const b = this.btn(`Continue Journey`, () => this.ctx.game.loadGame(latest.slot), { primary: true, id: 'continue' });
      b.append(h('div.muted', { style: { fontFamily: 'var(--font-body)', fontSize: '14px', letterSpacing: '0', marginTop: '4px' } }, `${latest.characterName} · ${info.name} Avatar · Lv ${latest.level} · ${latest.regionName} · ${fmtTime(latest.playTime)}`));
      this.list.append(b);
    }
    this.list.append(
      this.btn('Begin a New Journey', () => this.ui.open('newGame'), { primary: !latest, id: 'new' }),
      this.btn('Load Journey', () => this.ui.open('saveload', { mode: 'load' }), { disabled: !latest, id: 'load' }),
      this.btn('Back', () => this.renderRoot(), { id: 'back' }),
    );
  }

  private exit(): void {
    this.ui.confirm('Leave the Four Nations? Your journeys are saved in this browser.', [
      {
        text: 'Exit Game',
        danger: true,
        onClick: () => this.farewell(),
      },
      { text: 'Stay', primary: true },
    ]);
  }

  private farewell(): void {
    // Browsers only allow closing windows opened by script; try, then show a farewell screen.
    try {
      window.close();
    } catch {
      /* ignore */
    }
    clear(this.list);
    this.list.append(
      h('p', { style: { fontSize: '20px', margin: '0 0 6px' } }, 'Farewell, Avatar.'),
      h('p.muted', { style: { margin: '0 0 16px' } }, 'You can safely close this tab now. Your progress is stored in this browser.'),
      this.btn('Return to Main Menu', () => this.renderRoot(), { primary: true, id: 'return' }),
    );
    this.ctx.audio.setMusicTheme(null);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.renderRoot();
      return true;
    }
    return false;
  }
}
