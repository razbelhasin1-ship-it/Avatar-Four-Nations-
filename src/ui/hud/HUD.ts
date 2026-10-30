import * as THREE from 'three';
import { SPIRIT_TO_ENTER } from '../../avatar/AvatarStateSystem';
import { getTechnique } from '../../combat/CombatSystem';
import { SPIRIT_COST as ULT_SPIRIT } from '../../combat/techniques/avatar/common';
import type { GameContext } from '../../core/GameContext';
import type { Action } from '../../core/Input';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../../core/types';
import { LANDMARKS } from '../../world/WorldLayout';
import { clear, h } from '../dom';
import { ELEMENT_COLORS, ELEMENT_SVG, iconHTML } from '../icons';
import type { UIManager } from '../UIManager';
import './hud.css';

interface DamageNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
}

interface SlotView {
  el: HTMLElement;
  id: string;
  cd: HTMLElement;
  cdt: HTMLElement;
}

const tmp = new THREE.Vector3();
const DROPS = 6;

/**
 * In-game HUD: vitals with element medallion, Avatar State / Sphere badge,
 * water reserve droplets, ability bar (icons, names, radial cooldowns, water
 * and chi readiness), compass with quest/master/landmark/companion markers,
 * quest tracker, prompts, lock-on reticle, combo counter, damage vignette,
 * mounted controls hint. Hides during dialogue (and cinematics via #ui.cinematic).
 */
export class HUD {
  readonly el: HTMLElement;
  private medal: HTMLElement;
  private medalLevel: HTMLElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpText: HTMLElement;
  private chiFill: HTMLElement;
  private chiText: HTMLElement;
  private spiritFill: HTMLElement;
  private spiritRow: HTMLElement;
  /** [avatar] Spirit % / active Avatar State boosts. */
  private spiritInfo: HTMLElement = h('span.spirit-info', '');
  private stateBadge: HTMLElement;
  private waterRow: HTMLElement;
  private drops: HTMLElement[] = [];
  private waterLabel: HTMLElement;
  private nameEl: HTMLElement;
  private wheel: HTMLElement;
  private slotsEl: HTMLElement;
  private slotViews: SlotView[] = [];
  private questEl: HTMLElement;
  private questBody: HTMLElement;
  /** Touch layout: the compass rides inside the quest block (the touch controls lay out around it). */
  private compassDocked = false;
  private compass: HTMLElement;
  private compassStrip: HTMLElement;
  private prompt: HTMLElement;
  private waterInd: HTMLElement;
  private chargeRing: SVGCircleElement;
  private chargeWrap: HTMLElement;
  private lockMarker: HTMLElement;
  private comboEl: HTMLElement;
  private comboN: HTMLElement;
  /** Avatar Flow: the elements woven into the current combo. */
  private flowEl: HTMLElement;
  private vignette: HTMLElement;
  private mountHint: HTMLElement;
  private fpsEl: HTMLElement;
  private dmg: DamageNumber[] = [];
  private slotSig = '';
  private questSig = '';
  private mountSig = '';
  private waterCheck = 0;
  private waterState: { label: string; ok: boolean } | null = null;
  private lastWaterMsg = '';
  private lastWaterMsgT = -99;
  private combo = 0;
  private comboT = 0;
  private hurt = 0;
  private compassT = 0;

