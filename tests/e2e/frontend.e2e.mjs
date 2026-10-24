/**
 * Front-end E2E: main menu (4 choices, golden-hour tour with cross-fade) → settings
 * (presets/options apply live and persist, rebinding with conflicts) → Enter the World →
 * New Journey → element cards → creator (options change the model) → journey preview
 * (companion, slot choice) → arrival cinematic → first quest prompt → save thumbnails /
 * load / delete → overwrite guard → exit flow. Desktop 1440×900, then a 390×844 touch phone.
 * Run: node tests/e2e/frontend.e2e.mjs        (SHOT_DIR=/path to save screenshots)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
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

const LONG = { timeout: 240000 };

/** Screenshot artifact (never fails a check: software WebGL can be too slow to deliver a frame in time). */
async function snap(page, name) {
  if (!SHOT_DIR) return;
  await settle(page);
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, timeout: 90000 }).catch((e) => console.log(`[shot] ${name} skipped: ${e.message.split('\n')[0]}`));
}

/** Let entry animations (fade/rise) finish so screenshots show the settled screen. */
async function settle(page) {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity || (a.currentTime ?? 0) > 2500), null, { timeout: 8000 })
    .catch(() => {});
}

async function desktop() {
  const h = await launch({ width: 1440, height: 900 });
  const shot = (name) => snap(h.page, `desktop_${name}`);
  const menu = () => h.eval((g) => g.debug.menu.state());
  const settings = () => h.eval((g) => g.ctx.settings.data);
  try {
    await check('desktop: main menu has exactly the four choices', async () => {
      await h.eval((g) => g.debug.menu.hold(true));
      const labels = await h.page.$$eval('.main-menu .menu-list button', (bs) => bs.map((b) => b.querySelector('.menu-btn-label')?.textContent?.trim().toUpperCase()));
      assert.deepEqual(labels, ['ENTER THE WORLD', 'TUTORIAL', 'SETTINGS', 'EXIT GAME']);
      assert.ok(await h.page.isVisible('.logo .logo-main'), 'title missing');
      assert.equal(await h.page.$$eval('.menu-emblems .emblem', (e) => e.length), 4);
      const s = await menu();
      assert.equal(s.location, 'Southern Air Temple');
      const hour = await h.eval((g) => g.ctx.world.sky.timeOfDay);
      assert.ok(hour > 16.8 && hour < 18, 'menu should be at golden hour, got ' + hour);
      await shot('01_menu');
    });

    await check('desktop: tour cross-fades to the next capital', async () => {
      await h.eval((g) => g.debug.menu.next());
      const mid = await menu();
      assert.equal(mid.phase, 'cut');
      assert.equal(mid.overlay, 1, 'snapshot overlay should cover the cut');
      assert.ok((await h.eval((g) => g.debug.menu.vistas())).includes('air'), 'air vista not captured');
      await h.page.waitForFunction(() => { const s = window.__game.debug.menu.state(); return s.phase === 'play' && s.index === 1; }, null, LONG);
      const s = await menu();
      assert.equal(s.location, 'Northern Water Tribe');
      assert.equal(s.overlay, 0, 'overlay should fade out');
      const cam = await h.eval((g) => g.ctx.camera.position.toArray());
      assert.ok(Math.hypot(cam[0] + 220, cam[2] + 1550) < 400, 'camera not over the Water Tribe: ' + cam);
    });

    await check('desktop: settings presets and options apply live', async () => {
      await h.page.click('[data-action="settings"]');
      await h.page.waitForSelector('.settings-panel');
      // Click the preset buttons within one task so SwiftShader never has to draw a High/Ultra frame.
      const both = await h.page.evaluate(() => {
        const r = window.__game.ctx.render;
        const read = () => ({ pr: r.renderer.getPixelRatio(), shadows: r.renderer.shadowMap.enabled, post: !!r.composer, far: r.scene.fog.far });
        document.querySelector('[data-preset="ultra"]').click();
        const ultra = { ...read(), active: document.querySelector('[data-preset="ultra"]').classList.contains('primary') };
        document.querySelector('[data-preset="low"]').click();
        return { ultra, low: read() };
      });
      assert.equal(both.ultra.shadows, true, 'ultra preset should enable shadows');
      assert.equal(both.ultra.post, true, 'ultra preset should enable post-processing');
      assert.equal(both.ultra.active, true, 'ultra button should show as active');
      assert.ok(both.ultra.far > both.low.far, 'ultra should draw further');
      const r = both.low;
      assert.equal(r.shadows, false);
      assert.equal(r.post, false);
      assert.equal(r.pr, 0.75, 'low preset renders at 75%');
      const setRange = (path, v) => h.page.$eval(`input[data-setting="${path}"]`, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
      await setRange('graphics.renderScale', 0.5);
      assert.equal(await h.eval((g) => g.ctx.render.renderer.getPixelRatio()), 0.5, 'render scale should change the pixel ratio');
      assert.equal((await settings()).graphics.preset, 'custom');
      await setRange('graphics.drawDistance', 600);
      assert.equal(await h.eval((g) => g.ctx.camera.far), 3000, 'draw distance should extend the camera range');
      await shot('02_settings');
      await h.page.click('[data-tab="audio"]');
      const before = await h.eval((g) => g.ctx.audio.busLevel('music'));
      await setRange('audio.music', 0.1);
      const after = await h.eval((g) => g.ctx.audio.busLevel('music'));
      assert.ok(after !== before || (await settings()).audio.music === 0.1, 'music volume did not apply');
      await h.page.click('[data-tab="controls"]');
      await setRange('controls.fov', 80);
      assert.equal(await h.eval((g) => g.ctx.camera.fov), 80, 'FOV should apply to the camera');
      await setRange('controls.mouseSensitivity', 2);
      assert.equal(await h.eval((g) => g.ctx.input.mouseSensitivity), 2);
      await h.page.click('[data-setting="controls.invertY"]');
      assert.equal(await h.eval((g) => g.ctx.input.invertY), true);
      await setRange('controls.cameraShake', 0.25);
      await h.page.click('[data-tab="gameplay"]');
      await setRange('gameplay.hudScale', 1.2);
      assert.equal(await h.page.$eval('#ui', (e) => e.style.getPropertyValue('--ui-scale')), '1.2');
    });

    await check('desktop: rebinding with conflict handling (keyboard and gamepad) and reset', async () => {
      await h.page.click('[data-tab="controls"]');
      await h.page.click('[data-bind="jump"][data-device="kbm"]');
      await h.page.keyboard.press('Escape');
      assert.ok(await h.page.isVisible('.settings-panel'), 'Escape while listening must not close settings');
      assert.equal((await settings()).controls.bindings.jump[0], 'Space', 'Escape cancels');
      await h.page.click('[data-bind="jump"][data-device="kbm"]');
      await h.page.keyboard.press('KeyQ');
      await h.page.waitForSelector('.confirm');
      assert.match(await h.page.textContent('.confirm'), /Dodge/);
      await h.page.click('.confirm button:has-text("Reassign")');
      let b = (await settings()).controls.bindings;
      assert.equal(b.jump[0], 'KeyQ');
      assert.ok(!b.dodge.includes('KeyQ'), 'dodge should lose KeyQ');
      assert.ok(b.jump.includes('Pad0'), 'gamepad binding kept');
      // The new key really drives the action.
      const jumpLive = await h.eval((g) => g.ctx.input.getBindings().jump.includes('KeyQ'));
      assert.ok(jumpLive, 'Input did not receive the new binding');
      await h.page.click('[data-bind="dodge"][data-device="pad"]');
      await h.eval((g) => g.debug.settings.feed('Pad4'));
      await h.page.waitForSelector('.confirm');
      await h.page.click('.confirm button:has-text("Reassign")');
      b = (await settings()).controls.bindings;
      assert.ok(b.dodge.includes('Pad4') && !b.dodge.includes('Pad1'), JSON.stringify(b.dodge));
      assert.ok(!b.elementPrev.includes('Pad4'));
      // Mouse buttons are captured too; taking Lock-On's middle button asks first, and Cancel keeps everything.
      await h.page.click('[data-bind="interact"][data-device="kbm"]');
      assert.deepEqual(await h.eval((g) => g.debug.settings.listening()), { action: 'interact', device: 'kbm' });
      await h.page.mouse.click(700, 450, { button: 'middle' });
      await h.page.waitForSelector('.confirm');
      assert.match(await h.page.textContent('.confirm'), /MMB.*Lock-On/s);
      await h.page.click('.confirm button:has-text("Cancel")');
      b = (await settings()).controls.bindings;
      assert.equal(b.interact[0], 'KeyE');
      assert.equal(b.lockOn[0], 'Mouse1');
      assert.equal(await h.eval((g) => g.debug.settings.listening()), null, 'capture should end');
      await shot('03_settings_controls');
      await h.page.click('[data-action="reset-bindings"]');
      await h.page.click('.confirm button:has-text("Reset")');
      b = (await settings()).controls.bindings;
      assert.equal(b.jump[0], 'Space');
      assert.ok(b.dodge.includes('KeyQ'));
    });

    await check('desktop: settings persist after reload', async () => {
      await h.page.click('[data-action="close-settings"]');
      await h.page.reload();
      await h.page.waitForFunction(() => window.__ready === true, null, LONG);
      const s = await settings();
      assert.equal(s.graphics.renderScale, 0.5);
      assert.equal(s.controls.fov, 80);
      assert.equal(s.controls.invertY, true);
      assert.equal(s.gameplay.hudScale, 1.2);
      assert.equal(await h.eval((g) => g.ctx.render.renderer.getPixelRatio()), 0.5);
      assert.equal(await h.eval((g) => g.ctx.input.invertY), true);
      // Restore the speedy test preset.
      await h.eval((g) => { g.preset('low'); g.setting('controls.invertY', false); });
      await h.eval((g) => g.debug.menu.hold(true));
    });

    await check('desktop: element cards show start city, master, first quest and art', async () => {
      await h.page.click('[data-action="enter"]');
      const subs = await h.page.$$eval('.menu-list button', (bs) => bs.map((b) => b.dataset.action));
      assert.deepEqual(subs, ['new', 'load', 'back'], 'no save yet: New / Load / Back');
      assert.equal(await h.page.$eval('[data-action="load"]', (b) => b.disabled), true);
      await h.page.click('[data-action="new"]');
      await h.page.waitForSelector('.element-card');
      const cards = await h.page.$$eval('.element-card', (cs) => cs.map((c) => ({ e: c.dataset.element, facts: c.querySelector('.card-facts')?.textContent ?? '', vista: c.querySelector('.card-art')?.classList.contains('vista') })));
      assert.equal(cards.length, 4);
      for (const c of cards) assert.match(c.facts, /Master.*First quest/s, `${c.e} card lacks master/quest`);
      assert.ok(cards.find((c) => c.e === 'air').vista, 'air card should use the tour snapshot');
      assert.match(await h.page.textContent('.element-select h1'), /BEGIN YOUR JOURNEY AS THE AVATAR/);
      await shot('04_elements');
    });

    let before;
    await check('desktop: creator options visibly change the model', async () => {
      await h.page.click('.element-card[data-element="fire"]');
      await h.page.waitForSelector('[data-tab="hair"]');
      const c = (fn, ...a) => h.eval((g, src, a) => new Function('return (' + src + ')')()(g.debug.creator, ...a), fn.toString(), a);
      await c((x) => x.flush());
      before = await c((x) => ({ a: x.state().appearance, g: x.geomHash() }));
      await h.page.click('[data-tab="hair"]');
      await h.page.click('[data-opt="hair:topknot_crown"]');
      await h.page.click('[data-tab="body"]');
      await h.page.click('.swatches .swatch:nth-child(3)');
      await h.page.$eval('input[data-opt="build"]', (el) => { el.value = '0.9'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await h.page.click('[data-tab="attire"]');
      await h.page.click('[data-preset="water_south"]');
      await c((x) => x.flush());
      const after = await c((x) => ({ a: x.state().appearance, g: x.geomHash() }));
      assert.notEqual(after.g, before.g, 'mesh did not change');
      assert.equal(after.a.hair.style, 'topknot_crown');
      assert.notEqual(after.a.skinTone, before.a.skinTone);
      assert.equal(after.a.outfit.top, 'water_south_parka');
      assert.ok(Math.abs(after.a.build - 0.9) < 1e-6);
      await h.page.fill('input[data-field="name"]', 'Ember');
      await h.page.waitForTimeout(250);
      await shot('05_creator');
      before = after.a;
    });

    await check('desktop: journey preview shows companion, equipment and slot choice', async () => {
      await h.page.click('.ngf-right [data-action="creator-continue"]');
      await h.page.waitForSelector('[data-action="confirm-journey"]');
      const slots = await h.page.$$eval('.ngf-slot', (s) => s.map((x) => ({ slot: x.dataset.slot, active: x.classList.contains('active') })));
      assert.equal(slots.length, 3);
      assert.equal(slots.find((s) => s.active)?.slot, 'slot1');
      const text = await h.page.textContent('.ngf-preview-sheet');
      assert.match(text, /Homeland Companion/);
      assert.match(text, /Starting Equipment/);
      assert.match(text, /First Quest/);
      const hasCompanion = await h.eval((g) => !!g.game.stage && g.game.stage.scene.children.some((o) => o.type === 'Group' && o.position.x > 1));
      assert.ok(hasCompanion, 'companion model not in the preview studio');
      await h.page.waitForTimeout(500);
      await shot('06_preview');
    });

    await check('desktop: Begin Journey → loading → arrival cinematic → first quest prompt', async () => {
      await h.page.click('[data-action="confirm-journey"]');
      await h.page.waitForSelector('.loading', { timeout: 30000 });
      assert.match(await h.page.textContent('.loading'), /Did you know\?/);
      await shot('07_loading');
      await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, LONG);
      const st = await h.state();
      assert.equal(st.player.name, 'Ember');
      assert.equal(st.player.element, 'fire');
      const got = await h.eval((g) => g.game.player.humanoid.appearance);
      assert.equal(got.hair.style, before.hair.style);
      assert.equal(await h.page.$eval('#ui', (e) => e.classList.contains('cinematic')), true, 'HUD should hide during the arrival');
      assert.ok(await h.page.isVisible('.cine-bar.bottom'), 'letterbox missing');
      const p0 = await h.eval((g) => { const c = g.ctx.camera.position, p = g.game.player.position; return Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z); });
      await h.step(25, 0.1);
      const p1 = await h.eval((g) => { const c = g.ctx.camera.position, p = g.game.player.position; return Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z); });
      assert.ok(p0 > 60 && p1 < p0, `camera should sweep in (${p0.toFixed(1)} → ${p1.toFixed(1)})`);
      await shot('08_arrival');
      await h.step(50, 0.1);
      await h.page.waitForSelector('.quest-prompt', { timeout: 20000 });
      const q = await h.page.textContent('.quest-prompt');
      assert.match(q, /The Avatar Awakens: Fire/);
      const s2 = await h.eval((g) => ({ scripted: g.game.cameraRig.isScripted, lock: g.game.player.controlLock, cine: document.getElementById('ui').classList.contains('cinematic') }));
      assert.deepEqual(s2, { scripted: false, lock: 0, cine: false });
      const cam = await h.eval((g) => { const c = g.ctx.camera.position, p = g.game.player.position; return Math.hypot(c.x - p.x, c.z - p.z); });
      assert.ok(cam < 8, 'arrival should end behind the player, distance ' + cam);
      await shot('09_quest');
    });

    await check('desktop: UI scale enlarges the HUD', async () => {
      const w = async () => h.page.$eval('.hud-vitals', (e) => e.getBoundingClientRect().width);
      await h.eval((g) => g.setting('gameplay.hudScale', 1));
      const w1 = await w();
      await h.eval((g) => g.setting('gameplay.hudScale', 1.25));
      const w2 = await w();
      assert.ok(Math.abs(w2 / w1 - 1.25) < 0.02, `vitals width ${w1} → ${w2}`);
      await h.eval((g) => g.setting('gameplay.hudScale', 1));
    });

    await check('desktop: save writes a slot thumbnail with mastery icons; load screen shows it', async () => {
      await h.page.waitForFunction(() => !!localStorage.getItem('a4n.thumb.slot1'), null, { timeout: 20000 });
      const variance = await h.page.evaluate(async () => {
        const t = JSON.parse(localStorage.getItem('a4n.thumb.slot1'));
        const img = new Image();
        img.src = t.img;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; n++; }
        const m = s / n;
        return { mean: m, sd: Math.sqrt(s2 / n - m * m), w: img.width, unlocked: t.unlocked };
      });
      assert.ok(variance.sd > 6 && variance.mean > 8, 'thumbnail looks blank: ' + JSON.stringify(variance));
      assert.deepEqual(variance.unlocked, ['fire']);
      await h.eval((g) => g.game.setPaused(true));
      await h.page.click('[data-action="save"]');
      await h.page.waitForSelector('.saveload [data-action="save-slot1"]');
      await h.page.click('[data-action="save-slot1"]');
      await h.page.waitForTimeout(300);
      const card = await h.page.$eval('.slot-card[data-slot="slot1"]', (c) => ({ text: c.textContent, thumb: getComputedStyle(c.querySelector('.slot-thumb')).backgroundImage.startsWith('url('), icons: c.querySelectorAll('.slot-mastery .emblem').length, lit: c.querySelectorAll('.slot-mastery .emblem.unlocked, .slot-mastery .emblem.mastered').length }));
      assert.ok(card.thumb, 'slot card has no thumbnail');
      assert.equal(card.icons, 4);
      assert.equal(card.lit, 1);
      assert.match(card.text, /Ember/);
      assert.match(card.text, /Fire Avatar · Level 1/);
      assert.match(card.text, /played/);
      await shot('10_saveload');
      await h.page.click('[data-action="close-saveload"]');
    });

    await check('desktop: exit to menu, Continue / Load, overwrite guard, delete with confirm', async () => {
      await h.page.click('.modal-backdrop [data-action="exit"]');
      await h.page.click('.confirm button:has-text("Save & Exit")');
      await h.page.waitForFunction(() => window.__game.state().mode === 'menu', null, LONG);
      await h.eval((g) => g.debug.menu.hold(true));
      // Back from a session the backdrop streams the first tour location in behind a dark veil, then fades in.
      const veil = await h.eval((g) => g.debug.menu.state());
      assert.ok(veil.overlay === 1 || veil.phase === 'play', 'dark veil while the menu backdrop streams in');
      await h.page.waitForFunction(() => window.__game.debug.menu.state().phase === 'play', null, LONG);
      await h.page.click('[data-action="enter"]');
      const cont = await h.page.textContent('[data-action="continue"]');
      assert.match(cont, /Ember · Fire Avatar/);
      // New journey into the occupied slot must ask first.
      await h.page.click('[data-action="new"]');
      await h.page.click('.element-card[data-element="air"]');
      await h.page.waitForSelector('.ngf-right [data-action="creator-continue"]');
      await h.page.click('.ngf-right [data-action="creator-continue"]');
      await h.page.waitForSelector('.ngf-slot');
      assert.equal(await h.page.$eval('.ngf-slot.active', (b) => b.dataset.slot), 'slot2', 'default should be the first empty slot');
      await h.page.click('.ngf-slot[data-slot="slot1"]');
      assert.match(await h.page.textContent('.ngf-slot-note'), /replaced/);
      await h.page.click('[data-action="confirm-journey"]');
      await h.page.waitForSelector('.confirm');
      assert.match(await h.page.textContent('.confirm'), /Replace it/);
      await h.page.click('.confirm button:has-text("Cancel")');
      assert.equal((await h.state()).mode, 'menu', 'cancel must not start a journey');
      assert.equal(await h.eval((g) => g.ctx.save.getMeta('slot1').characterName), 'Ember');
      // Back out with Escape: preview → creator → element select → main menu (Enter view).
      await h.page.keyboard.press('Escape');
      await h.page.waitForSelector('[data-tab="hair"]');
      await h.page.keyboard.press('Escape');
      await h.page.waitForSelector('.element-card');
      await h.page.keyboard.press('Escape');
      await h.page.waitForSelector('.main-menu [data-action="load"]', { state: 'visible', timeout: 10000 });
      assert.equal(await h.eval((g) => !!g.game.stage), false, 'creator studio should be disposed');
      await h.page.click('[data-action="load"]');
      await h.page.waitForSelector('.saveload [data-action="load-slot1"]');
      await h.page.click('[data-action="delete-slot1"]');
      await h.page.waitForSelector('.confirm');
      await h.page.click('.confirm button:has-text("Cancel")');
      assert.ok(await h.eval((g) => !!g.ctx.save.getMeta('slot1')), 'cancel must keep the save');
      await h.page.click('[data-action="delete-slot1"]');
      await h.page.click('.confirm button:has-text("Delete")');
      assert.equal(await h.eval((g) => g.ctx.save.getMeta('slot1')), null);
      assert.equal(await h.page.evaluate(() => localStorage.getItem('a4n.thumb.slot1')), null, 'thumbnail should be deleted too');
      await h.page.click('[data-action="close-saveload"]');
    });

    await check('desktop: Exit Game asks, then shows the farewell screen', async () => {
      await h.eval((g) => { g.ctx.ui.closeAll(); g.ctx.ui.showMainMenu(); });
      await h.page.click('[data-action="exit"]');
      await h.page.waitForSelector('.confirm');
      await h.page.click('.confirm button:has-text("Stay")');
      assert.ok(await h.page.isVisible('[data-action="enter"]'));
      await h.page.click('[data-action="exit"]');
      await h.page.click('.confirm button:has-text("Exit Game")');
      await h.page.waitForSelector('.menu-farewell:not(.hidden)');
      assert.match(await h.page.textContent('.menu-farewell'), /Farewell, Avatar/);
      await shot('11_farewell');
      await h.page.click('[data-action="return"]');
      assert.ok(await h.page.isVisible('[data-action="enter"]'));
      assert.equal(h.errors.length, 0, 'console errors: ' + h.errors.slice(0, 5).join('\n'));
    });
  } finally {
    if (h.errors.length) console.log('[desktop] CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
    await h.close();
  }
}

