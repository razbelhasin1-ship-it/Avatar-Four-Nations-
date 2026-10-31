/**
 * Air region E2E: the Southern Air Temple (terraces L0–L6 round one rock pinnacle, joined by the
 * switchback road; the Avatar sanctuary under the summit), the mountain trail with its gorge
 * stair-bridge, and the Shrine of the Four Winds.
 *  - spawn on the main landing ledge; published spots; the masters' training fields are flat and open
 *  - walks the whole road from the gate plaza to the summit, the trail's last leg up its stair
 *    trench onto the gate plaza, and into the sanctuary (the shut door blocks, an air cast at it
 *    opens it, down the tunnel to the statue chamber and back out)
 *  - balustrades stop a runner at terrace edges; fountains, ponds, springs and falls are real
 *    water sources; monks, sky bison and lemurs are alive; a whistle brings a temple bison down
 *  - detail levels, session restart, draw calls, no console errors
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

// Temple frame (src/world/regions/air/sat/layout.ts): centre, base height, level heights.
const C = { x: 1450, z: 1250 };
const BASE = 330;
const LEVEL_Y = [0, 18, 36, 52, 68, 90, 108];
const floorY = (l) => BASE + LEVEL_Y[l] + 0.2;
const pol = (th, r) => [C.x + Math.cos((th * Math.PI) / 180) * r, C.z + Math.sin((th * Math.PI) / 180) * r];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
// Life on each preset (sat/herd.ts, sat/lemurs.ts, sat/monks.ts).
const LIFE = { low: { monks: 110, bison: 29, lemurs: 18 }, medium: { monks: 150, bison: 42, lemurs: 30 }, high: { monks: 170, bison: 50, lemurs: 34 }, ultra: { monks: 170, bison: 50, lemurs: 34 } }[preset] ?? { monks: 110, bison: 29, lemurs: 18 };

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
    assert.ok(r.dist < (o.tol ?? 1.2) + 0.6, `stuck before (${x.toFixed(1)}, ${z.toFixed(1)}): ${JSON.stringify(r)}`);
  }
  return r;
}

const ground = (x, z, maxY = Infinity) => h.eval((g, x, z, m) => g.ctx.world.groundAt(x, z, m).y, x, z, maxY);
/** Evaluate fn(temple, g, ...args) in the page (temple = the Southern Air Temple region). */
// eslint-disable-next-line no-new-func
const temple = (fn, ...args) => h.eval((g, src, a) => new Function('return (' + src + ')')()(g.debug.air.region('air_temple_summit'), g, ...a), fn.toString(), args);
const teleport = async (x, z, y) => {
  await h.eval((g, x, z, y) => g.teleport(x, z, y), x, z, y);
  await h.step(6);
};

