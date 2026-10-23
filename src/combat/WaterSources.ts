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
 * reserve (water already gathered and orbiting them), then (2) the nearest
 * usable source within draw range. Only requirements with canConjure (Elements
 * Sphere ultimates) may make up a shortfall.
 *
 * Large sources (ocean, rivers, lakes) are effectively unlimited but rate-limited
 * locally; small sources (ponds, fountains, puddles) have finite capacity that
 * visibly/mechanically depletes and regenerates.
 */

export interface WaterSourceDef {
  id: string;
  type: WaterSourceType;
  label: string;
  /** Point sources (fountain, puddle, flask origin) or disc sources (pond). */
  x: number;
  y: number;
  z: number;
  /** Disc radius (0 = point). */
  r: number;
  capacity: number;
  regen: number;
  frozen?: boolean;
  /** Owner entity id for dynamic sources (ice walls...). */
  owner?: number;
  /** Seconds until auto-removal (dynamic sources). */
  ttl?: number;
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
}

export interface FindOptions {
  allowLiquid?: boolean;
  allowIce?: boolean;
  allowSnow?: boolean;
  /** Prefer sources in this horizontal direction. */
  facing?: THREE.Vector3;
}

const OCEAN_CACHE_TIME = 0.25;

export class WaterSourceSystem implements GameSystem {
  private ctx!: GameContext;
  private sources = new Map<string, WaterSource>();
  private nextDyn = 1;
  /** Base draw range in metres (Avatar State extends it). */
  drawRange = 16;
  private oceanCache: { x: number; z: number; t: number; hit: SourceHit | null } = { x: 1e9, z: 1e9, t: -1, hit: null };
  /** Local draw rate limiting for "infinite" sources: units drawn recently near a point. */
  private recentDraws: Array<{ x: number; z: number; amount: number; t: number }> = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  register(def: WaterSourceDef): string {
    this.sources.set(def.id, { ...def, amount: def.capacity });
    return def.id;
  }

  /** Register a temporary source (ice wall, puddle left by a water attack). */
  registerDynamic(def: Omit<WaterSourceDef, 'id'>): string {
    const id = `dyn_${this.nextDyn++}`;
    return this.register({ ...def, id });
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): WaterSource | undefined {
    return this.sources.get(id);
  }

  list(): IterableIterator<WaterSource> {
    return this.sources.values();
  }

  private effectiveRange(caster?: Combatant): number {
    const avatar = caster?.isPlayer && this.ctx.avatar?.active;
    return this.drawRange * (avatar ? 1.8 : 1);
  }

  /** Ocean nearest point by sampling terrain rings (cached briefly). */
  private findOcean(pos: THREE.Vector3, maxDist: number): SourceHit | null {
    const now = this.ctx.time.elapsed;
    const c = this.oceanCache;
    if (now - c.t < OCEAN_CACHE_TIME && Math.abs(c.x - pos.x) < 1.5 && Math.abs(c.z - pos.z) < 1.5) {
      if (c.hit) c.hit.distance = c.hit.point.distanceTo(pos);
      return c.hit;
    }
    let best: SourceHit | null = null;
    const steps = [0, 2, 4, 7, 10, 14, 18, 24, 30];
    for (const r of steps) {
      if (r > maxDist) break;
      const n = r === 0 ? 1 : Math.max(8, Math.round(r * 1.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h >= SEA_LEVEL - 0.15) continue;
        const w = waterAt(x, z, h);
        if (!w || w.kind !== 'ocean') continue;
        const p = new THREE.Vector3(x, SEA_LEVEL, z);
        const d = p.distanceTo(pos);
        if (!best || d < best.distance) best = { id: 'ocean', type: 'ocean', label: w.frozen ? 'Sea Ice' : 'Ocean', point: p, distance: d, available: 999, frozen: w.frozen };
      }
      if (best) break;
    }
    this.oceanCache = { x: pos.x, z: pos.z, t: now, hit: best };
    return best;
  }

