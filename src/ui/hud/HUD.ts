import * as THREE from 'three';
import { getTechnique } from '../../combat/CombatSystem';
import type { GameContext } from '../../core/GameContext';
import { ELEMENTS, type Element } from '../../core/types';
import { LANDMARKS } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, ELEMENT_SVG, iconHTML } from '../icons';
import type { UIManager } from '../UIManager';

interface DamageNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
}

const tmp = new THREE.Vector3();

export class HUD {
  readonly el: HTMLElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private chiFill: HTMLElement;
  private spiritFill: HTMLElement;
  private spiritRow: HTMLElement;
  private waterRow: HTMLElement;
  private waterFill: HTMLElement;
  private waterLabel: HTMLElement;
  private nameEl: HTMLElement;
  private wheel: HTMLElement;
  private slotsEl: HTMLElement;
  private questEl: HTMLElement;
  private compass: HTMLElement;
  private prompt: HTMLElement;
  private waterInd: HTMLElement;
  private chargeRing: SVGCircleElement;
  private chargeWrap: HTMLElement;
  private lockMarker: HTMLElement;
  private fpsEl: HTMLElement;
  private dmg: DamageNumber[] = [];
  private slotSig = '';
  private questSig = '';
  private waterCheck = 0;
  private waterState: { label: string; ok: boolean } | null = null;
  private lastWaterMsg = '';
  private lastWaterMsgT = -99;

  constructor(private readonly ui: UIManager, private readonly ctx: GameContext) {
    const bar = (cls: string) => {
      const fill = h('div.fill');
      const ghost = h('div.ghost');
      return { el: h(`div.bar.${cls}`, ghost, fill), fill, ghost };
    };
    const hp = bar('hp');
    const chi = bar('chi');
    const spirit = bar('spirit');
    const water = bar('water');
    this.hpFill = hp.fill;
    this.hpGhost = hp.ghost;
    this.chiFill = chi.fill;
    this.spiritFill = spirit.fill;
    this.waterFill = water.fill;
    this.nameEl = h('div.hud-name');
    this.waterLabel = h('span', '0');
    this.spiritRow = h('div', h('div.bar-label', h('span', 'Avatar Spirit'), h('span', '')), spirit.el);
    this.waterRow = h('div', h('div.bar-label', h('span', 'Water held'), this.waterLabel), water.el);
    const vitals = h('div.hud-vitals', this.nameEl, h('div', h('div.bar-label', h('span', 'Health'), h('span', '')), hp.el), h('div', h('div.bar-label', h('span', 'Chi'), h('span', '')), chi.el), this.spiritRow, this.waterRow);
    this.wheel = h('div.element-wheel');
    this.slotsEl = h('div.slots');
    const bottom = h('div.hud-bottom', this.wheel, this.slotsEl);
    this.questEl = h('div.hud-quest');
    this.compass = h('div.compass');
    this.prompt = h('div.prompt.hidden');
    this.waterInd = h('div.water-indicator.hidden');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', '22');
    ring.setAttribute('cy', '22');
    ring.setAttribute('r', '19');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#ffe6a8');
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('stroke-dasharray', `${2 * Math.PI * 19}`);
    ring.setAttribute('transform', 'rotate(-90 22 22)');
    svg.appendChild(ring);
    this.chargeRing = ring;
    this.chargeWrap = h('div.charge-ring.hidden');
    this.chargeWrap.appendChild(svg);
    this.lockMarker = h('div.lock-marker.hidden');
    this.fpsEl = h('div.fps.hidden');
    this.el = h('div.hud', vitals, this.compass, this.questEl, h('div.crosshair'), this.chargeWrap, this.waterInd, this.prompt, this.lockMarker, bottom, this.fpsEl);

    ctx.events.on('hit', (e) => {
      if (!ctx.settings.data.gameplay.damageNumbers || e.damage < 0.5) return;
      if (!e.playerIsAttacker && e.targetKind !== 'player') return;
      this.spawnDamage(new THREE.Vector3(e.position.x, e.position.y + 0.4, e.position.z), Math.round(e.damage), e.targetKind === 'player' ? '#ff8a7a' : e.blocked ? '#bbb' : '#fff');
    });
    ctx.events.on('water:unavailable', () => {
      // [waterbending] Precise reason from the source system, throttled so spamming a technique doesn't stack toasts.
      const msg = ctx.water.lastFailure?.message ?? 'No nearby water source — find a river, the sea or a pond.';
      const now = ctx.time.real;
      if (msg === this.lastWaterMsg && now - this.lastWaterMsgT < 2.5) return;
      this.lastWaterMsg = msg;
      this.lastWaterMsgT = now;
      this.ui.notify(msg, 'warning', 2.5);
      this.flash(this.waterInd);
    });
    ctx.events.on('technique:failed', (e) => {
      if (e.reason === 'chi') this.flash(this.chiFill.parentElement!);
    });
  }

  onShow(): void {
    this.slotSig = '';
    this.questSig = '';
  }

