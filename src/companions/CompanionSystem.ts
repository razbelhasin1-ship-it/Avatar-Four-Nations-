import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';

/**
 * Animal companions: species habitats, wild creature spawning, discovery,
 * taming/bonding, the companion stable, summoning and riding.
 *
 * Public API used by other systems (keep stable):
 *  - bondedCount(speciesId?)            number of bonded companions (quests)
 *  - mounted                            true while riding
 *  - mountedFlying                      true while riding a flying mount
 *  - dismount()                         force dismount (cutscenes, Avatar State)
 *  - bonded                             list of bonded companion records (UI)
 */
export interface CompanionRecord {
  id: string;
  speciesId: string;
  name: string;
  bond: number; // 0..100
  variant: number;
  /** Abilities unlocked through bonding (e.g. 'flight', 'sprint', 'dig'). */
  abilities: string[];
  /** Whether it is the active (summonable) companion. */
  active: boolean;
  /** Home position when dismissed. */
  home?: { x: number; z: number };
}

export class CompanionSystem implements GameSystem, Persistable {
  readonly saveKey = 'companions';
  protected ctx!: GameContext;
  bonded: CompanionRecord[] = [];
  mounted = false;
  mountedFlying = false;
  /** Creature ids the player has discovered (journal/bestiary). */
  readonly discoveredSpecies = new Set<string>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  bondedCount(speciesId?: string): number {
    return this.bonded.filter((c) => !speciesId || c.speciesId === speciesId).length;
  }

  dismount(): void {
    this.mounted = false;
    this.mountedFlying = false;
  }

  serialize(): unknown {
    if (this.ctx?.session.kind === 'tutorial') return undefined;
    return { v: 1, bonded: this.bonded, discovered: [...this.discoveredSpecies] };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.bonded)) {
      const seen = new Set<string>();
      for (const r of data.bonded) {
        if (!r || typeof r.id !== 'string' || typeof r.speciesId !== 'string' || seen.has(r.id)) continue;
        seen.add(r.id);
        this.bonded.push({
          id: r.id,
          speciesId: r.speciesId,
          name: typeof r.name === 'string' ? r.name.slice(0, 24) : r.speciesId,
          bond: typeof r.bond === 'number' ? Math.max(0, Math.min(100, r.bond)) : 50,
          variant: typeof r.variant === 'number' ? r.variant : 0,
          abilities: Array.isArray(r.abilities) ? r.abilities.filter((a: any) => typeof a === 'string') : [],
          active: !!r.active,
          home: r.home && typeof r.home.x === 'number' ? { x: r.home.x, z: r.home.z } : undefined,
        });
      }
    }
    if (Array.isArray(data.discovered)) for (const s of data.discovered) if (typeof s === 'string') this.discoveredSpecies.add(s);
  }

  reset(): void {
    this.bonded = [];
    this.discoveredSpecies.clear();
    this.mounted = false;
    this.mountedFlying = false;
  }
}
