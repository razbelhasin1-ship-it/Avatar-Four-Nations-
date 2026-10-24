import type { GameContext } from '../../core/GameContext';
import { SAVE_SLOTS, type SaveMeta } from '../../core/Save';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { clear, h } from '../dom';
import { emblem } from '../icons';
import type { Screen, UIManager } from '../UIManager';
import { gamepadNav } from './MainMenu';

// -----------------------------------------------------------------------------
// Slot thumbnails: a small snapshot of the game canvas plus the element state,
// captured whenever a slot is written (manual saves, autosaves, new journeys).
// -----------------------------------------------------------------------------

const THUMB_KEY = 'a4n.thumb.';

export interface SlotThumb {
  img: string;
  element: Element;
  unlocked: Element[];
  mastered: Element[];
}

export function readThumb(slot: string): SlotThumb | null {
  try {
    const raw = localStorage.getItem(THUMB_KEY + slot);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t && typeof t.img === 'string' ? (t as SlotThumb) : null;
  } catch {
    return null;
  }
}

function deleteThumb(slot: string): void {
  try {
    localStorage.removeItem(THUMB_KEY + slot);
  } catch {
    /* ignore */
  }
}

/** Snapshot the WebGL canvas into a small JPEG (cover-fit 16:9). Must run right after a render. */
function snapshot(src: HTMLCanvasElement, w = 256, hgt = 144): string | null {
  if (!src.width || !src.height) return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hgt;
  const g = cv.getContext('2d');
  if (!g) return null;
  const want = w / hgt;
  const sr = src.width / src.height;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sr > want) {
    sw = src.height * want;
    sx = (src.width - sw) / 2;
  } else {
    sh = src.width / want;
    sy = (src.height - sh) / 2;
  }
  g.drawImage(src, sx, sy, sw, sh, 0, 0, w, hgt);
  return cv.toDataURL('image/jpeg', 0.75);
}

let thumbsInstalled = false;

/** Wire thumbnail capture to save:written (called once from UIManager.init). */
export function installSaveThumbnails(ctx: GameContext): void {
  if (thumbsInstalled) return;
  thumbsInstalled = true;
  ctx.events.on('save:written', ({ slot }) => {
    const p = ctx.progression;
    const state = { element: ctx.player?.element ?? p.startingElement, unlocked: ELEMENTS.filter((e) => p.unlocked.has(e)), mastered: ELEMENTS.filter((e) => p.mastery[e].mastered) };
    // The game loop renders before this callback runs in the next frame, so the drawing buffer holds a fresh frame.
    requestAnimationFrame(() => {
      try {
        const img = snapshot(ctx.render.renderer.domElement);
        if (!img) return;
        localStorage.setItem(THUMB_KEY + slot, JSON.stringify({ img, ...state }));
        window.dispatchEvent(new CustomEvent('a4n:thumb', { detail: slot }));
      } catch {
        /* storage full: the slot simply shows no picture */
      }
    });
  });
}

function fmtPlay(s: number): string {
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return hrs ? `${hrs} h ${m} min` : `${Math.max(1, m)} min`;
}

export class SaveLoadScreen implements Screen {
  readonly id = 'saveload';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private box: HTMLElement;
  private ctx!: GameContext;
  private mode: 'save' | 'load' = 'load';

  constructor(private readonly ui: UIManager) {
    this.box = h('div.modal.panel.saveload');
    this.el = h('div.modal-backdrop', this.box);
    // A fresh thumbnail lands one frame after the save: show it.
    window.addEventListener('a4n:thumb', () => {
      if (this.ctx && this.ui.isOpen(this.id)) this.render();
    });
  }

  onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    this.mode = (arg as { mode?: string } | undefined)?.mode === 'save' ? 'save' : 'load';
    this.render();
    (this.box.querySelector('.slot-card button.primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  update(): void {
    if (this.ui.currentScreen === this.id) gamepadNav(this.box, () => this.ui.close());
  }

  private render(): void {
    const ctx = this.ctx;
    clear(this.box);
    this.box.append(
      h(
        'div.modal-header',
        h('h2.title', this.mode === 'save' ? 'Save Journey' : 'Load Journey'),
        h('div.spacer'),
        h('button.btn.small', { 'data-action': 'close-saveload', onclick: () => this.ui.close() }, 'Close'),
      ),
    );
    const list = h('div.slot-list.scroll');
    SAVE_SLOTS.forEach((slot, i) => {
      const meta = ctx.save.getMeta(slot);
      const isCurrent = ctx.session.active && ctx.session.slot === slot;
      const actions = h('div.slot-actions');
      if (this.mode === 'save') {
        actions.append(h('button.btn.small.primary', { 'data-action': `save-${slot}`, onclick: () => this.doSave(slot, meta, isCurrent) }, meta ? (isCurrent ? 'Save' : 'Overwrite') : 'Save Here'));
      } else if (meta) {
        actions.append(h('button.btn.small.primary', { 'data-action': `load-${slot}`, onclick: () => this.doLoad(slot) }, 'Load'));
      }
      if (meta) actions.append(h('button.btn.small.danger', { 'data-action': `delete-${slot}`, onclick: () => this.doDelete(slot, meta) }, 'Delete'));
      list.append(meta ? this.filledCard(slot, i, meta, isCurrent, actions) : this.emptyCard(slot, i, actions));
    });
    this.box.append(list);
    if (this.mode === 'load' && !SAVE_SLOTS.some((s) => ctx.save.getMeta(s))) {
      this.box.append(h('p.muted', { style: { textAlign: 'center' } }, 'No saved journeys yet. Begin a New Journey from the main menu.'));
    }
  }

  private emptyCard(slot: string, i: number, actions: HTMLElement): HTMLElement {
    return h('div.slot-card.empty', { 'data-slot': slot }, h('div.slot-thumb.blank', h('span', '○')), h('div.slot-info', h('div.slot-name', `Slot ${i + 1}`), h('div.muted', 'Empty slot')), actions);
  }

  private filledCard(slot: string, i: number, m: SaveMeta, isCurrent: boolean, actions: HTMLElement): HTMLElement {
    const thumb = readThumb(slot);
    const date = new Date(m.savedAt);
    const pic = h('div.slot-thumb');
    if (thumb) pic.style.backgroundImage = `url("${thumb.img}")`;
    else pic.append(emblem(m.startingElement));
    pic.append(h('span.slot-no', String(i + 1)));
    // Element row: mastered = lit, unlocked = bendable, otherwise faint.
    const masteryRow = h(
      'div.slot-mastery',
      ELEMENTS.map((e) => {
        const mastered = thumb ? thumb.mastered.includes(e) : false;
        const unlocked = thumb ? thumb.unlocked.includes(e) : e === m.startingElement;
        const icon = emblem(e);
        icon.classList.add(mastered ? 'mastered' : unlocked ? 'unlocked' : 'locked');
        icon.title = `${ELEMENT_INFO[e].name}: ${mastered ? 'mastered' : unlocked ? 'learning' : 'not yet learned'}`;
        return icon;
      }),
      h('span.muted', `${m.masteredCount}/4 mastered`),
    );
    return h(
      `div.slot-card${isCurrent ? '.current' : ''}`,
      { 'data-slot': slot },
      pic,
      h(
        'div.slot-info',
        h('div.slot-name', m.characterName, isCurrent ? h('span.badge', 'current') : null),
        h('div.slot-line', `${ELEMENT_INFO[m.startingElement].name} Avatar · Level ${m.level} · ${m.regionName}`),
        h('div.slot-line.muted', `${fmtPlay(m.playTime)} played · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`),
        masteryRow,
      ),
      actions,
    );
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

  private doDelete(slot: string, meta: SaveMeta): void {
    this.ui.confirm(`Delete ${meta.characterName}'s journey permanently? This cannot be undone.`, [
      {
        text: 'Delete',
        danger: true,
        onClick: () => {
          this.ctx.save.delete(slot);
          deleteThumb(slot);
          this.render();
        },
      },
      { text: 'Cancel', primary: true },
    ]);
  }
}
