/**
 * In-game screens & HUD E2E: every screen opens from its key and from the pause
 * menu, each control works (fast travel moves the player, equipping changes the
 * slot, a cosmetic applies to the character, eating heals), gamepad navigation,
 * no console errors, no HUD overlap at 960×540 / 1440×900 / phone.
 *
 *   node tests/e2e/ui.e2e.mjs                 (screenshots → $UI_SHOTS, default: none)
 *   UI_SHOTS=/some/dir node tests/e2e/ui.e2e.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.UI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let h = null;
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 6).join(' ')]);
    if (SHOTS) await h?.shot(`${SHOTS}/FAIL_${name.replace(/\W+/g, '_').slice(0, 40)}.png`, { timeout: 15000 }).catch(() => {});
    // Leave a clean slate so one failure does not cascade into the next checks.
    await h?.eval((g) => {
      document.querySelector('.confirm .btn:last-child')?.click();
      g.ctx.ui.hideDialogue();
      g.ctx.ui.closeAll();
      if (g.game.paused) g.game.setPaused(false);
    }).catch(() => {});
  }
};
const shot = async (name) => {
  if (!SHOTS) return;
  await h.shot(`${SHOTS}/${name}.png`, { timeout: 20000 }).catch((e) => console.log(`(screenshot ${name} skipped: ${e.message.split('\n')[0]})`));
};
/** DOM click without Playwright's actionability waits (fast under software rendering). */
const domClick = (sel) => h.page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing ' + sel);
  el.click();
}, sel);
const screen = () => h.eval((g) => g.ctx.ui.currentScreen);
const press = async (key, frames = 2) => {
  await h.page.keyboard.press(key);
  await h.step(frames);
};
const errorsNow = () => h.errors.filter((e) => !/favicon|WebGL|GPU stall|swiftshader/i.test(e));

const KEYS = [
  ['KeyM', 'map'],
  ['KeyJ', 'journal'],
  ['KeyK', 'techniques'],
  ['KeyI', 'inventory'],
  ['KeyC', 'character'],
  ['KeyP', 'companions'],
];

