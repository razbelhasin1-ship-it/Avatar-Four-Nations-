/**
 * Quests & NPC life E2E:
 *  1. the opening quest completes through gameplay and starts the main line (The Avatar Cycle) + mastery quest;
 *     the opening elder relocates to his teaching post;
 *  2. a side quest completes through real gameplay (The Silent Bells: ring bells with airbending, return);
 *  3. a hidden master is revealed by a clue (wind-worn tablet) → discovery quest + map marker;
 *  4. city life: NPCs streamed around a city, day/night routine thins them out, civilians flee from fights.
 * Run: node tests/e2e/quests.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.SHOTS || '';
let h = await launch({ width: 960, height: 540 });
/** Relaunch if a shared-machine hiccup closed the browser; fresh campaign of `element` when needed. */
async function ensure(element, force = false) {
  let relaunched = false;
  if (h.page.isClosed()) {
    await h.close().catch(() => {});
    h = await launch({ width: 960, height: 540 });
    relaunched = true;
  }
  if (relaunched || force) {
    await h.newGame(element);
    await fast(true);
  }
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
const ev = (fn, ...a) => h.eval(fn, ...a);

/** Low render cost while simulating; coarse steps for waiting (streaming). */
const fast = (on) => h.eval((g, on) => g.setting('graphics.renderScale', on ? 0.3 : 0.75), on);
const wait = (sec) => h.step(Math.max(1, Math.round(sec / 0.1)), 0.1);

try {
  await check('opening quest → main line + mastery quest; Tenzo moves to the courtyard', async () => {
    await ensure('air', true);
    let s = await h.state();
    assert.ok(s.quests.active.includes('mq_awakening_air'), JSON.stringify(s.quests));
    assert.ok(!s.quests.flags.includes('tenzo_in_courtyard'));
    // Gameplay: talk to Tenzo, bend, glide, Avatar State.
    await ev((g) => {
      const d = g.ctx.npcs.getDef('air_elder');
      g.teleport(d.x + 1.5, d.z + 1.5, d.y);
    });
    await wait(1.5);
    assert.ok(await ev((g) => { const n = g.ctx.npcs.get('air_elder'); if (!n) return false; g.ctx.npcs.talk(n); return true; }), 'air_elder spawned');
    await ev((g) => g.ctx.npcs.endConversation());
    for (let i = 0; i < 3; i++) {
      await ev((g) => g.cast('air_palm', null));
      await h.step(15);
    }
    await ev((g) => g.ctx.events.emit('player:glide', { active: true }));
    await h.step(5);
    await ev((g) => g.avatarState(true));
    await wait(2);
    s = await h.state();
    assert.ok(s.quests.completed.includes('mq_awakening_air'), 'awakening complete: ' + JSON.stringify(s.quests));
    assert.ok(s.quests.flags.includes('tenzo_in_courtyard') && s.quests.flags.includes('avatar_awakened'));
    assert.ok(s.quests.active.includes('mq_avatar_cycle_air'), 'main line started');
    assert.ok(s.quests.active.includes('mq_mastery_air'), 'mastery quest started');
    assert.equal(s.quests.tracked, 'mq_avatar_cycle_air');
    await ev((g) => g.avatarState(false));
    await wait(2);
    const live = await ev((g) => ({ elder: !!g.ctx.npcs.get('air_elder'), tenzo: !!g.ctx.npcs.get('master_tenzo') }));
    assert.deepEqual(live, { elder: false, tenzo: true }, 'Tenzo relocated');
    const markers = await ev((g) => g.ctx.quests.markers().map((m) => ({ q: m.questId, icon: m.icon ?? null, text: m.text })));
    assert.ok(markers.some((m) => m.q === 'mq_avatar_cycle_air' && /Tenzo/.test(m.text)), 'main quest marker on Tenzo');
    assert.ok(markers.some((m) => m.q === 'master:master_tenzo' && m.icon === '✦'), 'master ✦ marker');
  });

  await check('side quest through gameplay: The Silent Bells', async () => {
    await ensure('air', !!ONLY && !ONLY.includes(1));
    await ev((g) => {
      const d = g.ctx.npcs.getDef('qg_air_bellkeeper');
      g.teleport(d.x + 2, d.z + 2, d.y);
    });
    await wait(1.5);
    assert.ok(await ev((g) => { const n = g.ctx.npcs.get('qg_air_bellkeeper'); if (!n) return false; g.ctx.npcs.talk(n); return true; }), 'bell keeper spawned');
    await ev((g) => g.debug.training.choose("I'll ring them"));
    await wait(1.5);
    let s = await h.state();
    assert.ok(s.quests.active.includes('sq_bells'), 'quest started');
    const bells = await ev((g) => g.debug.quests.props().filter((p) => p.quest === 'sq_bells'));
    assert.equal(bells.filter((b) => b.live).length, 3, 'bells spawned: ' + JSON.stringify(bells));
    await shot('quest_bells');
    for (const b of bells) {
      const id = await ev((g, pid) => g.debug.quests.propEntity(pid), b.id);
      const info = await ev((g, eid) => g.entityInfo(eid), id);
      await ev((g, p) => g.teleport(p.x + 2.2, p.z + 1.2), info);
      await h.step(4);
      await ev((g, p) => g.faceTowards(p.x, p.z), info);
      for (let k = 0; k < 4; k++) {
        const r = await ev((g, p) => g.cast('air_palm', { x: p.x, y: p.y + 1.8, z: p.z }), info);
        await h.step(18);
        const done = await ev((g, pid) => g.ctx.quests.hasFlag('prop_' + pid), b.id);
        if (done) break;
        if (!r.ok && r.reason !== 'busy' && r.reason !== 'cooldown') throw new Error(JSON.stringify(r));
      }
    }
    s = await h.state();
    const prog = await ev((g) => g.debug.quests.progress('sq_bells'));
    assert.equal(prog.step, 'return', 'all bells rung: ' + JSON.stringify(prog));
    await ev((g) => {
      const d = g.ctx.npcs.getDef('qg_air_bellkeeper');
      g.teleport(d.x + 2, d.z + 2, d.y);
    });
    await h.step(10);
    await ev((g) => g.ctx.npcs.talk(g.ctx.npcs.get('qg_air_bellkeeper')));
    await ev((g) => g.ctx.npcs.endConversation());
    s = await h.state();
    assert.ok(s.quests.completed.includes('sq_bells'), 'quest complete');
    assert.ok(await ev((g) => g.ctx.inventory.isCosmeticUnlocked('air_cape')), 'cosmetic reward');
  });

  await check('hidden master revealed by a clue: wind-worn tablet → Hermit', async () => {
    await ensure('air');
    let known = await ev((g) => g.debug.training.masters().find((m) => m.id === 'master_hermit').known);
    assert.equal(known, false);
    assert.ok(!(await ev((g) => g.ctx.quests.markers().some((m) => m.questId === 'master:master_hermit'))));
    const tab = (await ev((g) => g.debug.quests.props())).find((p) => p.id === 'clue_hermit_tablet');
    assert.ok(tab.wanted, 'tablet available');
    assert.ok(await ev((g) => g.debug.quests.use('clue_hermit_tablet')), 'tablet read');
    await ev((g) => g.ctx.ui.hideDialogue());
    const s = await h.state();
    assert.ok(s.quests.flags.includes('clue_hermit'));
    assert.ok(s.quests.active.includes('sq_hermit'), 'discovery quest started');
    assert.ok(s.discovered.includes('wind_shrine'), 'shrine revealed on the map');
    known = await ev((g) => g.debug.training.masters().find((m) => m.id === 'master_hermit').known);
    assert.equal(known, true);
    assert.ok(await ev((g) => g.ctx.quests.markers().some((m) => m.questId === 'master:master_hermit')), 'hermit ✦ marker');
  });

  await check('city life: streamed NPCs, night routine, civilians flee', async () => {
    await ensure('fire');
    await ev((g) => g.freezeTime(true));
    await ev((g) => g.setTime(12));
    await ev((g) => g.startPoint('fire'));
    await wait(2);
    const day = await ev((g) => [...g.ctx.npcs.liveNPCs()].filter((n) => n.def.id.startsWith('life_') || n.def.id.startsWith('merchant_') || n.def.id.startsWith('qg_')).length);
    assert.ok(day >= 6, 'life NPCs around the capital by day: ' + day);
    await shot('city_life_fire');
    // Flee from a fight.
    const fled = await ev((g) => {
      const n = [...g.ctx.npcs.liveNPCs()].find((x) => x.def.role === 'villager' || x.def.role === 'child' || x.def.role === 'noble');
      if (!n) return null;
      g.ctx.npcs.alarm(n.position.x + 2, n.position.z + 1);
      return { id: n.def.id, flee: n.fleeTimer };
    });
    assert.ok(fled && fled.flee > 0, 'civilian flees: ' + JSON.stringify(fled));
    await ev((g) => g.setTime(23.5));
    await wait(2);
    const night = await ev((g) => [...g.ctx.npcs.liveNPCs()].filter((n) => n.def.id.startsWith('life_') || n.def.id.startsWith('merchant_') || n.def.id.startsWith('qg_')).length);
    assert.ok(night < day, `fewer people at night (${night} < ${day})`);
    await ev((g) => g.setTime(12));
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  const errs = h.errors.filter((e) => !/favicon|404/.test(e));
  if (errs.length) console.log('page errors:', errs.slice(0, 8).join('\n'));
  await h.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
