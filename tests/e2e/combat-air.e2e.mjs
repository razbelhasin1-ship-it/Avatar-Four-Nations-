/**
 * Airbending e2e: every castable air technique against weighted sparring
 * dummies — damage, knockback / launches, deflection and redirection of real
 * hostile projectiles, player displacement, channels ending, cleanup.
 * Run: node tests/e2e/combat-air.e2e.mjs   (screenshots → $COMBAT_SHOTS)
 */
import assert from 'node:assert/strict';
import { adv, dealt, finish, hitCount, openArena, trial } from './combat-common.mjs';

const E = 'air';
const h = await openArena(E);
const results = [];
const shots = [];
const run = async (spec) => shots.push(...(await trial(h, E, spec, results)));

try {
  await run({
    id: 'air_palm',
    casts: 3,
    gap: 9,
    frames: 34,
    shots: [5, 27],
    check: (r) => {
      assert.ok(dealt(r) > 0, 'no damage');
      assert.ok(r.targets.some((t) => t.moved > 0.8), 'palm strikes did not knock anyone back');
    },
  });
  await run({
    id: 'air_blast',
    charge: 1,
    frames: 24,
    shots: [8],
    check: (r) => {
      const t = r.targets[0];
      assert.ok(t.totalDamage > 0, 'blast missed the aimed dummy');
      assert.ok(t.maxLaunch > 0 && (t.rise > 0.4 || t.moved > 2), `blast did not launch/hurl the dummy (moved ${t.moved}, rise ${t.rise})`);
    },
  });
  await run({
    id: 'air_sweep',
    targets: [[4, -1.5], [5, 1.8], [3.5, 0]],
    aim: { dist: 6, side: 0, y: 0.8 },
    frames: 26,
    shots: [9],
    check: (r) => {
      assert.ok(hitCount(r) >= 2, 'sweep should hit several dummies');
      assert.ok(r.targets.some((t) => t.knockdowns > 0), 'sweep did not trip anyone');
    },
  });
  await run({
    id: 'air_dash',
    targets: [[6, 3.5]],
    aim: { dist: 10, side: 0 },
    frames: 18,
    shots: [5],
    cam: { back: 6, side: 4, up: 2.4 },
    check: (r) => assert.ok(r.peaks.playerMoved > 6, `dash moved the player only ${r.peaks.playerMoved.toFixed(2)} m`),
  });
  // Air Dash also works in mid-air (jump first).
  await run({
    id: 'air_dash',
    name: 'air_dash_midair',
    targets: [],
    aim: { dist: 10 },
    setup: async (hh) => {
      await hh.eval((g) => {
        g.ctx.input.setVirtual('jump', true);
        window.__ct.advance(1, false);
        g.ctx.input.setVirtual('jump', false);
        window.__ct.advance(7, false);
      });
      const st = await hh.eval((g) => g.debug.bending.player());
      assert.ok(!st.grounded, 'player should be airborne before the dash');
    },
    frames: 16,
    shots: [5],
    cam: { back: 6, side: 4, up: 2.4 },
    check: (r) => assert.ok(r.peaks.playerMoved > 6, `mid-air dash moved the player only ${r.peaks.playerMoved.toFixed(2)} m`),
  });
  // Collision: dashing into a solid stone wall stops at the wall (never passes through).
  await run({
    id: 'air_dash',
    name: 'air_dash_into_wall',
    targets: [],
    aim: { dist: 10 },
    setup: async (hh) => {
      assert.ok((await hh.eval((g) => g.cast('stone_wall', null))).ok, 'could not raise the test wall');
      await adv(hh, 40);
      // Casting turns the bender toward the camera aim; square up to the wall again.
      await hh.eval((g, a) => {
        g.debug.bending.refresh();
        g.faceTowards(a.x, a.z + 10);
      }, { x: 1220, z: -340 });
    },
    frames: 16,
    shots: [6],
    cam: { back: 6, side: 4, up: 2.4 },
    check: (r) => {
      assert.ok(r.peaks.playerMoved < 3.0, `dash went ${r.peaks.playerMoved.toFixed(2)} m — through the wall 3.2 m ahead`);
    },
    settle: 330,
  });
  await run({
    id: 'air_spin_strike',
    targets: [[2.6, 0], [-2.6, 0.3], [0.3, 2.6], [0.2, -2.6]],
    aim: { dist: 5 },
    frames: 24,
    shots: [8],
    cam: { back: 6.5, side: 3, up: 3.2 },
    check: (r) => {
      assert.ok(hitCount(r) >= 3, `spin strike hit ${hitCount(r)} of 4 surrounding dummies`);
      assert.ok(r.targets.filter((t) => t.away > 1).length >= 3, 'spin strike did not push dummies outward');
    },
  });
  // Air Shield: a hostile turret fires at the player; the shield must deflect the bolt.
  const owners = [];
  await run({
    id: 'air_shield',
    targets: [[11, 0]],
    aim: { dist: 6 },
    frames: 60,
    hooks: [10, 16, 20, 24, 28, 32],
    shots: [22],
    during: async (hh, f) => {
      if (f === 10) await hh.eval((g) => g.debug.bending.shootAt(window.__ct.targets[0].id, { speed: 18, damage: 12 }));
      else owners.push(...(await hh.eval((g) => g.debug.bending.projectiles().map((p) => (p.owner === g.game.player.id ? 'player' : 'turret')))));
    },
    check: (r) => {
      assert.ok(r.peaks.phases.includes('channel'), 'shield never channelled');
      const t = r.targets[0];
      const onPlayer = r.events.filter((e) => e.type === 'hit' && e.attacker === t.id);
      assert.equal(onPlayer.length, 0, `the shielded player was hit: ${JSON.stringify(onPlayer)}`);
      assert.ok(owners.includes('player') || t.totalDamage > 0, `bolt was not deflected (owners seen: ${owners.join(',')})`);
    },
    settle: 120,
  });
  await run({
    id: 'air_scooter',
    targets: [],
    aim: { dist: 10 },
    frames: 75,
    hooks: [4, 60],
    shots: [30],
    cam: { back: 6, side: 3, up: 2.4, follow: true },
    during: async (hh, f) => {
      if (f === 4) await hh.eval((g) => g.ctx.input.setVirtualMove(0, 1));
      if (f === 60) await hh.eval((g) => g.ctx.input.setVirtualMove(0, 0));
    },
    check: (r) => {
      assert.ok(r.peaks.phases.includes('channel'), 'scooter never channelled');
      assert.ok(r.peaks.playerMoved > 12, `scooter carried the player only ${r.peaks.playerMoved.toFixed(1)} m`);
    },
    settle: 160,
  });
  // Wind Redirection: catch a bolt in flight and send it back at its owner.
  await run({
    id: 'air_redirect',
    targets: [[12, 0]],
    aim: { dist: 8 },
    setup: async (hh) => {
      await hh.eval((g) => g.debug.bending.shootAt(window.__ct.targets[0].id, { speed: 16, damage: 12 }));
      await adv(hh, 14);
    },
    frames: 40,
    shots: [6],
    check: (r) => {
      const t = r.targets[0];
      const back = r.events.filter((e) => e.type === 'hit' && e.target === t.id);
      assert.ok(back.length > 0 && t.totalDamage > 0, 'redirected bolt did not hit its owner');
      const onPlayer = r.events.filter((e) => e.type === 'hit' && e.attacker === t.id);
      assert.equal(onPlayer.length, 0, 'player was hit despite redirect');
    },
  });
  await run({
    id: 'air_vortex',
    targets: [[7, 0], [9, 1.2]],
    frames: 96,
    shots: [30],
    cam: { back: 6, side: 4, up: 3 },
    check: (r) => {
      assert.ok(dealt(r) > 0, 'vortex dealt no damage');
      assert.ok(r.targets.some((t) => t.rise > 0.8), 'vortex lifted nobody');
      assert.ok(r.targets.some((t) => t.moved > 2), 'vortex did not move anyone');
    },
    settle: 120,
  });
  // Air Jump (passive): with it learned an airbender gets two extra mid-air jumps.
  results.push(
    await (async () => {
      try {
        await h.eval((g, a) => window.__ct.reset(a.x, a.z), { x: 1220, z: -340 });
        const jumps = await h.eval((g) => {
          const ct = window.__ct;
          ct.begin([]);
          const press = () => {
            g.ctx.input.setVirtual('jump', true);
            ct.advance(1, false);
            g.ctx.input.setVirtual('jump', false);
          };
          press();
          ct.advance(8, false);
          press();
          ct.advance(8, false);
          press();
          ct.advance(8, false);
          press();
          ct.advance(60, false);
          return ct.events.filter((e) => e.type === 'jump');
        });
        const doubles = jumps.filter((j) => j.double).length;
        assert.equal(doubles, 2, `expected 2 air jumps with air_jump learned, got ${JSON.stringify(jumps)}`);
        return ['PASS', 'air_jump passive', `${jumps.length} jumps, ${doubles} mid-air`];
      } catch (e) {
        return ['FAIL', 'air_jump passive', e.message];
      }
    })(),
  );
} finally {
  await finish(h, E, results, shots);
}
