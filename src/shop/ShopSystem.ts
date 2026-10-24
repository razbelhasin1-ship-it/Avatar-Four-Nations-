import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import { cosmeticById } from '../data/cosmetics';
import { SPECIES_HOMELAND, speciesById } from '../data/creatures';
import { itemById } from '../data/items';
import type { NPC } from '../npc/NPCSystem';
import type { NPCDef } from '../npc/NPCTypes';
import { getSpot, spotsWithPrefix } from '../world/Spots';
import { ShopScreen } from './ShopScreen';
import { COMPANION_PRICES, SHOPS, shopById, type ShopDef } from './stock';

/**
 * Merchants & shops (module `shop`, ctx.extra.get('shop')).
 * A merchant NPC stands at every merchant_<id> spot; talking opens a short
 * conversation (wares / news) and the shop screen (buy & sell for copper).
 * Data dialogues can open a shop with the action { type: 'shop', shop: '<id>' }.
 * Beast keepers (ShopDef.companions) also sell companions of their own nation:
 * a purchase bonds the animal at once and it comes to you (CompanionSystem.adopt).
 *
 * Debug: window.__game.debug.shop = { shops, open, buy, buyCompanion, sell, price }.
 */
export interface BuyResult {
  ok: boolean;
  reason?: 'unknown' | 'poor' | 'owned' | 'notStocked' | 'busy';
  price: number;
  /** Set when a companion was bought. */
  companionId?: string;
}

export class ShopSystem implements GameSystem {
  private ctx!: GameContext;
  readonly missingSpots: string[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.ui.registerScreen('shop', (ui) => new ShopScreen(ui, this));
    // Roadside inns published by the wilds region (merchant_inn_<id>_1): innkeepers with travel supplies.
    const innNames = ['Innkeeper Bo', 'Innkeeper Mei', 'Innkeeper Gan', 'Innkeeper Lu', 'Innkeeper Sen', 'Innkeeper Ruo'];
    spotsWithPrefix('merchant_inn_').forEach(([id, sp], i) => {
      const suffix = id.slice('merchant_'.length);
      if (SHOPS.some((x) => x.spot === suffix)) return;
      SHOPS.push({ id: suffix, spot: suffix, merchant: innNames[i % innNames.length], title: sp.label ?? 'Roadside Inn', nation: 'earth', region: sp.region ?? 'earth_heartland', greeting: 'Road-weary? Tea is hot, herbs are fresh, and the beds only squeak a little.', rumor: 'Bandits have been robbing farmers on these roads. Riverbend\'s elder is looking for help.', items: ['healing_herbs', 'jasmine_tea', 'bread_crumbs', 'cabbage'] });
    });
    for (const s of SHOPS) {
      ctx.npcs.addDef(this.npcDef(s));
      ctx.npcs.onTalk(`merchant_${s.id}`, (npc) => this.talk(npc, s));
    }
    ctx.npcs.onAction('shop', (_c, a) => {
      if (a.type === 'shop') this.open(a.shop);
    });
    this.installDebug();
  }

  private npcDef(s: ShopDef): NPCDef {
    const sp = s.fixed ? undefined : getSpot(`merchant_${s.spot}`);
    if (!sp && !s.fixed) this.missingSpots.push(`merchant_${s.spot}`);
    const x = sp?.x ?? s.fallback?.x ?? 0;
    const z = sp?.z ?? s.fallback?.z ?? 0;
    return {
      id: `merchant_${s.id}`,
      name: s.merchant,
      title: s.title,
      role: 'merchant',
      nation: s.nation,
      x,
      z,
      y: sp?.y,
      yaw: sp?.yaw ?? s.fallback?.yaw ?? 0,
      behavior: { type: 'idle', variant: 'stand' },
      region: s.region,
      appearanceSeed: hash(s.id),
    };
  }

  // ---------------------------------------------------------------------------
  // Prices & transactions
  // ---------------------------------------------------------------------------

  buyPrice(id: string): number {
    return itemById(id)?.price ?? cosmeticById(id)?.price ?? 0;
  }

  sellPrice(id: string, shop?: ShopDef): number {
    const p = itemById(id)?.price ?? 0;
    return p > 0 ? Math.max(1, Math.floor(p * (shop?.sellRate ?? 0.4))) : 0;
  }

  buy(shopId: string, id: string): BuyResult {
    const ctx = this.ctx;
    const s = shopById(shopId);
    const inv = ctx.inventory;
    const isCos = !!cosmeticById(id) && !itemById(id);
    const price = this.buyPrice(id);
    if (!s || price <= 0) return { ok: false, reason: 'unknown', price };
    if (!(isCos ? s.cosmetics ?? [] : s.items).includes(id)) return { ok: false, reason: 'notStocked', price };
    if (isCos && inv.isCosmeticUnlocked(id)) return { ok: false, reason: 'owned', price };
    if (!inv.spend(price)) {
      ctx.events.emit('ui:notify', { text: `Not enough copper — ${price} needed, you have ${inv.currency}.`, kind: 'warning', duration: 3 });
      ctx.audio.play('ui_click', { bus: 'ui', volume: 0.5, pitch: 0.55 });
      return { ok: false, reason: 'poor', price };
    }
    if (isCos) inv.unlockCosmetic(id);
    else inv.add(id, 1);
    ctx.audio.play('ui_click', { bus: 'ui', volume: 0.7, pitch: 1.4 });
    return { ok: true, price };
  }

