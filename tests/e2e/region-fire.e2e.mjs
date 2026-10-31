/**
 * Fire Nation region E2E: the rebuilt capital — First Lord's Harbor and the sea gate, the Royal
 * Plaza, the tower passage, Harbor City and its market, Sozin's road, Hari Bulkan and the Royal
 * Palace — with its people and harbour traffic; then the Western Causeway, the Sun Warrior Ruins
 * and Ember Island.
 *  - walks the spine: harbour quay → plaza → passage → Royal Way → the eight hairpins → crater gate
 *    → Hari Bulkan Square → palace gate → courtyard → central hall → throne room, and back down
 *  - checks the spawn, spots and flat training grounds, water sources (plaza pools, the falls),
 *    people (counts, drawn in a Harbor City view, a rally, a proclamation), ships (the schedule
 *    opens the sea gate, hulls over water), tanks, balloons, the turtle-duck interaction,
 *    detail levels, perf numbers, session restart, a time-sliced build on arrival, no errors
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
  await h.eval((g) => { g.setTime(9); g.freezeTime?.(true); g.debug.enemies?.clear?.(); });
  const V = { x: -1300, z: 990 };
  const ax = (t, s) => [V.x + t, V.z + s];
  const marks = await h.eval((g) => JSON.parse(JSON.stringify(g.debug.fnc.marks())));

  await check('fire start: spawn on the Royal Plaza, flat and grounded; the capital is built', async () => {
    const st = await h.state();
    assert.equal(st.region, 'fire_nation_capital');
    near(st.player.x, V.x, 0.5, 'spawn x');
    near(st.player.z, V.z + 606, 0.5, 'spawn z');
    near(st.player.y, 3.2, 0.35, 'spawn on the plaza');
    const y0 = await ground(V.x, V.z + 606, 8);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4]]) near(await ground(V.x + dx, V.z + 606 + dz, 8), y0, 0.08, `spawn surroundings flat (${dx},${dz})`);
    const regs = await h.eval((g) => g.debug.earth.regions().map((r) => r.id));
    assert.ok(regs.includes('fire_capital'), `capital built (${regs})`);
    for (const id of ['seaGate', 'plazaSpawn', 'balcony', 'passageTop', 'market', 'craterGate', 'square', 'palaceGate', 'courtyard', 'throneRoom', 'throne', 'agniKai', 'gallery', 'gardenPond', 'temple', 'academy']) assert.ok(marks[id], `mark ${id}`);
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
      const c = await ground(s.x, s.z, s.y + 3);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const y = await ground(s.x + Math.cos(a) * (s.r - 1), s.z + Math.sin(a) * (s.r - 1), s.y + 3);
        near(y, c, 0.15, `${id} flat at r-1 (k=${k})`);
      }
    }
  });

  const hair = [];
  for (let k = 0; k < 8; k++) hair.push(ax((k % 2 === 0 ? 1 : -1) * 46 * 0.92, 292 - ((292 - 122) * k) / 8));
  const up = [ax(-53, 670), ax(-46, 659), ax(-12, 650), ax(0, 600), ax(0, 559), ax(0, 505), ax(0, 440), ax(0, 300), ...hair, ax(0, 127), ax(0, 116), ax(0, 96), ax(0, 60), ax(0, 41), ax(0, 33), ax(0, 27), ax(0, 17), ax(0, 11), ax(0, 6), ax(0, 0), ax(0, -6), ax(0, -11), ax(0, -18.5)];

  await check('walk: sea-gate quay → harbour → plaza → passage → Royal Way → road → crater → palace → throne room', async () => {
    await h.eval((g, p) => g.teleport(p[0], p[1], 2.7), ax(-73.7, 700));
    await h.step(6);
    let r = null;
    for (const [x, z] of up) {
      r = await walkTo(x, z, { tol: 1.4, sprint: true });
      assert.ok(r.dist < 2.2, `stuck before (${(x - V.x).toFixed(1)}, ${(z - V.z).toFixed(1)}): ${JSON.stringify(r)}`);
      assert.ok(!r.swimming, `swimming near (${(x - V.x).toFixed(1)}, ${(z - V.z).toFixed(1)})`);
    }
    near(r.y, marks.throneRoom.y, 0.35, 'standing on the throne room floor');
  });

  await check('walk: throne room → courtyard → palace gate → road → plaza (and back to the quay)', async () => {
    const down = [...up].reverse().slice(1);
    let r = null;
    for (const [x, z] of [...down, ax(-73.7, 700)]) {
      r = await walkTo(x, z, { tol: 1.4, sprint: true });
      assert.ok(r.dist < 2.2, `stuck before (${(x - V.x).toFixed(1)}, ${(z - V.z).toFixed(1)}): ${JSON.stringify(r)}`);
      assert.ok(!r.swimming, `swimming near (${(x - V.x).toFixed(1)}, ${(z - V.z).toFixed(1)})`);
    }
    near(r.y, 2.6, 0.4, 'back on the quay apron');
  });

  await check('water: plaza pools, the harbour basin and the royal falls are real sources', async () => {
    await h.eval((g, p) => g.teleport(p[0], p[1]), ax(0, 610));
    await h.step(4);
    let w = await h.eval((g) => g.waterNearby(20));
    assert.ok(w.some((s) => s.id.startsWith('fire_capital:plaza_pool')), `plaza pool: ${JSON.stringify(w.map((s) => s.id))}`);
    await h.eval((g, p) => g.teleport(p[0], p[1], 2.7), ax(-73.7, 700));
    await h.step(4);
    w = await h.eval((g) => g.waterNearby(25));
    assert.ok(w.length > 0, 'harbour water within reach of the quay');
    await h.eval((g, m) => g.teleport(m.x + 6, m.z + 6), marks.waterfall);
    await h.step(4);
    w = await h.eval((g) => g.waterNearby(40));
    assert.ok(w.some((s) => s.id === 'fire_capital:royal_falls' || /lake/.test(s.id)), `falls / lake: ${JSON.stringify(w.map((s) => s.id))}`);
  });

  await check('people: hundreds simulated, a Harbor City view full of them, rally and proclamation', async () => {
    await h.eval((g, p) => g.teleport(p[0], p[1]), ax(0, 470));
    await h.step(10);
    await h.eval((g, p) => g.freeCamera({ x: p[0] + 20, y: 62, z: p[1] + 70 }, { x: p[0], y: 34, z: p[1] - 40 }), ax(0, 470));
    await h.step(90);
    const l = await h.eval((g) => g.debug.fnc.life());
    console.log(`  people: ${JSON.stringify(l)}`);
    assert.ok(l.total >= 400, `simulated ${l.total}`);
    assert.ok(l.visible >= 100, `drawn in the Harbor City view: ${l.visible}`);
    assert.ok(l.squads >= 3, 'marching squads');
    await h.eval((g, p) => { g.teleport(p[0], p[1]); g.freeCamera({ x: p[0], y: 30, z: p[1] + 100 }, { x: p[0], y: 8, z: p[1] - 30 }); g.debug.fnc.rally(true, true); }, ax(0, 600));
    await h.step(30);
    const r = await h.eval((g) => g.debug.fnc.life());
    assert.ok(r.rally >= 300, `rally crowd ${r.rally}`);
    await h.eval((g) => g.debug.fnc.rally(null));
    await h.eval((g, p) => { g.teleport(p[0], p[1]); g.setTime(15.1); g.debug.fnc.proclaim(true); }, ax(0, 70));
    await h.step(200);
    const p = await h.eval((g) => g.debug.fnc.life());
    assert.ok(p.proclaim >= 20, `proclamation crowd ${p.proclaim}`);
    await h.eval((g) => { g.debug.fnc.proclaim(null); g.setTime(9); g.freeCamera(null); });
  });

  await check('ships, tanks, balloons: the schedule opens the sea gate, hulls stay on the water', async () => {
    const v = await h.eval((g) => g.debug.fnc.vessels());
    assert.equal(v.warships, 12);
    assert.ok(v.tanks >= 4 && v.balloons >= 3 && v.boats >= 10, JSON.stringify(v));
    await h.eval((g, p) => g.teleport(p[0], p[1], 2.7), ax(-73.7, 700));
    let open = 0, minWater = Infinity;
    for (let i = 0; i < 30; i++) {
      await h.eval((g) => g.debug.fnc.skipShips(10));
      await h.step(6);
      const st = await h.eval((g) => ({ v: g.debug.fnc.vessels(), ships: g.debug.fnc.ships().filter((s) => s.visible).map((s) => g.ctx.world.groundAt(s.x, s.z, 0).y) }));
      open = Math.max(open, st.v.gate);
      for (const y of st.ships) minWater = Math.min(minWater, -y);
    }
    assert.ok(open > 0.5, `sea gate opened for a ship (max ${open})`);
    assert.ok(minWater > 2.5, `hulls over deep water (min depth ${minWater})`);
  });

  await check('palace garden: the turtle-duck feeding interaction is registered', async () => {
    const ok = await h.eval((g) => !!g.ctx.interactions.get('fn_feed_turtleducks'));
    assert.ok(ok, 'fn_feed_turtleducks');
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

  await check('detail levels: far hides the people, hidden hides all, full restores', async () => {
    const res = await h.eval((g) => {
      const r = g.debug.earth.region('fire_capital');
      r.setDetail('far');
      r.update(0.016, g.ctx);
      const far = { group: r.group.visible, life: r.life.group.visible };
      r.setDetail('hidden');
      const hidden = r.group.visible;
      r.setDetail('full');
      r.update(0.016, g.ctx);
      return { far, hidden, full: r.life.group.visible };
    });
    assert.ok(res.far.group && !res.far.life, `far: ${JSON.stringify(res)}`);
    assert.equal(res.hidden, false);
    assert.ok(res.full, 'people back at full detail');
  });

  await check('perf: draw calls / triangles / fps on the plaza, from the air and at the harbour', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    await h.eval((g, p) => g.teleport(p[0], p[1]), ax(0, 606));
    await h.eval((g, p) => g.faceTowards(p[0], p[1]), ax(0, 540));
    await h.step(30);
    await h.wait(2000);
    const a = (await h.state()).render;
    await h.eval((g) => g.freeCamera({ x: -1300, y: 260, z: 1500 }, { x: -1300, y: 60, z: 1150 }));
    await h.step(5);
    await h.wait(2000);
    const b = (await h.state()).render;
    await h.eval((g) => g.freeCamera(null));
    await h.eval((g, p) => g.teleport(p[0], p[1], 2.7), ax(-73.7, 700));
    await h.step(30);
    await h.wait(2000);
    const c = (await h.state()).render;
    const cap = await h.eval((g) => g.debug.earth.region('fire_capital').stats());
    console.log(`  [${preset}] plaza view: calls=${a.drawCalls} tris=${a.triangles} fps=${a.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] aerial view: calls=${b.drawCalls} tris=${b.triangles} fps=${b.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] harbour view: calls=${c.drawCalls} tris=${c.triangles} fps=${c.fps?.toFixed?.(1)}`);
    console.log('  capital: ' + JSON.stringify(cap));
    assert.ok(b.drawCalls < 900, `aerial draw calls ${b.drawCalls}`);
  });

  await check('session restart: regions persist without duplicates, interactions re-registered', async () => {
    await h.eval((g) => g.exitToMenu(false));
    await h.newGame('water');
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
    await h.eval((g) => g.teleport(-1300, 1500));
    await h.step(4);
    const regs = await h.eval((g) => [...g.debug.fire.regions().map((r) => r.id), ...g.debug.earth.regions().map((r) => r.id)]);
    assert.equal(new Set(regs).size, regs.length, `no duplicate regions: ${regs}`);
    for (let i = 0; i < 60; i++) {
      if (await h.eval((g) => { const r = g.debug.earth.region('fire_capital'); return !!r && !r.building; })) break;
      await h.step(10);
    }
    const inter = await h.eval((g) => ['fn_feed_turtleducks'].filter((id) => g.ctx.interactions.get(id)).length);
    assert.equal(inter, 1, 'capital interactions registered in the new session');
  });

  await check('fresh page, arriving from afar: the capital builds time-sliced', async () => {
    const h2 = await launch({ width: 640, height: 360, preset });
    try {
      await h2.newGame('water');
      await h2.eval((g) => g.setting('graphics.renderScale', 0.35));
      // Just inside the load radius, beyond the immediate-build distance: construction is deferred.
      await h2.eval((g) => g.teleport(-1300, 1350 + 600));
      await h2.step(2);
      const first = await h2.eval((g) => {
        const r = g.debug.earth.region('fire_capital');
        return r ? { building: r.building, buildMs: +r.buildMs.toFixed(0) } : null;
      });
      assert.ok(first && first.building, `construction deferred on arrival: ${JSON.stringify(first)}`);
      let done = null;
      for (let i = 0; i < 160 && !done; i++) {
        await h2.step(10);
        done = await h2.eval((g) => {
          const r = g.debug.earth.region('fire_capital');
          return r && !r.building ? { people: r.life?.agents.length ?? 0, ships: r.vessels?.counts().warships ?? 0 } : null;
        });
      }
      assert.ok(done, 'deferred build finished');
      assert.ok(done.ships === 12, `ships after deferred build: ${JSON.stringify(done)}`);
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