  constructor(private readonly ui: UIManager, private readonly ctx: GameContext) {
    const bar = (cls: string) => {
      const fill = h('div.fill');
      const ghost = h('div.ghost');
      return { el: h(`div.bar.${cls}`, ghost, fill), fill, ghost };
    };
    const hp = bar('hp');
    const chi = bar('chi');
    const spirit = bar('spirit');
    this.hpFill = hp.fill;
    this.hpGhost = hp.ghost;
    this.chiFill = chi.fill;
    this.spiritFill = spirit.fill;
    this.hpText = h('span.bar-num', '');
    this.chiText = h('span.bar-num', '');
    this.nameEl = h('div.hud-name');
    this.medalLevel = h('span.hud-medal-lv', '1');
    this.medal = h('div.hud-medal', h('div.hud-medal-em'), this.medalLevel);
    this.stateBadge = h('div.hud-state.hidden');
    this.waterLabel = h('span.hud-water-num', '0');
    const dropWrap = h('div.hud-drops');
    for (let i = 0; i < DROPS; i++) {
      const d = h('span.drop');
      this.drops.push(d);
      dropWrap.append(d);
    }
    this.spiritRow = h('div.hud-row.spirit-row', h('div.bar-label', h('span', 'Spirit'), this.spiritInfo), spirit.el);
    this.waterRow = h('div.hud-row.water-row', { title: 'Water held — draw it from real sources' }, dropWrap, this.waterLabel);
    const bars = h(
      'div.hud-bars',
      this.nameEl,
      h('div.hud-row', h('div.bar-label', h('span', 'Health'), this.hpText), hp.el),
      h('div.hud-row', h('div.bar-label', h('span', 'Chi'), this.chiText), chi.el),
      this.spiritRow,
      this.waterRow,
      this.stateBadge,
    );
    const vitals = h('div.hud-vitals', this.medal, bars);
    this.wheel = h('div.element-wheel');
    this.slotsEl = h('div.slots');
    this.mountHint = h('div.hud-mount.hidden');
    const bottom = h('div.hud-bottom', this.wheel, this.slotsEl);
    this.questBody = h('div.hud-quest-body');
    this.questEl = h('div.hud-quest', this.questBody);
    this.compassStrip = h('div.compass-strip');
    this.compass = h('div.compass', this.compassStrip, h('div.compass-needle'));
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
    this.lockMarker = h('div.lock-marker.hidden', h('span.lk.a'), h('span.lk.b'), h('span.lk.c'), h('span.lk.d'));
    this.comboN = h('b', '0');
    this.flowEl = h('i.hud-flow');
    this.comboEl = h('div.hud-combo', this.comboN, h('span', 'Combo'), this.flowEl);
    this.vignette = h('div.hud-vignette');
    this.fpsEl = h('div.fps.hidden');
    this.el = h('div.hud', this.vignette, vitals, this.compass, this.questEl, h('div.crosshair'), this.chargeWrap, this.waterInd, this.prompt, this.lockMarker, this.comboEl, this.mountHint, bottom, this.fpsEl);

    ctx.events.on('hit', (e) => {
      if (e.playerIsAttacker && e.targetKind !== 'player' && !e.blocked && e.damage >= 0.5) {
        this.combo = this.comboT > 0 ? this.combo + 1 : 1;
        this.comboT = 2.8;
        if (this.combo >= 2) {
          this.comboN.textContent = String(this.combo);
          this.comboEl.classList.add('on');
          this.comboN.animate([{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
        }
      }
      if (!ctx.settings.data.gameplay.damageNumbers || e.damage < 0.5) return;
      if (!e.playerIsAttacker && e.targetKind !== 'player') return;
      this.spawnDamage(new THREE.Vector3(e.position.x, e.position.y + 0.4, e.position.z), Math.round(e.damage), e.targetKind === 'player' ? '#ff8a7a' : e.blocked ? '#bbb' : e.killed ? '#ffd27a' : '#fff');
    });
    ctx.events.on('combo:weave', (e) => {
      const colors: Record<string, string> = { air: '#eef6ff', water: '#5cc8ff', earth: '#c9a66b', fire: '#ff8a3a' };
      this.flowEl.replaceChildren(...e.elements.map((el) => h('u', { style: `background:${colors[el]}` })), h('em', `Avatar Flow ×${e.elements.length}`));
      this.flowEl.classList.add('on');
      this.comboEl.classList.add('on');
      this.comboT = Math.max(this.comboT, 2.8);
      this.flowEl.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    });
    ctx.events.on('player:damaged', (e) => {
      const p = ctx.player;
      const max = p?.health?.maxHp ?? 100;
      this.hurt = Math.min(1, this.hurt + 0.35 + (e.amount / max) * 2.5);
      this.combo = 0;
      this.comboT = 0;
      this.comboEl.classList.remove('on');
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
      this.flash(this.waterRow);
    });
    ctx.events.on('technique:failed', (e) => {
      if (e.reason === 'chi') this.flash(this.chiFill.parentElement!);
      if (e.reason === 'cooldown' || e.reason === 'chi' || e.reason === 'water') {
        const s = this.slotViews.find((v) => v.id === e.id);
        if (s) this.flash(s.el);
      }
    });
    ctx.events.on('session:started', () => this.resetTransient());
  }

  onShow(): void {
    this.slotSig = '';
    this.questSig = '';
    this.mountSig = '';
    this.resetTransient();
  }

  private resetTransient(): void {
    this.combo = 0;
    this.comboT = 0;
    this.hurt = 0;
    this.comboEl.classList.remove('on');
    for (const d of this.dmg) d.el.remove();
    this.dmg = [];
  }

  private flash(el: HTMLElement): void {
    el.animate([{ boxShadow: '0 0 0 rgba(255,80,60,0)' }, { boxShadow: '0 0 16px rgba(255,80,60,0.95)' }, { boxShadow: '0 0 0 rgba(255,80,60,0)' }], { duration: 420 });
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
      const el = h(`div.el${unlocked ? '.unlocked' : ''}${p.element === e ? '.active' : ''}`, { html: ELEMENT_SVG[e], title: unlocked ? ELEMENT_INFO[e].name : `${ELEMENT_INFO[e].name} — not yet learned`, 'data-element': e });
      el.style.color = unlocked ? c.glow : '#777';
      el.style.setProperty('--el-glow', c.shadow);
      this.wheel.appendChild(el);
    }
    const em = this.medal.querySelector('.hud-medal-em') as HTMLElement;
    em.innerHTML = this.ctx.avatar.sphereActive || this.ctx.avatar.active ? ELEMENT_SVG.avatar : ELEMENT_SVG[p.element];
    this.medal.style.setProperty('--el', ELEMENT_COLORS[this.ctx.avatar.active ? 'avatar' : p.element].glow);
    this.medal.style.setProperty('--el-shadow', ELEMENT_COLORS[this.ctx.avatar.active ? 'avatar' : p.element].shadow);
  }

  private renderSlots(ids: Array<string | null>, ultimate: boolean): void {
    clear(this.slotsEl);
    this.slotViews = [];
    const input = this.ctx.input;
    const add = (id: string | null, action: Action, ult: boolean, icon?: string) => {
      const def = id ? getTechnique(id) : null;
      const cd = h('div.cd');
      const cdt = h('span.cdt');
      const slot = h(
        `div.slot${def ? '' : '.empty'}${ult ? '.ultimate' : ''}`,
        { 'data-id': id ?? '', title: def ? `${def.name} — ${def.description}` : 'Empty slot (Techniques: K)' },
        h('div.icon', { html: def ? iconHTML(icon ?? def.icon) : '' }),
        cd,
        cdt,
        h('span.key', input.label(action)),
        def?.water ? h('span.need-water', { title: `Needs ${def.water.amount} water` }) : null,
        h('div.name', def?.name ?? '—'),
      );
      this.slotsEl.appendChild(slot);
      if (id) this.slotViews.push({ el: slot, id, cd, cdt });
    };
    ids.forEach((id, i) => add(id, `ability${i + 1}` as Action, ultimate));
    if (ultimate && getTechnique('ult_cataclysm')) add('ult_cataclysm', 'ability5', true, 'avatar');
  }

  private updateSlots(): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const ultimate = ctx.avatar.sphereActive;
    const ids = ultimate ? ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado'] : ctx.progression.slotsFor(p.element);
    const sig = `${p.element}|${ultimate}|${ctx.avatar.active}|${ids.join(',')}|${[...ctx.progression.unlocked].join('')}|${ctx.input.lastDevice}`;
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      this.renderWheel();
      this.renderSlots(ids, ultimate);
    }
    for (const v of this.slotViews) {
      const def = getTechnique(v.id);
      if (!def) continue;
      const f = Math.max(0, Math.min(1, ctx.combat.cooldownFraction(p, v.id)));
      v.cd.style.setProperty('--cd', f.toFixed(3));
      const left = f > 0 ? ctx.combat.cooldownLeft(p, v.id) : 0;
      const txt = left > 0.05 ? (left >= 10 ? left.toFixed(0) : left.toFixed(1)) : '';
      if (v.cdt.textContent !== txt) v.cdt.textContent = txt;
      v.el.classList.toggle('cooling', f > 0);
      if (def.water) v.el.classList.toggle('nowater', !!this.waterState && !ctx.water.canSupply(p, def.water));
      v.el.classList.toggle('nochi', p.chi < def.chiCost * (ctx.avatar.active ? ctx.avatar.boosts.chiCost : 1) - 0.01);
      // [avatar] Ultimates dim when the spirit cannot pay for them.
      if (def.kind === 'ultimate' || def.kind === 'combined') v.el.classList.toggle('nospirit', ctx.avatar.spirit < (ULT_SPIRIT[v.id] ?? 0));
    }
  }

