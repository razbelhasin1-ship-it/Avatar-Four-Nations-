import type * as THREE from 'three';
import type { HitInfo } from '../entities/Entity';
import type { BossPhase } from '../data/enemies';
import type { Enemy } from './Enemy';

/** A sound the player made (footsteps, sprinting, bending, impacts) that enemies may hear. */
export interface Noise {
  x: number;
  y: number;
  z: number;
  /** Audible radius (m) before the listener's hearing multiplier. */
  radius: number;
  /** Simulation time it was made. */
  t: number;
  /** Combat noise (bending, impacts) alerts harder than footsteps. */
  combat: boolean;
}

/** Services the encounter director provides to enemies (tokens, noise, allies, rewards). */
export interface AiHost {
  /** May this enemy attack right now (crowd control: at most a few attackers at once)? */
  hasToken(e: Enemy): boolean;
  /** Recent player noises. */
  noises(): readonly Noise[];
  /** An enemy spotted the player and shouts: nearby allies join in. */
  alertAllies(e: Enemy, at: THREE.Vector3): void;
  /** Enemy beaten (HP 0): loot, XP, bookkeeping. */
  onEnemyDefeated(e: Enemy, hit: HitInfo): void;
  /** A boss entered a new phase. */
  onBossPhase(e: Enemy, phase: BossPhase): void;
  /** Sparring partner or player dropped below the duel threshold. */
  onSparringThreshold(e: Enemy, playerWon: boolean): void;
  /** The enemy is done (fled, despawned after surrendering): remove it from the world. */
  release(e: Enemy): void;
}
