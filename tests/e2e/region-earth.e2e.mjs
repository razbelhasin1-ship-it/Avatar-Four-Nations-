/**
 * Earth Kingdom regions E2E: Ba Sing Se (Earth start), Gaoling, Riverbend.
 *  - walks key routes: spawn → Lower Ring Square → Middle Ring stairs →
 *    avenue → Middle Ring landmark → Upper Ring stairs → palace grand stairs →
 *    palace terrace; avenue → dojo street → Stone Fist Dojo floor; square →
 *    Inner Wall west gate → Agrarian avenue → Outer Wall gate → outside;
 *    Outer Wall stairs → wall walkway; Gaoling gate → arena ring; Riverbend
 *    footbridge across the gorge, boardwalk → dock, ramp → mill platform
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

  await check('earth start: spawn is clear, flat and grounded in the Lower Ring Square', async () => {
    const st = await h.state();
    assert.equal(st.region, 'ba_sing_se');
    near(st.player.x, 640, 0.5, 'spawn x');
    near(st.player.z, -30, 0.5, 'spawn z');
    near(st.player.y, 26, 0.15, 'spawn on the square');
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4], [12, -8]]) near(await ground(640 + dx, -30 + dz, 40), 26, 0.06, `spawn surroundings flat (${dx},${dz})`);
    const regs = await h.eval((g) => g.debug.earth.regions());
    const bss = regs.find((r) => r.id === 'ba_sing_se');
    assert.ok(bss && !bss.building, `Ba Sing Se built: ${JSON.stringify(regs)}`);
    const m = (await info('ba_sing_se')).marks;
    assert.ok(m.lowerHouses.x >= 200, `Lower Ring houses ${m.lowerHouses.x}`);
    assert.ok(m.middleHouses.x >= 60, `Middle Ring houses ${m.middleHouses.x}`);
    console.log(`  houses: lower=${m.lowerHouses.x} middle=${m.middleHouses.x} upper=${m.upperHouses.x} farms=${m.fields.y} fields=${m.fields.x}; stats ${JSON.stringify(bss)}`);
  });

  await check('spots: masters, training floors, givers, merchants, docks, shrines, viewpoints', async () => {
    const spots = await h.eval((g) => g.debug.earth.spots());
    const need = ['giver_bss_elder', 'master_lien', 'training_lien', 'merchant_bss_1', 'merchant_bss_2', 'merchant_bss_3', 'merchant_bss_4', 'dock_laogai', 'shrine_bss_earth_king', 'viewpoint_bss_palace', 'viewpoint_bss_outer_wall', 'master_lin', 'training_lin', 'giver_gaoling_lord', 'merchant_gaoling_1', 'dock_riverbend', 'bridge_riverbend', 'giver_riverbend_elder', 'merchant_riverbend_1'];
    for (const id of need) assert.ok(spots[id], `spot ${id} defined`);
    for (const id of ['training_lien', 'training_lin']) assert.ok(spots[id].r >= 12, `${id} radius ${spots[id].r}`);
    near(spots.giver_bss_elder.x, 652, 1, 'elder spot x');
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

  await check('water sources: square fountain, garden ponds, upper fountains', async () => {
    await tp(644, -60);
    let w = await h.eval((g) => g.waterNearby(15));
    assert.ok(w.some((s) => s.id === 'bss_square_fountain'), `fountain: ${JSON.stringify(w)}`);
    await tp(772, 18, 31);
    w = await h.eval((g) => g.waterNearby(20));
    assert.ok(w.some((s) => s.id === 'bss_middle_garden_pond'), `garden pond: ${JSON.stringify(w)}`);
    await tp(797, -50, 37);
    w = await h.eval((g) => g.waterNearby(25));
    assert.ok(w.some((s) => s.id.startsWith('bss_upper_fountain')), `upper fountains: ${JSON.stringify(w)}`);
    await tp(1000, 168);
    w = await h.eval((g) => g.waterNearby(40));
    assert.ok(w.some((s) => s.type === 'lake' || s.id.includes('laogai')), `Lake Laogai: ${JSON.stringify(w)}`);
  });

  await check('route: spawn → Middle Ring stairs → avenue → landmark → Upper Ring → palace terrace', async () => {
    await tp(640, -30, 26);
    let r = await walkPath([[652, -48], [660, -50]], { minY: 25.5 });
    near(r.y, 26, 0.2, 'square level');
    r = await walkPath([[684, -50]], { minY: 25.5 });
    near(r.y, 31, 0.2, 'on the Middle Ring terrace');
    r = await walkPath([[760, -50]], { minY: 30.5 });
    near(r.y, 31, 0.2, 'Middle Ring landmark');
    r = await walkPath([[766, -50], [790, -50]], { minY: 30.5 });
    near(r.y, 37, 0.2, 'on the Upper Ring terrace');
    r = await walkPath([[808, -50], [820, -50]], { minY: 36.5 });
    near(r.y, 43, 0.3, 'palace tier 1');
    r = await walkPath([[832, -50], [846, -50], [850, -50]], { minY: 36.5 });
    near(r.y, 55, 0.3, 'palace terrace (bss_upper_ring)');
  });

  await check('route: avenue → dojo street → Stone Fist Dojo sparring floor', async () => {
    await tp(704, -50, 31);
    const r = await walkPath([[704, -30], [704, 10], [704, 26], [704, 36]], { minY: 30.5 });
    near(r.y, 31, 0.15, 'dojo floor');
  });

  await check('route: square → Inner Wall gate → Agrarian avenue → Outer Wall gate → outside', async () => {
    await tp(640, -80, 26);
    const ig = (await info('ba_sing_se')).walls.gates.filter((g) => g.ring === 'inner' && g.id === 'west')[0];
    const og = (await info('ba_sing_se')).walls.gates.filter((g) => g.ring === 'outer' && g.id === 'west')[0];
    let r = await walkPath([[ig.inX, ig.inZ], [ig.outX, ig.outZ]], { minY: 25.5, tol: 1.5 });
    near(r.y, 26, 0.3, 'through the Inner Wall gate');
    r = await walkPath([[600, -100], [og.inX, og.inZ], [og.outX, og.outZ]], { minY: 25.5, tol: 1.5, sprint: true });
    r = await walkPath([[430, -110]], { minY: 20, tol: 1.5, sprint: true });
    assert.ok(r.grounded, 'grounded at the Outer Wall Gate landmark');
  });

  await check('route: Outer Wall stairs → walkway (34 m up)', async () => {
    const st = (await info('ba_sing_se')).walls.stairs.find((s) => s.id.startsWith('outer_west'));
    assert.ok(st, 'west wall stairs recorded');
    await tp(st.bottom.x, st.bottom.z, 26);
    let r = await walkPath([[st.top.x, st.top.z], [st.landing.x, st.landing.z]], { minY: 25.5, tol: 1.0 });
    near(r.y, st.topY, 0.3, 'stair landing');
    r = await walkPath([[st.walkTop.x, st.walkTop.z]], { minY: st.topY - 0.6, tol: 1.2 });
    near(r.y, st.topY, 0.3, 'on the wall walkway');
  });

  await check('monorail: Lower Ring booth → Outer Wall station and back', async () => {
    const b = await h.eval((g) => {
      const i = g.ctx.interactions.get('bss_monorail_lower_west');
      return i ? { x: i.position.x, z: i.position.z, label: i.label } : null;
    });
    assert.ok(b, 'boarding booth interactable registered');
    await tp(b.x, b.z, 26);
    await h.eval((g) => g.ctx.interactions.get('bss_monorail_lower_west').interact(g.ctx));
    let p = (await h.step(6)).player;
    near(p.y, 60, 0.5, 'arrived on the Outer Wall station');
    assert.ok(p.grounded, 'standing on the wall walkway');
    await h.eval((g) => g.ctx.interactions.get('bss_monorail_outer_west').interact(g.ctx));
    p = (await h.step(6)).player;
    near(p.y, 26, 0.3, 'back down in the Lower Ring');
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

  await check('perf: draw calls / triangles / fps (Lower Ring, aerial, outside the walls)', async () => {
    await h.eval((g) => g.setting('graphics.renderScale', 1));
    const views = [
      ['lower ring', (g) => { g.freeCamera(null); g.teleport(640, -30, 26); g.faceTowards(700, -60); }],
      ['market', (g) => { g.teleport(660, -116, 26); g.faceTowards(690, -170); }],
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
          return r && !r.building ? { houses: r.marks.lowerHouses.x, booth: !!g.ctx.interactions.get('bss_monorail_lower_west'), npc: !!g.ctx.npcs.getDef('bss_amb_gate_guard_1') } : null;
        });
      }
      assert.ok(done, 'deferred build finished');
      assert.ok(done.houses > 150 && done.booth && done.npc, `built and registered: ${JSON.stringify(done)}`);
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