  private updateQuest(): void {
    const ctx = this.ctx;
    const o = ctx.quests.objectiveText();
    const p = ctx.player!;
    let dist = '';
    if (o && ctx.quests.tracked) {
      const m = ctx.quests.markers().find((x) => x.tracked);
      if (m) dist = `${Math.round(Math.hypot(m.position.x - p.position.x, m.position.z - p.position.z))} m`;
    }
    const docked = this.compassDocked && ctx.settings.data.gameplay.compass;
    const sig = (o ? o.title + o.lines.map((l) => l.text + l.done + (l.progress ?? '')).join('|') + dist : '') + `|${docked}`;
    if (sig === this.questSig) return;
    this.questSig = sig;
    clear(this.questBody);
    // Docked compass keeps the block alive even with nothing tracked.
    this.questEl.classList.toggle('hidden', !o && !docked);
    this.questEl.classList.toggle('compass-only', !o && docked);
    if (!o) return;
    const lines = o.lines.filter((l) => !l.done).concat(o.lines.filter((l) => l.done)).slice(0, 4);
    this.questBody.append(
      h('div.qk', h('span', 'Quest'), dist ? h('span.qd', dist) : null),
      h('div.qt', o.title),
      ...lines.map((l) => h(`div.obj${l.done ? '.done' : ''}`, h('span.om', l.done ? '✓' : '◇'), h('span', l.text + (l.progress ? ` (${l.progress})` : '')))),
    );
  }

