import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext, GameSystem } from '../../core/GameContext';
import type { Persistable } from '../../core/Save';
import type { WaterSourceType } from '../../core/types';
import type { Entity } from '../../entities/Entity';
import type { Player } from '../../player/Player';
import { biomeAt, biomeWeights } from '../../world/Heightfield';
import { getTechnique } from '../CombatSystem';
import type { Combatant } from '../types';
import type { CarriedSupply, SourceEvent, SourceHit, WaterSource } from '../WaterSources';
import './clips';
import { clamp01, easeOut } from './Curve';
import { capTaper } from './FlowTube';
import { humidity, humidityLabel, MoistureMap, MOISTURE_MIN_YIELD } from './humidity';
import './sounds';
import { getWaterFX, StreamBody, type WaterFX } from './WaterFX';
import { createPuddleMaterial, sharedIceMaterial } from './WaterMaterials';

/**
 * 'waterbending' module: everything around the techniques that makes water a
 * real, finite, environmental resource.
 *
 *  - Draw Water (input 'drawWater', default R): hold to pull water from the
 *    best source in front into the orbiting reserve — a continuous stream from
 *    the water surface to the hands and into the ring. Clear feedback when
 *    nothing is in reach / the reserve is full.
 *  - Reserve orbit visuals (any Combatant can be tracked; the player always is).
 *  - Water skin (cosmetic effect 'water_flask'): a carried 30-unit supply used
 *    anywhere as a last resort, refilled at liquid sources (drawing with a full
 *    reserve, or wading/swimming).
 *  - Puddles left by attacks are drawn (and shrink as they are bent / dry up).
 *  - Ice encasement visuals on frozen entities; fire heat ('bending:heat')
 *    melts ice constructs, thaws frozen targets and steams puddles away.
 *  - Moisture map for Moisture Extraction (limited, per-area depletion).
 *  - Charge preview for the water heavy (water coils at the hands while held).
 *  - Persistence (reserve + water skin) and window.__game.debug.water helpers.
 *
 * Other modules: ctx.extra.get('waterbending') as WaterbendingSystem —
 * trackReserve(npc) to show an NPC bender's reserve, humidityAt(x,z).
 */

export const FLASK_CAPACITY = 30;
/** A water attack pressed with empty hands beside a source gathers at least this much (then strike again). */
const AUTO_GATHER_MIN = 20;
/** Longest the automatic gather motion runs (slow sources fill less). */
const AUTO_GATHER_TIME = 1.4;

const DRAW_RATE: Partial<Record<WaterSourceType, number>> = {
  ocean: 34,
  river: 32,
  lake: 32,
  waterfall: 34,
  stream: 26,
  canal: 26,
  pond: 24,
  fountain: 16,
  puddle: 16,
  snow: 12,
  ice: 14,
  rain: 6,
};

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

interface HeatEvent {
  position: { x: number; y: number; z: number };
  radius: number;
  intensity: number;
}

interface PuddleVisual {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  source: WaterSource;
  shown: number;
  fade: number;
  /** Laid along the slope of the ground it sits on. */
  tilted?: boolean;
}

const PUDDLE_UP = new THREE.Vector3(0, 1, 0);

interface Encasement {
  entity: Entity;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  t: number;
}

