/**
 * In-game screens & HUD E2E: every screen opens from its key and from the pause
 * menu, each control works (fast travel moves the player and is refused near
 * enemies, equipping changes the slot, a cosmetic applies to the character,
 * eating heals), gamepad navigation, no console errors, no HUD overlap at
 * 960×540 / 1440×900, and a touch phone (landscape 844×390 + portrait 390×844):
 * map drag-pan / pinch-zoom / tap-to-travel, tap-to-equip, tap-to-try-on,
 * finger-scrolling lists, >= 44 px tap targets, HUD clear of the touch controls.
 *
 *   node tests/e2e/ui.e2e.mjs
 *   UI_SHOTS=/some/dir node tests/e2e/ui.e2e.mjs     (screenshots of every screen)
 *   UI_PART=desktop|mobile node tests/e2e/ui.e2e.mjs (run one half)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.UI_SHOTS || '';
const PART = process.env.UI_PART || 'all';
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
    if (SHOTS) await shot(`FAIL_${name.replace(/\W+/g, '_').slice(0, 40)}`);
    // Leave a clean slate so one failure does not cascade into the next checks.
    await h?.eval((g) => {
      document.querySelector('.confirm .btn:last-child')?.click();
      g.ctx.ui.hideDialogue();
      g.ctx.ui.closeAll();
      if (g.game.paused) g.game.setPaused(false);
    }).catch(() => {});
  }
};
/** Screenshot with the real-time loop paused, so software WebGL is not re-rendering while the page is captured. */
const shot = async (name) => {
  if (!SHOTS) return;
  await h.eval((g) => g.game.stop()).catch(() => {});
  // Software WebGL makes frames slow, so CSS animations crawl: settle them before capturing.
  await h.page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
      } catch {}
    }
  }).catch(() => {});
  await h.shot(`${SHOTS}/${name}.png`, { timeout: 45000 }).catch((e) => console.log(`(screenshot ${name} skipped: ${e.message.split('\n')[0]})`));
  await h.eval((g) => g.game.start()).catch(() => {});
};
/** DOM click without Playwright's actionability waits (fast under software rendering). */
const domClick = (sel) => h.page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing ' + sel);
  el.click();
}, sel);
const centerOf = (sel) => h.page.evaluate((sel) => {
  const all = document.querySelectorAll(sel);
  const el = all[all.length - 1];
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, sel);
/** Real mouse click at the element's centre (pointer events, no actionability waits). */
const realClick = async (sel) => {
  const c = await centerOf(sel);
  if (!c) throw new Error('missing ' + sel);
  await h.page.mouse.click(c.x, c.y);
};
/** Real touch tap at the element's centre; waits for the tap's click (gesture taps arrive asynchronously). */
const tap = async (sel, frames = 2) => {
  const c = await centerOf(sel);
  if (!c) throw new Error('missing ' + sel);
  await h.page.evaluate(() => {
    window.__tapped = false;
    window.addEventListener('click', () => (window.__tapped = true), { capture: true, once: true });
  });
  await h.page.touchscreen.tap(c.x, c.y);
  await h.page.waitForFunction(() => window.__tapped, null, { timeout: 2500, polling: 50 }).catch(() => {});
  await h.step(frames);
};
const screen = () => h.eval((g) => g.ctx.ui.currentScreen);
const press = async (key, frames = 2) => {
  await h.page.keyboard.press(key);
  await h.step(frames);
};
const errorsNow = () => h.errors.filter((e) => !/favicon|WebGL|GPU stall|swiftshader/i.test(e));
const skipIntro = () => h.eval((g) => {
  g.ctx.ui.closeAll?.();
  document.querySelector('.cine-skip')?.click();
  document.querySelector('[data-action="quest-ok"]')?.click();
});
/** Visible interactive elements of the top-most in-game screen smaller than 44 px. */
const smallTargets = () => h.page.evaluate(() => {
  const roots = document.querySelectorAll('.gs-frame, .ps-menu');
  const root = roots[roots.length - 1];
  if (!root) return ['no screen'];
  // Measure the settled layout, not the opening animation's scale.
  for (const a of root.getAnimations({ subtree: true })) {
    try {
      a.finish();
    } catch {}
  }
  const out = [];
  for (const el of root.querySelectorAll('button, summary, [role="tab"]')) {
    if (el.offsetParent === null || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || '').trim().slice(0, 16)}"`);
  }
  return out;
});
/** HUD blocks vs. visible touch buttons: overlaps and anything off-screen. */
const hudVsTouch = () => h.page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && !e.classList.contains('gone') && !e.classList.contains('gone-layout');
  const rects = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => ({ sel: sel + (e.dataset.touch ? `[${e.dataset.touch}]` : ''), r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0);
  const hud = [...rects('.hud .hud-vitals'), ...rects('.hud .hud-quest'), ...rects('.hud .hud-bottom')];
  const btns = rects('.touch .tbtn');
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const out = [];
  for (const b of btns) for (const x of hud) if (hit(b.r, x.r)) out.push(`${x.sel} × ${b.sel}`);
  for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (hit(hud[i].r, hud[j].r)) out.push(`${hud[i].sel} × ${hud[j].sel}`);
  const off = [...hud, ...btns].filter((x) => x.r.right > innerWidth + 1 || x.r.left < -1 || x.r.top < -1 || x.r.bottom > innerHeight + 1).map((x) => x.sel);
  return { out, off, btns: btns.length };
});

