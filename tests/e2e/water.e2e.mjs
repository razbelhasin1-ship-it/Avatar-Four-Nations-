/**
 * Waterbending E2E (brief section 10H): environmental water sources, Draw Water,
 * source-dependent techniques, finite sources, visual/hitbox sync, persistence.
 *
 * Run: node tests/e2e/water.e2e.mjs        (W=960 H=540 to run at a larger size)
 *
 * Scenarios
 *   1. Beside a river the player gathers water (reserve rises, water:drawn, source id river:*).
 *   2. A water whip drawn from the river succeeds; its stream/hitbox start at the river surface.
 *   3. An attack beside the ocean works with source 'ocean'.
 *   4. A frozen source (Moonlit Frozen Lake) works for ice techniques, and liquid ones melt it into water.
 *   5. Far from water with an empty reserve: refused with reason 'water' + water:unavailable,
 *      before any windup and without consuming anything.
 *   6. A small finite source (test fountain) depletes, refuses after exhaustion, then regenerates.
 *   7. Visuals and hit detection stay synchronized (dummy on the whip path is hit on the frame the
 *      drawn whip reaches it; a dummy beyond the visible reach is never hit).
 *   8. After travelling to another region and a save/load round-trip, waterbending still works.
 *   9. Held-water rule (the player): beside a river with empty hands a water attack does not bend the
 *      river from a distance — it gathers water into the hands (reason 'gather', water:drawn); the next
 *      press bends the held water, which also works after walking away from the river until it runs out.
 * Scenarios 1–8 exercise the source mechanics through the direct-draw path that NPC and enemy benders use
 * (heldWaterOnly off); scenario 9 switches the player's held-water rule back on.
 * Extras: shield blocks a projectile, ice wall is a solid walkable collider registered as an ice
 * source, water skin works anywhere and refills, moisture is generous in the swamp and poor in the desert.
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const W = Number(process.env.W || 480);
const H = Number(process.env.H || 270);
const h = await launch({ width: W, height: H });
const results = [];
const t0 = Date.now();
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // e.g. ONLY=1,8,extra
const check = async (name, fn) => {
  if (ONLY && !ONLY.some((p) => name.startsWith(p))) return;
  const t = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};

const RIVER = { x: -336, z: -1505 }; // Glacier Melt Stream (NWT)
// NWT north coast, west of the jetties: the old spot (x -230) now sits at the mouth of the Grand Canal,
// whose water (source 'canal') is nearer than the open sea.
const OCEAN = { x: -300, z: -1890, seaZ: -1925 };
const FROZEN = { x: 330, z: -1330 }; // Moonlit Frozen Lake
const DESERT = { x: 250, z: 950 }; // Si Wong, far from any water
const GREAT_RIVER = { x: 200, z: -250 };
const SWAMP = { x: -1150, z: -140 };

/** Remove dummies, teleport, face a point, empty the reserve. */
async function prep(at, face, reserve = 0) {
  await h.eval((g) => {
    for (const e of [...g.ctx.entities.all()]) if (e.kind === 'target') g.ctx.entities.remove(e);
  });
  await h.eval((g, at) => g.teleport(at.x, at.z), at);
  if (face) await h.eval((g, f) => g.faceTowards(f.x, f.z), face);
  await h.eval((g, r) => g.debug.water.setReserve(r), reserve);
  await h.step(3);
}
const events = () => h.eval(() => window.__wev.splice(0));
/** A flat, dry spot on the Great River's bank with the river within reach (and the river point). */
let bankCache = null;
async function greatRiverBank() {
  if (bankCache) return bankCache;
  bankCache = await h.eval((g, c) => {
    const V = g.ctx.player.position.constructor;
    const w = g.ctx.world;
    for (const r of [6, 9, 12, 15, 18, 22]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        let wet = false;
        for (const [ox, oz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (w.waterAt(x + ox, z + oz)) wet = true;
        if (wet) continue;
        const gy = w.groundAt(x, z).y;
        if (Math.abs(w.groundAt(x + 1.5, z).y - gy) > 0.8 || Math.abs(w.groundAt(x, z + 1.5).y - gy) > 0.8) continue;
        const hit = g.ctx.water.findAll(new V(x, gy, z), 9, {}).find((hh) => hh.id === 'river:great_river');
        if (hit) return { x, z, wx: hit.point.x, wz: hit.point.z };
      }
    }
    return null;
  }, GREAT_RIVER);
  return bankCache;
}
/** Step until the player has no technique in windup/channel (bounded). */
async function idle(max = 120) {
  for (let i = 0; i < max && (await h.eval((g) => g.ctx.combat.isBusy(g.ctx.player))); i += 6) await h.step(6);
}
const reserve = () => h.eval((g) => g.debug.water.reserve());

try {
  await h.newGame('water');
  await h.eval((g) => {
    g.game.stop(); // deterministic: only h.step() advances the simulation from here on
    g.learnAll();
    window.__hits = [];
    g.ctx.events.on('hit', (e) => window.__hits.push({ frame: g.ctx.time.frame, targetId: e.targetId, techniqueId: e.techniqueId ?? null, damage: e.damage }));
    // Scenarios 1-8: direct-draw path (NPC/enemy benders); scenario 9 restores the player's held-water rule.
    g.ctx.water.heldWaterOnly = false;
    window.__wev = [];
    for (const k of ['water:drawn', 'water:unavailable', 'water:reserve', 'technique:failed', 'technique:cast', 'ui:notify'])
      g.ctx.events.on(k, (p) => window.__wev.push([k, JSON.parse(JSON.stringify(p))]));
  });

  await check('1. river: Draw Water gathers into the reserve (water:drawn, river:*)', async () => {
    await prep(RIVER, null, 0);
    const near = await h.eval((g) => g.debug.water.sources(16));
    assert.ok(near.some((n) => n.id.startsWith('river:')), 'no river nearby: ' + JSON.stringify(near));
    await events();
    await h.eval((g) => g.debug.water.startDraw());
    await h.step(15);
    const st = await h.eval((g) => g.debug.water.drawStatus());
    assert.equal(st.drawing, true, 'not drawing: ' + JSON.stringify(st));
    assert.equal(st.mode, 'source', JSON.stringify(st));
    assert.ok(st.sourceId && st.sourceId.startsWith('river:'), 'draw source: ' + JSON.stringify(st));
    await h.step(15);
    await h.eval((g) => g.debug.water.stopDraw());
    await h.step(2);
    const r = await reserve();
    assert.ok(r > 10, 'reserve did not rise: ' + r);
    const ev = await events();
    const drawn = ev.filter(([k]) => k === 'water:drawn');
    assert.ok(drawn.length > 0, 'no water:drawn event');
    assert.ok(drawn.every(([, p]) => p.sourceId.startsWith('river:') && p.amount > 0), JSON.stringify(drawn.slice(0, 3)));
    const vis = await h.eval((g) => g.debug.water.reserveVisual());
    assert.ok(vis.tracked && vis.visible, 'reserve orbit not visible: ' + JSON.stringify(vis));
    // Hidden again at zero.
    await h.eval((g) => g.debug.water.setReserve(0));
    await h.step(24);
    const vis0 = await h.eval((g) => g.debug.water.reserveVisual());
    assert.equal(vis0.visible, false, 'reserve orbit should hide at 0: ' + JSON.stringify(vis0));
  });

  await check('2. river: water whip draws from the river; stream and hitbox start there', async () => {
    await prep(RIVER, null, 0);
    const d = await h.eval((g) => g.spawnDummy(6, 0, 400));
    await h.eval((g, d) => g.faceTowards(d.x, d.z), d);
    await h.step(1);
    await h.eval((g) => g.debug.water.trace(true));
    const r = await h.eval((g, d) => g.cast('water_whip', { x: d.x, y: d.y + 1.2, z: d.z }), d);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.water.source, 'river', JSON.stringify(r));
    const log = await h.eval((g) => g.debug.water.castLog().slice(-1)[0]);
    assert.ok(log.sourceId.startsWith('river:'), JSON.stringify(log));
    const from = r.water.from;
    assert.deepEqual(log.streamStart.map((v) => +v.toFixed(2)), from.map((v) => +v.toFixed(2)), 'visual stream does not start at the source point');
    // The source point is on the river's surface.
    const surf = await h.eval((g, f) => {
      const hits = g.ctx.water.findAll(new g.ctx.player.position.constructor(f[0], f[1] + 1, f[2]), 3, {});
      return hits.filter((x) => x.id.startsWith('river:')).map((x) => ({ d: x.distance, y: x.point.y }));
    }, from);
    assert.ok(surf.length && Math.abs(surf[0].y - from[1]) < 0.05 && surf[0].d < 1.2, 'source point not on the river surface: ' + JSON.stringify(surf));
    await h.step(2);
    const tr = await h.eval((g) => g.debug.water.traceLog());
    const first = tr.flatMap((f) => f.effects).find((e) => e.kind === 'whip');
    assert.ok(first, 'no whip trace');
    const dist = Math.hypot(first.start[0] - from[0], first.start[1] - from[1], first.start[2] - from[2]);
    assert.ok(dist < 0.01, 'whip visual origin is not the river point');
    assert.ok(first.feedStart && Math.hypot(first.feedStart[0] - from[0], first.feedStart[2] - from[2]) < 0.6, 'feed stream does not rise from the river: ' + JSON.stringify(first.feedStart));
    await h.step(16);
    await h.eval((g) => g.debug.water.trace(false));
    const info = await h.eval((g, id) => g.entityInfo(id), d.id);
    assert.ok(info.totalDamage > 0, 'whip did not hit the dummy');
  });

  await check("3. ocean: an attack beside the sea uses source 'ocean'", async () => {
    await prep(OCEAN, { x: OCEAN.x, z: OCEAN.seaZ }, 0);
    const near = await h.eval((g) => g.debug.water.sources(16));
    assert.ok(near.some((n) => n.id === 'ocean'), 'no ocean nearby: ' + JSON.stringify(near));
    const r = await h.eval((g, s) => g.cast('water_whip', { x: s.x, y: 1.5, z: s.seaZ }), OCEAN);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.water.source, 'ocean', JSON.stringify(r));
    await h.step(20);
    // Heavy attack from the sea too.
    await h.eval((g) => g.debug.water.setReserve(0));
    const b = await h.eval((g, s) => g.cast('water_blast', { x: s.x, y: 1.5, z: s.seaZ }, 0.5), OCEAN);
    assert.ok(b.ok && b.water.source === 'ocean', JSON.stringify(b));
    await h.step(30);
  });

  await check('4. frozen lake: ice techniques carve the ice; liquid techniques melt it into water', async () => {
    await prep(FROZEN, { x: FROZEN.x + 10, z: FROZEN.z }, 0);
    const near = await h.eval((g) => g.debug.water.sources(16));
    assert.ok(near.some((n) => n.id === 'lake:frozen_lake' && n.frozen), JSON.stringify(near));
    await events();
    // A liquid technique melts the lake's ice into water (drawn straight from it here: held-water rule off).
    const whip = await h.eval((g) => g.cast('water_whip', null));
    assert.ok(whip.ok, 'the whip melts the frozen lake: ' + JSON.stringify(whip));
    const melted = await h.eval((g) => g.debug.water.castLog().slice(-1)[0]);
    // The lake's ice or the snow on its shore: either melts into water for the whip.
    assert.ok(['lake:frozen_lake', 'snowfield'].includes(melted.sourceId), JSON.stringify(melted));
    assert.equal(melted.frozen, false, 'melted into water: ' + JSON.stringify(melted));
    await h.step(25);
    await h.eval((g) => g.debug.water.setReserve(0));
    const shards = await h.eval((g, f) => g.cast('ice_shards', { x: f.x + 12, y: 30, z: f.z }), FROZEN);
    assert.ok(shards.ok, JSON.stringify(shards));
    const log = await h.eval((g) => g.debug.water.castLog().slice(-1)[0]);
    assert.equal(log.sourceId, 'lake:frozen_lake', JSON.stringify(log));
    assert.equal(log.frozen, true, JSON.stringify(log));
    await h.step(20);
    await h.eval((g) => g.debug.water.setReserve(0));
    const wall = await h.eval((g, f) => g.cast('ice_wall', { x: f.x + 6, y: 30, z: f.z }), FROZEN);
    assert.ok(wall.ok && wall.water.source === 'lake', JSON.stringify(wall));
    await h.step(25);
  });

  await check("5. desert, empty reserve: refused with reason 'water' before any windup", async () => {
    await prep(DESERT, null, 0);
    await h.eval((g) => g.debug.water.equipFlask(false));
    await h.step(2);
    const near = await h.eval((g) => g.debug.water.sources(30));
    assert.equal(near.length, 0, 'unexpected water in the desert: ' + JSON.stringify(near));
    await events();
    const before = await h.eval((g) => ({ fx: g.debug.water.stats().effects, tubes: g.debug.water.stats().tubesActive }));
    await h.eval((g) => (g.ctx.player.health.hp = g.ctx.player.health.maxHp * 0.6)); // wounded: Healing Waters is wanted
    for (const id of ['water_whip', 'water_blast', 'water_shield', 'ice_spikes', 'water_jet', 'water_heal']) {
      const r = await h.eval((g, id) => g.cast(id, null), id);
      assert.equal(r.ok, false, id + ' should fail');
      assert.equal(r.reason, 'water', id + ': ' + JSON.stringify(r));
    }
    const sp = await h.eval((g) => g.cast('water_spout', null));
    assert.equal(sp.reason, 'water', 'spout needs a big source: ' + JSON.stringify(sp));
    const ev = await events();
    const un = ev.filter(([k]) => k === 'water:unavailable');
    assert.ok(un.length >= 6 && un[0][1].techniqueId === 'water_whip', 'missing water:unavailable: ' + JSON.stringify(un.slice(0, 2)));
    assert.equal(ev.filter(([k]) => k === 'technique:cast').length, 0, 'a technique started anyway');
    assert.equal(await reserve(), 0, 'reserve changed');
    await h.step(2);
    const after = await h.eval((g) => ({ fx: g.debug.water.stats().effects, tubes: g.debug.water.stats().tubesActive }));
    assert.ok(after.fx <= before.fx && after.tubes <= before.tubes, 'water visuals spawned for a refused cast');
    const busy = await h.eval((g) => g.ctx.combat.isBusy(g.ctx.player));
    assert.equal(busy, false, 'player stuck in a windup');
    // Clear, non-spammy feedback: one HUD toast for the repeated failure.
    const toast = await h.page.evaluate(() => document.body.innerText);
    assert.ok(/No water within reach/i.test(toast), 'no visible feedback: ' + toast.slice(0, 300));
    // Draw Water with nothing in reach: feedback, no stream.
    await events();
    await h.eval((g) => g.debug.water.startDraw());
    await h.step(10);
    const st = await h.eval((g) => g.debug.water.drawStatus());
    await h.eval((g) => g.debug.water.stopDraw());
    assert.equal(st.mode, 'none', JSON.stringify(st));
    const ev2 = await events();
    assert.equal(ev2.filter(([k, p]) => k === 'ui:notify' && /water/i.test(p.text)).length, 1, 'draw feedback should appear once: ' + JSON.stringify(ev2));
    assert.equal(await reserve(), 0);
  });

  await check('6. finite fountain: depletes, refuses when exhausted, regenerates', async () => {
    await prep(DESERT, { x: DESERT.x, z: DESERT.z + 10 }, 0);
    const src = await h.eval((g, d) => g.debug.water.register({ id: 'test:fountain', type: 'fountain', label: 'Test Fountain', x: d.x, z: d.z - 2.5, r: 1.2, capacity: 9, regen: 0.4 }), DESERT);
    assert.equal(src, 'test:fountain');
    const amount = () => h.eval((g) => g.debug.water.source('test:fountain').amount);
    const aim = { x: DESERT.x, y: 30, z: DESERT.z + 10 };
    const c1 = await h.eval((g, a) => g.cast('water_whip', a), aim);
    assert.ok(c1.ok && c1.water.source === 'fountain', JSON.stringify(c1));
    const a1 = await amount();
    assert.ok(a1 < 5.5, 'fountain did not deplete: ' + a1);
    await h.step(18);
    await h.eval((g) => g.debug.water.setReserve(0));
    const c2 = await h.eval((g, a) => g.cast('water_whip', a), aim);
    assert.ok(c2.ok && c2.water.source === 'fountain', JSON.stringify(c2));
    await h.step(18);
    await h.eval((g) => g.debug.water.setReserve(0));
    const a2 = await amount();
    assert.ok(a2 < 4, 'fountain should be nearly empty: ' + a2);
    await events();
    const c3 = await h.eval((g, a) => g.cast('water_whip', a), aim);
    assert.equal(c3.ok, false, 'should refuse when exhausted: ' + JSON.stringify(c3));
    assert.equal(c3.reason, 'water');
    const fail = await h.eval((g) => g.debug.water.lastFailure());
    assert.equal(fail.reason, 'dry', JSON.stringify(fail));
    assert.ok(Math.abs((await amount()) - a2) < 0.05, 'a failed cast consumed water');
    const desc = await h.eval((g) => g.debug.water.describe());
    assert.ok(/Test Fountain/.test(desc.label), 'HUD should report the fountain level: ' + JSON.stringify(desc));
    // Regenerate (0.4/s): ~8 s of game time.
    await h.step(40, 0.2);
    const a3 = await amount();
    assert.ok(a3 > a2 + 2.5, 'fountain did not regenerate: ' + a3);
    await h.eval((g) => g.debug.water.setReserve(0));
    const c4 = await h.eval((g, a) => g.cast('water_whip', a), aim);
    assert.ok(c4.ok && c4.water.source === 'fountain', 'should work again after refilling: ' + JSON.stringify(c4));
    await h.step(18);
    await h.eval((g) => g.debug.water.unregister('test:fountain'));
  });

  await check('7. visuals and hit detection stay synchronized (whip + jet)', async () => {
    await prep(RIVER, null, 0);
    const near = await h.eval((g) => g.spawnDummy(5, 0, 400));
    const far = await h.eval((g) => g.spawnDummy(14, 0, 400));
    await h.eval((g, d) => g.faceTowards(d.x, d.z), near);
    await h.step(35); // let the previous whip combo lapse: this is the first (right-hand) lash
    await h.eval((g) => {
      g.debug.water.trace(true);
      window.__hits.length = 0;
    });
    const r = await h.eval((g, d) => g.cast('water_whip', { x: d.x, y: d.y + 1.2, z: d.z }), near);
    assert.ok(r.ok, JSON.stringify(r));
    await h.step(20);
    // For every hit on the near dummy, the whip drawn on that exact frame must be touching it.
    const sync = await h.eval((g, ids) => {
      const e = g.ctx.entities.get(ids[0]);
      const log = g.debug.water.traceLog();
      const capsule = (s) => {
        const by = e.position.y + e.radius, ty = e.position.y + e.height - e.radius;
        const cy = Math.max(by, Math.min(ty, s[1]));
        return Math.hypot(s[0] - e.position.x, s[1] - cy, s[2] - e.position.z) - e.radius;
      };
      const hits = window.__hits.filter((x) => x.targetId === ids[0]);
      const frames = log.map((f) => ({ frame: f.frame, whip: f.effects.find((x) => x.kind === 'whip') })).filter((f) => f.whip);
      const out = hits.map((hh) => {
        const f = frames.find((x) => x.frame === hh.frame);
        if (!f) return { frame: hh.frame, missing: true };
        const dmin = Math.min(...f.whip.samples.map(capsule));
        return { frame: hh.frame, phase: f.whip.phase, attributed: f.whip.hitIds.includes(ids[0]), dmin, r: f.whip.hitRadius };
      });
      const gatherFrames = frames.filter((f) => f.whip.phase === 'gather').map((f) => f.frame);
      const firstSwing = frames.find((f) => f.whip.phase === 'swing')?.frame ?? null;
      return { out, gatherFrames, firstSwing, farHits: window.__hits.filter((x) => x.targetId === ids[1]).length, nearDmg: g.entityInfo(ids[0]).totalDamage, nearHits: g.entityInfo(ids[0]).hits };
    }, [near.id, far.id]);
    await h.eval((g) => g.debug.water.trace(false));
    assert.ok(sync.out.length >= 1, 'near dummy never hit: ' + JSON.stringify(sync));
    for (const o of sync.out) {
      assert.ok(!o.missing, 'hit on a frame with no whip drawn: ' + JSON.stringify(sync));
      assert.ok(o.attributed, 'hit not produced by the drawn whip: ' + JSON.stringify(o));
      assert.ok(o.dmin <= o.r + 1e-3, 'drawn whip not touching the dummy when it was hit: ' + JSON.stringify(o));
      assert.ok(!sync.gatherFrames.includes(o.frame) && o.frame >= sync.firstSwing, 'hit before the whip swung: ' + JSON.stringify(sync));
    }
    assert.equal(sync.out.length, 1, 'one lash must hit once: ' + JSON.stringify(sync.out));
    assert.equal(sync.farHits, 0, 'dummy beyond the visible whip reach was hit');

    // Jet: damage ticks only while the drawn beam passes through the dummy.
    await prep(RIVER, null, 0);
    const d = await h.eval((g) => g.spawnDummy(7, 0, 400));
    await h.eval((g, d) => g.faceTowards(d.x, d.z), d);
    await h.step(1);
    await h.eval((g) => g.debug.water.trace(true));
    const j = await h.eval((g, d) => g.cast('water_jet', { x: d.x, y: d.y + 1.2, z: d.z }), d);
    assert.ok(j.ok, JSON.stringify(j));
    await h.step(30);
    const jt = await h.eval((g, id) => {
      const e = g.ctx.entities.get(id);
      const frames = g.debug.water.traceLog().flatMap((f) => f.effects.filter((x) => x.kind === 'jet' && x.active && x.samples && x.samples.length).map((x) => ({ frame: f.frame, samples: x.samples, r: x.hitRadius })));
      const touching = frames.map((f) => {
        let dmin = Infinity;
        for (const s of f.samples) {
          const by = e.position.y + e.radius, ty = e.position.y + e.height - e.radius;
          const cy = Math.max(by, Math.min(ty, s[1]));
          dmin = Math.min(dmin, Math.hypot(s[0] - e.position.x, s[1] - cy, s[2] - e.position.z) - e.radius);
        }
        return dmin <= f.r + 0.6; // dummy is pushed back by the jet: allow for its motion this frame
      });
      return { ticks: frames.length, touching: touching.filter(Boolean).length, dmg: g.entityInfo(id).totalDamage };
    }, d.id);
    await h.eval((g) => g.debug.water.trace(false));
    assert.ok(jt.dmg > 0 && jt.ticks > 0, 'jet did not damage: ' + JSON.stringify(jt));
    assert.ok(jt.touching > 0, 'jet beam never reached the dummy it damaged: ' + JSON.stringify(jt));
    await h.step(30);
  });

  await check('7b. spinning lash: the third whip strike circles the bender and hits a dummy behind it once', async () => {
    await prep(RIVER, null, 60);
    const front = await h.eval((g) => g.spawnDummy(4, 0, 400));
    const back = await h.eval((g) => g.spawnDummy(-3.5, 0.6, 400));
    await h.eval((g, d) => g.faceTowards(d.x, d.z), front);
    await h.step(35); // let the previous whip combo lapse
    const aim = { x: front.x, y: front.y + 1.2, z: front.z };
    for (let i = 0; i < 2; i++) {
      const r = await h.eval((g, a) => g.cast('water_whip', a), aim);
      assert.ok(r.ok, JSON.stringify(r));
      await h.step(12);
    }
    const backBefore = await h.eval((g, id) => g.entityInfo(id).hits, back.id);
    assert.equal(backBefore, 0, 'the straight lashes must not reach behind the bender');
    await h.eval((g) => {
      g.debug.water.trace(true);
      window.__hits.length = 0;
    });
    const r3 = await h.eval((g, a) => g.cast('water_whip', a), aim);
    assert.ok(r3.ok, JSON.stringify(r3));
    await h.step(26);
    // Measured against where the dummy stood when struck (the knockback moves it afterwards).
    const res = await h.eval((g, d) => {
      const frames = g.debug.water.traceLog().map((f) => ({ frame: f.frame, whip: f.effects.find((x) => x.kind === 'whip') })).filter((f) => f.whip);
      const near = (f) => {
        if (!f) return null;
        let best = { d: Infinity, p: null };
        for (const s of f.whip.samples) {
          const dd = Math.hypot(s[0] - d.x, s[2] - d.z);
          if (dd < best.d) best = { d: dd, p: [s[0], s[2]] };
        }
        return best;
      };
      const hits = window.__hits.filter((x) => x.targetId === d.id);
      return {
        hits: hits.map((hh) => ({ frame: hh.frame, phase: frames.find((f) => f.frame === hh.frame)?.whip.phase ?? null, now: near(frames.find((f) => f.frame === hh.frame)), prev: near(frames.find((f) => f.frame === hh.frame - 1)) })),
        r: frames[0]?.whip.hitRadius ?? 0,
        er: g.ctx.entities.get(d.id).radius,
      };
    }, back);
    await h.eval((g) => g.debug.water.trace(false));
    // Let the whip snap back and return its water before the next scenario sets the reserve.
    await h.step(30);
    assert.equal(res.hits.length, 1, 'the spinning lash must hit the dummy behind exactly once: ' + JSON.stringify(res));
    const hit = res.hits[0];
    assert.equal(hit.phase, 'swing', 'hit outside the swing: ' + JSON.stringify(res));
    // The hit lands between two drawn frames: the drawn whip either touches the dummy on the hit
    // frame or swept across it since the previous frame (its nearest points straddle the dummy).
    const seg = (a, b, p) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = dx * dx + dz * dz;
      const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
      return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
    };
    const reach = res.er + res.r + 0.3;
    const swept = hit.now.d <= reach || (hit.prev && seg(hit.prev.p, hit.now.p, [back.x, back.z]) <= reach);
    assert.ok(swept, 'the drawn whip never passed the dummy when it was hit: ' + JSON.stringify(res));
  });

  await check('8. travel to another region + save/load: waterbending still works', async () => {
    await prep(GREAT_RIVER, null, 25);
    // Step onto dry ground near the bank (a save made while wading restores the last safe point).
    const spot = await greatRiverBank();
    assert.ok(spot, 'no dry bank near the Great River');
    await h.eval((g, s) => g.teleport(s.x, s.z), spot);
    await h.step(10);
    const body = await h.eval((g) => ({ grounded: g.ctx.player.body.grounded, inWater: g.ctx.player.body.inWater, region: g.state().region }));
    assert.ok(body.grounded && !body.inWater, 'not on dry ground: ' + JSON.stringify(body));
    const ok = await h.eval((g) => g.save('slot3'));
    assert.ok(ok, 'save failed');
    await h.page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
    await h.page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    const loaded = await h.eval((g) => g.loadGame('slot3'));
    assert.ok(loaded, 'load failed');
    await h.eval((g) => {
      g.game.stop();
      g.ctx.water.heldWaterOnly = false; // the fresh page starts with the player's held-water rule (scenario 9 covers it)
      window.__hits = [];
    });
    await h.page.waitForFunction(() => !!(window.__game && window.__game.debug && window.__game.debug.water), null, { timeout: 30000 });
    await h.step(5);
    await h.eval((g) => {
      window.__wev = [];
      for (const k of ['water:drawn', 'water:unavailable']) g.ctx.events.on(k, (p) => window.__wev.push([k, JSON.parse(JSON.stringify(p))]));
    });
    const r0 = await reserve();
    assert.ok(Math.abs(r0 - 25) < 0.5, 'reserve not restored: ' + r0);
    const vis = await h.eval((g) => g.debug.water.reserveVisual());
    assert.ok(vis.tracked && vis.visible, 'reserve orbit missing after load: ' + JSON.stringify(vis));
    const st = await h.state();
    assert.ok(st.progression.learned.includes('water_jet'), 'learned techniques lost');
    await h.eval((g) => g.debug.water.setReserve(0));
    const r = await h.eval((g) => g.cast('water_whip', null));
    assert.ok(r.ok && r.water.source === 'river', 'whip after load: ' + JSON.stringify(r));
    await h.step(20);
    await h.eval((g) => g.debug.water.setReserve(0));
    await h.eval((g) => g.debug.water.startDraw());
    await h.step(20);
    await h.eval((g) => g.debug.water.stopDraw());
    const ev = await events();
    assert.ok(await reserve() > 5, 'Draw Water after load did not fill the reserve');
    assert.ok(ev.some(([k, p]) => k === 'water:drawn' && p.sourceId === 'river:great_river'), JSON.stringify(ev.slice(0, 3)));
  });

  await check('extra: shield blocks a projectile; ice wall is solid, walkable and an ice source', async () => {
    await prep(RIVER, null, 40);
    const sh = await h.eval((g) => g.cast('water_shield', null));
    const act = await h.eval((g) => { const c = g.ctx.combat.activeCast(g.ctx.player); return c ? { id: c.def.id, phase: c.phase, t: c.channelTime } : null; });
    assert.ok(sh.ok, JSON.stringify(sh) + ' active: ' + JSON.stringify(act));
    await h.step(10);
    const blocked = await h.eval((g) => {
      const V = g.ctx.player.position.constructor;
      const p = g.ctx.player;
      const before = p.health.hp;
      // A hostile fire bolt flying straight at the player's chest.
      const d = g.spawnDummy(8, 0, 50);
      const dummy = g.ctx.entities.get(d.id);
      const foe = Object.create(dummy);
      foe.team = 'hostile';
      foe.isPlayer = false;
      foe.powerMultiplier = () => 1;
      const from = new V(d.x, d.y + 1.2, d.z);
      const to = p.aimPoint(new V());
      const dir = to.clone().sub(from).normalize();
      const def = { id: 'test_fire_bolt', name: 'Test Bolt', element: 'fire', kind: 'basic', tier: 1, range: 12 };
      const cast = g.ctx.combat.detachedCast(foe, def, from, dir);
      const proj = g.ctx.combat.spawnProjectile(cast, { position: from.clone().addScaledVector(dir, 0.6), velocity: dir.clone().multiplyScalar(14), radius: 0.3, life: 2, damage: 15, collideWorld: false });
      window.__testProj = proj;
      return { before };
    });
    await h.step(25);
    const res = await h.eval((g) => ({ hp: g.ctx.player.health.hp, alive: window.__testProj.alive, age: window.__testProj.age }));
    assert.ok(res.hp >= blocked.before - 0.01, 'shield did not block: ' + JSON.stringify(res) + ' before ' + blocked.before);
    assert.equal(res.alive, false, 'projectile still flying');
    assert.ok(res.age < 1.5, 'projectile expired instead of being stopped');
    await h.step(90); // the shield holds ~3 s
    // Ice wall
    await prep(DESERT, { x: DESERT.x, z: DESERT.z + 10 }, 40);
    const w = await h.eval((g, d) => g.cast('ice_wall', { x: d.x, y: 30, z: d.z + 6 }), DESERT);
    assert.ok(w.ok, JSON.stringify(w));
    await h.step(30);
    const wall = await h.eval((g) => {
      const src = g.debug.water.sources(20).filter((s) => s.type === 'ice');
      const tr = g.ctx.water;
      const fx = g.debug.water.stats();
      return { src, meltables: fx.meltables };
    });
    assert.ok(wall.src.length > 0, 'ice wall not registered as an ice source');
    // Something solid stands where the wall was raised: the ground query sees its top, and the player can stand on it.
    const top = await h.eval((g, id) => {
      const src = g.debug.water.source(id);
      const gnd = g.ctx.world.groundAt(src.x, src.z, 60);
      const terrain = g.ctx.world.heightAt(src.x, src.z);
      return { x: src.x, z: src.z, y: gnd.y, collider: gnd.colliderId, terrain };
    }, wall.src[0].id);
    assert.ok(top.collider && top.collider !== 0 && top.y > top.terrain + 2.4, 'wall has no walkable collider: ' + JSON.stringify(top));
    await h.eval((g, t) => g.teleport(t.x, t.z, t.y + 0.1), top);
    await h.step(15);
    const stand = await h.eval((g) => ({ y: g.ctx.player.position.y, grounded: g.ctx.player.body.grounded }));
    assert.ok(stand.grounded && Math.abs(stand.y - top.y) < 0.4, 'cannot stand on the ice wall: ' + JSON.stringify({ stand, top }));
    // Ice techniques can carve it (it is an ice source); liquid ones cannot.
    await h.eval((g) => g.debug.water.setReserve(0));
    await h.eval((g, t) => g.teleport(t.x + 3, t.z + 3), top);
    await h.step(5);
    const carve = await h.eval((g, t) => g.cast('ice_shards', { x: t.x + 12, y: t.y, z: t.z + 12 }), top);
    assert.ok(carve.ok && carve.water.source === 'ice', 'ice shards from the wall: ' + JSON.stringify(carve));
    await h.step(20);
  });

  await check('extra: every water technique works beside a river (hits, constructs, heal, spout ride + aerial whip)', async () => {
    const offensive = ['water_whip', 'water_blast', 'ice_shards', 'water_sweep', 'freezing_strike', 'water_jet', 'ice_spikes'];
    const failures = [];
    const b = await greatRiverBank();
    assert.ok(b, 'no dry bank near the Great River');
    const tl = Math.hypot(b.wx - b.x, b.wz - b.z) || 1;
    const along = { x: b.x - ((b.wz - b.z) / tl) * 10, z: b.z + ((b.wx - b.x) / tl) * 10 };
    for (const id of offensive) {
      await prep(b, along, 0);
      const d = await h.eval((g) => g.spawnDummy(5, 0, 400));
      await h.eval((g, d) => {
        g.faceTowards(d.x, d.z);
        g.ctx.player.lockTarget = g.ctx.entities.get(d.id);
      }, d);
      await h.step(2);
      const r = await h.eval((g, a) => g.cast(a.id, { x: a.d.x, y: a.d.y + 1.2, z: a.d.z }, 1), { id, d });
      await h.step(45);
      const info = await h.eval((g, id) => g.entityInfo(id), d.id);
      if (!r.ok || r.water.source !== 'river' || !(info.totalDamage > 0)) failures.push({ id, r, dmg: info.totalDamage });
      if (id === 'freezing_strike') {
        const frozen = await h.eval((g, id) => g.ctx.entities.get(id).hasStatus('freeze'), d.id);
        if (!frozen) failures.push({ id, frozen });
      }
      await h.eval((g) => (g.ctx.player.lockTarget = null));
      await idle();
      await h.step(10);
    }
    assert.deepEqual(failures, [], JSON.stringify(failures));
    // Healing Waters restores health over time from river water.
    await prep(GREAT_RIVER, null, 0);
    await h.eval((g) => (g.ctx.player.health.hp = g.ctx.player.health.maxHp * 0.5));
    const hp0 = await h.eval((g) => g.ctx.player.health.hp);
    const heal = await h.eval((g) => g.cast('water_heal', null));
    assert.ok(heal.ok && heal.water.source === 'river', JSON.stringify(heal));
    await h.step(100);
    const hp1 = await h.eval((g) => g.ctx.player.health.hp);
    assert.ok(hp1 > hp0 + 15, `heal: ${hp0} -> ${hp1}`);
    // Water Spout: rides a column up from the river; the bender can whip from the top.
    await prep(GREAT_RIVER, null, 0);
    const y0 = await h.eval((g) => g.ctx.player.position.y);
    const sp = await h.eval((g) => g.cast('water_spout', null));
    assert.ok(sp.ok && sp.water.source === 'river', JSON.stringify(sp));
    await h.step(36);
    const y1 = await h.eval((g) => g.ctx.player.position.y);
    assert.ok(y1 > y0 + 4.5, `spout did not lift: ${y0} -> ${y1}`);
    await h.eval((g) => g.debug.water.setReserve(0));
    const aerial = await h.eval((g) => g.cast('water_whip', null));
    assert.ok(aerial.ok && aerial.water.source === 'river', 'aerial whip from the spout: ' + JSON.stringify(aerial));
    await h.step(150);
    const y2 = await h.eval((g) => g.ctx.player.position.y);
    assert.ok(y2 < y1 - 3, `spout never ended: ${y1} -> ${y2}`);
  });

  await check('extra: water skin works anywhere, moisture is context-sensitive', async () => {
    await prep(DESERT, null, 0);
    await h.eval((g) => {
      g.debug.water.equipFlask(true);
      g.debug.water.setFlask(30);
    });
    const r = await h.eval((g) => g.cast('water_whip', null));
    assert.ok(r.ok && r.water.source === 'flask', 'flask: ' + JSON.stringify(r));
    const fl = await h.eval((g) => g.debug.water.flask());
    assert.ok(fl.amount < 30 && fl.amount > 20, JSON.stringify(fl));
    await h.step(20);
    const dry = await h.eval((g) => g.debug.water.humidity());
    await h.eval((g) => g.debug.water.equipFlask(false));
    await prep(SWAMP, null, 0);
    const wet = await h.eval((g) => g.debug.water.humidity());
    assert.ok(wet.yield.units > dry.yield.units * 4 && dry.yield.units < 3, `moisture swamp ${wet.yield.units} vs desert ${dry.yield.units}`);
  });
  await check('9. held water: empty hands beside a river gather first, then the held water is bent (also away from it)', async () => {
    await h.eval((g) => (g.ctx.water.heldWaterOnly = true));
    try {
      await prep(RIVER, null, 0);
      const d = await h.eval((g) => g.spawnDummy(6, 0, 400));
      await h.eval((g, d) => g.faceTowards(d.x, d.z), d);
      await events();
      const first = await h.eval((g, d) => g.cast('water_whip', { x: d.x, y: d.y + 1.2, z: d.z }), d);
      assert.equal(first.reason, 'gather', 'empty hands must gather, not bend the river: ' + JSON.stringify(first));
      assert.equal(await reserve(), 0, 'nothing is consumed by the refused press');
      await h.step(45);
      const held = await reserve();
      assert.ok(held >= 15, 'the gather motion should fill the hands: ' + held);
      const ev = await events();
      assert.ok(ev.some(([k, p]) => k === 'water:drawn' && p.sourceId.startsWith('river:')), 'gathered from the river: ' + JSON.stringify(ev.filter(([k]) => k === 'water:drawn').slice(0, 2)));
      assert.ok(!ev.some(([k]) => k === 'water:unavailable'), 'no "no water" warning while gathering');
      const second = await h.eval((g, d) => g.cast('water_whip', { x: d.x, y: d.y + 1.2, z: d.z }), d);
      assert.ok(second.ok && second.water.source === 'reserve', 'second press bends the held water: ' + JSON.stringify(second));
      await idle();
      assert.ok((await reserve()) < held, 'bending spends the held water');
      // Carry it away from the water and bend there until it runs out.
      await prep(DESERT, null, 12);
      const away = await h.eval((g) => g.cast('water_whip', null));
      assert.ok(away.ok && away.water.source === 'reserve', 'held water works away from the river: ' + JSON.stringify(away));
      await idle();
      let last = away;
      for (let i = 0; i < 6 && last.ok; i++) {
        await h.step(30);
        last = await h.eval((g) => g.cast('water_whip', null));
        await idle();
      }
      assert.equal(last.reason, 'water', 'with the hands empty and no water around the technique is refused: ' + JSON.stringify(last));
    } finally {
      await h.eval((g) => (g.ctx.water.heldWaterOnly = false));
    }
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL') || h.errors.length) process.exitCode = 1;
}
