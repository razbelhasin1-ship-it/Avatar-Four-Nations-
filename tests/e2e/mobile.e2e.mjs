/**
 * Mobile E2E (phones / tablets are a hard requirement): a fresh phone (mobile UA,
 * touch, isMobile, no saved settings) goes through the whole first-time flow by
 * touch only — portrait 390×844 menus → creator (touch slider + chips) → Begin →
 * rotate card → landscape 844×390 play: stick move + drag look at the same time,
 * attack, technique, jump, interact with an NPC through the prompt pill, Draw
 * Water lighting up near a lake, element switch, map pinch-zoom, pause menu,
 * settings, every journal screen in both orientations — plus mobile-safe graphics
 * defaults, first-tap audio unlock, fullscreen toggle and a perf readout at the
 * four capitals.
 *
 * Run: node tests/e2e/mobile.e2e.mjs        (SHOT_DIR=/path to save screenshots)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const LONG = { timeout: 240000 };
const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    const lines = e.message.split('\n');
    const where = lines.find((l) => /waiting for|locator|selector/.test(l)) ?? '';
    results.push(['FAIL', name, lines[0] + (where ? ` [${where.trim()}]` : '')]);
  }
};

const h = await launch({ width: 390, height: 844, hasTouch: true, isMobile: true, preset: null, userAgent: UA });
const page = h.page;
const cdp = await page.context().newCDPSession(page);
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

async function shot(name) {
  if (!SHOT_DIR) return;
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity || (a.currentTime ?? 0) > 2000), null, { timeout: 6000 }).catch(() => {});
  await page.screenshot({ path: `${SHOT_DIR}/mobile_${name}.png`, timeout: 90000 }).catch((e) => console.log(`[shot] ${name} skipped: ${e.message.split('\n')[0]}`));
}

/** Layout audit: horizontal page overflow, visible buttons off-screen or under 44 px, clipped captions. */
const audit = (sel = 'button, .btn, .tbtn') =>
  page.evaluate((sel) => {
    const W = innerWidth, H = innerHeight;
    const vis = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    const els = [...document.querySelectorAll(sel)].filter(vis);
    // Only count buttons inside the screen's own scroll container as off-screen when they cannot be scrolled to.
    const scrollable = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2)) return true; } return false; };
    const off = els.filter((e) => { const r = e.getBoundingClientRect(); return (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) && !scrollable(e); }).map((e) => (e.dataset.action || e.dataset.touch || e.textContent.trim()).slice(0, 24));
    const small = els.filter((e) => e.matches('.tbtn, .menu-btn, [data-action="confirm-journey"], .ps-btn')).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((e) => e.dataset.touch || e.dataset.action || e.textContent.trim().slice(0, 20));
    const clipped = [...document.querySelectorAll('.tbtn .tc, .menu-btn-label')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
    return { overflowX: document.documentElement.scrollWidth - W, off, small, clipped };
  }, sel);

/** Visible touch buttons + HUD bars, and every pairwise overlap. */
const touchLayout = () =>
  page.evaluate(() => {
    const btns = window.__game.debug.touch.buttons();
    const hud = [...document.querySelectorAll('.hud .hud-vitals, .hud .hud-quest')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { action: e.className, x: r.left, y: r.top, w: r.width, h: r.height }; });
    const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
    const overlaps = [];
    for (const b of btns) for (const x of hud) if (hit(b, x)) overlaps.push(`${b.action} × ${x.action}`);
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (hit(btns[i], btns[j])) overlaps.push(`${btns[i].action} × ${btns[j].action}`);
    const off = btns.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > innerWidth || b.y + b.h > innerHeight).map((b) => b.action);
    return { actions: btns.map((b) => b.action), btns, overlaps, off, small: btns.filter((b) => b.w < 44 || b.h < 44).map((b) => b.action) };
  });

const center = async (sel) => {
  const b = await (await page.$(sel)).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })) });
const tapAt = (p) => page.touchscreen.tap(p.x, p.y);
const tapTouch = async (action) => tapAt(await center(`.touch .tbtn[data-touch="${action}"]`));

