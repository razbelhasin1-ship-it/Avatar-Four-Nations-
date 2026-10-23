import * as THREE from 'three';
import { cosmeticById, COSMETICS, EMPTY_SLOT_IDS, type CosmeticSlot } from '../../data/cosmetics';
import { itemById } from '../../data/items';
import { allTechniques, getTechnique } from '../../combat/CombatSystem';
import type { GameContext } from '../../core/GameContext';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { MASTERY_REQUIREMENTS, SLOT_COUNT } from '../../progression/Progression';
import { heightAt, waterAt } from '../../world/Heightfield';
import { LANDMARKS, REGIONS, WORLD_HALF } from '../../world/WorldLayout';
import { cloneAppearance, type OutfitSlots } from '../../character/Appearance';
import { clear, h } from '../dom';
import { emblem, iconHTML } from '../icons';
import type { Screen, UIManager } from '../UIManager';

abstract class ModalScreen implements Screen {
  abstract readonly id: string;
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  protected ctx!: GameContext;
  protected box: HTMLElement;
  protected body: HTMLElement;
  protected header: HTMLElement;

  constructor(protected readonly ui: UIManager, title: string) {
    this.header = h('div.modal-header', h('h2.title', title), h('div.spacer'), h('button.btn.small', { onclick: () => this.ui.close(), 'data-action': 'close' }, 'Close'));
    this.body = h('div.scroll', { style: { flex: '1', minHeight: '0', paddingRight: '8px' } });
    this.box = h('div.modal.panel', { style: { height: 'min(760px, calc(100vh - 32px))' } }, this.header, this.body);
    this.el = h('div.modal-backdrop', this.box);
  }

  onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.render();
  }

  abstract render(): void;
}

// ---------------------------------------------------------------------------

class JournalScreen extends ModalScreen {
  readonly id = 'journal';
  private tab: 'active' | 'completed' | 'mastery' | 'masters' = 'active';
  constructor(ui: UIManager) {
    super(ui, 'Journal');
  }
  render(): void {
    const ctx = this.ctx;
    clear(this.body);
    const tabs = h('div.tabs', { style: { marginBottom: '10px' } });
    for (const [id, label] of [['active', 'Active Quests'], ['completed', 'Completed'], ['mastery', 'Element Mastery'], ['masters', 'Known Masters']] as const) tabs.append(h(`button.tab${this.tab === id ? '.active' : ''}`, { onclick: () => { this.tab = id; this.render(); } }, label));
    this.body.append(tabs);
    const q = ctx.quests;
    if (this.tab === 'active') {
      if (!q.active.size) this.body.append(h('p.muted', 'No active quests. Explore, and speak with the people of the Four Nations.'));
      for (const [id, prog] of q.active) {
        const def = q.get(id)!;
        const step = def.steps[prog.step];
        this.body.append(
          h(
            'div.card',
            { style: { marginBottom: '10px', borderColor: q.tracked === id ? 'var(--gold-2)' : undefined } },
            h('div.row', h('h4', def.title), h('span.muted', `· ${def.category}`), h('div.spacer'), h('button.btn.small', { onclick: () => { q.track(id); this.render(); } }, q.tracked === id ? 'Tracked' : 'Track')),
            h('p.muted', { style: { margin: '4px 0 8px' } }, def.summary),
            step ? h('div', h('div', { style: { marginBottom: '4px' } }, step.text), ...step.objectives.map((o, i) => h('div', { style: { color: prog.done[i] ? 'var(--muted)' : 'var(--text)' } }, `${prog.done[i] ? '✓' : '◇'} ${o.text}`))) : null,
            h('div.muted', { style: { fontSize: '12px', marginTop: '6px' } }, `Step ${prog.step + 1} of ${def.steps.length}`),
          ),
        );
      }
    } else if (this.tab === 'completed') {
      if (!q.completed.size) this.body.append(h('p.muted', 'Nothing completed yet.'));
      for (const id of q.completed) {
        const def = q.get(id);
        if (def) this.body.append(h('div.card', { style: { marginBottom: '8px' } }, h('h4', `✓ ${def.title}`), h('p.muted', { style: { margin: 0 } }, def.summary)));
      }
    } else if (this.tab === 'mastery') {
      const pr = ctx.progression;
      for (const e of ELEMENTS) {
        const m = pr.mastery[e];
        const req = MASTERY_REQUIREMENTS[e];
        this.body.append(
          h(
            'div.card',
            { style: { marginBottom: '10px' } },
            h('div.row', emblem(e, 'emblem'), h('h4', `${ELEMENT_INFO[e].name}bending`), h('div.spacer'), h('span', m.mastered ? 'MASTERED' : pr.canBend(e) ? `${Math.round(pr.masteryProgress(e) * 100)}%` : 'Not yet learned')),
            h('div', `${m.proficiency >= req.proficiency ? '✓' : '◇'} Proficiency: ${Math.floor(m.proficiency)} / ${req.proficiency} (earned by bending in combat and training)`),
            h('div', `${m.lessons.length >= req.lessons ? '✓' : '◇'} Master lessons completed: ${m.lessons.length} / ${req.lessons}`),
            h('div', `${m.trialComplete ? '✓' : '◇'} ${req.trialName}${pr.trialAvailable(e) ? ' — available from the grandmaster!' : ''}`),
          ),
        );
      }
      this.body.append(h('p.muted', pr.elementsSphereUnlocked ? 'The Elements Sphere is awakened. Enter the Avatar State to wield it.' : 'Master all four elements to awaken the Elements Sphere.'));
    } else {
      const masters = [...ctx.npcs.allDefs()].filter((d) => d.role === 'master');
      if (!masters.length) this.body.append(h('p.muted', 'No masters known yet.'));
      for (const d of masters) {
        const region = REGIONS.find((r) => Math.hypot(r.x - d.x, r.z - d.z) < r.r);
        const known = ctx.world.discovered.has(region ? LANDMARKS.find((l) => l.regionId === region.id)?.id ?? '' : '') || ctx.quests.hasFlag(`met_${d.id}`);
        this.body.append(h(`div.card${known ? '' : '.locked'}`, { style: { marginBottom: '8px' } }, h('h4', `${d.name}${d.title ? ` — ${d.title}` : ''}`), h('div.muted', `${d.element ? ELEMENT_INFO[d.element].name + ' master' : 'Master'} · ${region?.name ?? 'Unknown location'}`)));
      }
    }
  }
}

