/** Generic free-list object pool. Avoids allocation churn for projectiles, particles, decals. */
export class Pool<T> {
  private free: T[] = [];
  private live = new Set<T>();

  constructor(
    private readonly factory: () => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
    private readonly maxSize = Infinity,
  ) {}

  acquire(): T | null {
    let item = this.free.pop();
    if (!item) {
      if (this.live.size >= this.maxSize) return null;
      item = this.factory();
    }
    this.live.add(item);
    this.onAcquire?.(item);
    return item;
  }

  release(item: T): void {
    if (!this.live.delete(item)) return;
    this.onRelease?.(item);
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of [...this.live]) this.release(item);
  }

  get liveCount(): number {
    return this.live.size;
  }

  forEachLive(fn: (item: T) => void): void {
    for (const item of this.live) fn(item);
  }

  /** Drop all pooled objects (call dispose on each if needed). */
  drain(dispose?: (item: T) => void): void {
    for (const item of this.live) dispose?.(item);
    for (const item of this.free) dispose?.(item);
    this.live.clear();
    this.free.length = 0;
  }
}
