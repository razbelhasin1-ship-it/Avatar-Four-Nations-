/**
 * Water region E2E: the Northern Water Tribe capital, the Southern Water Tribe
 * village and Meditation Isle.
 *  - walks key routes (NWT / Agna Qel'a: plaza spawn → terrace stairs →
 *    avenue → palace plaza → palace platform; palace → garden → crevasse →
 *    Spirit Oasis; harbor quay → harbor-head bridge → promenade → grand
 *    stairs → plaza; plaza → district lanes and footbridges → Waterbending
 *    Courtyard; harbor quay → gate stairs → wall walk; noble quarter →
 *    Glacier Pass → northern road. SWT: road → gate → meeting ground → sea
 *    ice. Isle: spawn → training circle)
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
const L2 = 9.5;
const L4 = 17.5;
const PLATFORM = 23.5;
const GATE_TOP = 22;
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
  await check('NWT: water start spawns in the ceremony plaza (L2, flat, clear)', async () => {
    await h.newGame('water');
    await fast(true);
    await h.step(20);
    const s = await h.state();
    near(s.player.x, -236, 1, 'spawn x');
    near(s.player.z, -1606, 1, 'spawn z');
    near(s.player.y, L2, 0.3, 'spawn on the plaza level');
    assert.ok(s.player.grounded, 'grounded');
    const built = await h.eval((g) => g.debug.waterRegions.built());
    assert.ok(built.includes('nwt_city'), 'nwt_city built: ' + JSON.stringify(built));
  });

  await check('NWT: spots published; training grounds open and flat', async () => {
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    const need = [
      'master_siku', 'training_siku', 'master_yugoda', 'training_yugoda', 'giver_nwt_elder', 'giver_nwt_chief',
      'merchant_nwt_1', 'merchant_nwt_2', 'merchant_nwt_3', 'merchant_nwt_4', 'merchant_nwt_beasts', 'dock_nwt_harbor', 'dock_nwt_grand_canal', 'dock_nwt_sea_gate',
      'bridge_nwt_gate', 'shrine_spirit_oasis', 'shrine_ice_caves', 'viewpoint_nwt_wall', 'viewpoint_nwt_palace', 'viewpoint_nwt_glacier', 'habitat_otter_penguin_1',
      'training_akka', 'training_tutorial',
    ];
    for (const id of need) assert.ok(spots[id], `spot ${id} missing`);
    for (const t of ['training_siku', 'training_yugoda', 'training_akka', 'training_tutorial']) assert.ok(spots[t].r >= 12, `${t} radius >= 12`);
    await teleport(spots.training_siku.x + 2, spots.training_siku.z - 9, 20);
    near(await assertOpenFlat(spots.training_siku, 'training_siku'), L2, 0.3, 'courtyard level');
    await teleport(spots.training_yugoda.x, spots.training_yugoda.z, 20);
    near(await assertOpenFlat(spots.training_yugoda, 'training_yugoda'), L2, 0.3, 'healer yard level');
    // Every merchant and quest-giver spot stands on a walkable floor at its level.
    for (const id of ['giver_nwt_elder', 'giver_nwt_chief', 'merchant_nwt_1', 'merchant_nwt_2', 'merchant_nwt_3', 'merchant_nwt_4', 'merchant_nwt_beasts', 'dock_nwt_harbor', 'dock_nwt_grand_canal', 'dock_nwt_sea_gate', 'shrine_spirit_oasis']) {
      const sp = spots[id];
      near(await ground(sp.x, sp.z, sp.y + 1), sp.y, 0.35, `${id} floor`);
    }
  });

  await check('NWT walk: plaza spawn → terrace stairs → avenue → palace plaza → palace platform', async () => {
    await teleport(-236, -1606, 20);
    const r = await walkPath([[-250, -1585], [-250, -1557], [-226, -1557], [-220, -1530], [-220, -1500], [-220, -1474], [-220, -1458], [-220, -1449]]);
    near(r.y, PLATFORM, 0.4, 'on the palace platform');
    assert.ok(r.grounded, 'grounded on the platform');
  });

  await check('NWT walk: palace plaza → west garden → lamp-lit crevasse → moon gate → moon bridge → koi island', async () => {
    await teleport(-220, -1480, 20);
    const r = await walkPath([[-259.5, -1478], [-259.5, -1440], [-259.5, -1412], [-259.5, -1396], [-259.5, -1386], [-256.5, -1381.5], [-245, -1374], [-238.5, -1368], [-229, -1368], [-222, -1372]], { minY: L4 - 0.4 });
    near(r.y, L4, 0.4, 'island level');
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    assert.ok(Math.hypot(r.x - spots.shrine_spirit_oasis.x, r.z - spots.shrine_spirit_oasis.z) < 2, 'reached the shrine spot on the island');
    const src = await sources(20);
    assert.ok(src.some((s) => s.id === 'nwt:spirit_oasis' && !s.frozen), 'spirit oasis pond source: ' + JSON.stringify(src));
    const koi = await h.eval((g) => {
      const out = {};
      g.ctx.render.scene.traverse((o) => { if (o.name === 'koi_la' || o.name === 'koi_tui') out[o.name] = [o.position.x, o.position.z]; });
      return out;
    });
    assert.ok(koi.koi_la && koi.koi_tui, 'La and Tui swim in the koi pond: ' + JSON.stringify(koi));
  });

  await check('NWT walk: harbor quay → harbor-head bridge → promenade → grand stairs → plaza', async () => {
    const p = await teleport(-262, -1840, 30);
    near(p.y, L1, 0.3, 'harbor quay level');
    const r = await walkPath([[-262, -1806], [-250, -1797], [-237, -1797], [-222, -1797], [-220, -1740], [-220, -1668], [-220, -1646], [-220, -1630]], { minY: L1 - 0.4 });
    near(r.y, L2, 0.3, 'plaza level');
  });

  await check('NWT walk: lower-city lanes, footbridge and canal bridge → middle-district stairs → Waterbending Courtyard', async () => {
    await teleport(-246, -1772, 20);
    const r = await walkPath([[-300, -1772], [-300, -1750], [-300, -1726], [-300, -1700], [-300, -1676], [-300, -1655], [-300, -1630], [-300, -1615], [-350, -1615]], { minY: L1 - 0.4 });
    near(r.y, L2, 0.3, 'courtyard level');
    const r2 = await walkPath([[-300, -1615], [-300, -1676], [-262, -1676], [-246, -1676], [-228, -1676], [-212, -1676], [-196, -1676], [-140, -1676]], { minY: L1 - 0.4 });
    near(r2.y, L1, 0.3, 'east lower city level');
  });

  await check('NWT walk: harbor quay → gate stairs → wall walk', async () => {
    await teleport(-259, -1850, 20);
    const r = await walkPath([[-260.6, -1866], [-260.6, -1890], [-260.6, -1901], [-240, -1901]], { tol: 1.4 });
    near(r.y, GATE_TOP, 0.4, 'on the wall walk');
  });

  await check('NWT walk: palace plaza → noble lane → Glacier Pass → northern road', async () => {
    await teleport(-200, -1480, 20);
    const r = await walkPath([[-170, -1468], [-111, -1468], [-111, -1420], [-111, -1400], [-111, -1360], [-111, -1338]], { tol: 1.5 });
    assert.ok(r.y > L4 + 8, `climbed out through the pass: ${r.y}`);
    assert.ok(r.grounded, 'grounded at the pass mouth');
  });

  await check('NWT: waterbending sources (canals, harbor, pools, moat, caves)', async () => {
    await teleport(-246, -1720, 20);
    let src = await sources(25);
    assert.ok(src.some((s) => s.id === 'nwt:twin_w' && s.type === 'canal' && !s.frozen), 'west canal: ' + JSON.stringify(src));
    await teleport(-262, -1840, 20);
    src = await sources(25);
    assert.ok(src.some((s) => s.id === 'nwt:harbor'), 'harbor basin: ' + JSON.stringify(src));
    await teleport(-220, -1600, 20);
    src = await sources(40);
    assert.ok(src.some((s) => s.id === 'nwt:plaza_fountain'), 'plaza fountain: ' + JSON.stringify(src));
    const spots = await h.eval((g) => g.debug.waterRegions.spots());
    await teleport(spots.training_siku.x + 6, spots.training_siku.z, 20);
    src = await sources(25);
    assert.ok(src.some((s) => s.id === 'nwt:courtyard_pool'), 'courtyard pool: ' + JSON.stringify(src));
    await teleport(spots.master_yugoda.x - 2, spots.master_yugoda.z, 20);
    src = await sources(30);
    assert.ok(src.some((s) => s.id === 'nwt:healing_pool'), 'healing spring: ' + JSON.stringify(src));
    await teleport(-236, -1470, 20);
    src = await sources(25);
    assert.ok(src.some((s) => s.id === 'nwt:palace_moat'), 'palace moat: ' + JSON.stringify(src));
    const p = await teleport(-521, -1337, 40);
    src = await sources(15);
    assert.ok(src.some((s) => s.id === 'nwt:cave_ice' && s.frozen), 'frozen cave pool: ' + JSON.stringify(src));
    assert.ok(p.y > 40, `inside the glacier cave (y ${p.y})`);
  });

  await check('perf: NWT plaza street view and aerial view', async () => {
    await teleport(-236, -1606, 30);
    await fast(false);
    await h.eval((g) => g.freeCamera(null));
    await h.step(10);
    await h.wait(1500);
    const a = (await h.state()).render;
    await h.eval((g) => g.freeCamera({ x: -220, y: 190, z: -2010 }, { x: -220, y: 0, z: -1660 }));
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
