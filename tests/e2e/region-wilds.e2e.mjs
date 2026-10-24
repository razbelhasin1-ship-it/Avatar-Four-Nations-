/**
 * Wilds E2E (src/world/regions/wilds): the places between the capitals.
 *  - every site loads at its landmark (teleportTo), ground is walkable, spots are defined
 *  - walks the main routes with g.move + g.step: Omashu gate → grand stairs → palace
 *    terrace and the boulder arena; Kyoshi plaza → dojo yard → pier; Misty Palms →
 *    oasis jetty; dune crest → Buried Library chamber (reveal); Banyan landmark
 *    platform → root mound → training platform; Tundra ramp → watchtower lookout;
 *    Badgermole cave mouth → interior, steps → burrow ledge
 *  - walks across every bridge end to end (both road bridges + the ice bridge) and
 *    asserts arrival on the far bank, never dropping into the river
 *  - training floors flat and open (r >= 12), registered water sources, camps consumed
 *    by the encounter director, detail levels, draw calls / triangles per site,
 *    no console errors
 * Run: node tests/e2e/region-wilds.e2e.mjs [--preset medium] [--shots DIR] [--noperf]
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const preset = arg('--preset', 'low');
const shots = arg('--shots', null);
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

/** Walk toward (x, z) (re-aiming every few frames, rendering stubbed). */
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
        let minY = p.y, maxY = p.y, steps = 0, stuck = 0, last = Infinity, swam = false;
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
          swam = swam || p.swimming;
        }
        g.move(0, 0);
        g.step(4);
        p = g.state().player;
        return { x: p.x, y: p.y, z: p.z, grounded: p.grounded, swimming: p.swimming, swam, minY, maxY, steps, dist: Math.hypot(x - p.x, z - p.z) };
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
    assert.ok(r.dist < (o.tol ?? 1.2) + 0.6, `stuck before (${x.toFixed(1)}, ${z.toFixed(1)}): ${JSON.stringify(r)}`);
    if (o.minY !== undefined) assert.ok(r.minY > o.minY, `fell below ${o.minY} on the way to (${x.toFixed(1)}, ${z.toFixed(1)}): ${JSON.stringify(r)}`);
    assert.ok(!r.swam, `swimming on the way to (${x.toFixed(1)}, ${z.toFixed(1)}): ${JSON.stringify(r)}`);
  }
  return r;
}

const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);
/** Teleport, let regions around build, teleport again (colliders now exist). */
const arrive = async (x, z, y) => {
  await h.eval((g, x, z, y) => g.teleport(x, z, y), x, z, y);
  await h.eval((g) => {
    const R = g.ctx.render, render = R.render;
    R.render = () => {};
    try { g.step(6); } finally { R.render = render; }
  });
  return h.eval((g, x, z, y) => g.teleport(x, z, y), x, z, y);
};
const marks = (id) => h.eval((g, id) => g.debug.wilds.marks(id), id);
const site = (id) => h.eval((g, id) => (g.debug.wilds.sites().find((s) => s.id === id) ?? null), id);
const OM = { C: { x: -450, z: -650 }, gate: { x: -380, z: -680 } };
OM.tg = Math.atan2(OM.gate.z - OM.C.z, OM.gate.x - OM.C.x);
const P = (th, r) => [OM.C.x + Math.cos(th) * r, OM.C.z + Math.sin(th) * r];
const perf = [];
async function measure(name, setup) {
  await h.eval(setup);
  await h.step(6);
  await h.wait(1200);
  const r = (await h.state()).render;
  perf.push(`${name}: calls=${r.drawCalls} tris=${r.triangles}`);
  console.log(`  [${preset}] ${name}: calls=${r.drawCalls} tris=${r.triangles} fps=${r.fps?.toFixed?.(1)}`);
  if (shots) await h.shot(`${shots}/${name.replace(/\W+/g, '_')}_${preset}.png`, { timeout: 120000 });
  return r;
}

