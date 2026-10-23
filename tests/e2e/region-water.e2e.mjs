/**
 * Water region E2E: the Northern Water Tribe capital, the Southern Water Tribe
 * village and Meditation Isle.
 *  - walks key routes (NWT: Great Ice Gate → quays and canal bridges → Tribal
 *    Plaza → terrace stairs → palace forecourt; plaza → gorge bridge →
 *    Waterbending Courtyard; Glacier Pass Gate → northern road; passage →
 *    Spirit Oasis. SWT: road → gate → meeting ground → sea ice. Isle: spawn →
 *    training circle)
 *  - checks walkable heights (groundAt), flat/open training grounds, registered
 *    water sources (g.waterNearby), published spots, no console errors
 *  - reports draw calls / triangles / fps at the NWT plaza (street + aerial)
 * Run: node tests/e2e/region-water.e2e.mjs [--preset medium]
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

const L1 = 5.5;
const L3 = 13.5;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

/**
 * Rendering is not needed for movement/collision checks; hiding the scene
 * keeps SwiftShader frames cheap (the perf check renders normally).
 */
const fast = (on) => h.eval((g, on) => { g.ctx.render.scene.visible = !on; }, on);

/** Walk toward (x, z), re-aiming every few frames. Returns the final player state. */
async function walkTo(x, z, o = {}) {
  return h.eval(
    (g, x, z, o) => {
      const tol = o.tol ?? 1.2;
      const max = o.max ?? 900;
      let p = g.state().player;
      let minY = p.y, maxY = p.y, steps = 0, stuck = 0, last = Infinity;
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
      g.step(4);
      p = g.state().player;
      return { x: p.x, y: p.y, z: p.z, grounded: p.grounded, minY, maxY, steps, dist: Math.hypot(x - p.x, z - p.z) };
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

const teleport = async (x, z, steps = 30) => {
  await h.eval((g, x, z) => g.teleport(x, z), x, z);
  await h.step(steps);
  return h.state().then((s) => s.player);
};
const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);
const sources = (range = 22) => h.eval((g, r) => g.waterNearby(r), range);

/** Training ground: flat within ±0.6 m and free of solid obstacles at body height. */
async function assertOpenFlat(spot, label) {
  const r = await h.eval(
    (g, s) => {
      const out = { bad: [] };
      const THREE = g.THREE;
      // Reference level: the median ground height over the area (a training
      // ground may have a shallow pool or a low dais; it must still be flat).
      const ys = [];
      for (const f of [0.3, 0.6, 0.9]) for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ys.push(g.ctx.world.groundAt(s.x + Math.cos(a) * s.r * f, s.z + Math.sin(a) * s.r * f, (s.y ?? 0) + 2).y);
      }
      ys.sort((a, b) => a - b);
      const cy = ys[ys.length >> 1];
      out.cy = cy;
      for (const f of [0, 0.45, 0.85]) {
        const n = f === 0 ? 1 : 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = s.x + Math.cos(a) * s.r * f, z = s.z + Math.sin(a) * s.r * f;
          const y = g.ctx.world.groundAt(x, z, cy + 2).y;
          const hit = g.ctx.world.collision.overlapSphere(new THREE.Vector3(x, y + 1.1, z), 0.35);
          if (Math.abs(y - cy) > 0.6 || (hit && !hit.walkable)) out.bad.push({ x: +x.toFixed(1), z: +z.toFixed(1), y: +y.toFixed(2), hit: hit ? hit.id : null });
        }
      }
      return out;
    },
    spot,
  );
  assert.equal(r.bad.length, 0, `${label} not open/flat: ${JSON.stringify(r)}`);
  return r.cy;
}

