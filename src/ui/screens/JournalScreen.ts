import { getTechnique } from '../../combat/CombatSystem';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { cosmeticById } from '../../data/cosmetics';
import { bondLevelName, HABITATS, SPECIES, speciesById } from '../../data/creatures';
import { itemById } from '../../data/items';
import { LORE } from '../../data/lore';
import { MASTERS } from '../../data/masters';
import type { QuestCategory, QuestDef, QuestProgress } from '../../quests/QuestTypes';
import { MASTERY_REQUIREMENTS } from '../../progression/Progression';
import { LANDMARKS, REGIONS, regionById } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, emblem } from '../icons';
import type { UIManager } from '../UIManager';
import { chip, empty, GameScreen, meter, type TabDef } from './gsBase';

type Filter = 'all' | 'main' | 'elements' | 'side' | 'completed';

const CAT_GROUP: Record<QuestCategory, Exclude<Filter, 'all' | 'completed'>> = {
  main: 'main',
  tutorial: 'main',
  training: 'elements',
  mastery: 'elements',
  side: 'side',
  companion: 'side',
  exploration: 'side',
};

const CAT_LABEL: Record<QuestCategory, string> = {
  main: 'Main Story',
  tutorial: 'Tutorial',
  training: 'Training',
  mastery: 'Element Mastery',
  side: 'Side Quest',
  companion: 'Companion',
  exploration: 'Exploration',
};

/** Journal (J): quests, masters, element mastery & the Elements Sphere, bestiary, lore. */
export class JournalScreen extends GameScreen {
  readonly id = 'journal';
  private filter: Filter = 'all';
  private sel: string | null = null;
  private loreSel: string | null = null;

  constructor(ui: UIManager) {
    super(ui, 'Journal', 'journal');
  }

  protected override tabs(): TabDef[] {
    const q = this.ctx.quests;
    return [
      { id: 'quests', label: 'Quests', badge: q.active.size || null },
      { id: 'masters', label: 'Masters' },
      { id: 'mastery', label: 'Mastery' },
      { id: 'bestiary', label: 'Bestiary' },
      { id: 'lore', label: 'Lore' },
    ];
  }

  protected override hints(): Array<[string, string]> {
    return this.tab === 'quests' ? [[this.ctx.input.lastDevice === 'gamepad' ? 'Ⓨ' : 'T', 'Track']] : [];
  }

  protected override key(e: KeyboardEvent): boolean {
    if (this.tab === 'quests' && (e.key === 't' || e.key === 'T') && this.sel && this.ctx.quests.active.has(this.sel)) {
      this.toggleTrack(this.sel);
      return true;
    }
    return false;
  }

  protected override padInput(p: { edge(i: number): boolean }): boolean {
    if (this.tab === 'quests' && p.edge(3) && this.sel && this.ctx.quests.active.has(this.sel)) {
      this.toggleTrack(this.sel);
      return true;
    }
    return false;
  }

  protected renderBody(): void {
    clear(this.body);
    this.body.className = 'gs-body';
    switch (this.tab) {
      case 'masters':
        return this.renderMasters();
      case 'mastery':
        return this.renderMastery();
      case 'bestiary':
        return this.renderBestiary();
      case 'lore':
        return this.renderLore();
      default:
        return this.renderQuests();
    }
  }

  // ---------------------------------------------------------------------------
  // Quests
  // ---------------------------------------------------------------------------

  private questList(): Array<{ def: QuestDef; prog: QuestProgress | null }> {
    const q = this.ctx.quests;
    const out: Array<{ def: QuestDef; prog: QuestProgress | null }> = [];
    if (this.filter === 'completed') {
      for (const id of q.completed) {
        const def = q.get(id);
        if (def) out.push({ def, prog: null });
      }
      return out.reverse();
    }
    for (const [id, prog] of q.active) {
      const def = q.get(id);
      if (!def) continue;
      if (this.filter !== 'all' && CAT_GROUP[def.category] !== this.filter) continue;
      out.push({ def, prog });
    }
    const rank: Record<string, number> = { main: 0, elements: 1, side: 2 };
    out.sort((a, b) => (a.def.id === q.tracked ? -1 : b.def.id === q.tracked ? 1 : rank[CAT_GROUP[a.def.category]] - rank[CAT_GROUP[b.def.category]]));
    return out;
  }

