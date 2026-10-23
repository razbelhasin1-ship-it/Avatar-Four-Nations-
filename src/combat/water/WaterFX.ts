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

  splash(pos: THREE.Vector3, size = 1, opts: { ice?: boolean; sound?: boolean; volume?: number; dir?: THREE.Vector3; ring?: boolean } = {}): void {
    const vfx = this.ctx.vfx;
    const s = Math.max(0.3, size);
    vfx.burst(opts.ice ? 'ice' : 'splash', pos, { count: Math.round(10 + 10 * s), speed: 0.7 + 0.35 * s, size: 0.8 + 0.35 * s, dir: opts.dir, spread: opts.dir ? 0.9 : undefined });
    vfx.burst(opts.ice ? 'snowpuff' : 'spray', pos, { count: Math.round(4 + 6 * s), size: 0.5 + 0.5 * s });
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
    this.traceLog = [];
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
// Reserve: water orbiting the bender, proportional to waterReserve
// ---------------------------------------------------------------------------

const RING_PTS = 10;

export class ReserveVisual {
  private body: StreamBody | null = null;
  private readonly center = new THREE.Vector3();
  private angle = Math.random() * Math.PI * 2;
  private shown = 0;
  private icy = 0;
  private pulseT = 0;
  private droplets: THREE.Mesh[] = [];
  private dropMat: THREE.ShaderMaterial | null = null;
  private dropGeo: THREE.SphereGeometry | null = null;
  private initialized = false;
  /** Forced icy look (e.g. reserve gathered from snow). */
  frozenHint = 0;
  private readonly ringR = { value: 0.85 };

  constructor(private readonly fx: WaterFX, readonly owner: Combatant) {}

  pulse(amount = 1): void {
    this.pulseT = Math.min(1, this.pulseT + 0.35 * amount);
  }

  private ensure(): StreamBody {
    if (!this.body) {
      this.body = new StreamBody(this.fx, { flow: 2.2, opacity: 0.88 }, 1, RING_PTS);
      this.body.wobble = 0.02;
    }
    return this.body;
  }

  private ensureDroplets(n: number): void {
    if (this.droplets.length === n) return;
    if (!this.dropMat) {
      this.dropMat = createWaterMaterial({ flow: 1, foam: 0.4 });
      this.dropGeo = new THREE.SphereGeometry(1, 10, 8);
    }
    while (this.droplets.length < n) {
      const m = new THREE.Mesh(this.dropGeo!, this.dropMat);
      m.renderOrder = 12;
      m.frustumCulled = false;
      this.fx.group.add(m);
      this.droplets.push(m);
    }
    while (this.droplets.length > n) {
      const m = this.droplets.pop()!;
      this.fx.group.remove(m);
    }
  }

  get fraction(): number {
    return this.owner.maxWaterReserve > 0 ? clamp01(this.owner.waterReserve / this.owner.maxWaterReserve) : 0;
  }

  /** Debug/tests: whether the orbiting ring is currently drawn, and how icy it looks. */
  get visible(): boolean {
    return !!this.body?.tube?.mesh.visible;
  }

  get icyLevel(): number {
    return this.icy;
  }

  get shownAmount(): number {
    return this.shown;
  }

  /** Point on the ring nearest to p (falls back to the waist). */
  pointNear(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    if (!this.body || this.shown < 0.3 || this.body.path.length < 0.1) {
      const o = this.owner.position;
      return out.set(o.x, o.y + 1.0, o.z);
    }
    const res = { s: 0 };
    const L = this.body.path.length;
    this.body.path.distanceTo(p, this.body.tail * L, this.body.head * L, 0.15, res);
    return this.body.path.at(res.s, out);
  }

  update(dt: number): void {
    const o = this.owner;
    const amount = Math.max(0, o.waterReserve);
    // Displayed amount follows the real one quickly (drains/fills visibly).
    this.shown += (amount - this.shown) * Math.min(1, dt * 8);
    if (Math.abs(this.shown - amount) < 0.05) this.shown = amount;
    const frac = o.maxWaterReserve > 0 ? clamp01(this.shown / o.maxWaterReserve) : 0;
    const target = tmpA.set(o.position.x, o.position.y + 1.02, o.position.z);
    if (!this.initialized) {
      this.center.copy(target);
      this.initialized = true;
    } else this.center.lerp(target, Math.min(1, dt * 14));
    // Hidden at zero.
    if (this.shown < 0.35 || !o.alive) {
      this.body?.hide();
      this.ensureDroplets(0);
      return;
    }
    const body = this.ensure();
    // Icy look in the cold or when gathered from snow.
    const cold = biomeWeights(o.position.x, o.position.z).cold;
    const icyTarget = Math.max(this.frozenHint, cold > 0.55 && !(o.body?.swimming) ? 0.55 : 0);
    this.icy += (icyTarget - this.icy) * Math.min(1, dt * 1.5);
    this.frozenHint = Math.max(0, this.frozenHint - dt * 0.05);
    this.pulseT = Math.max(0, this.pulseT - dt * 1.6);
    const t = this.fx.time;
    this.angle += dt * (1.5 + 1.4 * frac + this.pulseT * 3);
    const R = 0.68 + 0.22 * frac + 0.08 * this.pulseT;
    this.ringR.value = R;
    const tilt = 0.12 * Math.sin(t * 0.7);
    for (let i = 0; i < RING_PTS; i++) {
      const a = this.angle + (i / RING_PTS) * Math.PI * 2;
      const wave = 0.09 * Math.sin(3 * a + t * 2.2) + tilt * Math.cos(a);
      const rr = R * (1 + 0.06 * Math.sin(2 * a - t * 1.7));
      body.pts[i].set(this.center.x + Math.cos(a) * rr, this.center.y + wave, this.center.z + Math.sin(a) * rr);
    }
    const span = 0.16 + 0.78 * Math.pow(frac, 0.8);
    body.tail = 0;
    body.head = span;
    body.radius = 0.035 + 0.085 * Math.pow(frac, 0.7) + 0.03 * this.pulseT;
    body.profile = (u) => capTaper(u, 0.18, 0.25) * (0.85 + 0.15 * Math.sin(u * 18 - t * 6));
    body.setLook({ ice: this.icy, flow: 2 + frac * 2 + this.pulseT * 4, glow: this.pulseT * 0.25 });
    body.build(RING_PTS, true);
    // Droplets orbit in a second, tilted plane (medium/high only).
    const q = this.fx.quality;
    const nd = q === 'low' ? 0 : Math.min(q === 'high' ? 5 : 3, Math.floor(frac * 6));
    this.ensureDroplets(nd);
    if (this.dropMat) {
      this.dropMat.uniforms.uIce.value = this.icy;
    }
    for (let i = 0; i < this.droplets.length; i++) {
      const a = -this.angle * 1.3 + (i / Math.max(1, this.droplets.length)) * Math.PI * 2;
      const m = this.droplets[i];
      const r2 = R * 1.18;
      m.position.set(this.center.x + Math.cos(a) * r2, this.center.y + 0.25 * Math.sin(a * 1.0 + t) + 0.1, this.center.z + Math.sin(a) * r2 * 0.9);
      m.scale.setScalar(0.05 + 0.03 * Math.sin(t * 3 + i));
    }
  }

  dispose(): void {
    this.body?.dispose();
    this.body = null;
    this.ensureDroplets(0);
    this.dropMat?.dispose();
    this.dropGeo?.dispose();
    this.dropMat = null;
    this.dropGeo = null;
  }
}
