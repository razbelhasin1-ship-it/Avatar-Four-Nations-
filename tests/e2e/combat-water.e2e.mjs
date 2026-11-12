/**
 * Waterbending combo e2e: the full five-strike Water Whip chain against weighted sparring dummies,
 * with the bender's water in the reserve (the meadow has no water nearby). The fifth strike,
 * Crashing Wave, must draw its extra water for real (the reserve drops), knock down and soak
 * dummies across a wide front, miss what is far beyond it, and spill into a puddle that can be
 * bent again; everything it made must clean up.
 * Run: node tests/e2e/combat-water.e2e.mjs   (screenshots → $COMBAT_SHOTS)
 */
import assert from 'node:assert/strict';
import { finish, openArena, since, targetDamage, trial } from './combat-common.mjs';

const E = 'water';
const h = await openArena(E);
const results = [];
const shots = [];
const run = async (spec) => shots.push(...(await trial(h, E, spec, results)));

try {
  let before = [];
  let reserveBefore = 0;
  await run({
    id: 'water_whip',
    name: 'water_whip five strikes',
    casts: 5,
    gap: 12,
    targets: [[5, 0.3], [6, -2.4], [5.5, 2.6], [15, 0.3]],
    frames: 100,
    shots: [56, 62, 70],
    hooks: [47, 48],
    setup: async (hh) => {
      await hh.eval((g) => g.debug.water.setReserve(30));
    },
    during: async (hh, frame) => {
      if (frame === 47) reserveBefore = await hh.eval((g) => g.game.player.waterReserve);
      if (frame === 48) before = await targetDamage(hh);
    },
    check: async (r, hh) => {
      assert.equal(r.casts.length, 5, 'expected the full five-strike chain');
      for (const c of r.casts) assert.ok(c.water && c.water.amount > 0, `a strike went without water: ${JSON.stringify(c)}`);
      const d = since(r, before);
      const struck = d.slice(0, 3).filter((x) => x > 10).length;
      assert.ok(struck >= 2, `Crashing Wave should hit across a wide front (finisher damage ${d.map((x) => x.toFixed(0))})`);
      assert.equal(d[3], 0, 'the dummy far beyond the wave stays dry');
      const reserveAfter = await hh.eval((g) => g.game.player.waterReserve);
      // The wave takes 4 + 6 units; earlier lashes give back part of theirs meanwhile (+1.6 each), and a
      // plain fifth lash could not take more than 4: a drop past 6 means the extra was really drawn.
      assert.ok(reserveBefore - reserveAfter >= 6, `the wave should draw its extra water for real (reserve ${reserveBefore.toFixed(1)} → ${reserveAfter.toFixed(1)})`);
      const puddles = await hh.eval((g) => g.debug.water.sources(25).filter((s) => s.type === 'puddle'));
      assert.ok(puddles.length >= 1, 'the wave should spill into a puddle that can be bent again');
    },
  });
} finally {
  await finish(h, E, results, shots);
}
