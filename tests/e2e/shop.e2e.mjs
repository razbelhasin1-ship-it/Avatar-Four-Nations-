/**
 * Merchants & shop E2E: talk to a merchant → shop screen → buy (copper deducted, item granted),
 * can't-afford feedback, sell back at a fraction, buy a cosmetic.
 * Run: node tests/e2e/shop.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.SHOTS || '';
const h = await launch({ width: 960, height: 540 });
const results = [];
const t0 = Date.now();
const check = async (name, fn) => {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${name}`);
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const ev = (fn, ...a) => h.eval(fn, ...a);

/** Low render cost while simulating; coarse steps for waiting (streaming). */
const fast = (on) => h.eval((g, on) => g.setting('graphics.renderScale', on ? 0.3 : 0.75), on);
const wait = (sec) => h.step(Math.max(1, Math.round(sec / 0.1)), 0.1);

try {
  await check('buy from a Lower Ring merchant through the shop screen', async () => {
    await h.newGame('earth');
    await fast(true);
    await ev((g) => g.ctx.inventory.addCurrency(100 - g.ctx.inventory.currency));
    assert.ok(await ev((g) => g.debug.shop.goto('bss_produce')));
    await wait(1.5);
    assert.ok(await ev((g) => { const n = g.ctx.npcs.get('merchant_bss_produce'); if (!n) return false; g.ctx.npcs.talk(n); return true; }), 'merchant spawned');
    await ev((g) => g.debug.training.choose('wares'));
    assert.equal(await ev((g) => g.ctx.ui.currentScreen), 'shop');
    if (SHOTS) {
      await fast(false);
      await h.step(1);
      await h.shot(`${SHOTS}/shop_screen.png`, { timeout: 90000 }).catch((e) => console.log('shot failed', e.message));
    }
    const before = await ev((g) => ({ c: g.ctx.inventory.currency, n: g.ctx.inventory.count('cabbage') }));
    await ev(() => document.querySelector('[data-buy="cabbage"]').click());
    const after = await ev((g) => ({ c: g.ctx.inventory.currency, n: g.ctx.inventory.count('cabbage') }));
    assert.equal(after.c, before.c - 4, 'copper deducted');
    assert.equal(after.n, before.n + 1, 'item granted');
    // Can't afford.
    await ev((g) => g.ctx.inventory.addCurrency(-g.ctx.inventory.currency + 3));
    await ev(() => document.querySelector('[data-buy="healing_herbs"]').click());
    const poor = await ev((g) => ({ c: g.ctx.inventory.currency, n: g.ctx.inventory.count('healing_herbs'), toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|') }));
    assert.equal(poor.c, 3);
    assert.equal(poor.n, 0);
    assert.ok(/Not enough copper/.test(poor.toast), 'feedback toast: ' + poor.toast);
    assert.ok(await ev(() => document.querySelector('[data-item="healing_herbs"] .shop-price').classList.contains('poor')), 'price shown red');
    // Sell back at a fraction.
    await ev(() => document.querySelector('[data-sell="cabbage"]').click());
    const sold = await ev((g) => ({ c: g.ctx.inventory.currency, n: g.ctx.inventory.count('cabbage') }));
    assert.equal(sold.c, 3 + 1, 'sold for 40% (floor)');
    assert.equal(sold.n, after.n - 1);
    await ev((g) => g.ctx.ui.close('shop'));
  });

  await check('buy a cosmetic from the tailor', async () => {
    await ev((g) => g.ctx.inventory.addCurrency(200));
    const r = await ev((g) => g.debug.shop.buy('bss_tailor', 'earth_hairpin'));
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(await ev((g) => g.ctx.inventory.isCosmeticUnlocked('earth_hairpin')));
    const again = await ev((g) => g.debug.shop.buy('bss_tailor', 'earth_hairpin'));
    assert.equal(again.reason, 'owned');
    const notStocked = await ev((g) => g.debug.shop.buy('bss_tailor', 'fire_flakes'));
    assert.equal(notStocked.ok, false);
  });

  await check('every shop has a merchant NPC def and valid stock', async () => {
    const shops = await ev((g) => g.debug.shop.shops().map((s) => ({ ...s, def: !!g.ctx.npcs.getDef(s.npc), prices: [...s.items, ...s.cosmetics].map((i) => g.debug.shop.price(i)) })));
    for (const s of shops) {
      assert.ok(s.def, 'npc def for ' + s.id);
      assert.ok(s.prices.every((p) => p > 0), 'priced stock in ' + s.id + ' ' + JSON.stringify(s.prices));
    }
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  const errs = h.errors.filter((e) => !/favicon|404/.test(e));
  if (errs.length) console.log('page errors:', errs.slice(0, 8).join('\n'));
  await h.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