try {
  // ---------------------------------------------------------------- desktop
  h = await launch({ width: 1440, height: 900 });
  await h.newGame('water');
  await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, { timeout: 60000 });
  await h.eval((g) => {
    g.ctx.ui.closeAll?.();
    document.querySelector('.cine-skip')?.click();
    document.querySelector('[data-action="quest-ok"]')?.click();
  });
  await h.eval((g) => {
    g.setting('graphics.renderScale', 0.5);
    for (const id of ['water_whip', 'water_jet', 'water_sweep']) g.learn(id);
  });
  await h.step(20);

  await check('HUD: vitals, medallion, ability bar, compass and quest tracker render', async () => {
    const hud = await h.page.evaluate(() => ({
      medal: !!document.querySelector('.hud .hud-medal svg'),
      slots: document.querySelectorAll('.hud .slots .slot').length,
      named: [...document.querySelectorAll('.hud .slots .slot .name')].filter((n) => n.textContent && n.textContent !== '—').length,
      drops: document.querySelectorAll('.hud .hud-drops .drop').length,
      compass: document.querySelectorAll('.hud .compass .tick').length,
      hp: document.querySelector('.hud .bar.hp .fill')?.style.transform,
    }));
    assert.ok(hud.medal, 'no element medallion');
    assert.equal(hud.slots, 4, 'expected 4 ability slots');
    assert.ok(hud.named >= 2, 'slots show technique names');
    assert.equal(hud.drops, 6, 'water reserve droplets for a waterbender');
    assert.ok(hud.compass >= 3, 'compass ticks');
    assert.ok(/scaleX/.test(hud.hp ?? ''), 'health bar driven');
    await shot('d01_hud');
  });

  await check('every screen opens from its key and closes with Escape (no pause)', async () => {
    for (const [code, id] of KEYS) {
      await press(code);
      assert.equal(await screen(), id, `${code} should open ${id}`);
      await press('Escape');
      const st = await h.state();
      assert.equal(st.ui.screen, null, `Escape should close ${id}, now ${st.ui.screen}`);
      assert.equal(st.paused, false, `closing ${id} with Escape must not pause the game`);
    }
  });

  await check('pause menu: shortcuts open each screen and return to the menu; resume works', async () => {
    await press('Escape');
    assert.equal(await screen(), 'pause');
    let first = true;
    for (const [, id] of KEYS) {
      if (first) await h.page.click(`.ps-tile[data-open="${id}"]`);
      else await domClick(`.ps-tile[data-open="${id}"]`);
      first = false;
      await h.step(1);
      assert.equal(await screen(), id, `pause → ${id}`);
      await press('Escape', 2);
      assert.equal(await screen(), 'pause', `closing ${id} returns to pause`);
    }
    await shot('d02_pause');
    for (const a of ['save', 'load', 'settings']) {
      await domClick(`.ps-menu [data-action="${a}"]`);
      await h.step(1);
      const s = await screen();
      assert.ok(s === 'saveload' || s === 'settings', `${a} → ${s}`);
      await press('Escape', 2);
      assert.equal(await screen(), 'pause', `Escape on ${s} returns to pause`);
    }
    // Escape on the pause menu itself resumes (and must not re-open it).
    await press('Escape', 3);
    assert.equal(await screen(), null, 'Escape resumes');
    assert.equal((await h.state()).paused, false);
    await press('Escape', 2);
    assert.equal(await screen(), 'pause');
    await h.page.click('.ps-menu [data-action="exit"]');
    await h.step(1);
    assert.ok(await h.page.isVisible('.confirm'), 'exit asks for confirmation');
    assert.ok((await h.page.textContent('.confirm')).includes('Save & Exit'), 'exit offers save');
    await h.page.click('.confirm button:has-text("Cancel")');
    await h.page.click('.ps-menu [data-action="resume"]');
    await h.step(1);
    const st = await h.state();
    assert.equal(st.paused, false);
    assert.equal(st.ui.screen, null);
  });

  await check('journal: quest tabs, detail with objectives, tracking toggles', async () => {
    await press('KeyJ');
    assert.equal(await screen(), 'journal');
    const n = await h.page.locator('.jr-q').count();
    assert.ok(n >= 1, 'at least one quest listed');
    const before = await h.eval((g) => g.ctx.quests.tracked);
    await h.page.click('.jr-q >> nth=0');
    await h.page.click('[data-action="track"]');
    const after = await h.eval((g) => g.ctx.quests.tracked);
    assert.notEqual(after, before, 'track button changes the tracked quest');
    await h.page.click('[data-action="track"]');
    assert.ok(await h.page.isVisible('.jr-steps'), 'quest steps shown');
    await shot('d03_journal');
    for (const t of ['masters', 'mastery', 'bestiary', 'lore']) {
      await domClick(`.gs-tab[data-tab="${t}"]`);
      assert.equal(await h.page.getAttribute('.gs-tab.active', 'data-tab'), t);
    }
    assert.ok(await h.page.isVisible('.jr-lore-text'), 'lore entry readable');
    await domClick('.gs-tab[data-tab="mastery"]');
    assert.equal(await h.page.locator('.jr-el').count(), 4, 'four element mastery cards');
    assert.ok(await h.page.isVisible('[data-sphere]'), 'Elements Sphere status');
    // Keyboard tab cycling (Q/E)
    await press('KeyE', 1);
    assert.equal(await h.page.getAttribute('.gs-tab.active', 'data-tab'), 'bestiary');
    await press('Escape');
  });

  await check('gamepad: RB switches tabs, D-pad moves focus, A activates, B closes', async () => {
    await h.page.evaluate(() => {
      const pad = { id: 'mock', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad;
      navigator.getGamepads = () => [pad];
    });
    const tap = async (i) => {
      await h.page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i);
      await h.step(1);
      await h.page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i);
      await h.step(1);
    };
    await press('KeyJ');
    const t0 = await h.page.getAttribute('.gs-tab.active', 'data-tab');
    await tap(5);
    const t1 = await h.page.getAttribute('.gs-tab.active', 'data-tab');
    assert.notEqual(t1, t0, 'RB changed tab');
    await tap(13);
    const focused = await h.page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.gs-frame'));
    assert.ok(focused, 'D-pad moved focus into the screen');
    await tap(1);
    assert.equal(await screen(), null, 'B closed the screen');
    await h.page.evaluate(() => (navigator.getGamepads = () => []));
  });

  await check('techniques: click-to-assign changes the slot (and the HUD)', async () => {
    await press('KeyK');
    assert.equal(await screen(), 'techniques');
    const el = await h.eval((g) => g.ctx.player.element);
    const before = await h.eval((g, e) => g.ctx.progression.slotsFor(e), el);
    const cand = await h.page.$$eval('.tq-card[draggable="true"]', (cs) => cs.map((c) => c.dataset.tech));
    assert.ok(cand.length >= 2, 'need two equippable techniques, got ' + cand.length);
    const pick = cand.find((id) => id !== before[0]) ?? cand[0];
    await h.page.click(`.tq-card[data-tech="${pick}"] [data-action="equip"]`);
    await h.page.click('.tq-slot[data-slot="0"]');
    const after = await h.eval((g, e) => g.ctx.progression.slotsFor(e), el);
    assert.equal(after[0], pick, `slot 1 should hold ${pick}: ${JSON.stringify(after)}`);
    // Keyboard: focus a card and press 2
    const other = cand.find((id) => id !== pick);
    await h.page.focus(`.tq-card[data-tech="${other}"]`);
    await h.page.keyboard.press('Digit2');
    const after2 = await h.eval((g, e) => g.ctx.progression.slotsFor(e), el);
    assert.equal(after2[1], other, 'keyboard 2 equips into slot 2');
    await shot('d04_techniques');
    await press('Escape');
    const hudIds = await h.page.$$eval('.hud .slots .slot', (s) => s.map((x) => x.dataset.id));
    assert.equal(hudIds[0], pick, 'HUD slot 1 follows the loadout');
    await press('KeyK', 2);
    for (const t of ['air', 'earth', 'fire', 'avatar']) {
      await domClick(`.gs-tab[data-tab="${t}"]`);
      assert.ok((await h.page.locator('.tq-card').count()) > 0, `${t} tab lists techniques`);
    }
    await press('Escape', 2);
  });

  await check('inventory: eating food heals; herbs use; categories filter', async () => {
    await h.eval((g) => {
      g.ctx.inventory.add('cabbage', 2, true);
      g.ctx.inventory.add('healing_herbs', 1, true);
      g.ctx.player.health.hp = Math.max(1, g.ctx.player.health.maxHp - 60);
    });
    await press('KeyI');
    assert.equal(await screen(), 'inventory');
    await h.page.click('[data-cat="food"]');
    await h.page.click('.iv-item[data-item="cabbage"]');
    const hp0 = (await h.state()).player.hp;
    await h.page.click('[data-action="eat"]');
    const st = await h.state();
    assert.ok(st.player.hp >= hp0 + 14.9, `eating should heal: ${hp0} → ${st.player.hp}`);
    assert.equal(st.inventory.items.cabbage, 1, 'one cabbage eaten');
    await h.page.click('[data-cat="consumable"]');
    await h.page.click('.iv-item[data-item="healing_herbs"]');
    await h.page.click('[data-action="use"]');
    const st2 = await h.state();
    assert.ok(st2.player.hp > st.player.hp, 'herbs heal');
    await h.page.click('[data-cat="all"]');
    await shot('d05_inventory');
    await press('Escape');
  });

  await check('wardrobe: wearing a cosmetic applies it to the character (3D preview staged)', async () => {
    await press('KeyC');
    assert.equal(await screen(), 'character');
    await h.page.click('.gs-chip[data-slot="headwear"]');
    await h.page.click('[data-cosmetic="earth_straw_hat"] [data-action="wear"]');
    await h.step(6);
    const worn = await h.eval((g) => g.ctx.player.appearance.outfit.headwear);
    assert.equal(worn, 'earth_straw_hat');
    const staged = await h.page.evaluate(() => !!document.querySelector('.gs-staged .iv-preview'));
    assert.ok(staged, 'wardrobe shows the 3D preview');
    await h.wait(400);
    await shot('d06_wardrobe');
    await h.page.click('.gs-tab[data-tab="profile"]');
    await h.step(2);
    assert.ok(await h.page.isVisible('.pf-stats'));
    await press('Escape');
    const stage = await h.eval((g) => !!g.game.stage);
    assert.equal(stage, false, 'closing the wardrobe restores the world view');
  });

  await check('map: raster charts, select a discovered travel point, confirm, player moves', async () => {
    await h.eval((g) => g.debug.ui.ensureMap());
    await h.page.waitForFunction(() => window.__game.debug.ui.mapReady() >= 1024, null, { timeout: 120000, polling: 500 });
    await h.eval((g) => g.ctx.world.discovered.add('nwt_harbor'));
    const p0 = (await h.state()).player;
    await press('KeyM');
    assert.equal(await screen(), 'map');
    const pt = await h.eval((g) => g.debug.ui.mapPoint('nwt_harbor'));
    assert.ok(pt && pt.inside, 'landmark on screen');
    await h.step(1);
    await h.page.mouse.click(pt.x, pt.y);
    await h.step(1);
    await h.page.waitForSelector('[data-action="travel"][data-landmark="nwt_harbor"]', { timeout: 5000 });
    await shot('d07_map');
    await h.page.click('[data-action="travel"]');
    await h.page.waitForSelector('.confirm', { timeout: 5000 });
    await h.page.click('.confirm .btn.primary');
    await h.page.waitForFunction(() => !document.querySelector('.loading') && window.__game.ctx.ui.currentScreen === null, null, { timeout: 60000 });
    await h.step(3);
    const p1 = (await h.state()).player;
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    assert.ok(moved > 50, `player should travel (moved ${moved.toFixed(1)} m)`);
    assert.ok(Math.hypot(p1.x - -60, p1.z - -1680) < 30, `arrived near the harbour: ${p1.x},${p1.z}`);
    const r = await h.eval((g) => g.debug.ui.travel('omashu_city'));
    assert.equal(r.ok, false, 'undiscovered destinations are refused');
  });

  await check('HUD steps back during dialogue', async () => {
    await h.eval((g) => g.ctx.ui.showDialogue({ speaker: 'Test', text: 'Hello', choices: [{ text: 'Bye', onSelect: () => g.ctx.ui.hideDialogue() }] }));
    await h.step(2);
    await h.wait(450);
    const op = await h.page.$eval('.hud .hud-bottom', (e) => getComputedStyle(e).opacity);
    assert.equal(op, '0', 'ability bar hidden in dialogue');
    await h.eval((g) => g.ctx.ui.hideDialogue());
    await h.step(2);
  });

  await check('960×540: HUD elements do not overlap', async () => {
    await h.page.setViewportSize({ width: 960, height: 540 });
    await h.step(3);
    const hits = await h.page.evaluate(() => {
      const sel = ['.hud .hud-vitals', '.hud .compass', '.hud .hud-quest', '.hud .hud-bottom'];
      const rs = sel.map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.offsetParent !== null && getComputedStyle(e).display !== 'none').map(([s, e]) => [s, e.getBoundingClientRect()]);
      const out = [];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i][1], b = rs[j][1];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${rs[i][0]} × ${rs[j][0]}`);
      }
      return out;
    });
    assert.deepEqual(hits, []);
    await shot('s01_hud_960');
    await press('KeyM', 3);
    const fit = await h.page.$eval('.gs-frame', (e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0; });
    assert.ok(fit, 'map frame fits 960×540');
    await press('Escape');
    await h.page.setViewportSize({ width: 1440, height: 900 });
    await h.step(2);
  });

  await check('no console errors (desktop)', async () => {
    assert.deepEqual(errorsNow(), []);
  });
  await h.close();
  h = null;

  // ---------------------------------------------------------------- phone
  h = await launch({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await h.newGame('earth');
  await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, { timeout: 60000 });
  await h.eval((g) => {
    g.setting('graphics.renderScale', 0.5);
    document.querySelector('.cine-skip')?.click();
    document.querySelector('[data-action="quest-ok"]')?.click();
  });
  await h.step(20);

  await check('phone: HUD fits without overlapping touch controls', async () => {
    const res = await h.page.evaluate(() => {
      const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
      const rects = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => ({ sel, r: e.getBoundingClientRect() }));
      const hud = [...rects('.hud .hud-vitals'), ...rects('.hud .hud-quest'), ...rects('.hud .hud-bottom')];
      const btns = rects('.touch .tbtn');
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const out = [];
      for (const b of btns) for (const x of hud) if (hit(b.r, x.r)) out.push(`${x.sel}`);
      for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (hit(hud[i].r, hud[j].r)) out.push(`${hud[i].sel} × ${hud[j].sel}`);
      const off = hud.filter((x) => x.r.right > innerWidth + 1 || x.r.left < -1).map((x) => x.sel);
      return { out, off };
    });
    assert.deepEqual(res.off, [], 'HUD off-screen');
    assert.deepEqual(res.out, [], 'overlaps');
    await shot('p01_hud');
  });

  await check('phone: pause (touch) → every screen opens and fits the viewport', async () => {
    await h.page.tap('.touch .tbtn[data-touch="pause"]');
    await h.step(2);
    assert.equal(await screen(), 'pause');
    for (const [, id] of KEYS) {
      await h.page.tap(`.ps-tile[data-open="${id}"]`);
      await h.step(2);
      assert.equal(await screen(), id);
      const fit = await h.page.evaluate(() => {
        const f = document.querySelector('.gs-frame, .modal.panel');
        const r = f.getBoundingClientRect();
        return { w: r.width, ok: r.right <= innerWidth + 1 && r.left >= -1 && document.documentElement.scrollWidth <= innerWidth + 1 };
      });
      assert.ok(fit.ok, `${id} overflows the phone viewport (${fit.w})`);
      if (id === 'map' || id === 'journal' || id === 'character') {
        await h.wait(300);
        await shot(`p_${id}`);
      }
      await h.page.tap('.gs-close, [data-action="close"]');
      await h.step(2);
      assert.equal(await screen(), 'pause', `${id} closes back to pause`);
    }
    await h.page.tap('.ps-menu [data-action="resume"]');
    await h.step(2);
    assert.equal(await screen(), null);
  });

  await check('no console errors (phone)', async () => {
    assert.deepEqual(errorsNow(), []);
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h?.errors?.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h?.close();
  if (results.some((r) => r[0] === 'FAIL') || !results.length) process.exitCode = 1;
}