// ---------------------------------------------------------------------------

class TechniquesScreen extends ModalScreen {
  readonly id = 'techniques';
  private element: Element = 'air';
  private picking: string | null = null;
  constructor(ui: UIManager) {
    super(ui, 'Technique Library');
  }
  override onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    this.element = ctx.player?.element ?? 'air';
    this.render();
  }
  render(): void {
    const ctx = this.ctx;
    const pr = ctx.progression;
    clear(this.body);
    const tabs = h('div.tabs', { style: { marginBottom: '10px' } });
    for (const e of ELEMENTS) tabs.append(h(`button.tab${this.element === e ? '.active' : ''}`, { onclick: () => { this.element = e; this.picking = null; this.render(); } }, `${ELEMENT_INFO[e].name}${pr.canBend(e) ? '' : ' 🔒'}`));
    tabs.append(h(`button.tab${(this.element as string) === 'avatar' ? '.active' : ''}`, { onclick: () => { this.element = 'avatar' as any; this.render(); } }, 'Avatar'));
    this.body.append(tabs);
    const e = this.element;
    if ((e as string) !== 'avatar') {
      const slots = pr.slotsFor(e);
      const slotRow = h('div.row', { style: { marginBottom: '12px', flexWrap: 'wrap' } }, h('span.muted', this.picking ? 'Choose a slot for ' + (getTechnique(this.picking)?.name ?? '') + ':' : 'Equipped (keys 1–4):'));
      for (let i = 0; i < SLOT_COUNT; i++) {
        const def = slots[i] ? getTechnique(slots[i]!) : null;
        slotRow.append(
          h(`button.btn.small${this.picking ? '.primary' : ''}`, {
            onclick: () => {
              if (this.picking) {
                pr.equip(e, i, this.picking);
                this.picking = null;
              } else if (slots[i]) pr.equip(e, i, null);
              this.render();
            },
          }, `${i + 1}: ${def?.name ?? 'Empty'}`),
        );
      }
      this.body.append(slotRow);
    }
    const defs = allTechniques().filter((t) => t.element === e).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    const grid = h('div.grid-cards');
    for (const d of defs) {
      const known = pr.knows(d.id);
      const equippable = known && (d.kind === 'ability' || d.kind === 'defense' || d.kind === 'movement');
      grid.append(
        h(
          `div.card${known ? '' : '.locked'}`,
          h('div.row', h('span', { html: iconHTML(d.icon) }), h('h4', d.name), h('div.spacer'), h('span.muted', { style: { fontSize: '12px' } }, `${d.kind} · tier ${d.tier}`)),
          h('p', { style: { margin: '4px 0', fontSize: '14px' } }, d.description),
          h('div.muted', { style: { fontSize: '13px' } }, d.usage),
          h('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, `Chi ${d.chiCost}${d.cooldown ? ` · Cooldown ${d.cooldown}s` : ''}${d.water ? ` · Water ${d.water.amount}` : ''}`),
          known ? (equippable ? h('button.btn.small', { style: { marginTop: '6px' }, onclick: () => { this.picking = d.id; this.render(); } }, 'Equip…') : null) : h('div', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--gold)' } }, d.kind === 'ultimate' || d.kind === 'combined' ? 'Awakens with the Elements Sphere' : 'Learn from a master'),
        ),
      );
    }
    this.body.append(grid);
  }
}

