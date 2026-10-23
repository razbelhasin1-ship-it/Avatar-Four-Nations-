/**
 * Fire Nation region E2E: the capital in the caldera, the rim gate, the
 * Capital Harbor, the Western Causeway, the Sun Warrior Ruins and Ember Island.
 *  - walks key routes (spawn → plaza → grand stair → Gate of Agni → palace
 *    landmark; forecourt → garden moon gate → turtle-duck pond; plaza → arena
 *    dais; plaza → temple court; caldera floor → terrace stair → terrace L1;
 *    boulevard → rim gate → causeway road → harbour overlook; road start →
 *    quay ramp → pier head; the whole causeway bridge; ruins approach stair →
 *    plaza → pyramid summit; Ember promenade → tea-house terrace → pier)
 *  - checks walkable heights (groundAt), registered water sources
 *    (g.waterNearby), published spots, detail levels, no console errors
 *  - reports draw calls / triangles / fps at the capital centre and the harbour
 * Run: node tests/e2e/region-fire.e2e.mjs [--preset medium]
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

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

/** Walk toward (x, z) (re-aiming every few frames). Returns the final player state. */
async function walkTo(x, z, o = {}) {
  return h.eval(
    (g, x, z, o) => {
      const tol = o.tol ?? 1.2;
      const max = o.max ?? 1500;
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
        return { x: p.x, y: p.y, z: p.z, grounded: p.grounded, swimming: p.swimming, minY, maxY, steps, dist: Math.hypot(x - p.x, z - p.z) };
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
    if (o.minY !== undefined) assert.ok(r.minY > o.minY, `fell below ${o.minY} on the way to (${x}, ${z}): ${JSON.stringify(r)}`);
  }
  return r;
}

const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);
const region = (id) => h.eval((g, id) => {
  const r = g.debug.fire.region(id);
  if (!r) return null;
  return JSON.parse(JSON.stringify({ ringStairs: r.ringStairs, overlookY: r.overlookY, overlookStair: r.overlookStair, rampTop: r.rampTop, approach: r.approach, summit: r.summit, altar: r.altar, perchY: r.perchY, teaY: r.teaY, pierEnd: r.pierEnd }));
}, id);