async function phone() {
  const h = await launch({ width: 390, height: 844, hasTouch: true, isMobile: true });
  const shot = (name) => snap(h.page, `phone_${name}`);
  const overflow = () => h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const inView = (sel) => h.page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).every((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }));
  try {
    await check('phone: menu fits and works by touch', async () => {
      await h.eval((g) => g.debug.menu.hold(true));
      assert.ok((await overflow()) <= 0, 'horizontal overflow');
      assert.ok(await inView('.main-menu .menu-list button'), 'menu buttons off-screen');
      await shot('01_menu');
      await h.page.tap('[data-action="settings"]');
      await h.page.waitForSelector('.settings-panel');
      assert.ok(await inView('.settings-panel'), 'settings panel overflows');
      await h.page.tap('[data-tab="controls"]');
      await shot('02_settings');
      await h.page.tap('[data-action="close-settings"]');
      await h.page.tap('[data-action="enter"]');
      await h.page.tap('[data-action="new"]');
      await h.page.waitForSelector('.element-card');
      assert.ok((await overflow()) <= 0, 'element select overflows');
      await shot('03_elements');
    });

    await check('phone: creator bottom sheet with touch sliders and chips', async () => {
      await h.page.tap('.element-card[data-element="water"]');
      await h.page.waitForSelector('.ngf-mobile [data-action="creator-continue"]');
      assert.ok(await inView('.ngf-left'), 'creator sheet off-screen');
      assert.equal(await h.page.isVisible('.touch .tbtn[data-touch="jump"]'), false, 'touch controls must not cover menus / the creator');
      const c = (fn) => h.eval((g, src) => new Function('return (' + src + ')')()(g.debug.creator), fn.toString());
      await c((x) => x.flush());
      const g0 = await c((x) => x.geomHash());
      // Drag the height slider with a touch-driven pointer sequence.
      const box = await (await h.page.$('input[data-opt="height"]')).boundingBox();
      const cdp = await h.page.context().newCDPSession(h.page);
      const y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.5, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.75, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.98, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const height = await c((x) => x.state().appearance.height);
      assert.ok(height > 1.05, 'touch drag did not move the height slider: ' + height);
      await h.page.tap('[data-tab="hair"]');
      await h.page.tap('[data-opt="facialHair:goatee"]');
      await c((x) => x.flush());
      assert.notEqual(await c((x) => x.geomHash()), g0, 'preview did not change');
      await h.page.waitForTimeout(250);
      await shot('04_creator');
      await h.page.tap('.ngf-mobile [data-action="creator-continue"]');
      await h.page.waitForSelector('[data-action="confirm-journey"]');
      assert.ok(await inView('[data-action="confirm-journey"]'), 'Begin Journey off-screen');
      await h.page.waitForTimeout(300);
      await shot('05_preview');
    });

    await check('phone: journey starts; touch controls and HUD do not overlap', async () => {
      await h.page.tap('[data-action="confirm-journey"]');
      await h.page.waitForFunction(() => window.__game.state().mode === 'play', null, LONG);
      assert.ok(await h.page.isVisible('[data-action="skip-arrival"]'));
      await h.page.tap('[data-action="skip-arrival"]');
      await h.page.waitForSelector('.quest-prompt', { timeout: 20000 });
      assert.ok(await inView('.quest-prompt'), 'quest prompt off-screen');
      await h.page.tap('[data-action="quest-ok"]');
      // Portrait play: a rotate card pauses the game until the phone turns (or the player opts to stay in portrait).
      await h.page.waitForSelector('.rotate-hint', { timeout: 10000 });
      assert.equal((await h.state()).ui.screen, 'rotateHint');
      await h.page.tap('[data-action="rotate-dismiss"]');
      await h.step(3);
      assert.equal(await h.page.isVisible('.rotate-hint'), false, 'rotate card should close');
      assert.ok(await h.page.isVisible('.touch .tbtn[data-touch="jump"]'), 'touch controls hidden on a touch phone');
      const overlaps = await h.page.evaluate(() => {
        const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
        const rects = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => ({ sel, r: e.getBoundingClientRect() }));
        const btns = rects('.touch .tbtn');
        const hud = [...rects('.hud-vitals'), ...rects('.hud-quest'), ...rects('.hud-bottom')];
        const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const out = [];
        for (const b of btns) for (const x of hud) if (hit(b.r, x.r)) out.push(`${b.sel}[${Math.round(b.r.left)},${Math.round(b.r.top)}] × ${x.sel}`);
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (hit(btns[i].r, btns[j].r)) out.push(`tbtn ${i} × tbtn ${j}`);
        const off = btns.filter((b) => b.r.left < 0 || b.r.right > innerWidth || b.r.top < 0 || b.r.bottom > innerHeight).length;
        return { out, off, n: btns.length };
      });
      assert.equal(overlaps.off, 0, 'touch buttons off-screen');
      assert.deepEqual(overlaps.out, [], 'overlaps: ' + overlaps.out.join('; '));
      // A tap on JUMP reaches the game.
      const y0 = (await h.state()).player.y;
      await h.page.tap('.touch .tbtn[data-touch="jump"]');
      let maxY = y0;
      for (let i = 0; i < 6; i++) maxY = Math.max(maxY, (await h.step(2)).player.y);
      assert.ok(maxY > y0 + 0.2, `touch jump did nothing (${y0} → ${maxY})`);
      await shot('06_play');
      assert.equal(h.errors.length, 0, 'console errors: ' + h.errors.slice(0, 5).join('\n'));
    });
  } finally {
    if (h.errors.length) console.log('[phone] CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
    await h.close();
  }
}

const only = process.argv[2];
if (!only || only === 'desktop') await desktop();
if (!only || only === 'phone') await phone();
for (const r of results) console.log(r.join(' | '));
if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