  private updateCompass(): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const camDir = ctx.camera.getWorldDirection(tmp);
    const heading = Math.atan2(camDir.x, -camDir.z); // 0 = north (-Z), clockwise positive (east)
    const width = this.compass.clientWidth || 400;
    const fov = Math.PI * 0.9;
    clear(this.compassStrip);
    const place = (angle: number, el: HTMLElement) => {
      let d = angle - heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > fov / 2) return;
      el.style.left = `${(0.5 + d / fov) * width}px`;
      this.compassStrip.appendChild(el);
    };
    const dirs: Array<[string, number]> = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2], ['NE', Math.PI / 4], ['SE', (3 * Math.PI) / 4], ['SW', (-3 * Math.PI) / 4], ['NW', -Math.PI / 4]];
    for (const [label, a] of dirs) place(a, h(`div.tick${label.length > 1 ? '.minor' : ''}${label === 'N' ? '.north' : ''}`, label));
    for (let i = 0; i < 24; i++) if (i % 3) place((i / 24) * Math.PI * 2, h('div.tick.dot'));
    const bearing = (x: number, z: number) => Math.atan2(x - p.position.x, -(z - p.position.z));
    for (const l of LANDMARKS) {
      if (!ctx.world.discovered.has(l.id)) continue;
      const d = Math.hypot(l.x - p.position.x, l.z - p.position.z);
      if (d > 600 || d < 30) continue;
      place(bearing(l.x, l.z), h('div.marker.lm', { title: `${l.name} · ${Math.round(d)} m` }, '▲'));
    }
    for (const c of ctx.companions.companionCreatures()) {
      const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
      if (d < 8 || d > 500 || c.state === 'ridden') continue;
      place(bearing(c.position.x, c.position.z), h('div.marker.comp', { title: `Companion · ${Math.round(d)} m` }, '●'));
    }
    for (const m of ctx.quests.markers()) {
      if (m.compass === false) continue;
      const d = Math.hypot(m.position.x - p.position.x, m.position.z - p.position.z);
      const master = m.questId.startsWith('master:');
      const el = h(`div.marker${m.tracked ? '.tracked' : master ? '.master' : '.quest'}`, { title: m.text, style: { color: m.color ?? (m.tracked ? '#ffcc33' : '#e6dcc4') } }, m.icon ?? '◆', m.tracked ? h('span.md', d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`) : null);
      place(bearing(m.position.x, m.position.z), el);
    }
  }

  private updateWater(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const show = p.element === 'water';
    const canWater = ctx.progression.canBend('water');
    this.waterRow.style.display = canWater ? '' : 'none';
    if (canWater) {
      const per = p.maxWaterReserve / DROPS;
      for (let i = 0; i < DROPS; i++) {
        const f = Math.max(0, Math.min(1, (p.waterReserve - i * per) / per));
        this.drops[i].style.setProperty('--f', f.toFixed(2));
      }
      const skin = (ctx.extra.get('waterbending') as { hasFlask?(): boolean; flask?: { amount: number } } | undefined) ?? null;
      const label = skin?.hasFlask?.() && skin.flask ? `${Math.round(p.waterReserve)} · skin ${Math.round(skin.flask.amount)}` : `${Math.round(p.waterReserve)}`;
      if (this.waterLabel.textContent !== label) this.waterLabel.textContent = label;
    }
    this.waterCheck -= dt;
    if (this.waterCheck <= 0) {
      this.waterCheck = 0.3;
      if (canWater) {
        // [waterbending] What Draw Water would use here (finite sources show their fill %, ice/snow explained).
        const d = ctx.water.describe(p);
        this.waterState = { label: d.label, ok: d.ok };
      } else this.waterState = null;
    }
    if (show && this.waterState) {
      this.waterInd.className = `water-indicator ${this.waterState.ok ? 'ok' : 'none'}`;
      const t = `${this.waterState.ok ? '💧' : '⊘'} ${this.waterState.label}`;
      if (this.waterInd.textContent !== t) this.waterInd.textContent = t;
    } else this.waterInd.classList.add('hidden');
  }

  private updateMount(): void {
    const ctx = this.ctx;
    const cs = ctx.companions;
    const sig = cs.mounted ? `${cs.mountedFlying}|${ctx.input.lastDevice}` : '';
    if (sig === this.mountSig) return;
    this.mountSig = sig;
    this.mountHint.classList.toggle('hidden', !cs.mounted);
    clear(this.mountHint);
    if (!cs.mounted) return;
    const k = (a: Action, t: string) => h('span.mh', h('span.kbd', ctx.input.label(a)), t);
    this.mountHint.append(h('span.mh-title', cs.mountedFlying ? 'Flying' : 'Riding'), k('jump', cs.mountedFlying ? 'Climb' : 'Jump / take off'), k('sprint', cs.mountedFlying ? 'Boost' : 'Gallop'));
    if (cs.mountedFlying) this.mountHint.append(k('dodge', 'Descend'));
    this.mountHint.append(k('companion', 'Dismount'));
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    const hpF = p.health ? p.health.hp / p.health.maxHp : 0;
    this.hpFill.style.transform = `scaleX(${hpF.toFixed(3)})`;
    this.hpGhost.style.transform = `scaleX(${hpF.toFixed(3)})`;
    const hpT = p.health ? `${Math.ceil(p.health.hp)}/${p.health.maxHp}` : '';
    if (this.hpText.textContent !== hpT) this.hpText.textContent = hpT;
    this.chiFill.style.transform = `scaleX(${(p.chi / p.maxChi).toFixed(3)})`;
    const chiT = `${Math.floor(p.chi)}`;
    if (this.chiText.textContent !== chiT) this.chiText.textContent = chiT;
    this.spiritFill.style.transform = `scaleX(${(ctx.avatar.spirit / ctx.avatar.maxSpirit).toFixed(3)})`;
    this.updateSpiritInfo();
    const lv = String(ctx.progression.level);
    if (this.medalLevel.textContent !== lv) this.medalLevel.textContent = lv;
    const name = p.characterName;
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
    this.updateWater(dt);
    this.updateSlots();
    this.dockCompass(!!this.ui.touch?.shown);
    this.updateQuest();
    this.updateMount();
    const compassOn = ctx.settings.data.gameplay.compass;
    this.compassT -= dt;
    if (compassOn && this.compassT <= 0) {
      this.compassT = 1 / 30;
      this.updateCompass();
    }
    // Inline !important: the docked (touch) compass is forced visible by the stylesheet.
    if (compassOn) this.compass.style.removeProperty('display');
    else this.compass.style.setProperty('display', 'none', 'important');
    // Dialogue: keep the scene clean (vitals stay, everything else fades).
    this.el.classList.toggle('in-dialogue', ctx.ui.dialogueOpen);
    this.el.classList.toggle('low-hp', hpF > 0 && hpF < 0.3);

    const inter = ctx.interactions.current;
    if (inter && !ctx.ui.dialogueOpen) {
      this.prompt.classList.remove('hidden');
      const html = `<span class="kbd">${ctx.input.label('interact')}</span><span class="pl">${inter.label}</span>`;
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
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

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.comboEl.classList.remove('on');
        this.flowEl.classList.remove('on');
      }
    }
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.vignette.style.opacity = Math.min(1, this.hurt).toFixed(3);

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

  /** [avatar] Spirit readout; while active, the live Avatar State boosts. */
  private updateSpiritInfo(): void {
    const av = this.ctx.avatar;
    let text: string;
    if (av.active) {
      const b = av.boosts;
      const pct = (k: number) => `${Math.round((1 - k) * 100)}%`;
      text = `${Math.round(av.spirit)}% · ×${b.power.toFixed(1)} power · −${pct(b.damageTaken)} dmg · −${pct(b.cooldown)} cd`;
      this.spiritInfo.title = `Avatar State: ×${b.power} damage, ${pct(b.damageTaken)} less damage taken, ${pct(b.knockbackTaken)} less knockback, cooldowns −${pct(b.cooldown)}, chi costs −${pct(b.chiCost)}, +${b.chiRegen} chi/s, water reach ×${b.waterRange}`;
    } else text = av.spirit < SPIRIT_TO_ENTER ? `${Math.round(av.spirit)}% · resting` : `${Math.round(av.spirit)}% · ready`;
    if (this.spiritInfo.textContent !== text) this.spiritInfo.textContent = text;
    this.spiritInfo.classList.toggle('active', av.active);
    const state = av.sphereActive ? 'Elements Sphere' : av.active ? 'Avatar State' : '';
    this.stateBadge.classList.toggle('hidden', !state);
    this.stateBadge.classList.toggle('sphere', av.sphereActive);
    if (state && this.stateBadge.textContent !== state) this.stateBadge.textContent = state;
    this.spiritRow.classList.toggle('ready', !av.active && av.spirit >= SPIRIT_TO_ENTER);
    this.el.classList.toggle('avatar-on', av.active);
  }

  /**
   * With touch controls on, the top centre belongs to the menu/map buttons: the
   * compass moves into the quest block (whose rectangle the touch layout already
   * avoids); without them it returns to the top centre.
   */
  private dockCompass(touch: boolean): void {
    if (touch === this.compassDocked) return;
    this.compassDocked = touch;
    if (touch) this.questEl.prepend(this.compass);
    else this.el.insertBefore(this.compass, this.questEl);
    this.compass.classList.toggle('docked', touch);
    this.questSig = '';
  }

  /** Element switch helper for touch UI. */
  elementList(): Element[] {
    return ELEMENTS.filter((e) => this.ctx.progression.canBend(e));
  }
}
