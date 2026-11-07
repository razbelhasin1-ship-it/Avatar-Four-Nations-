/**
 * Pillar Charge (earth): standing on your own raised Earth Pillar, Dodge rides it into your enemies.
 *  - a locked target 20 m away is reached in about 0.8 s; you stay planted on the stone; chi and cooldown
 *  - without lock-on it picks the enemy ahead of the camera (cone)
 *  - a line of enemies: each rammed once and bowled aside; a heavy beast stops it
 *  - an enemy against a wall: rammed, and the pillar stops short of the wall (no tunnelling)
 *  - a target that dodges right before the impact is still caught by the slam
 *  - up and down a slope; stops before a ledge; no enemy: a 14 m run and a ground slam
 *  - rapid double taps, low chi, cooldown; Jump, a stun, pause and an orientation change mid-charge
 *  - the raised pillar you do not charge still stands and sinks; Dodge off a pillar still dodges
 * Run: node tests/e2e/pillar-charge.e2e.mjs   (ONLY=regex for some checks)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 960, height: 540 });
const DT = 1 / 60;
const results = [];
/** ONLY=regex runs just the matching checks. */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const check = async (name, fn) => {
  if (ONLY && !ONLY.test(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 6).join(' ')]);
  }
  console.log(results[results.length - 1].join(' | '));
};
const state = () => h.eval((g) => g.debug.pillarCharge.state());
const press = async (action) => {
  await h.eval((g, a) => g.ctx.input.setVirtual(a, true), action);
  await h.step(1, DT);
  await h.eval((g, a) => g.ctx.input.setVirtual(a, false), action);
};
/** Fresh ground at (x, z) facing `yaw`: no enemies, full chi, cooldowns clear, then a pillar raised under you. */
async function onPillar(x, z, yaw) {
  // A check that failed mid-ride leaves its ride behind: let it end first (its cooldown is cleared below).
  await settle();
  await h.eval(
    (g, a) => {
      g.debug.enemies.clear();
      const p = g.ctx.player;
      g.teleport(a.x, a.z);
      p.yaw = a.yaw;
      p.lockTarget = null;
      p.chi = p.maxChi;
      g.ctx.cameraRig.yaw = a.yaw + Math.PI;
      g.ctx.cameraRig.pitch = 0.4;
      g.ctx.combat.startCooldown(p, 'earth_pillar', 0);
      g.ctx.combat.startCooldown(p, 'earth_pillar_charge', 0);
    },
    { x, z, yaw },
  );
  await h.step(20, DT);
  await h.eval((g) => {
    const p = g.ctx.player;
    g.ctx.combat.tryCast(p, 'earth_pillar', { force: true, aimDir: new p.position.constructor(Math.sin(p.yaw), -0.3, Math.cos(p.yaw)) });
  });
  for (let i = 0; i < 40; i++) {
    await h.step(5, DT);
    if (await h.eval((g) => g.debug.pillarCharge.canCharge())) return;
  }
  throw new Error('never stood on the raised pillar');
}
/** Step until the ride is in one of `phases` (or idle); returns the frames recorded. */
async function rideUntil(phases = ['chain', 'lower', 'idle'], max = 200) {
  const frames = [];
  for (let i = 0; i < max; i++) {
    await h.step(1, DT);
    const s = await state();
    frames.push(s);
    if (phases.includes(s.phase)) break;
  }
  return frames;
}
const settle = async () => {
  for (let i = 0; i < 60; i++) {
    if ((await state()).phase === 'idle') return;
    await h.step(10, DT);
  }
};
const spread = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
/** Enemies that never sidestep on their own (a check about the ram, not about the AI's dodge). */
const noDodge = (ids) =>
  h.eval((g, ids) => {
    for (const id of ids) {
      const e = g.debug.enemies.entity(id);
      if (e) e.arch = { ...e.arch, behaviour: { ...e.arch.behaviour, dodge: 0 } };
    }
  }, ids);

