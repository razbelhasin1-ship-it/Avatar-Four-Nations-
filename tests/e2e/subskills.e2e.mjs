// Specialized bending (lavabending, spiritual projection, bloodbending), their unlock quests, the two new
// moves per element, saves. Run: node tests/e2e/subskills.e2e.mjs   (SHOTS=1 writes screenshots/sub-elements/)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.SHOTS === '1';
/** ONLY=lava,proj,blood,heart,silent,puppet,moves runs a subset. */
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);
const OUT = new URL('../../screenshots/sub-elements/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });
const h = await launch({ width: 960, height: 540 });
const ev = (fn, ...a) => h.eval(fn, ...a);
const fast = (n) => ev((g, n) => { const R = g.ctx.render, r = R.render; R.render = () => {}; try { for (let i = 0; i < n; i++) g.step(1); } finally { R.render = r; } }, n);
const shot = async (name) => { if (!SHOTS) return; await h.step(3); await h.shot(`${OUT}${name}.jpg`, { quality: 84, timeout: 120000 }); };
const dlg = () => ev((g) => g.debug.training.dialogue());
const choose = (m) => ev((g, m) => g.debug.training.choose(m), m);
const clickAll = async () => { for (let i = 0; i < 10; i++) { if (!(await choose(0))) break; await fast(2); } };
const tap = async (a) => { await ev((g, a) => g.ctx.input.setVirtual(a, true), a); await fast(2); await ev((g, a) => g.ctx.input.setVirtual(a, false), a); await fast(2); };
const hold = async (a, frames) => { await ev((g, a) => g.ctx.input.setVirtual(a, true), a); await fast(frames); await ev((g, a) => g.ctx.input.setVirtual(a, false), a); };
const place = (n) => ev((g, n) => g.debug.subquests.place(n), n);
const qs = () => ev((g) => g.debug.subquests.state());
const castAt = (id, p) => ev((g, id, p) => { const pl = g.ctx.player; pl.chi = 100; pl.waterReserve = pl.maxWaterReserve; g.ctx.combat['states'].get(pl)?.cooldowns.clear(); return g.cast(id, p); }, id, p);
const spawn = (arch, dist, side = 0, level = 2) => ev((g, a, d, s, l) => g.debug.enemies.spawn(a, d, s, { aware: false, level: l })?.id ?? null, arch, dist, side, level);
const aimAt = (id) => ev((g, id) => { const e = g.ctx.entities.get(id); g.faceTowards(e.position.x, e.position.z); g.ctx.player.aimPoint3.copy(e.aimPoint()); return e.aimPoint(); }, id);

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
  if (run('lava')) {
  console.log('Lavabending');
  await h.newGame('earth');
  await fast(20);
  await ev((g) => { g.setTime(12); g.freezeTime(true); });
  const ahead = (d) => ev((g, d) => { const p = g.ctx.player; return { x: p.position.x + Math.sin(p.yaw) * d, y: p.position.y, z: p.position.z + Math.cos(p.yaw) * d }; }, d);
  await check('locked before its quest', async () => {
    const r = await castAt('lava_melt', await ahead(6));
    assert.equal(r.ok, false);
  });
  await ev((g) => g.debug.subskills.unlock('lava'));
  await check('melts earth into lava; ice/snow and water refuse', async () => {
    const at = await ahead(6);
    assert.equal((await ev((g, a) => g.debug.lava.meltable(a.x, a.z), at)).ok, true);
    assert.equal((await castAt('lava_melt', at)).ok, true);
    await fast(25);
    assert.ok((await ev((g) => g.debug.lava.state().patches.length)) >= 1);
    assert.equal((await ev((g) => g.debug.lava.meltable(-350, -1615))).ok, false, 'Northern Water Tribe snow');
    const water = await ev((g) => { const w = g.waterNearby?.(60); const s = Array.isArray(w) ? w.find((x) => x.type !== 'snow') : null; return s ? s.position ?? s.pos ?? null : null; });
    if (water) assert.equal((await ev((g, w) => g.debug.lava.meltable(w.x ?? w[0], w.z ?? w[2]), water)).ok, false, 'water');
  });
  await shot('lava_01_melt');
  await check('standing in lava hurts, never lethally; it cools into stone', async () => {
    const at = await ahead(6);
    const hp0 = await ev((g) => g.ctx.player.health.hp);
    await ev((g, a) => g.teleport(a.x, a.z), at);
    await fast(20);
    assert.ok((await ev((g) => g.ctx.player.health.hp)) < hp0);
    await ev((g, a) => g.teleport(a.x - 8, a.z - 8), at);
    await fast(5);
    await ev((g, a) => g.faceTowards(a.x, a.z), at);
    assert.equal((await castAt('lava_cool', at)).ok, true);
    await fast(15);
    assert.ok((await ev((g) => g.debug.lava.state().patches.every((p) => p.state === 'stone'))));
  });
  await shot('lava_02_cooled_stone');
  await check('lava expires into stone on its own', async () => {
    await ev((g) => { g.debug.lava.clear(); g.debug.lava.spawn(undefined, undefined, 2, 1.5); });
    await fast(70);
    assert.ok(await ev((g) => g.debug.lava.state().patches.every((p) => p.state === 'stone')));
  });
  await check('every lava move casts; Eruption only in the Avatar State', async () => {
    const d = await ev((g) => g.spawnDummy(9, 0, 400));
    const dp = { x: d.x, y: d.y + 1.2, z: d.z };
    for (const id of ['lava_disc', 'lava_pool', 'lava_stream', 'lava_moat']) {
      await ev((g) => g.debug.lava.clear());
      const r = await castAt(id, dp);
      assert.equal(r.ok, true, `${id}: ${r.message}`);
      await h.step(10);
      await shot(`lava_03_${id}`);
      await fast(30);
    }
    assert.equal((await castAt('lava_eruption', await ahead(14))).ok, false);
    await ev((g) => g.ctx.avatar.activate());
    await fast(30);
    assert.equal((await castAt('lava_eruption', await ahead(14))).ok, true);
    await fast(70);
    await shot('lava_04_eruption');
    await ev((g) => g.ctx.avatar.deactivate(true));
  });
  await check('reduce intense effects keeps lava (calm)', async () => {
    await ev((g) => { g.debug.lava.clear(); g.setting('gameplay.reduceIntenseEffects', true); });
    assert.equal((await castAt('lava_melt', await ahead(6))).ok, true);
    await fast(20);
    await shot('lava_05_reduced_effects');
    await ev((g) => g.setting('gameplay.reduceIntenseEffects', false));
  });

  }
  if (run('proj')) {
  console.log('Spiritual projection');
  await h.newGame('air');
  await fast(20);
  await ev((g) => { g.setTime(16); g.freezeTime(true); g.debug.subskills.unlock('projection'); });
  await check('Spirit Sight refused unless projecting', async () => {
    assert.equal((await castAt('spirit_sight', null)).ok, false);
  });
  await check('project; no bending while away; the camera follows the spirit', async () => {
    await ev((g) => g.debug.projection.force());
    await fast(10);
    const s = await ev((g) => g.debug.projection.state());
    assert.equal(s.state, 'projecting');
    assert.equal(s.camFollowsSpirit, true);
    assert.equal((await castAt('air_palm', null)).ok, false);
    await ev((g) => g.ctx.input.setVirtual('forward', true));
    await fast(40);
    await ev((g) => g.ctx.input.setVirtual('forward', false));
    const s2 = await ev((g) => g.debug.projection.state());
    assert.ok(Math.hypot(s2.spirit[0] - s2.body[0], s2.spirit[2] - s2.body[2]) > 3, 'spirit moved away from the body');
    await shot('proj_01_spirit_view');
    await ev((g) => { const b = g.ctx.player.position; g.freeCamera({ x: b.x + 3, y: b.y + 2, z: b.z + 3 }, { x: b.x, y: b.y + 0.8, z: b.z }); });
    await shot('proj_02_body_meditating');
    await ev((g) => g.freeCamera(null));
  });
  await check('return along the streak of light', async () => {
    await ev((g) => g.debug.projection.returnNow());
    await fast(10);
    await shot('proj_03_return_streak');
    await fast(90);
    assert.equal((await ev((g) => g.debug.projection.state())).state, 'idle');
  });
  await check('a hit on the body snaps the spirit back; the hit lands', async () => {
    await ev((g) => g.debug.projection.force());
    await fast(5);
    const hp = await ev((g) => g.ctx.player.health.hp);
    await ev((g) => g.ctx.combat.applyHit(null, g.ctx.player, { attacker: null, damage: 10, element: 'fire', techniqueId: 'test' }));
    await fast(3);
    const s = await ev((g) => g.debug.projection.state());
    assert.equal(s.state, 'idle');
    assert.equal(s.lastEnd, 'struck');
    assert.ok((await ev((g) => g.ctx.player.health.hp)) < hp);
  });

  }
  if (run('blood')) {
  console.log('Bloodbending');
  await h.newGame('water');
  await fast(20);
  await ev((g) => { g.freezeTime(true); g.setTime(22); g.debug.blood.sys.scriptedOk = true; g.debug.subskills.unlock('blood'); g.debug.subskills.setMoonPhase(2); g.ctx.progression.addProficiency('water', 400); });
  const e1 = await spawn('fire_soldier', 7, 0, 3);
  await fast(5);
  await aimAt(e1);
  await check('needs the full moon in the sky', async () => {
    assert.equal((await castAt('blood_hold', await aimAt(e1))).ok, false);
  });
  await ev((g) => g.debug.subskills.fullMoonNight(22));
  await check('holds a living body; the held body cannot bend; strain rises', async () => {
    assert.equal((await castAt('blood_hold', await aimAt(e1))).ok, true);
    await fast(10);
    const s = await ev((g) => g.debug.blood.state());
    assert.equal(s.holds.length, 1);
    assert.equal(await ev((g, id) => g.ctx.combat.tryCast(g.ctx.entities.get(id), 'fire_jab', {}).ok, e1), false);
    assert.ok((await ev((g) => g.debug.subskills.state().strain)) > 0);
    await ev((g, id) => { const e = g.ctx.entities.get(id); const p = g.ctx.player; g.freeCamera({ x: p.position.x - 3, y: p.position.y + 2.2, z: p.position.z - 2 }, { x: e.position.x, y: e.position.y + 1.2, z: e.position.z }); }, e1);
    await shot('blood_01_held_under_moon');
    await ev((g) => g.freeCamera(null));
  });
  await check('puppet walks the body; redirect turns its attack on another hostile only', async () => {
    const p0 = await ev((g, id) => g.ctx.entities.get(id).position.toArray(), e1);
    assert.equal((await castAt('blood_puppet', null)).ok, true);
    await hold('right', 40);
    const p1 = await ev((g, id) => g.ctx.entities.get(id).position.toArray(), e1);
    assert.ok(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 1);
    const e2 = await spawn('fire_soldier', 9, 3, 3);
    await fast(5);
    const hp2 = await ev((g, id) => g.ctx.entities.get(id).health.hp, e2);
    const hp1 = await ev((g, id) => g.ctx.entities.get(id).health.hp, e1);
    assert.equal((await castAt('blood_redirect', null)).ok, true);
    await fast(5);
    assert.ok((await ev((g, id) => g.ctx.entities.get(id).health.hp, e2)) < hp2, 'other hostile hit');
    assert.equal(await ev((g, id) => g.ctx.entities.get(id).health.hp, e1), hp1, 'the held body is never harmed by the hold');
  });
  await check('every hold ends at sunrise', async () => {
    await ev((g) => g.debug.subskills.setHour(5.95));
    await fast(1);
    await ev((g) => { g.ctx.world.sky.secondsPerHour = 5; });
    await fast(20);
    await ev((g) => g.freezeTime(true));
    const s = await ev((g) => g.debug.blood.state());
    assert.equal(s.holds.length, 0);
    assert.equal(s.stats.released.sunrise, 1);
  });
  await check('a waterbender of equal or higher skill breaks free', async () => {
    await ev((g) => { g.debug.enemies.killAll?.(); g.debug.subskills.fullMoonNight(23); });
    const w1 = await spawn('water_pirate', 7, 0, 60);
    await fast(5);
    assert.equal((await castAt('blood_hold', await aimAt(w1))).ok, true);
    await fast(70);
    assert.equal((await ev((g) => g.debug.blood.state())).stats.released.resisted, 1);
  });
  await check('pain breaks the bender\'s hold; the Avatar State breaks one on the Avatar', async () => {
    const e3 = await spawn('earth_bandit', 6, -2, 2);
    await fast(5);
    assert.equal((await castAt('blood_hold', await aimAt(e3))).ok, true);
    await ev((g) => g.ctx.combat.applyHit(null, g.ctx.player, { attacker: null, damage: 3, element: 'fire', techniqueId: 'test' }));
    await fast(2);
    assert.equal((await ev((g) => g.debug.blood.state())).stats.released.concentration, 1);
    assert.equal(await ev((g, id) => g.debug.blood.holdPlayer(id), e3), true);
    assert.equal((await castAt('water_whip', null)).ok, false, 'a held Avatar cannot bend');
    await ev((g) => g.ctx.avatar.activate());
    await fast(3);
    assert.equal((await ev((g) => g.debug.blood.state())).playerHeld, false);
    await ev((g) => g.ctx.avatar.deactivate(true));
  });
  await check('Moral Strain stages; Breaking locks until an elder; the vow locks it', async () => {
    for (const [v, st] of [[30, 'unease'], [60, 'dark'], [90, 'breaking']]) {
      assert.equal(await ev((g, v) => g.debug.subskills.setStrain(v), v), st);
      await fast(3);
      await shot(`blood_02_strain_${st}`);
    }
    assert.equal((await ev((g) => g.debug.blood.state())).gate.reason, 'locked');
    await ev((g) => g.debug.subskills.elderMeditation());
    assert.equal((await ev((g) => g.debug.blood.state())).gate, null);
    await ev((g) => g.debug.subskills.vow());
    assert.equal((await ev((g) => g.debug.blood.state())).gate.reason, 'locked');
  });
  await check('Legend of Korra moves are absent with their flags off', async () => {
    assert.equal(await ev((g) => g.ctx.progression.knows('blood_psychic') || g.ctx.progression.knows('blood_lift')), false);
    assert.equal((await castAt('blood_lift', null)).ok, false);
  });
  await check('save and load keep the branch, the strain and the vow', async () => {
    const before = await ev((g) => g.debug.subskills.state());
    await ev((g) => g.save('slot3'));
    await ev((g) => g.loadGame('slot3'));
    await fast(20);
    const after = await ev((g) => g.debug.subskills.state());
    assert.deepEqual(after.unlocked, before.unlocked);
    assert.equal(after.vow, 'kept');
    assert.ok(Math.abs(after.strain - before.strain) < 1);
    assert.equal(after.moon.night, before.moon.night);
  });

  }
  if (run('heart')) {
  console.log('The Heart of the Mountain');
  await h.newGame('earth');
  await fast(20);
  await ev((g) => { g.setTime(12); g.freezeTime(true); g.masterAll(); });
  await fast(90);
  await clickAll();
  await check('starts after mastering Earth; plays to the end; unlocks lavabending', async () => {
    assert.equal((await qs()).heart, 'legends');
    await ev((g) => g.ctx.events.emit('dialogue:ended', { npcId: 'master_lien', dialogueId: 'test' }));
    await fast(2);
    await clickAll();
    assert.equal((await qs()).heart, 'descend');
    await ev((g) => g.teleport(-1560, 690));
    await fast(90);
    const mouth = await place('tunnelMouth');
    await ev((g, m) => { g.teleport(m.x + 14, m.z + 6, m.y); g.faceTowards(m.x, m.z); }, mouth);
    await fast(20);
    await shot('quest_lava_01_tunnels_outside');
    await ev((g, m) => g.teleport(m.x, m.z, m.y + 0.2), mouth);
    await fast(20);
    assert.equal((await qs()).heart, 'flow');
    const flow = await place('flow');
    await ev((g, f) => { g.teleport(f.x, f.z, f.y + 0.2); g.faceTowards(f.x - 10, f.z); }, flow);
    await fast(10);
    await shot('quest_lava_02_flow');
    const fa = { x: flow.x - 3.8, y: flow.y, z: flow.z };
    await castAt('stone_wall', fa);
    await fast(30);
    await castAt('earth_pillar', fa);
    await fast(30);
    assert.equal((await qs()).heart, 'wave');
    const wave = await place('wave');
    await ev((g, w) => { g.teleport(w.x, w.z, w.y + 0.2); g.faceTowards(w.x - 10, w.z); }, wave);
    await fast(12);
    await clickAll();
    await fast(20);
    await shot('quest_lava_03_wave');
    const s = await qs();
    assert.equal(s.wave?.state, 'rolling');
    await castAt('lava_cool', { x: -1620 + s.wave.u + 1, y: wave.y, z: wave.z });
    await fast(30);
    await clickAll();
    await shot('quest_lava_04_wave_cooled');
    assert.equal((await qs()).heart, 'melt');
    const plug = await place('plug');
    await ev((g, p) => { g.teleport(p.x + 1, p.z, p.y + 0.2); g.faceTowards(p.x - 10, p.z); }, plug);
    await fast(10);
    await castAt('lava_melt', { x: plug.x - 2.2, y: plug.y + 1, z: plug.z });
    await fast(30);
    assert.equal((await qs()).heart, 'trial');
    const trial = await place('trial');
    await ev((g, p) => { g.teleport(p.x + 4, p.z, p.y + 0.2); g.faceTowards(p.x - 10, p.z); }, trial);
    await fast(12);
    await clickAll();
    for (const id of ['lava_disc', 'lava_pool', 'lava_stream', 'lava_moat']) {
      const d = await ev((g) => { const e = [...g.ctx.entities.all()].find((e) => e.kind === 'target'); return e ? e.aimPoint() : null; });
      assert.equal((await castAt(id, d)).ok, true, id);
      await fast(40);
    }
    await shot('quest_lava_05_trial');
    await fast(30);
    assert.equal(await ev((g) => g.ctx.quests.isComplete('sq_heart_of_the_mountain')), true);
    assert.ok((await ev((g) => g.debug.subskills.state().unlocked)).includes('lava'));
  });

  }
  if (run('silent')) {
  console.log('The Silent Mind');
  await h.newGame('air');
  await fast(20);
  await ev((g) => { g.setTime(10); g.freezeTime(true); g.masterAll(); });
  await fast(60);
  await clickAll();
  await check('plays to the end and unlocks spiritual projection', async () => {
    assert.equal((await qs()).silent, 'tenzo');
    await ev((g) => g.ctx.events.emit('dialogue:ended', { npcId: 'master_tenzo', dialogueId: 'test' }));
    await fast(2);
    await clickAll();
    const s = await place('sanctuary');
    await ev((g, s) => g.teleport(s.x, s.z, s.y + 0.3), s);
    await fast(30);
    await tap('interact');
    await hold('interact', 200);
    await fast(4);
    await clickAll();
    assert.equal((await qs()).silent, 'project');
    await fast(10);
    await hold('ability1', 100);
    await fast(10);
    assert.equal((await ev((g) => g.debug.projection.state())).state, 'projecting');
    await fast(20);
    const v = await place('vault');
    assert.ok(v, 'sealed vault built');
    await ev((g, v) => g.debug.projection.moveTo(v.x + 0.5, v.y + 0.3, v.z), v);
    await fast(6);
    await shot('quest_proj_01_spirit_through_wall');
    await tap('ability1');
    await fast(10);
    await shot('quest_proj_02_spirit_sight');
    assert.equal(await ev((g) => g.ctx.quests.hasFlag('sm_spirit_found')), true);
    await tap('ability4');
    await fast(100);
    assert.equal(await ev((g) => g.ctx.quests.isComplete('sq_silent_mind')), true);
    assert.ok((await ev((g) => g.debug.subskills.state().unlocked)).includes('projection'));
  });

  }
  if (run('puppet')) {
  for (const refuse of [false, true]) {
    console.log(`The Puppetmaster (${refuse ? 'refusal path' : 'bloodbender path'})`);
    await h.newGame('water');
    await fast(20);
    await ev((g) => { g.setTime(10); g.freezeTime(true); g.masterAll(); });
    await fast(60);
    await clickAll();
    await check(refuse ? 'refusing does not dead-end; Hama can teach it from her cell' : 'plays to the end; the forced first use; the vow', async () => {
      assert.equal((await qs()).puppet, 'village');
      const inn = await place('inn');
      await ev((g, p) => g.teleport(p.x + 2, p.z + 9), inn);
      await fast(80);
      if (!refuse) await shot('quest_blood_01_village');
      await ev((g) => g.ctx.npcs.talk(g.ctx.npcs.get('sq_hama')));
      await fast(2);
      await choose('The South');
      await fast(2);
      await clickAll();
      for (const [x, z] of [[-1794.5, 805.4], [-1786, 805.6]]) {
        await ev((g, x, z) => g.teleport(x, z + 1.2), x, z);
        await fast(12);
        await tap('interact');
        await fast(4);
        await clickAll();
      }
      assert.equal((await qs()).puppet, 'lessons');
      await ev((g) => { g.setElement('water'); g.ctx.player.chi = 100; });
      await ev((g) => g.cast('water_moisture'));
      await fast(30);
      await clickAll();
      assert.equal((await qs()).puppet, 'fullmoon');
      await ev((g) => g.ctx.npcs.talk(g.ctx.npcs.get('sq_hama')));
      await fast(2);
      await choose('be there');
      await fast(4);
      assert.equal((await ev((g) => g.debug.subskills.state().moon)).fullUp, true);
      const cl = await place('clearing');
      await ev((g, c) => g.teleport(c.x - 4, c.z), cl);
      await fast(10);
      if (!refuse) await shot('quest_blood_02_hama_reveal');
      await clickAll();
      await fast(10);
      assert.equal((await ev((g) => g.debug.blood.state())).playerHeld, true);
      if (!refuse) await shot('quest_blood_03_hama_holds_you');
      for (let i = 0; i < 14; i++) { await tap('attack'); await tap('jump'); }
      await fast(4);
      assert.equal((await qs()).scene, 'allies');
      await clickAll();
      await fast(20);
      if (!refuse) await shot('quest_blood_04_hama_holds_allies');
      if (!refuse) {
        const hp = await ev((g) => { const s = g.debug.subquests.state(); const e = g.ctx.entities.get(s.hama.id); g.faceTowards(e.position.x, e.position.z); g.ctx.player.aimPoint3.copy(e.aimPoint()); return e.aimPoint(); });
        assert.equal((await ev((g, p) => { g.ctx.player.chi = 100; return g.cast('blood_hold', p); }, hp)).ok, true);
        await fast(6);
        await shot('quest_blood_05_you_hold_hama');
      } else {
        await ev((g) => g.ctx.avatar.activate());
        await fast(10);
      }
      await clickAll();
      await fast(20);
      if (refuse) await ev((g) => g.ctx.avatar.deactivate(true));
      assert.equal((await qs()).puppet, 'free');
      const pr = await place('prison');
      await ev((g, p) => g.teleport(p.x - 2.5, p.z), pr);
      await fast(15);
      await tap('interact');
      await fast(10);
      if (!refuse) {
        await choose(0);
        await fast(2);
        await choose('Vow');
      } else await clickAll();
      await fast(10);
      assert.equal(await ev((g) => g.ctx.quests.isComplete('sq_puppetmaster')), true);
      const ss = await ev((g) => g.debug.subskills.state());
      if (!refuse) {
        assert.ok(ss.unlocked.includes('blood'));
        assert.equal(ss.vow, 'kept');
        assert.equal(ss.strainSeen, true);
      } else {
        assert.equal(ss.unlocked.includes('blood'), false, 'refusing leaves it locked');
        const lk = await place('lockup');
        await ev((g, p) => g.teleport(p.x + 2, p.z - 3), lk);
        await fast(40);
        await ev((g) => g.debug.subskills.fullMoonNight(22));
        await ev((g) => g.ctx.npcs.talk(g.ctx.npcs.get('sq_hama_held')));
        await fast(2);
        await choose('Teach me');
        await fast(4);
        await clickAll();
        await fast(10);
        assert.ok((await ev((g) => g.debug.subskills.state().unlocked)).includes('blood'));
      }
    });
  }

  }
  if (run('moves')) {
  console.log('Two new moves per element');
  await h.newGame('earth');
  await fast(20);
  await ev((g) => { g.setTime(11); g.freezeTime(true); g.unlockAllElements(); g.learnAll(); });
  const p0 = await ev((g) => g.ctx.player.position.toArray());
  const yaw0 = await ev((g) => g.ctx.player.yaw);
  for (const [el, id] of [['earth', 'earth_grip'], ['earth', 'stone_gloves'], ['fire', 'fire_whip'], ['fire', 'dancing_dragon'], ['air', 'air_swipe'], ['air', 'air_suction'], ['water', 'octopus_form'], ['water', 'ice_prison']]) {
    await check(`${id} works on a live foe`, async () => {
      await ev((g, el) => { g.debug.enemies.killAll?.(); g.setElement(el); }, el);
      await fast(130);
      const eid = await ev((g, p0, id, y0) => { g.teleport(p0[0], p0[2]); g.faceTowards(p0[0] + Math.sin(y0) * 10, p0[2] + Math.cos(y0) * 10); return g.debug.enemies.spawn('fire_soldier', id === 'octopus_form' ? 3 : 8, 0, { aware: false, level: 2 })?.id ?? null; }, p0, id, yaw0);
      await fast(6);
      const before = await ev((g, eid) => { const e = g.ctx.entities.get(eid); g.faceTowards(e.position.x, e.position.z); g.ctx.player.aimPoint3.copy(e.aimPoint()); return { hp: e.health.hp, pos: e.position.toArray() }; }, eid);
      const r = await castAt(id, await ev((g, eid) => g.ctx.entities.get(eid).aimPoint(), eid));
      assert.equal(r.ok, true, r.message ?? r.reason);
      await h.step(id === 'dancing_dragon' ? 16 : id === 'octopus_form' ? 18 : 9);
      await shot(`moves_${id}`);
      await fast(35);
      const after = await ev((g, eid) => { const e = g.ctx.entities.get(eid); return { hp: e.health.hp, pos: e.position.toArray(), st: e.statuses.map((s) => s.type) }; }, eid);
      const effect = after.hp < before.hp || after.st.length > 0;
      assert.ok(effect, `${id}: no effect (hp ${before.hp} -> ${after.hp})`);
    });
  }

  }
  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 3).join(' | '));
  });
} finally {
  await h.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
