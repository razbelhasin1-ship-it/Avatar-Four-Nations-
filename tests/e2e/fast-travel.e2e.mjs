/**
 * Fast travel E2E: trips through the map screen's own travel code with the frame loop running at
 * phone speed underneath the loading screen (software WebGL frames are too slow to show it: there
 * the loader finishes between two frames). The frame loop used to stream the world around the
 * player's old position while the loader built the destination, each tearing the other's work
 * down, so the loading screen sat at "Shaping the land…" for minutes.
 *  - from the Fire Nation (the capital loaded) to Ba Sing Se's Lower Ring, back to the Royal Plaza,
 *    and to the Northern Water Tribe: each trip finishes in time, lands at the travel point on
 *    solid ground, with the terrain and the regions there built
 *  - the player stands still under the loading screen (the simulation is frozen)
 *  - no console errors
 * Run: node tests/e2e/fast-travel.e2e.mjs [--preset medium]
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const preset = process.argv.includes('--preset') ? process.argv[process.argv.indexOf('--preset') + 1] : 'low';
const h = await launch({ width: 960, height: 540, preset });
const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
  console.log(results[results.length - 1].join(' | '));
};

/**
 * Fast travel to `id` through the map screen while cheap frames run every 16 ms (a phone's frame
 * loop; rendering is skipped so the pump keeps that pace). Resolves with the trip's outcome.
 */
async function travel(id, limitMs = 90000) {
  const before = (await h.state()).player;
  await h.eval((g, id) => {
    const R = g.ctx.render;
    window.__ft = { done: null, err: null, render: R.render, ys: [], t0: performance.now(), t1: 0 };
    R.render = () => {};
    window.__ftPump = setInterval(() => {
      g.game.frame(1 / 60);
      if (document.querySelector('.loading')) window.__ft.ys.push(g.state().player.y);
    }, 16);
    g.debug.ui
      .travel(id)
      .then((r) => (window.__ft.done = r), (e) => (window.__ft.err = String(e?.stack ?? e)))
      .finally(() => {
        window.__ft.t1 = performance.now();
        clearInterval(window.__ftPump);
        R.render = window.__ft.render;
      });
  }, id);
  const t0 = Date.now();
  let s;
  for (;;) {
    await h.wait(1000);
    s = await h.page.evaluate(() => ({ done: window.__ft.done, err: window.__ft.err, ms: window.__ft.t1 ? window.__ft.t1 - window.__ft.t0 : 0, ys: window.__ft.ys, loading: !!document.querySelector('.loading'), label: document.querySelector('.loading .loading-status')?.textContent ?? '' }));
    if (s.done || s.err) break;
    if (Date.now() - t0 > limitMs) {
      await h.page.evaluate(() => {
        clearInterval(window.__ftPump);
        window.__game.ctx.render.render = window.__ft.render;
      });
      throw new Error(`still loading after ${limitMs / 1000} s: "${s.label}"`);
    }
  }
  await h.step(6);
  const after = (await h.state()).player;
  return { ...s, before, after };
}

try {
  await h.newGame('earth');
  await h.eval((g) => {
    for (const id of ['fn_plaza', 'bss_lower_ring', 'nwt_plaza']) g.ctx.world.discovered.add(id);
    g.debug.enemies?.clear?.();
    g.setTime(12);
    g.freezeTime?.(true);
  });
  // Start where the report came from: the Fire Nation, beside the causeway landing, capital built.
  await h.eval((g) => g.teleport(-950, 975));
  for (let i = 0; i < 80; i++) {
    await h.step(10);
    if (await h.eval((g) => !!g.debug.fnc && !g.ctx.world.regions.some((r) => r.building))) break;
  }

  const trip = (id, x, z, region) =>
    check(`fast travel to ${id} under a phone-speed frame loop: arrives in time, on built ground`, async () => {
      const r = await travel(id);
      assert.equal(r.err, null, `travel threw: ${r.err}`);
      assert.ok(r.done?.ok, `travel refused: ${JSON.stringify(r.done)}`);
      assert.ok(r.ms < 60000, `trip took ${(r.ms / 1000).toFixed(1)} s`);
      assert.ok(Math.hypot(r.after.x - x, r.after.z - z) < 15, `arrived at the travel point: ${JSON.stringify(r.after)}`);
      // Frozen under the loading screen: the player did not move or fall while the old area unloaded.
      const ys = r.ys.length ? r.ys : [r.before.y];
      assert.ok(Math.max(...ys) - Math.min(...ys) < 0.05, `player stood still while loading (y ${Math.min(...ys)}..${Math.max(...ys)})`);
      const there = await h.eval((g, x, z) => ({
        // The terrain chunk under the arrival is built (no hole), the region there is the destination.
        chunk: g.ctx.world.terrain.hasChunkAt(x, z),
        region: g.ctx.world.regionAt(x, z)?.id ?? null,
        grounded: g.state().player.grounded,
      }), r.after.x, r.after.z);
      assert.ok(there.chunk, 'terrain chunk built under the arrival');
      assert.equal(there.region, region, 'arrived in the right region');
      assert.ok(there.grounded, 'standing on the ground after arrival');
      console.log(`  ${id}: ${(r.ms / 1000).toFixed(1)} s`);
    });

  await trip('bss_lower_ring', 651, -34, 'ba_sing_se');
  await trip('fn_plaza', -1294, 1596, 'fire_nation_capital');
  await trip('nwt_plaza', -214, -1608, 'northern_water_tribe');

  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 5).join('\n'));
  });
} catch (e) {
  results.push(['FAIL', 'exception', e?.message ?? String(e)]);
  console.log('FAIL | exception |', e?.message ?? e);
} finally {
  await h.close();
}
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASSED');
process.exit(failed.length ? 1 : 0);
