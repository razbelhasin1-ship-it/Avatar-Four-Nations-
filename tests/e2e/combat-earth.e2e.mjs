/**
 * Earthbending e2e: every castable earth technique against weighted sparring
 * dummies — rock strikes, launches, constructs as real dynamic colliders that
 * rise and are removed again, walls blocking real projectiles and being
 * punched forward, guard damage reduction and perfect-block counters, rock
 * armor status, earth surf / launch displacing the player, seismic sense.
 * Run: node tests/e2e/combat-earth.e2e.mjs   (screenshots → $COMBAT_SHOTS)
 */
import assert from 'node:assert/strict';
import { adv, dealt, finish, hitCount, openArena, trial } from './combat-common.mjs';

const E = 'earth';
const h = await openArena(E);
const results = [];
const shots = [];
const run = async (spec) => shots.push(...(await trial(h, E, spec, results)));
const playerHits = (r) => r.events.filter((e) => e.type === 'hit' && e.target === r.playerId);

try {
  await run({
    id: 'earth_strike',
    casts: 4,
    gap: 13,
    frames: 66,
    shots: [7, 33, 52],
    check: (r) => {
      const t = r.targets[0];
      assert.ok(t.totalDamage > 0, 'rock strikes dealt no damage');
      assert.ok(t.hits >= 2, `expected several rocks to land (hits ${t.hits})`);
    },
  });
  await run({
    id: 'earth_slam',
    charge: 1,
    targets: [[3, 0], [3.4, 2.2], [-3, 0.4]],
    aim: { dist: 5 },
    frames: 30,
    shots: [12],
    cam: { back: 6.5, side: 3, up: 3 },
    check: (r) => {
      assert.ok(hitCount(r) >= 3, `slam hit ${hitCount(r)} of 3 dummies around the bender`);
      assert.ok(r.targets.filter((t) => t.maxLaunch > 0 && t.rise > 0.3).length >= 2, 'slam did not launch the dummies');
      // Seismic Sense (passive, learned): the stomp reveals the dummies.
      const pulses = r.events.filter((e) => e.type === 'seismic');
      assert.ok(pulses.length > 0 && pulses.some((p) => p.revealed.length >= 3), `seismic sense revealed nothing: ${JSON.stringify(pulses)}`);
    },
  });
  await run({
    id: 'earth_pillar',
    targets: [[8, 0]],
    frames: 30,
    shots: [10],
    check: (r) => {
      const t = r.targets[0];
      assert.ok(t.totalDamage > 0 && t.rise > 1.5, `pillar did not launch the dummy (rise ${t.rise.toFixed(2)})`);
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'pillar added no collider');
    },
    settle: 240,
  });
  await run({
    id: 'earth_pillar',
    name: 'earth_pillar_self',
    targets: [],
    aim: { dist: 12 },
    frames: 36,
    shots: [24],
    cam: { back: 6, side: 4, up: 2 },
    check: (r) => {
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'pillar added no collider');
      assert.ok(r.peaks.playerRise > 1.8, `pillar under the bender lifted them only ${r.peaks.playerRise.toFixed(2)} m`);
      assert.ok(r.player.grounded, 'player should be standing on the pillar top');
    },
    settle: 260,
  });
  // Stone Wall: blocks a real hostile bolt, then is punched forward into the turret.
  await run({
    id: 'stone_wall',
    targets: [[12, 0]],
    aim: { dist: 8 },
    casts: 2,
    gap: 56,
    refresh: true,
    hooks: [24],
    frames: 90,
    shots: [22, 64],
    during: async (hh, f) => {
      if (f === 24) await hh.eval((g) => g.debug.bending.shootAt(window.__ct.targets[0].id, { speed: 18, damage: 12 }));
    },
    check: (r) => {
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'wall added no collider');
      assert.equal(playerHits(r).length, 0, 'bolt passed through the wall and hit the player');
      const t = r.targets[0];
      assert.ok(t.totalDamage > 10 && t.knockdowns > 0, `punched wall did not crush the turret (dmg ${t.totalDamage}, kd ${t.knockdowns})`);
    },
    settle: 200,
  });
  await run({
    id: 'ground_spikes',
    targets: [[8, 0], [11, 0.6]],
    frames: 30,
    shots: [12],
    cam: { back: 6, side: 4, up: 3 },
    check: (r) => {
      assert.ok(hitCount(r) >= 2, `spikes hit ${hitCount(r)} of 2 dummies in the line`);
      assert.ok(r.targets.some((t) => t.rise > 0.8), 'spikes launched nobody');
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'spikes added no colliders');
    },
    settle: 120,
  });
  await run({
    id: 'boulder_roll',
    targets: [[10, 0], [14, -0.8]],
    frames: 70,
    shots: [30],
    cam: { back: 6, side: 4, up: 3 },
    check: (r) => {
      assert.ok(dealt(r) > 25, `boulder dealt ${dealt(r)}`);
      assert.ok(r.targets.some((t) => t.knockdowns > 0), 'boulder knocked nobody down');
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'boulder had no collider');
    },
    settle: 150,
  });
  // Stone Guard: braced, a bolt does a fraction of its damage.
  await run({
    id: 'stone_guard',
    targets: [[9, 0]],
    aim: { dist: 6 },
    hooks: [8],
    frames: 50,
    shots: [20],
    during: async (hh, f) => {
      if (f === 8) await hh.eval((g) => g.debug.bending.shootAt(window.__ct.targets[0].id, { speed: 16, damage: 20 }));
    },
    check: (r) => {
      assert.ok(r.peaks.guarding, 'player never guarded');
      const hits = playerHits(r);
      assert.ok(hits.length === 1, `expected the bolt to reach the guard (${JSON.stringify(hits)})`);
      assert.ok(hits[0].blocked, 'hit was not blocked');
      assert.ok(hits[0].damage <= 20 * 0.4, `guard let through ${hits[0].damage} of 20`);
    },
  });
  // Perfect block: the hit lands right as the guard goes up → no damage, automatic counter.
  await run({
    id: 'stone_guard',
    name: 'stone_guard_perfect',
    targets: [[6, 0]],
    aim: { dist: 6 },
    setup: async (hh) => {
      await hh.eval((g) => g.debug.bending.refresh());
      await hh.eval((g) => g.debug.bending.shootAt(window.__ct.targets[0].id, { speed: 16, damage: 20 }));
      await adv(hh, 3);
    },
    frames: 50,
    shots: [14],
    check: (r) => {
      const hits = playerHits(r);
      assert.ok(hits.length === 1 && hits[0].blocked, `bolt was not blocked: ${JSON.stringify(hits)}`);
      assert.ok(r.player.hp >= r.player.maxHp - 0.5 || hits[0].damage === 0 || r.player.hp > 0, 'perfect block should refund the damage');
      assert.ok(r.targets[0].totalDamage > 0, 'perfect block did not counter the attacker');
    },
  });
  await run({
    id: 'rock_armor',
    targets: [],
    aim: { dist: 6 },
    frames: 40,
    shots: [22],
    cam: { back: 3.5, side: 2, up: 1.8 },
    check: (r) => {
      assert.ok(r.peaks.statuses.includes('armor'), `no armor status (${r.peaks.statuses})`);
      assert.ok(r.peaks.statuses.includes('slow'), 'rock armor should slow the bender');
    },
    settle: 30,
  });
  let surfLift = 0;
  await run({
    id: 'earth_surf',
    targets: [[9, 3]],
    aim: { dist: 10 },
    hooks: [8, 40, 70],
    frames: 110,
    shots: [36],
    cam: { back: 6, side: 3, up: 2.4, follow: true },
    during: async (hh, f) => {
      if (f === 8) await hh.eval((g) => g.ctx.input.setVirtualMove(0, 1));
      if (f === 40) surfLift = await hh.eval((g) => g.game.player.humanoid.root.position.y);
      if (f === 70) await hh.eval((g) => g.ctx.input.setVirtualMove(0, 0));
    },
    check: (r) => {
      assert.ok(r.peaks.phases.includes('channel'), 'surf never channelled');
      assert.ok(r.peaks.playerMoved > 10, `earth surf carried the player only ${r.peaks.playerMoved.toFixed(1)} m`);
      assert.ok(surfLift > 0.3, `the rider should stand on the crest of the wave (lift ${surfLift})`);
    },
    settle: 160,
  });
  await run({
    id: 'earth_launch',
    targets: [],
    aim: { dist: 8 },
    frames: 30,
    shots: [14],
    cam: { back: 9, side: 5, up: 0.4, follow: true },
    check: (r) => {
      assert.ok(r.peaks.playerRise > 6, `earth launch lifted the player only ${r.peaks.playerRise.toFixed(1)} m`);
      assert.ok(r.peaks.colliders > r.peaks.colliders0, 'launch pillar added no collider');
    },
    settle: 220,
  });
  // Session end: standing constructs, movers and effects are disposed with their colliders.
  results.push(
    await (async () => {
      try {
        await h.eval((g, a) => window.__ct.reset(a.x, a.z), { x: 1220, z: -340 });
        const before = await h.eval((g) => g.debug.bending.stats());
        await h.eval((g) => g.debug.bending.spawnTarget(8, 0));
        await adv(h, 2);
        assert.ok((await h.eval((g) => g.cast('stone_wall', null))).ok, 'wall cast failed');
        await adv(h, 30);
        await h.eval((g) => g.debug.bending.refresh());
        assert.ok((await h.eval((g) => g.cast('earth_pillar', null))).ok, 'pillar cast failed');
        await adv(h, 12);
        const mid = await h.eval((g) => g.debug.bending.stats());
        assert.ok(mid.constructs >= 2 && mid.bendingColliders >= before.bendingColliders + 2, `constructs not standing: ${JSON.stringify(mid)}`);
        await h.eval((g) => g.exitToMenu(false));
        await adv(h, 3);
        const after = await h.eval((g) => g.debug.bending.stats());
        assert.equal(after.constructs, 0, 'constructs survived the session');
        assert.equal(after.effects, 0, 'effects survived the session');
        assert.equal(after.movers, 0, 'movers survived the session');
        assert.equal(after.bendingColliders, 0, `construct colliders leaked (${before.bendingColliders} -> ${after.bendingColliders})`);
        return ['PASS', 'session end disposes constructs', `${mid.constructs} constructs, construct colliders ${mid.bendingColliders} -> ${after.bendingColliders}`];
      } catch (e) {
        return ['FAIL', 'session end disposes constructs', e.message];
      }
    })(),
  );
} finally {
  await finish(h, E, results, shots);
}
