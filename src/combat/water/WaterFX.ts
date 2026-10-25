import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Entity } from '../../entities/Entity';
import { biomeWeights } from '../../world/Heightfield';
import type { Cast, Combatant } from '../types';
import { clamp01, PathSampler } from './Curve';
import { capTaper, FlowTube, TubePool, type Quality } from './FlowTube';
import { createWaterMaterial, WATER_SUN, WATER_TIME, type WaterLook } from './WaterMaterials';

/**
 * Per-game water effects runtime: owns pooled tubes, the reserve orbit visuals
 * and every active water body (whips, streams, waves, constructs). Effects are
 * decoupled from casts so a whip keeps flying (and hitting) after a combo
 * cancel. Updated by the 'waterbending' module each frame, right after combat.
 *
 * Gameplay that must match visuals (whip hitboxes, wave bands, jets) runs in
 * the effect's update() from the very same curve that poses the mesh.
 */

export interface WaterEffect {
  readonly kind: string;
  castId?: number;
  /** Advance; return false when finished (then dispose() is called). */
  update(dt: number): boolean;
  dispose(): void;
  /** Per-frame data for automated visual/hit synchronisation tests. */
  trace?(): Record<string, unknown> | null;
}

/** Ice construct that fire heat can melt ('bending:heat'). */
export interface Meltable {
  readonly position: THREE.Vector3;
  readonly radius: number;
  /** Apply heat; intensity ≈ 1 for a fire blast. */
  melt(intensity: number): void;
}

export interface TraceFrame {
  frame: number;
  time: number;
  effects: Array<Record<string, unknown>>;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

const FX = new WeakMap<GameContext, WaterFX>();

/** The water effects runtime for a game context (created on first use). */
export function getWaterFX(ctx: GameContext): WaterFX {
  let fx = FX.get(ctx);
  if (!fx) {
    fx = new WaterFX(ctx);
    FX.set(ctx, fx);
  }
  return fx;
}

export class WaterFX {
  readonly group = new THREE.Group();
  readonly tubes: TubePool;
  readonly drops: Droplets;
  private effects: WaterEffect[] = [];
  private readonly reserves = new Map<Combatant, ReserveVisual>();
  private readonly meltables = new Set<Meltable>();
  time = 0;
  traceOn = false;
  traceLog: TraceFrame[] = [];
  /** Recent casts' first-frame stream geometry (debug: "visual starts at the river"). */
  readonly castLog: Array<{ castId: number; techniqueId: string; sourceType: string | null; sourceId: string | null; frozen: boolean; from: number[] | null; streamStart: number[] | null; t: number }> = [];

  constructor(readonly ctx: GameContext) {
    this.group.name = 'waterbending_fx';
    ctx.vfx.group.add(this.group);
    this.tubes = new TubePool(this.group, () => this.quality);
    this.drops = new Droplets(this);
  }

  get quality(): Quality {
    return this.ctx.vfx.quality;
  }

  get activeCount(): number {
    return this.effects.length;
  }

  add<T extends WaterEffect>(e: T): T {
    this.effects.push(e);
    return e;
  }

  effectsOf(kind: string): WaterEffect[] {
    return this.effects.filter((e) => e.kind === kind);
  }

  logCast(cast: Cast, streamStart: THREE.Vector3 | null): void {
    this.castLog.push({
      castId: cast.id,
      techniqueId: cast.def.id,
      sourceType: cast.water.sourceType,
      sourceId: cast.water.sourceId,
      frozen: cast.water.frozen,
      from: cast.water.from ? cast.water.from.toArray() : null,
      streamStart: streamStart ? streamStart.toArray() : null,
      t: this.ctx.time.elapsed,
    });
    if (this.castLog.length > 40) this.castLog.shift();
  }

