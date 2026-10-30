/**
 * Earth Kingdom regions E2E: Ba Sing Se (Earth start), Gaoling, Riverbend.
 *  - walks key routes: arrival plaza → farm track → Lake Laogai shore →
 *    stepping stones → Dai Li base → Inner Wall south gate → Lower, Middle and
 *    Upper Rings → palace South Gate → throne-hall terrace; Lower Ring → Inner
 *    Wall west gate → Outer Wall gate → outside; Gaoling gate → arena ring;
 *    Riverbend footbridge across the gorge, boardwalk → dock, ramp → mill
 *  - rides the monorail (lift, board, alight), soaks the train schedules for
 *    5 minutes, checks crowds (counts, night shutters, Dai Li), F3 overlay
 *  - checks walkable heights (groundAt), registered water sources
 *    (g.waterNearby), published spots (training areas flat, open, r >= 12),
 *    detail levels, no console errors
 *  - reports draw calls / triangles / fps inside the Lower Ring, from the
 *    Middle Ring and from outside the walls
 * Run: node tests/e2e/region-earth.e2e.mjs [--preset medium]
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
    assert.ok(!r.swimming, `swimming on the way to (${x}, ${z})`);
  }
  return r;
}

const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);
const tp = (x, z, y) => h.eval((g, x, z, y) => g.teleport(x, z, y), x, z, y);
const info = (id) =>
  h.eval((g, id) => {
    const r = g.debug.earth.region(id);
    if (!r) return null;
    return JSON.parse(JSON.stringify({ marks: r.marks, stats: r.stats(), walls: r.walls ? { stairs: r.walls.stairs, gates: r.walls.gates } : null, middle: r.middle ?? null, upper: r.upper ?? null }));
  }, id);

try {
  await h.newGame('earth');
  await h.eval((g) => g.setting('graphics.renderScale', 0.35));
  // Random encounters (bandit camps, Dai Li patrols by Lake Laogai) are not what these routes test.
  await h.eval((g) => { g.debug.enemies?.camps(false); g.debug.enemies?.clear(); });

  await check('earth start: spawn is clear, flat and grounded in the Lower Ring Square', async () => {
    const st = await h.state();
    assert.equal(st.region, 'ba_sing_se');
    near(st.player.x, 638, 1, 'spawn x');
    near(st.player.z, -36, 1, 'spawn z');
    near(st.player.y, 26, 0.15, 'spawn on the square');
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]) near(await ground(st.player.x + dx, st.player.z + dz, 40), 26, 0.06, `spawn surroundings flat (${dx},${dz})`);
    const regs = await h.eval((g) => g.debug.earth.regions());
    const bss = regs.find((r) => r.id === 'ba_sing_se');
    assert.ok(bss && !bss.building, `Ba Sing Se built: ${JSON.stringify(regs)}`);
    const m = (await info('ba_sing_se')).marks;
    assert.ok(m.lowerHouses.x >= 200, `Lower Ring houses ${m.lowerHouses.x}`);
    assert.ok(m.middleHouses.x >= 60, `Middle Ring houses ${m.middleHouses.x}`);
    for (const k of ['palace', 'throne', 'arrival_gateway', 'laogai_door', 'laogai_base', 'zoo', 'farmFields', 'station_arrival_c', 'station_mid_n']) assert.ok(m[k], `mark ${k}`);
    console.log(`  houses: lower=${m.lowerHouses.x} middle=${m.middleHouses.x} upper estates=${m.upperEstates?.x} fields=${m.farmFields.x}; stats ${JSON.stringify(bss)}`);
  });

  await check('spots: masters, training floors, givers, merchants, docks, shrines, viewpoints', async () => {
    const spots = await h.eval((g) => g.debug.earth.spots());
    const need = ['giver_bss_elder', 'master_lien', 'training_lien', 'merchant_bss_1', 'merchant_bss_2', 'merchant_bss_3', 'merchant_bss_4', 'dock_laogai', 'shrine_bss_earth_king', 'viewpoint_bss_palace', 'viewpoint_bss_outer_wall', 'master_lin', 'training_lin', 'giver_gaoling_lord', 'merchant_gaoling_1', 'dock_riverbend', 'bridge_riverbend', 'giver_riverbend_elder', 'merchant_riverbend_1'];
    for (const id of need) assert.ok(spots[id], `spot ${id} defined`);
    assert.ok(spots.training_lin.r >= 12, `training_lin radius ${spots.training_lin.r}`);
    assert.ok(spots.training_lien.r >= 10, `training_lien radius ${spots.training_lien.r} (inside the dojo hall)`);
    // Ba Sing Se spots: ground matches the published height (Gaoling/Riverbend are checked on arrival).
    for (const id of ['giver_bss_elder', 'master_lien', 'training_lien', 'merchant_bss_1', 'merchant_bss_2', 'merchant_bss_3', 'merchant_bss_4', 'merchant_bss_tea', 'viewpoint_bss_palace', 'viewpoint_bss_outer_wall', 'shrine_bss_earth_king', 'dock_laogai']) {
      const s = spots[id];
      near(await ground(s.x, s.z, s.y + 1), s.y, 0.35, `${id} ground`);
    }
    // The dojo floor is open and flat across its whole radius.
    const t = spots.training_lien;
    for (let a = 0; a < 8; a++) for (const f of [0.4, 0.95]) {
      const x = t.x + Math.cos(a * 0.785) * t.r * f, z = t.z + Math.sin(a * 0.785) * t.r * f;
      near(await ground(x, z, t.y + 3), t.y, 0.08, `dojo floor flat/open at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  });

  await check('water sources: Firelight Fountain, garden pond, palace pond and Golden Water, upper fountain, Lake Laogai', async () => {
    const m = (await info('ba_sing_se')).marks;
    const has = async (x, z, r, test, what) => {
      await tp(x, z);
      const w = await h.eval((g, r) => g.waterNearby(r), r);
      assert.ok(w.some(test), `${what}: ${JSON.stringify(w.map((s) => s.id))}`);
    };
    await has(644, -60, 30, (s) => s.id === 'ba_sing_se:firelight_fountain', 'fountain');
    await has(744, -120, 40, (s) => s.id === 'ba_sing_se:garden_pond', 'garden pond');
    await has(850, -50, 80, (s) => s.id === 'ba_sing_se:golden_water', 'Golden Water');
    await has(m.upper_fountain_60.x, m.upper_fountain_60.z, 25, (s) => s.id.includes('fountain'), 'upper fountain');
    await has(1000, 168, 40, (s) => s.type === 'lake' || s.id.includes('laogai'), 'Lake Laogai');
  });

  // Ba Sing Se geometry (bssLayout.ts): C = (850, -50), Y up, north = -z; polar(θ, r) around C.
  const C = { x: 850, z: -50 };
  const pol = (deg, r) => [+(C.x + Math.cos((deg * Math.PI) / 180) * r).toFixed(1), +(C.z + Math.sin((deg * Math.PI) / 180) * r).toFixed(1)];
  const HF = (lx, lz) => [1142 + 0.6595 * lx - 0.7518 * lz, 98 + 0.7518 * lx + 0.6595 * lz];

  await check('walk: arrival → Agrarian Zone → Lake Laogai → Dai Li base → Inner Wall → Lower → Middle → Upper → palace terrace', async () => {
    await tp(...pol(196, 372), 26);
    await h.step(10);
    // Along the West avenue, then round the farm track (r 285.5) to the lake.
    let r = await walkPath([pol(196, 300), pol(194, 285.5)], { minY: 25.4, tol: 1.5, sprint: true });
    const track = [];
    for (let t = 188; t >= 60; t -= 8) track.push(pol(t, 285.5));
    // (the farm legs may wade through the irrigation canal: never swimming, but below ground level)
    r = await walkPath(track, { minY: 23.5, tol: 1.8, sprint: true });
    // South shore of Lake Laogai to the stepping stones.
    // (round the east-shore boulder at ≈(1112, 165))
    r = await walkPath([[1055, 226.8], [1088.5, 219.4], [1109.4, 198.5], [1116.8, 175], [1117.5, 161], [1108.1, 153.2]], { minY: 25.4, tol: 1.5 });
    // Raise the stones, cross to the spur, open the concealed door, walk into the base.
    await h.eval((g) => g.ctx.interactions.get('bss_laogai_path').interact(g.ctx));
    await h.step(120);
    r = await walkPath([[1100, 149], [1092.4, 144.4]], { minY: 24.6, tol: 1.0 });
    await h.eval((g) => g.ctx.interactions.get('bss_laogai_door').interact(g.ctx));
    await h.step(120);
    r = await walkPath([HF(0, 60), HF(0, 23), HF(0, 15), HF(0, 4)], { minY: 25.5, tol: 1.2 });
    near(r.y, 26, 0.3, 'inside the Dai Li base (bison cavern)');
    assert.ok(await h.eval((g) => g.debug.bss.region().laogai.state.open === 1), 'door open');
    // Out again, back along the shore and the farm track to the Inner Wall south gate.
    r = await walkPath([HF(0, 15), HF(0, 23), HF(0, 60), [1092.4, 144.4], [1100, 149], [1108.1, 153.2], [1117.5, 161], [1116.8, 175], [1109.4, 198.5], [1088.5, 219.4], [1055, 226.8]], { minY: 24.6, tol: 1.2 });
    const back = [];
    for (let t = 64; t <= 90; t += 8) back.push(pol(t, 285.5));
    r = await walkPath(back, { minY: 23.5, tol: 1.8, sprint: true });
    // Inner Wall south gate (r 246) → Lower Ring → 中環 gate (r 170) → Middle Ring → 上環 gate (r 102) → Upper Ring.
    r = await walkPath([pol(90, 262), pol(90, 230), pol(90, 190), pol(90, 180), pol(90, 160), pol(90, 130), pol(90, 112), pol(90, 92)], { minY: 25.5, tol: 1.5 });
    near(r.y, 26, 0.3, 'Upper Ring avenue');
    // Palace: South Gate, Golden Water bridge, the three tiers to the throne-hall terrace.
    r = await walkPath([[856, 38], [856, 10], [850, 2], [850, -8], [850, -18], [850, -27], [850, -35]], { minY: 25.5, tol: 1.2 });
    const vp = (await h.eval((g) => g.debug.earth.spots())).viewpoint_bss_palace;
    near(r.y, vp.y, 0.35, 'palace terrace');
  });

  await check('monorail: lift up to the Middle Ring north platform, board, ride, alight at the next stop', async () => {
    const st = await h.eval((g) => g.debug.bss.stations().find((s) => s.id === 'mid_n'));
    await tp(st.lift.x, st.lift.z, 26.2);
    let up = 0;
    for (let i = 0; i < 40 && up < st.top - 1; i++) {
      await h.step(10);
      up = await h.eval((g) => g.ctx.player.position.y);
    }
    assert.ok(up > st.top - 1, `lift carried the player up to the platform (${st.top}): y=${up}`);
    await h.eval((g, s) => g.teleport(s.mark.x + -s.tz * 5.8, s.mark.z + s.tx * 5.8, s.top + 0.1), st);
    let boarded = false;
    for (let i = 0; i < 300 && !boarded; i++) {
      await h.step(10);
      boarded = await h.eval((g) => {
        const it = g.ctx.interactions.get('bss_board_mid_n');
        if (it && it.enabled()) {
          it.interact(g.ctx);
          return true;
        }
        return false;
      });
    }
    assert.ok(boarded, 'a train stopped and the player boarded');
    const riding = await h.eval((g) => g.debug.bss.riding());
    assert.ok(riding, 'riding');
    const p0 = await h.eval((g) => g.ctx.player.position.toArray());
    // Ride until the train has pulled out, then get off at the next stop.
    let away = false;
    for (let i = 0; i < 300 && !away; i++) {
      await h.step(10);
      away = await h.eval((g, p0) => {
        const p = g.ctx.player.position;
        return Math.hypot(p.x - p0[0], p.z - p0[2]) > 40;
      }, p0);
    }
    assert.ok(away, 'the train left the platform with the player aboard');
    let off = false;
    for (let i = 0; i < 400 && !off; i++) {
      await h.step(10);
      off = await h.eval((g) => {
        const it = g.ctx.interactions.get('bss_alight');
        if (it && it.enabled()) {
          it.interact(g.ctx);
          return true;
        }
        return false;
      });
    }
    await h.step(40);
    const p1 = await h.eval((g) => ({ p: g.ctx.player.position.toArray(), riding: g.debug.bss.riding(), grounded: g.ctx.player.body.grounded }));
    assert.ok(off, 'alighted at the next station');
    assert.ok(Math.hypot(p1.p[0] - p0[0], p1.p[2] - p0[2]) > 30, `rode somewhere: ${JSON.stringify({ p0, p1 })}`);
    assert.ok(!p1.riding && p1.grounded, `standing on the platform: ${JSON.stringify(p1)}`);
  });

  await check('trains: 5 minutes of service (schedules sampled at 30 Hz, then 60 s simulated)', async () => {
    const soak = await h.eval((g) => g.debug.bss.trainsSoak(300));
    console.log(`  soak ${JSON.stringify(soak)}`);
    assert.equal(soak.bad, 0, 'every sample on its line and finite');
    // Cruise 18 m/s; each earthbender kick surges the train by up to 30 % (bssTrains PULSE), so 23.4 m/s peaks
    // are by design. A jump or teleport would show up as a far higher speed.
    assert.ok(soak.maxSpeed <= 23.6, `top speed ${soak.maxSpeed}`);
    assert.ok(soak.maxAccel <= 32, `surges stay smooth: ${soak.maxAccel} m/s²`);
    assert.ok(soak.minGap > 5, `trains on one track keep apart: ${soak.minGap}`);
    assert.ok(soak.stops >= 20, `stops served: ${soak.stops}`);
    const run = await h.eval((g) => {
      const R = g.ctx.render;
      const render = R.render;
      R.render = () => {};
      try {
        const a = g.debug.bss.trains();
        for (let i = 0; i < 60; i++) g.step(30);
        const b = g.debug.bss.trains();
        return { n: a.length, moved: b.filter((t, i) => Math.hypot(t.x - a[i].x, t.z - a[i].z) > 5).length, finite: b.every((t) => Number.isFinite(t.x) && Number.isFinite(t.z)) };
      } finally {
        R.render = render;
      }
    });
    assert.ok(run.n >= 9 && run.finite && run.moved >= run.n - 1, `trains ran: ${JSON.stringify(run)}`);
  });

  await check('crowds: hundreds simulated, a packed Lower Ring, shutters at night, Dai Li on the Laogai shore', async () => {
    await h.eval((g) => { g.teleport(628, -14); g.setTime(11); g.freeCamera({ x: 628, y: 33, z: -14 }, { x: 646, y: 26, z: -36 }); });
    await h.step(6);
    await h.eval((g) => g.debug.bss.crowdWarm(40));
    await h.step(2);
    const day = await h.eval((g) => g.debug.bss.crowd());
    assert.ok(day.total >= 300, `simulated ${day.total}`);
    assert.ok(day.figures.near + day.figures.far >= 100, `drawn in a Lower Ring view: ${JSON.stringify(day.figures)}`);
    await h.eval((g) => g.setTime(22.5));
    await h.step(2);
    const shut = await h.eval((g) => g.debug.bss.region().crowd.shutters.count);
    assert.ok(shut > 20, `shutters down at night: ${shut}`);
    await h.eval((g) => { g.teleport(1100, 196); g.setTime(23.5); g.freeCamera({ x: 1100, y: 30, z: 196 }, { x: 1060, y: 26, z: 226 }); });
    await h.step(4);
    await h.eval((g) => g.debug.bss.crowdWarm(60));
    const daili = await h.eval((g) => g.debug.bss.region().crowd.agents.filter((a) => a.role === 'daili' && a.zone === 'laogai' && a.out && Math.hypot(a.x - 1060, a.z - 170) < 70).length);
    assert.ok(daili >= 2, `Dai Li patrolling the shore at night: ${daili}`);
    await h.eval((g) => { g.freeCamera(null); g.setTime(10); });
  });

  await check('crowds keep out of the architecture: nobody inside a house, stall, pier, gate block or closed gate', async () => {
    const spots = [
      [{ x: 670, y: 32, z: -112 }, { x: 690, y: 27, z: -104 }],
      [{ x: 633.5, y: 28, z: -22.5 }, { x: 641, y: 27, z: -32 }],
      [{ x: 729, y: 31, z: -52 }, { x: 714, y: 27, z: -52 }],
      [{ x: 856, y: 31, z: 106 }, { x: 850, y: 27, z: 120 }],
    ];
    let samples = 0;
    const inside = [];
    for (const [cam, look] of spots) {
      await h.eval((g, cam, look) => { g.teleport(cam.x, cam.z); g.setTime(11); g.freeCamera(cam, look); }, cam, look);
      await h.step(2);
      await h.eval((g) => g.debug.bss.crowdWarm(20));
      const r = await h.eval((g) => {
        const crowd = g.debug.bss.region().crowd, col = g.ctx.world.collision, cam = g.ctx.camera.position;
        const foot = (c, x, z) => {
          if (c.shape !== 'box') return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
          const dx = x - c.x, dz = z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
          return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz));
        };
        let n = 0;
        const bad = [];
        for (let k = 0; k < 6; k++) {
          g.debug.bss.crowdWarm(3);
          for (const a of crowd.agents) {
            // Stall keepers stand inside their stall's footprint, behind the counter.
            if (!a.out || a.role === 'seller' || (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 > 90 * 90) continue;
            n++;
            col.query(a.x, a.z, 0.2, (c) => {
              // Moving floors (lift platforms, stepping stones) are stood on; gate slabs and doors are not.
              if (!c.solid || c.br < 0.5 || (c.dynamic && c.walkable)) return;
              const top = c.shape === 'sphere' ? c.y + c.r : c.y + c.hy;
              if (top < a.y + (c.walkable ? 0.6 : 0.3) || c.y - c.hy > a.y + 1.7 || foot(c, a.x, a.z) >= 0.2) return;
              if (bad.length < 6) bad.push(`${a.role}/${a.state} at ${a.x.toFixed(1)},${a.z.toFixed(1)} in ${c.shape} ${c.hx.toFixed(1)}x${c.hz.toFixed(1)}${c.dynamic ? ' (gate)' : ''}`);
            });
          }
        }
        return { n, bad };
      });
      samples += r.n;
      inside.push(...r.bad);
    }
    assert.ok(samples > 2000, `people sampled around the camera: ${samples}`);
    assert.deepEqual(inside, [], `inside architecture (${samples} samples)`);
    await h.eval((g) => g.freeCamera(null));
  });

  await check('gate tunnels are clear: rays along every city gate passage hit no masonry, pillar or prop', async () => {
    const blocked = await h.eval((g) => {
      const R = g.debug.bss.region(), col = g.ctx.world.collision;
      const depth = { outer: 46, inner: 22, middle: 11, upper: 11 };
      const out = [];
      let rays = 0;
      for (const it of R.gates.items) {
        const wall = it.d.id.split('_')[0];
        if (!depth[wall]) continue;
        const D = depth[wall] / 2 + 1;
        for (const lat of [-(it.d.aw / 2 - 0.6), 0, it.d.aw / 2 - 0.6]) {
          for (const y of [0.4, 1.0, 1.9]) {
            const a = it.d.f.at(lat, D), b = it.d.f.at(lat, -D);
            const o = g.ctx.camera.position.clone().set(a.x, it.d.baseY + y, a.z);
            const dir = o.clone().set(b.x - a.x, 0, b.z - a.z).normalize();
            rays++;
            const hit = col.raycast(o, dir, 2 * D, (c) => !c.dynamic);
            if (hit && out.length < 6) out.push(`${it.d.id} lat ${lat.toFixed(1)} y ${y}: hit at ${hit.distance.toFixed(1)} m`);
          }
        }
      }
      return { rays, out };
    });
    assert.ok(blocked.rays >= 100, `rays cast: ${blocked.rays}`);
    assert.deepEqual(blocked.out, [], 'gate passages obstructed');
  });

  await check('debug overlay: F3 shows fps, draw calls, crowd, NPC and train counts', async () => {
    await tp(640, -30, 26);
    await h.step(4);
    await h.page.keyboard.press('F3');
    await h.step(12);
    const txt = await h.eval((g) => g.debug.bss.overlayText());
    for (const k of ['fps', 'draws', 'crowd', 'npcs', 'trains']) assert.ok(txt.includes(k), `overlay has ${k}: ${txt}`);
    await h.page.keyboard.press('F3');
    assert.equal(await h.eval(() => !!document.getElementById('bss-overlay')), false, 'F3 hides it again');
  });

  await check('route: Lower Ring → Inner Wall west gate → arrival plaza → Outer Wall gate → outside', async () => {
    await tp(...pol(196, 232), 26);
    let r = await walkPath([pol(196, 262), pol(196, 300), pol(196, 372), pol(196, 384)], { minY: 25.5, tol: 1.5, sprint: true });
    near(r.y, 26, 0.3, 'arrival plaza');
    r = await walkPath([pol(196, 440)], { minY: 20, tol: 1.5, sprint: true });
    assert.ok(r.grounded, 'grounded outside the Outer Wall');
  });

  await check('detail levels: far keeps walls/palace/viaducts, hidden hides all, full restores', async () => {
    const v = await h.eval((g) => {
      const r = g.debug.earth.region('ba_sing_se');
      const count = () => {
        let major = 0, other = 0;
        for (const c of r.chunks.chunks) {
          if (!c.group.visible) continue;
          if (c.kind === 'major') major++;
          else other++;
        }
        return { major, other, root: r.group.visible };
      };
      r.setDetail('far');
      const far = count();
      r.setDetail('hidden');
      const hidden = count();
      r.setDetail('full');
      return { far, hidden, full: count() };
    });
    assert.ok(v.far.major >= 5 && v.far.other === 0, `far: ${JSON.stringify(v.far)}`);
    assert.equal(v.hidden.root, false, 'hidden');
    assert.ok(v.full.other > 0, `full restores: ${JSON.stringify(v.full)}`);
  });

  await check('perf: draw calls / triangles / fps (Lower Ring, market, aerial, outside the walls)', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    const views = [
      ['lower ring', (g) => { g.freeCamera(null); g.teleport(640, -30, 26); g.faceTowards(700, -60); }],
      ['market', (g) => { g.teleport(660, -116, 26); g.faceTowards(690, -170); }],
      ['arrival', (g) => { g.teleport(471, -158, 26); g.faceTowards(600, -120); }],
      ['aerial', (g) => g.freeCamera({ x: 600, y: 160, z: 140 }, { x: 800, y: 30, z: -60 })],
      ['outside walls', (g) => { g.freeCamera(null); g.teleport(380, -150); g.faceTowards(850, -50); }],
    ];
    for (const [name, fn] of views) {
      await h.eval(fn);
      await h.step(10);
      await h.wait(1800);
      const r = (await h.state()).render;
      console.log(`  [${preset}] ${name}: calls=${r.drawCalls} tris=${r.triangles} fps=${r.fps?.toFixed?.(1)}`);
      assert.ok(r.drawCalls < 700, `${name} draw calls ${r.drawCalls}`);
    }
    await h.eval((g) => { g.freeCamera(null); g.setting('graphics.renderScale', 0.35); });
  });

  await check('Gaoling: town gate → square → Earth Rumble ring floor (training_lin)', async () => {
    const spots = await h.eval((g) => g.debug.earth.spots());
    await tp(500, 300);
    await h.step(20);
    const gi = await info('gaoling');
    assert.ok(gi && !gi.stats.building, 'Gaoling built');
    let r = await walkPath([[475, 300], [440, 292], [gi.marks.arenaEntrance.x, gi.marks.arenaEntrance.z]], { minY: 21.5, tol: 1.5 });
    const t = spots.training_lin;
    r = await walkPath([[t.x, t.z]], { minY: 21.5, tol: 1.2 });
    near(r.y, t.y, 0.15, 'arena floor');
    for (let a = 0; a < 8; a++) near(await ground(t.x + Math.cos(a * 0.785) * 12, t.z + Math.sin(a * 0.785) * 12, t.y + 2), t.y, 0.08, `ring floor open (${a})`);
    const w = await h.eval((g) => g.waterNearby(60));
    assert.ok(w.some((s) => s.id === 'gaoling_fountain'), `Gaoling fountain: ${JSON.stringify(w.map((s) => s.id))}`);
    for (const id of ['giver_gaoling_lord', 'merchant_gaoling_1', 'merchant_gaoling_2', 'master_lin']) near(await ground(spots[id].x, spots[id].z, spots[id].y + 1), spots[id].y, 0.35, `${id} ground`);
  });

  await check('Riverbend: footbridge across the gorge, boardwalk to the dock, mill platform', async () => {
    const spots = await h.eval((g) => g.debug.earth.spots());
    await tp(160, -548);
    await h.step(20);
    const ri = await info('river_village');
    assert.ok(ri && !ri.stats.building, 'Riverbend built');
    const m = ri.marks;
    let r = await walkPath([[m.bridgeA.x + 2, m.bridgeA.z], [m.bridgeB.x - 2, m.bridgeB.z]], { minY: 19.5, tol: 1.2 });
    assert.ok(r.minY > 19.5, `stayed on the bridge deck: ${JSON.stringify(r)}`);
    r = await walkPath([[m.bridgeA.x + 3, m.bridgeA.z], [150, -600], [m.dockTop.x + 3, m.dockTop.z], [m.dockEnd.x, m.dockEnd.z]], { minY: 11.8, tol: 1.2 });
    near(r.y, 12.5, 0.3, 'on the dock');
    assert.ok(!r.swimming, 'not swimming on the dock');
    const w = await h.eval((g) => g.waterNearby(20));
    assert.ok(w.some((s) => s.type === 'river'), `river source at the dock: ${JSON.stringify(w.map((s) => s.id))}`);
    await tp(130, -590);
    r = await walkPath([[m.mill.x + 3, m.mill.z + 3]], { minY: 14.5, tol: 1.2 });
    near(r.y, m.mill.y, 0.3, 'mill platform');
    near(await ground(spots.dock_riverbend.x, spots.dock_riverbend.z, spots.dock_riverbend.y + 1), spots.dock_riverbend.y, 0.3, 'dock spot');
  });

  await check('streamed in from afar: Ba Sing Se builds time-sliced, then registers NPCs and interactions', async () => {
    const h2 = await launch({ width: 640, height: 360, preset });
    try {
      await h2.newGame('water');
      await h2.eval((g) => g.setting('graphics.renderScale', 0.35));
      // ≈630 m from the city centre: inside its load radius but far enough to defer construction.
      await h2.eval((g) => g.teleport(220, -40));
      await h2.step(2);
      const first = await h2.eval((g) => {
        const r = g.debug.earth?.region('ba_sing_se');
        return r ? { building: r.building } : null;
      });
      assert.ok(first && first.building, `construction deferred on arrival: ${JSON.stringify(first)}`);
      let done = null;
      for (let i = 0; i < 150 && !done; i++) {
        done = await h2.eval((g) => {
          const R = g.ctx.render;
          const render = R.render;
          R.render = () => {};
          try {
            g.step(20);
          } finally {
            R.render = render;
          }
          const r = g.debug.earth.region('ba_sing_se');
          return r && !r.building ? { houses: r.marks.lowerHouses.x, path: !!g.ctx.interactions.get('bss_laogai_path'), npc: !!g.ctx.npcs.getDef('bss_guide') } : null;
        });
      }
      assert.ok(done, 'deferred build finished');
      assert.ok(done.houses > 150 && done.path && done.npc, `built and registered: ${JSON.stringify(done)}`);
      assert.equal(h2.errors.length, 0, h2.errors.slice(0, 3).join('\n'));
      console.log(`  streamed build: ${JSON.stringify(done)}`);
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
