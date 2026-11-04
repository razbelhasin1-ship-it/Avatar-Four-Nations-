// Rock Armor (earthbending) and Octopus Form (waterbending): what is drawn is what happens.
// Run: node tests/e2e/armor-octopus.e2e.mjs   (ONLY=armor|octopus runs one half)
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);
const h = await launch({ width: 800, height: 450 });
const ev = (fn, ...a) => h.eval(fn, ...a);
/** Deterministic steps (the real-time loop is stopped), never rendered. */
const step = (n, dt = 1 / 30) => ev((g, n, dt) => { const R = g.ctx.render, r = R.render; R.render = () => {}; try { for (let i = 0; i < n; i++) g.step(1, dt); } finally { R.render = r; } }, n, dt);
const fresh = () => ev((g) => { const p = g.ctx.player; p.chi = p.maxChi; if (p.health) p.health.hp = p.health.maxHp; g.ctx.combat['states'].get(p)?.cooldowns.clear(); });
const tap = async (a) => { await ev((g, a) => g.ctx.input.setVirtual(a, true), a); await step(1); await ev((g, a) => g.ctx.input.setVirtual(a, false), a); await step(1); };
const clearTargets = () => ev((g) => { for (const e of [...g.ctx.entities.all()]) if (e.kind === 'target' || e.team === 'hostile') g.ctx.entities.remove(e); });
const armor = () => ev((g) => g.debug.rockArmor.state());
const plates = () => ev((g) => g.debug.rockArmor.plates());
const sceneCount = (prefix) => ev((g, prefix) => { let n = 0; g.ctx.render.scene.traverse((o) => { if (o.name && o.name.startsWith(prefix) && o.parent) n++; }); return n; }, prefix);

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

