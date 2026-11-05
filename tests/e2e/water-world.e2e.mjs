// Water and paving in Ba Sing Se (and every water surface sharing their look):
//  - city basins, canals, puddles and jars use the shared water shader (WaterLook) and the sea /
//    rivers share its ripple field;
//  - drawing water rings the surface and lowers a basin, which rises again as it refills; wading
//    leaves a wake; spent water splashes rings where it lands;
//  - bent water takes the tone of the source it came from;
//  - the streets and plazas are paved with real stone textures (albedo + normal + roughness) whose
//    resolution (and stone relief) follows the graphics quality live, generated without stalling the game.
// Run: node tests/e2e/water-world.e2e.mjs   (SHOTS=dir saves screenshots)
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.SHOTS || '';
let h = null;
const ev = (fn, ...a) => h.eval(fn, ...a);
/** Deterministic steps (the real-time loop is stopped), never rendered. */
const step = (n, dt = 1 / 30) => ev((g, n, dt) => { const R = g.ctx.render, r = R.render; R.render = () => {}; try { for (let i = 0; i < n; i++) g.step(1, dt); } finally { R.render = r; } }, n, dt);
const shot = async (name) => {
  if (!SHOTS) return;
  await h.step(2);
  await h.shot(`${SHOTS}/${name}.jpg`, { quality: 84, timeout: 180000 }).catch((e) => console.log('   (screenshot failed)', e.message.split('\n')[0]));
};
const pavingPending = () => h.page.evaluate(async () => (await import('/src/world/kit/Paving.ts')).pavingPending());
async function pavingDone(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await pavingPending())) return true;
    await h.wait(250);
  }
  return false;
}
const bendTone = () => h.page.evaluate(async () => (await import('/src/combat/water/WaterMaterials.ts')).bendTone());
/** Paving texture sizes of the Ba Sing Se ground materials (by material name). */
const paving = () =>
  ev((g) => {
    const out = {};
    g.ctx.scene.traverse((o) => {
      const ms = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (!m || !/^earth_(ground|road|sand)/.test(m.name) || out[m.name]) continue;
        out[m.name] = { map: m.map?.image?.width ?? 0, normal: m.normalMap?.image?.width ?? 0, key: m.customProgramCacheKey?.() ?? '' };
      }
    });
    return out;
  });

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

