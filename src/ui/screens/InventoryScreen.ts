import { cloneAppearance, type Appearance, type OutfitSlots } from '../../character/Appearance';
import type { GameContext } from '../../core/GameContext';
import { ELEMENT_INFO, ELEMENTS } from '../../core/types';
import { COSMETICS, EMPTY_SLOT_IDS, type CosmeticDef, type CosmeticSlot } from '../../data/cosmetics';
import { itemById, type ItemDef } from '../../data/items';
import { QUESTS } from '../../data/quests';
import { LANDMARKS, REGIONS } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, emblem } from '../icons';
import type { UIManager } from '../UIManager';
import { chip, empty, GameScreen, meter, type PadFrame, type TabDef } from './gsBase';
import { WardrobeStudio } from './WardrobeStudio';

type HubTab = 'items' | 'wardrobe' | 'profile';
type Cat = 'all' | ItemDef['category'];

const CATS: Array<[Cat, string]> = [
  ['all', 'All'],
  ['consumable', 'Consumables'],
  ['food', 'Food'],
  ['quest', 'Quest'],
  ['collectible', 'Collectibles'],
  ['material', 'Materials'],
];

const SLOTS: Array<[CosmeticSlot, keyof OutfitSlots, string]> = [
  ['top', 'top', 'Top'],
  ['bottom', 'bottom', 'Trousers'],
  ['footwear', 'footwear', 'Footwear'],
  ['outer', 'outer', 'Outer'],
  ['gloves', 'gloves', 'Gloves'],
  ['belt', 'belt', 'Belt'],
  ['headwear', 'headwear', 'Headwear'],
  ['necklace', 'necklace', 'Necklace'],
  ['accessory', 'accessory', 'Accessory'],
];

/** Health restored by eating a food item from the pack. */
export const FOOD_HEAL = 15;

let cosmeticQuest: Map<string, string> | null = null;
function questForCosmetic(id: string): string | undefined {
  if (!cosmeticQuest) {
    cosmeticQuest = new Map();
    for (const q of QUESTS) {
      for (const c of q.rewards?.cosmetics ?? []) cosmeticQuest.set(c, q.title);
      for (const s of q.steps) for (const a of [...(s.onStart ?? []), ...(s.onComplete ?? [])]) if (a.type === 'giveCosmetic') cosmeticQuest.set(a.cosmetic, q.title);
    }
  }
  return cosmeticQuest.get(id);
}

function cosmeticSource(c: CosmeticDef): string {
  switch (c.unlock) {
    case 'merchant':
      return `Sold by merchants${c.price ? ` — ${c.price} copper` : ''}`;
    case 'quest': {
      const q = questForCosmetic(c.id);
      return q ? `Quest reward — “${q}”` : 'Quest reward';
    }
    case 'master':
      return 'Gift from a master';
    case 'explore':
      return 'Found while exploring';
    case 'achievement':
      return 'Achievement';
    default:
      return 'Starting outfit';
  }
}

/**
 * Inventory (I) and Character (C) hub: items with categories and use/eat,
 * currency; the wardrobe applying cosmetics live to a rotatable 3D preview;
 * and the character profile (level, mastery, journey stats).
 */
export class InventoryScreen extends GameScreen {
  private cat: Cat = 'all';
  private itemSel: string | null = null;
  private slot: CosmeticSlot = 'top';
  private studio: WardrobeStudio | null = null;
  private preview: HTMLElement | null = null;
  private drag: { x: number; id: number } | null = null;

  constructor(ui: UIManager, readonly id: 'inventory' | 'character', private readonly defaultTab: HubTab) {
    super(ui, id === 'inventory' ? 'Inventory' : 'Character', 'hub');
  }

  protected override tabs(): TabDef[] {
    return [
      { id: 'items', label: 'Items', badge: this.ctx.inventory.allItems().length || null },
      { id: 'wardrobe', label: 'Wardrobe' },
      { id: 'profile', label: 'Avatar' },
    ];
  }