try {
  await h.newGame('earth');
  await h.eval((g) => { g.setting('graphics.renderScale', 0.35); g.freezeTime(true); g.setTime(15); });

  await check('spots published (masters, training, givers, merchants, docks, habitats, camps, bridges)', async () => {
    await arrive(-60, -790);
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const need = [
      'master_bumo', 'training_bumo', 'giver_omashu_gatekeeper', 'giver_omashu_advisor', 'merchant_omashu_1', 'merchant_omashu_2', 'viewpoint_omashu_palace', 'shrine_omashu',
      'master_oyagi', 'training_oyagi', 'giver_kyoshi_suki', 'merchant_kyoshi_1', 'dock_kyoshi', 'shrine_kyoshi',
      'giver_misty_cantina', 'merchant_misty_1', 'merchant_misty_2', 'dock_misty_oasis', 'shrine_buried_library', 'viewpoint_buried_library',
      'master_huu', 'training_huu', 'dock_banyan_raft', 'giver_tundra_scout', 'merchant_tundra_1', 'viewpoint_tundra_tower',
      'habitat_polar_bear_dog_1', 'habitat_polar_bear_dog_2', 'habitat_polar_bear_dog_3', 'habitat_badgermole_1', 'habitat_badgermole_2',
      'bridge_northern_road', 'bridge_western_road', 'bridge_tundra_ice', 'dock_lake_hiari', 'merchant_inn_north_1', 'merchant_inn_west_1', 'merchant_inn_south_1',
      'camp_fire_commander', 'camp_dai_li_captain', 'camp_pirate_captain',
    ];
    for (const id of need) assert.ok(spots[id], `spot ${id} defined`);
    for (const id of ['training_bumo', 'training_oyagi', 'training_huu']) assert.ok(spots[id].r >= 12, `${id} radius ${spots[id].r}`);
    const camps = Object.keys(spots).filter((k) => k.startsWith('camp_'));
    assert.ok(camps.length >= 8 && camps.length <= 14, `camp count ${camps.length}`);
    console.log(`  ${Object.keys(spots).length} spots, ${camps.length} camps`);
  });

  await check('encounter director consumes the camps (incl. boss lairs at the published spots)', async () => {
    const r = await h.eval((g) => {
      const enc = g.ctx.extra.get('encounters');
      const camps = enc?.camps ?? [];
      return camps.map((c) => ({ id: c.id, x: Math.round(c.x), z: Math.round(c.z), zone: c.zone, kind: c.kind }));
    });
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const ids = new Set(r.map((c) => c.id));
    const mine = Object.keys(spots).filter((k) => k.startsWith('camp_') && !k.includes('captain') && !k.includes('commander'));
    const missing = mine.filter((k) => !ids.has(k));
    assert.equal(missing.length, 0, `camps not consumed (safe zone?): ${missing.join(', ')}`);
    for (const [boss, spot] of [['boss_fire_commander', 'camp_fire_commander'], ['boss_dai_li_captain', 'camp_dai_li_captain'], ['boss_pirate_captain', 'camp_pirate_captain']]) {
      const c = r.find((x) => x.id === boss);
      assert.ok(c, `boss camp ${boss}`);
      near(c.x, spots[spot].x, 1, `${boss} x at spot`);
      near(c.z, spots[spot].z, 1, `${boss} z at spot`);
    }
    console.log('  ' + r.filter((c) => c.id.startsWith('camp_') || c.id.startsWith('boss_')).map((c) => `${c.id}:${c.zone}`).join(' '));
  });

  await check('Omashu: gate → avenue → grand stairs → palace terrace; arena floor flat and open', async () => {
    let st = await arrive(...P(OM.tg, 90));
    assert.ok((await site('wilds_omashu'))?.built, 'Omashu built');
    near(st.y, 95, 2.5, 'ramp top outside the gate');
    let r = await walkPath([P(OM.tg, 74), P(OM.tg, 60), P(OM.tg, 56)], { minY: 93, tol: 1.4 });
    near(r.y, 95, 0.4, 'avenue');
    r = await walkPath([P(OM.tg, 36), P(OM.tg, 18), P(OM.tg, 8)], { minY: 94, tol: 1.4 });
    near(r.y, 123, 0.4, 'palace terrace height');
    // The landmark (mesa centre) is an open courtyard on the top terrace.
    // (the palace steps start ~3.5 m behind the centre: walkable, at most one step up)
    for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [6, 6]]) {
      const gy = await ground(OM.C.x + dx, OM.C.z + dz, 130);
      assert.ok(gy > 122.94 && gy < 123.9, `courtyard walkable at landmark +(${dx},${dz}): ${gy}`);
    }
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const t = spots.training_bumo;
    const th = Math.atan2(t.z - OM.C.z, t.x - OM.C.x);
    await arrive(...P(th, 44.6));
    r = await walkPath([[t.x, t.z]], { minY: 94, tol: 1.4 });
    near(r.y, t.y, 0.3, 'arena floor');
    for (let a = 0; a < 8; a++) for (const f of [0.5, 0.97]) {
      const x = t.x + Math.cos(a * 0.785) * t.r * f, z = t.z + Math.sin(a * 0.785) * t.r * f;
      near(await ground(x, z, t.y + 3), t.y, 0.06, `arena flat/open at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    await arrive(...P(OM.tg + 0.27, 61));
    const w = await h.eval((g) => g.waterNearby(12));
    assert.ok(w.some((s) => s.id === 'wilds:omashu_fountain'), `fountain source: ${JSON.stringify(w)}`);
  });

  await check('Kyoshi Island: plaza → dojo yard (flat, open) → pier end above the sea', async () => {
    const st = await arrive(1820, -440);
    near(st.y, 6, 0.3, 'plaza');
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const t = spots.training_oyagi;
    let r = await walkPath([[t.x + 4, t.z], [t.x, t.z]], { minY: 5.5 });
    near(r.y, 6, 0.3, 'yard');
    for (let a = 0; a < 8; a++) {
      const x = t.x + Math.cos(a * 0.785) * t.r * 0.97, z = t.z + Math.sin(a * 0.785) * t.r * 0.97;
      near(await ground(x, z, 10), 6, 0.15, `yard open at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    const d = spots.dock_kyoshi;
    r = await walkPath([[1834, -445.5], [d.x - 30, -445.8], [d.x, d.z]], { minY: 0.8, tol: 1.4 });
    near(r.y, d.y, 0.35, 'pier end deck');
  });

  await check('Misty Palms: square → oasis jetty (dock) + well and oasis water sources', async () => {
    await arrive(160, 860);
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const d = spots.dock_misty_oasis;
    const r = await walkPath([[155, 870], [d.x, d.z]], { minY: 25, tol: 1 });
    near(r.y, d.y, 0.3, 'jetty deck');
    const w = await h.eval((g) => g.waterNearby(40));
    assert.ok(w.some((s) => s.id === 'wilds:misty_well'), `well source: ${JSON.stringify(w)}`);
    assert.ok(w.some((s) => s.id === 'lake:misty_oasis'), `oasis source: ${JSON.stringify(w)}`);
  });

  await check('Buried Library: dune crest → doorway → interior chamber, reveal triggered', async () => {
    const st = await arrive(420, 1120);
    assert.ok(st.grounded !== false, 'grounded on the dune');
    const m = await marks('wilds_buried_library');
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const s = spots.shrine_buried_library;
    const r = await walkPath([[m.doorFoot.x, m.doorFoot.z], [m.door.x, m.door.z], [s.x, s.z]], { tol: 1.2 });
    near(r.y, s.y, 0.3, 'chamber floor');
    const rev = await h.eval((g) => g.debug.wilds.site('wilds_buried_library').revealed);
    assert.ok(rev, 'library revealed');
  });

  await check('Great Banyan Tree: landmark platform → root bridge → mound → training platform (flat) + murky pool source', async () => {
    const st = await arrive(-1150, -140);
    const m = await marks('wilds_banyan_tree');
    near(st.y, m.landmarkPlatform.y, 0.3, 'landmark platform');
    const T = m.mound;
    const aL = Math.atan2(m.route_landmark_a.z - T.z, m.route_landmark_a.x - T.x);
    const aT = Math.atan2(m.route_training_a.z - T.z, m.route_training_a.x - T.x);
    let da = Math.atan2(Math.sin(aT - aL), Math.cos(aT - aL));
    const ring = [];
    for (let k = 1; k <= 5; k++) ring.push([T.x + Math.cos(aL + (da * k) / 5) * 12, T.z + Math.sin(aL + (da * k) / 5) * 12]);
    let r = await walkPath([[m.route_landmark_b.x, m.route_landmark_b.z], [m.route_landmark_a.x, m.route_landmark_a.z], ...ring, [m.route_training_b.x, m.route_training_b.z], [m.training.x, m.training.z]], { tol: 1.2, minY: 0.6 });
    near(r.y, m.training.y, 0.3, 'training platform');
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const t = spots.training_huu;
    for (let a = 0; a < 8; a++) {
      const x = t.x + Math.cos(a * 0.785) * t.r * 0.97, z = t.z + Math.sin(a * 0.785) * t.r * 0.97;
      near(await ground(x, z, t.y + 3), t.y, 0.06, `root platform flat at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    const w = await h.eval((g) => g.waterNearby(25));
    assert.ok(w.some((s) => s.id === 'wilds:banyan_pool'), `banyan pool source: ${JSON.stringify(w)}`);
  });

  await check('Tundra Watchtower: outpost → ice ramp → lookout; Snowdrift Den nests', async () => {
    await arrive(300, -1050);
    const m = await marks('wilds_tundra_outpost');
    const r = await walkPath([[m.rampFoot.x + 2, m.rampFoot.z], [m.rampFoot.x, m.rampFoot.z], [m.towerTop.x + 1, m.towerTop.z]], { tol: 1.2 });
    near(r.y, m.towerTop.y, 0.3, 'lookout height');
    await arrive(520, -1260);
    const md = await marks('wilds_snowdrift_den');
    for (const k of ['nest_1', 'nest_2', 'nest_3']) {
      const g = await ground(md[k].x, md[k].z);
      near(g, md[k].y, 0.5, `${k} walkable ground`);
    }
  });

  await check('Badgermole Caves: mouth → interior; carved steps → burrow ledge', async () => {
    const m0 = await (async () => { await arrive(590, 552); return marks('wilds_badgermole_caves'); })();
    let r = await walkPath([[m0.mouth.x, m0.mouth.z], [m0.interior.x, m0.interior.z]], { tol: 1.4 });
    assert.ok(r.dist < 2, 'inside the cave');
    await arrive(m0.stepsFoot.x - 1.5, m0.stepsFoot.z + 1);
    r = await walkPath([[m0.stepsFoot.x, m0.stepsFoot.z], [m0.ledge.x - 4.5, m0.ledge.z + 1.2], [m0.ledge.x, m0.ledge.z]], { tol: 1.3 });
    near(r.y, m0.ledge.y, 0.35, 'burrow ledge');
  });

  const crossings = [];
  for (const [id, label] of [['wilds_bridge_north', 'northern road × Great River'], ['wilds_bridge_west', 'western road × Great River'], ['wilds_ice_path', 'ice path × Great River']]) {
    await check(`bridge walk end to end: ${label}`, async () => {
      const ms = await h.eval((g, id) => { g.teleport(id === 'wilds_ice_path' ? -90 : id === 'wilds_bridge_west' ? 270 : 100, id === 'wilds_ice_path' ? -1050 : id === 'wilds_bridge_west' ? 55 : -510); return true; }, id);
      void ms;
      await h.step(6);
      const m = await marks(id);
      const a = m.a ?? m.bridgeA, c = m.c ?? m.bridgeC;
      const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz);
      const ux = dx / l, uz = dz / l;
      const start = [a.x - ux * 7, a.z - uz * 7], end = [c.x + ux * 7, c.z + uz * 7];
      await arrive(...start);
      const water = await h.eval((g, x, z) => g.ctx.world.waterAt(x, z), (a.x + c.x) / 2, (a.z + c.z) / 2);
      assert.ok(water, 'river under the bridge');
      const lowBank = Math.min(await ground(...start), await ground(...end), a.y, c.y);
      const r = await walkPath([[a.x + ux * 2, a.z + uz * 2], [(a.x + c.x) / 2, (a.z + c.z) / 2], end], { tol: 1.3, minY: Math.min(water.level, lowBank) - 0.3 });
      assert.ok(r.grounded, 'grounded on the far bank');
      assert.ok(r.maxY > Math.max(a.y, c.y) + 0.5, `walked over the deck (max ${r.maxY.toFixed(2)})`);
      const far = await h.eval((g, x, z) => g.ctx.world.waterAt(x, z), r.x, r.z);
      assert.ok(!far || far.level < r.y - 0.5, 'arrived on dry ground');
      crossings.push(`${label}: (${a.x.toFixed(0)}, ${a.z.toFixed(0)}) → (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) span ${l.toFixed(0)} m, deck max ${r.maxY.toFixed(1)}, water ${water.level.toFixed(1)}`);
      console.log('  ' + crossings[crossings.length - 1]);
    });
  }

  await check('inn wells, Lake Hiari dock, detail levels', async () => {
    const spots = await h.eval((g) => g.debug.wilds.spots());
    const s = spots.merchant_inn_north_1;
    await arrive(s.x, s.z);
    const w = await h.eval((g) => g.waterNearby(20));
    assert.ok(w.some((x) => x.id === 'wilds:inn_well_north'), `inn well: ${JSON.stringify(w)}`);
    const d = spots.dock_lake_hiari;
    await arrive(d.x + 18, d.z);
    const r = await walkPath([[d.x + 10, d.z], [d.x, d.z]], { tol: 1.2 });
    near(r.y, d.y, 0.3, 'Hiari pier deck');
    await arrive(1800, -1700);
    await h.step(3);
    const lv = await h.eval((g) => Object.fromEntries(g.debug.wilds.sites().map((s) => [s.id, s.detail])));
    assert.equal(lv.wilds_omashu, 'hidden', 'Omashu hidden from far away');
  });

  if (!process.argv.includes('--noperf')) await check('perf: draw calls / triangles per site', async () => {
    await h.eval((g) => { g.setting('graphics.renderScale', 1); g.hideUI(true); });
    const views = [
      ['omashu aerial', (g) => { g.teleport(-420, -560); g.freeCamera({ x: -330, y: 175, z: -735 }, { x: -455, y: 105, z: -640 }); }],
      ['omashu avenue', (g) => { g.freeCamera(null); g.teleport(-388, -676); g.faceTowards(-450, -650); }],
      ['omashu terrace dusk', (g) => { g.setTime(18.6); g.teleport(-432, -662); g.freeCamera({ x: -418, y: 128, z: -668 }, { x: -470, y: 112, z: -640 }); }],
      ['kyoshi aerial', (g) => { g.setTime(15); g.teleport(1835, -425); g.freeCamera({ x: 1880, y: 70, z: -360 }, { x: 1815, y: 6, z: -450 }); }],
      ['kyoshi plaza', (g) => { g.freeCamera(null); g.teleport(1822, -428); g.faceTowards(1820, -470); }],
      ['misty aerial', (g) => { g.teleport(170, 880); g.freeCamera({ x: 215, y: 60, z: 940 }, { x: 155, y: 25, z: 865 }); }],
      ['misty square', (g) => { g.freeCamera(null); g.teleport(162, 868); g.faceTowards(150, 896); }],
      ['library aerial', (g) => { g.teleport(424, 1122); g.freeCamera({ x: 380, y: 70, z: 1075 }, { x: 446, y: 30, z: 1128 }); }],
      ['library dune', (g) => { g.freeCamera(null); g.teleport(424, 1122); g.faceTowards(446, 1128); }],
      ['library interior', (g) => { g.teleport(442.5, 1127); g.freeCamera({ x: 439.6, y: g.debug.wilds.spots().shrine_buried_library.y + 2.2, z: 1126 }, { x: 452, y: g.debug.wilds.spots().shrine_buried_library.y + 3.5, z: 1130 }); }],
      ['banyan aerial', (g) => { g.teleport(-1150, -140); g.freeCamera({ x: -1060, y: 45, z: -60 }, { x: -1128, y: 8, z: -125 }); }],
      ['banyan roots dusk', (g) => { g.setTime(19); g.freeCamera(null); g.teleport(-1108, -116); g.faceTowards(-1126, -122); }],
      ['tundra aerial', (g) => { g.setTime(15); g.teleport(300, -1050); g.freeCamera({ x: 345, y: 40, z: -1010 }, { x: 298, y: 18, z: -1058 }); }],
      ['tundra ground', (g) => { g.freeCamera(null); g.teleport(306, -1042); g.faceTowards(283, -1068); }],
      ['snowdrift den', (g) => { g.teleport(500, -1262); g.faceTowards(525, -1258); }],
      ['badgermole mouth', (g) => { g.teleport(588, 549); g.faceTowards(620, 552); }],
      ['badgermole aerial', (g) => { g.teleport(600, 540); g.freeCamera({ x: 560, y: 110, z: 520 }, { x: 625, y: 75, z: 555 }); }],
      ['bridge north', (g) => { g.teleport(104, -505); g.freeCamera({ x: 105, y: 24, z: -440 }, { x: 132, y: 13, z: -472 }); }],
      ['bridge west', (g) => { g.teleport(270, 40); g.freeCamera({ x: 250, y: 22, z: 25 }, { x: 238, y: 13, z: 60 }); }],
      ['bridge ice', (g) => { g.teleport(-80, -1045); g.freeCamera({ x: -55, y: 22, z: -1072 }, { x: -50, y: 13, z: -1050 }); }],
      ['camp fire commander', (g) => { g.freeCamera(null); g.teleport(-700, 650); g.faceTowards(-719, 668); }],
    ];
    for (const [name, fn] of views) {
      await h.eval(fn);
      await h.step(4);
      const r = await measure(name, (g) => g.step(2));
      assert.ok(r.drawCalls < 400, `${name} draw calls ${r.drawCalls}`);
    }
    await h.eval((g) => { g.freeCamera(null); g.setting('graphics.renderScale', 0.35); });
    const st = await h.eval((g) => g.debug.wilds.sites().map((s) => `${s.id}:${s.triangles}t/${s.colliders}c/${s.buildMs}ms`));
    console.log('  sites ' + st.join(' '));
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
