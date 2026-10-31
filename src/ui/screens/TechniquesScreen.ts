import { allTechniques, getTechnique } from '../../combat/CombatSystem';
import type { TechniqueDef } from '../../combat/types';
import type { Action } from '../../core/Input';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { AWAKENINGS, MASTERS } from '../../data/masters';
import { QUESTS } from '../../data/quests';
import { SLOT_COUNT, SPHERE_TECHNIQUES } from '../../progression/Progression';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, emblem, iconHTML } from '../icons';
import type { UIManager } from '../UIManager';
import { empty, focusEl, GameScreen, touchUI, type PadFrame, type TabDef } from './gsBase';

type Tab = Element | 'avatar';

const KIND_LABEL: Record<string, string> = { basic: 'Basic form', heavy: 'Heavy form', ability: 'Ability', movement: 'Movement', defense: 'Defense', ultimate: 'Ultimate', combined: 'Combined', passive: 'Passive' };
const SLOTTABLE = new Set(['ability', 'movement', 'defense']);
const TIER = ['', 'I', 'II', 'III', 'IV'];

let sourceCache: Map<string, string> | null = null;
/** Where each technique is learned (masters' lessons, awakenings, quests, sphere). */
export function techniqueSources(): Map<string, string> {
  if (sourceCache) return sourceCache;
  const m = new Map<string, string>();
  for (const e of ELEMENTS) {
    const a = AWAKENINGS[e];
    if (a?.technique) m.set(a.technique, `Awakened with a ${ELEMENT_INFO[e].name.toLowerCase()} master`);
  }
  for (const ms of MASTERS) for (const l of ms.lessons) if (!m.has(l.technique) || m.get(l.technique)!.startsWith('Awakened')) m.set(l.technique, `${ms.name} (${ms.title}) — lesson “${l.title}”, ${ms.location}`);
  for (const q of QUESTS) {
    for (const t of q.rewards?.techniques ?? []) if (!m.has(t)) m.set(t, `Quest reward — “${q.title}”`);
    for (const s of q.steps) for (const a of [...(s.onStart ?? []), ...(s.onComplete ?? [])]) if (a.type === 'learn' && !m.has(a.technique)) m.set(a.technique, `Quest — “${q.title}”`);
  }
  for (const id of SPHERE_TECHNIQUES) m.set(id, 'Awakens with the Elements Sphere (master all four elements)');
  for (const d of allTechniques()) if (d.innate) m.set(d.id, d.innate);
  sourceCache = m;
  return m;
}

/** Technique library (K): per element, learned/locked techniques and the 1–4 loadout. */
export class TechniquesScreen extends GameScreen {
  readonly id = 'techniques';
  /** Technique waiting for a slot. */
  private pick: string | null = null;
  /** Slot waiting for a technique. */
  private pickSlot: number | null = null;

  constructor(ui: UIManager) {
    super(ui, 'Techniques', 'techniques');
  }

  override onOpen(ctx: Parameters<GameScreen['onOpen']>[0], arg?: unknown): void {
    this.pick = null;
    this.pickSlot = null;
    if (typeof arg !== 'string') this.tab = ctx.avatar?.sphereActive ? 'avatar' : ctx.player?.element ?? 'air';
    super.onOpen(ctx, arg);
  }

  protected override tabs(): TabDef[] {
    const pr = this.ctx.progression;
    const t: TabDef[] = ELEMENTS.map((e) => ({ id: e, label: ELEMENT_INFO[e].name, icon: emblem(e, 'emblem gs-tab-emblem'), locked: !pr.canBend(e), badge: pr.canBend(e) ? pr.learnedFor(e).length : null }));
    t.push({ id: 'avatar', label: 'Sphere', icon: emblem('avatar', 'emblem gs-tab-emblem'), locked: !pr.elementsSphereUnlocked });
    return t;
  }

  protected override hints(): Array<[string, string]> {
    const pad = this.ctx.input.lastDevice === 'gamepad';
    if (this.tab === 'avatar') return [];
    return [[pad ? 'Ⓐ' : '1–4', 'Equip to slot'], [pad ? 'Ⓧ' : 'Del', 'Clear slot']];
  }

