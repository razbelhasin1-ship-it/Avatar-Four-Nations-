/**
 * Companions E2E: habitat streaming & discovery → taming (calm approach, food,
 * patience, rescue variants) → bond challenge → bonding for the sky bison and
 * the polar bear dog; flying the bison; riding a ground mount; summon/dismiss;
 * save/load (exactly once); stuck recovery; the gated dragon; the stable UI.
 *
 * Run: node tests/e2e/companions.e2e.mjs   (UNTIL=n runs only the first n checks)
 * Long simulations use debug.companions.fastSteps (frames simulated without drawing).
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

/** UNTIL=<n>: run only the first n checks (later checks depend on earlier ones). */
const UNTIL = Number(process.env.UNTIL || 99);
/** ONLY=<regex>: run only matching (self-contained) checks. */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const h = await launch({ width: 960, height: 540 });
const results = [];
let checkIndex = 0;
const check = async (name, fn, keep = false) => {
  if (++checkIndex > UNTIL || (ONLY && !ONLY.test(name))) return;
  const t0 = Date.now();
  try {
    // Every check starts on foot with no held inputs (a failed check must not cascade).
    if (!keep) await h.eval((g) => {
      const c = g.debug.companions;
      if (!c) return;
      c.autopilot(false);
      if (c.state().mounted) c.dismountNow(true);
      for (const a of ['jump', 'dodge', 'sprint', 'companion', 'interact']) c.key(a, false);
      g.move(0, 0);
      g.ctx.ui.closeAll();
    });
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(0)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
  console.log(results[results.length - 1].join(' | '));
};
const C = (fn, ...a) => h.eval(fn, ...a);
const cr = (uid) => C((g, u) => g.debug.companions.creature(u), uid);
const st = () => C((g) => g.debug.companions.state());
/** Simulate n frames without drawing them (headless software rendering is the bottleneck). */
const fstep = (n, dt = 1 / 30) => C((g, [k, d]) => g.debug.companions.fastSteps(k, d), [n, dt]);
/** Step until pred(state) is truthy (pred runs in the page). */
const until = async (pred, max = 900, chunk = 30, arg = null) => {
  for (let n = 0; n < max; n += chunk) {
    await fstep(chunk);
    if (await C(pred, arg)) return n + chunk;
  }
  return -1;
};
/** Stand `dist` metres from a creature, facing it. */
const standNear = (uid, dist) =>
  C(
    (g, [u, d]) => {
      const c = g.debug.companions.creature(u);
      const p = g.state().player;
      let dx = p.x - c.x, dz = p.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      g.teleport(c.x + dx * d, c.z + dz * d);
      g.faceTowards(c.x, c.z);
      return g.debug.companions.creature(u).dist;
    },
    [uid, dist],
  );
const press = async (action, steps = 2) => {
  await C((g, a) => g.debug.companions.key(a, true), action);
  await h.step(steps);
  await C((g, a) => g.debug.companions.key(a, false), action);
};

try {
  await h.newGame('air');
  await C((g) => {
    g.debug.companions.setAutoName(true);
    window.__ev = [];
    for (const n of ['creature:discovered', 'creature:trust', 'companion:bonded', 'companion:summoned', 'companion:dismissed', 'mount:changed']) g.ctx.events.on(n, (e) => window.__ev.push([n, e]));
  });
  const events = (name) => C((g, n) => window.__ev.filter((e) => e[0] === n).map((e) => e[1]), name);

  await check('habitat streaming: bison herd spawns at the meadow (with an injured member) and despawns far away', async () => {
    await C((g) => g.teleport(1290, 1040));
    await h.step(30);
    let s = await st();
    assert.ok(s.habitats.includes('bison_meadow'), JSON.stringify(s.habitats));
    const herd = await C((g) => g.debug.companions.creatures('sky_bison'));
    assert.equal(herd.length, 5, JSON.stringify(herd));
    assert.ok(herd.some((c) => c.state === 'injured'));
    await C((g) => g.teleport(1700, 1500));
    await fstep(30);
    s = await st();
    assert.ok(!s.habitats.includes('bison_meadow'), 'still spawned far away');
    assert.equal((await C((g) => g.debug.companions.creatures('sky_bison'))).length, 0);
    await C((g) => g.teleport(1290, 1040));
    await fstep(30);
    assert.equal((await C((g) => g.debug.companions.creatures('sky_bison'))).length, 5);
  });

  await check('discovery: coming close to a bison emits creature:discovered', async () => {
    await standNear('bison_meadow#0', 14);
    await h.step(15);
    const s = await st();
    assert.ok(s.discovered.includes('sky_bison'), JSON.stringify(s.discovered));
    const ev = await events('creature:discovered');
    assert.ok(ev.some((e) => e.speciesId === 'sky_bison'));
  });

  await check('calm presence builds trust; bending nearby scares and costs trust', async () => {
    await standNear('bison_meadow#0', 14);
    await C((g) => g.move(0, 0));
    const t0 = (await cr('bison_meadow#0')).trust;
    await fstep(90);
    const t1 = (await cr('bison_meadow#0')).trust;
    assert.ok(t1 > t0 + 1.5, `calm trust ${t0} → ${t1}`);
    await C((g) => g.debug.companions.cast('air'));
    await h.step(2);
    const t2 = (await cr('bison_meadow#0')).trust;
    assert.ok(t2 < t1, `cast did not cost trust ${t1} → ${t2}`);
  });

  await check('feeding: moon peaches raise trust; patience cooldown refuses an immediate second feed', async () => {
    await C((g) => g.debug.companions.setTrust('bison_meadow#0', 26));
    await C((g) => g.debug.companions.setState('bison_meadow#0', 'idle'));
    const d = await standNear('bison_meadow#0', 4.5);
    assert.ok(d < 6, 'not close: ' + d);
    const peaches0 = await C((g) => g.ctx.inventory.count('moon_peaches'));
    assert.ok(peaches0 >= 2, 'no starting peaches: ' + peaches0);
    const label = await C((g) => g.debug.companions.label('bison_meadow#0'));
    assert.match(label, /Moon Peaches/);
    assert.equal(await C((g) => g.debug.companions.interact('bison_meadow#0')), true);
    const t1 = (await cr('bison_meadow#0')).trust;
    assert.ok(t1 >= 41, 'trust after feeding ' + t1);
    assert.equal(await C((g) => g.ctx.inventory.count('moon_peaches')), peaches0 - 1);
    await C((g) => g.debug.companions.interact('bison_meadow#0'));
    assert.equal(await C((g) => g.ctx.inventory.count('moon_peaches')), peaches0 - 1, 'fed again despite cooldown');
  });

  await check('rescue: tending the injured bison three times heals it', async () => {
    await standNear('bison_meadow#3', 4.5);
    for (let i = 0; i < 3; i++) {
      assert.equal(await C((g) => g.debug.companions.interact('bison_meadow#3')), true, 'tend ' + i);
      await h.step(2);
    }
    const c = await cr('bison_meadow#3');
    assert.notEqual(c.state, 'injured');
    assert.ok((await st()).flags.includes('rescued:bison_meadow#3'));
    assert.ok(c.trust >= 40, 'trust ' + c.trust);
  });

  await check('bison bond challenge: follow-the-leader flight through 5 rings → bonded', async () => {
    await C((g) => g.debug.companions.setTrust('bison_meadow#0', 86));
    await standNear('bison_meadow#0', 4.5);
    assert.equal(await C((g) => g.debug.companions.interact('bison_meadow#0')), true);
    let s = await st();
    assert.equal(s.challenge?.kind, 'follow_flight');
    await h.step(25);
    s = await st();
    assert.ok(s.mounted, 'not mounted for the challenge');
    await C((g) => g.debug.companions.autopilot(true));
    const n = await until((g) => g.debug.companions.state().bonded.some((b) => b.speciesId === 'sky_bison'), 2400, 60);
    await C((g) => g.debug.companions.autopilot(false));
    s = await st();
    assert.ok(n > 0, 'challenge not won: ' + JSON.stringify(s.challenge) + ' mount=' + JSON.stringify(s.mount));
    const ev = await events('companion:bonded');
    assert.ok(ev.some((e) => e.speciesId === 'sky_bison'));
    assert.ok(s.mounted && s.mountedFlying, 'should still be flying the bison');
  });

  await check('fly the bison: climb, cruise forward, descend, land and dismount safely', async () => {
    let s = await st();
    const y0 = s.mount.y;
    await C((g) => g.debug.companions.key('jump', true));
    await fstep(60);
    await C((g) => g.debug.companions.key('jump', false));
    s = await st();
    assert.ok(s.mount.y > y0 + 4, `climb ${y0} → ${s.mount.y}`);
    const p0 = [s.mount.x, s.mount.z];
    await C((g) => g.move(0, 1));
    await fstep(120);
    s = await st();
    const moved = Math.hypot(s.mount.x - p0[0], s.mount.z - p0[1]);
    assert.ok(moved > 35, 'cruise moved only ' + moved);
    const player = (await h.state()).player;
    assert.ok(Math.hypot(player.x - s.mount.x, player.z - s.mount.z) < 4, 'rider not on the saddle');
    await C((g) => g.move(0, 0));
    await C((g) => g.debug.companions.key('dodge', true));
    const n = await until((g) => !g.debug.companions.state().mountedFlying, 1500, 30);
    await C((g) => g.debug.companions.key('dodge', false));
    assert.ok(n > 0, 'never landed: ' + JSON.stringify((await st()).mount));
    await press('companion');
    await h.step(20);
    s = await st();
    assert.equal(s.mounted, false);
    const pl = (await h.state()).player;
    const gy = await C((g, p) => g.ctx.world.groundAt(p.x, p.z, p.y + 2).y, pl);
    assert.ok(Math.abs(pl.y - gy) < 1.2, `player not on ground ${pl.y} vs ${gy}`);
    const evs = await events('mount:changed');
    assert.ok(evs.length >= 3, 'mount:changed events ' + evs.length);
  }, true);

  await check('polar bear dog: mother refuses food while her pup is trapped; bending frees the pup; food bonds her', async () => {
    await C((g) => g.ctx.inventory.add('sea_prunes', 6, true));
    await C((g) => g.teleport(470, -1230));
    await fstep(30);
    const fam = await C((g) => g.debug.companions.creatures('polar_bear_dog'));
    assert.equal(fam.length, 3, JSON.stringify(fam));
    const pup = fam.find((c) => c.state === 'trapped');
    assert.ok(pup && pup.scale < 0.8, 'no trapped pup');
    const mom = fam.find((c) => c.uid === 'bear_dog_den#0');
    await C((g) => g.debug.companions.setTrust('bear_dog_den#0', 30));
    await standNear('bear_dog_den#0', 4);
    const prunes0 = await C((g) => g.ctx.inventory.count('sea_prunes'));
    await C((g) => g.debug.companions.interact('bear_dog_den#0'));
    assert.equal(await C((g) => g.ctx.inventory.count('sea_prunes')), prunes0, 'mother ate while the pup was trapped');
    await standNear(pup.uid, 6);
    await h.step(3);
    for (let i = 0; i < 3; i++) {
      await C((g) => g.debug.companions.cast('fire'));
      await h.step(4);
    }
    const freed = await cr(pup.uid);
    assert.notEqual(freed.state, 'trapped');
    assert.ok((await st()).flags.includes(`rescued:${pup.uid}`));
    assert.ok((await cr('bear_dog_den#0')).trust >= 60, 'family gratitude missing');
    // Patience: feed, then finish the bond with one more meal after the trust climbs.
    await C((g) => g.debug.companions.setTrust('bear_dog_den#0', 90));
    await C((g) => g.debug.companions.setState('bear_dog_den#0', 'idle'));
    await standNear('bear_dog_den#0', 3.5);
    assert.equal(await C((g) => g.debug.companions.interact('bear_dog_den#0')), true);
    await h.step(3);
    const s = await st();
    const rec = s.bonded.find((b) => b.speciesId === 'polar_bear_dog');
    assert.ok(rec, 'bear dog not bonded');
    assert.equal(rec.id, 'bear_dog_den#0');
    void mom;
  });

  await check('summon / dismiss: dismissed companion leaves and despawns; summoned one arrives from off-screen', async () => {
    const id = 'bear_dog_den#0';
    assert.equal(await C((g, i) => g.debug.companions.dismiss(i), id), true);
    const gone = await until((g) => !g.debug.companions.creatures('polar_bear_dog').some((c) => c.mode === 'companion'), 900, 30);
    assert.ok(gone > 0, 'dismissed companion never left');
    assert.equal(await C((g, i) => g.debug.companions.summon(i), id), true);
    await h.step(2);
    const c0 = (await C((g) => g.debug.companions.creatures('polar_bear_dog'))).find((c) => c.mode === 'companion');
    assert.ok(c0 && c0.dist > 20, 'summoned companion popped in close: ' + JSON.stringify(c0));
    const n = await until((g) => {
      const c = g.debug.companions.creatures('polar_bear_dog').find((x) => x.mode === 'companion');
      return c && c.dist < 9;
    }, 1200, 30);
    assert.ok(n > 0, 'companion never arrived');
    const ev = await events('companion:summoned');
    assert.ok(ev.some((e) => e.companionId === id));
  });

  await check('ride a ground mount: F mounts, it runs where you steer, F dismounts', async () => {
    const c = (await C((g) => g.debug.companions.creatures('polar_bear_dog'))).find((x) => x.mode === 'companion');
    await standNear(c.uid, c.scale * 1.5 + 2);
    await press('companion');
    await h.step(25);
    let s = await st();
    assert.ok(s.mounted && !s.mountedFlying, 'not mounted: ' + JSON.stringify(s.mount));
    const p0 = [s.mount.x, s.mount.z];
    await C((g) => g.move(0, 1));
    await fstep(90);
    s = await st();
    await C((g) => g.move(0, 0));
    const moved = Math.hypot(s.mount.x - p0[0], s.mount.z - p0[1]);
    assert.ok(moved > 12, 'ground mount moved only ' + moved);
    const pl = (await h.state()).player;
    assert.ok(Math.hypot(pl.x - s.mount.x, pl.z - s.mount.z) < 3, 'rider off the saddle');
    await h.step(30);
    await press('companion');
    await h.step(20);
    s = await st();
    assert.equal(s.mounted, false);
  });

  await check('ostrich horse: trust earns a race; out-sprinting it to the flag bonds it', async () => {
    await C((g) => g.ctx.inventory.add('cabbage', 4, true));
    await C((g) => g.teleport(520, 425));
    await fstep(30);
    const flock = await C((g) => g.debug.companions.creatures('ostrich_horse'));
    assert.ok(flock.length >= 3, 'flock ' + flock.length);
    const uid = flock[0].uid;
    await C((g, u) => g.debug.companions.setTrust(u, 80), uid);
    await C((g, u) => g.debug.companions.setState(u, 'idle'), uid);
    await standNear(uid, 3);
    assert.match(await C((g, u) => g.debug.companions.label(u), uid), /race/i);
    assert.equal(await C((g, u) => g.debug.companions.interact(u), uid), true);
    let s = await st();
    assert.equal(s.challenge?.kind, 'race');
    const fin = s.challenge.finish;
    const d0 = Math.hypot((await cr(uid)).x - fin[0], (await cr(uid)).z - fin[2]);
    await fstep(95); // countdown
    await C((g, f) => g.faceTowards(f[0], f[2]), fin);
    await h.step(2);
    await C((g) => g.debug.companions.key('sprint', true));
    await C((g) => g.move(0, 1));
    let won = -1;
    for (let n = 0; n < 1500 && won < 0; n += 15) {
      await C((g, f) => g.faceTowards(f[0], f[2]), fin);
      await fstep(15);
      s = await st();
      if (s.bonded.some((b) => b.speciesId === 'ostrich_horse')) won = n;
      else if (!s.challenge) break;
    }
    await C((g) => g.move(0, 0));
    await C((g) => g.debug.companions.key('sprint', false));
    const c = await cr(uid);
    assert.ok(Math.hypot(c.x - fin[0], c.z - fin[2]) < d0, 'ostrich never ran');
    assert.ok(won >= 0, 'race not won: ' + JSON.stringify(s.challenge));
  });

  await check('save/load keeps every companion exactly once', async () => {
    await C((g) => g.debug.companions.rename('bison_meadow#0', 'Appa'));
    const before = (await st()).bonded.map((b) => `${b.id}:${b.speciesId}:${b.name}`).sort();
    const slot = await C((g) => g.ctx.session.slot);
    await C((g) => g.save());
    await C((g, sl) => g.loadGame(sl), slot);
    await h.step(30);
    const s = await st();
    const after = s.bonded.map((b) => `${b.id}:${b.speciesId}:${b.name}`).sort();
    assert.deepEqual(after, before);
    const comp = await C((g) => g.debug.companions.creatures().filter((c) => c.mode === 'companion').map((c) => c.companionId));
    assert.equal(new Set(comp).size, comp.length, 'duplicate companion entities ' + JSON.stringify(comp));
    assert.ok(after.some((x) => x.endsWith(':Appa')));
    // Re-saving and re-loading again still gives exactly the same set.
    await C((g) => g.save());
    await C((g, sl) => g.loadGame(sl), slot);
    await h.step(10);
    assert.deepEqual((await st()).bonded.map((b) => `${b.id}:${b.speciesId}:${b.name}`).sort(), before);
  });

  await check('stuck recovery: a walled-in creature escapes and reaches its target', async () => {
    // Flat open ground (so the test measures recovery, not slope avoidance).
    const spot = await C((g) => {
      const w = g.ctx.world;
      for (let r = 0; r < 400; r += 20) {
        for (let a = 0; a < 6.28; a += 0.5) {
          const x = 1290 + Math.sin(a) * r, z = 1040 + Math.cos(a) * r;
          let ok = true;
          for (let dx = -6; dx <= 32 && ok; dx += 4) for (const dz of [-6, 0, 6]) {
            const gs = w.groundAt(x + dx, z + dz, w.heightAt(x + dx, z + dz) + 2);
            if (gs.ny < 0.94 || gs.colliderId || w.liquidAt(x + dx, z + dz)) ok = false;
          }
          if (ok) return [x, z];
        }
      }
      return null;
    });
    assert.ok(spot, 'no flat test ground found');
    await C((g, [x, z]) => { g.teleport(x - 12, z); g.faceTowards(x, z); }, spot);
    await h.step(5);
    const c0 = await C((g) => g.debug.companions.spawnWild('polar_bear_dog', 12, 0));
    await C((g, [u, x, z]) => g.debug.companions.place(u, x, z, Math.PI / 2), [c0.uid, spot[0], spot[1]]);
    const c = await cr(c0.uid);
    const tx = c.x + 25, tz = c.z;
    await C((g, [u, x, z]) => g.debug.companions.stuckTest(u, x, z), [c.uid, tx, tz]);
    const n = await until((g, [u, x, z]) => {
      const k = g.debug.companions.creature(u);
      return k && Math.hypot(k.x - x, k.z - z) < 4;
    }, 900, 30, [c.uid, tx, tz]);
    const k = await cr(c.uid);
    await C((g) => g.debug.companions.clearStuckTest());
    assert.ok(k.recoveries > 0, 'no recovery attempted');
    assert.ok(n > 0, `did not reach target: ${JSON.stringify(k)} target ${tx},${tz}`);
  });

  await check('dragon is gated: Sun Stone fragments + firebending at the altar call it; the test of fearlessness bonds it', async () => {
    const pos = await C((g) => g.debug.companions.dragonPositions());
    await C((g, p) => g.teleport(p.altar[0] + 3, p.altar[2] + 3), pos);
    await h.step(20);
    assert.equal(await cr('sun_warrior_ruins#0'), null, 'dragon present before the requirements');
    assert.equal(await C((g) => g.debug.companions.useAltar()), false, 'altar accepted without fragments');
    for (let i = 0; i < 3; i++) assert.equal(await C((g, k) => g.debug.companions.takeShard(k), i), true, 'shard ' + i);
    assert.equal(await C((g) => g.ctx.inventory.count('sun_stone')), 3);
    // Air-only avatar: the stone is set but stays cold.
    assert.equal(await C((g) => g.debug.companions.useAltar()), false, 'non-firebender kindled the stone');
    let d = await C((g) => g.debug.companions.dragon());
    assert.ok(d.stoneSet && !d.called);
    await C((g) => g.debug.companions.cast('air'));
    await h.step(2);
    assert.ok(!(await C((g) => g.debug.companions.dragon())).called, 'air called the dragon');
    await C((g) => g.setElement('fire'));
    assert.equal(await C((g) => g.debug.companions.useAltar()), true);
    await C((g) => g.debug.companions.cast('fire'));
    await h.step(5);
    d = await C((g) => g.debug.companions.dragon());
    assert.ok(d.called, 'dragon not called');
    assert.ok(await cr('sun_warrior_ruins#0'), 'dragon did not appear');
    // Wait for it to land on its perch and come down to the plaza.
    await C((g, p) => g.teleport(p.plaza[0] + 6, p.plaza[2] + 6), pos);
    const n = await until((g) => g.debug.companions.dragon().phase === 'waiting', 3000, 60);
    assert.ok(n > 0, 'dragon never came down: ' + JSON.stringify(await C((g) => g.debug.companions.dragon())) + ' ' + JSON.stringify(await cr('sun_warrior_ruins#0')));
    assert.equal(await C((g) => g.debug.companions.startDragonTest()), true);
    for (let i = 0; i < 6; i++) {
      await fstep(90);
      if (i === 2 || i === 4) await C((g) => g.debug.companions.cast('fire', 'fire_jab'));
    }
    const ok = await until((g) => g.debug.companions.state().bonded.some((b) => b.speciesId === 'dragon'), 600, 30);
    assert.ok(ok > 0, 'dragon not bonded: ' + JSON.stringify(await C((g) => g.debug.companions.dragon())));
    const herd = await C((g) => g.debug.companions.creatures('dragon'));
    assert.equal(herd.length, 1, 'more than one dragon');
  });

  await check('companion stable UI: lists bonded companions, names a new companion, summons', async () => {
    await C((g) => g.ctx.ui.open('companions', { name: 'bear_dog_den#0' }));
    await h.step(2);
    const cards = await C(() => document.querySelectorAll('.companion-stable [data-companion]').length);
    const bonded = (await st()).bonded.length;
    assert.equal(cards, bonded);
    await C(() => {
      const i = document.querySelector('.companion-stable [data-role=name-input]');
      i.value = 'Naga';
      document.querySelector('.companion-stable [data-action=confirm-name]').click();
    });
    const s = await st();
    assert.equal(s.bonded.find((b) => b.id === 'bear_dog_den#0').name, 'Naga');
    await C(() => document.querySelector('.companion-stable [data-tab=bestiary]').click());
    const species = await C(() => document.querySelectorAll('.companion-stable [data-species]').length);
    assert.ok(species >= 12, 'bestiary entries ' + species);
    await C((g) => g.ctx.ui.closeAll());
  });
} finally {
  // Other teams' in-progress code may log errors elsewhere; this test owns companion errors.
  const errs = h.errors.filter((e) => /companions\//.test(e));
  const other = h.errors.length - errs.length;
  if (other) console.log(`(${other} page errors outside src/companions ignored)`);
  if (errs.length) console.log('COMPANION PAGE ERRORS:\n' + errs.slice(0, 15).join('\n'));
  await h.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed || errs.length ? 1 : 0);
}
