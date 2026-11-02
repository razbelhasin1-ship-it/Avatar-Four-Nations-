/**
 * Starts E2E — the five journeys and old saves:
 *  1. each start option (Earth, Air, Fire, Northern Water, Southern Water): the right homeland, spawn,
 *     opening elder and opening quest; the opening played through (talk to the elder, bend — drawing
 *     real water for Water — enter the Avatar State) completes and starts the main line (both Water
 *     homelands lead into the same one); save, back to the menu, load: same origin and progress;
 *  2. the Southern opening moves Master Aput from the Great Igloo to the Frozen Pond;
 *  3. a save written before homelands existed (no origin) loads as the Northern Water Tribe for
 *     Water and keeps its element otherwise;
 *  4. Wolf Cove is alive: villagers, animals and boats are simulated and drawn; night empties it.
 * Run: node tests/e2e/starts.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

let h = await launch({ width: 800, height: 450, preset: 'low' });
const ev = (fn, ...a) => h.eval(fn, ...a);
const wait = (sec) => h.step(Math.max(1, Math.round(sec / 0.1)), 0.1);
const results = [];
const t0 = Date.now();
/** ONLY=word,word runs just the checks whose names contain one of the words. */
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const check = async (name, fn) => {
  if (ONLY && !ONLY.some((w) => name.includes(w))) return;
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${name}`);
  try {
    if (h.page.isClosed()) {
      await h.close().catch(() => {});
      h = await launch({ width: 800, height: 450, preset: 'low' });
    }
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};

const EXPECT = {
  earth: { region: 'ba_sing_se', quest: 'mq_awakening_earth', elder: 'bss_elder', cast: 'earth_strike', casts: 3 },
  air: { region: 'southern_air_temple', quest: 'mq_awakening_air', elder: 'air_elder', cast: 'air_palm', casts: 3, glide: true },
  fire: { region: 'fire_nation_capital', quest: 'mq_awakening_fire', elder: 'fn_elder', cast: 'fire_jab', casts: 4 },
  water_north: { region: 'northern_water_tribe', quest: 'mq_awakening_water', elder: 'nwt_elder', cast: 'water_whip', casts: 3, draw: 'nwt' },
  water_south: { region: 'southern_water_tribe', quest: 'mq_awakening_water_south', elder: 'swt_elder', cast: 'water_whip', casts: 3, draw: 'swt:' },
};

/** Play the opening quest of the current start: talk to its elder, bend (drawing real water first), Avatar State. */
async function playOpening(e) {
  await ev((g, id) => {
    const d = g.ctx.npcs.getDef(id);
    g.teleport(d.x + 1.2, d.z - 1.6, d.y);
  }, e.elder);
  await wait(2);
  assert.ok(await ev((g, id) => { const n = g.ctx.npcs.get(id); if (!n) return false; g.ctx.npcs.talk(n); return true; }, e.elder), `${e.elder} present at the start`);
  await ev((g) => g.ctx.npcs.endConversation());
  if (e.draw) {
    if (e.draw === 'swt:') {
      // The Frozen Pond's thawed hole, a short walk from the plaza.
      assert.ok(await ev((g) => { const s = g.ctx.water.get('swt:pond_hole'); if (s) g.teleport(s.x + s.r + 1.2, s.z); return !!s; }), 'the pond hole is a registered source');
      await wait(1.5);
    }
    await ev((g) => g.debug.water.startDraw());
    await h.step(30);
    const st = await ev((g) => g.debug.water.drawStatus());
    await ev((g) => g.debug.water.stopDraw());
    await h.step(2);
    assert.ok(st.sourceId && st.sourceId.startsWith(e.draw === 'swt:' ? 'swt:' : ''), 'drew real water: ' + JSON.stringify(st));
  }
  for (let i = 0; i < e.casts; i++) {
    await ev((g, t) => g.cast(t, null), e.cast);
    await h.step(15);
  }
  if (e.glide) {
    await ev((g) => g.ctx.events.emit('player:glide', { active: true }));
    await h.step(5);
  }
  await ev((g) => g.avatarState(true));
  await wait(2);
  const s = await h.state();
  await ev((g) => g.avatarState(false));
  await wait(1);
  return s;
}

const info = () =>
  ev((g) => {
    const q = g.ctx.quests;
    const p = g.game.player.position;
    const start = g.startPoint(g.ctx.progression.origin);
    return {
      origin: g.ctx.progression.origin,
      element: g.ctx.progression.startingElement,
      region: g.ctx.world.regionAt(p.x, p.z)?.id ?? null,
      fromStart: Math.hypot(p.x - start.x, p.z - start.z),
      active: [...q.active.keys()],
      flags: [...q.flags],
    };
  });

try {
  for (const origin of Object.keys(EXPECT)) {
    await check(`${origin}: homeland, spawn, elder, opening quest → main line; save and load`, async () => {
      const e = EXPECT[origin];
      await ev((g, o) => g.newGame({ origin: o, slot: 'slot2' }), origin);
      await wait(2);
      let s = await info();
      assert.equal(s.origin, origin, 'origin');
      assert.equal(s.region, e.region, 'region');
      assert.ok(s.fromStart < 6, `spawned ${s.fromStart.toFixed(1)} m from its start`);
      assert.ok(s.active.includes(e.quest), `${e.quest} active (${s.active})`);
      assert.ok(s.flags.includes(`origin_${origin}`), 'origin flag');
      for (const other of Object.values(EXPECT)) if (other.quest !== e.quest) assert.ok(!s.active.includes(other.quest), `not ${other.quest}`);
      if (origin === 'water_south') assert.ok(!s.flags.includes('aput_at_pond'), 'Aput waits at the Great Igloo');
      const q = await playOpening(e);
      assert.ok(q.quests.completed.includes(e.quest), 'opening complete: ' + JSON.stringify(q.quests.active));
      assert.ok(q.quests.flags.includes('avatar_awakened'), 'avatar_awakened');
      const element = origin.startsWith('water') ? 'water' : origin;
      assert.ok(q.quests.active.includes(`mq_avatar_cycle_${element}`), 'main line started');
      // Save, back to the menu, load: same origin, same homeland, quest progress kept.
      assert.ok(await ev((g) => g.game.saveGame('slot2')), 'saved');
      await ev((g) => g.game.exitToMenu(false));
      await ev((g) => g.loadGame('slot2'));
      await wait(1.5);
      s = await info();
      assert.equal(s.origin, origin, 'origin after load');
      assert.equal(s.region, e.region, 'region after load');
      assert.ok(s.active.includes(`mq_avatar_cycle_${element}`), 'main line after load');
    });
  }

  await check('Southern opening: Master Aput leaves the Great Igloo for the Frozen Pond', async () => {
    await ev((g) => g.newGame({ origin: 'water_south' }));
    await wait(2);
    assert.ok(await ev((g) => !!g.ctx.npcs.get('swt_elder')), 'Aput at the Great Igloo before the opening');
    const q = await playOpening(EXPECT.water_south);
    assert.ok(q.quests.flags.includes('aput_at_pond'), 'aput_at_pond');
    await wait(2);
    assert.equal(await ev((g) => !!g.ctx.npcs.get('swt_elder')), false, 'the opening elder steps away');
    await ev((g) => { const d = g.ctx.npcs.getDef('master_aput'); if (d) g.teleport(d.x + 2, d.z, d.y); });
    await wait(2);
    assert.ok(await ev((g) => !!g.ctx.npcs.get('master_aput')), 'Master Aput by the Frozen Pond');
  });

  await check('old saves (no origin): Water loads as the Northern Water Tribe, others keep their element', async () => {
    let s;
    // A save from before the homeland split: no origin anywhere in it.
    for (const [element, want] of [['water', 'water_north'], ['earth', 'earth']]) {
      await ev((g, e) => g.newGame({ element: e, slot: 'slot3' }), element);
      await wait(1);
      await ev((g) => g.game.saveGame('slot3'));
      await ev((g) => g.game.exitToMenu(false));
      // The journey's origin lives in the progression system's save (systems.progression.origin).
      const stripped = await ev(() => {
        let n = 0;
        for (const k of ['a4n.save.slot3', 'a4n.save.slot3.bak']) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const f = JSON.parse(raw);
          const pr = f.systems?.progression;
          if (pr && 'origin' in pr) {
            delete pr.origin;
            n++;
          }
          localStorage.setItem(k, JSON.stringify(f));
        }
        return n;
      });
      assert.ok(stripped >= 1, 'origin removed from the save');
      await ev((g) => g.loadGame('slot3'));
      await wait(1);
      s = await info();
      assert.equal(s.origin, want, `old ${element} save → ${want}`);
      assert.equal(s.element, element);
    }
  });

  await check('Wolf Cove is alive: villagers, animals, boats', async () => {
    await ev((g) => g.newGame({ origin: 'water_south' }));
    await ev((g) => { g.freezeTime(true); g.setTime(11); });
    await wait(3);
    const s = await ev((g) => g.debug.swt.state());
    assert.ok(s, 'debug state');
    assert.ok(s.life.total >= 120, `villagers ${s.life.total}`);
    assert.ok(s.life.village >= 60, `in the village ${s.life.village}`);
    assert.ok(s.life.drawn >= 30, `drawn ${s.life.drawn}`);
    assert.ok(s.wild.dogs > 0 && s.wild.seals > 0, 'dogs and seals');
    assert.ok(s.wild.boats >= 3 && s.wild.boatsOut >= 3, `boats out by day ${s.wild.boatsOut}/${s.wild.boats}`);
    // A night without the festival (on clear evenings the village meditates outside until one).
    await ev((g) => {
      g.debug.swt.festival(false);
      g.setTime(2.5);
    });
    await wait(3);
    const n = await ev((g) => g.debug.swt.state());
    assert.ok(n.life.home > s.life.home + 60, `night: indoors ${n.life.home} (day ${s.life.home})`);
    assert.equal(n.wild.boatsOut, 0, 'boats home at night');
  });
} finally {
  console.log('errors', h.errors.length, h.errors.slice(0, 3));
  await h.close();
}
console.log('\n' + results.map((r) => r.join('  ')).join('\n'));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