const KEYS = [
  ['KeyM', 'map'],
  ['KeyJ', 'journal'],
  ['KeyK', 'techniques'],
  ['KeyI', 'inventory'],
  ['KeyC', 'character'],
  ['KeyP', 'companions'],
];

try {
  if (PART !== 'mobile') {
    // ---------------------------------------------------------------- desktop
    h = await launch({ width: 1440, height: 900 });
    await h.newGame('water');
    await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, { timeout: 90000 });
    await skipIntro();
    await h.eval((g) => {
      g.setting('graphics.renderScale', 0.4);
      g.debug.ui.learnSome('water', 3);
      g.debug.ui.ensureMap();
    });
    await h.step(20);

    await check('HUD: vitals, medallion, ability bar, compass and quest tracker render', async () => {
      const hud = await h.page.evaluate(() => ({
        medal: !!document.querySelector('.hud .hud-medal svg'),
        slots: document.querySelectorAll('.hud .slots .slot').length,
        named: [...document.querySelectorAll('.hud .slots .slot .name')].filter((n) => n.textContent && n.textContent !== '—').length,
        drops: document.querySelectorAll('.hud .hud-drops .drop').length,
        compass: document.querySelectorAll('.hud > .compass .tick').length,
        hp: document.querySelector('.hud .bar.hp .fill')?.style.transform,
      }));
      assert.ok(hud.medal, 'no element medallion');
      assert.equal(hud.slots, 4, 'expected 4 ability slots');
      assert.ok(hud.named >= 2, 'slots show technique names');
      assert.equal(hud.drops, 6, 'water reserve droplets for a waterbender');
      assert.ok(hud.compass >= 3, 'compass ticks (top centre without touch)');
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

    await check('pause menu: shortcuts open each screen and return to the menu; save/load/settings; exit asks', async () => {
      await press('Escape');
      assert.equal(await screen(), 'pause');
      for (const [, id] of KEYS) {
        await realClick(`.ps-tile[data-open="${id}"]`);
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
      await realClick('.ps-menu [data-action="exit"]');
      await h.step(1);
      assert.ok(await h.page.isVisible('.confirm'), 'exit asks for confirmation');
      assert.ok((await h.page.textContent('.confirm')).includes('Save & Exit'), 'exit offers save');
      await domClick('.confirm .btn:last-child');
      await realClick('.ps-menu [data-action="resume"]');
      await h.step(1);
      const st = await h.state();
      assert.equal(st.paused, false);
      assert.equal(st.ui.screen, null);
    });

    await check('journal: quest tabs, detail with objectives, tracking toggles; masters, mastery, bestiary, lore', async () => {
      await press('KeyJ');
      assert.equal(await screen(), 'journal');
      const n = await h.page.locator('.jr-q').count();
      assert.ok(n >= 1, 'at least one quest listed');
      const before = await h.eval((g) => g.ctx.quests.tracked);
      await realClick('.jr-q');
      await realClick('[data-action="track"]');
      const after = await h.eval((g) => g.ctx.quests.tracked);
      assert.notEqual(after, before, 'track button changes the tracked quest');
      await realClick('[data-action="track"]');
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
      const pt = async (i) => {
        await h.page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i);
        await h.step(1);
        await h.page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i);
        await h.step(1);
      };
      await press('KeyJ');
      const t0 = await h.page.getAttribute('.gs-tab.active', 'data-tab');
      await pt(5);
      const t1 = await h.page.getAttribute('.gs-tab.active', 'data-tab');
      assert.notEqual(t1, t0, 'RB changed tab');
      await pt(13);
      const focused = await h.page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.gs-frame'));
      assert.ok(focused, 'D-pad moved focus into the screen');
      await pt(1);
      assert.equal(await screen(), null, 'B closed the screen');
      await h.page.evaluate(() => (navigator.getGamepads = () => []));
    });

    await check('techniques: click-to-assign changes the slot (and the HUD); keyboard 1–4; every element tab', async () => {
      await press('KeyK');
      assert.equal(await screen(), 'techniques');
      const el = await h.eval((g) => g.ctx.player.element);
      const before = await h.eval((g, e) => g.ctx.progression.slotsFor(e), el);
      const cand = await h.page.$$eval('.tq-card[draggable="true"]', (cs) => cs.map((c) => c.dataset.tech));
      assert.ok(cand.length >= 2, 'need two equippable techniques, got ' + cand.length);
      const pick = cand.find((id) => id !== before[0]) ?? cand[0];
      await realClick(`.tq-card[data-tech="${pick}"] [data-action="equip"]`);
      await realClick('.tq-slot[data-slot="0"]');
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
      await realClick('[data-cat="food"]');
      await realClick('.iv-item[data-item="cabbage"]');
      const hp0 = (await h.state()).player.hp;
      await realClick('[data-action="eat"]');
      const st = await h.state();
      assert.ok(st.player.hp >= hp0 + 14.9, `eating should heal: ${hp0} → ${st.player.hp}`);
      assert.equal(st.inventory.items.cabbage, 1, 'one cabbage eaten');
      await realClick('[data-cat="consumable"]');
      await realClick('.iv-item[data-item="healing_herbs"]');
      await realClick('[data-action="use"]');
      const st2 = await h.state();
      assert.ok(st2.player.hp > st.player.hp, 'herbs heal');
      await realClick('[data-cat="all"]');
      await shot('d05_inventory');
      await press('Escape');
    });

    await check('wardrobe: wearing a cosmetic applies it to the character (3D preview staged)', async () => {
      await press('KeyC');
      assert.equal(await screen(), 'character');
      await realClick('.gs-chip[data-slot="headwear"]');
      await realClick('[data-cosmetic="earth_straw_hat"] [data-action="wear"]');
      await h.step(6);
      const worn = await h.eval((g) => g.ctx.player.appearance.outfit.headwear);
      assert.equal(worn, 'earth_straw_hat');
      const staged = await h.page.evaluate(() => !!document.querySelector('.gs-staged .iv-preview'));
      assert.ok(staged, 'wardrobe shows the 3D preview');
      await shot('d06_wardrobe');
      await realClick('.gs-tab[data-tab="profile"]');
      await h.step(2);
      assert.ok(await h.page.isVisible('.pf-stats'));
      await press('Escape');
      const stage = await h.eval((g) => !!g.game.stage);
      assert.equal(stage, false, 'closing the wardrobe restores the world view');
    });

    await check('map: raster charts, select a travel point, confirm, player moves; refused undiscovered / near enemies', async () => {
      await h.page.waitForFunction(() => window.__game.debug.ui.mapReady() >= 1024, null, { timeout: 180000, polling: 1000 });
      await h.eval((g) => g.ctx.world.discovered.add('nwt_harbor'));
      // Never while enemies are near.
      const arch = await h.eval((g) => g.debug.enemies?.archetypes?.()[0] ?? null);
      if (arch) {
        const spawned = await h.eval((g, a) => g.debug.enemies.spawn(a, 12), arch);
        assert.ok(spawned, 'enemy spawned');
        await h.step(2); // spatial grid rebuilds each frame
        const r = await h.eval((g) => g.debug.ui.travel('nwt_harbor'));
        assert.equal(r.ok, false, 'travel must be refused near enemies');
        assert.match(r.reason, /enem/i);
        await h.eval((g) => g.debug.enemies.killAll());
        await h.step(2);
        // The helper opened/closed the map from script (no user gesture): make sure play resumed cleanly.
        await h.eval((g) => {
          g.ctx.ui.closeAll();
          if (g.game.paused) g.game.setPaused(false);
        });
        await h.step(2);
      }
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
      await realClick('[data-action="travel"]');
      await h.page.waitForSelector('.confirm', { timeout: 5000 });
      await realClick('.confirm .btn.primary');
      await h.page.waitForFunction(() => !document.querySelector('.loading') && window.__game.ctx.ui.currentScreen === null, null, { timeout: 90000 });
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
      assert.ok(await h.page.evaluate(() => document.querySelector('.hud').classList.contains('in-dialogue')), 'HUD marked in-dialogue');
      // Opacity transitions run on the browser clock: poll instead of a fixed wait.
      await h.page.waitForFunction(() => getComputedStyle(document.querySelector('.hud .hud-bottom')).opacity === '0', null, { timeout: 15000, polling: 200 });
      await h.eval((g) => g.ctx.ui.hideDialogue());
      await h.step(2);
    });

    await check('960×540: HUD elements do not overlap; the map fits', async () => {
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
      // Headless pointer lock can drop after the dialogue closes, which (by design) opens the pause menu.
      await h.eval((g) => {
        g.ctx.ui.closeAll();
        if (g.game.paused) g.game.setPaused(false);
      });
      await h.step(1);
      await press('KeyM', 3);
      assert.equal(await screen(), 'map');
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
  }

  if (PART !== 'desktop') {
    // ---------------------------------------------------------------- touch phone, landscape first
    h = await launch({ width: 844, height: 390, hasTouch: true, isMobile: true });
    await h.newGame('earth');
    await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, { timeout: 90000 });
    await skipIntro();
    await h.eval((g) => {
      g.setting('graphics.renderScale', 0.5);
      g.debug.ui.learnSome('earth', 3);
      g.debug.ui.ensureMap();
    });
    await h.step(20);
    const cdp = await h.page.context().newCDPSession(h.page);
    const tp = (x, y, id) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 4, radiusY: 4, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const swipe = async (x0, y0, x1, y1, steps = 6) => {
      await touch('touchStart', [tp(x0, y0, 0)]);
      for (let i = 1; i <= steps; i++) await touch('touchMove', [tp(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, 0)]);
      await touch('touchEnd', []);
    };
    const pinch = async (cx, cy, d0, d1, steps = 6) => {
      await touch('touchStart', [tp(cx - d0 / 2, cy, 0), tp(cx + d0 / 2, cy, 1)]);
      for (let i = 1; i <= steps; i++) {
        const d = d0 + ((d1 - d0) * i) / steps;
        await touch('touchMove', [tp(cx - d / 2, cy, 0), tp(cx + d / 2, cy, 1)]);
      }
      await touch('touchEnd', []);
    };
    const openFromPause = async (id) => {
      if ((await screen()) !== 'pause') {
        await tap('.touch .tbtn[data-touch="pause"]', 2);
        assert.equal(await screen(), 'pause', 'touch MENU opens the pause menu');
      }
      await tap(`.ps-tile[data-open="${id}"]`);
      assert.equal(await screen(), id, `tile → ${id}`);
    };
    const closeByTap = async (to = 'pause') => {
      await tap('.gs-close');
      assert.equal(await screen(), to, 'close button returns');
    };

    await check('landscape: HUD compact, compass docked in the quest block, clear of the touch buttons', async () => {
      await h.step(6);
      const ui = await h.page.evaluate(() => ({
        touchOn: document.getElementById('ui').classList.contains('touch-on'),
        docked: (document.querySelector('.hud .hud-quest .compass.docked')?.getBoundingClientRect().height ?? 0) > 10,
        ticks: document.querySelectorAll('.hud .hud-quest .compass .tick').length,
        bar: getComputedStyle(document.querySelector('.hud .hud-bottom')).display,
      }));
      assert.ok(ui.touchOn, 'touch controls shown on a touch phone');
      assert.ok(ui.docked && ui.ticks >= 3, `compass docked with ticks (${ui.ticks})`);
      assert.equal(ui.bar, 'none', 'the touch arc owns the technique buttons');
      const r = await hudVsTouch();
      assert.ok(r.btns >= 8, 'touch buttons visible');
      assert.deepEqual(r.off, [], 'HUD/buttons off-screen');
      assert.deepEqual(r.out, [], 'overlaps');
      await shot('l01_hud');
    });

    await check('landscape: map by touch — one-finger pan, pinch zoom, tap to select, tap Travel + confirm moves the player', async () => {
      await tap('.touch .tbtn[data-touch="map"]', 3);
      assert.equal(await screen(), 'map', 'touch MAP button opens the map');
      assert.deepEqual(await smallTargets(), [], 'map tap targets >= 44 px');
      const c = await centerOf('.mp-canvas');
      assert.ok(c.h > 200 && c.w > 400, `map canvas uses the landscape screen (${Math.round(c.w)}×${Math.round(c.h)})`);
      const v0 = await h.eval((g) => g.debug.ui.mapView());
      await pinch(c.x, c.y, 60, 200);
      const v1 = await h.eval((g) => g.debug.ui.mapView());
      assert.ok(v1.zoom > v0.zoom * 1.6, `pinch out zooms in: ${v0.zoom.toFixed(2)} → ${v1.zoom.toFixed(2)}`);
      // Finger left + down: the view moves east (+x) and north (−z).
      await swipe(c.x + 80, c.y - 20, c.x - 80, c.y + 30);
      const v2 = await h.eval((g) => g.debug.ui.mapView());
      assert.ok(v2.cx > v1.cx + 5 && v2.cz < v1.cz - 5, `one-finger drag pans the map: ${JSON.stringify(v1)} → ${JSON.stringify(v2)}`);
      await pinch(c.x, c.y, 200, 100);
      const v3 = await h.eval((g) => g.debug.ui.mapView());
      assert.ok(v3.zoom < v2.zoom * 0.8, `pinch in zooms out: ${v2.zoom.toFixed(2)} → ${v3.zoom.toFixed(2)}`);
      // Tap a discovered travel point near the player.
      const pts = await h.eval((g) => g.debug.ui.travelPoints());
      const dest = pts.filter((p) => p.dist > 80).sort((a, b) => a.dist - b.dist)[0];
      assert.ok(dest, 'a travel point to go to');
      await h.eval((g, id) => g.ctx.world.discovered.add(id), dest.id);
      const p0 = (await h.state()).player;
      const pt = await h.eval((g, id) => g.debug.ui.mapPoint(id), dest.id);
      assert.ok(pt && pt.inside, 'destination on screen');
      await h.step(1);
      await h.page.touchscreen.tap(pt.x, pt.y);
      await h.step(1);
      await h.page.waitForSelector(`[data-action="travel"][data-landmark="${dest.id}"]`, { timeout: 5000 });
      assert.equal((await h.eval((g) => g.debug.ui.mapView())).selected, dest.id, 'tap selected the place');
      await h.page.waitForFunction(() => window.__game.debug.ui.mapReady() >= 256, null, { timeout: 120000, polling: 1000 }).catch(() => {});
      await h.step(1);
      await shot('l02_map');
      await tap('[data-action="travel"]', 1);
      await h.page.waitForSelector('.confirm', { timeout: 5000 });
      await tap('.confirm .btn.primary', 1);
      await h.page.waitForFunction(() => !document.querySelector('.loading') && window.__game.ctx.ui.currentScreen === null, null, { timeout: 90000 });
      await h.step(3);
      const p1 = (await h.state()).player;
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      assert.ok(moved > 50, `fast travel by touch moves the player (${moved.toFixed(1)} m to ${dest.id})`);
    });

    await check('landscape: techniques by tap — Equip then a slot, or a slot then a technique', async () => {
      await openFromPause('techniques');
      assert.deepEqual(await smallTargets(), [], 'technique tap targets >= 44 px');
      const before = await h.eval((g) => g.ctx.progression.slotsFor('earth'));
      const cand = await h.page.$$eval('.tq-card[draggable="true"]', (cs) => cs.map((c) => c.dataset.tech));
      assert.ok(cand.length >= 3, 'equippable earth techniques: ' + cand.length);
      const a = cand.find((id) => !before.includes(id)) ?? cand[1];
      await tap(`.tq-card[data-tech="${a}"] [data-action="equip"]`, 1);
      await tap('.tq-slot[data-slot="1"]', 1);
      const s1 = await h.eval((g) => g.ctx.progression.slotsFor('earth'));
      assert.equal(s1[1], a, `tap Equip → tap slot 2 assigns ${a}: ${JSON.stringify(s1)}`);
      const b = cand.find((id) => id !== a && !s1.includes(id)) ?? cand.find((id) => id !== a);
      await tap('.tq-slot[data-slot="2"]', 1);
      await tap(`.tq-card[data-tech="${b}"] h4`, 1);
      const s2 = await h.eval((g) => g.ctx.progression.slotsFor('earth'));
      assert.equal(s2[2], b, `tap slot 3 → tap card assigns ${b}: ${JSON.stringify(s2)}`);
      await shot('l03_techniques');
      await closeByTap();
    });

    await check('landscape: inventory — tap a food item, tap Eat heals', async () => {
      await h.eval((g) => {
        g.ctx.inventory.add('cabbage', 2, true);
        g.ctx.player.health.hp = Math.max(1, g.ctx.player.health.maxHp - 50);
      });
      await openFromPause('inventory');
      await tap('[data-cat="food"]', 1);
      await tap('.iv-item[data-item="cabbage"]', 1);
      const hp0 = (await h.state()).player.hp;
      await tap('[data-action="eat"]', 1);
      const hp1 = (await h.state()).player.hp;
      assert.ok(hp1 >= hp0 + 14.9, `eat heals: ${hp0} → ${hp1}`);
      assert.deepEqual(await smallTargets(), [], 'inventory tap targets >= 44 px');
      await closeByTap();
    });

    await check('landscape: wardrobe — drag turns the preview, tap previews a cosmetic, Wear applies it', async () => {
      await openFromPause('character');
      await h.step(3);
      const y0 = await h.eval((g) => g.debug.ui.previewYaw());
      assert.ok(y0 !== null, '3D preview staged');
      const pv = await centerOf('.iv-preview');
      await swipe(pv.x - 50, pv.y, pv.x + 60, pv.y);
      await h.step(8);
      const y1 = await h.eval((g) => g.debug.ui.previewYaw());
      assert.ok(Math.abs(y1 - y0) > 0.3, `finger drag turns the preview: ${y0} → ${y1}`);
      await tap('.gs-chip[data-slot="headwear"]', 1);
      const id = await h.page.$eval('.wd-card:not(.locked):not(.equipped)', (e) => e.dataset.cosmetic);
      // The card list scrolls on a landscape phone: bring the card into view like a player would.
      await h.page.$eval(`.wd-card[data-cosmetic="${id}"]`, (e) => e.scrollIntoView({ block: 'center' }));
      await h.step(2);
      await tap(`.wd-card[data-cosmetic="${id}"] h4`, 1);
      // Gesture taps can land late under software rendering: poll for the preview state.
      const ok = await h.page.waitForFunction((id) => document.querySelector(`.wd-card[data-cosmetic="${id}"]`)?.classList.contains('trying'), id, { timeout: 8000, polling: 100 }).then(() => true, () => false);
      const cls = await h.page.$eval(`.wd-card[data-cosmetic="${id}"]`, (e) => e.className);
      assert.ok(ok, `tapped card is previewed (${id}: ${cls})`);
      assert.notEqual(await h.eval((g) => g.ctx.player.appearance.outfit.headwear), id, 'a preview does not change the outfit');
      await tap(`.wd-card[data-cosmetic="${id}"] [data-action="wear"]`, 3);
      assert.equal(await h.eval((g) => g.ctx.player.appearance.outfit.headwear), id, 'Wear applies the cosmetic');
      assert.deepEqual(await smallTargets(), [], 'wardrobe tap targets >= 44 px');
      await shot('l04_wardrobe');
      await closeByTap();
    });

    await check('landscape: journal lists scroll with a finger; pause menu fits and resumes', async () => {
      await openFromPause('journal');
      await tap('.gs-tab[data-tab="mastery"]', 1);
      const sc = await centerOf('.gs-body .gs-scroll');
      const top0 = await h.page.$eval('.gs-body .gs-scroll', (e) => e.scrollTop);
      await swipe(sc.x, sc.y + 60, sc.x, sc.y - 100, 8);
      await h.wait(300);
      const top1 = await h.page.$eval('.gs-body .gs-scroll', (e) => e.scrollTop);
      assert.ok(top1 > top0 + 20, `finger scroll moves the list: ${top0} → ${top1}`);
      assert.deepEqual(await smallTargets(), [], 'journal tap targets >= 44 px');
      await shot('l05_journal');
      await closeByTap();
      const fit = await h.page.$eval('.ps-menu', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; });
      assert.ok(fit, 'pause menu fits the landscape screen (it scrolls inside)');
      assert.deepEqual(await smallTargets(), [], 'pause tap targets >= 44 px');
      await tap('.ps-menu [data-action="resume"]');
      assert.equal(await screen(), null, 'resume by tap');
    });

    // ---------------------------------------------------------------- portrait
    await check('portrait: HUD fits without overlapping touch controls', async () => {
      await h.page.setViewportSize({ width: 390, height: 844 });
      // The touch layout re-flows on a short real-time throttle.
      await h.wait(900);
      await h.step(4);
      // Landscape is the intended orientation: portrait first offers a rotate card that can be dismissed.
      await h.page.waitForFunction(() => window.__game.ctx.ui.isOpen('rotateHint'), null, { timeout: 5000 }).catch(() => {});
      if ((await screen()) === 'rotateHint') {
        await tap('[data-action="rotate-dismiss"]', 4);
        assert.equal(await screen(), null, 'rotate card dismissed');
      }
      await h.wait(900);
      await h.step(4);
      const r = await hudVsTouch();
      assert.deepEqual(r.off, [], 'HUD/buttons off-screen');
      assert.deepEqual(r.out, [], 'overlaps');
      await shot('p01_hud');
    });

    await check('portrait: pause (touch) → every screen opens, fits, has 44 px targets and closes by tap', async () => {
      await tap('.touch .tbtn[data-touch="pause"]', 2);
      assert.equal(await screen(), 'pause');
      for (const [, id] of KEYS) {
        await tap(`.ps-tile[data-open="${id}"]`);
        assert.equal(await screen(), id);
        const fit = await h.page.evaluate(() => {
          const all = document.querySelectorAll('.gs-frame, .modal.panel');
          const f = all[all.length - 1];
          const r = f.getBoundingClientRect();
          return { w: r.width, ok: r.right <= innerWidth + 1 && r.left >= -1 && document.documentElement.scrollWidth <= innerWidth + 1 };
        });
        assert.ok(fit.ok, `${id} overflows the phone viewport (${fit.w})`);
        if (id !== 'companions') assert.deepEqual(await smallTargets(), [], `${id} tap targets >= 44 px`);
        if (SHOTS && id !== 'companions') {
          await h.step(2);
          await shot(`p_${id}`);
        }
        await tap('.gs-close, .modal.panel [data-action="close"]');
        assert.equal(await screen(), 'pause', `${id} closes back to pause`);
      }
      await tap('.ps-menu [data-action="resume"]');
      assert.equal(await screen(), null);
    });

    await check('no console errors (touch phone)', async () => {
      assert.deepEqual(errorsNow(), []);
    });
  }
} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h?.errors?.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h?.close();
  if (results.some((r) => r[0] === 'FAIL') || !results.length) process.exitCode = 1;
}