try {
  console.log('Water and paving (Ba Sing Se)');
  h = await launch({ width: 960, height: 540 });
  await h.newGame('earth');
  await ev((g) => { g.setting('graphics.effectsQuality', 'medium'); g.setTime(10.5); g.freezeTime(true); g.game.stop(); });
  await step(30);
  const F = await ev((g) => { const s = g.ctx.water.get('ba_sing_se:firelight_fountain'); return s ? { x: s.x, y: s.y, z: s.z, r: s.r, cap: s.capacity } : null; });
  assert.ok(F, 'the Firelight Fountain is a water source');

  await check('every water surface in the city uses the shared water shader, ripples shared with the sea', async () => {
    const r = await ev((g) => {
      const bad = [], basins = [], containers = [];
      let worldWater = 0, worldShared = 0, rip = null;
      g.ctx.scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const m = o.material;
        if (m.name === 'basin_water') {
          rip ??= m.uniforms.uRipples;
          if (o.name.startsWith('water_')) basins.push(o.name);
          else containers.push(o.name || o.parent?.name || '?');
        }
        // Water-source surfaces (water_<source id>) must be one of the shared water shaders.
        if (/^water_.*:/.test(o.name) && m.visible !== false && !m.uniforms?.uRipples) bad.push(`${o.name}: ${m.type} ${m.name}`);
      });
      g.ctx.scene.traverse((o) => {
        const m = o.isMesh ? o.material : null;
        if (!m || !m.uniforms || m.name === 'basin_water' || !m.uniforms.uRipples) return;
        worldWater++;
        if (m.uniforms.uRipples === rip) worldShared++;
      });
      const fountain = g.ctx.scene.getObjectByName('water_ba_sing_se:firelight_fountain');
      const jars = (g.debug.waterContainers?.list?.() ?? []).length;
      return { bad, basins: basins.length, containers: containers.length, jars, worldWater, worldShared, fountain: fountain ? { mat: fountain.material.name, spout: fountain.material.uniforms?.uFountain?.value } : null };
    });
    assert.deepEqual(r.bad, [], 'flat water surfaces left');
    assert.ok(r.basins >= 3, `basin surfaces: ${r.basins}`);
    assert.equal(r.fountain?.mat, 'basin_water');
    assert.ok(r.fountain.spout > 0, 'the fountain stirs its middle');
    if (r.jars) assert.ok(r.containers >= 1, `jar / barrel water: ${r.containers} of ${r.jars}`);
    assert.ok(r.worldWater >= 1 && r.worldShared === r.worldWater, `sea/river shaders share the ripple field: ${r.worldShared}/${r.worldWater}`);
  });

  await check('drawing water rings the surface and lowers the basin; it rises again as it refills', async () => {
    await ev((g, f) => { g.unlockAllElements(); g.learnAll(); g.setElement('water'); g.teleport(f.x + f.r + 1.6, f.z + 0.4); }, F);
    await step(20);
    await ev((g, f) => g.faceTowards(f.x, f.z), F);
    const base = await ev((g) => g.debug.waterLife.basins().find((b) => /firelight/.test(b.id)));
    assert.ok(base && base.drop > 0, 'the fountain is a tracked basin');
    const drawn = await ev((g) => g.drawWater(40));
    assert.ok(drawn, 'drew water');
    const rings = await ev((g, f) => g.debug.waterLife.ripples().filter((r) => Math.hypot(r.x - f.x, r.z - f.z) < f.r + 1), F);
    assert.ok(rings.length >= 1, 'a ring where the water was drawn');
    await step(45);
    const low = await ev((g) => g.debug.waterLife.basins().find((b) => /firelight/.test(b.id)));
    const src = await ev((g) => { const s = g.ctx.water.get('ba_sing_se:firelight_fountain'); return { a: s.amount, c: s.capacity }; });
    const expected = base.base - (1 - src.a / src.c) * base.drop;
    assert.ok(low.level < base.base - 0.004, `level dropped: ${base.base} → ${low.level}`);
    assert.ok(Math.abs(low.level - expected) < 0.02, `level follows the fill: ${low.level} vs ${expected.toFixed(3)}`);
    const mesh = await ev((g) => g.ctx.scene.getObjectByName('water_ba_sing_se:firelight_fountain').position.y);
    assert.ok(Math.abs(mesh - low.level) < 1e-3, 'the surface mesh sits at the level');
    await ev((g) => { const s = g.ctx.water.get('ba_sing_se:firelight_fountain'); s.amount = s.capacity; });
    await step(45);
    const full = await ev((g) => g.debug.waterLife.basins().find((b) => /firelight/.test(b.id)));
    assert.ok(Math.abs(full.level - base.base) < 0.003, `refilled: ${full.level}`);
  });

  await check('bent water takes the tone of its source', async () => {
    assert.equal(await bendTone(), 'clear', 'from the fountain');
    await ev((g, f) => g.ctx.events.emit('water:drawn', { sourceId: 'ba_sing_se:zoo_pond', sourceType: 'pond', amount: 1, position: { x: f.x, y: f.y, z: f.z } }), F);
    assert.equal(await bendTone(), 'pond', 'from the zoo pond');
    await ev((g) => g.ctx.events.emit('water:drawn', { sourceId: 'ocean', sourceType: 'ocean', amount: 1, position: { x: 0, y: 0, z: 0 } }));
    assert.equal(await bendTone(), 'sea', 'from the sea');
  });

  await check('wading through the basin leaves a wake', async () => {
    const before = await ev((g) => g.debug.waterLife.ripples().length);
    await ev((g, f) => g.teleport(f.x + 3.2, f.z - 2.5, f.y - 0.4), F);
    await step(4);
    const p0 = await ev((g) => g.game.player.position.toArray());
    await ev((g) => g.move(0, 1));
    await step(30);
    await ev((g) => g.move(0, 0));
    const p1 = await ev((g) => g.game.player.position.toArray());
    const near = await ev((g, a, b) => g.debug.waterLife.ripples().filter((r) => r.age < 1.2 && Math.min(Math.hypot(r.x - a[0], r.z - a[2]), Math.hypot(r.x - b[0], r.z - b[2]), 3) < 3).length, p0, p1);
    assert.ok(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.5, 'the player moved');
    assert.ok(near >= 2, `wake rings along the path: ${near} (before: ${before})`);
  });

  await check('spent water splashes rings where it lands and refills the basin', async () => {
    const r = await ev((g, f) => {
      const s = g.ctx.water.get('ba_sing_se:firelight_fountain');
      s.amount = s.capacity * 0.5;
      const before = s.amount;
      const seen = [];
      const off = g.ctx.events.on('water:released', (e) => seen.push(e));
      const id = g.ctx.water.release({ x: f.x + f.r + 3, y: f.y, z: f.z }, 20);
      off();
      const ring = g.debug.waterLife.ripples().slice(-1)[0];
      return { id, seen, gained: s.amount - before, ring, dist: ring ? Math.hypot(ring.x - f.x, ring.z - f.z) : 99 };
    }, F);
    assert.equal(r.id, 'ba_sing_se:firelight_fountain');
    assert.equal(r.seen.length, 1, 'one water:released event');
    assert.ok(r.gained > 10, `basin refilled by ${r.gained}`);
    assert.ok(r.dist <= F.r, `the splash lands on the water (${r.dist.toFixed(2)} m from the centre, r ${F.r})`);
  });

  await check('the paving is real stone: albedo + normal maps in world space, full size once generated', async () => {
    assert.ok(await pavingDone(), 'paving generation finished');
    const p = await paving();
    const names = Object.keys(p);
    assert.ok(names.includes('earth_groundLower') && names.includes('earth_road'), `paving materials: ${names.join(', ')}`);
    for (const [n, t] of Object.entries(p)) {
      assert.equal(t.key, 'paving_world_uv', `${n} is world-mapped`);
      assert.ok(t.map >= 512 && t.normal >= 256, `${n} at medium quality: ${t.map}/${t.normal}`);
    }
  });

  await check('paving and water detail follow the graphics quality live', async () => {
    await ev((g) => g.setting('graphics.effectsQuality', 'low'));
    await step(2);
    assert.equal(await ev((g) => g.debug.waterLife.detail()), 0, 'water detail low');
    assert.ok(await pavingDone(), 'low paving generated');
    let p = await paving();
    for (const [n, t] of Object.entries(p)) {
      assert.equal(t.map, 256, `${n} low: ${t.map}`);
      assert.equal(t.normal, 0, `${n} low: painted stones without the relief`);
    }
    await ev((g) => g.setting('graphics.effectsQuality', 'high'));
    await step(2);
    assert.equal(await ev((g) => g.debug.waterLife.detail()), 1, 'water detail high');
    // The game keeps running while the big textures are generated in slices.
    const t0 = Date.now();
    await step(10);
    assert.ok(Date.now() - t0 < 20000, 'steps while generating');
    assert.ok(await pavingDone(120000), 'high paving generated');
    p = await paving();
    assert.equal(p.earth_groundLower.map, 1024, 'the Lower Ring setts are full size on high');
    assert.equal(p.earth_road.map, 1024, 'the streets are full size on high');
    assert.equal(p.earth_groundLower.normal, 512, 'the relief is back on high');
    await ev((g) => g.setting('graphics.effectsQuality', 'medium'));
    await step(2);
    assert.ok(await pavingDone(), 'medium paving');
    assert.equal((await paving()).earth_groundLower.map, 512);
  });

  if (SHOTS) {
    await ev((g) => g.setting('graphics.effectsQuality', 'high'));
    await pavingDone(120000);
    await ev((g) => g.hideUI(true));
    await ev((g, f) => g.freeCamera({ x: f.x + f.r + 2.5, y: f.y + 1.7, z: f.z + 2.2 }, { x: f.x, y: f.y, z: f.z }), F);
    await shot('fountain');
    await ev((g, f) => g.freeCamera({ x: f.x + 1, y: f.y + 12, z: f.z + 8 }, { x: f.x, y: f.y, z: f.z - 2 }), F);
    await shot('plaza_top');
  }

  await check('no console errors', async () => {
    assert.deepEqual(h.errors, []);
  });
} finally {
  await h?.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