  /** All candidate sources within maxDist, nearest first. */
  findAll(pos: THREE.Vector3, maxDist: number, o: FindOptions = {}): SourceHit[] {
    const allowLiquid = o.allowLiquid ?? true;
    const out: SourceHit[] = [];
    const consider = (hit: SourceHit) => {
      if (hit.distance > maxDist) return;
      if (hit.frozen && hit.type !== 'snow' && !o.allowIce) return;
      if (hit.type === 'snow' && !o.allowSnow) return;
      if (!hit.frozen && hit.type !== 'snow' && !allowLiquid) return;
      if (hit.available <= 0.01) return;
      out.push(hit);
    };
    // Rivers
    for (const r of getRiverRuntime()) {
      if (!r.line.inBounds(pos.x, pos.z)) continue;
      const sArr = new Float64Array(1);
      const d = r.line.distance(pos.x, pos.z, sArr);
      const half = r.width(sArr[0]) * 0.5;
      if (d - half > maxDist) continue;
      const cp = r.line.pointAt(sArr[0]);
      // Point on the river surface nearest to pos (clamped inside the channel).
      const dx = pos.x - cp.x, dz = pos.z - cp.z;
      const dl = Math.hypot(dx, dz);
      const k = dl > half - 0.5 ? (half - 0.5) / dl : 1;
      const p = new THREE.Vector3(cp.x + dx * k, r.surface(sArr[0]), cp.z + dz * k);
      consider({ id: `river:${r.id}`, type: r.width(sArr[0]) < 9 ? 'stream' : 'river', label: r.frozen ? 'Frozen River' : 'River', point: p, distance: p.distanceTo(pos), available: 999, frozen: r.frozen });
    }
    // Lakes / ponds from the heightfield
    for (const l of getLakeRuntime()) {
      const dx = pos.x - l.def.x, dz = pos.z - l.def.z;
      const d = Math.hypot(dx, dz);
      if (d - l.def.r > maxDist) continue;
      const k = d > l.def.r - 0.5 ? (l.def.r - 0.5) / d : 1;
      const p = new THREE.Vector3(l.def.x + dx * k, l.level, l.def.z + dz * k);
      const src = this.sources.get(`lake:${l.def.id}`);
      const type: WaterSourceType = l.def.kind === 'pond' || l.def.kind === 'hotspring' ? 'pond' : 'lake';
      consider({ id: `lake:${l.def.id}`, type, label: l.def.name, point: p, distance: p.distanceTo(pos), available: src ? src.amount : 999, frozen: !!l.def.frozen });
    }
    // Marsh
    {
      const d = Math.hypot(pos.x - MARSH.x, pos.z - MARSH.z);
      if (d < MARSH.r * 0.85 + maxDist) {
        const w = waterAt(pos.x, pos.z);
        if (w && w.kind === 'marsh') consider({ id: 'marsh', type: 'pond', label: 'Swamp Water', point: new THREE.Vector3(pos.x, w.level, pos.z), distance: Math.max(0, pos.y - w.level), available: 999, frozen: false });
        else {
          // Sample a few nearby points for pools.
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            for (const rr of [3, 7, 12]) {
              if (rr > maxDist) continue;
              const x = pos.x + Math.cos(a) * rr, z = pos.z + Math.sin(a) * rr;
              const ww = waterAt(x, z);
              if (ww && ww.kind === 'marsh') {
                const p = new THREE.Vector3(x, ww.level, z);
                consider({ id: 'marsh', type: 'pond', label: 'Swamp Pool', point: p, distance: p.distanceTo(pos), available: 999, frozen: false });
              }
            }
          }
        }
      }
    }
    // Ocean
    const ocean = this.findOcean(pos, maxDist);
    if (ocean) consider(ocean);
    // Registered sources
    for (const s of this.sources.values()) {
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d - s.r > maxDist) continue;
      const k = s.r > 0 && d > s.r ? s.r / d : s.r > 0 ? 1 : 0;
      const p = new THREE.Vector3(s.x + dx * k, s.y, s.z + dz * k);
      consider({ id: s.id, type: s.type, label: s.label, point: p, distance: p.distanceTo(pos), available: s.amount, frozen: !!s.frozen });
    }
    // Snow underfoot / around (cold biome ground)
    if (o.allowSnow) {
      const b = biomeWeights(pos.x, pos.z);
      const surf = this.ctx.world.surfaceAt(pos.x, pos.z, pos.y);
      if (b.cold > 0.5 || surf === 'snow' || surf === 'packedsnow') {
        const p = new THREE.Vector3(pos.x, this.ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y, pos.z);
        consider({ id: 'snowfield', type: 'snow', label: 'Snow', point: p, distance: Math.max(0, pos.y - p.y), available: 60, frozen: true });
      }
    }
    // Rain counts as a weak source when weather says so (set by weather system).
    if (this.raining) consider({ id: 'rain', type: 'rain', label: 'Rain', point: pos.clone().setY(pos.y + 3), distance: 3, available: 20, frozen: false });
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  /** Set by the weather system. */
  raining = false;

  /** Best source for a technique: nearest, with a bonus for being in front of the caster. */
  findBest(pos: THREE.Vector3, maxDist: number, o: FindOptions = {}): SourceHit | null {
    const all = this.findAll(pos, maxDist, o);
    if (!all.length) return null;
    if (!o.facing) return all[0];
    let best = all[0];
    let bestScore = Infinity;
    const f = o.facing;
    for (const h of all) {
      const dx = h.point.x - pos.x, dz = h.point.z - pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const dot = (dx * f.x + dz * f.z) / (dl * (Math.hypot(f.x, f.z) || 1));
      const score = h.distance * (1.35 - 0.35 * dot);
      if (score < bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  /** Units available to a caster right now (reserve + best source), for HUD/AI. */
  availableFor(caster: Combatant, req: WaterRequirement): number {
    const src = this.findBest(caster.position, this.effectiveRange(caster), { allowLiquid: req.allowLiquid ?? true, allowIce: req.allowIce, allowSnow: req.allowSnow });
    return caster.waterReserve + (src ? Math.min(src.available, 999) : 0);
  }

  /** Rate-limit draws from "infinite" sources in a small area (prevents silly spam, keeps it believable). */
  private localDrawCap(p: THREE.Vector3): number {
    const now = this.ctx.time.elapsed;
    this.recentDraws = this.recentDraws.filter((d) => now - d.t < 3);
    let sum = 0;
    for (const d of this.recentDraws) if (Math.hypot(d.x - p.x, d.z - p.z) < 6) sum += d.amount;
    return Math.max(0, 160 - sum);
  }

  /**
   * Obtain water for a technique. Never consumes anything if the requirement
   * cannot be met (returns null).
   */
  acquire(caster: Combatant, req: WaterRequirement, aimDir: THREE.Vector3, _aimPoint: THREE.Vector3): WaterGrant | null {
    const need = req.amount;
    const fromReserve = Math.min(caster.waterReserve, need);
    let remaining = need - fromReserve;
    let grant: WaterGrant = { amount: fromReserve, from: null, sourceId: null, sourceType: fromReserve > 0 ? 'reserve' : null, frozen: false };
    let srcHit: SourceHit | null = null;
    let fromSource = 0;
    if (remaining > 0.001) {
      srcHit = this.findBest(caster.position, this.effectiveRange(caster), {
        allowLiquid: req.allowLiquid ?? true,
        allowIce: req.allowIce,
        allowSnow: req.allowSnow,
        facing: aimDir,
      });
      if (srcHit) {
        const finite = this.sources.get(srcHit.id) ?? this.sources.get(srcHit.id.replace(/^lake:/, 'lake:'));
        const cap = finite ? finite.amount : this.localDrawCap(srcHit.point);
        fromSource = Math.min(remaining, cap);
        remaining -= fromSource;
      }
    }
    let conjured = 0;
    if (remaining > 0.001 && req.canConjure) {
      conjured = remaining;
      remaining = 0;
    }
    if (remaining > 0.001) return null;
    // Commit
    caster.waterReserve -= fromReserve;
    if (srcHit && fromSource > 0) {
      const finite = this.sources.get(srcHit.id);
      if (finite) finite.amount = Math.max(0, finite.amount - fromSource);
      else this.recentDraws.push({ x: srcHit.point.x, z: srcHit.point.z, amount: fromSource, t: this.ctx.time.elapsed });
      grant = { amount: need, from: srcHit.point.clone(), sourceId: srcHit.id, sourceType: srcHit.type, frozen: srcHit.frozen };
      if (caster.isPlayer) {
        this.ctx.events.emit('water:drawn', { sourceId: srcHit.id, sourceType: srcHit.type, amount: fromSource, position: { x: srcHit.point.x, y: srcHit.point.y, z: srcHit.point.z } });
      }
    } else if (conjured > 0) {
      grant = { amount: need, from: null, sourceId: null, sourceType: 'conjured', frozen: false };
    } else {
      grant.amount = need;
    }
    return grant;
  }

  /**
   * Pull water from the best nearby source into the caster's reserve (the
   * "Draw Water" action). Returns the source hit (for the stream visual) or null.
   */
  drawToReserve(caster: Combatant, amount: number, facing?: THREE.Vector3): SourceHit | null {
    const space = caster.maxWaterReserve - caster.waterReserve;
    if (space <= 0.01) return null;
    const hit = this.findBest(caster.position, this.effectiveRange(caster), { allowLiquid: true, allowIce: false, allowSnow: false, facing });
    if (!hit) return null;
    const finite = this.sources.get(hit.id);
    const cap = finite ? finite.amount : this.localDrawCap(hit.point);
    const take = Math.min(space, amount, cap);
    if (take <= 0.01) return null;
    if (finite) finite.amount -= take;
    else this.recentDraws.push({ x: hit.point.x, z: hit.point.z, amount: take, t: this.ctx.time.elapsed });
    caster.waterReserve += take;
    if (caster.isPlayer) {
      this.ctx.events.emit('water:drawn', { sourceId: hit.id, sourceType: hit.type, amount: take, position: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
      this.ctx.events.emit('water:reserve', { amount: caster.waterReserve, max: caster.maxWaterReserve });
    }
    return hit;
  }

  /** Return spent water to the world near a point (refills nearby finite sources, else forms a puddle). */
  release(pos: THREE.Vector3, amount: number): void {
    for (const s of this.sources.values()) {
      if (s.amount >= s.capacity || s.frozen) continue;
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < s.r + 6) {
        s.amount = Math.min(s.capacity, s.amount + amount * 0.7);
        return;
      }
    }
    if (amount >= 6 && !waterAt(pos.x, pos.z)) {
      const y = this.ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y + 0.02;
      this.registerDynamic({ type: 'puddle', label: 'Puddle', x: pos.x, y, z: pos.z, r: 1.2, capacity: Math.min(25, amount * 0.6), regen: 0, ttl: 45 });
    }
  }

  update(dt: number): void {
    for (const [id, s] of this.sources) {
      if (s.regen > 0 && s.amount < s.capacity) s.amount = Math.min(s.capacity, s.amount + s.regen * dt);
      if (s.ttl !== undefined) {
        s.ttl -= dt;
        if (s.ttl <= 0) this.sources.delete(id);
      }
    }
  }

  onSessionEnd(): void {
    for (const [id, s] of this.sources) if (s.id.startsWith('dyn_') || s.ttl !== undefined) this.sources.delete(id);
    this.recentDraws = [];
  }
}
