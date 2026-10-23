import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import { COSMETICS, cosmeticById } from '../data/cosmetics';
import { ITEMS, itemById } from '../data/items';

/**
 * Items (quest objects, consumables, collectibles, companion food), currency
 * (copper pieces) and unlocked cosmetics. Cosmetic *equipping* lives in the
 * player's appearance; this only tracks ownership.
 */
export class Inventory implements GameSystem, Persistable {
  readonly saveKey = 'inventory';
  private ctx!: GameContext;
  readonly items = new Map<string, number>();
  readonly cosmetics = new Set<string>();
  currency = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  count(id: string): number {
    return this.items.get(id) ?? 0;
  }

  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  add(id: string, n = 1, silent = false): void {
    if (n <= 0) return;
    const def = itemById(id);
    const max = def?.stack ?? 99;
    this.items.set(id, Math.min(max, this.count(id) + n));
    this.ctx?.events.emit('item:acquired', { itemId: id, count: n });
    if (!silent && def) this.ctx?.events.emit('ui:notify', { text: `${def.name}${n > 1 ? ` ×${n}` : ''}`, kind: 'info', icon: def.icon, duration: 2.5 });
  }

  remove(id: string, n = 1): boolean {
    const c = this.count(id);
    if (c < n) return false;
    if (c === n) this.items.delete(id);
    else this.items.set(id, c - n);
    return true;
  }

  /** Use a consumable; returns true if consumed. Effects are applied by the item's handler. */
  use(id: string): boolean {
    const def = itemById(id);
    if (!def || !def.use || !this.has(id)) return false;
    const ok = def.use(this.ctx);
    if (ok) {
      this.remove(id, 1);
      this.ctx.events.emit('item:used', { itemId: id });
    }
    return ok;
  }

  addCurrency(n: number): void {
    this.currency = Math.max(0, this.currency + n);
    this.ctx?.events.emit('currency:changed', { amount: this.currency, delta: n });
  }

  spend(n: number): boolean {
    if (this.currency < n) return false;
    this.addCurrency(-n);
    return true;
  }

  isCosmeticUnlocked(id: string): boolean {
    const def = cosmeticById(id);
    if (!def) return false;
    return def.unlock === 'start' || this.cosmetics.has(id);
  }

  unlockCosmetic(id: string, silent = false): void {
    if (this.cosmetics.has(id) || !cosmeticById(id)) return;
    this.cosmetics.add(id);
    this.ctx?.events.emit('cosmetic:unlocked', { cosmeticId: id });
    if (!silent) this.ctx?.events.emit('ui:notify', { text: `New attire: ${cosmeticById(id)!.name}`, kind: 'success', duration: 3.5 });
  }

  unlockedCosmetics(): string[] {
    return COSMETICS.filter((c) => this.isCosmeticUnlocked(c.id)).map((c) => c.id);
  }

  allItems(): Array<{ id: string; count: number }> {
    return [...this.items.entries()].filter(([id]) => ITEMS.some((i) => i.id === id)).map(([id, count]) => ({ id, count }));
  }

  serialize(): unknown {
    if (this.ctx?.session.kind === 'tutorial') return undefined;
    return { v: 1, items: [...this.items.entries()], cosmetics: [...this.cosmetics], currency: this.currency };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.items)) for (const e of data.items) if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number') this.items.set(e[0], Math.max(0, Math.floor(e[1])));
    if (Array.isArray(data.cosmetics)) for (const c of data.cosmetics) if (typeof c === 'string') this.cosmetics.add(c);
    if (typeof data.currency === 'number') this.currency = Math.max(0, Math.floor(data.currency));
  }

  reset(): void {
    this.items.clear();
    this.cosmetics.clear();
    this.currency = 0;
  }
}
