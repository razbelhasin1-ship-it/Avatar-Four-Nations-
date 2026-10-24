import { SPECIES_ICON } from '../companions/StableScreen';
import { cosmeticById } from '../data/cosmetics';
import { speciesById } from '../data/creatures';
import { itemById } from '../data/items';
import type { GameContext } from '../core/GameContext';
import { injectTrainingCSS } from '../training/hud';
import { clear, h } from '../ui/dom';
import type { Screen, UIManager } from '../ui/UIManager';
import type { ShopSystem } from './ShopSystem';
import type { ShopDef } from './stock';

/** Buy / sell screen (ui.open('shop', shopDef)). Pauses the game like other menus. */
export class ShopScreen implements Screen {
  readonly id = 'shop';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  private ctx!: GameContext;
  private shop: ShopDef | null = null;
  private body: HTMLElement;
  private title: HTMLElement;
  private purse: HTMLElement;

  constructor(
    private readonly ui: UIManager,
    private readonly sys: ShopSystem,
  ) {
    injectTrainingCSS();
    this.title = h('h2.title', 'Shop');
    this.purse = h('span', { style: { fontFamily: 'var(--font-title)', fontSize: '18px' } });
    const header = h('div.modal-header', this.title, h('div.spacer'), this.purse, h('button.btn.small', { onclick: () => this.ui.close(), 'data-action': 'close', style: { marginLeft: '14px' } }, 'Close'));
    this.body = h('div.scroll', { style: { flex: '1', minHeight: '0', paddingRight: '8px' } });
    this.el = h('div.modal-backdrop', h('div.modal.panel.shop-panel', { style: { height: 'min(680px, calc(100vh - 32px))' } }, header, this.body));
  }

  onOpen(ctx: GameContext, arg?: unknown): void {
    this.ctx = ctx;
    this.shop = (arg as ShopDef) ?? this.shop;
    this.render();
  }

  private render(): void {
    const s = this.shop;
    const ctx = this.ctx;
    if (!s) return;
    const inv = ctx.inventory;
    this.title.textContent = `${s.merchant} — ${s.title}`;
    this.purse.textContent = `🪙 ${inv.currency} copper`;
    clear(this.body);
    const buy = h('div', h('h3', { style: { margin: '4px 0 8px' } }, 'Buy'));
    for (const id of s.items) {
      const d = itemById(id);
      if (!d?.price) continue;
      const poor = inv.currency < d.price;
      buy.append(
        h(
          'div.shop-row',
          { 'data-item': id },
          h('div.shop-icon', d.icon),
          h('div.shop-name', `${d.name}${inv.count(id) ? `  (have ${inv.count(id)})` : ''}`, h('small', d.description)),
          h(`div.shop-price${poor ? '.poor' : ''}`, `${d.price} cp`),
          h('button.btn.small', { 'data-buy': id, onclick: () => this.buy(id) }, 'Buy'),
        ),
      );
    }
    for (const id of s.cosmetics ?? []) {
      const c = cosmeticById(id);
      if (!c?.price) continue;
      const owned = inv.isCosmeticUnlocked(id);
      const poor = !owned && inv.currency < c.price;
      buy.append(
        h(
          'div.shop-row',
          { 'data-item': id },
          h('div.shop-icon', '👘'),
          h('div.shop-name', `${c.name} · ${c.slot}`, h('small', c.description)),
          h(`div.shop-price${poor ? '.poor' : ''}`, owned ? 'Owned' : `${c.price} cp`),
          owned ? h('button.btn.small', { disabled: true }, 'Owned') : h('button.btn.small', { 'data-buy': id, onclick: () => this.buy(id) }, 'Buy'),
        ),
      );
    }
    const sell = h('div', h('h3', { style: { margin: '4px 0 8px' } }, `Sell  `, h('span.muted', { style: { fontSize: '14px' } }, `(${Math.round((s.sellRate ?? 0.4) * 100)}% of value)`)));
    let any = false;
    for (const { id, count } of inv.allItems()) {
      const d = itemById(id);
      const price = this.sys.sellPrice(id, s);
      if (!d || price <= 0 || d.category === 'quest') continue;
      any = true;
      sell.append(
        h(
          'div.shop-row',
          { 'data-item': id },
          h('div.shop-icon', d.icon),
          h('div.shop-name', `${d.name} ×${count}`, h('small', d.description)),
          h('div.shop-price', `${price} cp`),
          h('button.btn.small', { 'data-sell': id, onclick: () => this.sell(id) }, 'Sell'),
        ),
      );
    }
    if (!any) sell.append(h('p.muted', 'Nothing to sell.'));
    this.body.append(h('p.muted', { style: { margin: '0 0 10px', fontStyle: 'italic' } }, `“${s.greeting}”`));
    if (s.companions?.length) this.body.append(this.pens(s));
    this.body.append(h('div.shop-cols', buy, sell));
  }

  /** Beast keeper: companions for sale (bonded on purchase). */
  private pens(s: ShopDef): HTMLElement {
    const ctx = this.ctx;
    const wrap = h('div', { style: { marginBottom: '12px' } }, h('h3', { style: { margin: '4px 0 8px' } }, 'Companions'));
    for (const sp of s.companions ?? []) {
      const d = speciesById(sp);
      const price = this.sys.companionPrice(sp);
      if (!d || price <= 0) continue;
      const poor = ctx.inventory.currency < price;
      const owned = ctx.companions.bonded.filter((r) => r.speciesId === sp).length;
      const kind = d.role === 'pet' ? 'Pet' : d.flying ? 'Flying mount' : 'Mount';
      const perks = d.bondUnlocks.filter((u) => u.at <= 10).map((u) => u.name).join(', ');
      wrap.append(
        h(
          'div.shop-row.shop-beast',
          { 'data-companion': sp },
          h('div.shop-icon', SPECIES_ICON[sp] ?? '🐾'),
          h('div.shop-name', `${d.name} · ${kind}${owned ? `  (you have ${owned})` : ''}`, h('small', `${d.description} Stable-raised: ${d.rideable ? 'ready to ride' : 'follows you'} from day one${perks ? ` (${perks})` : ''}, and your bond grows as you travel together.`)),
          h(`div.shop-price${poor ? '.poor' : ''}`, `${price} cp`),
          h('button.btn.small', { 'data-buy-companion': sp, onclick: () => this.buyCompanion(sp) }, 'Buy'),
        ),
      );
    }
    return wrap;
  }

  private buyCompanion(sp: string): void {
    const r = this.sys.buyCompanion(this.shop!.id, sp);
    if (r.ok && r.companionId) {
      // Name the new companion straight away, as after taming one.
      this.ui.close('shop');
      if (!this.ctx.companions.autoName) this.ui.open('companions', { name: r.companionId });
      return;
    }
    this.render();
    if (r.reason === 'poor') {
      const row = this.body.querySelector(`[data-companion="${sp}"] .shop-price`) as HTMLElement | null;
      row?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    }
  }

  private buy(id: string): void {
    const r = this.sys.buy(this.shop!.id, id);
    if (!r.ok && r.reason === 'poor') {
      this.render();
      const row = this.body.querySelector(`[data-item="${id}"] .shop-price`) as HTMLElement | null;
      row?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      return;
    }
    this.render();
  }

  private sell(id: string): void {
    this.sys.sell(this.shop!.id, id);
    this.render();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ui.close('shop');
      return true;
    }
    return false;
  }
}
