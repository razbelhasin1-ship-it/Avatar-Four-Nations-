import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { EntityKind, Team } from '../core/types';
import type { Entity } from './Entity';

const CELL = 12;

export interface EntityFilter {
  kinds?: EntityKind[];
  teams?: Team[];
  exclude?: Entity | number;
  aliveOnly?: boolean;
  targetableOnly?: boolean;
  tag?: string;
}

function matches(e: Entity, f?: EntityFilter): boolean {
  if (!f) return e.alive;
  if ((f.aliveOnly ?? true) && !e.alive) return false;
  if (f.targetableOnly && !e.targetable) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.teams && !f.teams.includes(e.team)) return false;
  if (f.exclude !== undefined && (typeof f.exclude === 'number' ? e.id === f.exclude : e === f.exclude)) return false;
  if (f.tag && !e.tags.has(f.tag)) return false;
  return true;
}

/** Hostility rules between teams. */
export function areHostile(a: Team, b: Team): boolean {
  if (a === b) return false;
  if (a === 'hostile') return b === 'player' || b === 'ally';
  if (b === 'hostile') return a === 'player' || a === 'ally';
  return false;
}

/**
 * Owns all live entities: adds them to the scene, updates them (throttled by
 * distance to the player), maintains a spatial hash for radius queries.
 */
export class EntityManager {
  private entities = new Map<number, Entity>();
  private grid = new Map<number, Entity[]>();
  readonly group = new THREE.Group();
  private frame = 0;
  playerId = 0;

  constructor() {
    this.group.name = 'entities';
  }

  add<T extends Entity>(e: T): T {
    this.entities.set(e.id, e);
    this.group.add(e.root);
    return e;
  }

  /** Remove from the world; disposes GPU resources unless `dispose` is false (persistent entities like the player). */
  remove(e: Entity | number, dispose = true): void {
    const ent = typeof e === 'number' ? this.entities.get(e) : e;
    if (!ent) return;
    this.entities.delete(ent.id);
    this.group.remove(ent.root);
    if (dispose && !ent.disposed) ent.dispose();
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  get player(): Entity | undefined {
    return this.entities.get(this.playerId);
  }

  all(): IterableIterator<Entity> {
    return this.entities.values();
  }

  get count(): number {
    return this.entities.size;
  }

  byKind(kind: EntityKind): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) if (e.kind === kind) out.push(e);
    return out;
  }

  private key(cx: number, cz: number): number {
    return (cx + 2048) * 4096 + (cz + 2048);
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const e of this.entities.values()) {
      const k = this.key(Math.floor(e.position.x / CELL), Math.floor(e.position.z / CELL));
      let list = this.grid.get(k);
      if (!list) {
        list = [];
        this.grid.set(k, list);
      }
      list.push(e);
    }
  }

  /** Entities whose position is within `radius` (XZ + vertical tolerance) of `center`. */
  queryRadius(center: THREE.Vector3, radius: number, filter?: EntityFilter, out: Entity[] = []): Entity[] {
    out.length = 0;
    const x0 = Math.floor((center.x - radius) / CELL), x1 = Math.floor((center.x + radius) / CELL);
    const z0 = Math.floor((center.z - radius) / CELL), z1 = Math.floor((center.z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const e of list) {
          if (!matches(e, filter)) continue;
          const dx = e.position.x - center.x, dz = e.position.z - center.z;
          const rr = radius + e.radius;
          if (dx * dx + dz * dz > rr * rr) continue;
          const dy = center.y - (e.position.y + e.height * 0.5);
          if (Math.abs(dy) > radius + e.height * 0.5 + 1) continue;
          out.push(e);
        }
      }
    }
    return out;
  }

  /** Nearest entity matching filter within radius. */
  nearest(center: THREE.Vector3, radius: number, filter?: EntityFilter): Entity | null {
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.queryRadius(center, radius, filter)) {
      const d = e.position.distanceToSquared(center);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  update(dt: number, ctx: GameContext): void {
    this.frame++;
    this.rebuildGrid();
    const p = this.player;
    for (const e of [...this.entities.values()]) {
      if (e.disposed) continue;
      const d = p ? Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) : 0;
      e.distToPlayer = d;
      // Distance-based update rate: full rate within 90 m.
      const every = e === p ? 1 : d < 90 ? 1 : d < 200 ? 3 : d < 400 ? 8 : 20;
      e._accum += dt;
      if (this.frame % every !== e.id % every) continue;
      const step = Math.min(e._accum, 0.25);
      e._accum = 0;
      try {
        e.update(step, ctx);
      } catch (err) {
        console.error(`[Entities] update failed for ${e.name}#${e.id}`, err);
      }
    }
  }

  /** Remove every entity except the ones kept by predicate. */
  clear(keep?: (e: Entity) => boolean): void {
    for (const e of [...this.entities.values()]) if (!keep || !keep(e)) this.remove(e);
  }
}
