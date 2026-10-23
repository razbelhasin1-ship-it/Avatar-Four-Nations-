import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { MemoryStore, SaveManager, type Persistable } from '../../src/core/Save';

class Counter implements Persistable {
  readonly saveKey = 'counter';
  n = 0;
  serialize() {
    return { n: this.n };
  }
  deserialize(d: any) {
    if (d && typeof d.n === 'number') this.n = d.n;
  }
  reset() {
    this.n = 0;
  }
}

describe('SaveManager', () => {
  it('round-trips registered systems', () => {
    const store = new MemoryStore();
    const sm = new SaveManager(new EventBus(), store);
    const c = new Counter();
    sm.register(c);
    c.n = 7;
    expect(sm.save('slot1')).toBe(true);
    c.n = 0;
    expect(sm.load('slot1')).toBe(true);
    expect(c.n).toBe(7);
  });

  it('recovers from a corrupt main file using the backup', () => {
    const store = new MemoryStore();
    const sm = new SaveManager(new EventBus(), store);
    const c = new Counter();
    sm.register(c);
    c.n = 1;
    sm.save('slot1');
    c.n = 2;
    sm.save('slot1'); // previous becomes .bak
    store.setItem('a4n.save.slot1', '{not json');
    expect(sm.load('slot1')).toBe(true);
    expect(c.n).toBe(1);
  });

  it('missing systems data falls back to reset state', () => {
    const store = new MemoryStore();
    const sm = new SaveManager(new EventBus(), store);
    sm.save('slot2');
    const c = new Counter();
    c.n = 99;
    sm.register(c);
    expect(sm.load('slot2')).toBe(true);
    expect(c.n).toBe(0);
  });

  it('reports the first empty slot and never claims a used one', () => {
    const sm = new SaveManager(new EventBus(), new MemoryStore());
    sm.register(new Counter());
    expect(sm.firstEmptySlot()).toBe('slot1');
    sm.save('slot1');
    expect(sm.firstEmptySlot()).toBe('slot2');
  });
});