  private renderQuests(): void {
    const q = this.ctx.quests;
    this.body.classList.add('gs-panes');
    const counts: Record<Filter, number> = { all: q.active.size, main: 0, elements: 0, side: 0, completed: q.completed.size };
    for (const id of q.active.keys()) {
      const d = q.get(id);
      if (d) counts[CAT_GROUP[d.category]]++;
    }
    const filters = h('div.gs-chips', { role: 'toolbar', 'aria-label': 'Quest filter' });
    for (const [id, label] of [['all', 'All'], ['main', 'Main'], ['elements', 'Elements'], ['side', 'Side'], ['completed', 'Completed']] as Array<[Filter, string]>) {
      filters.append(chip(`${label} ${counts[id]}`, this.filter === id, () => {
        this.filter = id;
        this.sel = null;
        this.renderBody();
      }, { 'data-filter': id }));
    }
    const list = this.questList();
    if (!this.sel || !list.some((x) => x.def.id === this.sel)) this.sel = list.find((x) => x.def.id === q.tracked)?.def.id ?? list[0]?.def.id ?? null;
    const listEl = h('div.gs-list.gs-scroll', { role: 'listbox', 'aria-label': 'Quests' });
    if (!list.length) listEl.append(empty(this.filter === 'completed' ? 'Nothing completed yet.' : 'No quests here.', 'Explore, and speak with the people of the Four Nations.'));
    for (const { def, prog } of list) {
      const tracked = q.tracked === def.id;
      listEl.append(
        h(
          `button.jr-q.cat-${CAT_GROUP[def.category]}${this.sel === def.id ? '.selected' : ''}${prog ? '' : '.done'}`,
          { type: 'button', role: 'option', 'aria-selected': String(this.sel === def.id), 'data-quest': def.id, onclick: () => this.select(def.id), onfocus: () => this.select(def.id, false) },
          h('span.jr-q-mark', tracked ? '◆' : prog ? '◇' : '✓'),
          h('span.jr-q-main', h('span.jr-q-title', def.title), h('span.jr-q-sub', prog ? `${CAT_LABEL[def.category]} · step ${prog.step + 1}/${def.steps.length}` : CAT_LABEL[def.category])),
          tracked ? h('span.gs-badge.gold', 'Tracked') : null,
        ),
      );
    }
    const detail = h('div.gs-detail.gs-scroll', { 'aria-live': 'polite' });
    const cur = list.find((x) => x.def.id === this.sel);
    if (cur) this.questDetail(detail, cur.def, cur.prog);
    else detail.append(empty('Select a quest to read its entry.'));
    this.body.append(h('div.gs-pane.gs-pane-list', filters, listEl), detail);
  }

  private select(id: string, rerender = true): void {
    if (this.sel === id) return;
    this.sel = id;
    if (rerender) this.renderBody();
    else {
      for (const el of Array.from(this.body.querySelectorAll('.jr-q'))) el.classList.toggle('selected', (el as HTMLElement).dataset.quest === id);
      const detail = this.body.querySelector('.gs-detail') as HTMLElement | null;
      const q = this.ctx.quests;
      const def = q.get(id);
      if (detail && def) {
        clear(detail);
        this.questDetail(detail, def, q.active.get(id) ?? null);
      }
    }
  }