try {
  if (run('armor')) {
    console.log('Rock Armor');
    await h.newGame('earth');
    await step(20);
    await ev((g) => { g.setTime(12); g.freezeTime(true); g.learnAll(); g.game.stop(); });
    await step(4);

    await check('slabs come up from the ground and clamp on from the boots to the helmet', async () => {
      await fresh();
      assert.equal((await ev((g) => g.cast('rock_armor'))).ok, true);
      const onAt = {};
      for (let f = 0; f < 90; f++) {
        await step(1, 1 / 60);
        const ps = await plates();
        if (ps) for (const p of ps) if (p.state === 'on' && onAt[p.part] === undefined) onAt[p.part] = f;
        if (ps && ps.every((p) => p.state === 'on')) break;
      }
      assert.equal(Object.keys(onAt).length, 22, `plates on: ${Object.keys(onAt).length}/22`);
      assert.ok(onAt.bootL < onAt.chest && onAt.chest < onAt.helmet, `order boots ${onAt.bootL} < chest ${onAt.chest} < helmet ${onAt.helmet}`);
      assert.ok(onAt.helmet - onAt.bootL >= 20, 'the assembly should be seen (not instant)');
      const st = await ev((g) => g.ctx.player.statuses.map((s) => s.type));
      assert.ok(st.includes('armor') && st.includes('slow'), `statuses ${st}`);
      assert.equal(await sceneCount('rock_armor_'), 22);
    });

    await check('stone fists: earth basic attacks hit 25% harder while armored', async () => {
      const dmg = async () => {
        await fresh();
        const d = await ev((g) => g.debug.bending.spawnTarget(2.2, 0, 9999));
        await ev((g, d) => g.faceTowards(d.x, d.z), d);
        await step(2);
        await ev((g, d) => g.cast('earth_strike', { x: d.x, y: d.y + 1.1, z: d.z }), d);
        await step(25);
        const t = await ev((g, id) => g.debug.bending.target(id), d.id);
        await ev((g, id) => g.ctx.entities.remove(g.ctx.entities.get(id)), d.id);
        await step(45);
        return t.totalDamage;
      };
      const armored = await dmg();
      await ev((g) => g.debug.rockArmor.burst());
      await step(60);
      const bare = await dmg();
      assert.ok(bare > 0, 'the strike should land');
      const ratio = armored / bare;
      assert.ok(ratio > 1.15 && ratio < 1.35, `armored ${armored} vs bare ${bare} (x${ratio.toFixed(2)})`);
    });

    await check('blows crack the stone and knock plates off; spent, it shatters', async () => {
      await fresh();
      await clearTargets();
      await step(240);
      await fresh();
      assert.equal((await ev((g) => g.cast('rock_armor'))).ok, true);
      await step(40);
      const d = await ev((g) => g.debug.bending.spawnTarget(7, 0, 9999));
      let st = await armor();
      assert.equal(st.plates, 22);
      const seen = [];
      for (let i = 0; i < 20 && st.armor; i++) {
        // Keep the bender standing: the half that gets through still hurts.
        await ev((g) => { const hp = g.ctx.player.health; hp.hp = hp.maxHp; });
        await ev((g, id) => g.debug.bending.shootAt(id, { damage: 30, speed: 30 }), d.id);
        await step(14);
        st = await armor();
        seen.push({ integrity: +st.integrity.toFixed(2), plates: st.plates });
        if (i === 4) {
          const ps = await plates();
          assert.ok(ps.some((p) => p.cracked), 'blows should crack plates');
          assert.ok(st.plates < 22, `plates should come off: ${st.plates}`);
          assert.ok(st.integrity < 0.75, `integrity ${st.integrity}`);
        }
      }
      assert.equal(st.armor, false, `the armor should give way: ${JSON.stringify(seen)}`);
      const hp = await ev((g) => g.ctx.player.health.hp);
      assert.ok(hp > 0, 'still standing');
      await step(90);
      assert.equal(await sceneCount('rock_armor_'), 0, 'no plates left behind');
      await clearTargets();
    });

    await check('the burst throws the plates: foes within 4 m are hit, farther ones are not', async () => {
      await fresh();
      await step(240);
      await fresh();
      assert.equal((await ev((g) => g.cast('rock_armor'))).ok, true);
      await step(40);
      const near = await ev((g) => [g.spawnDummy(2.5, 0, 400), g.spawnDummy(2.4, 1.6, 400)].map((d) => d.id));
      const far = await ev((g) => g.spawnDummy(7, 0, 400).id);
      await step(2);
      assert.equal(await ev((g) => g.debug.rockArmor.burst()), true);
      await step(30);
      const hp = await ev((g, ids) => ids.map((id) => g.ctx.entities.get(id)?.health?.hp ?? -1), [...near, far]);
      assert.ok(hp[0] < 400 && hp[1] < 400, `near dummies ${hp}`);
      assert.equal(hp[2], 400, 'a dummy 7 m away is out of the plates\' reach');
      assert.equal((await armor()).armor, false);
      await step(90);
      assert.equal(await sceneCount('rock_armor_'), 0, 'no plates left behind');
      await clearTargets();
    });

    await check('Stone Guard snaps stone cuffs onto the forearms', async () => {
      await fresh();
      assert.equal((await ev((g) => g.cast('stone_guard'))).ok, true);
      await step(12, 1 / 60);
      assert.equal((await armor()).guard, true);
      const cuffs = await ev((g) => { const names = []; g.ctx.player.humanoid.root.traverse((o) => { if (o.name?.startsWith('rock_armor_')) names.push(o.name); }); return names.sort(); });
      assert.deepEqual(cuffs, ['rock_armor_cuffL', 'rock_armor_cuffR', 'rock_armor_fistL', 'rock_armor_fistR']);
      await step(120);
      assert.equal(await sceneCount('rock_armor_'), 0, 'the cuffs fall away');
    });
  }

  if (run('octopus')) {
    console.log('Octopus Form');
    await h.newGame('water');
    await step(20);
    await ev((g) => {
      g.setTime(12);
      g.freezeTime(true);
      g.learnAll();
      g.game.stop();
      // Slot it so it can be pressed again.
      const slots = g.ctx.progression.slotsFor('water');
      if (!slots.includes('octopus_form')) g.ctx.progression.equip('water', 3, 'octopus_form');
    });
    await step(4);
    const tubes0 = await ev((g) => g.ctx.water.fx?.tubes?.activeCount ?? null);
    const os = () => ev((g) => g.debug.octopus.state());

    await check('water rises into a shell and eight tentacles grow out of it', async () => {
      await fresh();
      await ev((g) => g.debug.water.setReserve(60));
      const r0 = await ev((g) => g.ctx.player.waterReserve);
      assert.equal((await ev((g) => g.cast('octopus_form'))).ok, true);
      await step(30);
      const s = await os();
      assert.equal(s.formed, true);
      assert.equal(s.arms.length, await ev((g) => (g.ctx.vfx.quality === 'low' ? 6 : 8)), 'eight tentacles (six on Low)');
      assert.ok(s.arms.every((a) => a.grow === 1), 'every tentacle grown');
      assert.equal(await sceneCount('octopus_shell'), 1);
      const r1 = await ev((g) => g.ctx.player.waterReserve);
      assert.equal(r0 - r1, 30, 'the form is made of the bender\'s water');
    });

    await check('incoming blasts are caught and swatted by the tentacles', async () => {
      const hp0 = await ev((g) => g.ctx.player.health.hp);
      const d = await ev((g) => g.debug.bending.spawnTarget(8, 1, 9999));
      for (let i = 0; i < 3; i++) {
        await ev((g, id) => g.debug.bending.shootAt(id, { damage: 14, speed: 22 }), d.id);
        await step(10);
      }
      const s = await os();
      assert.ok(s.swats + s.shellCatches >= 3, `stopped ${s.swats} + ${s.shellCatches}`);
      assert.ok(s.swats >= 2, `the tentacles should do the catching: ${s.swats}`);
      assert.equal(await ev((g) => g.ctx.player.health.hp), hp0, 'no blast got through');
      await clearTargets();
    });

    await check('a foe within reach is lashed when the tentacle gets there; blows do not break the form', async () => {
      const id = await ev((g) => g.debug.enemies.spawn('fire_soldier', 3, 0.5, { aware: false, level: 2 })?.id ?? null);
      const hp0 = await ev((g, id) => g.ctx.entities.get(id).health.hp, id);
      const s0 = await os();
      await step(12);
      const s1 = await os();
      assert.ok(s1.strikes > s0.strikes, 'a tentacle should strike');
      assert.ok(s1.landed > s0.landed, `the lash should land (${s1.landed})`);
      assert.ok((await ev((g, id) => g.ctx.entities.get(id)?.health?.hp ?? 0, id)) < hp0, 'the foe is hurt');
      // A heavy blow on the bender does not end the stance.
      await ev((g) => g.ctx.combat.applyHit(null, g.ctx.player, { damage: 5, stagger: 90 }));
      await step(2);
      assert.equal(await ev((g) => g.debug.octopus.active()), true, 'the form holds');
      await clearTargets();
    });

    await check('Attack orders a double lash at a foe just beyond the tentacles\' own reach', async () => {
      // 4.1 m: too far for the automatic lashes, close enough for an ordered one.
      const id = await ev((g) => g.debug.enemies.spawn('fire_soldier', 4.1, 0, { aware: false, level: 2 })?.id ?? null);
      await step(25);
      const s0 = await os();
      const hp0 = await ev((g, id) => g.ctx.entities.get(id).health.hp, id);
      await tap('attack');
      await step(2);
      const s1 = await os();
      assert.equal(s0.strikes, s1.strikes - 2, `strikes ${s0.strikes} -> ${s1.strikes}`);
      await step(12);
      const s2 = await os();
      assert.ok(s2.landed > s1.landed, `the ordered lashes land (${s1.landed} -> ${s2.landed})`);
      assert.ok((await ev((g, id) => g.ctx.entities.get(id)?.health?.hp ?? 0, id)) < hp0, 'the foe is hurt');
      await clearTargets();
    });

    await check('pressing the form again lets the water fall; half comes back; nothing is left over', async () => {
      const r0 = await ev((g) => g.ctx.player.waterReserve);
      const slot = await ev((g) => g.ctx.progression.slotsFor('water').indexOf('octopus_form'));
      await tap(['ability1', 'ability2', 'ability3', 'ability4'][slot]);
      assert.equal(await ev((g) => g.debug.octopus.active()), false, 'the water falls at once');
      await step(15);
      const r1 = await ev((g) => g.ctx.player.waterReserve);
      assert.equal(r1 - r0, 15, `half the water returns (${r0} -> ${r1})`);
      await step(60);
      assert.equal(await sceneCount('octopus_'), 0, 'shell and pool removed');
      const tubes = await ev((g) => g.ctx.water.fx?.tubes?.activeCount ?? null);
      if (tubes0 !== null && tubes !== null) assert.ok(tubes <= tubes0 + 1, `water tubes released (${tubes0} -> ${tubes})`);
    });
  }

  await check('no console errors', async () => {
    assert.deepEqual(h.errors, []);
  });
} finally {
  await h.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