  private get element(): Tab {
    return this.tab as Tab;
  }

  protected renderBody(): void {
    clear(this.body);
    this.body.className = 'gs-body tq-body';
    const pr = this.ctx.progression;
    const e = this.element;
    const wrap = h('div.gs-scroll.gs-fill.tq-wrap');
    if (e === 'avatar') {
      wrap.append(
        h(
          `div.gs-card.tq-banner${pr.elementsSphereUnlocked ? '.awake' : ''}`,
          emblem('avatar', 'emblem tq-banner-emblem'),
          h('div', h('h4', pr.elementsSphereUnlocked ? 'Elements Sphere — awakened' : 'Elements Sphere — sealed'), h('p', pr.elementsSphereUnlocked ? `Enter the Avatar State (${this.ctx.input.label('avatarState')}) to summon the Sphere. Its ultimates replace your slots 1–4, with the Cataclysm on ${this.ctx.input.label('ability5')}. They cost spirit, not slots.` : `Master all four elements (${pr.masteredCount}/4) to awaken the Sphere and its ultimates. The Avatar State itself is available at any time.`)),
        ),
      );
      const g = h('div.tq-grid');
      for (const d of allTechniques().filter((t) => t.element === 'avatar').sort((a, b) => a.tier - b.tier)) g.append(this.card(d));
      wrap.append(g);
      this.body.append(wrap);
      return;
    }
    if (!pr.canBend(e)) {
      wrap.append(h('div.gs-card.tq-banner.locked', emblem(e, 'emblem tq-banner-emblem'), h('div', h('h4', `${ELEMENT_INFO[e].name}bending is not yet awakened`), h('p', `Find a ${ELEMENT_INFO[e].name.toLowerCase()} master — the ${ELEMENT_INFO[e].nation} — to awaken it. Masters are marked ✦ on your map once you know of them.`))));
    } else {
      wrap.append(this.loadout(e));
    }
    const defs = allTechniques().filter((t) => t.element === e).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    const known = defs.filter((d) => pr.knows(d.id));
    const slot = known.filter((d) => SLOTTABLE.has(d.kind));
    const core = known.filter((d) => !SLOTTABLE.has(d.kind));
    const locked = defs.filter((d) => !pr.knows(d.id));
    const section = (title: string, sub: string, list: TechniqueDef[]) => {
      if (!list.length) return;
      wrap.append(h('div.gs-sec', title, sub ? h('span.gs-sec-sub', sub) : null));
      const g = h('div.tq-grid');
      for (const d of list) g.append(this.card(d));
      wrap.append(g);
    };
    section('Equippable', 'assign to slots 1–4', slot);
    section('Core forms & passives', 'always active — attack and heavy attack', core);
    section('Not yet learned', 'masters teach these', locked);
    if (!defs.length) wrap.append(empty('No techniques for this element.'));
    this.body.append(wrap);
  }

