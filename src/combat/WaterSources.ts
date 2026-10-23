import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { WaterSourceType } from '../core/types';
import { biomeWeights, getLakeRuntime, getRiverRuntime, heightAt, MARSH, waterAt } from '../world/Heightfield';
import { SEA_LEVEL } from '../world/WorldLayout';
import type { Combatant, WaterGrant, WaterRequirement } from './types';

/**
 * Environmental water source registry and bookkeeping.
 *
 * Ordinary waterbending NEVER creates water from nothing: techniques with a
 * `water` requirement obtain it via acquire(), which uses (1) the bender's
 * reserve (water already gathered and orbiting them), then (2) the best usable
 * source within draw range, then (3) a carried water skin (flask). Only
 * requirements with canConjure (Elements Sphere ultimates) may make up a
 * shortfall. acquire() never consumes anything when it fails.
 *
 * Large sources (ocean, rivers, lakes, the swamp) are effectively unlimited but
 * rate-limited locally; small sources (ponds, fountains, puddles, ice walls)
 * have finite capacity that visibly/mechanically depletes and regenerates.
 * Frozen sources (frozen lakes/rivers, sea ice, glaciers, ice walls) only serve
 * ice techniques (allowIce); snow needs the Snow Gathering passive
 * (water_snow_draw); rain is a weak, slow source.
 *
 * ── Registering sources (regions, constructs) ──────────────────────────────
 *
 *   // A fountain in a city square: finite, refills slowly, visual follows level.
 *   ctx.water.register({
 *     id: 'ba_sing_se:upper_fountain', type: 'fountain', label: 'Upper Ring Fountain',
 *     x: 812, y: 27.4, z: -40,     // water surface centre (world metres)
 *     r: 2.2,                      // disc radius (0 = point source)
 *     capacity: 60,                // units when full (a whip uses 4, a blast 12)
 *     regen: 1.5,                  // units refilled per second
 *     onChange: (amount, capacity) => (fountainWater.scale.y = 0.15 + 0.85 * (amount / capacity)),
 *   });
 *
 *   // A canal network: linear source (polyline + half-width), unlimited but
 *   // rate-limited locally like a river.
 *   ctx.water.register({
 *     id: 'nwt:main_canal', type: 'canal', label: 'Canal', x: -220, y: 3.2, z: -1600, r: 3,
 *     path: [{ x: -300, z: -1600 }, { x: -220, z: -1600 }, { x: -150, z: -1650 }],
 *     capacity: Infinity, regen: 0, size: 'medium',
 *   });
 *
 *   // Temporary sources (auto-removed after ttl seconds or with unregister()).
 *   const id = ctx.water.registerDynamic({ type: 'ice', label: 'Ice Wall', x, y, z, r: 2,
 *     capacity: 40, regen: 0, frozen: true, ttl: 20 });
 *
 * Sources registered from a region's build() live for the whole app (amounts
 * are refilled when a session ends); dynamic ones (`dyn_*`) and anything with a
 * ttl are cleared at session end. ctx.water.release(point, amount) returns
 * spent water to the world: it refills a nearby finite source or leaves a
 * temporary puddle that can be bent again.
 */

export type SourceSize = 'small' | 'medium' | 'large';

export interface WaterSourceDef {
  id: string;
  type: WaterSourceType;
  label: string;
  /** Point sources (fountain, puddle, flask origin) or disc sources (pond). */
  x: number;
  y: number;
  z: number;
  /** Disc radius (0 = point). For `path` sources: half-width of the channel. */
  r: number;
  /** Units when full. Infinity = unlimited (rate-limited locally like a river). */
  capacity: number;
  /** Units regenerated per second. */
  regen: number;
  frozen?: boolean;
  /** Owner entity id for dynamic sources (ice walls...). */
  owner?: number;
  /** Seconds until auto-removal (dynamic sources). */
  ttl?: number;
  // --- additive (waterbending) -------------------------------------------
  /** Linear source (canal, aqueduct): polyline in XZ; `y` is the surface height, `r` the half-width. */
  path?: Array<{ x: number; z: number }>;
  /** Size class (Water Spout needs 'large'). Defaults by type. */
  size?: SourceSize;
  /** Called when the amount changes (throttled) so owners can update visuals. */
  onChange?(amount: number, capacity: number): void;
}

export interface WaterSource extends WaterSourceDef {
  amount: number;
}

export interface SourceHit {
  id: string;
  type: WaterSourceType;
  label: string;
  point: THREE.Vector3;
  distance: number;
  available: number;
  frozen: boolean;
  // --- additive (waterbending) -------------------------------------------
  /** Capacity of finite sources (Infinity for unlimited ones). */
  capacity?: number;
  size?: SourceSize;
  /** Units actually moved by drawToReserve(). */
  drawn?: number;
}

export interface FindOptions {
  allowLiquid?: boolean;
  allowIce?: boolean;
  allowSnow?: boolean;
  /** Prefer sources in this horizontal direction. */
  facing?: THREE.Vector3;
  // --- additive (waterbending) -------------------------------------------
  /** Only large bodies of liquid water (ocean, rivers, lakes, the swamp). */
  largeOnly?: boolean;
  /** Prefer frozen sources (ice techniques). */
  preferFrozen?: boolean;
  /** Include depleted finite sources (HUD "dry" reporting). */
  includeDepleted?: boolean;
}