try {
  await h.newGame('earth');
  await h.eval((g) => {
    // No ambient camps (a bandit camp lies 34 m from the wall check): only the enemies each check spawns.
    g.debug.enemies.camps(false);
    g.debug.enemies?.clear?.();
    g.freezeTime(true);
    g.setTime(12);
    window.__pc = { slams: [], ended: [], failed: [], launched: [], hits: [] };
    g.ctx.events.on('hit', (e) => window.__pc.hits.push({ target: e.targetId, damage: +e.damage.toFixed(1), tech: e.techniqueId, blocked: e.blocked }));
    g.ctx.events.on('pillarcharge:slam', (e) => window.__pc.slams.push(e));
    g.ctx.events.on('pillarcharge:ended', (e) => window.__pc.ended.push(e));
    g.ctx.events.on('pillarcharge:launched', (e) => window.__pc.launched.push(e));
    g.ctx.events.on('technique:failed', (e) => window.__pc.failed.push(e));
  });
  await h.step(30);
  // Fixed steps only from here: timings are simulation time.
  await h.eval((g) => g.game.stop());
  const ev = () => h.eval(() => window.__pc);

  await check('locked target 20 m away: reached in about 0.8 s, you stay planted on the stone, chi 30 and a 5 s cooldown', async () => {
    await onPillar(480, 370, 0.6);
    const id = await h.eval((g) => g.debug.enemies.spawn('platypus_bear', 20, 0).id);
    await h.step(2, DT);
    await h.eval((g, id) => (g.ctx.player.lockTarget = g.debug.enemies.entity(id)), id);
    const chi0 = await h.eval((g) => g.ctx.player.chi);
    await press('dodge');
    const chi1 = await h.eval((g) => g.ctx.player.chi);
    let t = DT;
    let reached = null;
    const frames = [];
    for (let i = 0; i < 120; i++) {
      await h.step(1, DT);
      t += DT;
      const s = await state();
      frames.push(s);
      if (reached === null && (s.hits > 0 || s.phase === 'slam')) reached = t;
      if (s.phase === 'chain' || s.phase === 'lower') break;
    }
    const d0 = 20;
    assert.ok(chi0 - chi1 > 29 && chi0 - chi1 < 31, `chi ${chi0} -> ${chi1}`);
    assert.ok(reached !== null && reached < 1.0 && reached > 0.6, `reached a target ${d0} m away in ${reached?.toFixed(3)} s`);
    const att = frames.filter((f) => f.local && ['charge', 'slam'].includes(f.phase));
    assert.ok(att.length > 30, 'attached frames ' + att.length);
    const sp = Math.max(spread(att.map((f) => f.local.x)), spread(att.map((f) => f.local.y)), spread(att.map((f) => f.local.z)));
    assert.ok(sp < 0.005, `rider offset on the stone moved ${sp} m`);
    assert.equal(Math.max(...frames.map((f) => f.speed ?? 0)), 27, 'peak speed = 3x Earth sprint');
    const last = (await ev()).slams.slice(-1)[0];
    assert.equal(last.reason, 'heavy', JSON.stringify(last));
    await settle();
    const cd = await h.eval((g) => g.ctx.combat.cooldownLeft(g.ctx.player, 'earth_pillar_charge'));
    assert.ok(cd > 2 && cd <= 5, `cooldown ${cd}`);
  });

  await check('no lock: it picks the enemy ahead of the camera (60-degree cone), not one off to the side', async () => {
    await onPillar(520, 400, 0.6);
    const ids = await h.eval((g) => ({ ahead: g.debug.enemies.spawn('bandit_spearman', 15, 1.5).id, side: g.debug.enemies.spawn('bandit_spearman', 6, 8).id }));
    await h.step(2, DT);
    const pick = await h.eval((g) => g.debug.pillarCharge.pick());
    assert.equal(pick.target, ids.ahead, JSON.stringify(pick));
    await press('dodge');
    await rideUntil();
    const slam = (await ev()).slams.slice(-1)[0];
    assert.equal(slam.reason, 'target', JSON.stringify(slam));
    await settle();
  });

  await check('a line of enemies: each rammed once and bowled aside; a heavy beast stops the pillar dead', async () => {
    await onPillar(560, 360, 0.6);
    const ids = await h.eval((g) => ({ a: g.debug.enemies.spawn('bandit_spearman', 6, 0.3).id, b: g.debug.enemies.spawn('bandit_spearman', 10, -0.4).id, bear: g.debug.enemies.spawn('platypus_bear', 16, 0).id }));
    await noDodge([ids.a, ids.b]);
    await h.step(2, DT);
    await h.eval((g, id) => (g.ctx.player.lockTarget = g.debug.enemies.entity(id)), ids.bear);
    const hp0 = await h.eval((g, ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, g.debug.enemies.entity(id).health.hp])), ids);
    await press('dodge');
    const frames = await rideUntil(['slam']);
    const s = frames[frames.length - 1];
    assert.equal(s.phase, 'slam');
    assert.equal(s.reason, 'heavy', 'the bear stops it');
    assert.equal(s.hits, 3, 'three rammed, once each');
    const hp1 = await h.eval((g, ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, g.debug.enemies.entity(id)?.health.hp ?? 0])), ids);
    for (const k of ['a', 'b', 'bear']) assert.ok(hp1[k] < hp0[k], `${k} took damage ${hp0[k]} -> ${hp1[k]}`);
    await settle();
  });

  await check('an enemy against a wall: rammed, and the pillar stops short of the wall (no tunnelling)', async () => {
    await onPillar(600, 420, 0.6);
    const wall = await h.eval((g) => {
      const p = g.ctx.player.position;
      const yaw = 0.6;
      const x = p.x + Math.sin(yaw) * 13, z = p.z + Math.cos(yaw) * 13;
      const y = g.ctx.world.heightAt(x, z);
      return { id: g.ctx.world.collision.add({ shape: 'box', x, y: y + 1.5, z, hx: 3, hy: 1.5, hz: 0.12, yaw, solid: true, walkable: false, surface: 'rock' }, true), x, z };
    });
    try {
      const id = await h.eval((g) => g.debug.enemies.spawn('bandit_spearman', 12, 0).id);
      await h.step(2, DT);
      await h.eval((g, id) => (g.ctx.player.lockTarget = g.debug.enemies.entity(id)), id);
      const n0 = await h.eval(() => ({ launched: window.__pc.launched.length, hits: window.__pc.hits.length }));
      await press('dodge');
      const frames = await rideUntil(['chain', 'lower', 'idle']);
      const s = frames.filter((f) => f.pillar).slice(-1)[0];
      const foe = await h.eval((g, id) => {
        const e = g.debug.enemies.entity(id);
        return e ? { hp: e.health.hp, alive: e.alive, x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2), dodges: e.stats?.dodges ?? null } : null;
      }, id);
      // What happened, for the failure message.
      const e = await ev();
      const why = JSON.stringify({
        foe,
        wall: [+wall.x.toFixed(2), +wall.z.toFixed(2)],
        launched: e.launched.length - n0.launched,
        hits: e.hits.slice(n0.hits),
        slam: e.slams.slice(-1)[0],
        failed: e.failed.slice(-1)[0]?.reason ?? null,
        phases: [...new Set(frames.map((f) => f.phase))],
        last: s ? { travelled: s.travelled, hits: s.hits, reason: s.reason, at: [s.pillar.x, s.pillar.z] } : null,
      });
      assert.ok((foe?.hp ?? 0) < 99, 'the enemy was hit ' + why);
      const front = Math.hypot(wall.x - s.pillar.x, wall.z - s.pillar.z) - 1.05;
      assert.ok(front > -0.05, `the pillar's front went ${-front} m into the wall`);
    } finally {
      await h.eval((g, id) => g.ctx.world.collision.remove(id), wall.id);
      await settle();
    }
  });

  await check('a target that dodges right before the impact is still caught by the slam', async () => {
    await onPillar(560, 300, 0.6);
    const id = await h.eval((g) => g.debug.enemies.spawn('bandit_spearman', 10, 0).id);
    await h.step(2, DT);
    await h.eval((g, id) => (g.ctx.player.lockTarget = g.debug.enemies.entity(id)), id);
    const hp0 = await h.eval((g, id) => g.debug.enemies.entity(id).health.hp, id);
    await press('dodge');
    // About 0.1 s before contact it sidesteps (its brief invulnerability covers the ram and the slam's instant).
    let dodged = false;
    for (let i = 0; i < 90 && !dodged; i++) {
      await h.step(1, DT);
      dodged = await h.eval((g, id) => {
        const r = g.debug.pillarCharge.driver.ride;
        const e = g.debug.enemies.entity(id);
        if (!r || r.phase !== 'charge' || !e) return false;
        const gap = Math.hypot(e.position.x - r.x, e.position.z - r.z) - (r.pillar.radius + e.radius + 0.1);
        if (gap > r.speed * 0.1) return false;
        e.cancelAttack(g.ctx);
        e.dodgeCD = 0;
        return e.dodge(g.ctx, new e.position.constructor(Math.cos(r.heading), 0, -Math.sin(r.heading)));
      }, id);
    }
    assert.ok(dodged, 'it sidestepped before the impact');
    await rideUntil(['chain', 'lower', 'idle']);
    const foe = await h.eval((g, id) => {
      const e = g.debug.enemies.entity(id);
      return e ? { hp: e.health.hp, dodges: e.stats.dodges } : null;
    }, id);
    assert.ok((foe?.hp ?? 0) < hp0, `the slam caught it: hp ${hp0} -> ${JSON.stringify(foe)}`);
    await settle();
  });

  await check('up and down a slope: ridden all the way, the stone following the ground', async () => {
    const slope = await h.eval((g) => {
      const W = g.ctx.world;
      let best = null;
      for (let x = 300; x <= 700; x += 8) for (let z = 200; z <= 560; z += 8) {
        for (let a = 0; a < 8; a++) {
          const yaw = (a / 8) * Math.PI * 2;
          const h0 = W.heightAt(x, z), h1 = W.heightAt(x + Math.sin(yaw) * 12, z + Math.cos(yaw) * 12), hm = W.heightAt(x + Math.sin(yaw) * 6, z + Math.cos(yaw) * 6);
          const deg = (Math.atan2(h1 - h0, 12) * 180) / Math.PI;
          if (deg > 14 && deg < 28 && Math.abs(hm - (h0 + h1) / 2) < 0.6 && !W.liquidAt(x, z) && (!best || Math.abs(deg - 20) < Math.abs(best.deg - 20))) best = { x, z, yaw, deg };
        }
      }
      return best;
    });
    assert.ok(slope, 'a slope nearby');
    await onPillar(slope.x, slope.z, slope.yaw);
    await press('dodge');
    let fr = await rideUntil();
    let last = fr.filter((f) => f.pillar).slice(-1)[0];
    const rise = last.pillar.base - fr.find((f) => f.pillar).pillar.base;
    assert.ok(last.reason === 'distance' && last.travelled > 13.9, `up: ${last.reason} after ${last.travelled} m`);
    assert.ok(rise > 3, `climbed ${rise} m`);
    await settle();
    // Back down from the top.
    await onPillar(slope.x + Math.sin(slope.yaw) * 14, slope.z + Math.cos(slope.yaw) * 14, slope.yaw + Math.PI);
    await press('dodge');
    fr = await rideUntil();
    last = fr.filter((f) => f.pillar).slice(-1)[0];
    assert.ok(last.reason === 'distance' && last.travelled > 13.9, `down: ${last.reason} after ${last.travelled} m`);
    let maxStep = 0;
    const bases = fr.filter((f) => f.pillar).map((f) => f.pillar.base);
    for (let i = 1; i < bases.length; i++) maxStep = Math.max(maxStep, Math.abs(bases[i] - bases[i - 1]));
    assert.ok(maxStep < 0.3, `base moved ${maxStep} m in one frame`);
    await settle();
  });

  await check('near a ledge: it stops before the drop instead of carrying you off', async () => {
    await h.eval((g) => g.teleport(640, 380));
    await h.step(10, DT);
    const plat = await h.eval((g) => {
      const p = g.ctx.player.position;
      const yaw = 0.6;
      const y = g.ctx.world.heightAt(p.x, p.z) + 5;
      const id = g.ctx.world.collision.add({ shape: 'box', x: p.x, y: y - 2.5, z: p.z, hx: 6, hy: 2.5, hz: 6, yaw, solid: true, walkable: true, surface: 'rock' }, true);
      return { id, cx: p.x, cz: p.z, y };
    });
    await h.eval((g, p) => g.teleport(p.cx, p.cz, p.y + 0.1), plat);
    await h.step(10, DT);
    await h.eval((g) => {
      const p = g.ctx.player;
      p.yaw = 0.6;
      p.chi = p.maxChi;
      g.ctx.cameraRig.yaw = 0.6 + Math.PI;
      g.ctx.combat.startCooldown(p, 'earth_pillar', 0);
      g.ctx.combat.startCooldown(p, 'earth_pillar_charge', 0);
      g.ctx.combat.tryCast(p, 'earth_pillar', { force: true, aimDir: new p.position.constructor(Math.sin(0.6), -0.3, Math.cos(0.6)) });
    });
    await h.step(45, DT);
    await press('dodge');
    const fr = await rideUntil();
    const last = fr.filter((f) => f.pillar).slice(-1)[0];
    const along = (last.pillar.x - plat.cx) * Math.sin(0.6) + (last.pillar.z - plat.cz) * Math.cos(0.6);
    assert.equal(last.reason, 'ledge');
    assert.ok(along + 1.05 <= 6.05, `front at ${(along + 1.05).toFixed(2)} m, the edge at 6 m`);
    await h.step(60, DT);
    await settle();
    await h.eval((g, id) => g.ctx.world.collision.remove(id), plat.id);
  });

  await check('no enemy: a 14 m run along the aim that ends in a ground slam; then it sets you down', async () => {
    await onPillar(480, 330, 2.4);
    const hp = await h.eval((g) => g.ctx.player.health.hp);
    await press('dodge');
    const fr = await rideUntil(['lower', 'idle']);
    const last = fr.filter((f) => f.pillar).slice(-1)[0];
    assert.equal(last.reason, 'distance');
    assert.ok(Math.abs(last.travelled - 14) < 0.05, 'ran ' + last.travelled);
    await settle();
    const after = await h.eval((g) => ({ hp: g.ctx.player.health.hp, grounded: g.ctx.player.body.grounded, kin: g.ctx.player.body.kinematic }));
    assert.ok(after.grounded && !after.kin && after.hp >= hp, JSON.stringify(after));
    assert.equal((await ev()).ended.slice(-1)[0].reason, 'lowered');
  });

  await check('rapid double taps: one charge, chi paid once', async () => {
    await onPillar(440, 420, 1.2);
    const before = (await ev()).launched.length;
    const chi0 = await h.eval((g) => g.ctx.player.chi);
    await press('dodge');
    await press('dodge');
    await h.step(2, DT);
    await press('dodge');
    const chi1 = await h.eval((g) => g.ctx.player.chi);
    // (Chi regenerates a little over these frames: about 30 paid once, not 60 or 90.)
    try {
      assert.equal((await ev()).launched.length - before, 1);
      assert.ok(chi0 - chi1 > 25 && chi0 - chi1 < 31, `chi ${chi0} -> ${chi1}`);
    } finally {
      await rideUntil();
      await settle();
    }
  });

  await check('low chi and cooldown: refused (fail reason chi / cooldown), nothing launched', async () => {
    await onPillar(400, 380, 0.3);
    await h.eval((g) => (g.ctx.player.chi = 10));
    const before = (await ev()).launched.length;
    await press('dodge');
    await h.step(2, DT);
    let e = await ev();
    assert.equal(e.launched.length, before, 'launched with 10 chi');
    assert.equal(e.failed.slice(-1)[0]?.reason, 'chi', JSON.stringify(e.failed.slice(-1)));
    assert.equal((await state()).phase, 'idle');
    await h.eval((g) => {
      const p = g.ctx.player;
      p.chi = p.maxChi;
      g.ctx.combat.startCooldown(p, 'earth_pillar_charge', 3);
    });
    await press('dodge');
    await h.step(2, DT);
    e = await ev();
    assert.equal(e.launched.length, before, 'launched on cooldown');
    assert.equal(e.failed.slice(-1)[0]?.reason, 'cooldown');
    // Still on the pillar: Dodge never rolled you off it.
    assert.ok(await h.eval((g) => g.debug.pillarCharge.canCharge() || g.ctx.player.body.groundColliderId > 0));
    await h.step(420, DT);
  });

  await check('Jump mid-charge: you leap off safely (no fall damage) and the pillar sinks', async () => {
    await onPillar(520, 340, 0.9);
    const hp = await h.eval((g) => g.ctx.player.health.hp);
    await press('dodge');
    await rideUntil(['charge']);
    await h.step(10, DT);
    await press('jump');
    await h.step(2, DT);
    const s = await state();
    assert.equal(s.phase, 'idle', 'the ride ended');
    assert.equal((await ev()).ended.slice(-1)[0].reason, 'jumped');
    for (let i = 0; i < 30; i++) {
      await h.step(5, DT);
      if (await h.eval((g) => g.ctx.player.body.grounded)) break;
    }
    const after = await h.eval((g) => ({ hp: g.ctx.player.health.hp, grounded: g.ctx.player.body.grounded, kin: g.ctx.player.body.kinematic }));
    assert.ok(after.grounded && !after.kin, JSON.stringify(after));
    assert.ok(after.hp >= hp, `fall damage ${hp} -> ${after.hp}`);
    await h.step(120, DT);
  });

  await check('a stun mid-charge: it stops safely (no slam) and sets you down', async () => {
    await onPillar(560, 440, 0.2);
    const slams = (await ev()).slams.length;
    await press('dodge');
    await rideUntil(['charge']);
    await h.step(8, DT);
    await h.eval((g) => (g.ctx.player.stunned = 0.6));
    const fr = await rideUntil(['lower', 'idle']);
    assert.ok(fr.some((f) => f.phase === 'brake'), 'braked');
    await settle();
    const e = await ev();
    assert.equal(e.slams.length, slams, 'no slam');
    assert.equal(e.ended.slice(-1)[0].reason, 'lowered');
    assert.ok(await h.eval((g) => g.ctx.player.body.grounded && !g.ctx.player.body.kinematic));
  });

  await check('pause mid-charge: the move freezes, then resumes and completes', async () => {
    await onPillar(600, 340, 1.0);
    await press('dodge');
    await rideUntil(['charge']);
    await h.step(6, DT);
    const a = await state();
    await h.eval((g) => g.game.setPaused(true));
    await h.step(30, DT);
    const b = await state();
    assert.ok(Math.abs(a.pillar.x - b.pillar.x) < 1e-6 && Math.abs(a.travelled - b.travelled) < 1e-6, 'moved while paused');
    await h.eval((g) => g.game.setPaused(false));
    const fr = await rideUntil(['chain', 'lower', 'idle']);
    assert.ok(fr.length > 0 && ['chain', 'lower', 'idle'].includes(fr[fr.length - 1].phase));
    await settle();
  });

  await check('orientation change mid-charge: the ride completes, no errors', async () => {
    await onPillar(640, 300, 0.4);
    await press('dodge');
    await rideUntil(['charge']);
    await h.page.setViewportSize({ width: 540, height: 960 });
    await h.step(4, DT);
    const fr = await rideUntil(['chain', 'lower', 'idle']);
    await h.page.setViewportSize({ width: 960, height: 540 });
    assert.ok(['chain', 'lower', 'idle'].includes(fr[fr.length - 1].phase));
    await settle();
  });

  await check('regression: a pillar you do not charge still stands and sinks; Dodge on the ground still dodges', async () => {
    await onPillar(680, 360, 0.2);
    // It stands ~6 s and sinks as before, setting you back on the ground.
    await h.step(480, DT);
    const s = await h.eval((g) => ({ can: g.debug.pillarCharge.canCharge(), grounded: g.ctx.player.body.grounded, y: g.ctx.player.position.y, ground: g.ctx.world.heightAt(g.ctx.player.position.x, g.ctx.player.position.z) }));
    assert.ok(!s.can && s.grounded && Math.abs(s.y - s.ground) < 0.6, JSON.stringify(s));
    const dodged = await h.eval(() => {
      window.__dodged = 0;
      window.__game.ctx.events.on('player:dodged', () => window.__dodged++);
      return true;
    });
    void dodged;
    await press('dodge');
    await h.step(4, DT);
    assert.equal(await h.eval(() => window.__dodged), 1, 'dodged');
  });

  await check('on Kyoshi Island (its own map, far off the mainland) it rides and slams like anywhere else', async () => {
    await settle();
    await h.eval((g) => g.debug.travel.toIsland('ki_meadow'));
    for (let i = 0; i < 40; i++) {
      await h.step(10, DT);
      if (await h.eval((g) => !!g.ctx.world.getRegionContent('kyoshi_isle')?.ready)) break;
    }
    // The flattest open line across the meadow, away from the bison keeper.
    const spot = await h.eval((g) => {
      const W = g.ctx.world;
      const m = g.debug.kyoshi.marks().meadow;
      let best = null;
      for (let a = 0; a < 16; a++) {
        const yaw = (a / 16) * Math.PI * 2;
        const x = m.x + Math.sin(yaw) * 6, z = m.z + Math.cos(yaw) * 6;
        let worst = 0, prev = W.heightAt(x, z), wet = false;
        for (let d = 1; d <= 16; d++) {
          const h = W.heightAt(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d);
          worst = Math.max(worst, Math.abs(h - prev));
          prev = h;
          if (W.liquidAt(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d)) wet = true;
        }
        if (!wet && (!best || worst < best.worst)) best = { x, z, yaw, worst };
      }
      return best;
    });
    assert.ok(spot && spot.x > 4000 && spot.worst < 0.35, 'an open line on the island ' + JSON.stringify(spot));
    await onPillar(spot.x, spot.z, spot.yaw);
    const id = await h.eval((g) => g.debug.enemies.spawn('bandit_spearman', 12, 0).id);
    await noDodge([id]);
    await h.step(2, DT);
    await h.eval((g, id) => (g.ctx.player.lockTarget = g.debug.enemies.entity(id)), id);
    const hp0 = await h.eval((g, id) => g.debug.enemies.entity(id).health.hp, id);
    await press('dodge');
    const fr = await rideUntil(['chain', 'lower', 'idle']);
    const last = fr.filter((f) => f.pillar).slice(-1)[0];
    const hp1 = await h.eval((g, id) => g.debug.enemies.entity(id)?.health.hp ?? 0, id);
    assert.ok(last && last.travelled > 6, `rode ${last?.travelled} m (${last?.reason})`);
    assert.equal(last.reason, 'target', JSON.stringify(last));
    assert.ok(hp1 < hp0, `the enemy took the charge: ${hp0} -> ${hp1}`);
    await settle();
  });

  await check('no console errors', async () => {
    assert.deepEqual(h.errors, []);
  });
} finally {
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASSED');
  await h.close();
  process.exit(failed.length ? 1 : 0);
}