  update(dt: number): void {
    this.time += dt;
    WATER_TIME.value = this.time;
    const sun = (this.ctx.render as unknown as { sunDir?: THREE.Vector3 }).sunDir;
    if (sun && sun.lengthSq() > 0) WATER_SUN.value.copy(sun).normalize();
    const alive: WaterEffect[] = [];
    const frameTrace: Array<Record<string, unknown>> = [];
    for (const e of this.effects) {
      let keep = false;
      try {
        keep = e.update(dt);
      } catch (err) {
        console.error(`[WaterFX] ${e.kind} update failed`, err);
        keep = false;
      }
      if (this.traceOn && e.trace) {
        try {
          const t = e.trace();
          if (t) frameTrace.push({ kind: e.kind, castId: e.castId, ...t });
        } catch {
          /* ignore */
        }
      }
      if (keep) alive.push(e);
      else {
        try {
          e.dispose();
        } catch (err) {
          console.error(`[WaterFX] ${e.kind} dispose failed`, err);
        }
      }
    }
    this.effects = alive;
    if (this.traceOn && frameTrace.length) {
      this.traceLog.push({ frame: this.ctx.time.frame, time: this.ctx.time.elapsed, effects: frameTrace });
      if (this.traceLog.length > 900) this.traceLog.splice(0, this.traceLog.length - 900);
    }
    this.drops.update(dt);
    for (const [c, r] of this.reserves) {
      if (c.disposed || !c.alive) {
        r.dispose();
        this.reserves.delete(c);
        continue;
      }
      r.update(dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Meltable ice constructs
  // ---------------------------------------------------------------------------

  addMeltable(m: Meltable): () => void {
    this.meltables.add(m);
    return () => this.meltables.delete(m);
  }

  /** Heat at a point melts nearby ice constructs. Returns how many were affected. */
  meltNear(pos: THREE.Vector3, radius: number, intensity: number): number {
    let n = 0;
    for (const m of [...this.meltables]) {
      if (m.position.distanceTo(pos) <= radius + m.radius) {
        try {
          m.melt(intensity);
          n++;
        } catch (err) {
          console.error('[WaterFX] melt failed', err);
        }
      }
    }
    return n;
  }

  get meltableCount(): number {
    return this.meltables.size;
  }

  // ---------------------------------------------------------------------------
  // Reserve visuals
  // ---------------------------------------------------------------------------

  trackReserve(c: Combatant): ReserveVisual {
    let r = this.reserves.get(c);
    if (!r) {
      r = new ReserveVisual(this, c);
      this.reserves.set(c, r);
    }
    return r;
  }

  untrackReserve(c: Combatant): void {
    const r = this.reserves.get(c);
    if (r) {
      r.dispose();
      this.reserves.delete(c);
    }
  }

  reserveOf(c: Combatant): ReserveVisual | undefined {
    return this.reserves.get(c);
  }

  /** Where water for a cast starts: the real source point, else the caster's orbiting reserve, else the hands. */
  originFor(cast: Cast, hand: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    if (cast.water.from) return out.copy(cast.water.from);
    const r = this.reserves.get(cast.caster);
    if (r && (cast.water.sourceType === 'reserve' || cast.water.sourceType === null)) return r.pointNear(hand, out);
    if (cast.water.sourceType === 'conjured') return out.copy(hand).add(tmpA.set(0, 1.4, 0));
    // Reserve without a tracked visual (NPC benders): water swirls up from the waist.
    return out.copy(cast.caster.position).setY(cast.caster.position.y + 0.9).addScaledVector(tmpA.set(Math.sin(cast.caster.yaw), 0, Math.cos(cast.caster.yaw)), -0.6);
  }

  /** Visual pulse on the reserve (water drawn in / taken out). */
  pulseReserve(c: Combatant, amount = 1): void {
    this.reserves.get(c)?.pulse(amount);
  }

  // ---------------------------------------------------------------------------
  // Shared feedback helpers
  // ---------------------------------------------------------------------------

  /**
   * Splash crown: drops thrown out in a ring and up, biased along `dir` (the way the
   * water was travelling), that arc down under gravity.
   */
  crown(pos: THREE.Vector3, size = 1, dir?: THREE.Vector3): void {
    const s = Math.max(0.3, size);
    const k = Math.sqrt(s);
    const n = Math.round((8 + 16 * s) * (this.quality === 'low' ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const hs = (1.4 + 2.8 * Math.random()) * k;
      tmpB.set(Math.cos(a) * hs, (2.2 + 3.6 * Math.random()) * k, Math.sin(a) * hs);
      if (dir) tmpB.addScaledVector(tmpC.copy(dir).setY(0), hs * 0.7);
      this.drops.emit(pos, tmpB, (0.022 + 0.05 * Math.random()) * (0.75 + 0.25 * s), 0.9 + 0.6 * Math.random());
    }
  }

  /** A few drops peeling off a moving body of water at `pos` (velocity `vel`). */
  shed(pos: THREE.Vector3, vel: THREE.Vector3, count = 1, spread = 1.2): void {
    for (let i = 0; i < count; i++) {
      tmpB.copy(vel).multiplyScalar(0.35 + 0.3 * Math.random());
      tmpB.x += (Math.random() - 0.5) * spread;
      tmpB.y += (Math.random() - 0.2) * spread;
      tmpB.z += (Math.random() - 0.5) * spread;
      this.drops.emit(pos, tmpB, 0.018 + 0.03 * Math.random(), 0.8 + 0.5 * Math.random());
    }
  }

  splash(pos: THREE.Vector3, size = 1, opts: { ice?: boolean; sound?: boolean; volume?: number; dir?: THREE.Vector3; ring?: boolean } = {}): void {
    const vfx = this.ctx.vfx;
    const s = Math.max(0.3, size);
    if (opts.ice) {
      vfx.burst('ice', pos, { count: Math.round(10 + 10 * s), speed: 0.7 + 0.35 * s, size: 0.8 + 0.35 * s, dir: opts.dir, spread: opts.dir ? 0.9 : undefined });
      vfx.burst('snowpuff', pos, { count: Math.round(4 + 6 * s), size: 0.5 + 0.5 * s });
    } else {
      // Real drops (crown) plus a little fine spray and mist; no white flash.
      this.crown(pos, s, opts.dir);
      vfx.burst('splash', pos, { count: Math.round(4 + 6 * s), speed: 0.6 + 0.3 * s, size: 0.5 + 0.25 * s, dir: opts.dir, spread: opts.dir ? 0.9 : undefined });
      vfx.burst('spray', pos, { count: Math.round(2 + 3 * s), size: 0.35 + 0.3 * s });
    }
    if (opts.ring !== false && s >= 0.7) {
      const g = this.ctx.world.groundAt(pos.x, pos.z, pos.y + 1);
      if (Math.abs(g.y - pos.y) < 2.5) vfx.ring(tmpA.set(pos.x, g.y + 0.06, pos.z), opts.ice ? '#e6f8ff' : '#bfe8ff', 1.1 * s + 0.6, 0.45, { opacity: 0.45 });
    }
    if (opts.sound !== false) this.ctx.audio.play(opts.ice ? 'ice_shatter' : s > 1.2 ? 'water_impact' : 'water_splash', { position: pos, volume: Math.min(1, (opts.volume ?? 0.55) * (0.6 + 0.3 * s)) });
  }

  steam(pos: THREE.Vector3, size = 1): void {
    this.ctx.vfx.burst('steam', pos, { count: Math.round(8 + 8 * size), size: 0.8 + 0.4 * size });
    this.ctx.audio.play('steam_hiss', { position: pos, volume: 0.5 + 0.2 * size });
  }

  /** Water hitting something that burns: put it out with steam. */
  extinguish(e: Entity): boolean {
    if (!e.hasStatus('burn')) return false;
    e.removeStatus('burn');
    this.steam(e.aimPoint(tmpB), 0.8);
    return true;
  }

  /** Droplets falling off a curve (spent water). */
  droplets(path: PathSampler, s0: number, s1: number, count: number, ice = false): void {
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const s = s0 + (s1 - s0) * Math.random();
      path.at(s, tmpC);
      this.ctx.vfx.burst(ice ? 'ice' : 'splash', tmpC, { count: 2, speed: 0.35, spread: 1.4, size: 0.7 });
    }
  }

  clear(): void {
    for (const e of this.effects) {
      try {
        e.dispose();
      } catch {
        /* ignore */
      }
    }
    this.effects = [];
    for (const r of this.reserves.values()) r.dispose();
    this.reserves.clear();
    this.meltables.clear();
    this.drops.clear();
    this.traceLog = [];
  }
}

// ---------------------------------------------------------------------------
// Droplets: instanced beads of real (shaded) water with ballistic flight
// ---------------------------------------------------------------------------

const DROP_CAP: Record<Quality, number> = { low: 70, medium: 160, high: 260 };
const DROP_UP = new THREE.Vector3(0, 1, 0);
const dQ = new THREE.Quaternion();
const dS = new THREE.Vector3();
const dP = new THREE.Vector3();
const dV = new THREE.Vector3();
const dM = new THREE.Matrix4();

/**
 * Splash crowns, spray shed by fast streams and drips from carried water. Each
 * drop is a small sphere drawn with the bent-water shader, stretched along its
 * velocity, pulled down by gravity and removed when it reaches the ground.
 */
export class Droplets {
  readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.IcosahedronGeometry;
  readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly floor: Float32Array;
  private readonly max = DROP_CAP.high;
  count = 0;

  constructor(private readonly fx: WaterFX) {
    this.geo = new THREE.IcosahedronGeometry(1, 1);
    this.mat = createWaterMaterial({ foam: 0.45, flow: 1.2, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'water_droplets';
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.floor = new Float32Array(this.max);
    fx.group.add(this.mesh);
  }

  /** One drop: position, velocity (m/s), radius (m), lifetime (s). */
  emit(p: THREE.Vector3, v: THREE.Vector3, radius = 0.05, life = 1.4): void {
    const cap = DROP_CAP[this.fx.quality] ?? DROP_CAP.medium;
    let i = this.count;
    if (i >= cap) i = Math.floor(Math.random() * cap); // full: recycle a random drop
    else this.count++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.size[i] = radius;
    this.life[i] = life;
    this.floor[i] = this.fx.ctx.world.heightAt(p.x, p.z);
  }

  update(dt: number): void {
    const n = this.count;
    if (n === 0) {
      this.mesh.count = 0;
      return;
    }
    let w = 0;
    for (let i = 0; i < n; i++) {
      let life = this.life[i] - dt;
      const o = i * 3;
      let vx = this.vel[o], vy = this.vel[o + 1] - 13 * dt, vz = this.vel[o + 2];
      const drag = Math.max(0, 1 - 0.6 * dt);
      vx *= drag;
      vz *= drag;
      const x = this.pos[o] + vx * dt, y = this.pos[o + 1] + vy * dt, z = this.pos[o + 2] + vz * dt;
      if (y < this.floor[i]) life = 0; // landed
      if (life <= 0) continue;
      // Compact into slot w.
      const q = w * 3;
      this.pos[q] = x;
      this.pos[q + 1] = y;
      this.pos[q + 2] = z;
      this.vel[q] = vx;
      this.vel[q + 1] = vy;
      this.vel[q + 2] = vz;
      this.life[w] = life;
      this.size[w] = this.size[i];
      this.floor[w] = this.floor[i];
      const speed = Math.hypot(vx, vy, vz);
      const r = Math.max(0.004, this.size[i] * Math.min(1, life * 4));
      if (speed > 0.01) dQ.setFromUnitVectors(DROP_UP, dV.set(vx / speed, vy / speed, vz / speed));
      else dQ.identity();
      dS.set(r, r * (1 + Math.min(2.2, speed * 0.16)), r);
      dM.compose(dP.set(x, y, z), dQ, dS);
      this.mesh.setMatrixAt(w, dM);
      w++;
    }
    this.count = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }
}

// ---------------------------------------------------------------------------
// StreamBody: one tube + its path, the basic building block of water effects
// ---------------------------------------------------------------------------

export class StreamBody {
  readonly path = new PathSampler();
  readonly pts: THREE.Vector3[] = [];
  tube: FlowTube | null;
  /** Visible span as fractions of the path length. */
  tail = 0;
  head = 1;
  /** Base radius (m) and profile. */
  radius = 0.2;
  profile: (u: number) => number = (u) => capTaper(u, 0.12, 0.18);
  wobble = 0.04;

  constructor(private readonly fx: WaterFX, look: WaterLook = {}, detail = 1, count = 4, minRadial = 0) {
    this.tube = fx.tubes.acquire(look, detail, minRadial);
    for (let i = 0; i < count; i++) this.pts.push(new THREE.Vector3());
  }

  setLook(look: WaterLook): void {
    this.tube?.setLook(look);
  }

  /** Rebuild the path from pts[0..n) and pose the tube. */
  build(n = this.pts.length, closed = false): void {
    this.path.set(this.pts, n, closed);
    if (!this.tube) return;
    const L = this.path.length;
    const r = this.radius;
    const prof = this.profile;
    this.tube.build(this.path, this.tail * L, this.head * L, (u) => r * prof(u), this.wobble, this.fx.time);
  }

  hide(): void {
    this.tube?.hide();
  }

  dispose(): void {
    if (this.tube) this.fx.tubes.release(this.tube);
    this.tube = null;
  }
}

// ---------------------------------------------------------------------------
// Reserve: the water a bender carries, shaped by how much they hold
// ---------------------------------------------------------------------------

const LOOP_PTS = 12;
const ORB_PTS = 8;
/** Below this fraction of a full reserve the water is a ball over the palm. */
const ORB_FRAC = 0.3;
const rA = new THREE.Vector3();
const rB = new THREE.Vector3();
const rF = new THREE.Vector3();
const rR = new THREE.Vector3();

/**
 * Carried water, proportional to waterReserve. A little water is a wobbling ball
 * floating over the bender's right palm; more becomes a stream that flows around
 * the upper body (higher behind the back, lower in front) and passes through both
 * hands, so it follows every arm movement of the animation. Drips fall from it.
 */
export class ReserveVisual {
  private loop: StreamBody | null = null;
  private orb: StreamBody | null = null;
  private readonly center = new THREE.Vector3();
  private readonly handL = new THREE.Vector3();
  private readonly handR = new THREE.Vector3();
  private angle = Math.random() * Math.PI * 2;
  private shown = 0;
  private icy = 0;
  private pulseT = 0;
  private dripT = 0.5;
  /** 0 = ball over the palm, 1 = stream around the body. */
  private form = 0;
  private initialized = false;
  /** Forced icy look (e.g. reserve gathered from snow). */
  frozenHint = 0;

  constructor(private readonly fx: WaterFX, readonly owner: Combatant) {}

  pulse(amount = 1): void {
    this.pulseT = Math.min(1, this.pulseT + 0.35 * amount);
  }

  get fraction(): number {
    return this.owner.maxWaterReserve > 0 ? clamp01(this.owner.waterReserve / this.owner.maxWaterReserve) : 0;
  }

  /** Debug/tests: whether the carried water is currently drawn, and how icy it looks. */
  get visible(): boolean {
    return !!(this.loop?.tube?.mesh.visible || this.orb?.tube?.mesh.visible);
  }

  get icyLevel(): number {
    return this.icy;
  }

  get shownAmount(): number {
    return this.shown;
  }

  /** Point of the carried water nearest to p (falls back to the waist). */
  pointNear(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    if (this.shown < 0.3) {
      const o = this.owner.position;
      return out.set(o.x, o.y + 1.0, o.z);
    }
    if (this.form < 0.5 || !this.loop || this.loop.path.length < 0.1) return out.copy(this.handR).setY(this.handR.y + 0.18);
    const res = { s: 0 };
    const L = this.loop.path.length;
    this.loop.path.distanceTo(p, this.loop.tail * L, this.loop.head * L, 0.15, res);
    return this.loop.path.at(res.s, out);
  }

  private body(which: 'loop' | 'orb'): StreamBody {
    if (which === 'loop') {
      if (!this.loop) {
        this.loop = new StreamBody(this.fx, { flow: 2.4, opacity: 0.92 }, 1, LOOP_PTS);
        this.loop.wobble = 0.025;
      }
      return this.loop;
    }
    if (!this.orb) {
      this.orb = new StreamBody(this.fx, { flow: 1.6, opacity: 0.94 }, 1, ORB_PTS);
      this.orb.wobble = 0.02;
    }
    return this.orb;
  }

  update(dt: number): void {
    const o = this.owner;
    const amount = Math.max(0, o.waterReserve);
    // Displayed amount follows the real one quickly (drains/fills visibly).
    this.shown += (amount - this.shown) * Math.min(1, dt * 8);
    if (Math.abs(this.shown - amount) < 0.05) this.shown = amount;
    const frac = o.maxWaterReserve > 0 ? clamp01(this.shown / o.maxWaterReserve) : 0;
    const chest = tmpA.set(o.position.x, o.position.y + 1.1, o.position.z);
    o.castOrigin('handL', rA);
    o.castOrigin('handR', rB);
    if (!this.initialized) {
      this.center.copy(chest);
      this.handL.copy(rA);
      this.handR.copy(rB);
      this.initialized = true;
    } else {
      this.center.lerp(chest, Math.min(1, dt * 14));
      this.handL.lerp(rA, Math.min(1, dt * 20));
      this.handR.lerp(rB, Math.min(1, dt * 20));
    }
    if (this.shown < 0.35 || !o.alive) {
      this.loop?.hide();
      this.orb?.hide();
      return;
    }
    const cold = biomeWeights(o.position.x, o.position.z).cold;
    const icyTarget = Math.max(this.frozenHint, cold > 0.55 && !(o.body?.swimming) ? 0.55 : 0);
    this.icy += (icyTarget - this.icy) * Math.min(1, dt * 1.5);
    this.frozenHint = Math.max(0, this.frozenHint - dt * 0.05);
    this.pulseT = Math.max(0, this.pulseT - dt * 1.6);
    const t = this.fx.time;
    this.angle += dt * (1.2 + 1.0 * frac + this.pulseT * 3);
    this.form += ((frac >= ORB_FRAC ? 1 : 0) - this.form) * Math.min(1, dt * 5);
    const look = { ice: this.icy, flow: 2 + frac * 2 + this.pulseT * 4, glow: this.pulseT * 0.2 };

    // Ball over the right palm: a fat ring around a small circle reads as a wobbling ball.
    const orbW = 1 - this.form;
    if (orbW > 0.03) {
      const b = this.body('orb');
      const rb = 0.06 + 0.2 * Math.min(frac, ORB_FRAC);
      rF.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
      const c = rA.copy(this.handR).addScaledVector(rF, 0.1);
      c.y += 0.16 + 0.03 * Math.sin(t * 2.3);
      for (let i = 0; i < ORB_PTS; i++) {
        const a = this.angle * 2.2 + (i / ORB_PTS) * Math.PI * 2;
        const wob = 1 + 0.12 * Math.sin(3 * a + t * 4.1);
        b.pts[i].set(c.x + Math.cos(a) * rb * wob, c.y + Math.sin(a) * rb * 0.8 * wob, c.z + Math.sin(a + 1.3) * rb * 0.6);
      }
      b.tail = 0;
      b.head = 1;
      b.radius = rb * 0.95 * orbW;
      b.profile = (u) => 0.9 + 0.1 * Math.sin(u * 12 - t * 5);
      b.setLook(look);
      b.build(ORB_PTS, true);
    } else this.orb?.hide();

    // Stream around the body, threaded through both hands.
    if (this.form > 0.03) {
      const b = this.body('loop');
      rF.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
      rR.set(-rF.z, 0, rF.x);
      const Rx = 0.7 + 0.22 * frac + 0.06 * this.pulseT;
      const Rz = 0.58 + 0.14 * frac;
      // Angles of the hands around the chest (right = +rR, forward = +rF).
      const angOf = (h: THREE.Vector3) => Math.atan2(rF.dot(rB.copy(h).sub(this.center)), rR.dot(rB));
      const aL = angOf(this.handL);
      const aR = angOf(this.handR);
      for (let i = 0; i < LOOP_PTS; i++) {
        const th = this.angle + (i / LOOP_PTS) * Math.PI * 2;
        const c = Math.cos(th), sn = Math.sin(th);
        const p = b.pts[i]
          .copy(this.center)
          .addScaledVector(rR, c * Rx)
          .addScaledVector(rF, sn * Rz);
        // Rises over the shoulders behind, dips toward the hands in front; a travelling wave along it.
        p.y += -0.42 * sn + 0.09 * Math.sin(2 * th + t * 2.6);
        // Pulled toward the palms (the arms carry the water).
        const wl = Math.pow(Math.max(0, Math.cos(th - aL)), 6) * 0.75;
        const wr = Math.pow(Math.max(0, Math.cos(th - aR)), 6) * 0.75;
        if (wl > 0.01) p.lerp(this.handL, wl);
        if (wr > 0.01) p.lerp(this.handR, wr);
      }
      b.tail = 0;
      // An open serpent of water (head and tail), never a closed hoop.
      b.head = 0.3 + 0.5 * Math.pow(frac, 0.8);
      b.radius = (0.05 + 0.085 * Math.pow(frac, 0.7) + 0.03 * this.pulseT) * this.form;
      b.profile = (u) => capTaper(u, 0.14, 0.2) * (0.86 + 0.14 * Math.sin(u * 16 - t * 5.5));
      b.setLook(look);
      b.build(LOOP_PTS, true);
    } else this.loop?.hide();

    // Drips: carried water is real water.
    this.dripT -= dt;
    if (this.dripT <= 0 && this.icy < 0.5) {
      this.dripT = (0.35 + Math.random() * 0.7) / (0.4 + frac);
      const src = this.form > 0.5 ? this.loop : this.orb;
      if (src && src.path.length > 0.1) {
        const L = src.path.length;
        src.path.at((src.tail + (src.head - src.tail) * Math.random()) * L, rA);
        this.fx.drops.emit(rA, rB.set((Math.random() - 0.5) * 0.4, -0.4, (Math.random() - 0.5) * 0.4), 0.018 + 0.016 * Math.random(), 1.2);
      }
    }
  }

  dispose(): void {
    this.loop?.dispose();
    this.orb?.dispose();
    this.loop = null;
    this.orb = null;
  }
}