/** Carried water (the water skin accessory) provided by the waterbending module. */
export interface CarriedSupply {
  readonly amount: number;
  readonly capacity: number;
  /** World point the water emerges from (hip). */
  point(out: THREE.Vector3): THREE.Vector3;
  take(n: number): void;
}

export interface WaterFailure {
  reason: 'none' | 'frozen' | 'snow' | 'dry' | 'busy' | 'small' | 'full' | 'cannot';
  message: string;
  /** Technique id when the failure came from a cast. */
  techniqueId?: string;
}

export interface WaterDescription {
  label: string;
  ok: boolean;
  kind: 'liquid' | 'ice' | 'snow' | 'rain' | 'flask' | 'reserve' | 'none';
  /** 0..1 for finite sources. */
  fraction?: number;
  sourceId?: string;
}

export interface SourceEvent {
  kind: 'added' | 'removed';
  source: WaterSource;
}

const OCEAN_CACHE_TIME = 0.25;
/** Local draw budget (units per RATE_WINDOW seconds within RATE_RADIUS metres) for unlimited sources. */
const RATE_WINDOW = 3;
const RATE_RADIUS = 6;
const MAX_PUDDLES = 28;

const DEFAULT_SIZE: Record<WaterSourceType, SourceSize> = {
  ocean: 'large',
  river: 'large',
  lake: 'large',
  waterfall: 'large',
  stream: 'medium',
  pond: 'medium',
  canal: 'medium',
  ice: 'medium',
  fountain: 'small',
  puddle: 'small',
  snow: 'small',
  rain: 'small',
  moisture: 'small',
  flask: 'small',
};

/** Units drawable per RATE_WINDOW from one spot of an unlimited source. */
const RATE_CAP: Partial<Record<WaterSourceType, number>> = {
  ocean: 180,
  river: 160,
  lake: 160,
  waterfall: 180,
  stream: 110,
  canal: 110,
  pond: 110,
  ice: 120,
  snow: 60,
  rain: 24,
};

