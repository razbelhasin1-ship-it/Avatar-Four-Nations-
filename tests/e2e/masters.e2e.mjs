/**
 * Masters & training E2E (h.step deterministic simulation):
 *  1. a full lesson through its challenge (Hunter Akka · Ice Shards target practice): dialogue → demo →
 *     challenge → technique learned, equipped, immediately castable, still known after save/load;
 *  2. element awakening for a non-start element at its first master (Master Lien → earthbending);
 *  3. the Mastery Trial is refused before the requirements and accepted after (Master Siku);
 *  4. the Elements Sphere story moment (spirit vision + journal note) after debug-mastering everything.
 * Run: node tests/e2e/masters.e2e.mjs   (SHOTS=dir to save screenshots)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.SHOTS || '';
// One dev server; every check gets its own browser (memory isolation on busy shared machines).
const base = await launch({ width: 960, height: 540 });
let h = base;
let crashed = false;
const watch = () => {
  crashed = false;
  h.page.on('crash', () => {
    crashed = true;
    console.log('!! page crashed');
  });
};
watch();
/** Fresh browser + campaign for a check. */
async function fresh(element) {
  if (h === base) await base.page.context().browser()?.close().catch(() => {});
  else await h.close().catch(() => {});
  h = await launch({ url: base.url, width: 960, height: 540 });
  watch();
  await h.newGame(element);
  await fast(true);
}
/** Evaluate with a deadline (a crashed renderer never answers). */
function withTimeout(p, ms = 240000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(crashed ? 'renderer crashed' : 'evaluate timeout')), ms))]);
}
const results = [];
const t0 = Date.now();
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
let checkNo = 0;
const check = async (name, fn) => {
  checkNo++;
  if (ONLY && !ONLY.includes(checkNo)) return;
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${name}`);
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const shot = async (name) => {
  if (!SHOTS) return;
  try {
    await h.eval((g) => g.setting('graphics.renderScale', 0.75));
    await h.step(1);
    await h.shot(`${SHOTS}/${name}.png`, { timeout: 90000 });
    await h.eval((g) => g.setting('graphics.renderScale', 0.3));
  } catch (e) {
    console.log('screenshot failed', name, e.message.split('\n')[0]);
  }
};
const tr = (fn, ...a) => withTimeout(h.eval(fn, ...a));

/** Run the current challenge's targets down with real casts of `tech` (walking into range like a player would). */
async function breakTargets(tech, maxRounds = 60) {
  for (let round = 0; round < maxRounds; round++) {
    const st = await tr((g) => g.debug.training.state());
    if (!st || st.phase !== 'running') return st;
    const t = st.info.targets.find((x) => !x.broken && x.role !== 'decoy');
    if (!t) return st;
    await tr((g, t) => {
      const p = g.game.player.position;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > 7.5) g.teleport(t.x + ((p.x - t.x) / d) * 6.5, t.z + ((p.z - t.z) / d) * 6.5, t.y);
      g.faceTowards(t.x, t.z);
    }, t);
    const r = await tr((g, t, id) => g.cast(id, { x: t.x, y: t.y + 1.4, z: t.z }), t, tech);
    if (!r.ok && r.reason !== 'busy' && r.reason !== 'cooldown') throw new Error('cast failed: ' + JSON.stringify(r));
    await h.step(r.ok ? 24 : r.reason === 'cooldown' ? 20 : 8);
  }
  return tr((g) => g.debug.training.state());
}

/** Low render cost while simulating (screenshots restore it). */
const fast = (on) => h.eval((g, on) => g.setting('graphics.renderScale', on ? 0.3 : 0.75), on);
/** Advance simulated seconds with coarse steps (streaming / waiting). */
const wait = (sec) => h.step(Math.max(1, Math.round(sec / 0.1)), 0.1);

try {
  await check('lesson end to end: Akka teaches Ice Shards through target practice', async () => {
    await fresh('water');
    await tr((g) => g.debug.training.goto('master_akka'));
    await wait(1.5);
    assert.ok(await tr((g) => g.debug.training.talk('master_akka')), 'Akka should be spawned and talkable');
    let dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg && /Akka/.test(dlg.speaker), 'dialogue open: ' + JSON.stringify(dlg));
    assert.ok(dlg.choices.some((c) => c.includes('Ice Shards')), 'lesson offered: ' + JSON.stringify(dlg.choices));
    assert.ok(!dlg.choices.some((c) => c.includes('Water Sweep')), 'Water Sweep must be locked behind Ice Shards');
    assert.ok(/🔒/.test(dlg.text), 'locked lesson explained in text');
    await tr((g) => g.debug.training.choose('Ice Shards'));
    await tr((g) => g.debug.training.choose('Show me'));
    let st = await tr((g) => g.debug.training.state());
    assert.equal(st.phase, 'demo');
    assert.deepEqual(st.grants, ['ice_shards']);
    const preKnown = await tr((g) => g.ctx.progression.learned.has('ice_shards'));
    assert.equal(preKnown, false, 'not learned before success');
    await h.step(40); // the master demonstrates (real cast)
    const demo = (await tr((g) => g.debug.training.state())).demo;
    assert.equal(demo, 'cast', 'master really cast the technique through CombatSystem');
    await tr((g) => g.debug.training.skipDemo());
    await h.step(2);
    await tr((g) => g.debug.training.skipDemo());
    await h.step(2);
    st = await tr((g) => g.debug.training.state());
    assert.equal(st.phase, 'running', JSON.stringify(st));
    assert.equal(st.info.targets.length, 5);
    // A wrong technique does not count.
    const t0 = st.info.targets[0];
    await tr((g, t) => g.faceTowards(t.x, t.z), t0);
    await tr((g, t) => g.cast('water_whip', { x: t.x, y: t.y + 1.4, z: t.z }), t0);
    await h.step(20);
    st = await tr((g) => g.debug.training.state());
    assert.equal(st.info.broken, 0, 'water whip must not break Ice Shards targets');
    await shot('lesson_challenge_hud');
    st = await breakTargets('ice_shards');
    await h.step(4);
    st = await tr((g) => g.debug.training.state());
    assert.ok(!st || st.phase === 'success', 'challenge succeeded: ' + JSON.stringify(st));
    await h.step(5);
    await shot('lesson_learned_banner');
    const s = await h.state();
    assert.ok(s.progression.learned.includes('ice_shards'), 'technique learned');
    assert.ok(s.progression.mastery.water.lessons.includes('akka_ice_shards'), 'lesson counted for mastery');
    const slots = await tr((g) => g.ctx.progression.slotsFor('water'));
    assert.ok(slots.includes('ice_shards'), 'equipped: ' + JSON.stringify(slots));
    await wait(7);
    assert.equal(await tr((g) => g.debug.training.state()), null, 'run finished');
    // Usable at once (real cast, not provisional).
    await tr((g) => g.ctx.combat.clear?.());
    const cast = await tr((g) => g.cast('ice_shards', null));
    assert.ok(cast.ok || cast.reason === 'cooldown', 'castable after learning: ' + JSON.stringify(cast));
    // Next lesson unlocked by the prerequisite.
    await tr((g) => g.debug.training.talk('master_akka'));
    dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg.choices.some((c) => c.includes('Water Sweep')), 'Water Sweep now offered: ' + JSON.stringify(dlg.choices));
    await tr((g) => g.debug.training.choose('Farewell'));
    await tr((g) => g.debug.training.choose('Leave'));
    // Persistence.
    assert.ok(await tr((g) => g.save('slot3')), 'save');
    await h.page.reload({ timeout: 240000 });
    await h.page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
    assert.ok(await tr((g) => g.loadGame('slot3')), 'load');
    await fast(true);
    await h.step(3);
    const after = await h.state();
    assert.ok(after.progression.learned.includes('ice_shards'), 'still known after load');
    assert.ok(after.progression.mastery.water.lessons.includes('akka_ice_shards'), 'lesson persisted');
    assert.ok(after.quests.flags.includes('lesson_akka_ice_shards'), 'lesson flag persisted');
    assert.ok((await tr((g) => g.ctx.progression.slotsFor('water'))).includes('ice_shards'), 'slot persisted');
  });

  await check('element awakening for a non-start element at its first master (Lien → earth)', async () => {
    await fresh('water');
    let s = await h.state();
    assert.ok(!s.progression.unlocked.includes('earth'));
    await tr((g) => g.debug.training.goto('master_lien'));
    await wait(1.5);
    assert.ok(await tr((g) => g.debug.training.talk('master_lien')), 'Lien spawned');
    let dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg.choices.some((c) => /Awaken earthbending/i.test(c)), 'awakening offered: ' + JSON.stringify(dlg.choices));
    assert.ok(!dlg.choices.some((c) => c.startsWith('Lesson:')), 'no technique lessons before awakening');
    await tr((g) => g.debug.training.choose('Awaken'));
    await tr((g) => g.debug.training.choose('I am ready'));
    let st = await tr((g) => g.debug.training.state());
    assert.equal(st.kind, 'awaken');
    await h.step(30);
    await tr((g) => g.debug.training.skipDemo());
    await h.step(2);
    await tr((g) => g.debug.training.skipDemo());
    await h.step(2);
    st = await breakTargets('earth_strike');
    await h.step(6);
    s = await h.state();
    assert.ok(s.progression.unlocked.includes('earth'), 'earth unlocked: ' + JSON.stringify(s.progression.unlocked));
    assert.ok(s.progression.learned.includes('earth_pillar'), 'starter techniques granted');
    assert.equal(s.player.element, 'earth');
    assert.ok(!s.progression.mastery.earth.lessons.length, 'awakening is not a mastery lesson');
    await wait(7);
  });

  await check('mastery trial refused before requirements, accepted after (Master Siku)', async () => {
    await fresh('water');
    assert.equal(await tr((g) => g.debug.training.startTrial('water')), false, 'trial refused');
    await tr((g) => g.debug.training.goto('master_siku'));
    await wait(1.5);
    await tr((g) => g.debug.training.talk('master_siku'));
    let dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg.choices.some((c) => /Ask about the Trial/.test(c)), JSON.stringify(dlg.choices));
    assert.ok(!dlg.choices.some((c) => /Begin the Trial/.test(c)), 'no trial start before requirements');
    await tr((g) => g.debug.training.choose('Ask about'));
    dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(/Not yet/.test(dlg.text), 'refusal explains requirements');
    await tr((g) => g.debug.training.choose(0));
    // Meet the requirements: three lessons + proficiency.
    await tr((g) => {
      g.debug.training.completeLesson('siku_ice_wall');
      g.debug.training.completeLesson('yugoda_water_heal');
      g.debug.training.completeLesson('akka_ice_shards');
      g.ctx.progression.mastery.water.proficiency = 330;
    });
    assert.ok(await tr((g) => g.ctx.progression.trialAvailable('water')));
    await tr((g) => g.debug.training.talk('master_siku'));
    dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg.choices.some((c) => /Begin the Trial of the Ocean and Moon/.test(c)), JSON.stringify(dlg.choices));
    await tr((g) => g.debug.training.choose('Begin the Trial'));
    await tr((g) => g.debug.training.choose('I am ready'));
    let st = await tr((g) => g.debug.training.state());
    assert.equal(st.kind, 'trial');
    assert.equal(st.stages, 3);
    await tr((g) => g.debug.training.skipDemo());
    await h.step(3);
    st = await tr((g) => g.debug.training.state());
    assert.equal(st.phase, 'running');
    assert.ok(st.info.partner && st.info.partner.active, 'sparring partner spawned: ' + JSON.stringify(st.info));
    await shot('trial_spar');
    // Stage 1 was a real duel spawn; fast-forward the stages (each must be built and passed in order).
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const cur = await tr((g) => g.debug.training.state());
      if (!cur || cur.phase === 'success') break;
      seen.add(cur.stage);
      if (cur.phase === 'running') await tr((g) => g.debug.training.forceSuccess());
      else await tr((g) => g.debug.training.skipDemo());
      await h.step(2);
    }
    assert.equal(seen.size, 3, 'all three stages ran: ' + JSON.stringify([...seen]));
    await h.step(4);
    const s = await h.state();
    assert.ok(s.progression.mastery.water.trialComplete, 'trial complete');
    assert.ok(s.progression.mastery.water.mastered, 'water mastered');
    await wait(7);
  });

  await check('Elements Sphere story moment: spirit vision + journal note', async () => {
    await fresh('fire');
    await tr((g) => g.debug.training.cancel());
    await tr((g) => g.masterAll());
    await wait(3);
    let dlg = await tr((g) => g.debug.training.dialogue());
    assert.ok(dlg && /Spirit Vision/.test(dlg.speaker), 'vision shown: ' + JSON.stringify(dlg));
    await shot('sphere_vision');
    for (let i = 0; i < 4; i++) {
      await tr((g) => g.debug.training.choose(0));
      await h.step(1);
    }
    const s = await h.state();
    assert.ok(s.quests.flags.includes('sphere_vision') && s.quests.flags.includes('note_sphere'));
    assert.ok(s.progression.sphereUnlocked);
    const txt = await tr((g) => {
      g.ctx.ui.open('journal');
      // Journal tabs: role="tab" buttons (reworked screens) or the older `.modal .tab` markup.
      const tab = document.querySelector('[role="tab"][data-tab="masters"]') ?? [...document.querySelectorAll('.modal .tab')].find((t) => /Masters/.test(t.textContent));
      tab.click();
      return (tab.closest('[role="dialog"], .modal') ?? document.body).textContent;
    });
    assert.ok(/The Elements Sphere/.test(txt) && /Master Jeong/.test(txt), 'journal masters page: ' + txt.slice(0, 300));
    await shot('journal_masters');
    await tr((g) => g.ctx.ui.closeAll());
  });

  await check('every lesson, awakening and trial-stage challenge builds and runs', async () => {
    if (h.page.isClosed() || crashed) await fresh('water');
    await tr((g) => g.debug.training.cancel());
    const res = await tr((g) => g.debug.training.probeAll());
    const bad = res.filter((r) => !r.ok);
    assert.ok(res.length >= 26 + 4 + 12, 'probed ' + res.length);
    assert.deepEqual(bad, [], JSON.stringify(bad).slice(0, 1500));
    const types = new Set(res.map((r) => r.type));
    for (const t of ['targets', 'precision', 'defense', 'rings', 'spar', 'ledge', 'flame', 'stance', 'heal', 'reserve', 'waterTargets']) assert.ok(types.has(t), 'challenge type covered: ' + t);
    await h.step(5);
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  const errs = h.errors.filter((e) => !/favicon|404/.test(e));
  if (errs.length) console.log('page errors:', errs.slice(0, 8).join('\n'));
  await h.close().catch(() => {});
  if (h !== base) await base.close().catch(() => {});
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