  companionPrice(speciesId: string): number {
    return COMPANION_PRICES[speciesId] ?? 0;
  }

  /** Buy a companion from a beast keeper. Only species from the keeper's own nation are ever sold. */
  buyCompanion(shopId: string, speciesId: string): BuyResult {
    const ctx = this.ctx;
    const s = shopById(shopId);
    const def = speciesById(speciesId);
    const price = this.companionPrice(speciesId);
    if (!s || !def || price <= 0) return { ok: false, reason: 'unknown', price };
    if (!(s.companions ?? []).includes(speciesId) || SPECIES_HOMELAND[speciesId] !== s.nation) return { ok: false, reason: 'notStocked', price };
    if (ctx.companions.mounted || ctx.session.kind !== 'campaign') {
      ctx.events.emit('ui:notify', { text: ctx.companions.mounted ? 'Dismount before you buy a new companion.' : 'Companions can only be bought on your journey.', kind: 'warning', duration: 3 });
      return { ok: false, reason: 'busy', price };
    }
    if (!ctx.inventory.spend(price)) {
      ctx.events.emit('ui:notify', { text: `Not enough copper — ${price} needed, you have ${ctx.inventory.currency}.`, kind: 'warning', duration: 3 });
      ctx.audio.play('ui_click', { bus: 'ui', volume: 0.5, pitch: 0.55 });
      return { ok: false, reason: 'poor', price };
    }
    const rec = ctx.companions.adopt(speciesId);
    if (!rec) {
      ctx.inventory.addCurrency(price);
      return { ok: false, reason: 'unknown', price };
    }
    ctx.audio.play('ui.levelup', { volume: 0.7 });
    ctx.events.emit('companion:purchased', { companionId: rec.id, speciesId, name: rec.name, price, shopId });
    const how = def.flying ? 'It is flying in to meet you.' : 'It is on its way to you.';
    ctx.events.emit('ui:notify', { text: `${def.name} bought from ${s.merchant}! ${how} Name it in the Companion Stable.`, kind: 'success', duration: 5, icon: '💛' });
    return { ok: true, price, companionId: rec.id };
  }

  sell(shopId: string, id: string): BuyResult {
    const ctx = this.ctx;
    const s = shopById(shopId);
    const def = itemById(id);
    const price = this.sellPrice(id, s);
    if (!def || price <= 0 || def.category === 'quest') return { ok: false, reason: 'unknown', price };
    if (!ctx.inventory.remove(id, 1)) return { ok: false, reason: 'unknown', price };
    ctx.inventory.addCurrency(price);
    ctx.audio.play('ui_click', { bus: 'ui', volume: 0.6, pitch: 1.1 });
    return { ok: true, price };
  }

  open(shopId: string): boolean {
    const s = shopById(shopId);
    if (!s) return false;
    if (this.ctx.npcs.talkingTo) this.ctx.npcs.endConversation();
    else this.ctx.ui.hideDialogue();
    this.ctx.ui.open('shop', s);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------------

  private talk(npc: NPC, s: ShopDef): void {
    const ui = this.ctx.ui;
    const speaker = `${s.merchant} · ${s.title}`;
    const end = () => this.ctx.npcs.endConversation();
    const menu = (text: string): void =>
      ui.showDialogue({
        speaker,
        text,
        choices: [
          { text: s.companions?.length ? 'Show me your animals.' : 'Show me your wares.', onSelect: () => this.open(s.id) },
          { text: 'Heard any news?', onSelect: (): void => menu(s.rumor) },
          { text: 'Farewell.', onSelect: end },
        ],
      });
    menu(s.greeting);
    void npc;
  }

  private installDebug(): void {
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = () => {
      if (!w.__game) return false;
      w.__game.debug.shop = {
        sys: this,
        shops: () => SHOPS.map((s) => ({ id: s.id, npc: `merchant_${s.id}`, nation: s.nation, items: s.items, cosmetics: s.cosmetics ?? [], companions: s.companions ?? [], spot: !this.missingSpots.includes(`merchant_${s.spot}`) })),
        missingSpots: () => [...this.missingSpots],
        open: (id: string) => this.open(id),
        buy: (shop: string, id: string) => this.buy(shop, id),
        buyCompanion: (shop: string, species: string) => this.buyCompanion(shop, species),
        companionPrice: (species: string) => this.companionPrice(species),
        sell: (shop: string, id: string) => this.sell(shop, id),
        price: (id: string) => this.buyPrice(id),
        goto: (id: string) => {
          const d = this.ctx.npcs.getDef(`merchant_${id}`);
          if (!d) return false;
          const f = new THREE.Vector3(Math.sin(d.yaw ?? 0), 0, Math.cos(d.yaw ?? 0));
          const x = d.x + f.x * 2, z = d.z + f.z * 2;
          const y = d.y ?? this.ctx.world.groundAt(x, z).y;
          this.ctx.player!.teleport(new THREE.Vector3(x, this.ctx.world.groundAt(x, z, y + 2).y + 0.05, z), (d.yaw ?? 0) + Math.PI);
          this.ctx.cameraRig.snapBehind();
          return true;
        },
      };
      return true;
    };
    if (!install()) {
      const iv = setInterval(() => install() && clearInterval(iv), 200);
    }
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