export class WaterSourceSystem implements GameSystem {
  private ctx!: GameContext;
  private sources = new Map<string, WaterSource>();
  private nextDyn = 1;
  /** Base draw range in metres (Avatar State extends it). */
  drawRange = 16;
  private oceanCache: { x: number; z: number; t: number; hits: SourceHit[] } = { x: 1e9, z: 1e9, t: -1, hits: [] };
  /** Local draw rate limiting for "infinite" sources: units drawn recently near a point. */
  private recentDraws: Array<{ x: number; z: number; amount: number; t: number; id: string }> = [];
  private listeners = new Set<(e: SourceEvent) => void>();
  private changeTimer = new Map<string, number>();
  /** Set by the weather system. */
  raining = false;
  /** Last acquire()/drawToReserve() failure explanation (HUD feedback). */
  lastFailure: WaterFailure | null = null;
  /** Carried water (water skin) for a caster; installed by the waterbending module. */
  carriedSupply: (caster: Combatant) => CarriedSupply | null = () => null;
  /** Whether a caster may bend snow (player: knows water_snow_draw). */
  snowCapable: (caster: Combatant) => boolean = (c) =>
    c.isPlayer ? !!this.ctx?.progression?.knows?.('water_snow_draw') : !!(c as unknown as { canBendSnow?: boolean }).canBendSnow;
  private supplyCache: { x: number; z: number; t: number; liquid: SourceHit[]; all: SourceHit[] } | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.registerSmallLakes();
  }

  /** Ponds, tarns, oases and hot springs are finite (they visibly drain and refill). */
  private registerSmallLakes(): void {
    for (const l of getLakeRuntime()) {
      if (l.def.kind === 'lake' || l.def.r > 30) continue;
      const capacity = Math.round(6 * l.def.r);
      this.register({
        id: `lake:${l.def.id}`,
        type: 'pond',
        label: l.def.name,
        x: l.def.x,
        y: l.level,
        z: l.def.z,
        r: l.def.r,
        capacity,
        regen: capacity / 60,
        frozen: !!l.def.frozen,
        size: 'medium',
      });
    }
  }

  register(def: WaterSourceDef): string {
    const prev = this.sources.get(def.id);
    if (prev) this.emitSource({ kind: 'removed', source: prev });
    const src: WaterSource = { ...def, amount: def.capacity };
    this.sources.set(def.id, src);
    this.emitSource({ kind: 'added', source: src });
    return def.id;
  }

  /** Register a temporary source (ice wall, puddle left by a water attack). */
  registerDynamic(def: Omit<WaterSourceDef, 'id'>): string {
    const id = `dyn_${this.nextDyn++}`;
    return this.register({ ...def, id });
  }

  unregister(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    this.sources.delete(id);
    this.emitSource({ kind: 'removed', source: s });
  }

  get(id: string): WaterSource | undefined {
    return this.sources.get(id);
  }

  list(): IterableIterator<WaterSource> {
    return this.sources.values();
  }

  /** Listen for sources being added/removed (puddle & construct visuals). Returns an unsubscribe fn. */
  onSource(fn: (e: SourceEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitSource(e: SourceEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('[Water] source listener failed', err);
      }
    }
  }

  private now(): number {
    return this.ctx?.time?.elapsed ?? 0;
  }

  /** Draw range for a caster (Avatar State extends it). */
  rangeFor(caster?: Combatant): number {
    const avatar = caster?.isPlayer && this.ctx?.avatar?.active;
    return this.drawRange * (avatar ? 1.8 : 1);
  }

  private effectiveRange(caster?: Combatant): number {
    return this.rangeFor(caster);
  }

  private sizeOf(type: WaterSourceType, id: string, def?: SourceSize): SourceSize {
    if (def) return def;
    if (id === 'marsh') return 'large';
    return DEFAULT_SIZE[type] ?? 'small';
  }

  /** Nearest liquid ocean and nearest sea ice by sampling terrain rings (cached briefly). */
  private findOcean(pos: THREE.Vector3, maxDist: number): SourceHit[] {
    const now = this.now();
    const c = this.oceanCache;
    if (now - c.t < OCEAN_CACHE_TIME && now >= c.t && Math.abs(c.x - pos.x) < 1.5 && Math.abs(c.z - pos.z) < 1.5) {
      for (const h of c.hits) h.distance = h.point.distanceTo(pos);
      return c.hits;
    }
    let liquid: SourceHit | null = null;
    let ice: SourceHit | null = null;
    const steps = [0, 2, 4, 6, 8, 10, 12, 14, 16, 19, 22, 26, 30];
    for (const r of steps) {
      if (r > maxDist + 1) break;
      const n = r === 0 ? 1 : Math.max(12, Math.round(r * 1.6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h >= SEA_LEVEL - 0.02) continue;
        const w = waterAt(x, z, h);
        if (!w || w.kind !== 'ocean') continue;
        const p = new THREE.Vector3(x, SEA_LEVEL, z);
        const d = p.distanceTo(pos);
        if (w.frozen) {
          if (!ice || d < ice.distance) ice = { id: 'sea_ice', type: 'ocean', label: 'Sea Ice', point: p, distance: d, available: 999, frozen: true, capacity: Infinity, size: 'large' };
        } else if (!liquid || d < liquid.distance) {
          liquid = { id: 'ocean', type: 'ocean', label: 'Ocean', point: p, distance: d, available: 999, frozen: false, capacity: Infinity, size: 'large' };
        }
      }
      if (liquid && ice) break;
    }
    const hits: SourceHit[] = [];
    if (liquid) hits.push(liquid);
    if (ice) hits.push(ice);
    this.oceanCache = { x: pos.x, z: pos.z, t: now, hits };
    return hits;
  }

  /** All candidate sources within maxDist, nearest first. */
  findAll(pos: THREE.Vector3, maxDist: number, o: FindOptions = {}): SourceHit[] {
    const allowLiquid = o.allowLiquid ?? true;
    const out: SourceHit[] = [];
    const consider = (hit: SourceHit) => {
      if (hit.distance > maxDist) return;
      if (hit.type === 'snow') {
        if (!o.allowSnow) return;
      } else if (hit.frozen) {
        if (!o.allowIce) return;
      } else if (!allowLiquid) return;
      if (o.largeOnly && (hit.frozen || hit.type === 'snow' || hit.size !== 'large')) return;
      if (!o.includeDepleted && hit.available <= 0.01) return;
      out.push(hit);
    };
    // Rivers
    const sArr = new Float64Array(1);
    for (const r of getRiverRuntime()) {
      if (!r.line.inBounds(pos.x, pos.z)) continue;
      const d = r.line.distance(pos.x, pos.z, sArr);
      const width = r.width(sArr[0]);
      const half = width * 0.5;
      if (d - half > maxDist) continue;
      const cp = r.line.pointAt(sArr[0]);
      // Point on the river surface nearest to pos (clamped inside the channel).
      const dx = pos.x - cp.x, dz = pos.z - cp.z;
      const dl = Math.hypot(dx, dz);
      const k = dl > half - 0.5 ? (half - 0.5) / Math.max(dl, 1e-6) : 1;
      const p = new THREE.Vector3(cp.x + dx * k, r.surface(sArr[0]), cp.z + dz * k);
      const type: WaterSourceType = width < 9 ? 'stream' : 'river';
      consider({ id: `river:${r.id}`, type, label: r.frozen ? 'Frozen River' : type === 'stream' ? 'Stream' : 'River', point: p, distance: p.distanceTo(pos), available: 999, frozen: r.frozen, capacity: Infinity, size: this.sizeOf(type, '') });
    }
    // Lakes / ponds from the heightfield (small ones are finite, see registerSmallLakes)
    for (const l of getLakeRuntime()) {
      const dx = pos.x - l.def.x, dz = pos.z - l.def.z;
      const d = Math.hypot(dx, dz);
      if (d - l.def.r > maxDist) continue;
      const k = d > l.def.r - 0.5 ? (l.def.r - 0.5) / Math.max(d, 1e-6) : 1;
      const p = new THREE.Vector3(l.def.x + dx * k, l.level, l.def.z + dz * k);
      const src = this.sources.get(`lake:${l.def.id}`);
      const type: WaterSourceType = src ? src.type : l.def.kind === 'pond' || l.def.kind === 'hotspring' ? 'pond' : 'lake';
      consider({
        id: `lake:${l.def.id}`,
        type,
        label: l.def.name,
        point: p,
        distance: p.distanceTo(pos),
        available: src ? src.amount : 999,
        frozen: !!l.def.frozen,
        capacity: src ? src.capacity : Infinity,
        size: src?.size ?? this.sizeOf(type, ''),
      });
    }
    // Marsh (the Foggy Swamp's pools)
    {
      const d = Math.hypot(pos.x - MARSH.x, pos.z - MARSH.z);
      if (d < MARSH.r * 0.85 + maxDist) {
        const w = waterAt(pos.x, pos.z);
        if (w && w.kind === 'marsh') {
          consider({ id: 'marsh', type: 'pond', label: 'Swamp Water', point: new THREE.Vector3(pos.x, w.level, pos.z), distance: Math.max(0, pos.y - w.level), available: 999, frozen: false, capacity: Infinity, size: 'large' });
        } else {
          // Sample a few nearby points for pools.
          let best: SourceHit | null = null;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            for (const rr of [3, 7, 12]) {
              if (rr > maxDist) continue;
              const x = pos.x + Math.cos(a) * rr, z = pos.z + Math.sin(a) * rr;
              const ww = waterAt(x, z);
              if (ww && ww.kind === 'marsh') {
                const p = new THREE.Vector3(x, ww.level, z);
                const dd = p.distanceTo(pos);
                if (!best || dd < best.distance) best = { id: 'marsh', type: 'pond', label: 'Swamp Pool', point: p, distance: dd, available: 999, frozen: false, capacity: Infinity, size: 'large' };
              }
            }
          }
          if (best) consider(best);
        }
      }
    }
    // Ocean & sea ice
    for (const h of this.findOcean(pos, maxDist)) consider(h);
    // Registered sources (fountains, canals, puddles, ice walls...)
    for (const s of this.sources.values()) {
      if (s.id.startsWith('lake:')) continue; // handled with the heightfield lakes above
      const hit = this.registeredHit(s, pos, maxDist);
      if (hit) consider(hit);
    }
    // Snow underfoot / around (cold biome ground) and glacier ice.
    if (o.allowSnow || o.allowIce) {
      const world = this.ctx?.world;
      if (world) {
        const b = biomeWeights(pos.x, pos.z);
        const g = world.groundAt(pos.x, pos.z, pos.y + 1);
        const surf = g.surface;
        const p = new THREE.Vector3(pos.x, g.y, pos.z);
        const dist = Math.max(0, pos.y - p.y);
        if (o.allowSnow && (b.cold > 0.5 || surf === 'snow' || surf === 'packedsnow')) {
          consider({ id: 'snowfield', type: 'snow', label: 'Snow', point: p, distance: dist, available: 60, frozen: true, capacity: Infinity, size: 'small' });
        }
        if (o.allowIce && surf === 'ice' && g.colliderId === 0 && !waterAt(pos.x, pos.z)) {
          consider({ id: 'glacier', type: 'ice', label: 'Glacier Ice', point: p, distance: dist, available: 999, frozen: true, capacity: Infinity, size: 'medium' });
        }
      }
    }
    // Rain counts as a weak source when weather says so (set by weather system).
    if (this.raining) consider({ id: 'rain', type: 'rain', label: 'Rain', point: pos.clone().setY(pos.y + 3), distance: 3, available: 20, frozen: false, capacity: Infinity, size: 'small' });
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  private registeredHit(s: WaterSource, pos: THREE.Vector3, maxDist: number): SourceHit | null {
    let px: number, pz: number;
    if (s.path && s.path.length >= 2) {
      // Nearest point on the polyline, clamped inside the channel half-width.
      let best = Infinity;
      let bx = s.path[0].x, bz = s.path[0].z;
      for (let i = 0; i < s.path.length - 1; i++) {
        const a = s.path[i], b = s.path[i + 1];
        const abx = b.x - a.x, abz = b.z - a.z;
        const l2 = abx * abx + abz * abz;
        let t = l2 > 0 ? ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = a.x + abx * t, cz = a.z + abz * t;
        const d2 = (cx - pos.x) ** 2 + (cz - pos.z) ** 2;
        if (d2 < best) {
          best = d2;
          bx = cx;
          bz = cz;
        }
      }
      const d = Math.sqrt(best);
      if (d - s.r > maxDist) return null;
      const inner = Math.max(0, s.r - 0.3);
      const k = d > inner ? inner / Math.max(d, 1e-6) : 1;
      px = bx + (pos.x - bx) * k;
      pz = bz + (pos.z - bz) * k;
    } else {
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d - s.r > maxDist) return null;
      const k = s.r > 0 && d > s.r ? s.r / d : s.r > 0 ? 1 : 0;
      px = s.x + dx * k;
      pz = s.z + dz * k;
    }
    const p = new THREE.Vector3(px, s.y, pz);
    return {
      id: s.id,
      type: s.type,
      label: s.label,
      point: p,
      distance: p.distanceTo(pos),
      available: s.amount,
      frozen: !!s.frozen,
      capacity: s.capacity,
      size: this.sizeOf(s.type, s.id, s.size),
    };
  }

  private score(h: SourceHit, pos: THREE.Vector3, o: FindOptions): number {
    let score = h.distance;
    if (o.facing) {
      const f = o.facing;
      const dx = h.point.x - pos.x, dz = h.point.z - pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const dot = (dx * f.x + dz * f.z) / (dl * (Math.hypot(f.x, f.z) || 1));
      score *= 1.35 - 0.35 * dot;
    }
    if (o.preferFrozen && h.frozen) score *= 0.55;
    // Prefer unlimited / well-stocked sources over nearly empty ones.
    if (Number.isFinite(h.capacity ?? Infinity) && (h.capacity ?? 0) > 0) score *= 1.4 - 0.4 * Math.min(1, h.available / (h.capacity ?? 1));
    return score;
  }

  /** Best source for a technique: nearest, with a bonus for being in front of the caster. */
  findBest(pos: THREE.Vector3, maxDist: number, o: FindOptions = {}): SourceHit | null {
    const all = this.findAll(pos, maxDist, o);
    if (!all.length) return null;
    if (!o.facing && !o.preferFrozen) return all[0];
    let best = all[0];
    let bestScore = Infinity;
    for (const h of all) {
      const s = this.score(h, pos, o);
      if (s < bestScore) {
        bestScore = s;
        best = h;
      }
    }
    return best;
  }

  /** Candidates ordered by preference (score). */
  private ranked(pos: THREE.Vector3, maxDist: number, o: FindOptions): SourceHit[] {
    const all = this.findAll(pos, maxDist, o);
    return all.map((h) => ({ h, s: this.score(h, pos, o) })).sort((a, b) => a.s - b.s).map((x) => x.h);
  }

  /** Units available to a caster right now (reserve + best source), for HUD/AI. */
  availableFor(caster: Combatant, req: WaterRequirement): number {
    const range = Math.min(this.effectiveRange(caster), req.maxRange ?? Infinity);
    const src = this.findBest(caster.position, range, this.reqOptions(caster, req));
    const srcAmt = src ? Math.min(this.capFor(src), 999) : 0;
    if (req.largeSource) return srcAmt;
    const flask = this.carriedSupply(caster);
    return caster.waterReserve + srcAmt + (flask ? flask.amount : 0);
  }

  /**
   * Cheap check (cached nearby scan, ~0.3 s) whether a requirement could be met
   * right now. Used by the HUD to grey out slots; acquire() is authoritative.
   */
  canSupply(caster: Combatant, req: WaterRequirement): boolean {
    if (!req.largeSource && caster.waterReserve >= req.amount - 1e-3) return true;
    const now = this.now();
    const pos = caster.position;
    let c = this.supplyCache;
    if (!c || now - c.t > 0.3 || now < c.t || Math.abs(c.x - pos.x) > 1 || Math.abs(c.z - pos.z) > 1) {
      const range = this.effectiveRange(caster);
      const all = this.findAll(pos, range, { allowLiquid: true, allowIce: true, allowSnow: this.snowCapable(caster) });
      c = this.supplyCache = { x: pos.x, z: pos.z, t: now, all, liquid: all.filter((h) => !h.frozen) };
    }
    const o = this.reqOptions(caster, req);
    const maxR = req.maxRange ?? Infinity;
    let have = req.largeSource ? 0 : caster.waterReserve;
    let best = 0;
    for (const h of c.all) {
      if (h.distance > maxR) continue;
      if (h.type === 'snow' ? !o.allowSnow : h.frozen ? !o.allowIce : !(o.allowLiquid ?? true)) continue;
      if (o.largeOnly && (h.frozen || h.size !== 'large')) continue;
      best = Math.max(best, this.capFor(h));
    }
    have += best;
    if (!req.largeSource) have += this.carriedSupply(caster)?.amount ?? 0;
    return have >= req.amount - 1e-3 || !!req.canConjure;
  }

  private reqOptions(caster: Combatant, req: WaterRequirement): FindOptions {
    const snowOk = req.allowSnow !== false && this.snowCapable(caster);
    return {
      allowLiquid: req.allowLiquid ?? true,
      allowIce: !!req.allowIce,
      allowSnow: snowOk,
      largeOnly: !!req.largeSource,
      preferFrozen: !!req.preferFrozen,
    };
  }

  /** Units that can be taken from a hit right now (finite amount or local rate budget). */
  private capFor(h: SourceHit): number {
    const finite = this.sources.get(h.id);
    if (finite && Number.isFinite(finite.capacity)) return finite.amount;
    return this.localDrawCap(h.point, h.type, h.id);
  }

  /** Rate-limit draws from "infinite" sources in a small area (prevents silly spam, keeps it believable). */
  private localDrawCap(p: THREE.Vector3, type: WaterSourceType = 'river', id = ''): number {
    const now = this.now();
    this.recentDraws = this.recentDraws.filter((d) => now - d.t < RATE_WINDOW && now >= d.t);
    const cap = RATE_CAP[type] ?? 160;
    let sum = 0;
    for (const d of this.recentDraws) {
      if (id && d.id && d.id !== id) continue;
      if (Math.hypot(d.x - p.x, d.z - p.z) < RATE_RADIUS) sum += d.amount;
    }
    return Math.max(0, cap - sum);
  }

  private consume(h: SourceHit, amount: number, caster: Combatant): void {
    if (amount <= 0) return;
    const finite = this.sources.get(h.id);
    if (finite && Number.isFinite(finite.capacity)) {
      const before = finite.amount;
      finite.amount = Math.max(0, finite.amount - amount);
      this.notifyChange(finite, true);
      if (caster.isPlayer && before > 0.01 && finite.amount <= 0.01 && this.ctx?.events) {
        this.ctx.events.emit('ui:notify', { text: `${finite.label} has run dry — it will refill in time.`, kind: 'info', duration: 2.5 });
      }
    } else {
      this.recentDraws.push({ x: h.point.x, z: h.point.z, amount, t: this.now(), id: h.id });
    }
  }

  private notifyChange(s: WaterSource, force = false): void {
    if (!s.onChange) return;
    const now = this.now();
    const last = this.changeTimer.get(s.id) ?? -1;
    if (!force && now - last < 0.25 && now >= last) return;
    this.changeTimer.set(s.id, now);
    try {
      s.onChange(s.amount, s.capacity);
    } catch (err) {
      console.error('[Water] onChange failed', err);
    }
  }

  private fail(f: WaterFailure): null {
    this.lastFailure = f;
    return null;
  }

  /** Explain why a requirement could not be met (no consumption happens). */
  private explain(caster: Combatant, req: WaterRequirement, range: number, sawRateLimited: boolean, sawDry: string | null): WaterFailure {
    if (req.largeSource) return { reason: 'small', message: 'You need a large body of water close by — a river, a lake or the sea.' };
    if (sawRateLimited) return { reason: 'busy', message: 'The water here is still churning — give it a moment or move along the shore.' };
    if (sawDry) return { reason: 'dry', message: `${sawDry} has run dry — it will refill in time.` };
    const pos = caster.position;
    const all = this.findAll(pos, range, { allowLiquid: true, allowIce: true, allowSnow: true });
    const flask = this.carriedSupply(caster);
    if (!req.allowIce && all.some((h) => h.frozen && h.type !== 'snow')) {
      return { reason: 'frozen', message: 'The water here is frozen solid — ice techniques can still shape it.' };
    }
    if (all.some((h) => h.type === 'snow') && !this.snowCapable(caster)) {
      return { reason: 'snow', message: 'Only snow here — you have not yet learned to gather water from snow.' };
    }
    const have = caster.waterReserve + (flask?.amount ?? 0);
    if (have > 0.5) return { reason: 'none', message: `Not enough water — you hold ${Math.floor(have)}, this needs ${req.amount}. Find a river, lake, the sea or a pond.` };
    if (flask && flask.capacity > 0) return { reason: 'none', message: 'No water within reach and your water skin is empty.' };
    return { reason: 'none', message: 'No water within reach — find a river, a lake, the sea or a pond.' };
  }

  /**
   * Obtain water for a technique. Never consumes anything if the requirement
   * cannot be met (returns null and sets lastFailure).
   */
  acquire(caster: Combatant, req: WaterRequirement, aimDir: THREE.Vector3, _aimPoint: THREE.Vector3): WaterGrant | null {
    const need = req.amount;
    const large = !!req.largeSource;
    const fromReserve = large ? 0 : Math.min(Math.max(0, caster.waterReserve), need);
    let remaining = need - fromReserve;
    let srcHit: SourceHit | null = null;
    let fromSource = 0;
    let sawRateLimited = false;
    let sawDry: string | null = null;
    const range = Math.min(this.effectiveRange(caster), req.maxRange ?? Infinity);
    if (remaining > 0.001) {
      const o = { ...this.reqOptions(caster, req), facing: aimDir };
      // Depleted finite sources are included so we can explain "it ran dry".
      const cands = this.ranked(caster.position, range, { ...o, includeDepleted: true });
      let partial: { h: SourceHit; cap: number } | null = null;
      for (const h of cands) {
        const cap = this.capFor(h);
        if (cap <= 0.01) {
          const finite = this.sources.get(h.id);
          if (finite && Number.isFinite(finite.capacity)) sawDry ??= h.label;
          else sawRateLimited = true;
          continue;
        }
        if (cap >= remaining - 1e-6) {
          srcHit = h;
          fromSource = remaining;
          break;
        }
        if (!partial || cap > partial.cap) partial = { h, cap };
      }
      if (!srcHit && partial) {
        srcHit = partial.h;
        fromSource = partial.cap;
        if (Number.isFinite(partial.h.capacity ?? Infinity)) sawDry ??= partial.h.label;
        else sawRateLimited = true;
      }
      remaining -= fromSource;
    }
    // Carried water skin.
    let fromFlask = 0;
    const flask = large ? null : this.carriedSupply(caster);
    if (remaining > 0.001 && flask && flask.amount > 0.001) {
      fromFlask = Math.min(flask.amount, remaining);
      remaining -= fromFlask;
    }
    let conjured = 0;
    if (remaining > 0.001 && req.canConjure) {
      conjured = remaining;
      remaining = 0;
    }
    if (remaining > 0.001) return this.fail(this.explain(caster, req, range, sawRateLimited, sawDry));
    // Commit
    this.lastFailure = null;
    caster.waterReserve = Math.max(0, caster.waterReserve - fromReserve);
    let grant: WaterGrant;
    if (srcHit && fromSource > 0) {
      this.consume(srcHit, fromSource, caster);
      if (fromFlask > 0) flask!.take(fromFlask);
      grant = { amount: need, from: srcHit.point.clone(), sourceId: srcHit.id, sourceType: srcHit.type, frozen: srcHit.frozen };
      if (caster.isPlayer) {
        this.ctx?.events.emit('water:drawn', { sourceId: srcHit.id, sourceType: srcHit.type, amount: fromSource, position: { x: srcHit.point.x, y: srcHit.point.y, z: srcHit.point.z } });
      }
    } else if (fromFlask > 0) {
      flask!.take(fromFlask);
      const p = flask!.point(new THREE.Vector3());
      grant = { amount: need, from: p, sourceId: 'flask', sourceType: 'flask', frozen: false };
      if (caster.isPlayer) this.ctx?.events.emit('water:drawn', { sourceId: 'flask', sourceType: 'flask', amount: fromFlask, position: { x: p.x, y: p.y, z: p.z } });
    } else if (conjured > 0 && fromReserve <= 0) {
      grant = { amount: need, from: null, sourceId: null, sourceType: 'conjured', frozen: false };
    } else {
      grant = { amount: need, from: null, sourceId: null, sourceType: fromReserve > 0 ? 'reserve' : conjured > 0 ? 'conjured' : null, frozen: false };
    }
    if (caster.isPlayer && fromReserve > 0) this.ctx?.events.emit('water:reserve', { amount: caster.waterReserve, max: caster.maxWaterReserve });
    return grant;
  }

  /**
   * Pull water from the best nearby source into the caster's reserve (the
   * "Draw Water" action). Returns the source hit (for the stream visual, with
   * `drawn` set) or null (see lastFailure).
   */
  drawToReserve(caster: Combatant, amount: number, facing?: THREE.Vector3, opts: { allowSnow?: boolean; allowRain?: boolean } = {}): SourceHit | null {
    const space = caster.maxWaterReserve - caster.waterReserve;
    if (space <= 0.01) return this.fail({ reason: 'full', message: 'Your water reserve is full.' });
    const allowSnow = opts.allowSnow ?? this.snowCapable(caster);
    const cands = this.ranked(caster.position, this.effectiveRange(caster), { allowLiquid: true, allowIce: false, allowSnow, facing, includeDepleted: true });
    let sawRateLimited = false;
    let sawDry: string | null = null;
    for (const hit of cands) {
      if (hit.type === 'rain' && opts.allowRain === false) continue;
      const cap = this.capFor(hit);
      const take = Math.min(space, amount, cap);
      if (take <= 0.01) {
        const finite = this.sources.get(hit.id);
        if (finite && Number.isFinite(finite.capacity)) sawDry ??= hit.label;
        else sawRateLimited = true;
        continue;
      }
      this.consume(hit, take, caster);
      caster.waterReserve += take;
      hit.drawn = take;
      hit.available = Math.max(0, hit.available - take);
      this.lastFailure = null;
      if (caster.isPlayer) {
        this.ctx?.events.emit('water:drawn', { sourceId: hit.id, sourceType: hit.type, amount: take, position: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
        this.ctx?.events.emit('water:reserve', { amount: caster.waterReserve, max: caster.maxWaterReserve });
      }
      return hit;
    }
    return this.fail(this.explain(caster, { amount: Math.min(space, amount) }, this.effectiveRange(caster), sawRateLimited, sawDry));
  }

  /**
   * Return spent water to the world near a point: refills a nearby finite
   * source, otherwise leaves a temporary puddle (a bendable source) on dry
   * ground. Returns the id of the source that received the water, if any.
   */
  release(pos: THREE.Vector3, amount: number): string | null {
    if (!(amount > 0)) return null;
    for (const s of this.sources.values()) {
      if (s.frozen || !Number.isFinite(s.capacity) || s.amount >= s.capacity || s.type === 'puddle') continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < s.r + 6) {
        s.amount = Math.min(s.capacity, s.amount + amount * 0.7);
        this.notifyChange(s);
        return s.id;
      }
    }
    if (amount < 6) return null;
    if (waterAt(pos.x, pos.z)) return null; // falls back into open water
    const world = this.ctx?.world;
    if (!world) return null;
    const g = world.groundAt(pos.x, pos.z, pos.y + 1);
    if (g.surface === 'ice' || g.surface === 'lava') return null;
    const add = amount * 0.6;
    // Merge with a nearby puddle.
    for (const s of this.sources.values()) {
      if (s.type !== 'puddle' || !s.id.startsWith('dyn_')) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < s.r + 1.2 && Math.abs(s.y - g.y) < 1) {
        s.capacity = Math.min(40, s.capacity + add);
        s.amount = Math.min(s.capacity, s.amount + add);
        s.r = Math.min(2.6, 0.8 + Math.sqrt(s.capacity) * 0.25);
        s.ttl = Math.max(s.ttl ?? 0, 45);
        this.notifyChange(s, true);
        return s.id;
      }
    }
    // Cap the number of puddles: evaporate the oldest.
    const puddles = [...this.sources.values()].filter((s) => s.type === 'puddle' && s.id.startsWith('dyn_'));
    if (puddles.length >= MAX_PUDDLES) {
      puddles.sort((a, b) => (a.ttl ?? 0) - (b.ttl ?? 0));
      this.unregister(puddles[0].id);
    }
    const capacity = Math.min(25, add);
    return this.registerDynamic({ type: 'puddle', label: 'Puddle', x: pos.x, y: g.y + 0.02, z: pos.z, r: Math.min(2.6, 0.8 + Math.sqrt(capacity) * 0.25), capacity, regen: 0, ttl: 45, size: 'small' });
  }

  /**
   * HUD description of the water around a caster (what Draw Water would use,
   * or why nothing is usable).
   */
  describe(caster: Combatant): WaterDescription {
    const range = this.effectiveRange(caster);
    const snow = this.snowCapable(caster);
    const all = this.findAll(caster.position, range, { allowLiquid: true, allowIce: true, allowSnow: true, includeDepleted: true });
    const usable = all.filter((h) => (h.type === 'snow' ? snow : !h.frozen));
    const best = usable.find((h) => h.available > 0.01) ?? usable[0];
    const fmt = (h: SourceHit) => `${h.label}${Number.isFinite(h.capacity ?? Infinity) && (h.capacity ?? 0) > 0 ? ` ${Math.round((100 * h.available) / (h.capacity ?? 1))}%` : ''} nearby (${h.distance.toFixed(0)} m)`;
    if (best && best.available > 0.01) {
      const fraction = Number.isFinite(best.capacity ?? Infinity) ? best.available / Math.max(1, best.capacity ?? 1) : undefined;
      return { label: fmt(best), ok: true, kind: best.type === 'snow' ? 'snow' : best.type === 'rain' ? 'rain' : 'liquid', fraction, sourceId: best.id };
    }
    if (best) return { label: `${best.label} is dry — refilling`, ok: caster.waterReserve > 0.5, kind: 'none', fraction: 0, sourceId: best.id };
    const ice = all.find((h) => h.frozen && h.type !== 'snow');
    const flask = this.carriedSupply(caster);
    if (ice) return { label: `${ice.label} nearby (${ice.distance.toFixed(0)} m) — ice techniques only`, ok: false, kind: 'ice', sourceId: ice.id };
    if (!snow && all.some((h) => h.type === 'snow')) {
      if (flask && flask.amount > 0.5) return { label: `Snow only — using your water skin (${Math.round(flask.amount)})`, ok: true, kind: 'flask' };
      return { label: 'Snow only — not bendable yet', ok: caster.waterReserve > 0.5, kind: 'snow' };
    }
    if (flask && flask.amount > 0.5) return { label: `No source nearby — water skin (${Math.round(flask.amount)})`, ok: true, kind: 'flask' };
    if (caster.waterReserve > 0.5) return { label: 'No source nearby — using water you carry', ok: true, kind: 'reserve' };
    return { label: 'No nearby water source', ok: false, kind: 'none' };
  }

  update(dt: number): void {
    for (const [id, s] of this.sources) {
      if (s.regen > 0 && Number.isFinite(s.capacity) && s.amount < s.capacity) {
        s.amount = Math.min(s.capacity, s.amount + s.regen * dt);
        this.notifyChange(s);
      }
      if (s.ttl !== undefined) {
        s.ttl -= dt;
        if (s.ttl <= 0) this.unregister(id);
      }
    }
  }

  onSessionEnd(): void {
    for (const [id, s] of [...this.sources]) {
      if (s.id.startsWith('dyn_') || s.ttl !== undefined) this.unregister(id);
      else if (Number.isFinite(s.capacity) && s.amount < s.capacity) {
        s.amount = s.capacity;
        this.notifyChange(s, true);
      }
    }
    this.recentDraws = [];
    this.lastFailure = null;
    this.supplyCache = null;
    this.oceanCache = { x: 1e9, z: 1e9, t: -1, hits: [] };
  }
}
