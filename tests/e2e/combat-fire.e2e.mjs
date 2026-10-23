/**
 * Firebending e2e: every castable fire technique against weighted sparring
 * dummies — bolts and explosions dealing damage, burn status, knockback,
 * movement techniques displacing the player, channels ending, lightning
 * chaining, cleanup of projectiles / effects.
 * Run: node tests/e2e/combat-fire.e2e.mjs   (screenshots → $COMBAT_SHOTS)
 */
import assert from 'node:assert/strict';
import { dealt, finish, hitCount, openArena, trial } from './combat-common.mjs';

const E = 'fire';
const h = await openArena(E);
const results = [];
const shots = [];
const run = async (spec) => shots.push(...(await trial(h, E, spec, results)));

try {
  await run({
    id: 'fire_jab',
    casts: 4,
    gap: 8,
    frames: 42,
    shots: [5, 30],
    check: (r) => {
      const t = r.targets[0];
      assert.ok(t.totalDamage > 0, 'flame punches dealt no damage');
      assert.ok(t.hits >= 3, `expected the 4-step chain to land several bolts (hits ${t.hits})`);
      assert.ok(r.peaks.projectiles >= 1, 'no fire bolts were thrown');
    },
  });
  await run({
    id: 'fire_blast',
    charge: 1,
    frames: 30,
    shots: [9],
    check: (r) => {
      const t = r.targets[0];
      assert.ok(t.totalDamage > 15, `fireball damage too low (${t.totalDamage})`);
      assert.ok(t.statuses.includes('burn'), `no burn status: ${t.statuses}`);
      assert.ok(hitCount(r) >= 2, 'explosion splash hit nobody else');
      assert.ok(t.moved > 0.5 || t.rise > 0.3, 'explosion did not knock the target back');
    },
  });
  await run({
    id: 'flame_sweep',
    targets: [[3.2, -1.6], [3.8, 1.6], [2.6, 0]],
    aim: { dist: 5 },
    frames: 26,
    shots: [9],
    check: (r) => assert.ok(hitCount(r) >= 2, `flame sweep hit ${hitCount(r)} dummies`),
  });
  await run({
    id: 'fire_dash',
    targets: [[5, 3.2]],
    aim: { dist: 10 },
    frames: 20,
    shots: [6],
    cam: { back: 6, side: 4, up: 2.4 },
    check: (r) => assert.ok(r.peaks.playerMoved > 6, `fire dash moved the player only ${r.peaks.playerMoved.toFixed(2)} m`),
  });
  await run({
    id: 'spinning_flame_kick',
    targets: [[2.6, 0], [-2.4, 0.4], [0.3, 2.6], [0.2, -2.6]],
    aim: { dist: 5 },
    frames: 30,
    shots: [9],
    cam: { back: 6.5, side: 3, up: 3 },
    check: (r) => {
      assert.ok(hitCount(r) >= 3, `ring of fire hit ${hitCount(r)} of 4 surrounding dummies`);
      assert.ok(r.peaks.playerRise > 0.3, 'spinning flame kick should be airborne');
    },
  });
  await run({
    id: 'fire_stream',
    targets: [[6, 0], [7, 0.8]],
    frames: 75,
    shots: [24],
    check: (r) => {
      assert.ok(r.peaks.phases.includes('channel'), 'fire stream never channelled');
      assert.ok(r.targets[0].totalDamage > 10, `fire stream dealt only ${r.targets[0].totalDamage}`);
      assert.ok(r.targets[0].hits >= 3, 'fire stream should burn over time (several hits)');
    },
  });
  await run({
    id: 'breath_of_fire',
    targets: [[3.5, 0], [4.5, -1.2]],
    frames: 60,
    shots: [22],
    cam: { back: 5, side: 3.5, up: 2.2 },
    check: (r) => {
      assert.ok(hitCount(r) >= 1 && dealt(r) > 8, `breath of fire dealt ${dealt(r)}`);
    },
  });
  await run({
    id: 'explosive_finisher',
    targets: [[7, 0], [8, 2]],
    frames: 66,
    shots: [26],
    cam: { back: 6, side: 4, up: 3 },
    check: (r) => {
      assert.ok(r.peaks.playerMoved > 3, `finisher leap moved the player only ${r.peaks.playerMoved.toFixed(2)} m`);
      assert.ok(r.targets[0].totalDamage > 20, `finisher detonation dealt ${r.targets[0].totalDamage}`);
      assert.ok(hitCount(r) >= 2, 'detonation should hit both dummies');
    },
    settle: 160,
  });
  await run({
    id: 'fire_lightning',
    targets: [[12, 0], [14, 3], [16, -3]],
    frames: 40,
    shots: [27],
    cam: { back: 5.5, side: 3.5, up: 2.4 },
    check: (r) => {
      assert.ok(r.targets[0].totalDamage > 30, `lightning dealt ${r.targets[0].totalDamage}`);
      assert.ok(hitCount(r) >= 2, 'lightning did not chain to a second dummy');
    },
  });
} finally {
  await finish(h, E, results, shots);
}