try {
  await h.newGame('fire');
  await h.eval((g) => g.setting('graphics.renderScale', 0.35));

  await check('fire start: spawn is clear, flat and grounded in the Royal Plaza', async () => {
    const st = await h.state();
    assert.equal(st.region, 'fire_nation_capital');
    near(st.player.x, -1310, 0.5, 'spawn x');
    near(st.player.z, 1230, 0.5, 'spawn z');
    near(st.player.y, 43.2, 0.3, 'spawn on the plaza');
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4]]) near(await ground(-1310 + dx, 1230 + dz, 60), 43.2, 0.05, `spawn surroundings flat (${dx},${dz})`);
    const regs = await h.eval((g) => g.debug.fire.regions().map((r) => r.id));
    for (const id of ['fire_capital']) assert.ok(regs.includes(id), `${id} built (${regs})`);
  });

  await check('spots: masters, training grounds, givers, merchants, docks, habitats, shrines', async () => {
    const spots = await h.eval((g) => g.debug.fire.spots());
    for (const id of ['master_jeong', 'training_jeong', 'master_hira', 'training_hira', 'master_ahkon', 'training_ahkon', 'master_iro', 'training_iro', 'giver_fn_elder', 'merchant_fn_1', 'merchant_fn_2', 'merchant_fn_3', 'merchant_ember_1', 'dock_fn_harbor', 'dock_ember_island', 'habitat_dragon_1', 'habitat_turtleduck_1', 'shrine_fire_sages', 'shrine_eternal_flame', 'bridge_western_causeway', 'viewpoint_fn_harbor']) {
      assert.ok(spots[id], `spot ${id} defined`);
    }
    for (const id of ['training_jeong', 'training_hira', 'training_ahkon', 'training_iro']) assert.ok(spots[id].r >= 12, `${id} radius ${spots[id].r}`);
    // Training grounds in the capital are flat and walkable over their radius.
    for (const id of ['training_jeong', 'training_hira']) {
      const s = spots[id];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const y = await ground(s.x + Math.cos(a) * (s.r - 1), s.z + Math.sin(a) * (s.r - 1), s.y + 3);
        near(y, s.y, 0.12, `${id} flat at r-1 (k=${k})`);
      }
    }
  });

  await check('walk: spawn → plaza → grand stair → Gate of Agni → palace landmark (+6.8 m)', async () => {
    await h.eval((g) => g.teleport(-1310, 1230));
    const r = await walkPath([[-1330, 1200], [-1330, 1166], [-1330, 1146], [-1330, 1128], [-1330, 1110]]);
    near(r.y, 50, 0.3, 'palace forecourt height');
  });

  await check('walk: forecourt → garden moon gate → turtle-duck pond (water source)', async () => {
    const r = await walkPath([[-1350, 1112], [-1362, 1100], [-1372, 1100], [-1385, 1095], [-1390, 1090]]);
    near(r.y, 50, 0.3, 'garden lawn height');
    const w = await h.eval((g) => g.waterNearby(25));
    assert.ok(w.some((s) => s.id === 'fire_capital:turtleduck_pond'), `pond source nearby: ${JSON.stringify(w)}`);
  });

  await check('walk: plaza → Agni Kai Arena dais; plaza canal is a water source', async () => {
    await h.eval((g) => g.teleport(-1300, 1236));
    const w = await h.eval((g) => g.waterNearby(20));
    assert.ok(w.some((s) => s.id.startsWith('fire_capital:canal')), `canal source: ${JSON.stringify(w)}`);
    // Over the canal bridge, through the east gallery passage and down its steps.
    const r = await walkPath([[-1290, 1236], [-1276, 1236], [-1263, 1236], [-1259, 1200], [-1248, 1180], [-1235, 1180]]);
    near(r.y, 43.6, 0.3, 'arena dais height');
  });

  await check("walk: plaza → Fire Sages' temple court", async () => {
    await h.eval((g) => g.teleport(-1380, 1180));
    const r = await walkPath([[-1398, 1172], [-1405, 1210], [-1412, 1233]]);
    near(r.y, 42.3, 0.3, 'temple court height');
  });

  await check('walk: caldera floor → terrace stair → city terrace L1', async () => {
    const cap = await region('fire_capital');
    assert.ok(cap.ringStairs.length >= 4, `ring stairs: ${cap.ringStairs.length}`);
    // Try stairs until one works (all should); report the climbed height.
    let ok = 0;
    for (const st of cap.ringStairs.slice(0, 3)) {
      // Start 3 m before the foot, in line with the flight, then climb to the landing and step onto L1.
      const dx = st.landing.x - st.foot.x, dz = st.landing.z - st.foot.z, dl = Math.hypot(dx, dz);
      await h.eval((g, x, z) => g.teleport(x, z), st.foot.x - (dx / dl) * 3, st.foot.z - (dz / dl) * 3);
      const r = await walkPath([[st.foot.x, st.foot.z], [st.landing.x, st.landing.z], [st.walk.x, st.walk.z]], { tol: 1.0 });
      near(r.y, st.walk.y, 0.35, 'standing on terrace L1');
      ok++;
    }
    assert.ok(ok >= 3);
  });

  await check('walk: boulevard → rim gate → causeway road → harbour overlook landmark', async () => {
    await h.eval((g) => g.teleport(-1249, 1138));
    let r = await walkPath([[-1200, 1112], [-1170, 1100], [-1110, 1075], [-1071, 1059], [-1040, 1043], [-1010, 1018]], { tol: 2.5 });
    assert.ok(r.y > 40, `on the causeway road outside the rim: ${JSON.stringify(r)}`);
    const hb = await region('fire_harbor');
    assert.ok(hb && hb.overlookStair, 'harbour region built with an overlook stair');
    r = await walkPath([[hb.overlookStair.x, hb.overlookStair.z], [-1006, 988], [-1010, 980]], { tol: 1.5 });
    near(r.y, hb.overlookY, 0.35, 'on the overlook terrace (fn_harbor landmark)');
  });

  await check('walk: causeway road start → quay ramp → north quay → pier head (dock_fn_harbor)', async () => {
    const hb = await region('fire_harbor');
    await h.eval((g, x, z) => g.teleport(x, z), hb.rampTop.x - 2, hb.rampTop.z);
    const r = await walkPath([[hb.rampTop.x + 4, hb.rampTop.z + 0.5], [-905, 971.5], [-897, 972], [-897, 985.5], [-875, 985.5], [-852, 985.5]], { tol: 1.5, minY: 3 });
    near(r.y, 5.2, 0.3, 'pier deck height');
    assert.ok(!r.swimming, 'not swimming');
  });

  await check('walk: the Western Causeway end to end over the strait (no falling)', async () => {
    await h.eval((g) => g.teleport(-938, 957));
    const pts = [];
    for (let t = 0.05; t <= 1.0001; t += 0.1) pts.push([-940 + (168 * t), 960 - 269 * t]);
    const r = await walkPath(pts, { tol: 2.0, minY: 0.9, sprint: true });
    assert.ok(r.y > 0.9 && !r.swimming, `reached the mainland end dry: ${JSON.stringify(r)}`);
  });

  await check('ruins: approach stair → plaza (training_ahkon) → pyramid summit; eternal flame', async () => {
    await h.eval((g) => g.teleport(-1585, 915));
    await h.step(10);
    const ru = await region('fire_sun_warrior_ruins');
    assert.ok(ru && ru.approach, 'ruins built');
    await h.eval((g, x, z) => g.teleport(x, z), ru.approach.x + 1.2, ru.approach.z + 1.2);
    const r1 = await walkPath([[-1567, 933], [-1560, 940]], { tol: 1.5 });
    assert.ok(r1.y > ru.altar.y - 0.4, `on the plaza: ${JSON.stringify(r1)}`);
    // Straight up the pyramid's central stair (the landmark lies on its axis).
    const r2 = await walkPath([[ru.summit.x, ru.summit.z]], { tol: 1.6 });
    assert.ok(r2.y > ru.summit.y - 1.2, `reached the summit: ${JSON.stringify(r2)}`);
    const flames = await h.eval((g) => g.debug.fire.regions().find((r) => r.id === 'fire_sun_warrior_ruins').flames);
    assert.ok(flames >= 3, 'eternal flame burning');
    // Training ground on the plaza is flat over its radius; the dragon's perch is a flat ledge.
    const sp = await h.eval((g) => g.debug.fire.spots());
    for (const id of ['training_ahkon', 'habitat_dragon_1']) {
      const t = sp[id];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const radii = id === 'habitat_dragon_1' ? [0, 2.5, 5] : [0, 6, 11];
        for (const rr of radii) near(await ground(t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr, t.y + 2), t.y, 0.15, `${id} flat (k=${k}, r=${rr})`);
      }
    }
  });

  await check('ember island: promenade → tea-house terrace (training_iro) → pier end', async () => {
    await h.eval((g) => g.teleport(-1600, 1786));
    await h.step(10);
    await h.eval((g) => g.teleport(-1600, 1786)); // again, now that the promenade colliders exist
    await h.step(4);
    const em = await region('fire_ember_island');
    assert.ok(em && em.teaY > 0, 'ember island built');
    // Promenade frame: P(along, inland) = a + u*along + n*inland.
    const P = (al, inl) => [-1585 - 0.864 * al - 0.504 * inl, 1778 + 0.504 * al - 0.864 * inl];
    const r = await walkPath([P(30, 0), P(70, 0), P(108, 0), P(108, 5), P(108, 21)], { tol: 1.5 });
    near(r.y, em.teaY, 0.35, 'on the tea-house terrace');
    const ti = (await h.eval((g) => g.debug.fire.spots())).training_iro;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (const rr of [0, 6, 11]) near(await ground(ti.x + Math.cos(a) * rr, ti.z + Math.sin(a) * rr, ti.y + 2), ti.y, 0.12, `training_iro flat (k=${k}, r=${rr})`);
    }
    // Theatre forecourt from the promenade (broad steps).
    const rt = await walkPath([P(108, 3), P(62, 0), P(62, 10)], { tol: 1.5 });
    const thY = await h.eval((g) => g.debug.fire.region('fire_ember_island').theaterY);
    near(rt.y, thY, 0.35, 'on the theatre forecourt');
    const r2 = await walkPath([P(62, 1), P(30, 0), P(18, -2), P(18, -30), [em.pierEnd.x, em.pierEnd.z]], { tol: 1.6, minY: 1 });
    near(r2.y, em.pierEnd.y, 0.35, 'pier deck');
  });

  await check('detail levels: far keeps the silhouette, hidden hides all, full restores', async () => {
    const res = await h.eval((g) => {
      const r = g.debug.fire.region('fire_capital');
      r.setDetail('far');
      const far = r.layerStats();
      r.setDetail('hidden');
      const hidden = r.group.visible;
      r.setDetail('full');
      const full = r.layerStats();
      return { farVisible: far.filter((l) => l.visible).length, farTotal: far.length, hidden, fullVisible: full.filter((l) => l.visible).length };
    });
    assert.ok(res.farVisible > 4 && res.farVisible < res.farTotal, `far: ${JSON.stringify(res)}`);
    assert.equal(res.hidden, false);
    assert.ok(res.fullVisible >= res.farVisible);
  });

  await check('perf: draw calls / triangles / fps at the capital centre and the harbour', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    await h.eval((g) => g.teleport(-1310, 1230));
    await h.eval((g) => g.faceTowards(-1330, 1100));
    await h.step(30);
    await h.wait(2000);
    const a = (await h.state()).render;
    await h.eval((g) => g.freeCamera({ x: -1330, y: 150, z: 1335 }, { x: -1330, y: 50, z: 1100 }));
    await h.step(5);
    await h.wait(2000);
    const b = (await h.state()).render;
    await h.eval((g) => g.freeCamera(null));
    await h.eval((g) => g.teleport(-890, 1020));
    await h.step(30);
    await h.wait(2000);
    const c = (await h.state()).render;
    const regs = await h.eval((g) => g.debug.fire.regions().map((r) => ({ id: r.id, buildMs: r.buildMs, colliders: r.colliders, flames: r.flames, tris: r.layers.reduce((s, l) => s + l.tris, 0) })));
    console.log(`  [${preset}] plaza view: calls=${a.drawCalls} tris=${a.triangles} fps=${a.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] aerial view: calls=${b.drawCalls} tris=${b.triangles} fps=${b.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] harbour view: calls=${c.drawCalls} tris=${c.triangles} fps=${c.fps?.toFixed?.(1)}`);
    console.log('  regions: ' + JSON.stringify(regs));
    assert.ok(b.drawCalls < 600, `aerial draw calls ${b.drawCalls}`);
  });

  await check('session restart: regions persist without duplicates, interactions re-registered', async () => {
    await h.eval((g) => g.exitToMenu(false));
    await h.newGame('water');
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
    await h.eval((g) => g.teleport(-1010, 980));
    await h.step(4);
    const regs = await h.eval((g) => g.debug.fire.regions().map((r) => r.id));
    assert.equal(new Set(regs).size, regs.length, `no duplicate fire regions: ${regs}`);
    const inter = await h.eval((g) => ['fn_feed_turtleducks'].filter((id) => g.ctx.interactions.get(id)).length);
    assert.equal(inter, 1, 'capital interactions registered in the new session');
  });

  await check('fresh page, arriving from afar: the capital ring builds time-sliced', async () => {
    const h2 = await launch({ width: 640, height: 360, preset });
    try {
      await h2.newGame('water');
      await h2.eval((g) => g.setting('graphics.renderScale', 0.35));
      // ≈350 m from the caldera centre: the capital starts building with its terraced ring deferred.
      await h2.eval((g) => g.teleport(-1010, 980));
      await h2.step(2);
      const first = await h2.eval((g) => {
        const r = g.debug.fire.region('fire_capital');
        return r ? { building: r.building, stairs: r.ringStairs.length, buildMs: +r.buildMs.toFixed(0) } : null;
      });
      assert.ok(first && first.building, `ring construction deferred on arrival: ${JSON.stringify(first)}`);
      // Arriving before the harbour streamed in must not leave the player inside the overlook
      // terrace (or shove them off it): they end up standing on top.
      const arr = await h2.eval((g) => ({ y: g.state().player.y, top: g.debug.fire.region('fire_harbor')?.overlookY ?? null }));
      assert.ok(arr.top !== null, 'harbour built');
      near(arr.y, arr.top, 0.4, 'player lifted onto the overlook terrace after it streamed in');
      let done = null;
      for (let i = 0; i < 80 && !done; i++) {
        await h2.step(10);
        done = await h2.eval((g) => {
          const r = g.debug.fire.region('fire_capital');
          return r && !r.building ? { stairs: r.ringStairs.length, visibleLayers: r.layerStats().filter((l) => l.visible).length } : null;
        });
      }
      assert.ok(done, 'deferred ring finished');
      assert.ok(done.stairs >= 4, `ring stairs after deferred build: ${JSON.stringify(done)}`);
      assert.equal(h2.errors.length, 0, h2.errors.slice(0, 3).join('\n'));
      console.log(`  arrival: ${JSON.stringify(first)} → done: ${JSON.stringify(done)}`);
    } finally {
      await h2.close();
    }
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