  private flash(el: HTMLElement): void {
    el.animate([{ boxShadow: '0 0 0 rgba(255,80,60,0)' }, { boxShadow: '0 0 14px rgba(255,80,60,0.9)' }, { boxShadow: '0 0 0 rgba(255,80,60,0)' }], { duration: 400 });
  }

  private spawnDamage(pos: THREE.Vector3, n: number, color: string): void {
    const el = h('div.dmg', String(n));
    el.style.color = color;
    this.el.appendChild(el);
    this.dmg.push({ el, pos: pos.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), age: 0 });
    if (this.dmg.length > 30) this.dmg.shift()!.el.remove();
  }

  private project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    tmp.copy(p).project(this.ctx.camera);
    const visible = tmp.z < 1 && tmp.z > -1;
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight, visible };
  }

  private renderWheel(): void {
    clear(this.wheel);
    const p = this.ctx.player!;
    for (const e of ELEMENTS) {
      const unlocked = this.ctx.progression.canBend(e);
      const c = ELEMENT_COLORS[e];
      const el = h(`div.el${unlocked ? '.unlocked' : ''}${p.element === e ? '.active' : ''}`, { html: ELEMENT_SVG[e], title: unlocked ? e : `${e} — not yet learned` });
      el.style.color = unlocked ? c.glow : '#777';
      el.style.setProperty('--el-glow', c.shadow);
      this.wheel.appendChild(el);
    }
  }

  private renderSlots(ids: Array<string | null>, ultimate: boolean): void {
    clear(this.slotsEl);
    const input = this.ctx.input;
    ids.forEach((id, i) => {
      const def = id ? getTechnique(id) : null;
      const key = input.label((`ability${i + 1}`) as any);
      const slot = h(`div.slot${def ? '' : '.empty'}${ultimate ? '.ultimate' : ''}`, { 'data-id': id ?? '' }, h('span.key', key), h('div.icon', { html: def ? iconHTML(def.icon) : '' }), h('div.name', def?.name ?? '—'), h('div.cd', { style: { transform: 'scaleY(0)' } }));
      this.slotsEl.appendChild(slot);
    });
    if (ultimate) {
      const def = getTechnique('ult_cataclysm');
      if (def) this.slotsEl.appendChild(h('div.slot.ultimate', { 'data-id': 'ult_cataclysm' }, h('span.key', input.label('ability5')), h('div.icon', { html: iconHTML('avatar') }), h('div.name', def.name), h('div.cd', { style: { transform: 'scaleY(0)' } })));
    }
  }

  private updateSlots(): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const ultimate = ctx.avatar.sphereActive;
    const ids = ultimate ? ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado'] : ctx.progression.slotsFor(p.element);
    const sig = `${p.element}|${ultimate}|${ids.join(',')}|${[...ctx.progression.unlocked].join('')}|${ctx.input.lastDevice}`;
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      this.renderWheel();
      this.renderSlots(ids, ultimate);
    }
    for (const el of Array.from(this.slotsEl.children) as HTMLElement[]) {
      const id = el.dataset.id;
      if (!id) continue;
      const cd = el.querySelector('.cd') as HTMLElement;
      const f = ctx.combat.cooldownFraction(p, id);
      cd.style.transform = `scaleY(${f.toFixed(3)})`;
      const def = getTechnique(id);
      if (def?.water && this.waterState) el.classList.toggle('nowater', !ctx.water.canSupply(p, def.water));
    }
  }

  private updateQuest(): void {
    const o = this.ctx.quests.objectiveText();
    const sig = o ? o.title + o.lines.map((l) => l.text + l.done + (l.progress ?? '')).join('|') : '';
    if (sig === this.questSig) return;
    this.questSig = sig;
    clear(this.questEl);
    if (!o) return;
    this.questEl.append(h('div.qt', o.title), ...o.lines.map((l) => h(`div.obj${l.done ? '.done' : ''}`, h('span', l.done ? '✓' : '◇'), h('span', l.text + (l.progress ? ` (${l.progress})` : '')))));
  }

  private updateCompass(): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const camDir = ctx.camera.getWorldDirection(tmp);
    const heading = Math.atan2(camDir.x, -camDir.z); // 0 = north (-Z), clockwise positive (east)
    const width = this.compass.clientWidth || 400;
    const fov = Math.PI * 0.9;
    clear(this.compass);
    const place = (angle: number, el: HTMLElement) => {
      let d = angle - heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > fov / 2) return;
      el.style.left = `${(0.5 + d / fov) * width}px`;
      this.compass.appendChild(el);
    };
    const dirs: Array<[string, number]> = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2], ['NE', Math.PI / 4], ['SE', (3 * Math.PI) / 4], ['SW', (-3 * Math.PI) / 4], ['NW', -Math.PI / 4]];
    for (const [label, a] of dirs) place(a, h('div.tick', { style: { opacity: label.length > 1 ? '0.55' : '1' } }, label));
    for (const m of ctx.quests.markers()) {
      const a = Math.atan2(m.position.x - p.position.x, -(m.position.z - p.position.z));
      place(a, h('div.marker', { title: m.text, style: { color: m.tracked ? '#ffcc33' : '#bbb' } }, '◆'));
    }
    for (const l of LANDMARKS) {
      if (!ctx.world.discovered.has(l.id)) continue;
      const d = Math.hypot(l.x - p.position.x, l.z - p.position.z);
      if (d > 600 || d < 30) continue;
      const a = Math.atan2(l.x - p.position.x, -(l.z - p.position.z));
      place(a, h('div.marker', { title: l.name, style: { fontSize: '11px', color: '#d8c8a8' } }, '▲'));
    }
  }

  private updateWater(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const show = p.element === 'water';
    this.waterRow.style.display = ctx.progression.canBend('water') ? '' : 'none';
    this.waterFill.style.transform = `scaleX(${(p.waterReserve / p.maxWaterReserve).toFixed(3)})`;
    const skin = (ctx.extra.get('waterbending') as { hasFlask?(): boolean; flask?: { amount: number } } | undefined) ?? null;
    this.waterLabel.textContent = skin?.hasFlask?.() && skin.flask ? `${Math.round(p.waterReserve)} · skin ${Math.round(skin.flask.amount)}` : `${Math.round(p.waterReserve)}`;
    this.waterCheck -= dt;
    if (this.waterCheck <= 0) {
      this.waterCheck = 0.3;
      if (ctx.progression.canBend('water')) {
        // [waterbending] What Draw Water would use here (finite sources show their fill %, ice/snow explained).
        const d = ctx.water.describe(p);
        this.waterState = { label: d.label, ok: d.ok };
      } else this.waterState = null;
    }
    if (show && this.waterState) {
      this.waterInd.classList.remove('hidden');
      this.waterInd.className = `water-indicator ${this.waterState.ok ? 'ok' : 'none'}`;
      this.waterInd.textContent = `≈ ${this.waterState.label}`;
    } else this.waterInd.classList.add('hidden');
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    const hpF = p.health ? p.health.hp / p.health.maxHp : 0;
    this.hpFill.style.transform = `scaleX(${hpF.toFixed(3)})`;
    this.hpGhost.style.transform = `scaleX(${hpF.toFixed(3)})`;
    this.chiFill.style.transform = `scaleX(${(p.chi / p.maxChi).toFixed(3)})`;
    this.spiritFill.style.transform = `scaleX(${(ctx.avatar.spirit / ctx.avatar.maxSpirit).toFixed(3)})`;
    this.spiritRow.style.opacity = ctx.avatar.active ? '1' : '0.75';
    this.nameEl.textContent = `${p.characterName} · Lv ${ctx.progression.level}${ctx.avatar.sphereActive ? ' · Elements Sphere' : ctx.avatar.active ? ' · Avatar State' : ''}`;
    this.updateWater(dt);
    this.updateSlots();
    this.updateQuest();
    if (ctx.settings.data.gameplay.compass) this.updateCompass();
    this.compass.style.display = ctx.settings.data.gameplay.compass ? '' : 'none';

    const inter = ctx.interactions.current;
    if (inter && !ctx.ui.dialogueOpen) {
      this.prompt.classList.remove('hidden');
      this.prompt.innerHTML = `<span class="kbd">${ctx.input.label('interact')}</span> ${inter.label}`;
    } else this.prompt.classList.add('hidden');

    const charge = p.charging;
    this.chargeWrap.classList.toggle('hidden', charge <= 0);
    const circ = 2 * Math.PI * 19;
    this.chargeRing.setAttribute('stroke-dashoffset', `${circ * (1 - charge)}`);

    if (p.lockTarget && p.lockTarget.alive) {
      const s = this.project(p.lockTarget.aimPoint(new THREE.Vector3()));
      this.lockMarker.classList.toggle('hidden', !s.visible);
      this.lockMarker.style.left = `${s.x}px`;
      this.lockMarker.style.top = `${s.y}px`;
    } else this.lockMarker.classList.add('hidden');

    for (const d of this.dmg) {
      d.age += dt;
      d.pos.y += dt * 1.2;
      const s = this.project(d.pos);
      d.el.style.left = `${s.x}px`;
      d.el.style.top = `${s.y}px`;
      d.el.style.opacity = String(Math.max(0, 1 - d.age / 1.1));
      d.el.style.display = s.visible ? '' : 'none';
    }
    const dead = this.dmg.filter((d) => d.age > 1.1);
    for (const d of dead) d.el.remove();
    this.dmg = this.dmg.filter((d) => d.age <= 1.1);

    const showFps = ctx.settings.data.graphics.showFps;
    this.fpsEl.classList.toggle('hidden', !showFps);
    if (showFps) {
      const s = ctx.render.stats;
      this.fpsEl.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(0)}k tris · ${ctx.entities.count} ent · ${ctx.vfx.particleCount} pts`;
    }
  }

  /** Element switch helper for touch UI. */
  elementList(): Element[] {
    return ELEMENTS.filter((e) => this.ctx.progression.canBend(e));
  }
}