export class WaterbendingSystem implements GameSystem, Persistable {
  readonly saveKey = 'waterbending';
  private ctx!: GameContext;
  fx!: WaterFX;
  readonly flask = { amount: FLASK_CAPACITY, capacity: FLASK_CAPACITY };
  readonly moisture = new MoistureMap();
  // Draw Water state
  private drawing = false;
  /** Remaining time of an automatic gather (water attack with empty hands next to a source). */
  private autoGatherT = 0;
  private autoGatherTarget = 0;
  private gatherTaught = false;
  private drawStream: StreamBody | null = null;
  /** Whirl of water lifting out of the source surface while drawing. */
  private drawColumn: StreamBody | null = null;
  private drawFrom = new THREE.Vector3();
  private drawFromValid = false;
  private drawTick = 0;
  private drawHold = 0;
  private drawMode: 'source' | 'flask' | 'refill' | 'none' = 'none';
  private drawHit: SourceHit | null = null;
  private drawNotified = false;
  private drawLoop: LoopHandle | null = null;
  private drawRipple = 0;
  private drawFlow = 0;
  /** Units drawn during the current hold (debug/tests). */
  drawnThisHold = 0;
  // Visual registries
  private readonly puddles = new Map<string, PuddleVisual>();
  private puddleGeo: THREE.CircleGeometry | null = null;
  private readonly encasements = new Map<number, Encasement>();
  private crystalGeo: THREE.OctahedronGeometry | null = null;
  private shellGeo: THREE.CylinderGeometry | null = null;
  private scanT = 0;
  private flaskWasFull = true;
  private pendingReserve: number | null = null;
  // Charge preview (water heavy)
  private charge: { ring: StreamBody; feed: StreamBody | null; from: THREE.Vector3 } | null = null;
  private chargeAngle = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.fx = getWaterFX(ctx);
    ctx.water.carriedSupply = (c) => this.carriedSupply(c);
    ctx.water.onSource((e) => this.onSourceEvent(e));
    // Fire heat from the fire/air/earth module (additive event; subscribed loosely so this compiles either way).
    (ctx.events as unknown as { on(t: string, fn: (e: HeatEvent) => void): void }).on('bending:heat', (e) => this.onHeat(e));
    ctx.events.on('technique:failed', (e) => {
      if (e.reason === 'gather') this.beginAutoGather(e.id);
    });
    this.installDebug();
  }

  // ---------------------------------------------------------------------------
  // Water skin (flask)
  // ---------------------------------------------------------------------------

  private get player(): Player {
    return this.ctx.game.player;
  }

  hasFlask(): boolean {
    const p = this.player;
    return !!p && p.hasAccessoryEffect('water_flask');
  }

  private carriedSupply(c: Combatant): CarriedSupply | null {
    if (!c.isPlayer || !this.hasFlask()) return null;
    const flask = this.flask;
    const p = this.player;
    return {
      get amount() {
        return flask.amount;
      },
      get capacity() {
        return flask.capacity;
      },
      point: (out: THREE.Vector3) => this.flaskPoint(p, out),
      take: (n: number) => {
        flask.amount = Math.max(0, flask.amount - n);
        if (flask.amount <= 0.05) this.ctx.events.emit('ui:notify', { text: 'Your water skin is empty — refill it at a river, lake or the sea.', kind: 'info', duration: 2.5 });
      },
    };
  }

  private flaskPoint(p: Player, out: THREE.Vector3): THREE.Vector3 {
    const hips = (p.humanoid?.anchors as Record<string, THREE.Object3D | undefined> | undefined)?.hips;
    if (hips) {
      hips.getWorldPosition(out);
      // The skin hangs at the left hip.
      out.x += Math.cos(p.yaw) * 0.22;
      out.z -= Math.sin(p.yaw) * 0.22;
      return out;
    }
    return out.set(p.position.x + Math.cos(p.yaw) * 0.22, p.position.y + 0.95, p.position.z - Math.sin(p.yaw) * 0.22);
  }

  private refillFlask(units: number): number {
    if (!this.hasFlask()) return 0;
    const add = Math.min(units, this.flask.capacity - this.flask.amount);
    if (add <= 0) return 0;
    this.flask.amount += add;
    if (this.flask.amount >= this.flask.capacity - 0.01 && !this.flaskWasFull) {
      this.flaskWasFull = true;
      this.ctx.events.emit('ui:notify', { text: 'Water skin refilled.', kind: 'success', duration: 2 });
    }
    return add;
  }

  // ---------------------------------------------------------------------------
  // Humidity / moisture
  // ---------------------------------------------------------------------------

  /** Humidity 0..1 at a point (biome, rain, nearby liquid water). */
  humidityAt(x: number, z: number, y = 0): number {
    const b = biomeWeights(x, z);
    const pos = tA.set(x, y, z);
    const near = this.ctx.water.findAll(pos, 25, { allowLiquid: true, allowIce: false, allowSnow: false }).some((h) => h.type !== 'rain' && h.type !== 'puddle');
    return humidity({ biome: biomeAt(x, z), swamp: b.swamp, desert: b.desert, volcanic: b.volcanic, raining: this.ctx.water.raining, nearWater: near });
  }

  /** Units Moisture Extraction would yield at the caster's position now. */
  moistureYield(c: Combatant): { units: number; humidity: number; drained: number; label: string } {
    const p = c.position;
    const h = this.humidityAt(p.x, p.z, p.y);
    const now = this.ctx.time.elapsed;
    const drained = this.moisture.drained(p.x, p.z, now);
    return { units: this.moisture.yieldAt(p.x, p.z, now, h), humidity: h, drained, label: humidityLabel(h) };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onSessionStart(): void {
    const p = this.player;
    if (this.pendingReserve !== null) {
      p.waterReserve = Math.max(0, Math.min(p.maxWaterReserve, this.pendingReserve));
      this.pendingReserve = null;
    }
    this.fx.trackReserve(p);
    // Visuals for puddles that already exist (e.g. created before the module saw them).
    for (const s of this.ctx.water.list()) if (s.type === 'puddle' && s.id.startsWith('dyn_')) this.addPuddle(s);
  }

  onSessionEnd(): void {
    this.autoGatherT = 0;
    this.stopDraw();
    this.endCharge();
    this.fx.clear();
    for (const id of [...this.puddles.keys()]) this.removePuddle(id, true);
    for (const id of [...this.encasements.keys()]) this.removeEncasement(id, false);
    this.moisture.clear();
  }

  update(dt: number, ctx: GameContext): void {
    if (!ctx.session.active) return;
    const p = ctx.player;
    if (p) {
      this.updateDraw(dt, p);
      this.updateFlask(dt, p);
      this.updateCharge(dt, p);
      this.updateLetGo(p);
    }
    this.fx.update(dt);
    this.updatePuddles(dt);
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.2;
      this.scanFrozen();
    }
    this.updateEncasements(dt);
  }

  // ---------------------------------------------------------------------------
  // Draw Water
  // ---------------------------------------------------------------------------

  private canDraw(p: Player): boolean {
    const ctx = this.ctx;
    return !ctx.ui.blocksGameplay && p.controlLock <= 0 && !p.defeated && p.alive && !ctx.combat.isBusy(p) && !ctx.companions.mounted;
  }

  /**
   * Water attack with empty hands next to a source: instead of bending the river
   * from a distance, the press lifts water out of it into the hands (the same
   * stream and reserve as Draw Water). The next press bends what is held.
   */
  private beginAutoGather(techniqueId: string): void {
    const p = this.player;
    if (!p || !this.canDraw(p) || !this.ctx.progression.canBend('water')) return;
    const need = getTechnique(techniqueId)?.water?.amount ?? 10;
    this.autoGatherTarget = Math.min(p.maxWaterReserve, Math.max(need, AUTO_GATHER_MIN));
    this.autoGatherT = AUTO_GATHER_TIME;
    if (!this.gatherTaught) {
      this.gatherTaught = true;
      const key = this.ctx.input.label('drawWater');
      this.ctx.events.emit('ui:notify', { text: `You draw the water up into your hands — strike again to bend it. Hold ${key} to gather more.`, kind: 'info', duration: 4.5 });
    }
  }

  private updateDraw(dt: number, p: Player): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const auto = this.autoGatherT > 0;
    if (auto) {
      this.autoGatherT -= dt;
      if (p.waterReserve >= this.autoGatherTarget - 0.01) this.autoGatherT = 0;
    }
    // Drawing water is waterbending: pressing it with another element active switches to Water.
    if (input.wasPressed('drawWater') && p.element !== 'water' && ctx.progression.canBend('water') && this.canDraw(p)) p.switchElement('water');
    const wants = (input.isDown('drawWater') || auto) && this.canDraw(p) && p.element === 'water';
    if (input.wasPressed('drawWater') && !ctx.progression.canBend('water')) {
      ctx.events.emit('ui:notify', { text: 'You cannot bend water yet — find a waterbending master.', kind: 'warning', duration: 2.5 });
      return;
    }
    if (!wants || !ctx.progression.canBend('water')) {
      if (this.drawing) this.stopDraw();
      return;
    }
    if (!this.drawing) this.startDraw(p);
    this.drawHold += dt;
    this.drawTick -= dt;
    p.addStatus('slow', 0.2);
    if (this.drawTick <= 0) {
      const step = 0.1;
      this.drawTick = step;
      this.drawStep(p, step);
    }
    this.updateDrawVisual(dt, p);
  }

  /**
   * Carried water only stays up while the player is waterbending. With any other element active
   * (switched, a loaded save, a new session) it is let go: the water around them falls, splashes
   * and leaves a puddle where it lands — real water that can be drawn again.
   */
  private updateLetGo(p: Player): void {
    if (p.element === 'water' || p.waterReserve <= 0) return;
    const ctx = this.ctx;
    const amount = p.waterReserve;
    p.waterReserve = 0;
    this.autoGatherT = 0;
    this.fx.reserveOf(p)?.letGo((at) => {
      ctx.water.release(at, amount);
      ctx.world.fx.wet(at, Math.min(2.2, 0.6 + amount * 0.03));
    });
    ctx.events.emit('water:reserve', { amount: 0, max: p.maxWaterReserve });
  }

  private startDraw(p: Player): void {
    this.drawing = true;
    this.drawHold = 0;
    this.drawTick = 0;
    this.drawNotified = false;
    this.drawnThisHold = 0;
    this.drawMode = 'none';
    this.drawFromValid = false;
    this.drawFlow = 0;
    p.humanoid?.animator.play('water_draw', { fadeIn: 0.15 });
  }

  stopDraw(): void {
    if (!this.drawing) return;
    this.drawing = false;
    const p = this.player;
    p?.humanoid?.animator.stop('water_draw', 0.25);
    this.drawLoop?.stop(0.25);
    this.drawLoop = null;
    if (this.drawStream) {
      // Let the stream collapse: the unbent water falls back as drops, then release.
      if (this.drawFlow > 0.2) {
        const path = this.drawStream.path;
        for (let i = 0; i < 14; i++) {
          path.at(path.length * Math.random() * 0.8, tA);
          this.fx.drops.emit(tA, tB.set((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2), 0.025 + 0.03 * Math.random(), 1.4);
        }
      }
      this.drawStream.dispose();
      this.drawStream = null;
    }
    this.drawColumn?.dispose();
    this.drawColumn = null;
    this.drawMode = 'none';
    this.drawHit = null;
  }

  private drawStep(p: Player, step: number): void {
    const ctx = this.ctx;
    const water = ctx.water;
    const facing = p.aimDir;
    const rateBoost = ctx.avatar.active ? 1.5 : 1;
    // Peek the best source to pick the rate (drawToReserve picks the same one).
    const range = water.rangeFor(p);
    const snow = water.snowCapable(p);
    const best = water.findBest(p.position, range, { allowLiquid: true, allowIce: true, allowSnow: snow, facing });
    // Snow and ice melt slowly; Snow Gathering (Healer Yugoda's teaching) draws them faster.
    const melt = best && (best.type === 'snow' || best.frozen) && ctx.progression.knows('water_snow_draw') ? 1.6 : 1;
    const rate = (best ? (best.frozen && best.type !== 'snow' ? DRAW_RATE.ice! : DRAW_RATE[best.type] ?? 20) : 20) * rateBoost * melt;
    const hit = water.drawToReserve(p, rate * step, facing, { allowSnow: snow });
    if (hit) {
      const drawn = hit.drawn ?? 0;
      this.drawnThisHold += drawn;
      this.drawMode = 'source';
      this.drawHit = hit;
      if (!this.drawFromValid) {
        this.drawFrom.copy(hit.point);
        this.drawFromValid = true;
      }
      const r = this.fx.reserveOf(p);
      if (r) {
        r.pulse(0.25);
        if (hit.type === 'snow' || hit.frozen) r.frozenHint = Math.min(1, r.frozenHint + 0.15);
      }
      return;
    }
    const f = water.lastFailure;
    // Reserve full: top up the water skin from liquid water instead.
    if (f?.reason === 'full') {
      const liquid = water.findBest(p.position, range, { allowLiquid: true, allowIce: false, allowSnow: false, facing });
      if (liquid && liquid.type !== 'rain' && this.hasFlask() && this.flask.amount < this.flask.capacity - 0.01) {
        this.flaskWasFull = false;
        this.refillFlask(20 * step);
        this.drawMode = 'refill';
        this.drawHit = liquid;
        if (!this.drawFromValid) {
          this.drawFrom.copy(liquid.point);
          this.drawFromValid = true;
        }
        return;
      }
      this.drawMode = 'none';
      if (!this.drawNotified) {
        this.drawNotified = true;
        ctx.events.emit('ui:notify', { text: this.hasFlask() && this.flask.amount < this.flask.capacity ? 'Your water reserve is full.' : 'Your water reserve is full.', kind: 'info', duration: 1.8 });
        this.fx.pulseReserve(p, 1.5);
      }
      return;
    }
    // Nothing in reach: uncork the water skin.
    if (this.hasFlask() && this.flask.amount > 0.05 && p.waterReserve < p.maxWaterReserve - 0.01) {
      const take = Math.min(this.flask.amount, 15 * step, p.maxWaterReserve - p.waterReserve);
      this.flask.amount -= take;
      this.flaskWasFull = false;
      p.waterReserve += take;
      this.drawnThisHold += take;
      if (this.drawMode !== 'flask') {
        ctx.events.emit('ui:notify', { text: 'You uncork your water skin.', kind: 'info', duration: 1.8 });
        const fp = this.flaskPoint(p, tA);
        ctx.events.emit('water:drawn', { sourceId: 'flask', sourceType: 'flask', amount: take, position: { x: fp.x, y: fp.y, z: fp.z } });
      }
      this.drawMode = 'flask';
      this.drawHit = null;
      this.fx.pulseReserve(p, 0.2);
      ctx.events.emit('water:reserve', { amount: p.waterReserve, max: p.maxWaterReserve });
      return;
    }
    if (this.drawMode !== 'none' || !this.drawNotified) {
      this.drawMode = 'none';
      if (!this.drawNotified) {
        this.drawNotified = true;
        ctx.events.emit('ui:notify', { text: f?.message ?? 'No water within reach.', kind: 'warning', duration: 2.5 });
        const h = p.castOrigin('hands', tA);
        ctx.vfx.burst('mist', h, { count: 4, size: 0.4 });
        ctx.audio.play('water_fizzle', { position: h, volume: 0.6 });
        p.humanoid?.animator.play('water_fizzle', { fadeIn: 0.05 });
      }
    }
  }

  private updateDrawVisual(dt: number, p: Player): void {
    const active = this.drawMode !== 'none';
    this.drawFlow = clamp01(this.drawFlow + (active ? dt * 4 : -dt * 5));
    if (this.drawFlow <= 0.01) {
      if (this.drawStream) {
        this.drawStream.dispose();
        this.drawStream = null;
      }
      this.drawColumn?.dispose();
      this.drawColumn = null;
      this.drawLoop?.stop(0.2);
      this.drawLoop = null;
      return;
    }
    const hands = p.castOrigin('hands', tB);
    // Where the water comes from this frame.
    if (this.drawMode === 'flask') this.flaskPoint(p, tA);
    else if (this.drawHit) tA.copy(this.drawHit.point);
    else tA.copy(this.drawFrom);
    if (!this.drawFromValid) {
      this.drawFrom.copy(tA);
      this.drawFromValid = true;
    } else this.drawFrom.lerp(tA, Math.min(1, dt * 10));
    if (!this.drawStream) {
      const far = this.drawFrom.distanceTo(hands) > 9;
      this.drawStream = new StreamBody(this.fx, { flow: 9, foam: 1 }, far ? 1.5 : 1.1, 5);
      this.drawStream.wobble = 0.06;
      this.drawLoop = this.ctx.audio.loop('water_draw', { position: hands, volume: 0.5 });
      this.fx.splash(this.drawFrom, 0.6, { sound: true, volume: 0.4 });
    }
    const s = this.drawStream;
    const snow = this.drawHit?.type === 'snow';
    s.setLook({ ice: snow ? 0.55 : 0, flow: 9, glow: 0 });
    const from = this.drawFrom;
    const d = from.distanceTo(hands);
    s.pts[0].copy(from);
    s.pts[1].lerpVectors(from, hands, 0.45).addScaledVector(tC.set(0, 1, 0), 0.25 * d + 0.7);
    s.pts[2].copy(hands);
    // Into the orbiting reserve (or back to the skin when refilling).
    const ring = this.fx.reserveOf(p);
    if (this.drawMode === 'refill') this.flaskPoint(p, s.pts[3]);
    else if (ring) ring.pointNear(hands, s.pts[3]);
    else s.pts[3].copy(p.position).setY(p.position.y + 1);
    s.pts[4].copy(s.pts[3]).lerp(hands, -0.15);
    s.radius = (0.1 + 0.11 * this.drawFlow) * (this.drawMode === 'flask' ? 0.6 : 1);
    s.tail = 0;
    s.head = easeOut(this.drawFlow);
    // Thick at the source, thinning toward the hands; surges travel up the stream.
    s.profile = (u) => capTaper(u, 0.05, 0.12) * (1.15 - 0.4 * u) * (0.72 + 0.28 * Math.sin(u * 22 - this.fx.time * 13) ** 2);
    s.build(5);
    this.drawLoop?.setPosition(hands);
    const fromSurface = this.drawMode !== 'flask' && this.drawMode !== 'refill';
    // The surface whirls and lifts where the water is pulled out.
    if (fromSurface) {
      if (!this.drawColumn) {
        this.drawColumn = new StreamBody(this.fx, { flow: 6, foam: 1.3 }, 1, 6);
        this.drawColumn.wobble = 0.05;
      }
      const col = this.drawColumn;
      const spin = this.fx.time * 7;
      for (let i = 0; i < 6; i++) {
        const k = i / 5;
        const r = 0.6 * (1 - k) + 0.06;
        col.pts[i].set(from.x + Math.cos(spin + k * 4.4) * r, from.y + 0.02 + k * 0.75 * this.drawFlow, from.z + Math.sin(spin + k * 4.4) * r);
      }
      col.radius = 0.05 + 0.08 * this.drawFlow;
      col.tail = 0;
      col.head = 1;
      col.profile = (u) => (1.15 - 0.5 * u) * capTaper(u, 0.03, 0.2);
      col.setLook({ ice: snow ? 0.55 : 0, flow: 6 });
      col.build(6);
    }
    // Drops peel off the rushing stream.
    if (s.path.length > 0.5 && Math.random() < dt * (this.fx.quality === 'low' ? 5 : 14)) {
      s.path.at(s.path.length * s.head * Math.random(), tC);
      this.fx.shed(tC, tA.subVectors(hands, from).normalize().multiplyScalar(4.5), 1, 1.1);
    }
    // Source ripples, spray and splashes where it is torn from the surface.
    this.drawRipple -= dt;
    if (this.drawRipple <= 0 && this.drawMode !== 'flask') {
      this.drawRipple = 0.24;
      const g = tC.copy(from);
      this.ctx.vfx.ring(g.setY(from.y + 0.04), snow ? '#ffffff' : '#cfefff', 1.9, 0.7, { opacity: 0.45 });
      this.ctx.vfx.burst(snow ? 'snowpuff' : 'spray', from, { count: 2, size: 0.5 });
      if (!snow && fromSurface && Math.random() < 0.45) this.fx.crown(from, 0.4);
    }
  }

  /** Debug/test: whether the player is currently drawing and from what. */
  drawStatus(): { drawing: boolean; mode: string; sourceId: string | null; sourceType: string | null; from: number[] | null; drawn: number } {
    return {
      drawing: this.drawing,
      mode: this.drawMode,
      sourceId: this.drawHit?.id ?? (this.drawMode === 'flask' ? 'flask' : null),
      sourceType: this.drawHit?.type ?? (this.drawMode === 'flask' ? 'flask' : null),
      from: this.drawFromValid ? this.drawFrom.toArray() : null,
      drawn: this.drawnThisHold,
    };
  }

  // ---------------------------------------------------------------------------
  // Flask refill while wading / swimming
  // ---------------------------------------------------------------------------

  private updateFlask(dt: number, p: Player): void {
    if (!this.hasFlask()) return;
    if (this.flask.amount < this.flask.capacity - 0.01) this.flaskWasFull = false;
    const b = p.body;
    if (b && (b.inWater || b.swimming) && this.flask.amount < this.flask.capacity) {
      this.refillFlask(10 * dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Charge preview for the water heavy (Water Blast)
  // ---------------------------------------------------------------------------

  private updateCharge(dt: number, p: Player): void {
    const charge = p.element === 'water' ? p.charging : 0;
    if (charge <= 0) {
      this.endCharge();
      return;
    }
    const def = getTechnique('water_blast');
    if (!def?.water || !this.ctx.water.canSupply(p, def.water)) {
      this.endCharge();
      return;
    }
    const hands = p.castOrigin('hands', tB);
    if (!this.charge) {
      const ring = new StreamBody(this.fx, { flow: 6 }, 0.6, 8);
      ring.wobble = 0.02;
      let feed: StreamBody | null = null;
      const from = new THREE.Vector3();
      if (p.waterReserve < def.water.amount) {
        const hit = this.ctx.water.findBest(p.position, this.ctx.water.rangeFor(p), { allowLiquid: true, allowIce: true, allowSnow: this.ctx.water.snowCapable(p), facing: p.aimDir });
        if (hit) {
          from.copy(hit.point);
          feed = new StreamBody(this.fx, { flow: 8, opacity: 0.75 }, 1.2, 3);
          feed.radius = 0.08;
        }
      }
      this.charge = { ring, feed, from };
    }
    const c = this.charge;
    this.chargeAngle += dt * (5 + charge * 7);
    const R = 0.18 + 0.22 * charge;
    for (let i = 0; i < 8; i++) {
      const a = this.chargeAngle + (i / 8) * Math.PI * 2;
      c.ring.pts[i].set(hands.x + Math.cos(a) * R, hands.y + Math.sin(a * 2) * 0.06 + Math.sin(a) * R * 0.4, hands.z + Math.sin(a) * R);
    }
    c.ring.radius = 0.04 + 0.08 * charge;
    c.ring.head = 0.3 + 0.65 * charge;
    c.ring.profile = (u) => capTaper(u, 0.2, 0.3);
    c.ring.build(8, true);
    if (c.feed) {
      const d = c.from.distanceTo(hands);
      c.feed.pts[0].copy(c.from);
      c.feed.pts[1].lerpVectors(c.from, hands, 0.5).addScaledVector(tC.set(0, 1, 0), 0.25 * d + 0.6);
      c.feed.pts[2].copy(hands);
      c.feed.head = easeOut(Math.min(1, charge * 2.5));
      c.feed.radius = 0.05 + 0.06 * charge;
      c.feed.build(3);
    }
  }

  private endCharge(): void {
    if (!this.charge) return;
    this.charge.ring.dispose();
    this.charge.feed?.dispose();
    this.charge = null;
  }

  // ---------------------------------------------------------------------------
  // Puddles
  // ---------------------------------------------------------------------------

  private onSourceEvent(e: SourceEvent): void {
    if (!this.ctx?.session?.active) return;
    if (e.source.type !== 'puddle' || !e.source.id.startsWith('dyn_')) return;
    if (e.kind === 'added') this.addPuddle(e.source);
    else this.removePuddle(e.source.id, false);
  }

  private addPuddle(s: WaterSource): void {
    if (this.puddles.has(s.id)) return;
    this.puddleGeo ??= new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    const mat = createPuddleMaterial();
    const mesh = new THREE.Mesh(this.puddleGeo, mat);
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    this.fx.group.add(mesh);
    this.puddles.set(s.id, { mesh, mat, source: s, shown: 0, fade: 0 });
  }

  private removePuddle(id: string, immediate: boolean): void {
    const v = this.puddles.get(id);
    if (!v) return;
    if (!immediate && v.fade === 0) {
      v.fade = 0.0001; // start fading; removed in updatePuddles
      return;
    }
    this.fx.group.remove(v.mesh);
    v.mat.dispose();
    this.puddles.delete(id);
  }

  private updatePuddles(dt: number): void {
    for (const [id, v] of this.puddles) {
      const s = v.source;
      const frac = s.capacity > 0 ? clamp01(s.amount / s.capacity) : 0;
      // Evaporates in the last seconds of its life.
      const life = s.ttl !== undefined ? clamp01(s.ttl / 8) : 1;
      let target = s.r * Math.sqrt(Math.max(0.05, frac)) * (0.4 + 0.6 * life);
      let opacity = 0.85 * (0.35 + 0.65 * Math.min(1, frac * 1.5)) * life;
      if (v.fade > 0) {
        v.fade += dt;
        target *= Math.max(0, 1 - v.fade / 0.6);
        opacity *= Math.max(0, 1 - v.fade / 0.6);
        if (v.fade >= 0.6) {
          this.fx.group.remove(v.mesh);
          v.mat.dispose();
          this.puddles.delete(id);
          continue;
        }
      } else if (frac <= 0.01) {
        v.fade = 0.0001;
      }
      v.shown += (target - v.shown) * Math.min(1, dt * 6);
      v.mesh.scale.setScalar(Math.max(0.01, v.shown));
      v.mesh.position.set(s.x, s.y + 0.03, s.z);
      if (!v.tilted) {
        // A flat disc on a slope would sink into the uphill side and float on the downhill one.
        v.tilted = true;
        const w = this.ctx.world, d = 0.6, top = s.y + 1.5;
        const hx = w.groundAt(s.x + d, s.z, top).y - w.groundAt(s.x - d, s.z, top).y;
        const hz = w.groundAt(s.x, s.z + d, top).y - w.groundAt(s.x, s.z - d, top).y;
        v.mesh.quaternion.setFromUnitVectors(PUDDLE_UP, new THREE.Vector3(-hx, 2 * d, -hz).normalize());
      }
      v.mat.uniforms.uOpacity.value = opacity;
      v.mat.uniforms.uRipple.value = 0.25 + 0.5 * Math.max(0, 1 - frac);
    }
  }

  get puddleCount(): number {
    return this.puddles.size;
  }

  // ---------------------------------------------------------------------------
  // Ice encasement on frozen entities
  // ---------------------------------------------------------------------------

  private scanFrozen(): void {
    const p = this.ctx.player;
    if (!p) return;
    for (const e of this.ctx.entities.queryRadius(p.position, 90)) {
      if (e.hasStatus('freeze') && !this.encasements.has(e.id)) this.addEncasement(e);
    }
  }

  private addEncasement(e: Entity): void {
    this.crystalGeo ??= new THREE.OctahedronGeometry(1, 0);
    this.shellGeo ??= new THREE.CylinderGeometry(1, 1.1, 1, 7, 1);
    const group = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const shell = new THREE.Mesh(this.shellGeo, sharedIceMaterial(true));
    shell.scale.set(e.radius + 0.35, e.height * 0.92, e.radius + 0.35);
    shell.position.y = e.height * 0.46;
    shell.renderOrder = 11;
    group.add(shell);
    meshes.push(shell);
    const n = this.fx.quality === 'low' ? 5 : 8;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.crystalGeo, sharedIceMaterial());
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = e.radius + 0.3 + Math.random() * 0.15;
      const h = 0.2 + Math.random() * e.height * 0.85;
      m.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
      m.scale.set(0.16 + Math.random() * 0.1, 0.35 + Math.random() * 0.35, 0.16 + Math.random() * 0.1);
      m.rotation.set((Math.random() - 0.5) * 0.8, a, (Math.random() - 0.5) * 0.8);
      m.castShadow = false;
      group.add(m);
      meshes.push(m);
    }
    group.scale.set(1, 0.01, 1);
    this.fx.group.add(group);
    this.encasements.set(e.id, { entity: e, group, meshes, t: 0 });
    this.ctx.audio.play('ice_form', { position: e.position, volume: 0.6 });
    this.ctx.world.fx.frost(e.position, e.radius + 1.2);
  }

  private removeEncasement(id: number, shatter: boolean): void {
    const enc = this.encasements.get(id);
    if (!enc) return;
    this.encasements.delete(id);
    this.fx.group.remove(enc.group);
    if (shatter) {
      const at = enc.entity.aimPoint(tA);
      this.ctx.vfx.burst('ice', at, { count: 18, speed: 1.2, radius: 0.5 });
      this.ctx.vfx.burst('snowpuff', at, { count: 6 });
      this.ctx.audio.play('ice_shatter', { position: at, volume: 0.7 });
    }
  }

  private updateEncasements(dt: number): void {
    for (const [id, enc] of this.encasements) {
      const e = enc.entity;
      if (e.disposed || !e.alive || !e.hasStatus('freeze')) {
        this.removeEncasement(id, !e.disposed);
        continue;
      }
      enc.t += dt;
      const grow = easeOut(Math.min(1, enc.t / 0.25));
      enc.group.scale.set(1, Math.max(0.01, grow), 1);
      enc.group.position.copy(e.position);
    }
  }

  /** Number of entities currently shown encased in ice. */
  get encasedCount(): number {
    return this.encasements.size;
  }

  // ---------------------------------------------------------------------------
  // Fire heat: melt ice constructs, thaw frozen targets, steam puddles away
  // ---------------------------------------------------------------------------

  private onHeat(e: HeatEvent): void {
    const pos = tA.set(e.position.x, e.position.y, e.position.z);
    this.fx.meltNear(pos, e.radius, e.intensity);
    for (const [, enc] of this.encasements) {
      const en = enc.entity;
      if (en.position.distanceTo(pos) < e.radius + en.radius) {
        en.removeStatus('freeze');
        this.fx.steam(en.aimPoint(tB), 0.8);
      }
    }
    for (const s of [...this.ctx.water.list()]) {
      if (s.type !== 'puddle' || !s.id.startsWith('dyn_')) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < e.radius + s.r) {
        this.fx.steam(tB.set(s.x, s.y + 0.2, s.z), 0.6);
        this.ctx.water.unregister(s.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // NPC benders
  // ---------------------------------------------------------------------------

  /** Show an NPC bender's orbiting reserve (auto-removed when it dies/despawns). */
  trackReserve(c: Combatant): void {
    this.fx.trackReserve(c);
  }

  untrackReserve(c: Combatant): void {
    this.fx.untrackReserve(c);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    if (this.ctx?.session.kind === 'tutorial') return undefined;
    const p = this.player;
    return { v: 1, flask: +this.flask.amount.toFixed(2), reserve: p ? +p.waterReserve.toFixed(2) : 0 };
  }

  deserialize(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as { flask?: unknown; reserve?: unknown };
    if (typeof d.flask === 'number' && Number.isFinite(d.flask)) this.flask.amount = Math.max(0, Math.min(this.flask.capacity, d.flask));
    if (typeof d.reserve === 'number' && Number.isFinite(d.reserve)) {
      const p = this.ctx?.game?.player;
      const r = Math.max(0, Math.min(p?.maxWaterReserve ?? 60, d.reserve));
      if (p) p.waterReserve = r;
      this.pendingReserve = r;
    }
  }

  reset(): void {
    this.flask.amount = FLASK_CAPACITY;
    this.flaskWasFull = true;
    this.pendingReserve = null;
    this.moisture.clear();
  }

  // ---------------------------------------------------------------------------
  // Debug / automation hooks: window.__game.debug.water
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const ctx = this.ctx;
    const self = this;
    const install = () => {
      const g = (window as unknown as { __game?: { debug: Record<string, unknown> } }).__game;
      if (!g) return false;
      g.debug.water = {
        reserve: () => ctx.game.player.waterReserve,
        setReserve: (n: number) => {
          const p = ctx.game.player;
          p.waterReserve = Math.max(0, Math.min(p.maxWaterReserve, n));
          return p.waterReserve;
        },
        /** Carried water that was let go and is still falling / splashing. */
        falling: () => self.fx.effectsOf('reserve-fall').map((e) => e.trace?.() ?? null),
        flask: () => ({ equipped: self.hasFlask(), amount: self.flask.amount, capacity: self.flask.capacity }),
        setFlask: (n: number) => (self.flask.amount = Math.max(0, Math.min(self.flask.capacity, n))),
        equipFlask: (on = true) => {
          const p = ctx.game.player;
          const a = structuredClone(p.appearance);
          a.outfit.accessory = on ? 'water_flask' : 'none';
          p.setAppearance(a);
          return self.hasFlask();
        },
        sources: (range = 20) =>
          ctx.water.findAll(ctx.game.player.position, range, { allowIce: true, allowSnow: true, includeDepleted: true }).map((h) => ({
            id: h.id,
            type: h.type,
            label: h.label,
            distance: +h.distance.toFixed(2),
            available: +h.available.toFixed(2),
            capacity: h.capacity === Infinity ? null : h.capacity ?? null,
            frozen: h.frozen,
            size: h.size,
            point: h.point.toArray().map((v) => +v.toFixed(3)),
          })),
        source: (id: string) => {
          const s = ctx.water.get(id);
          return s ? { id: s.id, amount: s.amount, capacity: s.capacity, regen: s.regen, type: s.type, x: s.x, y: s.y, z: s.z, r: s.r, ttl: s.ttl ?? null } : null;
        },
        register: (def: { id: string; type?: WaterSourceType; label?: string; x: number; y?: number; z: number; r?: number; capacity?: number; regen?: number; frozen?: boolean }) => {
          const y = def.y ?? ctx.world.groundAt(def.x, def.z).y + 0.05;
          return ctx.water.register({ id: def.id, type: def.type ?? 'fountain', label: def.label ?? 'Test Fountain', x: def.x, y, z: def.z, r: def.r ?? 1.2, capacity: def.capacity ?? 20, regen: def.regen ?? 1, frozen: def.frozen });
        },
        unregister: (id: string) => ctx.water.unregister(id),
        describe: () => ctx.water.describe(ctx.game.player),
        lastFailure: () => ctx.water.lastFailure,
        drawStatus: () => self.drawStatus(),
        startDraw: () => ctx.input.setVirtual('drawWater', true),
        stopDraw: () => ctx.input.setVirtual('drawWater', false),
        trace: (on = true) => {
          self.fx.traceOn = on;
          if (on) self.fx.traceLog = [];
          return on;
        },
        traceLog: () => self.fx.traceLog,
        castLog: () => self.fx.castLog,
        effects: () => (self.fx as unknown as { effects: Array<{ kind: string; castId?: number }> }).effects.map((e) => ({ kind: e.kind, castId: e.castId ?? null })),
        reserveVisual: () => {
          const r = self.fx.reserveOf(ctx.game.player);
          return r ? { tracked: true, visible: r.visible, fraction: +r.fraction.toFixed(3), shown: +r.shownAmount.toFixed(2), icy: +r.icyLevel.toFixed(3) } : { tracked: false, visible: false, fraction: 0, shown: 0, icy: 0 };
        },
        stats: () => ({ tubesActive: self.fx.tubes.activeCount, tubesTotal: self.fx.tubes.totalCount, effects: self.fx.activeCount, puddles: self.puddleCount, encased: self.encasedCount, meltables: self.fx.meltableCount }),
        humidity: (x?: number, z?: number) => {
          const p = ctx.game.player.position;
          const hx = x ?? p.x, hz = z ?? p.z;
          const h = self.humidityAt(hx, hz, p.y);
          return { humidity: +h.toFixed(3), label: humidityLabel(h), yield: self.moistureYield(ctx.game.player), biome: biomeAt(hx, hz) };
        },
        raining: (on: boolean) => (ctx.water.raining = on),
        minYield: MOISTURE_MIN_YIELD,
      };
      return true;
    };
    if (!install()) {
      // Debug API installs after systems init; retry shortly.
      const iv = setInterval(() => {
        if (install()) clearInterval(iv);
      }, 50);
      setTimeout(() => clearInterval(iv), 10000);
    }
  }
}
