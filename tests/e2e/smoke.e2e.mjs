/**
 * Smoke E2E: boot → new game → combat vs dummy → source-dependent waterbending → save/load.
 * Run: node tests/e2e/smoke.e2e.mjs
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
  await check('fire: basic attacks damage a training dummy', async () => {
    await h.newGame('fire');
    const d = await h.eval((g) => g.spawnDummy(5, 0));
    for (let i = 0; i < 4; i++) {
      const r = await h.eval((g, d) => g.cast('fire_jab', { x: d.x, y: d.y + 1.2, z: d.z }), d);
      assert.ok(r.ok || r.reason === 'busy', 'cast failed: ' + JSON.stringify(r));
      await h.step(10);
    }
    await h.step(20);
    const info = await h.eval((g, id) => g.entityInfo(id), d.id);
    assert.ok(info.totalDamage > 0, 'dummy took no damage: ' + JSON.stringify(info));
  });
  await check('water: snow and ice melt into water (the press gathers them); no source at all → refused with water reason', async () => {
    await h.newGame('water');
    await h.eval((g) => g.teleport(-140, -1600));
    const near = await h.eval((g) => g.waterNearby(16));
    const r = await h.eval((g) => g.cast('water_whip', null));
    if (near.length === 0) assert.equal(r.reason, 'water', JSON.stringify(r));
    else assert.equal(r.reason, 'gather', 'water, snow or ice nearby: the empty-handed press gathers it: ' + JSON.stringify({ r, near }));
    await h.step(60);
  });
  await check('water: canal source → first press gathers water into the hands, second press bends it', async () => {
    await h.eval((g) => g.teleport(-246, -1720));
    await h.step(5);
    await h.eval((g) => g.debug.water.setReserve(0));
    const near = await h.eval((g) => g.waterNearby(16));
    assert.ok(near.length > 0, 'expected a nearby canal: ' + JSON.stringify(near));
    // Empty hands: the press becomes a gather instead of bending the river from a distance.
    const first = await h.eval((g) => g.cast('water_whip', null));
    assert.equal(first.reason, 'gather', JSON.stringify(first));
    await h.step(60);
    const held = await h.eval((g) => g.ctx.player.waterReserve);
    assert.ok(held >= 8, 'water should now be held: ' + held);
    const r = await h.eval((g) => g.cast('water_whip', null));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.water && r.water.source, 'reserve', JSON.stringify(r));
  });
  await check('save and load round-trip', async () => {
    await h.eval((g) => g.teleport(-236, -1600));
    await h.step(5);
    const ok = await h.eval((g) => g.save('slot3'));
    assert.ok(ok, 'save failed');
    const before = await h.state();
    // Software-rendered reloads can take well over 30 s on a loaded machine.
    await h.page.reload({ timeout: 120000 });
    await h.page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const loaded = await h.eval((g) => g.loadGame('slot3'));
    assert.ok(loaded, 'load failed');
    const after = await h.state();
    assert.equal(after.player.element, before.player.element);
    assert.equal(after.progression.start, 'water');
    assert.ok(Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z) < 3, 'position not restored');
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
