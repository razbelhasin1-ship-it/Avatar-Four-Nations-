/**
 * World environment E2E: vegetation streaming + colliders + live density,
 * grass, footprints and combat decals (world.fx), weather (rain → water
 * source, events), ambient systems. Run: node tests/e2e/env.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};

try {
  await h.newGame('earth');
  await h.eval((g) => {
    g.ctx.settings.set('graphics.ambientEffects', true);
    g.ctx.settings.set('graphics.grassDensity', 0.6);
  });

  await check('vegetation streams around the player with trunk colliders', async () => {
    const r = await h.page.evaluate(async () => {
      const g = window.__game;
      await g.debug.env.preload(404, -684);
      g.step(3);
      return { stats: g.debug.env.vegetation(), near: g.debug.env.vegetationNear(404, -684, 40) };
    });
    assert.ok(r.stats.cells > 50, 'cells ' + JSON.stringify(r.stats));
    assert.ok(r.stats.drawn > 100, 'drawn ' + JSON.stringify(r.stats));
    assert.ok(r.stats.colliders > 10, 'colliders ' + JSON.stringify(r.stats));
    assert.ok(r.near.some((t) => t.species !== 'rock' && t.species !== 'bush'), 'expected trees near the forest spawn');
  });

  await check('a tree trunk blocks a ray (bending projectiles hit trees)', async () => {
    const hit = await h.page.evaluate(() => {
      const g = window.__game;
      const THREE = g.THREE;
      const trees = g.debug.env.vegetationNear(404, -684, 60).filter((t) => ['broadleaf', 'conifer', 'blossom', 'bamboo', 'pine_snow', 'palm', 'acacia'].includes(t.species));
      for (const t of trees) {
        const o = new THREE.Vector3(t.x - 4, t.y + 1.5, t.z);
        const d = new THREE.Vector3(1, 0, 0);
        const r = g.ctx.world.collision.raycast(o, d, 8);
        if (r) return { dist: r.distance, tree: t };
      }
      return null;
    });
    assert.ok(hit, 'no tree collider was hit');
    assert.ok(hit.dist > 0.3 && hit.dist < 4.2, JSON.stringify(hit));
  });

  await check('foliage density applies live', async () => {
    const r = await h.page.evaluate(() => {
      const g = window.__game;
      g.ctx.settings.set('graphics.foliageDensity', 1);
      g.step(2);
      const hi = g.debug.env.vegetation();
      g.ctx.settings.set('graphics.foliageDensity', 0.3);
      g.step(2);
      const lo = g.debug.env.vegetation();
      g.ctx.settings.set('graphics.foliageDensity', 0.5);
      g.step(2);
      return { hi, lo };
    });
    assert.ok(r.lo.drawn < r.hi.drawn * 0.6, JSON.stringify(r));
    assert.ok(r.lo.colliders < r.hi.colliders, JSON.stringify(r));
  });

  await check('grass draws on meadows and turns off at density 0', async () => {
    const r = await h.page.evaluate(async () => {
      const g = window.__game;
      await g.debug.env.preload(916, -684);
      g.step(4);
      const on = g.debug.env.grass();
      g.ctx.settings.set('graphics.grassDensity', 0);
      g.step(2);
      const off = g.debug.env.grass();
      g.ctx.settings.set('graphics.grassDensity', 0.6);
      return { on, off };
    });
    assert.ok(r.on.drawn > 500, JSON.stringify(r.on));
    assert.equal(r.off.radius, 0, JSON.stringify(r.off));
  });

  await check('combat decals: scorch, crack, wet and frost', async () => {
    const r = await h.page.evaluate(() => {
      const g = window.__game;
      g.debug.env.clearDecals();
      const p = g.game.player.position;
      g.debug.env.fx('scorch', { x: p.x + 3, z: p.z }, 1.5);
      g.debug.env.fx('crack', { x: p.x - 3, z: p.z }, 1.5);
      g.debug.env.fx('wet', { x: p.x, z: p.z + 3 }, 1.5);
      g.debug.env.fx('frost', { x: p.x, z: p.z - 3 }, 1.5);
      // Repeated hits at the same spot within a moment merge instead of stacking.
      for (let i = 0; i < 10; i++) g.debug.env.fx('scorch', { x: p.x + 3, z: p.z }, 1.5);
      g.step(2);
      return g.debug.env.decals();
    });
    assert.equal(r.patches, 3, JSON.stringify(r));
    assert.equal(r.frost, 1, JSON.stringify(r));
  });

  await check('snow footprints appear while walking and fade away', async () => {
    const r = await h.page.evaluate(async () => {
      const g = window.__game;
      await g.debug.env.preload(-600, -1650);
      g.debug.env.clearDecals();
      g.camera(0, 0.35, 7);
      g.move(0, 1);
      g.step(60, 1 / 20);
      g.move(0, 0);
      g.step(3);
      const after = g.debug.env.decals();
      // Prints fade over ~90 s on snow.
      g.step(50, 2);
      const later = g.debug.env.decals();
      return { after, later, surface: g.state().player };
    });
    assert.ok(r.after.prints >= 4, 'expected footprints: ' + JSON.stringify(r));
    assert.equal(r.later.prints, 0, 'prints should have faded: ' + JSON.stringify(r.later));
  });

  await check('weather: forced rain makes rain a water source and emits weather:changed', async () => {
    const r = await h.page.evaluate(() => {
      const g = window.__game;
      const seen = [];
      const off = g.ctx.events.on('weather:changed', (e) => seen.push(e.weather));
      g.debug.env.weather('rain');
      g.step(5);
      const rain = g.debug.env.weatherState();
      const near = g.waterNearby(10).map((n) => n.type);
      g.debug.env.weather('clear');
      g.step(5);
      const clear = g.debug.env.weatherState();
      g.debug.env.weather(null);
      if (typeof off === 'function') off();
      return { seen, rain, clear, near };
    });
    assert.ok(r.seen.includes('rain'), JSON.stringify(r.seen));
    assert.equal(r.rain.raining, true, JSON.stringify(r.rain));
    assert.ok(r.near.includes('rain'), 'rain should be a water source: ' + JSON.stringify(r.near));
    assert.equal(r.clear.raining, false, JSON.stringify(r.clear));
  });

  await check('each weather type can be forced and blends its fog', async () => {
    const r = await h.page.evaluate(() => {
      const g = window.__game;
      const out = {};
      for (const w of ['clear', 'cloudy', 'snow', 'blizzard', 'rain', 'fog', 'ashfall', 'sandstorm', 'wind']) {
        g.debug.env.weather(w);
        g.step(2);
        const s = g.debug.env.weatherState();
        out[w] = { fog: s.fogScale, wind: s.wind, weather: s.weather };
      }
      g.debug.env.weather(null);
      return out;
    });
    for (const [w, s] of Object.entries(r)) assert.equal(s.weather, w);
    assert.ok(r.blizzard.fog > r.snow.fog && r.sandstorm.fog > r.clear.fog && r.fog.fog > r.cloudy.fog, JSON.stringify(r));
    assert.ok(r.wind.wind > r.clear.wind, JSON.stringify(r));
  });

  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 5).join('\n'));
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