  protected override hints(): Array<[string, string]> {
    const pad = this.ctx.input.lastDevice === 'gamepad';
    return this.tab === 'items' ? [] : [[pad ? 'R-stick' : 'Drag / ← →', 'Turn']];
  }

  override onOpen(ctx: GameContext, arg?: unknown): void {
    this.tab = typeof arg === 'string' ? arg : this.defaultTab;
    super.onOpen(ctx, arg);
  }

  onClose(): void {
    this.dropStudio();
  }

  private dropStudio(): void {
    if (!this.studio) return;
    this.ctx.game.setStage(null);
    this.studio.dispose();
    this.studio = null;
    this.el.classList.remove('gs-staged');
  }

  private ensureStudio(): WardrobeStudio | null {
    const p = this.ctx.player;
    if (!p) return null;
    if (!this.studio) {
      try {
        this.studio = new WardrobeStudio(p.appearance, p.element);
      } catch (err) {
        console.error('[UI] wardrobe studio failed', err);
        return null;
      }
      this.ctx.game.setStage({ scene: this.studio.scene, camera: this.studio.camera });
    }
    this.studio.setTheme(p.element);
    this.el.classList.add('gs-staged');
    return this.studio;
  }

  protected renderBody(): void {
    clear(this.body);
    this.body.className = 'gs-body';
    this.preview = null;
    if (this.tab === 'items') {
      if (this.studio) this.dropStudio();
      this.renderItems();
      return;
    }
    const st = this.ensureStudio();
    this.body.classList.add('iv-staged');
    this.preview = this.previewPane();
    const right = h('div.iv-right');
    this.body.append(this.preview, right);
    if (this.tab === 'wardrobe') this.renderWardrobe(right);
    else this.renderProfile(right);
    if (st && this.tryingOn) {
      // The card under the pointer was replaced: drop any try-on preview.
      this.tryingOn = false;
      st.setAppearance(this.ctx.player!.appearance);
    }
  }

  private tryingOn = false;

