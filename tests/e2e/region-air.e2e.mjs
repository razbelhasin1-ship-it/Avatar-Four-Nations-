/**
 * Air region E2E: the Southern Air Temple summit, the switchback trail with its
 * gorge stair-bridge, and the Shrine of the Four Winds.
 *  - walks key routes (spawn → labyrinth → grand stair → spire terrace;
 *    training court → curved stair → walkway → sanctum; moon gate → cliff
 *    balcony; trailhead gate → bridge → switchbacks → summit gate)
 *  - checks walkable heights (groundAt), solid rim railings, registered water
 *    sources (g.waterNearby), published spots, no console errors
 *  - reports draw calls / triangles / fps at the region centre
 * Run: node tests/e2e/region-air.e2e.mjs [--preset medium]
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

const Y0 = 330;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

/** Walk toward (x, z) (re-aiming every few frames). Returns the final player state. */
async function walkTo(x, z, o = {}) {
  return h.eval(
    (g, x, z, o) => {
      const tol = o.tol ?? 1.2;
      const max = o.max ?? 900;
      // Walking is pure simulation: skip the (software) render of every stepped frame.
      const R = g.ctx.render;
      const render = R.render;
      R.render = () => {};
      try {
        let p = g.state().player;
        let minY = p.y, maxY = p.y, steps = 0, stuck = 0, last = Infinity;
        if (o.sprint) g.ctx.input.setVirtual('sprint', true);
        for (; steps < max; steps += 3) {
          p = g.state().player;
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < tol) break;
          if (steps % 30 === 0) {
            if (last - d < 0.3) stuck++;
            else stuck = 0;
            last = d;
            if (stuck >= 3) break;
          }
          g.faceTowards(x, z);
          g.move(0, 1);
          g.step(3);
          p = g.state().player;
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        g.move(0, 0);
        if (o.sprint) g.ctx.input.setVirtual('sprint', false);
        g.step(4);
        p = g.state().player;
        return { x: p.x, y: p.y, z: p.z, grounded: p.grounded, minY, maxY, steps, dist: Math.hypot(x - p.x, z - p.z) };
      } finally {
        R.render = render;
      }
    },
    x,
    z,
    o,
  );
}

async function walkPath(points, o = {}) {
  let r = null;
  for (const [x, z] of points) {
    r = await walkTo(x, z, o);
    assert.ok(r.dist < (o.tol ?? 1.2) + 0.6, `stuck before (${x}, ${z}): ${JSON.stringify(r)}`);
  }
  return r;
}

const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);

