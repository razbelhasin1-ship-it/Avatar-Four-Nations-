import type { GameContext } from '../core/GameContext';
import { keyHints } from '../core/Input';
import { BOND_LEVELS, bondLevel, bondLevelName, HABITATS, SPECIES, speciesById, trustStage, type SpeciesDef } from '../data/creatures';
import { itemById } from '../data/items';
import { COMPANION_PRICES, SHOPS } from '../shop/stock';
import { regionById } from '../world/WorldLayout';
import { clear, h } from '../ui/dom';
import type { Screen, UIManager } from '../ui/UIManager';
import type { CompanionSystem, CompanionRecord } from './CompanionSystem';

/**
 * Companion Stable (P): bonded companions (portrait icon, name + rename, species,
 * bond level and unlocks, habitat, rideable/flying badges, set active,
 * summon / dismiss, return home) and the bestiary of discovered species with
 * habitat notes, diet, taming tips and the trust of animals you are taming.
 * Opened with `{ name: id }` right after bonding to name the new companion.
 */

export const SPECIES_ICON: Record<string, string> = {
  sky_bison: '🦬',
  dragon: '🐉',
  polar_bear_dog: '🐻‍❄️',
  badgermole: '🦡',
  ostrich_horse: '🐦',
  komodo_rhino: '🦏',
  winged_lemur: '🐒',
  turtle_duck: '🦆',
  otter_penguin: '🐧',
  cat_owl: '🦉',
  armadillo_lizard: '🦎',
  hog_monkey: '🐗',
  elephant_koi: '🐟',
};

export class StableScreen implements Screen {
  readonly id = 'companions';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private ctx!: GameContext;
  private body: HTMLElement;
  private tab: 'companions' | 'bestiary' = 'companions';
  private naming: string | null = null;
  private tabs: HTMLElement;

  constructor(private readonly ui: UIManager, private readonly sys: CompanionSystem) {
    this.tabs = h('div.row', { style: { gap: '6px' } });
    const header = h('div.modal-header', h('h2.title', 'Companion Stable'), h('div.spacer'), this.tabs, h('button.btn.small', { onclick: () => this.ui.close(), 'data-action': 'close', style: { marginLeft: '10px' } }, 'Close'));
    this.body = h('div.scroll', { style: { flex: '1', minHeight: '0', paddingRight: '8px' } });
    const box = h('div.modal.panel', { style: { height: 'min(780px, calc(100vh - 32px))', width: 'min(1040px, calc(100vw - 32px))', maxWidth: 'none' } }, header, this.body);
    this.el = h('div.modal-backdrop.companion-stable', box);
  }

  onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    const a = arg as { name?: string; tab?: 'companions' | 'bestiary' } | undefined;
    this.naming = a?.name ?? null;
    if (a?.tab) this.tab = a.tab;
    if (this.naming) this.tab = 'companions';
    this.render();
  }

  onClose(): void {
    this.naming = null;
  }

  private setTab(t: 'companions' | 'bestiary'): void {
    this.tab = t;
    this.render();
  }

  render(): void {
    clear(this.tabs);
    for (const [id, label] of [
      ['companions', `Companions (${this.sys.bonded.length})`],
      ['bestiary', `Bestiary (${this.sys.discoveredSpecies.size}/${SPECIES.length})`],
    ] as const) {
      this.tabs.append(h(`button.btn.small${this.tab === id ? '.primary' : ''}`, { 'data-tab': id, onclick: () => this.setTab(id) }, label));
    }
    clear(this.body);
    if (this.tab === 'companions') this.renderCompanions();
    else this.renderBestiary();
  }

  // ---------------------------------------------------------------- companions

  private renderCompanions(): void {
    const sys = this.sys;
    if (this.naming) {
      const r = sys.record(this.naming);
      if (r) this.body.append(this.namingPanel(r));
    }
    if (!sys.bonded.length) {
      this.body.append(
        h('p.muted', 'You have not bonded with any animals yet.'),
        h('p', 'Look for tracks, nests, fur and burrows in the wild. Approach animals calmly — walk, never run — and bring the food they love. Each species earns trust differently; open the Bestiary to learn what you have discovered.'),
      );
      return;
    }
    const grid = h('div.grid-cards', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } });
    for (const r of sys.bonded) grid.append(this.card(r));
    this.body.append(grid);
  }

  private namingPanel(r: CompanionRecord): HTMLElement {
    const def = speciesById(r.speciesId)!;
    const input = h('input', { type: 'text', value: r.name, maxLength: 24, 'data-role': 'name-input', style: { flex: '1', padding: '6px 8px', fontSize: '16px' } }) as HTMLInputElement;
    const save = () => {
      if (this.sys.rename(r.id, input.value)) {
        this.ctx.events.emit('ui:notify', { text: `Welcome to the family, ${r.name}!`, kind: 'success', duration: 3, icon: '💛' });
        this.naming = null;
        this.render();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
    const suggestions = h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } }, ...def.names.slice(0, 6).map((n) => h('button.btn.small', { onclick: () => ((input.value = n), input.focus()) }, n)));
    return h(
      'div.card',
      { style: { borderColor: 'var(--gold-2)', marginBottom: '14px' } },
      h('h3', `${SPECIES_ICON[def.id] ?? '🐾'} Name your new ${def.name}`),
      h('p.muted', 'Bonds are for life. What will you call your companion?'),
      h('div.row', { style: { gap: '8px' } }, input, h('button.btn.primary', { 'data-action': 'confirm-name', onclick: save }, 'Name')),
      suggestions,
    );
  }

  private card(r: CompanionRecord): HTMLElement {
    const sys = this.sys;
    const def = speciesById(r.speciesId)!;
    const live = sys.creatureFor(r.id);
    const out = !!r.summoned && !!live && live.state !== 'leave';
    const riding = sys.riding.mount === live && !!live;
    const lvl = bondLevel(r.bond);
    const next = BOND_LEVELS[lvl];
    const badges = h('div.row', { style: { gap: '4px', flexWrap: 'wrap', margin: '4px 0' } });
    const badge = (t: string, c: string) => h('span', { style: { fontSize: '11px', padding: '1px 6px', borderRadius: '8px', background: c, color: '#111' } }, t);
    badges.append(badge(def.role === 'mount' ? 'Mount' : 'Pet', '#e9d9a8'));
    if (def.rideable) badges.append(badge('Rideable', '#a8d8a0'));
    if (def.flying) badges.append(badge(def.rideable ? 'Flying' : 'Flies', '#a8c8f0'));
    if (r.active) badges.append(badge('Active', '#f0c060'));
    if (out) badges.append(badge(riding ? 'Riding' : 'With you', '#f0a0a0'));
    const unlocks = h('div', { style: { fontSize: '12px', margin: '6px 0' } });
    for (const u of def.bondUnlocks) {
      const got = r.bond >= u.at;
      const desc = keyHints(this.ctx.input, u.description);
      unlocks.append(h('div', { style: { opacity: got ? '1' : '0.55' }, title: desc }, `${got ? '✓' : '🔒'} ${u.name}${got ? '' : ` (${u.at}%)`} — ${desc}`));
    }
    const nameInput = h('input', { type: 'text', value: r.name, maxLength: 24, style: { width: '120px', padding: '2px 6px' } }) as HTMLInputElement;
    const hab = r.habitat ? HABITATS.find((x) => x.id === r.habitat) : undefined;
    const buttons = h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } });
    if (!r.active) buttons.append(h('button.btn.small', { 'data-action': 'activate', onclick: () => (sys.setActive(r.id), this.render()) }, 'Set active'));
    if (out) buttons.append(h('button.btn.small', { 'data-action': 'dismiss', onclick: () => (sys.dismiss(r.id), this.render()) }, 'Dismiss'));
    else buttons.append(h('button.btn.small.primary', { 'data-action': 'summon', onclick: () => (sys.summon(r.id), this.ui.close()) }, 'Summon'));
    buttons.append(h('button.btn.small', { 'data-action': 'home', onclick: () => (sys.dismiss(r.id, true), this.ctx.events.emit('ui:notify', { text: `${r.name} heads home${hab ? ` to ${hab.name}` : ''}.`, kind: 'info', duration: 2.5 }), this.render()) }, 'Return home'));
    return h(
      'div.card',
      { 'data-companion': r.id, style: { borderColor: r.active ? 'var(--gold-2)' : undefined } },
      h(
        'div.row',
        { style: { gap: '10px', alignItems: 'center' } },
        h('div', { style: { fontSize: '42px', width: '58px', height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px', background: 'radial-gradient(circle at 40% 35%, rgba(255,240,200,.35), rgba(0,0,0,.25))' } }, SPECIES_ICON[def.id] ?? '🐾'),
        h('div', { style: { flex: '1' } }, h('h4', { style: { margin: '0' } }, r.name), h('div.muted', { style: { fontSize: '12px' } }, def.name), badges),
      ),
      h('div', { style: { fontSize: '13px', marginTop: '6px' } }, `Bond ${Math.round(r.bond)}% · ${bondLevelName(r.bond)}${next ? ` · next: ${next.name} at ${next.at}%` : ''}`),
      h('div.bar', { style: { marginTop: '4px' } }, h('div.fill', { style: { transform: `scaleX(${r.bond / 100})`, background: 'linear-gradient(90deg,#8a6a2a,#f1d48a)' } })),
      unlocks,
      h('div.muted', { style: { fontSize: '12px' } }, `Home: ${hab?.name ?? 'wherever you are'} · Favourite food: ${def.diet.preferred.map((i) => itemById(i)?.name ?? i).join(', ') || def.diet.liked.map((i) => itemById(i)?.name ?? i).join(', ') || '—'}`),
      h('div.row', { style: { gap: '6px', marginTop: '6px', alignItems: 'center' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Rename:'), nameInput, h('button.btn.small', { 'data-action': 'rename', onclick: () => (sys.rename(r.id, nameInput.value), this.render()) }, 'Save')),
      buttons,
    );
  }

  // ---------------------------------------------------------------- bestiary

  private renderBestiary(): void {
    const sys = this.sys;
    this.body.append(h('p.muted', 'Creatures you have seen up close. Habitats are revealed by clues — tracks, nests, burrows — and by visiting them.'));
    const grid = h('div.grid-cards', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' } });
    for (const s of SPECIES) grid.append(this.speciesCard(s, sys.discoveredSpecies.has(s.id)));
    this.body.append(grid);
  }

  private speciesCard(s: SpeciesDef, known: boolean): HTMLElement {
    const sys = this.sys;
    const habs = HABITATS.filter((hb) => hb.species === s.id);
    const knownHabs = habs.filter((hb) => sys.habitatsKnown.has(hb.id));
    if (!known) {
      return h(
        'div.card.locked',
        { 'data-species': s.id },
        h('h4', '❔ Undiscovered'),
        h('p.muted', { style: { fontSize: '12px' } }, knownHabs.length ? `You found signs of something at ${knownHabs.map((x) => x.name).join(', ')}.` : s.role === 'ambient' ? 'Wildlife of the wider world.' : 'Somewhere out there…'),
      );
    }
    const taming = [...sys.taming.trust.entries()].filter(([uid]) => habs.some((hb) => uid.startsWith(`${hb.id}#`)) && !sys.isUidBonded(uid));
    const diet = [...s.diet.preferred.map((i) => `${itemById(i)?.name ?? i} (favourite)`), ...s.diet.liked.map((i) => itemById(i)?.name ?? i)].join(', ') || '—';
    const sellers = SHOPS.filter((x) => x.companions?.includes(s.id));
    return h(
      'div.card',
      { 'data-species': s.id },
      h('div.row', { style: { gap: '8px', alignItems: 'center' } }, h('span', { style: { fontSize: '30px' } }, SPECIES_ICON[s.id] ?? '🐾'), h('div', h('h4', { style: { margin: '0' } }, s.name), h('div.muted', { style: { fontSize: '11px' } }, `${s.role === 'ambient' ? 'Wildlife' : s.role === 'mount' ? 'Mount' : 'Pet'} · ${s.temperament} · ~${s.size.length} m`))),
      h('p', { style: { fontSize: '13px', margin: '6px 0' } }, s.description),
      h('div', { style: { fontSize: '12px' } }, h('b', 'Habitat: '), s.habitatText ?? '—'),
      knownHabs.length ? h('div', { style: { fontSize: '12px' } }, h('b', 'Known places: '), knownHabs.map((x) => x.name).join(', ')) : null,
      s.tameable ? h('div', { style: { fontSize: '12px' } }, h('b', 'Diet: '), diet) : null,
      s.tameable ? h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', 'Taming: '), s.tamingTips) : h('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, 'Cannot be tamed.'),
      taming.length ? h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', 'Earning trust: '), taming.map(([, v]) => `${Math.round(v)}% (${trustStage(v)})`).join(' · ')) : null,
      sellers.length ? h('div', { style: { fontSize: '12px', marginTop: '4px' } }, h('b', 'For sale: '), `${sellers.map((x) => `${x.merchant}, ${x.title} in ${regionById(x.region)?.name ?? 'the city'}`).join('; ')} (${COMPANION_PRICES[s.id]} copper)`) : null,
      sys.bonded.some((r) => r.speciesId === s.id) ? h('div', { style: { fontSize: '12px', color: 'var(--gold)' } }, `Bonded: ${sys.bonded.filter((r) => r.speciesId === s.id).map((r) => r.name).join(', ')}`) : null,
    );
  }
}
