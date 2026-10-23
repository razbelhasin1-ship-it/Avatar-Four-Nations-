import type { EventBus } from './EventBus';
import type { Element } from './types';

/**
 * Versioned local persistence.
 *
 * Every stateful system implements Persistable and registers with the
 * SaveManager under a stable `saveKey`. A save file is
 *   { version, meta, systems: { [saveKey]: serialized } }
 * Systems must tolerate `undefined` / partial data in deserialize() (older
 * saves, new fields) by falling back to defaults — that is the per-system
 * migration path. Whole-file migrations live in MIGRATIONS below.
 */

export interface Persistable {
  readonly saveKey: string;
  serialize(): unknown;
  /** Restore state. `data` may be undefined (fresh game or system added after the save). */
  deserialize(data: unknown): void;
  /** Reset to a fresh-game state (called before deserialize on load and on new game). */
  reset(): void;
}

export interface SaveMeta {
  slot: string;
  characterName: string;
  startingElement: Element;
  regionName: string;
  level: number;
  playTime: number; // seconds
  savedAt: number; // epoch ms
  masteredCount: number;
  version: number;
}

export interface SaveFile {
  version: number;
  meta: SaveMeta;
  systems: Record<string, unknown>;
}

export const SAVE_VERSION = 1;
export const SAVE_SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export const AUTOSAVE_SLOT = 'auto';
const PREFIX = 'a4n.save.';

type Migration = (f: SaveFile) => SaveFile;
/** MIGRATIONS[n] upgrades a version-n file to version n+1. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrateSaveFile(f: SaveFile): SaveFile {
  let file = f;
  while (file.version < SAVE_VERSION) {
    const m = MIGRATIONS[file.version];
    if (!m) break;
    file = m(file);
  }
  return file;
}

/** Minimal storage abstraction so tests and private-mode browsers work. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}

export function browserStore(): KeyValueStore {
  try {
    const ls = window.localStorage;
    const probe = '__a4n_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Object.keys(ls),
    };
  } catch {
    console.warn('[Save] localStorage unavailable — saves will last only for this session.');
    return new MemoryStore();
  }
}

function isSaveFile(x: any): x is SaveFile {
  return x && typeof x === 'object' && typeof x.version === 'number' && x.meta && typeof x.systems === 'object';
}

export class SaveManager {
  private systems = new Map<string, Persistable>();
  /** Supplies meta fields at save time (wired by Game). */
  metaProvider: (() => Omit<SaveMeta, 'slot' | 'savedAt' | 'version'>) | null = null;
  /** Slot of the currently running campaign (null in tutorial / menu). */
  activeSlot: string | null = null;
  /** Disable all writes (tutorial sandbox). */
  writesEnabled = true;
  private lastAutosave = 0;

  constructor(private readonly events: EventBus, private readonly store: KeyValueStore = browserStore()) {}

  register(p: Persistable): void {
    if (this.systems.has(p.saveKey)) throw new Error(`[Save] duplicate saveKey "${p.saveKey}"`);
    this.systems.set(p.saveKey, p);
  }

  unregister(key: string): void {
    this.systems.delete(key);
  }

  registeredKeys(): string[] {
    return [...this.systems.keys()];
  }

  /** Reset every registered system to new-game state. */
  resetAll(): void {
    for (const s of this.systems.values()) {
      try {
        s.reset();
      } catch (err) {
        console.error(`[Save] reset failed for ${s.saveKey}`, err);
      }
    }
  }

  private read(slot: string): SaveFile | null {
    for (const key of [PREFIX + slot, PREFIX + slot + '.bak']) {
      const raw = this.store.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (isSaveFile(parsed)) return migrateSaveFile(parsed);
        console.warn(`[Save] ${key} has invalid structure`);
      } catch {
        console.warn(`[Save] ${key} is corrupt, trying backup`);
      }
    }
    return null;
  }

  exists(slot: string): boolean {
    return this.read(slot) !== null;
  }

  listSlots(): Array<SaveMeta | null> {
    return SAVE_SLOTS.map((s) => this.read(s)?.meta ?? null);
  }

  getMeta(slot: string): SaveMeta | null {
    return this.read(slot)?.meta ?? null;
  }

  /** Most recently written save of any slot (including autosave). */
  latest(): SaveMeta | null {
    let best: SaveMeta | null = null;
    for (const s of [...SAVE_SLOTS, AUTOSAVE_SLOT]) {
      const m = this.getMeta(s);
      if (m && (!best || m.savedAt > best.savedAt)) best = m;
    }
    return best;
  }

  hasAnySave(): boolean {
    return this.latest() !== null;
  }

  /** First empty manual slot, or null if all are used. */
  firstEmptySlot(): string | null {
    for (const s of SAVE_SLOTS) if (!this.exists(s)) return s;
    return null;
  }

  /** Collect state from all systems and write to slot. Keeps previous file as .bak. */
  save(slot: string, auto = false): boolean {
    if (!this.writesEnabled) return false;
    const systems: Record<string, unknown> = {};
    for (const [key, sys] of this.systems) {
      try {
        systems[key] = sys.serialize();
      } catch (err) {
        console.error(`[Save] serialize failed for ${key}`, err);
      }
    }
    const metaBase = this.metaProvider?.() ?? {
      characterName: 'Avatar',
      startingElement: 'air' as Element,
      regionName: 'Unknown',
      level: 1,
      playTime: 0,
      masteredCount: 0,
    };
    const file: SaveFile = {
      version: SAVE_VERSION,
      meta: { ...metaBase, slot, savedAt: Date.now(), version: SAVE_VERSION },
      systems,
    };
    try {
      const key = PREFIX + slot;
      const prev = this.store.getItem(key);
      const json = JSON.stringify(file);
      if (prev) this.store.setItem(key + '.bak', prev);
      this.store.setItem(key, json);
      this.events.emit('save:written', { slot, auto });
      return true;
    } catch (err) {
      console.error('[Save] write failed', err);
      this.events.emit('save:failed', { slot, reason: String(err) });
      return false;
    }
  }

  /** Reset all systems then restore from slot. Returns false if slot missing/corrupt. */
  load(slot: string): boolean {
    const file = this.read(slot);
    if (!file) {
      this.events.emit('save:failed', { slot, reason: 'missing or corrupt' });
      return false;
    }
    this.resetAll();
    for (const [key, sys] of this.systems) {
      try {
        sys.deserialize(file.systems[key]);
      } catch (err) {
        console.error(`[Save] deserialize failed for ${key}; using defaults`, err);
        try {
          sys.reset();
        } catch {
          /* ignore */
        }
      }
    }
    this.events.emit('save:loaded', { slot });
    return true;
  }

  delete(slot: string): void {
    this.store.removeItem(PREFIX + slot);
    this.store.removeItem(PREFIX + slot + '.bak');
  }

  /** Throttled autosave to the active slot (and the rolling autosave slot). */
  autosave(now: number, minIntervalSec = 45): boolean {
    if (!this.activeSlot || !this.writesEnabled) return false;
    if (now - this.lastAutosave < minIntervalSec) return false;
    this.lastAutosave = now;
    const ok = this.save(this.activeSlot, true);
    return ok;
  }

  forceAutosaveTimer(now: number): void {
    this.lastAutosave = now;
  }
}