try {
  await check('first launch on a phone: mobile-safe graphics defaults, exposed in state()', async () => {
    const st = await h.state();
    assert.equal(st.device.mobile, true, JSON.stringify(st.device));
    assert.equal(st.device.mobileDefaults, true);
    const g = await h.eval((g) => g.ctx.settings.data.graphics);
    assert.equal(g.preset, 'low');
    assert.ok(g.renderScale <= 0.72 && g.renderScale >= 0.65, 'render scale ' + g.renderScale);
    assert.ok(g.maxPixelRatio <= 1.5);
    assert.equal(g.postProcessing, false);
    assert.equal(g.bloom, false);
    assert.ok(g.drawDistance <= 420, 'draw distance ' + g.drawDistance);
    assert.ok(g.foliageDensity <= 0.5 && g.grassDensity <= 0.2);
    assert.ok(Math.abs((await h.eval((g) => g.ctx.render.renderer.getPixelRatio())) - 0.7) < 0.01, 'renderer pixel ratio follows the mobile defaults');
    assert.equal(await h.eval((g) => !!g.ctx.render.composer), false, 'no post-processing composer');
    // Persisted, so the next launch keeps them (and the player can change everything in Settings).
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('a4n.settings')).graphics.renderScale), g.renderScale);
    await h.eval((g) => g.setting('audio.muted', true));
  });

  await check('portrait menu: first tap unlocks audio, four choices fit, fullscreen toggle', async () => {
    await h.eval((g) => g.debug.menu.hold(true));
    assert.equal(await h.eval((g) => g.ctx.audio.unlocked), false, 'audio must wait for a gesture');
    const a = await audit('.main-menu button');
    assert.ok(a.overflowX <= 0 && !a.off.length && !a.small.length && !a.clipped.length, JSON.stringify(a));
    await page.tap('[data-action="enter"]');
    assert.equal(await h.eval((g) => g.ctx.audio.unlocked), true, 'first tap should unlock audio');
    await page.tap('[data-action="back"]');
    const fsSupported = await page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
    assert.equal(await page.isVisible('.main-menu [data-action="fullscreen"]'), fsSupported, 'fullscreen toggle follows API support');
    if (fsSupported) {
      await page.tap('.main-menu [data-action="fullscreen"]');
      await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).catch(() => {});
      const on = await page.evaluate(() => !!document.fullscreenElement);
      if (on) {
        assert.match(await page.textContent('.main-menu [data-action="fullscreen"]'), /Exit Fullscreen/);
        await page.tap('.main-menu [data-action="fullscreen"]');
        await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
      }
    }
    await shot('01_menu_portrait');
  });

  await check('portrait settings: touch section (size, opacity, sensitivity, left-handed) persists', async () => {
    await page.tap('[data-action="settings"]');
    await page.waitForSelector('.settings-panel');
    await page.tap('[data-tab="controls"]');
    for (const k of ['touchControls', 'touchSensitivity', 'touchButtonSize', 'touchOpacity', 'touchLeftHanded']) assert.ok(await page.$(`[data-setting="controls.${k}"]`), `missing ${k}`);
    await page.$eval('input[data-setting="controls.touchButtonSize"]', (el) => { el.value = '1.2'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.$eval('input[data-setting="controls.touchOpacity"]', (el) => { el.value = '0.7'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.locator('[data-setting="controls.touchLeftHanded"]').scrollIntoViewIfNeeded();
    await page.tap('[data-setting="controls.touchLeftHanded"]');
    const c = await h.eval((g) => g.ctx.settings.data.controls);
    assert.equal(c.touchButtonSize, 1.2);
    assert.equal(c.touchOpacity, 0.7);
    assert.equal(c.touchLeftHanded, true);
    const a = await audit('.settings-panel button, .settings-panel input');
    assert.ok(a.overflowX <= 0 && !a.off.length, JSON.stringify(a));
    await shot('02_settings_touch_portrait');
    await page.tap('[data-action="close-settings"]');
  });

  await check('portrait: New Journey → element → creator by touch → preview', async () => {
    await page.tap('[data-action="enter"]');
    await page.tap('[data-action="new"]');
    await page.waitForSelector('.element-card');
    assert.ok((await audit('.element-select button')).overflowX <= 0);
    await page.tap('.element-card[data-element="fire"]');
    await page.waitForSelector('.ngf-mobile [data-action="creator-continue"]');
    const c = (fn) => h.eval((g, src) => new Function('return (' + src + ')')()(g.debug.creator), fn.toString());
    await c((x) => x.flush());
    const g0 = await c((x) => x.geomHash());
    // Drag the build slider with real touch events.
    await page.tap('[data-tab="body"]');
    const box = await (await page.$('input[data-opt="build"]')).boundingBox();
    const y = box.y + box.height / 2;
    await touch('touchStart', [{ x: box.x + box.width * 0.5, y }]);
    await touch('touchMove', [{ x: box.x + box.width * 0.8, y }]);
    await touch('touchMove', [{ x: box.x + box.width * 0.97, y }]);
    await touch('touchEnd', []);
    assert.ok((await c((x) => x.state().appearance.build)) > 0.7, 'touch drag did not move the build slider');
    await page.tap('[data-tab="hair"]');
    await page.tap('[data-opt="hair:topknot_crown"]');
    await c((x) => x.flush());
    assert.notEqual(await c((x) => x.geomHash()), g0, 'creator preview did not change');
    // The name field takes the on-screen keyboard.
    await page.tap('input[data-field="name"]');
    await page.fill('input[data-field="name"]', 'Azula');
    await page.evaluate(() => document.activeElement?.blur());
    await shot('03_creator_portrait');
    await page.tap('.ngf-mobile [data-action="creator-continue"]');
    await page.waitForSelector('[data-action="confirm-journey"]');
    assert.ok(!(await audit('[data-action="confirm-journey"]')).off.length, 'Begin Journey off-screen');
  });

  await check('Begin → portrait play pauses with a rotate card → turning the phone resumes in landscape', async () => {
    await page.tap('[data-action="confirm-journey"]');
    await page.waitForFunction(() => window.__game.state().mode === 'play', null, LONG);
    await page.waitForSelector('.rotate-hint', { timeout: 15000 });
    const st = await h.state();
    assert.equal(st.ui.screen, 'rotateHint');
    assert.equal(st.paused || (await h.eval((g) => g.ctx.ui.freezesSim)), true, 'the rotate card should freeze play');
    await shot('04_rotate_hint');
    await page.setViewportSize(LANDSCAPE);
    await page.waitForFunction(() => !document.querySelector('.rotate-hint'), null, { timeout: 15000 });
    assert.notEqual((await h.state()).ui.screen, 'rotateHint');
    if (await page.isVisible('[data-action="skip-arrival"]')) await page.tap('[data-action="skip-arrival"]');
    await page.waitForSelector('.quest-prompt', { timeout: 30000 });
    assert.doesNotMatch(await page.textContent('.quest-prompt'), /compass/, 'touch players get touch hints');
    await page.tap('[data-action="quest-ok"]');
    await h.step(4);
    assert.equal((await h.state()).player.name, 'Azula');
  });

  await check('landscape: touch controls cover every action, >= 44 px, no overlaps, mirrored for left hands', async () => {
    const L = await touchLayout();
    for (const a of ['attack', 'aim', 'jump', 'dodge', 'ability1', 'ability2', 'ability3', 'ability4', 'sprint', 'interact', 'pause', 'map', 'avatarState', 'companion', 'lockOn']) assert.ok(L.actions.includes(a), `missing touch button: ${a}`);
    assert.deepEqual(L.overlaps, [], 'overlaps: ' + L.overlaps.join('; '));
    assert.deepEqual(L.off, []);
    assert.deepEqual(L.small, []);
    const atk = L.btns.find((b) => b.action === 'attack');
    assert.ok(atk.x < 844 / 2, 'left-handed: ATTACK should sit on the left');
    assert.deepEqual((await audit('.touch .tbtn')).clipped, []);
    await shot('05_play_lefthanded');
    // Back to the default right-handed layout, normal size.
    await h.eval((g) => { g.setting('controls.touchLeftHanded', false); g.setting('controls.touchButtonSize', 1); });
    await h.step(2);
    const R = await touchLayout();
    assert.ok(R.btns.find((b) => b.action === 'attack').x > 844 / 2, 'right-handed: ATTACK on the right');
    assert.deepEqual(R.overlaps, [], 'overlaps: ' + R.overlaps.join('; '));
    const op = await page.$eval('.touch .tbtn[data-touch="jump"]', (e) => getComputedStyle(e).opacity);
    assert.ok(Math.abs(Number(op) - 0.7) < 0.02, 'button opacity setting applies: ' + op);
  });

  await check('landscape: move with the stick while dragging to look (multi-touch)', async () => {
    const p0 = await h.state();
    const yaw0 = await h.eval((g) => g.game.cameraRig.yaw);
    const s = { x: 120, y: 300 }, l = { x: 560, y: 160 };
    await touch('touchStart', [{ ...s, id: 1 }]);
    await touch('touchStart', [{ ...s, id: 1 }, { ...l, id: 2 }]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [{ x: s.x, y: s.y - 9 * i, id: 1 }, { x: l.x + 14 * i, y: l.y, id: 2 }]);
      await h.step(4);
    }
    const moving = await h.eval((g) => ({ x: g.ctx.input.move.x, y: g.ctx.input.move.y }));
    await h.step(20);
    await touch('touchEnd', []);
    await h.step(2);
    const p1 = await h.state();
    const yaw1 = await h.eval((g) => g.game.cameraRig.yaw);
    assert.ok(moving.y > 0.5, 'stick should push forward: ' + JSON.stringify(moving));
    assert.ok(Math.hypot(p1.player.x - p0.player.x, p1.player.z - p0.player.z) > 1.5, 'player did not move');
    assert.ok(Math.abs(yaw1 - yaw0) > 0.05, 'drag-look did not turn the camera');
    assert.equal(await h.eval((g) => g.ctx.input.move.x === 0 && g.ctx.input.move.y === 0), true, 'stick release stops movement');
  });

  await check('landscape: attack, technique and jump by tap', async () => {
    await page.evaluate(() => { window.__casts = []; window.__game.ctx.events.on('technique:cast', (e) => e.isPlayer && window.__casts.push(e.id)); });
    await tapTouch('attack');
    await h.step(10);
    await tapTouch('ability1');
    await h.step(10);
    const casts = await page.evaluate(() => window.__casts);
    assert.ok(casts.length >= 2, 'expected an attack and a technique: ' + JSON.stringify(casts));
    const y0 = (await h.state()).player.y;
    await tapTouch('jump');
    let maxY = y0;
    for (let i = 0; i < 6; i++) maxY = Math.max(maxY, (await h.step(2)).player.y);
    assert.ok(maxY > y0 + 0.2, `touch jump did nothing (${y0} → ${maxY})`);
    await h.step(30);
    await shot('06_play_landscape');
  });

  await check('landscape: interact with an NPC through the prompt pill; dialogue choices by tap', async () => {
    const npc = await h.eval((g) => {
      const p = g.game.player.position;
      const items = [...g.ctx.interactions.items.values()].filter((i) => (!i.enabled || i.enabled()) && /Talk/i.test(i.label));
      items.sort((a, b) => Math.hypot(a.position.x - p.x, a.position.z - p.z) - Math.hypot(b.position.x - p.x, b.position.z - p.z));
      const it = items[0];
      if (!it) return null;
      const dx = p.x - it.position.x, dz = p.z - it.position.z, d = Math.hypot(dx, dz) || 1;
      g.teleport(it.position.x + (dx / d) * 1.4, it.position.z + (dz / d) * 1.4);
      g.faceTowards(it.position.x, it.position.z);
      return it.label;
    });
    assert.ok(npc, 'no NPC to talk to near the start');
    await h.step(6);
    const pill = await page.$eval('.touch .tbtn[data-touch="interact"]', (e) => ({ text: e.textContent, ready: e.classList.contains('ready'), w: e.getBoundingClientRect().width }));
    assert.ok(pill.ready && pill.text.includes(npc.replace(/^.*?(Talk)/, '$1').slice(0, 8)), 'pill should show the prompt: ' + JSON.stringify(pill) + ' vs ' + npc);
    await shot('07_interact_pill');
    await tapTouch('interact');
    await h.step(3);
    await page.waitForFunction(() => window.__game.ctx.ui.dialogueOpen, null, { timeout: 10000 });
    assert.equal(await page.isVisible('.touch .tbtn[data-touch="attack"]'), false, 'controls step aside during dialogue');
    for (let i = 0; i < 12 && (await h.eval((g) => g.ctx.ui.dialogueOpen)); i++) {
      const choice = await page.$('.choices .choice');
      if (!choice) break;
      await choice.tap();
      await h.step(2);
    }
    assert.equal(await h.eval((g) => g.ctx.ui.dialogueOpen), false, 'dialogue should finish by taps');
  });

  await check('landscape: Draw Water lights up beside a lake; element button switches (long-press = previous)', async () => {
    await h.eval((g) => { g.unlockAllElements(); g.setElement('water'); });
    await h.eval((g) => g.ctx.world.preload(new g.THREE.Vector3(-196, 0, -300)));
    await h.eval((g) => g.teleport(-196, -300));
    await h.step(12);
    assert.ok((await h.eval((g) => g.waterNearby(25))).some((w) => !w.frozen), 'expected liquid water at Lake Hiari');
    const draw = await page.$eval('.touch .tbtn[data-touch="drawWater"]', (e) => e.className);
    assert.match(draw, /near/, 'Draw Water should glow near a source: ' + draw);
    const r0 = (await h.state()).player.water;
    const b = await center('.touch .tbtn[data-touch="drawWater"]');
    await touch('touchStart', [b]);
    await h.step(30);
    await touch('touchEnd', []);
    await h.step(4);
    assert.ok((await h.state()).player.water > r0, 'holding DRAW should pull water');
    await tapTouch('elementNext');
    await h.step(4);
    const e1 = (await h.state()).player.element;
    assert.notEqual(e1, 'water', 'tap should switch element');
    const eb = await center('.touch .tbtn[data-touch="elementNext"]');
    await touch('touchStart', [eb]);
    await page.waitForTimeout(650);
    await touch('touchEnd', []);
    await h.step(4);
    assert.equal((await h.state()).player.element, 'water', 'long-press should go back');
    await shot('08_water');
  });

  await check('landscape: map opens from the touch button; pinch zooms, drag pans', async () => {
    await tapTouch('map');
    await h.step(2);
    await page.waitForSelector('.mp-canvas', { timeout: 15000 });
    const zoom = () => h.eval((g) => g.ctx.ui.instances.get('map').zoom);
    const z0 = await zoom();
    const c = await center('.mp-canvas');
    await touch('touchStart', [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: c.x - 40 - 20 * i, y: c.y, id: 1 }, { x: c.x + 40 + 20 * i, y: c.y, id: 2 }]);
    await touch('touchEnd', []);
    const z1 = await zoom();
    assert.ok(z1 > z0 * 1.4, `pinch should zoom in (${z0} → ${z1})`);
    const a = await audit('.mp-root button, .gs-root button');
    assert.ok(a.overflowX <= 0, JSON.stringify(a));
    await shot('09_map');
    await h.eval((g) => g.ctx.ui.close());
    await h.step(2);
  });

  await check('landscape: pause menu by touch → settings → every journal screen fits (both orientations)', async () => {
    await tapTouch('pause');
    await h.step(2);
    await page.waitForSelector('.ps-menu');
    assert.equal((await h.state()).paused, true);
    const fsSupported = await page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
    assert.equal(await page.isVisible('.ps-menu [data-action="fullscreen"]'), fsSupported);
    await page.tap('.ps-menu [data-action="settings"]');
    await page.waitForSelector('.settings-panel');
    const s = await audit('.settings-panel button');
    assert.ok(s.overflowX <= 0 && !s.off.length, JSON.stringify(s));
    await page.tap('[data-action="close-settings"]');
    const report = {};
    for (const vp of [LANDSCAPE, PORTRAIT]) {
      await page.setViewportSize(vp);
      await h.step(2);
      for (const id of ['map', 'journal', 'techniques', 'inventory', 'companions']) {
        const tile = await page.$(`.ps-menu [data-open="${id}"]`);
        if (!tile) continue;
        await tile.tap();
        await h.step(2);
        const a = await audit();
        report[`${vp.width}x${vp.height}:${id}`] = a;
        assert.ok(a.overflowX <= 0, `${id} overflows horizontally at ${vp.width}x${vp.height}`);
        await h.eval((g, id) => g.ctx.ui.close(id), id);
        await h.step(1);
      }
    }
    console.log('[screens audit]', JSON.stringify(report));
    await page.setViewportSize(LANDSCAPE);
    await page.tap('.ps-menu [data-action="resume"]');
    await h.step(3);
    assert.equal((await h.state()).paused, false);
    assert.equal(h.errors.length, 0, 'console errors: ' + h.errors.slice(0, 5).join('\n'));
  });

  await check('perf (mobile defaults, 844×390, SwiftShader): draw calls & triangles at the four capitals', async () => {
    const out = {};
    for (const e of ['water', 'earth', 'fire', 'air']) {
      const r = await h.eval(async (g, e) => {
        const s = g.game.constructor && g.ctx.world;
        const start = (await import('/src/world/WorldLayout.ts')).STARTS[e];
        await s.preload(new g.THREE.Vector3(start.spawn.x, 0, start.spawn.z));
        g.teleport(start.spawn.x, start.spawn.z);
        g.step(20);
        const st = g.state();
        return { drawCalls: st.render.drawCalls, triangles: st.render.triangles, fps: +st.render.fps.toFixed(1), region: st.region };
      }, e);
      out[e] = r;
    }
    console.log('[perf mobile defaults]', JSON.stringify(out));
    for (const e of Object.keys(out)) assert.ok(out[e].drawCalls > 0, `${e}: nothing drawn`);
  });
} finally {
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
}
for (const r of results) console.log(r.join(' | '));
if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
