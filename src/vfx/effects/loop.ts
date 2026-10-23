import { DebrisField, type DebrisBurst } from './debris';
import type * as THREE from 'three';

/**
 * Per-frame update list for bending effects that outlive their cast
 * (constructs, lingering flames, tornados, trails...). Driven by the bending
 * runtime (src/combat/techniques/bending/runtime.ts); cleared on session end.
 */

export interface LiveEffect {
  /** Advance; return false when finished (dispose() is then called). */
  update(dt: number): boolean;
  dispose(): void;
}

const live: LiveEffect[] = [];

export function addEffect<T extends LiveEffect>(e: T): T {
  live.push(e);
  return e;
}

/** Build an effect from closures. */
export function effect(update: (dt: number) => boolean, dispose: () => void = () => {}): LiveEffect {
  return addEffect({ update, dispose });
}

export function updateEffects(dt: number): void {
  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    let keep = false;
    try {
      keep = e.update(dt);
    } catch (err) {
      console.error('[bending fx] effect update failed', err);
    }
    if (!keep) {
      try {
        e.dispose();
      } catch (err) {
        console.error('[bending fx] effect dispose failed', err);
      }
      live.splice(i, 1);
      i--;
    }
  }
}

export function clearEffects(): void {
  const all = live.splice(0, live.length);
  for (const e of all) {
    try {
      e.dispose();
    } catch (err) {
      console.error('[bending fx] effect dispose failed', err);
    }
  }
}

export function effectCount(): number {
  return live.length;
}

// ---------------------------------------------------------------------------
// Shared debris field (owned by the runtime, used by any effect)
// ---------------------------------------------------------------------------

let debrisField: DebrisField | null = null;

export function setDebrisField(d: DebrisField | null): void {
  debrisField = d;
}

export function getDebrisField(): DebrisField | null {
  return debrisField;
}

/** Throw rock chunks (no-op if the runtime is not running). */
export function debris(pos: THREE.Vector3, count: number, o?: DebrisBurst): void {
  debrisField?.burst(pos, count, o);
}
