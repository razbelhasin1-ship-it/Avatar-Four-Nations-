import type { GameEvents } from './events';

type Listener<T> = (payload: T) => void;

/**
 * Typed synchronous event bus. Listener exceptions are caught and logged so one
 * faulty subscriber can never break gameplay.
 */
export class EventBus<E extends object = GameEvents> {
  private listeners = new Map<keyof E, Set<Listener<any>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: Listener<E[K]>): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${String(type)}" threw`, err);
      }
    }
  }

  listenerCount(type: keyof E): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Collects unsubscribe handles so a system can drop all its listeners at once. */
export class Subscriptions {
  private offs: Array<() => void> = [];

  add(off: () => void): void {
    this.offs.push(off);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
