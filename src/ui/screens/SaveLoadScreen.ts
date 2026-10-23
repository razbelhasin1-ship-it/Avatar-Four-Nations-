import type { GameContext } from '../../core/GameContext';
import { SAVE_SLOTS, type SaveMeta } from '../../core/Save';
import { ELEMENT_INFO } from '../../core/types';
import { clear, h } from '../dom';
import { emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';

export class SaveLoadScreen implements Screen {
  readonly id = 'saveload';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private box: HTMLElement;
  private ctx!: GameContext;
  private mode: 'save' | 'load' = 'load';

  constructor(private readonly ui: UIManager) {
    this.box = h('div.modal.panel', { style: { width: 'min(640px, calc(100vw - 32px))' } });
    this.el = h('div.modal-backdrop', this.box);
  }

  onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    this.mode = (arg as any)?.mode === 'save' ? 'save' : 'load';
    this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    clear(this.box);
    this.box.append(h('div.modal-header', h('h2.title', this.mode === 'save' ? 'Save Journey' : 'Load Journey'), h('div.spacer'), h('button.btn.small', { onclick: () => this.ui.close() }, 'Close')));
    SAVE_SLOTS.forEach((slot, i) => {
      const meta = ctx.save.getMeta(slot);
      const isCurrent = ctx.session.slot === slot;
      const info = meta ? this.describe(meta) : null;
      const actions = h('div.row');
      if (this.mode === 'save') {
        actions.append(h('button.btn.small.primary', { 'data-action': `save-${slot}`, onclick: () => this.doSave(slot, meta, isCurrent) }, meta ? 'Overwrite' : 'Save Here'));
      } else if (meta) {
        actions.append(h('button.btn.small.primary', { 'data-action': `load-${slot}`, onclick: () => this.doLoad(slot) }, 'Load'));
      }
      if (meta) actions.append(h('button.btn.small.danger', { onclick: () => this.doDelete(slot) }, 'Delete'));
      this.box.append(
        h(
          'div.slot-card',
          { style: { marginBottom: '8px' } },
          meta ? emblem(meta.startingElement, 'emblem') : h('div.emblem', { style: { width: '42px', height: '42px', display: 'grid', placeItems: 'center', opacity: '0.4' } }, '○'),
          h('div', { style: { flex: '1' } }, h('div', { style: { fontSize: '17px' } }, meta ? `${meta.characterName}${isCurrent ? ' (current)' : ''}` : `Empty Slot ${i + 1}`), info ? h('div.muted', { style: { fontSize: '13px' } }, info) : null),
          actions,
        ),
      );
    });
  }

  private describe(m: SaveMeta): string {
    const t = Math.floor(m.playTime / 60);
    const date = new Date(m.savedAt);
    return `${ELEMENT_INFO[m.startingElement].name} Avatar · Lv ${m.level} · ${m.regionName} · ${m.masteredCount}/4 mastered · ${t} min · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  private doSave(slot: string, meta: SaveMeta | null, isCurrent: boolean): void {
    const go = () => {
      if (this.ctx.game.saveGame(slot)) this.render();
    };
    if (meta && !isCurrent) {
      this.ui.confirm(`Overwrite ${meta.characterName}'s journey? This cannot be undone.`, [{ text: 'Overwrite', danger: true, onClick: go }, { text: 'Cancel', primary: true }]);
    } else go();
  }

  private doLoad(slot: string): void {
    const go = () => {
      this.ui.closeAll();
      void this.ctx.game.loadGame(slot);
    };
    if (this.ctx.session.active) {
      this.ui.confirm('Load this journey? Unsaved progress in your current journey will be lost.', [{ text: 'Load', primary: true, onClick: go }, { text: 'Cancel' }]);
    } else go();
  }

  private doDelete(slot: string): void {
    this.ui.confirm('Delete this journey permanently?', [
      {
        text: 'Delete',
        danger: true,
        onClick: () => {
          this.ctx.save.delete(slot);
          this.render();
        },
      },
      { text: 'Cancel', primary: true },
    ]);
  }
}