// ---------------------------------------------------------------------------

let mapImage: HTMLCanvasElement | null = null;
function buildMapImage(size = 320): HTMLCanvasElement {
  if (mapImage) return mapImage;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -WORLD_HALF + ((px + 0.5) / size) * WORLD_HALF * 2;
      const z = -WORLD_HALF + ((py + 0.5) / size) * WORLD_HALF * 2;
      const hh = heightAt(x, z);
      const hx = heightAt(x + 12, z) - hh;
      const w = waterAt(x, z, hh);
      let r: number, gg: number, b: number;
      if (w) {
        if (w.frozen) [r, gg, b] = [205, 225, 236];
        else [r, gg, b] = [92 - Math.min(40, (w.level - hh) * 2), 132 - Math.min(40, (w.level - hh) * 2), 160];
      } else {
        const t = Math.min(1, Math.max(0, hh / 260));
        const cold = z < -1100 || (z > 1480 && Math.abs(x - 220) < 600);
        if (cold) [r, gg, b] = [236, 238, 240];
        else [r, gg, b] = [196 - t * 60, 186 - t * 70 + (hh < 3 ? 0 : 0), 146 - t * 50];
        const shade = 1 - Math.max(-0.25, Math.min(0.25, hx * 0.08));
        r *= shade;
        gg *= shade;
        b *= shade;
      }
      const o = (py * size + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mapImage = c;
  return c;
}

class MapScreen extends ModalScreen {
  readonly id = 'map';
  private canvas: HTMLCanvasElement;
  private info: HTMLElement;
  private zoom = 1;
  private center = { x: 0, z: 0 };
  constructor(ui: UIManager) {
    super(ui, 'World Map');
    this.canvas = h('canvas', { style: { width: '100%', height: '100%', borderRadius: '8px', cursor: 'crosshair' } }) as HTMLCanvasElement;
    this.info = h('div.muted', { style: { fontSize: '14px', marginTop: '6px' } }, 'Click a discovered location with ⟡ to fast travel. Scroll to zoom.');
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(1, Math.min(6, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.draw();
    }, { passive: false });
  }
  override onOpen(ctx: GameContext): void {
    this.ctx = ctx;
    const p = ctx.player;
    this.center = p ? { x: p.position.x, z: p.position.z } : { x: 0, z: 0 };
    this.render();
  }
  render(): void {
    clear(this.body);
    this.body.style.display = 'flex';
    this.body.style.flexDirection = 'column';
    const wrap = h('div', { style: { flex: '1', minHeight: '300px', position: 'relative' } }, this.canvas);
    this.body.append(wrap, this.info);
    requestAnimationFrame(() => this.draw());
  }
  private view(): { scale: number; ox: number; oz: number; w: number; hgt: number } {
    const w = this.canvas.clientWidth || 600;
    const hgt = this.canvas.clientHeight || 400;
    const scale = (Math.min(w, hgt) / (WORLD_HALF * 2)) * this.zoom;
    const cx = this.zoom > 1 ? this.center.x : 0;
    const cz = this.zoom > 1 ? this.center.z : 0;
    return { scale, ox: w / 2 - cx * scale, oz: hgt / 2 - cz * scale, w, hgt };
  }
  private draw(): void {
    const c = this.canvas;
    const w = c.clientWidth || 600, hgt = c.clientHeight || 400;
    c.width = w * devicePixelRatio;
    c.height = hgt * devicePixelRatio;
    const g = c.getContext('2d')!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.fillStyle = '#1c3a52';
    g.fillRect(0, 0, w, hgt);
    const v = this.view();
    const img = buildMapImage();
    g.imageSmoothingEnabled = true;
    g.drawImage(img, v.ox - WORLD_HALF * v.scale, v.oz - WORLD_HALF * v.scale, WORLD_HALF * 2 * v.scale, WORLD_HALF * 2 * v.scale);
    const ctx = this.ctx;
    g.font = '12px Cinzel, serif';
    g.textAlign = 'center';
    for (const r of REGIONS) {
      if (!r.known && !ctx.world.visitedRegions.has(r.id)) continue;
      g.fillStyle = 'rgba(40,25,10,0.75)';
      g.fillText(r.name.toUpperCase(), v.ox + r.x * v.scale, v.oz + r.z * v.scale - 14);
    }
    for (const l of LANDMARKS) {
      const disc = ctx.world.discovered.has(l.id);
      if (!disc && l.hidden) continue;
      const x = v.ox + l.x * v.scale, y = v.oz + l.z * v.scale;
      g.fillStyle = disc ? (l.fastTravel ? '#ffd27a' : '#f4ead6') : 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(x, y, l.kind === 'capital' || l.kind === 'temple' ? 5 : 3.5, 0, Math.PI * 2);
      g.fill();
      if (disc && (this.zoom > 1.5 || l.kind === 'capital' || l.kind === 'temple')) {
        g.fillStyle = '#1a120a';
        g.fillText((l.fastTravel ? '⟡ ' : '') + l.name, x, y - 8);
      }
    }
    for (const m of ctx.quests.markers()) {
      const x = v.ox + m.position.x * v.scale, y = v.oz + m.position.z * v.scale;
      g.fillStyle = m.tracked ? '#ffcc33' : '#e0e0e0';
      g.font = '16px serif';
      g.fillText('◆', x, y + 5);
      g.font = '12px Cinzel, serif';
    }
    const p = ctx.player;
    if (p) {
      const x = v.ox + p.position.x * v.scale, y = v.oz + p.position.z * v.scale;
      g.save();
      g.translate(x, y);
      g.rotate(-p.yaw + Math.PI);
      g.fillStyle = '#ff5a3a';
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(6, 7);
      g.lineTo(0, 3);
      g.lineTo(-6, 7);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view();
    const wx = (e.clientX - rect.left - v.ox) / v.scale;
    const wz = (e.clientY - rect.top - v.oz) / v.scale;
    let best = null as (typeof LANDMARKS)[number] | null;
    let bd = 18 / v.scale;
    for (const l of LANDMARKS) {
      if (!l.fastTravel || !this.ctx.world.discovered.has(l.id)) continue;
      const d = Math.hypot(l.x - wx, l.z - wz);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (!best) return;
    const target = best;
    this.ui.confirm(`Fast travel to ${target.name}?`, [
      {
        text: 'Travel',
        primary: true,
        onClick: () => {
          this.ui.closeAll();
          const ctx = this.ctx;
          const off = new THREE.Vector3(6, 0, 6);
          const x = target.x + off.x, z = target.z + off.z;
          ctx.player?.teleport(new THREE.Vector3(x, ctx.world.groundAt(x, z).y + 0.1, z));
          ctx.events.emit('ui:notify', { text: `Arrived at ${target.name}`, kind: 'discovery' });
        },
      },
      { text: 'Cancel' },
    ]);
  }
}

// ---------------------------------------------------------------------------

class InventoryScreen extends ModalScreen {
  readonly id = 'inventory';
  private tab: 'items' | 'wardrobe' = 'items';
  private slot: CosmeticSlot = 'top';
  constructor(ui: UIManager) {
    super(ui, 'Inventory & Wardrobe');
  }
  render(): void {
    const ctx = this.ctx;
    clear(this.body);
    const tabs = h('div.tabs', { style: { marginBottom: '10px' } }, h(`button.tab${this.tab === 'items' ? '.active' : ''}`, { onclick: () => { this.tab = 'items'; this.render(); } }, 'Items'), h(`button.tab${this.tab === 'wardrobe' ? '.active' : ''}`, { onclick: () => { this.tab = 'wardrobe'; this.render(); } }, 'Wardrobe'), h('div.spacer'), h('span', `🪙 ${ctx.inventory.currency} copper`));
    this.body.append(tabs);
    if (this.tab === 'items') {
      const items = ctx.inventory.allItems();
      if (!items.length) this.body.append(h('p.muted', 'Your pack is empty.'));
      const grid = h('div.grid-cards');
      for (const it of items) {
        const def = itemById(it.id)!;
        grid.append(h('div.card', h('div.row', h('span', { style: { fontSize: '22px' } }, def.icon), h('h4', `${def.name} ×${it.count}`)), h('p.muted', { style: { fontSize: '14px', margin: '4px 0' } }, def.description), def.use ? h('button.btn.small', { onclick: () => { ctx.inventory.use(it.id); this.render(); } }, 'Use') : null));
      }
      this.body.append(grid);
      return;
    }
    const p = ctx.player!;
    const slots: Array<[CosmeticSlot, keyof OutfitSlots, string]> = [
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
    const st = h('div.tabs', { style: { marginBottom: '10px' } });
    for (const [s, , label] of slots) st.append(h(`button.tab${this.slot === s ? '.active' : ''}`, { onclick: () => { this.slot = s; this.render(); } }, label));
    this.body.append(st);
    const key = slots.find((s) => s[0] === this.slot)![1];
    const grid = h('div.grid-cards');
    for (const c of COSMETICS.filter((c) => c.slot === this.slot)) {
      const unlocked = ctx.inventory.isCosmeticUnlocked(c.id);
      const equipped = p.appearance.outfit[key] === c.id || (EMPTY_SLOT_IDS.has(c.id) && EMPTY_SLOT_IDS.has(p.appearance.outfit[key]));
      grid.append(
        h(
          `div.card${unlocked ? '' : '.locked'}`,
          { style: { borderColor: equipped ? 'var(--gold-2)' : undefined } },
          h('h4', c.name),
          h('p.muted', { style: { fontSize: '13px', margin: '4px 0' } }, c.description),
          unlocked
            ? h('button.btn.small', { disabled: equipped, onclick: () => { const a = cloneAppearance(p.appearance); a.outfit[key] = c.id; if (c.colors) Object.assign(a.colors, c.colors); p.setAppearance(a); this.render(); } }, equipped ? 'Equipped' : 'Wear')
            : h('div', { style: { fontSize: '12px', color: 'var(--gold)' } }, c.unlock === 'merchant' ? `Sold by merchants (${c.price} copper)` : c.unlock === 'quest' ? 'Quest reward' : c.unlock === 'master' ? 'Gift from a master' : c.unlock === 'explore' ? 'Found while exploring' : 'Achievement'),
        ),
      );
    }
    this.body.append(grid);
    void cosmeticById;
  }
}

// ---------------------------------------------------------------------------

class CompanionsScreen extends ModalScreen {
  readonly id = 'companions';
  constructor(ui: UIManager) {
    super(ui, 'Companion Stable');
  }
  render(): void {
    const ctx = this.ctx;
    clear(this.body);
    const list = ctx.companions.bonded;
    if (!list.length) {
      this.body.append(h('p.muted', 'You have not bonded with any animals yet. Look for tracks, nests and herds in the wild — and bring the food they love.'));
      return;
    }
    const grid = h('div.grid-cards');
    for (const c of list) grid.append(h('div.card', h('h4', c.name), h('div.muted', c.speciesId), h('div', `Bond: ${Math.round(c.bond)}%`)));
    this.body.append(grid);
  }
}

// ---------------------------------------------------------------------------

class CharacterScreen extends ModalScreen {
  readonly id = 'character';
  constructor(ui: UIManager) {
    super(ui, 'Avatar');
  }
  render(): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const pr = ctx.progression;
    clear(this.body);
    const next = pr.xpForLevel(pr.level + 1);
    this.body.append(
      h('div.row', emblem(pr.startingElement, 'emblem'), h('div', h('div', { style: { fontSize: '22px' } }, p.characterName), h('div.muted', `Level ${pr.level} · ${Math.floor(pr.xp)} / ${next} XP · Began as a ${ELEMENT_INFO[pr.startingElement].bender}`))),
      h('div.divider'),
    );
    for (const e of ELEMENTS) {
      const m = pr.mastery[e];
      const f = pr.masteryProgress(e);
      this.body.append(h('div', { style: { margin: '10px 0' } }, h('div.row', emblem(e, 'emblem'), h('div', { style: { flex: '1' } }, h('div', `${ELEMENT_INFO[e].name} — ${m.mastered ? 'Mastered' : pr.canBend(e) ? 'Learning' : 'Not yet learned'}`), h('div.bar', { style: { marginTop: '4px' } }, h('div.fill', { style: { transform: `scaleX(${f})`, background: 'linear-gradient(90deg,#8a6a2a,#f1d48a)' } }))))));
    }
    this.body.append(h('div.divider'), h('p', pr.elementsSphereUnlocked ? '✦ Elements Sphere awakened.' : `Avatar State: available. Elements Sphere: master all four elements (${pr.masteredCount}/4).`));
  }
}

export function registerGameScreens(ui: UIManager): void {
  ui.registerScreen('journal', (u) => new JournalScreen(u));
  ui.registerScreen('techniques', (u) => new TechniquesScreen(u));
  ui.registerScreen('map', (u) => new MapScreen(u));
  ui.registerScreen('inventory', (u) => new InventoryScreen(u));
  ui.registerScreen('companions', (u) => new CompanionsScreen(u));
  ui.registerScreen('character', (u) => new CharacterScreen(u));
}