try {
  await check('air start: spawn grounded on the main landing ledge (bison terrace, L1)', async () => {
    await h.newGame('air');
    // Walking checks render every simulated frame: keep the software renderer cheap.
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
    await h.eval((g) => {
      g.debug.enemies?.camps(false);
      g.debug.enemies?.clear();
    });
    await h.step(10);
    const s = await h.state();
    near(s.player.x, 1465.8, 0.6, 'spawn x');
    near(s.player.z, 1162.4, 0.6, 'spawn z');
    near(s.player.y, floorY(1), 0.25, 'spawn on the ledge paving');
    assert.ok(s.player.grounded, 'grounded at spawn');
    assert.equal(s.region, 'southern_air_temple');
    const regs = await h.eval((g) => g.debug.air.regions().map((r) => r.id));
    for (const id of ['air_temple_summit', 'air_temple_trail']) assert.ok(regs.includes(id), `region ${id} built: ${regs}`);
  });

  await check('spots: masters, training grounds, givers, habitats, shrines, updrafts, viewpoints', async () => {
    const spots = await h.eval((g) => g.debug.air.spots());
    for (const id of ['master_tenzo', 'master_iio', 'master_pasang', 'master_hermit', 'giver_air_elder', 'merchant_air_temple_1', 'habitat_bison_stable', 'habitat_sky_bison_1', 'shrine_wind', 'shrine_air_sanctum', 'shrine_air_bell', 'shrine_air_pavilion', 'viewpoint_air_sanctum', 'viewpoint_air_meditation_1', 'glide_launch_east', 'updraft_1', 'viewpoint_air_trail_1', 'bridge_air_gorge']) {
      assert.ok(spots[id], `spot ${id} missing`);
    }
    const n = Object.keys(spots).filter((k) => k.startsWith('updraft_')).length;
    assert.ok(n >= 5, `updraft spots: ${n}`);
  });

  await check('training fields: the ground each master leads a lesson onto is flat and open', async () => {
    // The training system (src/training/TrainingSystem.ts) clamps the radius to 8–14 m, starts the
    // player r·0.55 behind the centre (on the master's side) and lays the course out up to ~15 m
    // ahead and ~6 m to either side.
    const r = await h.eval((g) => {
      const V = g.ctx.player.root.position.constructor;
      const spots = g.debug.air.spots();
      const col = g.ctx.world.collision;
      const out = {};
      for (const m of ['tenzo', 'iio', 'pasang', 'hermit']) {
        const ms = spots['master_' + m], ts = spots['training_' + m];
        const L = Math.hypot(ts.x - ms.x, ts.z - ms.z);
        const fx = (ts.x - ms.x) / L, fz = (ts.z - ms.z) / L;
        const r = Math.max(8, Math.min(14, ts.r));
        const sx = ts.x - fx * r * 0.55, sz = ts.z - fz * r * 0.55;
        let bad = 0, n = 0;
        const what = [];
        for (let a = 0; a <= 14; a++) {
          for (let s = -6; s <= 6; s++) {
            const x = sx + fx * a - fz * s, z = sz + fz * a + fx * s;
            const gr = col.groundAt(x, z, ts.y + 2.5);
            const gy = gr ? gr.y : -1e9;
            n++;
            if (Math.abs(gy - ts.y) > 0.5) {
              bad++;
              what.push(`step@${a},${s}`);
              continue;
            }
            const c = col.overlapSphere(new V(x, gy + 1.0, z), 0.4);
            if (c && !c.walkable) {
              bad++;
              what.push(`${c.shape}@${a},${s}`);
            }
          }
        }
        out[m] = { bad, n, centre: col.groundAt(ts.x, ts.z, ts.y + 2.5)?.y ?? null, y: ts.y, what: what.slice(0, 8) };
      }
      return out;
    });
    for (const [m, v] of Object.entries(r)) {
      assert.ok(v.bad / v.n <= 0.05, `${m}: ${v.bad}/${v.n} cells of the field blocked or off-level: ${v.what.join(' ')}`);
      near(v.centre, v.y, 0.15, `${m}: training centre floor`);
    }
  });

  await check('walk: the switchback road from the gate plaza (L0) to the summit (L6)', async () => {
    const pts = await temple((t) => t.roadPath(5));
    assert.ok(pts.length > 100, `road samples: ${pts.length}`);
    await teleport(pts[0].x, pts[0].z, pts[0].y + 0.5);
    let off = 0;
    const log = [];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const r = await walkTo(p.x, p.z, { tol: 1.6 });
      if (r.dist > 2.2 || Math.abs(r.y - p.y) > 1.6) {
        off++;
        log.push(`#${i} want (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) got (${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.z.toFixed(1)})`);
        if (off > 3) break;
        await teleport(p.x, p.z, p.y + 0.5);
      }
    }
    assert.equal(off, 0, `left the road or stuck: ${log.join('; ')}`);
    const end = (await h.state()).player;
    near(end.y, floorY(6), 0.3, 'standing on the summit');
  });

  await check('walk: the trail tops out through its stair trench onto the gate plaza (L0)', async () => {
    const t = await h.eval((g) => ({ length: g.debug.air.trail.length }));
    const a = await h.eval((g, s) => g.debug.air.trail.at(s), t.length - 36);
    await teleport(a.x, a.z, a.y + 0.5);
    const pts = [];
    for (const s of [t.length - 26, t.length - 16, t.length - 8, t.length]) {
      const p = await h.eval((g, s) => g.debug.air.trail.at(s), s);
      pts.push([p.x, p.z]);
    }
    let r = await walkPath(pts, { tol: 1.4 });
    // Through the temple gate (astride the trench) onto the plaza.
    r = await walkPath([pol(204.5, 84.5), pol(204.5, 80), pol(204.5, 76)], { tol: 1.3 });
    near(r.y, floorY(0), 0.3, 'on the gate plaza');
    assert.ok(r.grounded, 'grounded on the plaza');
  });

  await check('trail: switchback stairs climb past every turn', async () => {
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
  });

  await check('trail: gorge stair-bridge from the trailhead down to the foot of the switchbacks', async () => {
    await h.eval((g) => g.teleportTo('air_trailhead'));
    await h.step(5);
    const tr = await h.eval((g) => g.debug.air.trail && { top: g.debug.air.trail.bridgeTop, foot: g.debug.air.trail.at(0) });
    assert.ok(tr, 'trail debug hook');
    let r = await walkPath([[tr.top.x, tr.top.z]], { tol: 1.0 });
    const y0 = r.y;
    const pts = [0.3, 0.65, 1].map((t) => [tr.top.x + (tr.foot.x - tr.top.x) * t, tr.top.z + (tr.foot.z - tr.top.z) * t]);
    r = await walkPath(pts, { tol: 1.5, sprint: true });
    assert.ok(r.minY > tr.foot.y - 1.5, `fell off the bridge (minY ${r.minY})`);
    near(r.y, tr.foot.y, 0.6, 'arrived at the foot of the switchbacks');
    assert.ok(y0 - r.y > 20, `descended the bridge (${y0} → ${r.y})`);
  });

  await check('trail: resting landings are flat and walkable', async () => {
    const ls = await h.eval((g) => g.debug.air.trail.landings);
    for (const l of ls) {
      const g0 = await ground(l.x, l.z);
      const g1 = await ground(l.x + 2, l.z + 2);
      near(g0, g1, 0.05, 'landing flat');
    }
  });

  await check('sanctuary: the shut door blocks; an air blast opens it; down to the statues and back', async () => {
    const at = (u, v) => {
      const a = (258 * Math.PI) / 180;
      return [C.x + Math.cos(a) * v + Math.sin(a) * u, C.z + Math.sin(a) * v - Math.cos(a) * u];
    };
    let st = await temple((t) => t.sanctuary.state);
    assert.equal(st.open, 0, 'a new game starts with the sanctuary shut');
    await teleport(...pol(258, 40), floorY(4) + 0.5);
    const shut = await walkTo(...at(0, 24), { max: 300 });
    assert.ok(shut.dist > 3, `walked through the shut door: ${JSON.stringify(shut)}`);
    await teleport(...pol(258, 35.5), floorY(4) + 0.5);
    const door = await temple((t) => t.sanctuary.door);
    await h.eval((g, d) => g.faceTowards(d.x, d.z), door);
    await h.eval((g) => g.setElement('air'));
    const cast = await h.eval((g) => {
      for (const id of ['air_palm', 'air_blast', 'air_gust', 'air_push']) {
        const r = g.cast(id);
        if (r && r.ok) return id;
      }
      return null;
    });
    assert.ok(cast, 'cast an airbending technique at the door');
    await h.step(240);
    st = await temple((t) => t.sanctuary.state);
    assert.equal(st.open, 1, `the door opened for airbending: ${JSON.stringify(st)}`);
    assert.ok(await h.eval((g) => g.ctx.quests.hasFlag('air_sanctuary_open')), 'opening is remembered (flag)');
    const route = [at(0, 27), at(0, 23), at(0, 21.4), at(0, 16), at(0, 13.4), at(0, 10.5), at(4.2, 7), [C.x + 1.5, C.z + 3]];
    let r = await walkPath(route, { tol: 1.2 });
    st = await temple((t) => t.sanctuary.state);
    assert.ok(st.built, 'statue chamber built on approach');
    assert.ok(st.statues >= 150, `statues: ${st.statues}`);
    near(r.y, BASE + 63.2, 0.6, 'standing on the chamber floor');
    r = await walkPath([at(4.2, 7), at(0, 10.5), at(0, 13.6), at(0, 18), at(0, 22.5), at(0, 27), pol(258, 38)], { tol: 1.2 });
    near(r.y, floorY(4), 0.3, 'back out on the labyrinth court');
    // The statues' eyes glow in the Avatar State.
    await teleport(C.x + 1.5, C.z + 3, BASE + 64);
    assert.ok(await h.eval((g) => g.ctx.avatar.activate()), 'entered the Avatar State');
    await h.step(300);
    st = await temple((t) => t.sanctuary.state);
    await h.eval((g) => g.ctx.avatar.deactivate());
    assert.ok(st.glow > 0.5, `eyes glow in the Avatar State: ${JSON.stringify(st)}`);
  });

  await check('rim: balustrades stop a runner at the terrace edges', async () => {
    // Rail points with a clear run-up (free cells of the monks' walk grid of that level), on
    // several levels; sprint through each one outward.
    const runs = await temple((t) => {
      const LY = [0, 18, 36, 52, 68, 90, 108];
      const out = [];
      const seen = new Set();
      for (const p of t.railPoints(9)) {
        const lv = LY.findIndex((y) => Math.abs(330 + y + 0.2 + 1.05 - p.y) < 0.3);
        const grid = t.monks.grids.get(lv);
        if (!grid || seen.has(lv)) continue;
        const r = Math.hypot(p.x - 1450, p.z - 1250);
        const a = (p.th * Math.PI) / 180;
        let ok = true;
        for (let d = 7; d >= 1.2 && ok; d -= 0.5) ok = grid.isFree(1450 + Math.cos(a) * (r - d), 1250 + Math.sin(a) * (r - d));
        if (!ok) continue;
        seen.add(lv);
        out.push({ lv, th: p.th, r });
      }
      return out;
    });
    assert.ok(runs.length >= 4, `rail points with a clear run-up on ${runs.length} levels`);
    for (const { lv, th, r } of runs) {
      await teleport(...pol(th, r - 7), floorY(lv) + 0.5);
      const res = await walkTo(...pol(th, r + 30), { max: 300, tol: 0.5, sprint: true });
      const rr = Math.hypot(res.x - C.x, res.z - C.z);
      assert.ok(res.minY > floorY(lv) - 0.5, `L${lv} θ${th.toFixed(0)}: went over the edge (minY ${res.minY.toFixed(2)})`);
      assert.ok(rr > r - 2.5 && rr < r + 0.6, `L${lv} θ${th.toFixed(0)}: stopped at r ${rr.toFixed(1)}, rail at ${r.toFixed(1)}`);
    }
  });

  await check('water: fountain, ponds, springs, falls and troughs are real sources', async () => {
    const ids = await h.eval((g) => g.debug.air.regions().flatMap((r) => r.water));
    for (const id of ['air:sat_entrance_fountain', 'air:sat_bison_pond', 'air:sat_koi_1', 'air:sat_koi_2', 'air:sat_quarters_spring', 'air:sat_quarters_falls', 'air:sat_hall_spring', 'air:sat_hall_falls', 'air:sat_orchard_pool']) assert.ok(ids.includes(id), `water ${id} registered`);
    assert.ok(ids.filter((id) => /trough/.test(id)).length >= 2, 'bison troughs registered');
    await teleport(...pol(196, 47), floorY(4) + 0.5);
    let w = await h.eval((g) => g.waterNearby(15));
    assert.ok(w.some((s) => s.id === 'air:sat_entrance_fountain'), 'fountain in the entrance court: ' + JSON.stringify(w));
    await h.eval((g) => g.setElement('water'));
    const drawn = await h.eval((g) => g.drawWater(20));
    assert.ok(drawn && drawn.reserve > 0, 'drew water from the fountain: ' + JSON.stringify(drawn));
    await h.eval((g) => g.setElement('air'));
    w = await h.eval((g) => g.waterNearby(400));
    assert.ok(!w.some((s) => /sat_rim_falls|sat_spire_falls/.test(s.id)), 'unreachable falls are not offered as sources');
  });

  await check('life: monks, sky bison and lemurs at work; a whistle brings a temple bison down', async () => {
    await h.eval((g) => g.setTime(10.5));
    await teleport(...pol(196, 50), floorY(4) + 0.5);
    await h.eval((g) => {
      const R = g.ctx.render, render = R.render;
      R.render = () => {};
      try {
        g.step(600);
      } finally {
        R.render = render;
      }
    });
    await h.step(4);
    const s = await temple((t) => ({ monks: { ...t.monks.stats }, herd: t.herd.state, lemurs: t.lemurs.count, perched: t.lemurs.perched }));
    console.log('  life: ' + JSON.stringify(s));
    assert.ok(s.monks.total >= LIFE.monks, `monks simulated: ${s.monks.total}`);
    assert.ok(s.monks.visible >= 15, `monks visible round the entrance court: ${s.monks.visible}`);
    assert.ok(s.monks.walking + s.monks.acting > 0, 'monks busy');
    assert.ok(s.herd.total >= LIFE.bison, `sky bison: ${s.herd.total}`);
    assert.ok(s.herd.flying > 0 && s.herd.grounded > 0, `bison flying and grounded: ${JSON.stringify(s.herd)}`);
    assert.ok(s.lemurs >= LIFE.lemurs, `lemurs: ${s.lemurs}`);
    // Whistle on the main landing ledge.
    await teleport(1465.8, 1162.4, floorY(1) + 0.5);
    const called = await h.eval((g) => {
      const w = g.ctx.interactions.get('air_whistle_0');
      if (!w) return false;
      w.interact();
      return true;
    });
    assert.ok(called, 'whistle interaction registered');
    const waited = await h.eval((g) => {
      const t = g.debug.air.region('air_temple_summit');
      const R = g.ctx.render, render = R.render;
      R.render = () => {};
      try {
        for (let i = 0; i < 60; i++) {
          if (t.herd.waitingAt(0)) return i * 60;
          g.step(60);
        }
        return -1;
      } finally {
        R.render = render;
      }
    });
    assert.ok(waited >= 0, 'a temple bison landed at the ledge within a minute');
    const ride = await h.eval((g) => g.ctx.interactions.get('air_bison_ride_0')?.enabled?.() ?? false);
    assert.ok(ride, 'the ride interaction is offered beside the waiting bison');
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
    // Two restarts at the same place: the first may upload geometry never drawn before; a leak
    // keeps growing on the second.
    await h.newGame('air');
    await h.step(10);
    const before = await mem();
    await h.newGame('air');
    await h.step(10);
    const after = await mem();
    assert.equal(after.regions, before.regions, 'region count stable');
    assert.ok(after.geo <= before.geo + 8, `geometries grew ${before.geo} -> ${after.geo}`);
    assert.ok(after.tex <= before.tex + 2, `textures grew ${before.tex} -> ${after.tex}`);
    const ok = await h.eval((g) => ['air_great_bell', 'air_gong', 'air_prayer_wheels', 'air_whistle_0', 'air_whistle_1', 'air_meditate_1'].filter((id) => !g.ctx.interactions.get(id)));
    assert.deepEqual(ok, [], 'interactions registered after restart');
    await h.eval((g) => g.ctx.interactions.get('air_great_bell').interact());
    await h.eval((g) => g.setting('graphics.renderScale', 0.35));
  });

  await check('perf: draw calls / triangles at the landing ledge and from the air', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    await teleport(1465.8, 1162.4, floorY(1) + 0.5);
    await h.eval((g) => g.faceTowards(1450, 1250));
    await h.step(20);
    await h.wait(1500);
    const a = (await h.state()).render;
    const [cx, cz] = pol(215, 330);
    await h.eval((g, cx, cz) => g.freeCamera({ x: cx, y: 430, z: cz }, { x: 1450, y: 380, z: 1250 }), cx, cz);
    await h.step(5);
    await h.wait(1500);
    const b = (await h.state()).render;
    await h.eval((g) => g.freeCamera(null));
    const regs = await h.eval((g) => g.debug.air.regions().map((r) => ({ id: r.id, buildMs: r.buildMs, finishMs: r.finishMs, maxFinishStepMs: r.maxFinishStepMs, colliders: r.colliders, tris: r.triangles })));
    console.log(`  [${preset}] ledge view: calls=${a.drawCalls} tris=${a.triangles} fps=${a.fps?.toFixed?.(1)}`);
    console.log(`  [${preset}] aerial view: calls=${b.drawCalls} tris=${b.triangles} fps=${b.fps?.toFixed?.(1)}`);
    console.log('  regions: ' + JSON.stringify(regs));
    assert.ok(a.drawCalls < 700, `ledge draw calls ${a.drawCalls}`);
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
