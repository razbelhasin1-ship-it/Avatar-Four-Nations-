/**
 * Playthrough regressions found in QA (h.step deterministic simulation):
 *  1. after the first master lesson the main line tracks the next nation of the Avatar cycle,
 *     with a compass marker (water start → Seek the Earth Kingdom → Ba Sing Se);
 *  2. a "seek" quest for an element already awakened elsewhere completes at once (no detour back),
 *     and tracking moves on to the following nation;
 *  3. loading a save made under an overhead walkable deck (Ba Sing Se rail viaduct) keeps the
 *     player on the saved floor instead of lifting them onto the deck.
 * Run: node tests/e2e/playthrough.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  console.log('…', name);
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const ev = (fn, ...a) => h.eval(fn, ...a);
const fast = () => ev((g) => g.setting('graphics.renderScale', 0.3));
const wait = (sec) => h.step(Math.max(1, Math.round(sec / 0.1)), 0.1);
const emit = (name, payload) => ev((g, n, p) => g.ctx.events.emit(n, p), name, payload);
/** Finish the water opening and Master Siku's first lesson through the events gameplay emits. */
async function finishWaterOpening() {
  await emit('npc:interact', { npcId: 'nwt_elder' });
  await emit('water:drawn', { sourceId: 'test', sourceType: 'fountain', amount: 10, position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 3; i++) await emit('technique:cast', { id: 'water_whip', casterId: 1, element: 'water', isPlayer: true, position: { x: 0, y: 0, z: 0 } });
  await ev((g) => g.avatarState(true));
  await wait(0.5);
  await ev((g) => g.avatarState(false));
  await emit('npc:interact', { npcId: 'master_siku' });
  await emit('training:completed', { masterId: 'master_siku', lessonId: 'siku_ice_wall', techniqueId: 'ice_wall', success: true });
  await h.step(5);
}

try {
  await check('after the first lesson the next nation of the Avatar cycle is tracked, with a marker', async () => {
    await h.newGame('water');
    await fast();
    await finishWaterOpening();
    const s = await h.state();
    assert.ok(s.quests.completed.includes('mq_awakening_water'), JSON.stringify(s.quests));
    for (const e of ['earth', 'fire', 'air']) assert.ok(s.quests.active.includes(`mq_seek_${e}`), `mq_seek_${e} active`);
    assert.equal(s.quests.tracked, 'mq_seek_earth');
    const mk = await ev((g) => g.ctx.quests.markers().filter((m) => m.tracked).map((m) => ({ x: m.position.x, z: m.position.z, text: m.text })));
    assert.ok(mk.some((m) => /Ba Sing Se/.test(m.text) && Math.hypot(m.x - 650, m.z + 40) < 5), 'tracked marker on Ba Sing Se: ' + JSON.stringify(mk));
  });

  await check("quest givers by the Chief's palace stand on the terrace, not inside its steps", async () => {
    await ev((g) => {
      g.freezeTime(true);
      g.setTime(12);
      g.teleport(-226, -1474);
    });
    await wait(2.5);
    const r = await ev((g) => {
      const C = g.ctx.world.collision, V = new g.THREE.Vector3();
      return ['qg_nwt_oasis', 'life_nwt_3', 'life_nwt_9'].map((id) => {
        const n = g.ctx.npcs.get(id);
        if (!n) return { id, live: false };
        const p = n.position;
        const ov = [0.5, 1.0, 1.5].some((dy) => { const c = C.overlapSphere(V.set(p.x, p.y + dy, p.z), 0.22); return !!c && !c.dynamic; });
        return { id, live: true, ov };
      });
    });
    for (const n of r) assert.ok(n.live && !n.ov, JSON.stringify(r));
  });

  await check('a seek quest for an element already awakened completes at once; tracking moves on', async () => {
    await h.newGame('water');
    await fast();
    await ev((g) => g.ctx.progression.unlockElement('earth', true));
    await finishWaterOpening();
    const s = await h.state();
    assert.ok(s.quests.completed.includes('mq_seek_earth'), 'seek earth completed: ' + JSON.stringify(s.quests));
    assert.equal(s.quests.tracked, 'mq_seek_fire');
    const cyc = await ev((g) => {
      const p = g.ctx.quests.active.get('mq_avatar_cycle_water');
      const d = g.ctx.quests.get('mq_avatar_cycle_water');
      const st = d.steps[p.step];
      return { step: st.id, earth: p.done[st.objectives.findIndex((o) => o.element === 'earth')] };
    });
    assert.deepEqual(cyc, { step: 'nations', earth: true });
  });

  await check('a "defeat" quest (Bandits on the Road) points the compass at the nearest bandit camp', async () => {
    assert.ok(await ev((g) => g.ctx.quests.start('sq_bandits')), 'quest started');
    const r = await ev((g) => {
      const mk = g.ctx.quests.markers().filter((m) => m.questId === 'sq_bandits');
      const camps = g.debug.enemies.encounters().filter((c) => c.members.some((m) => /bandit/.test(m)));
      return { mk: mk.map((m) => ({ x: m.position.x, z: m.position.z, text: m.text })), camps: camps.map((c) => ({ x: c.x, z: c.z })) };
    });
    assert.equal(r.mk.length, 1, JSON.stringify(r.mk));
    assert.ok(r.camps.some((c) => Math.hypot(c.x - r.mk[0].x, c.z - r.mk[0].z) < 2), 'marker on a bandit camp: ' + JSON.stringify(r));
    // Bandit kills advance the counter (pirates do not).
    await ev((g) => {
      g.debug.enemies.spawn('pirate', 6, -2);
      g.debug.enemies.spawn('earth_bandit', 6, 2);
    });
    await h.step(3);
    await ev((g) => g.debug.enemies.killAll());
    await h.step(5);
    const counts = await ev((g) => g.ctx.quests.active.get('sq_bandits')?.counts ?? null);
    assert.deepEqual(counts, [1], 'one bandit counted');
    // Named camps hold the faction their name (and props) promise.
    const named = await ev((g) => g.debug.enemies.encounters().filter((c) => /^camp_(bandit|pirate)_/.test(c.id)).map((c) => ({ id: c.id, members: c.members })));
    assert.ok(named.length >= 5, JSON.stringify(named));
    for (const c of named) {
      const want = c.id.includes('bandit') ? /bandit/ : /pirate/;
      assert.ok(c.members.some((m) => want.test(m)), `${c.id} holds ${c.members.join(', ')}`);
    }
  });

  await check('loading a save made under an overhead deck keeps the saved floor', async () => {
    await h.newGame('earth');
    await fast();
    const spot = await ev((g) => {
      const W = g.ctx.world, C = W.collision, V = new g.THREE.Vector3();
      const p = g.game.player.position;
      let best = null;
      for (const c of C.colliders.values()) {
        if (c.dynamic || !c.walkable || c.shape !== 'box' || c.slopeRise) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d > 900 || (best && d > best.d)) continue;
        const th = W.heightAt(c.x, c.z);
        if (c.y - c.hy - th < 4) continue;
        const w = W.waterAt(c.x, c.z);
        if (w && !w.frozen && w.level > th + 0.2) continue;
        const floor = W.groundAt(c.x, c.z, th + 1).y;
        if (Math.abs(floor - th) > 0.3) continue;
        if (C.overlapSphere(V.set(c.x, floor + 0.9, c.z), 0.45) || C.overlapSphere(V.set(c.x, floor + 1.7, c.z), 0.45)) continue;
        best = { d, x: c.x, z: c.z, floor, deck: c.y + c.hy };
      }
      return best;
    });
    assert.ok(spot, 'an overhead walkable deck near Ba Sing Se');
    await ev((g, s) => g.teleport(s.x, s.z, s.floor), spot);
    await wait(2);
    let s = await h.state();
    assert.ok(Math.abs(s.player.y - spot.floor) < 0.5 && s.player.grounded, 'standing under the deck: ' + JSON.stringify({ spot, p: s.player }));
    assert.ok(await ev((g) => g.save('slot3')));
    await h.page.reload({ timeout: 240000 });
    await h.page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
    assert.ok(await ev((g) => g.loadGame('slot3')));
    await fast();
    await h.step(5);
    s = await h.state();
    assert.ok(Math.abs(s.player.y - spot.floor) < 0.6, `loaded on the floor (${spot.floor.toFixed(2)}), not on the deck (${spot.deck.toFixed(2)}): y=${s.player.y}`);
  });
  await check('every quest prop is reachable; all five Omashu cabbages can be picked up (My Cabbages!)', async () => {
    await h.newGame('water');
    await fast();
    await ev((g) => {
      g.freezeTime(true);
      g.setTime(12);
      g.unlockAllElements();
    });
    const props = await ev((g) => g.debug.quests.props());
    const bad = [];
    for (const p of props) {
      // The prop's quest at the prop's step.
      await ev(async (g, pid) => {
        const m = await import('/src/data/quests_props.ts');
        const d = m.QUEST_PROPS.find((x) => x.id === pid);
        const Q = g.ctx.quests;
        if (!d.quest) return;
        if (!Q.isActive(d.quest) && !Q.isComplete(d.quest)) Q.start(d.quest);
        const prog = Q.active.get(d.quest);
        const def = Q.get(d.quest);
        const i = d.step ? def.steps.findIndex((s) => s.id === d.step) : -1;
        if (prog && i >= 0 && prog.step !== i) {
          prog.step = i;
          prog.counts = def.steps[i].objectives.map(() => 0);
          prog.done = def.steps[i].objectives.map(() => false);
        }
      }, p.id);
      const at = Array.isArray(p.pos) ? { x: p.pos[0], z: p.pos[2] } : p.pos;
      await ev((g, q) => g.teleport(q.x + 2, q.z + 1.5), at);
      await wait(2);
      const probe = () => ev((g, pid) => {
        const live = g.debug.quests.sys.live.get(pid);
        if (!live) return { pid, live: false };
        const W = g.ctx.world, C = W.collision, V = new g.THREE.Vector3();
        const q = live.pos;
        const inside = C.overlapSphere(V.set(q.x, q.y + 0.25, q.z), 0.1);
        let stand = false;
        for (let rr = 0.8; rr <= 2.0 && !stand; rr += 0.6)
          for (let a = 0; a < 12 && !stand; a++) {
            const x = q.x + Math.cos((a / 12) * Math.PI * 2) * rr, z = q.z + Math.sin((a / 12) * Math.PI * 2) * rr;
            const y = W.groundAt(x, z, q.y + 1.5).y;
            if (Math.abs(y - q.y) < 0.7 && !C.overlapSphere(V.set(x, y + 0.9, z), 0.3) && !C.overlapSphere(V.set(x, y + 1.5, z), 0.3)) stand = true;
          }
        return { pid, live: true, inside: !!inside && !inside.dynamic && inside.shape === 'box' && inside.hy > 1, stand };
      }, p.id);
      let r = await probe();
      if (!r.live || r.inside || !r.stand) {
        // A debug teleport can spawn a landmark-anchored prop before its district finished building
        // (fast travel and loads preload first): leave, come back once the district exists, re-check.
        await ev((g, q) => g.teleport(q.x + 400, q.z), at);
        await wait(1);
        await ev((g, q) => g.teleport(q.x + 2, q.z + 1.5), at);
        await wait(2);
        r = await probe();
      }
      if (!r.live || r.inside || !r.stand) bad.push(r);
    }
    assert.deepEqual(bad, [], 'unreachable quest props: ' + JSON.stringify(bad));
    // My Cabbages!: walk up to each cabbage and press E.
    await ev((g) => {
      const Q = g.ctx.quests;
      const prog = Q.active.get('sq_cabbage_cart');
      prog.step = 0;
      prog.counts = [0];
      prog.done = [false];
      g.ctx.inventory.remove('stray_cabbage', g.ctx.inventory.count('stray_cabbage'));
    });
    const gate = props.find((p) => p.id === 'cabbage_0');
    await ev((g, p) => {
      const q = Array.isArray(p) ? { x: p[0], z: p[2] } : p;
      g.teleport(q.x + 2, q.z + 1.5);
    }, gate.pos);
    await wait(2);
    for (let i = 0; i < 5; i++) {
      const c = await ev((g, pid) => g.debug.quests.sys.live.get(pid)?.pos.toArray() ?? null, `cabbage_${i}`);
      assert.ok(c, `cabbage_${i} live`);
      const spot = await ev((g, c) => {
        const W = g.ctx.world, C = W.collision, V = new g.THREE.Vector3();
        for (let a = 0; a < 16; a++) {
          const x = c[0] + Math.cos((a / 16) * Math.PI * 2) * 1.4, z = c[2] + Math.sin((a / 16) * Math.PI * 2) * 1.4;
          const y = W.groundAt(x, z, c[1] + 1.5).y;
          if (Math.abs(y - c[1]) < 0.7 && !C.overlapSphere(V.set(x, y + 0.9, z), 0.3)) return { x, y, z };
        }
        return null;
      }, c);
      assert.ok(spot, `standing spot by cabbage_${i}`);
      await ev((g, s, c) => {
        g.teleport(s.x, s.z, s.y);
        g.faceTowards(c[0], c[2]);
      }, spot, c);
      await h.step(3);
      await ev((g) => g.ctx.input.setVirtual('interact', true));
      await h.step(2);
      await ev((g) => g.ctx.input.setVirtual('interact', false));
      await h.step(3);
    }
    const prog = await ev((g) => g.debug.quests.progress('sq_cabbage_cart'));
    assert.equal(prog.step, 'return', 'all five cabbages gathered: ' + JSON.stringify(prog));
  });

  await check('the tutorial runs and exits without touching an existing campaign', async () => {
    await h.newGame('fire', { slot: 'slot2' });
    await fast();
    await ev((g) => {
      g.ctx.inventory.addCurrency(77);
      g.ctx.quests.setFlag('qa_marker');
    });
    assert.ok(await ev((g) => g.save('slot2')));
    const before = await ev((g) => ({ save: localStorage.getItem('a4n.save.slot2'), s: g.state() }));
    await h.startTutorial();
    await fast();
    await h.step(30);
    let s = await h.state();
    assert.equal(s.session.kind, 'tutorial');
    await ev((g) => g.avatarState(true));
    await h.step(20);
    await ev((g) => g.exitToMenu(true));
    await h.step(5);
    assert.equal((await h.state()).mode, 'menu');
    assert.equal(await ev(() => localStorage.getItem('a4n.save.slot2')), before.save, 'campaign save untouched');
    assert.ok(await ev((g) => g.loadGame('slot2')));
    await fast();
    await h.step(5);
    s = await h.state();
    assert.equal(s.session.kind, 'campaign');
    assert.deepEqual(s.progression.unlocked, before.s.progression.unlocked, 'no sandbox elements leak into the campaign');
    assert.deepEqual(s.progression.learned.sort(), before.s.progression.learned.sort());
    assert.equal(s.inventory.currency, before.s.inventory.currency);
    assert.ok(s.quests.flags.includes('qa_marker') && !s.avatar.active);
    assert.deepEqual(s.quests.active.sort(), before.s.quests.active.sort());
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