  private previewPane(): HTMLElement {
    const el = h('div.iv-preview', { tabindex: '0', 'aria-label': 'Character preview — drag or use arrow keys to turn', 'data-role': 'preview' }, h('div.iv-preview-hint', 'Drag to turn'));
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, id: e.pointerId };
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      this.studio?.turn((e.clientX - this.drag.x) * 0.012);
      this.drag.x = e.clientX;
    });
    const end = () => (this.drag = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.studio?.turn(e.key === 'ArrowLeft' ? -0.35 : 0.35);
      }
    });
    return el;
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.studio && this.preview && this.preview.isConnected) {
      const r = this.preview.getBoundingClientRect();
      this.studio.update(dt, { x: r.left, y: r.top, w: r.width, h: r.height });
    }
  }

  protected override padInput(p: PadFrame, dt: number): boolean {
    const rx = p.axes[2] ?? 0;
    if (this.studio && Math.abs(rx) > 0.2) this.studio.turn(rx * dt * 3);
    return false;
  }

  protected override key(e: KeyboardEvent): boolean {
    // Keep arrow keys for turning when the preview has focus.
    if (document.activeElement === this.preview && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  private renderItems(): void {
    const ctx = this.ctx;
    const inv = ctx.inventory;
    this.body.classList.add('gs-panes');
    const all = inv.allItems().map((it) => ({ ...it, def: itemById(it.id) })).filter((x): x is { id: string; count: number; def: ItemDef } => !!x.def);
    const list = all.filter((x) => this.cat === 'all' || x.def.category === this.cat);
    if (!this.itemSel || !list.some((x) => x.id === this.itemSel)) this.itemSel = list[0]?.id ?? null;
    const chips = h('div.gs-chips', { role: 'toolbar', 'aria-label': 'Item categories' });
    for (const [id, label] of CATS) {
      const n = id === 'all' ? all.length : all.filter((x) => x.def.category === id).length;
      chips.append(chip(`${label}${n ? ` ${n}` : ''}`, this.cat === id, () => ((this.cat = id), this.renderBody()), { 'data-cat': id }));
    }
    const grid = h('div.iv-grid.gs-scroll', { role: 'listbox', 'aria-label': 'Items' });
    if (!list.length) grid.append(empty(all.length ? 'Nothing in this category.' : 'Your pack is empty.', 'Merchants, quests and the wilds will fill it.'));
    for (const it of list) {
      grid.append(
        h(
          `button.iv-item.cat-${it.def.category}${this.itemSel === it.id ? '.selected' : ''}`,
          { type: 'button', role: 'option', 'aria-selected': String(this.itemSel === it.id), 'data-item': it.id, title: it.def.name, onclick: () => this.selectItem(it.id), onfocus: () => this.selectItem(it.id) },
          h('span.iv-icon', it.def.icon),
          h('span.iv-name', it.def.name),
          it.count > 1 ? h('span.iv-count', `×${it.count}`) : null,
        ),
      );
    }
    const purse = h('div.iv-purse', h('span.iv-coin', '◎'), h('b', String(inv.currency)), h('span', 'copper'));
    const detail = h('div.gs-detail.gs-scroll.iv-detail');
    this.body.append(h('div.gs-pane.gs-pane-list.iv-pane', h('div.iv-top', chips, purse), grid), detail);
    this.itemDetail(detail);
  }

  private selectItem(id: string): void {
    if (this.itemSel === id) return;
    this.itemSel = id;
    for (const el of Array.from(this.body.querySelectorAll('.iv-item'))) el.classList.toggle('selected', (el as HTMLElement).dataset.item === id);
    const d = this.body.querySelector('.iv-detail') as HTMLElement | null;
    if (d) this.itemDetail(d);
  }

  private itemDetail(el: HTMLElement): void {
    clear(el);
    const ctx = this.ctx;
    const id = this.itemSel;
    const def = id ? itemById(id) : null;
    if (!id || !def) {
      el.append(empty('Select an item.'));
      return;
    }
    const count = ctx.inventory.count(id);
    const cat = CATS.find((c) => c[0] === def.category)?.[1] ?? def.category;
    const p = ctx.player;
    const hp = p?.health ? `${Math.round(p.health.hp)} / ${p.health.maxHp}` : '';
    el.append(h('div.iv-big', def.icon), h('div.gs-kicker', `${cat} · ×${count}`), h('h3.gs-h', def.name), h('p.gs-lead', def.description));
    if (def.price) el.append(h('div.muted', `Worth about ${def.price} copper`));
    const actions = h('div.gs-actions');
    if (def.use) actions.append(h('button.btn.primary', { type: 'button', 'data-action': 'use', onclick: () => this.useItem(id) }, 'Use'));
    if (def.category === 'food') actions.append(h('button.btn.primary', { type: 'button', 'data-action': 'eat', onclick: () => this.eat(id) }, `Eat (+${FOOD_HEAL} health)`));
    if (def.category === 'food') el.append(h('p.muted.iv-note', 'Animals love the right food — keep some for befriending companions.'));
    if (def.category === 'quest') el.append(h('p.iv-note', '◆ Quest item — kept until it is needed.'));
    if (hp && (def.use || def.category === 'food')) el.append(h('div.iv-hp', h('span', 'Health'), meter((p!.health!.hp) / p!.health!.maxHp, 'hp', hp)));
    if (actions.childElementCount) el.append(actions);
  }

  private afterUse(id: string): void {
    if (!this.ctx.inventory.has(id)) this.itemSel = null;
    const focusAction = (document.activeElement as HTMLElement | null)?.dataset.action;
    this.refresh();
    const again = focusAction ? (this.body.querySelector(`[data-action="${focusAction}"]`) as HTMLElement | null) : null;
    (again ?? (this.body.querySelector('.iv-item') as HTMLElement | null))?.focus({ preventScroll: true });
  }

  useItem(id: string): boolean {
    const def = itemById(id);
    const ok = this.ctx.inventory.use(id);
    this.ctx.events.emit('ui:notify', ok ? { text: `Used ${def?.name ?? id}.`, kind: 'success', duration: 2 } : { text: 'That would have no effect right now.', kind: 'info', duration: 2 });
    this.afterUse(id);
    return ok;
  }

  /** Eat one food item: restores a little health. Refused at full health. */
  eat(id: string): boolean {
    const ctx = this.ctx;
    const def = itemById(id);
    const p = ctx.player;
    if (!def || def.category !== 'food' || !p?.health || !ctx.inventory.has(id)) return false;
    if (p.health.hp >= p.health.maxHp) {
      ctx.events.emit('ui:notify', { text: 'You are not hungry — your health is full.', kind: 'info', duration: 2 });
      return false;
    }
    ctx.inventory.remove(id, 1);
    p.health.heal(FOOD_HEAL);
    ctx.events.emit('item:used', { itemId: id });
    ctx.events.emit('ui:notify', { text: `Ate ${def.name}: +${FOOD_HEAL} health.`, kind: 'success', duration: 2, icon: def.icon });
    this.afterUse(id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Wardrobe
  // ---------------------------------------------------------------------------

  private renderWardrobe(right: HTMLElement): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const chips = h('div.gs-chips', { role: 'toolbar', 'aria-label': 'Outfit slot' });
    for (const [s, key, label] of SLOTS) {
      const cur = p.appearance.outfit[key];
      chips.append(chip(label, this.slot === s, () => ((this.slot = s), this.renderBody()), { 'data-slot': s, title: COSMETICS.find((c) => c.id === cur)?.name ?? '' }));
    }
    const key = SLOTS.find((s) => s[0] === this.slot)![1];
    const grid = h('div.wd-grid.gs-scroll');
    const list = COSMETICS.filter((c) => c.slot === this.slot).sort((a, b) => Number(ctx.inventory.isCosmeticUnlocked(b.id)) - Number(ctx.inventory.isCosmeticUnlocked(a.id)));
    for (const c of list) {
      const unlocked = ctx.inventory.isCosmeticUnlocked(c.id);
      const equipped = p.appearance.outfit[key] === c.id || (EMPTY_SLOT_IDS.has(c.id) && EMPTY_SLOT_IDS.has(p.appearance.outfit[key]));
      const swatches = c.colors ? h('div.wd-sw', Object.values(c.colors).map((col) => h('span', { style: { background: col as string } }))) : null;
      const card = h(
        `div.wd-card${unlocked ? '' : '.locked'}${equipped ? '.equipped' : ''}`,
        {
          'data-cosmetic': c.id,
          onpointerenter: () => this.tryOn(c),
          onpointerleave: () => this.tryOn(null),
        },
        h('div.wd-card-head', h('h4', c.name), equipped ? h('span.gs-badge.gold', 'Worn') : null),
        h('div.wd-meta', c.nation === 'any' ? 'Any nation' : `${c.nation[0].toUpperCase()}${c.nation.slice(1)} style`, swatches),
        h('p', c.description),
        unlocked
          ? h('button.btn.small' + (equipped ? '' : '.primary'), { type: 'button', 'data-action': 'wear', disabled: equipped ? true : undefined, onclick: () => this.wear(c), onfocus: () => this.tryOn(c), onblur: () => this.tryOn(null) }, equipped ? 'Wearing' : 'Wear')
          : h('div.wd-lock', { tabindex: '0', onfocus: () => this.tryOn(c), onblur: () => this.tryOn(null) }, '🔒 ', cosmeticSource(c)),
      );
      grid.append(card);
    }
    right.append(h('div.gs-sec', 'Wardrobe', h('span.gs-sec-sub', 'hover or focus to try on · changes apply instantly')), chips, grid);
  }

  private withCosmetic(base: Appearance, c: CosmeticDef): Appearance {
    const key = SLOTS.find((s) => s[0] === c.slot)![1];
    const a = cloneAppearance(base);
    a.outfit[key] = c.id;
    if (c.colors) Object.assign(a.colors, c.colors);
    return a;
  }

  private tryOn(c: CosmeticDef | null): void {
    const p = this.ctx.player;
    if (!p || !this.studio) return;
    if (!c && !this.tryingOn) return;
    this.tryingOn = !!c;
    this.studio.setAppearance(c ? this.withCosmetic(p.appearance, c) : p.appearance);
  }

  /** Equip a cosmetic on the player (and the preview). */
  wear(c: CosmeticDef): boolean {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p || !ctx.inventory.isCosmeticUnlocked(c.id)) return false;
    p.setAppearance(this.withCosmetic(p.appearance, c));
    ctx.audio.play('ui_click', { bus: 'ui' });
    this.studio?.setAppearance(p.appearance, true);
    this.renderBody();
    (this.body.querySelector(`[data-cosmetic="${c.id}"] .btn, [data-cosmetic="${c.id}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  private renderProfile(right: HTMLElement): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const pr = ctx.progression;
    const next = pr.xpForLevel(pr.level + 1);
    const prev = pr.level > 1 ? pr.xpForLevel(pr.level) : 0;
    const xpFrac = next > prev ? (pr.xp - prev) / (next - prev) : 1;
    const known = LANDMARKS.filter((l) => ctx.world.discovered.has(l.id)).length;
    const stat = (label: string, value: string) => h('div.pf-stat', h('span', label), h('b', value));
    const els = h('div.pf-els');
    for (const e of ELEMENTS) {
      const m = pr.mastery[e];
      els.append(h(`div.pf-el${pr.canBend(e) ? '' : '.dim'}`, { style: { '--el': ELEMENT_COLORS[e].glow } as unknown as Partial<CSSStyleDeclaration> }, emblem(e, 'emblem'), h('div.pf-el-main', h('div.pf-el-row', h('span', ELEMENT_INFO[e].name), h('span.muted', m.mastered ? 'Mastered' : pr.canBend(e) ? `${Math.round(pr.masteryProgress(e) * 100)}%` : 'Not awakened')), meter(pr.masteryProgress(e), 'el'))));
    }
    right.append(
      h('div.pf-head', emblem(pr.startingElement, 'emblem pf-emblem'), h('div', h('h3.gs-h', p.characterName), h('div.muted', `Level ${pr.level} · born a ${ELEMENT_INFO[pr.startingElement].bender}`))),
      h('div.pf-xp', h('span', 'Experience'), meter(xpFrac, 'gold', `${Math.floor(pr.xp)} / ${next} XP`)),
      h('div.gs-sec', 'Elements'),
      els,
      h('div.gs-sec', 'The Avatar'),
      h('p.pf-avatar', pr.elementsSphereUnlocked ? `✦ Elements Sphere awakened. Enter the Avatar State (${ctx.input.label('avatarState')}) to call it.` : `Avatar State available (${ctx.input.label('avatarState')}). Elements Sphere: ${pr.masteredCount}/4 elements mastered.`),
      h('div.gs-sec', 'Journey'),
      h(
        'div.pf-stats',
        stat('Health', p.health ? `${Math.round(p.health.hp)} / ${p.health.maxHp}` : '—'),
        stat('Chi', `${Math.round(p.chi)} / ${p.maxChi}`),
        stat('Techniques', String(pr.learned.size)),
        stat('Places found', `${known} / ${LANDMARKS.length}`),
        stat('Regions', `${ctx.world.visitedRegions.size} / ${REGIONS.length}`),
        stat('Companions', String(ctx.companions.bonded.length)),
        stat('Quests done', String(ctx.quests.completed.size)),
        stat('Copper', String(ctx.inventory.currency)),
      ),
    );
  }
}