  private toggleTrack(id: string): void {
    const q = this.ctx.quests;
    q.track(q.tracked === id ? null : id);
    this.ctx.audio.play('ui_click', { bus: 'ui' });
    const focusQuest = (document.activeElement as HTMLElement | null)?.dataset.quest;
    this.refresh();
    if (focusQuest) (this.body.querySelector(`[data-quest="${focusQuest}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private questDetail(el: HTMLElement, def: QuestDef, prog: QuestProgress | null): void {
    const ctx = this.ctx;
    const q = ctx.quests;
    const region = def.region ? regionById(def.region)?.name : null;
    const giver = def.giver ? ctx.npcs.getDef(def.giver)?.name : null;
    el.append(
      h('div.gs-kicker', [CAT_LABEL[def.category], region, giver ? `from ${giver}` : null].filter(Boolean).join(' · ')),
      h('h3.gs-h', def.title),
      h('p.gs-lead', def.summary),
    );
    const steps = h('ol.jr-steps');
    def.steps.forEach((s, i) => {
      const done = !prog || i < prog.step;
      if (prog && i > prog.step) return;
      const li = h(`li.jr-step${done ? '.done' : '.current'}`, h('div.jr-step-text', done ? '✓ ' : '', s.text));
      if (!done && prog) {
        const objs = h('ul.jr-objs');
        s.objectives.forEach((o, k) => {
          const need = 'count' in o && typeof o.count === 'number' && o.count > 1 ? o.count : 0;
          const have = Math.min(prog.counts[k] ?? 0, need);
          objs.append(h(`li.jr-obj${prog.done[k] ? '.done' : ''}`, h('span.jr-obj-mark', prog.done[k] ? '✓' : '◇'), h('span.jr-obj-text', o.text), need ? h('span.jr-obj-count', `${have}/${need}`) : null, need ? meter(have / need, 'thin') : null));
        });
        if (s.any) objs.append(h('li.muted.jr-any', 'Any one of these will do.'));
        li.append(objs);
      }
      steps.append(li);
    });
    if (prog && prog.step < def.steps.length - 1) steps.append(h('li.jr-step.later', `${def.steps.length - prog.step - 1} more step${def.steps.length - prog.step - 1 > 1 ? 's' : ''} ahead…`));
    el.append(h('div.gs-sec', 'Progress'), steps);
    const r = def.rewards;
    if (r) {
      const rw = h('div.jr-rewards');
      if (r.xp) rw.append(h('span.jr-rw', h('b', `${r.xp}`), ' XP'));
      if (r.currency) rw.append(h('span.jr-rw', '🪙 ', h('b', `${r.currency}`), ' copper'));
      for (const it of r.items ?? []) {
        const d = itemById(it.id);
        rw.append(h('span.jr-rw', `${d?.icon ?? '◆'} ${d?.name ?? it.id}${it.count > 1 ? ` ×${it.count}` : ''}`));
      }
      for (const c of r.cosmetics ?? []) rw.append(h('span.jr-rw', `👘 ${cosmeticById(c)?.name ?? c}`));
      for (const t of r.techniques ?? []) rw.append(h('span.jr-rw', `✦ ${getTechnique(t)?.name ?? t}`));
      if (rw.childElementCount) el.append(h('div.gs-sec', 'Rewards'), rw);
    }
    if (prog) {
      const tracked = q.tracked === def.id;
      el.append(
        h(
          'div.gs-actions',
          h(`button.btn${tracked ? '' : '.primary'}`, { type: 'button', 'data-action': 'track', onclick: () => this.toggleTrack(def.id) }, tracked ? 'Stop Tracking' : 'Track Quest'),
          h('button.btn', { type: 'button', 'data-action': 'show-on-map', onclick: () => this.showOnMap(def.id) }, 'Show on Map'),
        ),
      );
    } else el.append(h('div.jr-stamp', 'Completed'));
  }

  private showOnMap(id: string): void {
    const m = this.ctx.quests.markers().find((x) => x.questId === id);
    if (this.ctx.quests.tracked !== id) this.ctx.quests.track(id);
    this.ui.close(this.id);
    this.ui.open('map', m ? { focus: { x: m.position.x, z: m.position.z } } : undefined);
  }

  // ---------------------------------------------------------------------------
  // Masters (rendered by the training module when present)
  // ---------------------------------------------------------------------------

  private renderMasters(): void {
    const ctx = this.ctx;
    const wrap = h('div.gs-scroll.gs-fill.jr-masters');
    this.body.append(wrap);
    const training = ctx.extra.get('training') as { renderJournal?(el: HTMLElement): void } | undefined;
    if (training?.renderJournal) {
      const holder = h('div');
      wrap.append(holder);
      training.renderJournal(holder);
      return;
    }
    const known = MASTERS.filter((m) => ctx.quests.hasFlag(`met_${m.id}`));
    if (!known.length) wrap.append(empty('No masters known yet.', 'Visit the great cities and temples — masters are marked ✦.'));
    for (const m of known) wrap.append(h('div.gs-card', h('h4', `${m.name} — ${m.title}`), h('div.muted', `${ELEMENT_INFO[m.element].name} · ${m.location}`)));
  }

  // ---------------------------------------------------------------------------
  // Mastery & Elements Sphere
  // ---------------------------------------------------------------------------

  private renderMastery(): void {
    const ctx = this.ctx;
    const pr = ctx.progression;
    const wrap = h('div.gs-scroll.gs-fill');
    const lessonTitle = (id: string) => {
      for (const m of MASTERS) {
        const l = m.lessons.find((x) => x.id === id);
        if (l) return `${l.title} (${m.name})`;
      }
      return id;
    };
    const grid = h('div.jr-mastery');
    for (const e of ELEMENTS) {
      const m = pr.mastery[e];
      const req = MASTERY_REQUIREMENTS[e];
      const bend = pr.canBend(e);
      const pct = Math.round(pr.masteryProgress(e) * 100);
      const status = m.mastered ? 'Mastered' : bend ? 'Learning' : 'Not yet awakened';
      const card = h(
        `div.gs-card.jr-el.el-${e}${m.mastered ? '.mastered' : ''}${bend ? '' : '.dim'}`,
        { 'data-element': e, style: { '--el': ELEMENT_COLORS[e].glow } as unknown as Partial<CSSStyleDeclaration> },
        h('div.jr-el-head', emblem(e, 'emblem jr-el-emblem'), h('div', h('h4', `${ELEMENT_INFO[e].name}bending`), h('div.muted', ELEMENT_INFO[e].nation)), h('div.spacer'), h('div.jr-el-pct', h('b', `${pct}%`), h('span', status))),
        h('div.jr-req', h('span', `${m.proficiency >= req.proficiency ? '✓' : '◇'} Proficiency`), h('span.muted', `${Math.floor(m.proficiency)} / ${req.proficiency}`)),
        meter(m.proficiency / req.proficiency, 'el'),
        h('div.jr-req', h('span', `${m.lessons.length >= req.lessons ? '✓' : '◇'} Master lessons`), h('span.muted', `${m.lessons.length} / ${req.lessons}`)),
        h('div.jr-lessons', m.lessons.length ? m.lessons.map((l) => h('div', `· ${lessonTitle(l)}`)) : h('div.muted', bend ? 'Find a master of this element to learn from.' : 'Awaken this element with one of its masters first.')),
        h('div.jr-req', h('span', `${m.trialComplete ? '✓' : '◇'} ${req.trialName}`), h('span.muted', m.trialComplete ? 'Passed' : pr.trialAvailable(e) ? 'Ready — see the grandmaster' : 'Locked')),
        h('div.muted.jr-note', 'Proficiency grows as you bend in combat and training. Knowing techniques is not mastery.'),
      );
      grid.append(card);
    }
    const sphere = pr.elementsSphereUnlocked;
    const orbs = h('div.jr-orbs', ...ELEMENTS.map((e) => h(`span.jr-orb${pr.mastery[e].mastered ? '.lit' : ''}`, { title: `${ELEMENT_INFO[e].name}: ${pr.mastery[e].mastered ? 'mastered' : 'not mastered'}`, style: { color: ELEMENT_COLORS[e].glow } }, emblem(e, 'emblem'))));
    wrap.append(
      h(
        `div.gs-card.jr-sphere${sphere ? '.awake' : ''}`,
        { 'data-sphere': sphere ? 'unlocked' : 'locked' },
        orbs,
        h(
          'div',
          h('h4', sphere ? 'The Elements Sphere is awakened' : 'The Elements Sphere'),
          h('p', sphere ? `Enter the Avatar State (${ctx.input.label('avatarState')}) to call the Sphere: Hurricane, Tsunami, Earthquake, Fire Tornado and the Avatar Cataclysm take your technique slots.` : `Master all four elements to awaken it — ${pr.masteredCount} of 4 mastered. The Avatar State is yours already: press ${ctx.input.label('avatarState')}.`),
        ),
      ),
      grid,
    );
    this.body.append(wrap);
  }

  // ---------------------------------------------------------------------------
  // Bestiary & companions
  // ---------------------------------------------------------------------------

  private renderBestiary(): void {
    const cs = this.ctx.companions;
    const wrap = h('div.gs-scroll.gs-fill');
    wrap.append(h('div.gs-sec', `Companions (${cs.bonded.length})`));
    if (!cs.bonded.length) wrap.append(h('p.muted', 'No bonded companions yet. Look for tracks, nests and herds in the wild — and bring the food they love.'));
    const cg = h('div.gs-grid');
    for (const c of cs.bonded) {
      const s = speciesById(c.speciesId);
      cg.append(h('div.gs-card.jr-beast', { 'data-companion': c.id }, h('h4', c.name), h('div.muted', `${s?.name ?? c.speciesId} · ${bondLevelName(c.bond)}`), meter(c.bond / 100, 'gold', `Bond ${Math.round(c.bond)}%`), c.abilities.length ? h('div.jr-tags', c.abilities.map((a) => h('span.gs-tag', a))) : null));
    }
    if (cs.bonded.length) wrap.append(cg);
    const known = SPECIES.filter((s) => cs.discoveredSpecies.has(s.id));
    const unknown = SPECIES.length - known.length;
    wrap.append(h('div.gs-sec', `Creatures discovered (${known.length}/${SPECIES.length})`));
    const g = h('div.gs-grid');
    for (const s of known) {
      const food = [...s.diet.preferred, ...s.diet.liked].map((i) => itemById(i)?.name ?? i).slice(0, 3).join(', ');
      g.append(h('div.gs-card.jr-beast', { 'data-species': s.id }, h('h4', s.name), h('div.muted', `${s.role === 'ambient' ? 'Wildlife' : s.role === 'mount' ? 'Mount' : 'Pet'} · ${s.temperament}${s.tameable ? ' · can be befriended' : ''}`), h('p', s.description), h('div.jr-kv', h('b', 'Habitat '), s.habitatText), food ? h('div.jr-kv', h('b', 'Eats '), food) : null));
    }
    if (!known.length) g.append(h('p.muted', 'You have not catalogued any creatures yet.'));
    wrap.append(g);
    if (unknown > 0) wrap.append(h('p.muted.jr-note', `${unknown} creature${unknown > 1 ? 's' : ''} still undiscovered.`));
    const habs = HABITATS.filter((x) => cs.habitatsKnown.has(x.id));
    if (habs.length) wrap.append(h('div.gs-sec', 'Habitats found'), h('div.jr-tags', habs.map((x) => h('span.gs-tag', `${x.name} — ${speciesById(x.species)?.name ?? x.species}`))));
    this.body.append(wrap);
  }

  // ---------------------------------------------------------------------------
  // Lore
  // ---------------------------------------------------------------------------

  private loreEntries(): Array<{ id: string; group: string; title: string; text: string }> {
    const ctx = this.ctx;
    const pr = ctx.progression;
    const out: Array<{ id: string; group: string; title: string; text: string }> = [];
    for (const l of LORE) {
      const u = l.unlock;
      const ok = u.always || (u.element && pr.canBend(u.element)) || (u.mastered && pr.mastery[u.mastered].mastered) || (u.sphere && pr.elementsSphereUnlocked) || (u.item && ctx.inventory.has(u.item)) || (u.flag && ctx.quests.hasFlag(u.flag));
      if (ok) out.push({ id: l.id, group: l.group, title: l.title, text: l.text });
    }
    for (const r of REGIONS) {
      if (ctx.world.visitedRegions.has(r.id)) out.push({ id: `region:${r.id}`, group: 'Places', title: r.name, text: r.blurb });
    }
    for (const lm of LANDMARKS) {
      if (lm.blurb && ctx.world.discovered.has(lm.id)) out.push({ id: `lm:${lm.id}`, group: 'Places', title: lm.name, text: lm.blurb });
    }
    return out;
  }

  private renderLore(): void {
    this.body.classList.add('gs-panes');
    const entries = this.loreEntries();
    if (!this.loreSel || !entries.some((x) => x.id === this.loreSel)) this.loreSel = entries[0]?.id ?? null;
    const list = h('div.gs-list.gs-scroll', { role: 'listbox', 'aria-label': 'Lore' });
    let group = '';
    for (const en of entries) {
      if (en.group !== group) {
        group = en.group;
        list.append(h('div.gs-sec', group));
      }
      list.append(h(`button.jr-q${this.loreSel === en.id ? '.selected' : ''}`, { type: 'button', 'data-lore': en.id, onclick: () => ((this.loreSel = en.id), this.renderBody()), onfocus: () => this.showLore(en.id) }, h('span.jr-q-mark', '❖'), h('span.jr-q-main', h('span.jr-q-title', en.title))));
    }
    const detail = h('div.gs-detail.gs-scroll.jr-lore');
    this.body.append(h('div.gs-pane.gs-pane-list', list), detail);
    this.showLore(this.loreSel);
    const locked = LORE.length - entries.filter((e) => !e.id.includes(':')).length;
    if (locked > 0) list.append(h('p.muted.jr-note', `${locked} entries yet to be uncovered — bend, master, explore and collect relics.`));
  }

  private showLore(id: string | null): void {
    const detail = this.body.querySelector('.jr-lore') as HTMLElement | null;
    if (!detail) return;
    this.loreSel = id;
    for (const el of Array.from(this.body.querySelectorAll('[data-lore]'))) el.classList.toggle('selected', (el as HTMLElement).dataset.lore === id);
    clear(detail);
    const en = this.loreEntries().find((x) => x.id === id);
    if (!en) {
      detail.append(empty('No lore recorded yet.'));
      return;
    }
    detail.append(h('div.gs-kicker', en.group), h('h3.gs-h', en.title), h('p.jr-lore-text', en.text));
  }
}

export function elementName(e: Element): string {
  return ELEMENT_INFO[e].name;
}
