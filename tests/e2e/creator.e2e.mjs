/**
 * Character creator E2E: main menu → element → creator (every tab drives the live
 * 3D preview) → name validation → preview → Begin Journey, at desktop and phone size.
 * Run: node tests/e2e/creator.e2e.mjs        (SHOT_DIR=/path to save screenshots)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};

async function run(width, height, tag) {
  const h = await launch({ width, height });
  const creator = (fn, ...args) => h.eval((g, src, a) => new Function('return (' + src + ')')()(g.debug.creator, ...a), fn.toString(), args);
  const shot = async (name) => SHOT_DIR && (await h.page.screenshot({ path: `${SHOT_DIR}/creator_${tag}_${name}.png` }));
  const settle = async () => {
    await creator((c) => c.flush());
    await h.page.waitForTimeout(250);
  };
  try {
    await check(`${tag}: menu → element → creator`, async () => {
      await h.page.click('[data-action="enter"]');
      await h.page.click('[data-action="new"]');
      await h.page.click('[data-element="air"]');
      await h.page.waitForSelector('[data-tab="face"]');
      const s = await creator((c) => c.state());
      assert.equal(s.step, 'creator');
      assert.equal(s.element, 'air');
      assert.ok(s.height > 1.4, 'preview humanoid missing');
      const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, 'horizontal overflow ' + overflow);
      await creator((c) => c.setYaw(0.35));
      await settle();
      await shot('body');
    });

    await check(`${tag}: face tab sliders reshape the face geometry`, async () => {
      await h.page.click('[data-tab="face"]');
      const before = await creator((c) => c.geomHash());
      await h.page.click('[data-opt="face:3"]');
      await settle();
      const afterPreset = await creator((c) => c.geomHash());
      assert.notEqual(afterPreset, before, 'face preset did not change geometry');
      for (const opt of ['jaw', 'cheeks', 'nose', 'eyeSpacing']) {
        const h0 = await creator((c) => c.geomHash());
        await h.page.$eval(`input[data-opt="${opt}"]`, (el) => {
          el.value = el.value > 0 ? '-0.9' : '0.9';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle();
        const h1 = await creator((c) => c.geomHash());
        assert.notEqual(h1, h0, `${opt} slider did not change geometry`);
      }
      const s = await creator((c) => c.state());
      assert.equal(s.view, 'face', 'face tab should zoom to the face');
      await creator((c) => c.setView('face'));
      await settle();
      await shot('face');
    });

    await check(`${tag}: hair, markings, attire and colours update the appearance`, async () => {
      await h.page.click('[data-tab="hair"]');
      await h.page.click('[data-opt="hair:topknot_crown"]');
      await h.page.click('[data-opt="facialHair:goatee"]');
      await h.page.click('[data-tab="marks"]');
      await h.page.click('[data-opt="tattoos:arrows_limbs"]');
      await h.page.click('[data-tab="attire"]');
      const g0 = await creator((c) => c.geomHash());
      await h.page.click('[data-preset="water_south"]');
      await settle();
      const g1 = await creator((c) => c.geomHash());
      assert.notEqual(g1, g0, 'outfit preset did not change the mesh');
      await h.page.click('[data-item="earth_straw_hat"]');
      await h.page.click('[data-tab="colors"]');
      await h.page.click('.ngf-pal');
      await settle();
      const s = await creator((c) => c.state());
      const a = s.appearance;
      assert.equal(a.hair.style, 'topknot_crown');
      assert.equal(a.facialHair, 'goatee');
      assert.equal(a.tattoos, 'arrows_limbs');
      assert.equal(a.outfit.top, 'water_south_parka');
      assert.equal(a.outfit.headwear, 'earth_straw_hat');
      assert.equal(a.colors.primary, '#e8a33a', 'first palette of the home nation (air) should apply');
      await shot('attire');
    });

    await check(`${tag}: randomize keeps a valid look`, async () => {
      const before = await creator((c) => c.geomHash());
      for (let i = 0; i < 3; i++) {
        await h.page.click(width > 860 ? '[data-action="creator-randomize"]' : '.ngf-mobile .btn:nth-child(2)');
        await settle();
      }
      const after = await creator((c) => c.geomHash());
      assert.notEqual(after, before);
      assert.equal(h.errors.length, 0, 'console errors: ' + h.errors.join('\n'));
    });

    await check(`${tag}: female body refits the look and drops facial hair`, async () => {
      await h.page.click('[data-tab="body"]');
      const g0 = await creator((c) => c.geomHash());
      await h.page.click('[data-opt="bodyType:female"]');
      await settle();
      const a = (await creator((c) => c.state())).appearance;
      assert.equal(a.body, 'female');
      assert.equal(a.facialHair, 'none');
      assert.notEqual(await creator((c) => c.geomHash()), g0, 'body type did not change the mesh');
      await h.page.click('[data-tab="hair"]');
      assert.equal(await h.page.$$eval('[data-opt^="facialHair:"]', (els) => els.length), 0, 'facial hair offered for a female body');
      await shot('female');
    });

    await check(`${tag}: name validation gates Continue`, async () => {
      const input = 'input[data-field="name"]';
      await h.page.fill(input, 'A');
      const btn = width > 860 ? '.ngf-right [data-action="creator-continue"]' : '.ngf-mobile [data-action="creator-continue"]';
      assert.equal(await h.page.$eval(btn, (b) => b.disabled), true, 'single letter should be rejected');
      await h.page.fill(input, 'Tenzin!!');
      assert.equal(await h.page.$eval(btn, (b) => b.disabled), true, 'punctuation should be rejected');
      await h.page.fill(input, 'tenzin');
      assert.equal(await h.page.$eval(btn, (b) => b.disabled), false);
      await h.page.click(btn);
      const s = await creator((c) => c.state());
      assert.equal(s.step, 'preview');
      assert.equal(s.name, 'Tenzin', 'name should be normalised');
      await h.page.waitForTimeout(400);
      await shot('preview');
    });

    await check(`${tag}: Begin Journey starts the campaign with the created look`, async () => {
      const want = (await creator((c) => c.state())).appearance;
      await h.page.click('[data-action="confirm-journey"]');
      await h.page.waitForFunction(() => window.__game?.state().mode === 'play', null, { timeout: 120000 });
      const st = await h.state();
      assert.equal(st.player.name, 'Tenzin');
      assert.equal(st.player.element, 'air');
      const got = await h.eval((g) => g.game.player.humanoid.appearance);
      assert.equal(got.hair.style, want.hair.style);
      assert.deepEqual(got.outfit, want.outfit);
      assert.equal(got.body, 'female');
    });
  } finally {
    if (h.errors.length) console.log(`[${tag}] CONSOLE ERRORS:\n` + h.errors.slice(0, 15).join('\n'));
    await h.close();
  }
}

await run(1280, 720, 'desktop');
await run(400, 800, 'phone');
for (const r of results) console.log(r.join(' | '));
if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