try {
  await check('air start: spawn is clear, flat and grounded on the plaza', async () => {
    await h.newGame('air');
    // Walking checks render every simulated frame: keep the software renderer cheap.
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
    await h.step(10);
    const p = (await h.state()).player;
    near(p.x, 1440, 0.5, 'spawn x');
    near(p.z, 1290, 0.5, 'spawn z');
    near(p.y, Y0 + 0.15, 0.1, 'spawn on plaza paving');
    assert.ok(p.grounded, 'grounded at spawn');
    assert.equal((await h.state()).region, 'southern_air_temple');
    const regs = await h.eval((g) => g.debug.air.regions().map((r) => r.id));
    for (const id of ['air_temple_summit', 'air_temple_trail']) assert.ok(regs.includes(id), `region ${id} built: ${regs}`);
  });

  await check('spots: masters, training grounds, givers, habitats, updrafts, viewpoints', async () => {
    const spots = await h.eval((g) => g.debug.air.spots());
    for (const id of ['master_tenzo', 'master_iio', 'master_pasang', 'master_hermit', 'giver_air_elder', 'habitat_bison_stable', 'habitat_sky_bison_1', 'merchant_air_temple_1', 'shrine_wind', 'viewpoint_air_sanctum', 'glide_launch_east', 'updraft_1', 'viewpoint_air_trail_1', 'bridge_air_gorge', 'shrine_air_chortens', 'shrine_air_bell']) {
      assert.ok(spots[id], `spot ${id} missing`);
    }
    for (const t of ['training_tenzo', 'training_iio', 'training_pasang', 'training_hermit']) {
      assert.ok(spots[t] && spots[t].r >= 12, `${t} radius >= 12`);
    }
    // Training grounds are flat and open: ground height constant over the circle.
    for (const t of ['training_tenzo', 'training_iio', 'training_pasang', 'training_hermit']) {
      const s = spots[t];
      const hs = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const r of [0, 6, 11.5]) hs.push(await ground(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, s.y + 1.5));
      }
      const spread = Math.max(...hs) - Math.min(...hs);
      assert.ok(spread < 0.2, `${t} not flat (spread ${spread.toFixed(2)}): ${hs.map((v) => v.toFixed(2)).join(',')}`);
      near(hs[0], s.y, 0.12, `${t} floor height`);
    }
    const n = Object.keys(spots).filter((k) => k.startsWith('updraft_')).length;
    assert.ok(n >= 5, `updraft spots: ${n}`);
  });

  await check('walk: spawn → labyrinth → grand stair → spire terrace (+6 m)', async () => {
    await h.eval((g) => g.teleport(1440, 1290));
    const r = await walkPath([[1449, 1262], [1450, 1250], [1450, 1230], [1450, 1219], [1450, 1206]], { tol: 1.3, sprint: true });
    near(r.y, Y0 + 6, 0.2, 'terrace height');
    assert.ok(r.grounded, 'grounded on terrace');
    near(await ground(1450, 1250), Y0 + 0.3, 0.05, 'labyrinth floor');
  });

  await check('walk: spire terrace → stair round the drum → terrace (+13) → stair round the tower drum → great tower (+19.5)', async () => {
    const B = { x: 1450, z: 1188 }, C = { x: 1450, z: 1187 };
    const onB = (a, r) => [B.x + Math.cos((a * Math.PI) / 180) * r, B.z + Math.sin((a * Math.PI) / 180) * r];
    const onC = (a, r) => [C.x + Math.cos((a * Math.PI) / 180) * r, C.z + Math.sin((a * Math.PI) / 180) * r];
    await h.eval((g, p) => g.teleport(p[0], p[1]), onB(90, 16.7));
    await h.step(20);
    let r = await walkPath([onB(80, 16.7), ...[70, 50, 30, 10, -10, -28].map((a) => onB(a, 16.7)), onB(-28, 13)], { tol: 1.0 });
    near(r.y, Y0 + 13, 0.3, 'round terrace height');
    r = await walkPath([onC(330, 12.3), onC(300, 12.0), onC(282, 12.0), onC(280, 9.65), ...[295, 315, 335, 355, 375, 395, 415, 424].map((a) => onC(a, 9.65)), onC(66, 6.4)], { tol: 1.0 });
    near(r.y, Y0 + 19.5, 0.3, 'great tower terrace height');
    assert.ok(r.grounded, 'grounded at the foot of the great tower');
  });

  await check('walk: training court → curved stair → walkway (+5) → sanctum (+9)', async () => {
    await h.eval((g) => g.teleport(1488, 1241));
    const c = { x: 1512, z: 1241 };
    const arc = [205, 214, 226, 238, 250, 259].map((a) => [c.x + Math.cos((a * Math.PI) / 180) * 9.5, c.z + Math.sin((a * Math.PI) / 180) * 9.5]);
    let r = await walkPath([[1500, 1238.5], ...arc, [1511.4, 1231.6], [1513.5, 1229]], { tol: 0.9 });
    near(r.y, Y0 + 5, 0.25, 'walkway height');
    r = await walkPath([[1513.5, 1223], [1511.4, 1218.5], [1509, 1214.5], [1504, 1208]], { tol: 1.0 });
    near(r.y, Y0 + 9, 0.25, 'sanctum height');
    // Spire terrace ↔ sanctum bridge stair.
    r = await walkPath([[1490, 1202], [1478, 1202], [1470, 1202]]);
    near(r.y, Y0 + 6, 0.25, 'back on the spire terrace');
  });

  await check('walk: through the moon gate onto the east cliff balcony', async () => {
    await h.eval((g) => g.teleport(1490, 1241));
    const r = await walkPath([[1505, 1241], [1513.5, 1241], [1522, 1241], [1528, 1238]]);
    near(r.y, Y0 + 0.15, 0.2, 'balcony height');
  });

  await check('walk: plaza → stables walk → into the bison stables; plaza → library walk', async () => {
    await h.eval((g) => g.teleport(1450 - 25, 1250 + 34));
    let r = await walkPath([[1450 - 56, 1250 + 37.6], [1450 - 57.8, 1250 + 34.4], [1450 - 65.2, 1250 + 39.5]], { tol: 1.2 });
    near(r.y, Y0 + 0.3, 0.2, 'stables floor');
    await h.eval((g) => g.teleport(1450 + 20, 1250 + 55));
    r = await walkPath([[1450 + 29, 1250 + 58.6], [1450 + 42.5, 1250 + 59.5]], { tol: 1.2 });
    near(r.y, Y0 + 0.12, 0.2, 'library walk');
  });

  await check('rim: balustrade stops a runner at the cliff (r < 92.5)', async () => {
    await h.eval((g) => g.teleport(1450, 1330 - 12));
    const r = await walkTo(1450, 1250 + 120, { max: 240, tol: 0.5 });
    const rr = Math.hypot(r.x - 1450, r.z - 1250);
    assert.ok(rr < 92.5 && r.y > Y0 - 0.5, `went past the rim rail: r=${rr.toFixed(1)} y=${r.y}`);
    // West side (garden lawn) too.
    await h.eval((g) => g.teleport(1450 - 70, 1250 + 20));
    const r2 = await walkTo(1450 - 130, 1250 + 35, { max: 240, tol: 0.5 });
    const rr2 = Math.hypot(r2.x - 1450, r2.z - 1250);
    assert.ok(rr2 < 92.5 && r2.y > Y0 - 0.5, `went past the west rim rail: r=${rr2.toFixed(1)} y=${r2.y}`);
  });

  await check('water: fountain, pond, canal, spring, falls and stable basin are real sources', async () => {
    const ids = await h.eval((g) => g.debug.air.regions().flatMap((r) => r.water));
    for (const id of ['air_plaza_fountain', 'air_garden_pond', 'air_garden_canal', 'air_west_falls', 'air_east_spring', 'air_east_falls', 'air_stable_trough']) assert.ok(ids.includes(id), `water ${id} registered`);
    await h.eval((g) => g.teleport(1460, 1290));
    let w = await h.eval((g) => g.waterNearby(15));
    assert.ok(w.some((s) => s.id === 'air_plaza_fountain'), 'fountain near plaza: ' + JSON.stringify(w));
    await h.eval((g) => g.teleport(1392, 1252));
    w = await h.eval((g) => g.waterNearby(18));
    assert.ok(w.some((s) => s.id === 'air_garden_pond'), 'garden pond: ' + JSON.stringify(w));
    await h.eval((g) => g.setElement('water'));
    const drawn = await h.eval((g) => g.drawWater(20));
    assert.ok(drawn && drawn.reserve > 0, 'drew water from the pond: ' + JSON.stringify(drawn));
    await h.eval((g) => g.setElement('air'));
  });

  await check('trail: trailhead gate → gorge stair-bridge → foot of the switchbacks', async () => {
    await h.eval((g) => g.teleportTo('air_trailhead'));
    await h.step(5);
    const tr = await h.eval((g) => g.debug.air.trail && { top: g.debug.air.trail.bridgeTop, foot: g.debug.air.trail.at(0) });
    assert.ok(tr, 'trail debug hook');
    let r = await walkPath([[tr.top.x, tr.top.z]], { tol: 1.0 });
    const y0 = r.y;
    // Down the bridge in three legs.
    const pts = [0.3, 0.65, 1].map((t) => [tr.top.x + (tr.foot.x - tr.top.x) * t, tr.top.z + (tr.foot.z - tr.top.z) * t]);
    r = await walkPath(pts, { tol: 1.5, sprint: true });
    assert.ok(r.minY > tr.foot.y - 1.5, `fell off the bridge (minY ${r.minY})`);
    near(r.y, tr.foot.y, 0.6, 'arrived at the foot of the switchbacks');
    assert.ok(y0 - r.y > 20, `descended the bridge (${y0} → ${r.y})`);
  });

  await check('trail: switchback stairs climb past every turn to the summit gate', async () => {
    const t = await h.eval((g) => ({ cum: g.debug.air.trail.cum, length: g.debug.air.trail.length }));
    for (let i = 1; i < t.cum.length - 1; i++) {
      const a = await h.eval((g, s) => g.debug.air.trail.at(s), t.cum[i] - 14);
      const c = await h.eval((g, s) => g.debug.air.trail.at(s), t.cum[i]);
      const b = await h.eval((g, s) => g.debug.air.trail.at(s), t.cum[i] + 14);
      await h.eval((g, a) => g.teleport(a.x, a.z), a);
      await h.step(4);
      const r = await walkPath([[c.x, c.z], [b.x, b.z]], { tol: 1.4 });
      // On the stairs the feet ride the ramp collider ~0.14 m above the carved trail (grade 0.75).
      const yHere = await h.eval((g, x, z) => g.ctx.world.groundAt(x, z, 1e9).y, r.x, r.z);
      near(r.y, yHere, 0.35, `turn ${i}: standing on the stairs`);
      near(r.y, b.y + 0.14, 1.4, `turn ${i}: height after the turn`);
      assert.ok(r.grounded, `turn ${i}: grounded`);
    }
    // Last stretch through the summit gate.
    const a = await h.eval((g, s) => g.debug.air.trail.at(s), t.length - 16);
    await h.eval((g, a) => g.teleport(a.x, a.z), a);
    await h.step(4);
    const r = await walkPath([[1373.8, 1214.6], [1386, 1222], [1400, 1229]], { tol: 1.3 });
    near(r.y, Y0 + 0.12, 0.4, 'inside the summit gate');
  });

  await check('trail: resting landings are flat and walkable', async () => {
    const ls = await h.eval((g) => g.debug.air.trail.landings);
    for (const l of ls) {
      const g0 = await ground(l.x, l.z);
      const g1 = await ground(l.x + 2, l.z + 2);
      near(g0, g1, 0.05, 'landing flat');
    }
  });

  await check('wind shrine: hidden ledge is flat, walkable and railed', async () => {
    const s = await h.eval((g) => g.debug.air.spots().training_hermit);
    await h.eval((g, s) => g.teleport(s.x, s.z), s);
    await h.step(30);
    const p = (await h.state()).player;
    near(p.y, s.y, 0.15, 'ledge height');
    const r = await walkPath([[s.x + 8, s.z + 4], [s.x - 6, s.z + 8], [s.x - 8, s.z - 2]], { tol: 1.2 });
    near(r.y, s.y, 0.2, 'stayed on the ledge');
    const regs = await h.eval((g) => g.debug.air.regions().map((r) => r.id));
    assert.ok(regs.includes('air_wind_shrine'), 'shrine built');
  });

  await check('detail levels: far keeps the silhouette, hidden hides all, full restores', async () => {
    const r = await h.eval((g) => {
      const reg = g.debug.air.region('air_temple_summit');
      const count = () => {
        let n = 0;
        reg.group.traverseVisible((o) => {
          if (o.isMesh) n++;
        });
        return n;
      };
      const full = count();
      reg.setDetail('far');
      const far = count();
      reg.setDetail('hidden');
      const hidden = reg.group.visible ? count() : 0;
      reg.setDetail('full');
      return { full, far, hidden, after: count() };
    });
    assert.ok(r.far > 0 && r.far < r.full, `far detail hides props but keeps architecture: ${JSON.stringify(r)}`);
    assert.equal(r.hidden, 0, 'hidden detail hides everything');
    assert.equal(r.after, r.full, 'full detail restored');
  });

  await check('session restart: interactions re-registered, no duplicate regions or leaks', async () => {
    const mem = () => h.eval((g) => ({ geo: g.ctx.render.renderer.info.memory.geometries, tex: g.ctx.render.renderer.info.memory.textures, regions: g.debug.air.regions().length }));
    // Two restarts at the same place: the first may upload geometry never drawn
    // before (monks streaming in at the spawn); a leak keeps growing on the second.
    await h.newGame('air');
    await h.step(10);
    const before = await mem();
    await h.newGame('air');
    await h.step(10);
    const after = await mem();
    assert.equal(after.regions, before.regions, 'region count stable');
    assert.ok(after.geo <= before.geo + 8, `geometries grew ${before.geo} -> ${after.geo}`);
    assert.ok(after.tex <= before.tex + 2, `textures grew ${before.tex} -> ${after.tex}`);
    const ok = await h.eval((g) => {
      const bell = g.ctx.interactions.get('air_great_bell');
      const gong = g.ctx.interactions.get('air_gong');
      if (!bell || !gong) return false;
      bell.interact();
      return true;
    });
    assert.ok(ok, 'bell and gong interactions registered after restart');
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
  });

  await check('perf: draw calls / triangles / fps at the region centre', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    await h.eval((g) => g.teleport(1440, 1290));
    await h.eval((g) => g.faceTowards(1450, 1200));
    await h.step(20);
    await h.wait(1500);
    const a = (await h.state()).render;
    await h.eval((g) => g.freeCamera({ x: 1330, y: 420, z: 1400 }, { x: 1450, y: 335, z: 1240 }));
    await h.step(5);
    await h.wait(1500);
    const b = (await h.state()).render;
    await h.eval((g) => g.freeCamera(null));
    const regs = await h.eval((g) => g.debug.air.regions().map((r) => ({ id: r.id, buildMs: r.buildMs, finishMs: r.finishMs, maxFinishStepMs: r.maxFinishStepMs, colliders: r.colliders, tris: r.triangles })));
    console.log(`  [${preset}] spawn view: calls=${a.drawCalls} tris=${a.triangles} fps=${a.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] aerial view: calls=${b.drawCalls} tris=${b.triangles} fps=${b.fps?.toFixed?.(1)}`);
    console.log('  regions: ' + JSON.stringify(regs));
    assert.ok(b.drawCalls < 600, `aerial draw calls ${b.drawCalls}`);
  });

  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 5).join('\n'));
  });
} finally {
  await h.close();
}
let failed = 0;
for (const r of results) if (r[0] === 'FAIL') failed++;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