  private loadout(e: Element): HTMLElement {
    const pr = this.ctx.progression;
    const slots = pr.slotsFor(e);
    const bar = h('div.tq-loadout', { role: 'group', 'aria-label': `${ELEMENT_INFO[e].name} technique slots` });
    const touch = touchUI(this.ctx);
    const prompt = this.pick
      ? `${touch ? 'Tap' : 'Choose'} a slot for ${getTechnique(this.pick)?.name ?? ''}`
      : this.pickSlot !== null
        ? `${touch ? 'Tap' : 'Choose'} a technique for slot ${this.pickSlot + 1}`
        : touch
          ? 'Loadout — tap a slot, then a technique (or tap Equip, then a slot)'
          : 'Loadout — click a slot, then a technique (or drag a technique onto a slot)';
    bar.append(h('div.tq-loadout-label', emblem(e, 'emblem'), h('span', prompt), this.pick || this.pickSlot !== null ? h('button.btn.small', { type: 'button', 'data-action': 'cancel-pick', onclick: () => this.cancelPick() }, 'Cancel') : null));
    const row = h('div.tq-slots');
    for (let i = 0; i < SLOT_COUNT; i++) {
      const def = slots[i] ? getTechnique(slots[i]!) : null;
      const s = h(
        `button.tq-slot${def ? '' : '.empty'}${this.pick ? '.target' : ''}${this.pickSlot === i ? '.picking' : ''}`,
        {
          type: 'button',
          'data-slot': String(i),
          'aria-label': `Slot ${i + 1}: ${def?.name ?? 'empty'}`,
          onclick: () => this.onSlot(i),
          onkeydown: (ev: KeyboardEvent) => {
            if ((ev.key === 'Delete' || ev.key === 'Backspace') && slots[i]) {
              ev.preventDefault();
              this.equip(i, null);
            }
          },
          ondragover: (ev: DragEvent) => ev.preventDefault(),
          ondrop: (ev: DragEvent) => {
            ev.preventDefault();
            const id = ev.dataTransfer?.getData('text/plain');
            if (id) this.equip(i, id);
          },
          style: { '--el': ELEMENT_COLORS[e].glow } as unknown as Partial<CSSStyleDeclaration>,
        },
        h('span.tq-slot-key', this.ctx.input.label(`ability${i + 1}` as Action)),
        h('span.tq-slot-icon', { html: def ? iconHTML(def.icon) : '+' }),
        h('span.tq-slot-name', def?.name ?? 'Empty'),
        def?.water ? h('span.tq-slot-water', { title: `Needs ${def.water.amount} water` }, '💧') : null,
      );
      row.append(s);
    }
    bar.append(row);
    return bar;
  }

  private card(d: TechniqueDef): HTMLElement {
    const pr = this.ctx.progression;
    const known = d.element === 'avatar' ? pr.elementsSphereUnlocked || pr.knows(d.id) : pr.knows(d.id);
    const slottable = known && SLOTTABLE.has(d.kind) && d.element !== 'avatar';
    const slots = d.element !== 'avatar' ? pr.slotsFor(d.element as Element) : [];
    const inSlot = slots.indexOf(d.id);
    const src = techniqueSources().get(d.id);
    const learned = pr.learned.get(d.id);
    const water = d.water ? `${d.water.amount}${d.water.allowIce ? ' · ice' : ''}${d.water.allowSnow ? ' · snow' : ''}` : null;
    const stats = h(
      'div.tq-stats',
      h('span', { title: 'Chi cost' }, h('i', 'Chi'), ` ${d.chiCost}`),
      h('span', { title: 'Cooldown' }, h('i', 'CD'), ` ${d.cooldown ? `${d.cooldown}s` : '—'}`),
      d.range ? h('span', { title: 'Effective range' }, h('i', 'Range'), ` ${d.range} m`) : null,
      water ? h('span.tq-water', { title: 'Water drawn from a real nearby source or your reserve' }, '💧 ', water) : null,
    );
    const status = known
      ? h('div.tq-src', h('b', inSlot >= 0 ? `Equipped · slot ${inSlot + 1}` : SLOTTABLE.has(d.kind) ? 'Learned' : d.kind === 'passive' ? 'Always active' : d.kind === 'basic' ? `On ${this.ctx.input.label('attack')}` : d.kind === 'heavy' ? `On ${this.ctx.input.label('aim')}` : 'Learned'), learned ? ` — ${learned.source === 'start' ? 'innate' : src ?? learned.source}` : src ? ` — ${src}` : '')
      : h('div.tq-src.locked', '🔒 ', src ?? (d.starter ? 'Awakens with the element' : 'Taught by a master'));
    const card = h(
      `article.tq-card.kind-${d.kind}${known ? '' : '.locked'}${inSlot >= 0 ? '.equipped' : ''}${this.pick === d.id ? '.picking' : ''}${this.pickSlot !== null && slottable ? '.target' : ''}`,
      {
        tabindex: '0',
        'data-tech': d.id,
        draggable: slottable ? 'true' : undefined,
        ondragstart: (ev: DragEvent) => ev.dataTransfer?.setData('text/plain', d.id),
        onkeydown: (ev: KeyboardEvent) => this.cardKey(ev, d, slottable),
        onclick: (ev: MouseEvent) => {
          if ((ev.target as HTMLElement).closest('button')) return;
          // Tap/click a technique, then a slot (or the reverse) — no drag needed on touch.
          if (slottable && this.pickSlot !== null) this.equip(this.pickSlot, d.id);
          else if (slottable) this.onEquipButton(d.id);
        },
        style: { '--el': ELEMENT_COLORS[d.element === 'avatar' ? 'avatar' : d.element].glow } as unknown as Partial<CSSStyleDeclaration>,
      },
      h('div.tq-card-head', h('span.tq-icon', { html: iconHTML(d.icon) }), h('div.tq-card-title', h('h4', d.name), h('div.tq-kind', `${KIND_LABEL[d.kind] ?? d.kind} · tier ${TIER[d.tier]}`)), inSlot >= 0 ? h('span.gs-badge.gold', `${inSlot + 1}`) : null),
      h('p.tq-desc', d.description),
      h('p.tq-usage', d.usage),
      stats,
      status,
      slottable ? h('div.tq-actions', h(`button.btn.small${this.pick === d.id ? '.primary' : ''}`, { type: 'button', 'data-action': 'equip', onclick: () => this.onEquipButton(d.id) }, this.pickSlot !== null ? `Put in slot ${this.pickSlot + 1}` : this.pick === d.id ? 'Choose a slot…' : inSlot >= 0 ? 'Move…' : 'Equip…')) : null,
    );
    return card;
  }