try {
  await check('NWT: water start spawns on the plaza podium (flat, clear)', async () => {
    await h.newGame('water');
    await fast(true);
    await h.step(20);
    const s = await h.state();
    near(s.player.x, -250, 1, 'spawn x');
    near(s.player.z, -1560, 1, 'spawn z');
    near(s.player.y, L1, 0.25, 'spawn on street level');
    assert.ok(s.player.grounded, 'grounded');
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4]]) near(await ground(-250 + dx, -1560 + dz, 8), L1, 0.1, `ground near spawn (${dx},${dz})`);
    const built = await h.eval((g) => g.debug.waterRegions.built());
    assert.ok(built.includes('nwt_city'), 'nwt_city built: ' + JSON.stringify(built));
  });

  await check('NWT spots: masters, training grounds, givers, merchants, docks, shrines, viewpoints, habitats', async () => {
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    const need = [
      'master_siku', 'training_siku', 'master_yugoda', 'training_yugoda', 'giver_nwt_elder', 'giver_nwt_chief',
      'merchant_nwt_1', 'merchant_nwt_2', 'merchant_nwt_3', 'merchant_nwt_4', 'dock_nwt_harbor', 'dock_nwt_grand_canal', 'dock_nwt_outer',
      'bridge_nwt_gate', 'shrine_spirit_oasis', 'shrine_ice_caves', 'viewpoint_nwt_wall', 'viewpoint_nwt_palace', 'viewpoint_nwt_glacier', 'habitat_otter_penguin_1',
      'master_akka', 'training_akka', 'giver_swt_chief', 'merchant_swt_1', 'dock_swt_ice', 'viewpoint_swt_tower', 'habitat_otter_penguin_2',
      'training_tutorial', 'tutorial_dummy_1', 'tutorial_dummy_6', 'tutorial_companion', 'viewpoint_meditation_isle', 'shrine_meditation_pavilion',
    ];
    for (const id of need) assert.ok(spots[id], `spot ${id} missing`);
    for (const t of ['training_siku', 'training_yugoda', 'training_akka', 'training_tutorial']) assert.ok(spots[t].r >= 12, `${t} radius >= 12`);
  });

  await check('NWT training grounds are open and flat (Siku courtyard, Yugoda yard)', async () => {
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    await teleport(spots.training_siku.x + 2, spots.training_siku.z - 9, 20);
    near(await assertOpenFlat(spots.training_siku, 'training_siku'), L1, 0.3, 'courtyard level');
    await teleport(spots.training_yugoda.x, spots.training_yugoda.z, 20);
    near(await assertOpenFlat(spots.training_yugoda, 'training_yugoda'), L1, 0.3, 'healer yard level');
  });

  await check('NWT walk: Great Ice Gate → canal quays & bridges → Tribal Plaza → terraces → palace forecourt', async () => {
    const p = await teleport(-220, -1735, 30);
    assert.ok(p.y >= L1 - 0.1 && p.y < L1 + 1.2, `gate bridge deck height ${p.y}`);
    const r = await walkPath(
      [[-234, -1728], [-234, -1692], [-234, -1662], [-234, -1637.5], [-246, -1637.5], [-246, -1612], [-230, -1592], [-235, -1552], [-235, -1531], [-232, -1514], [-221, -1512], [-220, -1498], [-220, -1476]],
      { minY: L1 - 0.6 },
    );
    near(r.y, L3, 0.35, 'palace forecourt (T2) height');
    assert.ok(r.grounded, 'grounded at the forecourt');
  });

  await check('NWT walk: plaza → gorge bridge → Waterbending Courtyard', async () => {
    const routes = await h.eval((g) => g.debug.waterRegions.routes());
    const [b, a] = routes.gorge_bridge_1;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    const bFar = [b[0] + (dx / l) * 18, b[1] + (dz / l) * 18];
    await teleport(-252, -1562, 20);
    const r = await walkPath([bFar, b, a, [-326, -1558]], { minY: L1 - 0.6 });
    near(r.y, L1, 0.3, 'courtyard level');
    // The river runs 5 m below in the gorge: the bridge kept us up.
    assert.ok(r.minY > L1 - 0.6, 'never dropped into the gorge');
  });

  await check('NWT walk: Glacier Pass Gate → northern road (outside the walls)', async () => {
    await teleport(-190, -1556, 20);
    const r = await walkPath([[-172, -1540], [-170, -1470], [-170, -1424], [-170, -1398], [-188, -1385]], { tol: 1.5 });
    assert.ok(r.y < L1 - 0.5, `descended to the terrain outside: ${r.y}`);
    assert.ok(r.grounded, 'grounded on the road side');
  });

  await check('NWT walk: Great Ice Gate jetty → sea causeway → sea-lock deck crossing → harbor-side jetty', async () => {
    await teleport(-234, -1772, 20);
    // West jetty out to the sea lock, across the lock deck (seaward of the gantry), back on the east jetty.
    const r = await walkPath([[-234, -1830], [-234, -1925], [-232, -1935], [-208, -1935], [-206, -1925], [-206, -1880]], { minY: L1 - 0.3 });
    near(r.y, L1, 0.25, 'causeway deck height');
    assert.ok(r.grounded, 'grounded on the causeway');
    // The canal reaches the sea: liquid canal source near the lock, the open sea beyond.
    const src = await sources(20);
    assert.ok(src.some((s) => s.id === 'nwt:grand_canal' && !s.frozen), 'grand canal source on the causeway: ' + JSON.stringify(src));
    const lockSea = await h.eval((g) => g.ctx.world.waterAt(-220, -1950));
    assert.ok(lockSea && lockSea.kind === 'ocean', 'open sea beyond the lock: ' + JSON.stringify(lockSea));
    // Nobody can walk under the causeway from the beach: solid down to the sea floor.
    const under = await h.eval((g) => {
      const THREE = g.THREE;
      const y = g.ctx.world.collision.groundAt(-199.5, -1880, 50)?.y ?? null;
      const hit = g.ctx.world.collision.overlapSphere(new THREE.Vector3(-201, 2.2, -1880), 0.4);
      return { y, hit: hit ? hit.id : null };
    });
    assert.ok(under.hit !== null, 'causeway core is solid below the deck: ' + JSON.stringify(under));
  });

  await check('NWT walk: passage → hidden door → Spirit Oasis', async () => {
    await teleport(-168, -1460, 20);
    const r = await walkPath([[-162, -1451.5], [-152, -1451.5], [-144, -1451.5], [-124, -1450]]);
    near(r.y, 4.45, 0.3, 'oasis lawn height');
    const src = await sources(25);
    assert.ok(src.some((s) => s.id === 'nwt:spirit_oasis' && !s.frozen), 'spirit oasis pond source: ' + JSON.stringify(src));
  });

  await check('NWT water sources: canals, basin, courtyard pool, palace falls, healing basins, cave ice', async () => {
    await teleport(-246, -1628, 20);
    let src = await sources(22);
    assert.ok(src.some((s) => s.id === 'nwt:moon_basin' || s.id === 'nwt:grand_canal'), 'basin/canal: ' + JSON.stringify(src));
    assert.ok(src.some((s) => s.type === 'canal' && !s.frozen), 'liquid canal source');
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    await teleport(spots.training_siku.x + 6, spots.training_siku.z, 20);
    src = await sources(15);
    assert.ok(src.some((s) => s.id === 'nwt:courtyard_pool'), 'courtyard pool: ' + JSON.stringify(src));
    await teleport(spots.master_yugoda.x - 2, spots.master_yugoda.z, 20);
    src = await sources(15);
    assert.ok(src.some((s) => s.id.startsWith('nwt:healing_basin')), 'healing basins: ' + JSON.stringify(src));
    await teleport(-236, -1470, 20);
    src = await sources(45);
    assert.ok(src.some((s) => s.id.startsWith('nwt:palace_fall') || s.id.startsWith('nwt:palace_pool')), 'palace falls/pools: ' + JSON.stringify(src));
    const p = await teleport(-521, -1337, 40);
    src = await sources(15);
    assert.ok(src.some((s) => s.id === 'nwt:cave_ice' && s.frozen), 'frozen cave pool: ' + JSON.stringify(src));
    assert.ok(p.y > 40, `inside the glacier cave (y ${p.y})`);
  });

  await check('perf: NWT plaza street view and aerial view', async () => {
    await teleport(-250, -1560, 30);
    await fast(false);
    await h.eval((g) => g.freeCamera(null));
    await h.step(10);
    await h.wait(1500);
    const a = (await h.state()).render;
    await h.eval((g) => g.freeCamera({ x: -220, y: 110, z: -1880 }, { x: -220, y: 0, z: -1590 }));
    await h.step(10);
    await h.wait(1500);
    const b = (await h.state()).render;
    await h.eval((g) => g.freeCamera(null));
    await fast(true);
    console.log(`  [${preset}] NWT plaza view: calls=${a.drawCalls} tris=${a.triangles} fps=${a.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] NWT aerial view: calls=${b.drawCalls} tris=${b.triangles} fps=${b.fps?.toFixed?.(1)}`);
    assert.ok(a.drawCalls < 450 && b.drawCalls < 600, `draw calls ${a.drawCalls}/${b.drawCalls}`);
  });

  await check('SWT walk: southern road → whalebone gate → meeting ground → sea ice (Akka)', async () => {
    await teleport(220, 1505, 60);
    const built = await h.eval((g) => g.debug.waterRegions.built());
    assert.ok(built.includes('swt_village'), 'swt built: ' + JSON.stringify(built));
    const r = await walkPath([[220, 1548], [220, 1556], [220, 1572], [211, 1588], [219, 1601], [220, 1630], [221, 1645], [222, 1662]], { tol: 1.3 });
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    near(r.y, spots.training_akka.y, 0.3, 'standing on the sea ice');
    await assertOpenFlat(spots.training_akka, 'training_akka');
    const src = await sources(25);
    assert.ok(src.some((s) => s.id === 'swt:sea_ice' && s.frozen), 'sea ice source: ' + JSON.stringify(src));
    assert.ok(src.some((s) => s.id.startsWith('swt:fishing_hole') && !s.frozen), 'liquid fishing holes: ' + JSON.stringify(src));
  });

  await check('Meditation Isle: spawn → training circle; pond, falls, stream and ice sources', async () => {
    await teleport(-1800, -1775, 80);
    const built = await h.eval((g) => g.debug.waterRegions.built());
    assert.ok(built.includes('meditation_isle'), 'isle built: ' + JSON.stringify(built));
    const r = await walkPath([[-1794, -1764], [-1788, -1752]]);
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    near(r.y, spots.training_tutorial.y, 0.3, 'on the stone circle');
    await assertOpenFlat({ ...spots.training_tutorial, r: 14 }, 'training_tutorial');
    await teleport(-1800, -1780, 20);
    let src = await sources(30);
    for (const id of ['isle:waterfall']) assert.ok(src.some((s) => s.id === id), `${id}: ` + JSON.stringify(src));
    await teleport(-1838, -1774, 20);
    src = await sources(20);
    assert.ok(src.some((s) => s.id === 'isle:ice' && s.frozen), 'isle ice: ' + JSON.stringify(src));
    await teleport(-1758, -1786, 20);
    src = await sources(20);
    assert.ok(src.some((s) => s.id === 'isle:stream'), 'isle stream: ' + JSON.stringify(src));
  });

  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 5).join('\n'));
  });
} finally {
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