  private cardKey(ev: KeyboardEvent, d: TechniqueDef, slottable: boolean): void {
    const n = Number(ev.key);
    if (slottable && n >= 1 && n <= SLOT_COUNT) {
      ev.preventDefault();
      ev.stopPropagation();
      this.equip(n - 1, d.id);
    } else if (slottable && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      this.onEquipButton(d.id);
    }
  }

  private onEquipButton(id: string): void {
    if (this.pickSlot !== null) {
      this.equip(this.pickSlot, id);
      return;
    }
    this.pick = this.pick === id ? null : id;
    this.renderBody();
    this.renderFoot();
    const target = this.body.querySelector(this.pick ? '.tq-slot' : `[data-tech="${id}"]`) as HTMLElement | null;
    if (target) focusEl(target);
  }

  private onSlot(i: number): void {
    if (this.pick) {
      this.equip(i, this.pick);
      return;
    }
    this.pickSlot = this.pickSlot === i ? null : i;
    this.renderBody();
    const first = this.body.querySelector(this.pickSlot !== null ? '.tq-card.target' : `[data-slot="${i}"]`) as HTMLElement | null;
    if (first) focusEl(first);
  }

  private cancelPick(): void {
    this.pick = null;
    this.pickSlot = null;
    this.renderBody();
  }

  /** Assign (or clear) a slot for the current element. */
  equip(slot: number, id: string | null): void {
    const e = this.element;
    if (e === 'avatar') return;
    const pr = this.ctx.progression;
    if (id && (!pr.knows(id) || !SLOTTABLE.has(getTechnique(id)?.kind ?? ''))) return;
    pr.equip(e, slot, id);
    this.ctx.audio.play('ui_click', { bus: 'ui' });
    this.pick = null;
    this.pickSlot = null;
    this.renderBody();
    const s = this.body.querySelector(`[data-slot="${slot}"]`) as HTMLElement | null;
    if (s) {
      focusEl(s);
      s.classList.add('flash');
    }
  }

  protected override back(): void {
    if (this.pick || this.pickSlot !== null) this.cancelPick();
    else this.closeSelf();
  }

  protected override padInput(p: PadFrame): boolean {
    if (p.edge(2)) {
      const slot = (document.activeElement as HTMLElement | null)?.dataset.slot;
      if (slot !== undefined) {
        this.equip(Number(slot), null);
        return true;
      }
    }
    return false;
  }
}
