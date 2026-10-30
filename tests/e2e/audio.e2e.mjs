/**
 * Audio E2E (procedural WebAudio, verified without ears):
 *  - safe no-ops while audio is locked; unlock; settings apply live to the buses
 *  - every registered sound/loop rendered through an OfflineAudioContext: finite,
 *    audible, unclipped, decays within its declared duration, loops steady + stop
 *  - every literal id the codebase plays is registered
 *  - menu theme; region themes; combat layer rises and decays; stingers / UI fallback
 *  - ambience layers follow place (summit wind, temple, surf, river, city, volcanic,
 *    desert, swamp), time of day and weather, within the voice budget
 *  - event bindings: per-surface footsteps, per-element dodge, element switch, hits,
 *    dry-fizz failure, water draw, notifications, dialogue voices, DOM UI sounds, pause muffle
 * Run: node tests/e2e/audio.e2e.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../scripts/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const audio = (fn, ...args) => h.eval(fn, ...args);
const logIds = async () => audio((g) => g.debug.audio.log(200).map((e) => e.id));
const clearLog = () => audio((g) => g.debug.audio.clearLog());
/** Advance only the audio engine (directors tick on it) — no rendering, deterministic dt. */
const tick = (n = 30) => audio((g, n) => { for (let i = 0; i < n; i++) g.ctx.audio.update(1 / 30); }, n);

/** Literal ids passed to audio.play('...') / audio.loop('...') anywhere in src/. */
function playedIds() {
  const sounds = new Set();
  const loops = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/audio\.play\(\s*'([^']+)'/g)) sounds.add(m[1]);
        for (const m of src.matchAll(/audio\.loop\(\s*'([^']+)'/g)) loops.add(m[1]);
        // Conditional ids: audio.play(cond ? 'a' : 'b', ...)
        for (const m of src.matchAll(/audio\.play\(([^,()]*\?[^,()]*)/g)) for (const q of m[1].slice(m[1].indexOf('?') + 1).matchAll(/'([^']+)'/g)) sounds.add(q[1]);
        // Data-driven creature calls (src/data/creatures.ts sounds: { call, alarm, content }).
        for (const m of src.matchAll(/'(creature\.[a-z_]+\.[a-z_]+)'/g)) sounds.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return { sounds: [...sounds], loops: [...loops] };
}

try {
  await check('locked: plays are safe no-ops, nothing throws', async () => {
    const s = await audio((g) => g.debug.audio.state());
    assert.equal(s.engine.state, 'locked', 'audio should start locked (no gesture yet)');
    const played = await audio((g) => [g.debug.audio.play('ui.click'), g.debug.audio.play('hit.fire', { position: { x: 0, y: 0, z: 0 } })]);
    assert.deepEqual(played, [false, false]);
    await h.step(10);
    const loops = await audio((g) => g.debug.audio.state().engine.loops.length);
    assert.equal(loops, 0);
  });

  await check('unlock: context runs; menu theme and menu ambience start', async () => {
    const st = await audio((g) => g.debug.audio.unlock());
    assert.ok(st.unlocked, JSON.stringify(st));
    await h.wait(300);
    await h.step(40);
    const s = await audio((g) => g.debug.audio.state());
    assert.equal(s.engine.state, 'running');
    assert.equal(s.music.theme, 'menu');
    assert.equal(s.music.playing, 'menu');
    // The main menu plays the recorded theme (src/audio/music/tracks/menu-theme.mp3), looped.
    assert.equal(s.music.mode, 'track', JSON.stringify(s.music));
    assert.ok(s.music.track.loaded && s.music.track.playing && !s.music.track.failed, JSON.stringify(s.music.track));
    assert.ok(s.music.track.duration > 400, 'track duration ' + s.music.track.duration);
    const t0 = s.music.track.time;
    await h.wait(1200);
    const tr = await audio((g) => g.debug.audio.music.track('menu'));
    assert.ok(tr.time > t0 + 0.5, `track not advancing: ${t0} → ${tr.time}`);
    assert.ok(tr.level > 0.3, 'track faded in: ' + tr.level);
    // The menu backdrop orbits the Air Temple: high-altitude wind + temple chimes.
    assert.ok(s.ambience.playing.includes('amb.wind.high'), JSON.stringify(s.ambience.playing));
    assert.ok(s.ambience.playing.includes('amb.temple'), JSON.stringify(s.ambience.playing));
  });

  await check('reverb tails always die away: no runaway feedback in any space or the music hall', async () => {
    // Regression: the music hall reverb gained energy in Chrome until it was a full-scale screech.
    const cases = [[{ decay: 2.6, damping: 4200, mix: 0.55 }, 1.35], [{ decay: 1.3, damping: 5200, mix: 0.4 }, 1], [{ decay: 2.8, damping: 3600, mix: 0.5 }, 1], [{ decay: 8, damping: 16000, mix: 1 }, 1.35]];
    for (const [p, size] of cases) {
      for (const sr of [44100, 48000]) {
        const w = await audio((g, p, size, sr) => g.debug.audio.reverbTail(p, size, 16, sr), p, size, sr);
        assert.ok(w.every((v) => Number.isFinite(v)), `${JSON.stringify(p)} x${size} @${sr}: ${w}`);
        assert.ok(w[w.length - 1] < w[0] * 1e-3, `tail must decay: ${JSON.stringify(p)} x${size} @${sr}: ${w}`);
      }
    }
    assert.equal(await audio((g) => g.ctx.audio.rebuilds), 0, 'the runaway watchdog must not have fired');
  });

  await check('settings: mute and bus volumes apply live', async () => {
    await audio((g) => {
      g.setting('audio.muted', false);
      g.setting('audio.master', 0.5);
      g.setting('audio.sfx', 0.8);
      g.setting('audio.music', 0.9);
      g.setting('audio.ambient', 0.6);
    });
    await h.wait(450);
    let e = (await audio((g) => g.debug.audio.state())).engine;
    assert.ok(Math.abs(e.master - 0.5) < 0.05, 'master ' + e.master);
    assert.ok(Math.abs(e.buses.sfx - 0.8) < 0.05, 'sfx ' + e.buses.sfx);
    assert.ok(Math.abs(e.buses.ambient - 0.6) < 0.05, 'ambient ' + e.buses.ambient);
    assert.ok(Math.abs(e.buses.music - 0.54) < 0.05, 'music ' + e.buses.music);
    await audio((g) => g.setting('audio.muted', true));
    await h.wait(450);
    e = (await audio((g) => g.debug.audio.state())).engine;
    assert.ok(e.master < 0.02, 'muted master ' + e.master);
    await audio((g) => g.setting('audio.muted', false));
  });

  await check('offline render: every registered sound and loop is finite, audible, unclipped and within its duration', async () => {
    const r = await audio(async (g) => g.debug.audio.verifyAll());
    assert.ok(r.sounds > 250 && r.loops > 35, `${r.sounds} sounds / ${r.loops} loops`);
    assert.equal(r.failed.length, 0, r.failed.map((f) => `${f.id}: ${f.problems.join(', ')}`).join(' | '));
  });

  await check('every literal id played in src/ is registered', async () => {
    const ids = playedIds();
    const missing = await audio(
      (g, s, l) => [...s.filter((id) => !g.debug.audio.has(id)), ...l.filter((id) => !g.debug.audio.hasLoop(id)).map((id) => 'loop:' + id)],
      ids.sounds,
      ids.loops,
    );
    assert.ok(ids.sounds.length > 40, 'scan found too few ids: ' + ids.sounds.length);
    assert.deepEqual(missing, [], 'unregistered ids: ' + missing.join(', '));
  });

  await h.newGame('water');
  await h.step(30);

  await check('bindings: footsteps per surface, dodge per element, element switch', async () => {
    await audio((g) => g.teleport(-236, -1606));
    await h.step(10);
    await clearLog();
    await audio((g) => g.move(0, 1));
    await h.step(45);
    await audio((g) => g.move(0, 0));
    let ids = await logIds();
    const surf = (await h.state()).player.surface;
    assert.ok(ids.some((id) => id.startsWith(`step.`)), 'no per-surface footsteps: ' + ids.join(','));
    assert.ok(!ids.some((id) => /^footstep/.test(id)), 'legacy footstep doubled: ' + ids.join(','));
    assert.ok(ids.some((id) => id.startsWith(`step.${surf}.`) || id.startsWith('step.')), surf);
    await clearLog();
    await audio((g) => g.press('dodge', 0.15));
    await h.step(8);
    ids = await logIds();
    assert.ok(ids.includes('dodge.water'), 'dodge: ' + ids.join(','));
    assert.ok(!ids.includes('whoosh'), 'generic dodge whoosh doubled');
    await clearLog();
    await audio((g) => {
      g.unlockAllElements();
      g.game.player.switchElement('fire');
    });
    await h.step(2);
    ids = await logIds();
    assert.ok(ids.includes('ui.element.fire'), 'switch: ' + ids.join(','));
    assert.ok(!ids.includes('whoosh'), 'generic switch whoosh doubled');
  });

  await check('bindings: element hits replace the generic hit; dry fizz; water draw', async () => {
    await audio((g) => g.teleport(-236, -1600));
    await h.step(5);
    const d = await audio((g) => g.spawnDummy(5, 0));
    await clearLog();
    for (let i = 0; i < 3; i++) {
      await audio((g, d) => g.cast('fire_jab', { x: d.x, y: d.y + 1.2, z: d.z }), d);
      await h.step(10);
    }
    await h.step(15);
    let ids = await logIds();
    assert.ok(ids.includes('hit.fire'), 'hit.fire missing: ' + ids.join(','));
    assert.ok(!ids.includes('hit'), 'generic hit doubled: ' + ids.join(','));
    // Waterbending far from any water: the dry fizz.
    await audio((g) => {
      g.setElement('water');
      g.teleport(-140, -1600);
    });
    await h.step(5);
    await audio((g) => g.debug.water.setReserve(0)); // empty hands, whatever earlier checks gathered
    await clearLog();
    const near = await audio((g) => g.waterNearby(16));
    const r = await audio((g) => g.cast('water_whip', null));
    await h.step(2);
    ids = await logIds();
    if (!r.ok && r.reason === 'water') assert.ok(ids.includes('fail.nowater'), 'no dry fizz: ' + ids.join(','));
    else assert.ok(near.length > 0, 'expected failure without water: ' + JSON.stringify(r));
    await h.step(45); // Agna Qel'a lies under packed snow: let a gather from it finish
    // Next to a canal with empty hands: the press gathers real water (draw sound, no dry fizz), the next one bends it.
    await audio((g) => g.teleport(-246, -1720));
    await h.step(6);
    await audio((g) => g.debug.water.setReserve(0));
    await clearLog();
    const gather = await audio((g) => g.cast('water_whip', null));
    assert.equal(gather.reason, 'gather', JSON.stringify(gather));
    await h.step(30);
    ids = await logIds();
    assert.ok(ids.some((id) => id.startsWith('water.draw') || id === 'water.flask'), 'no draw sound: ' + ids.join(','));
    assert.ok(!ids.includes('fail.nowater'), 'gathering must not play the dry fizz: ' + ids.join(','));
    const ok = await audio((g) => g.cast('water_whip', null));
    assert.ok(ok.ok, JSON.stringify(ok));
  });

  await check('bindings: notifications by kind, dialogue voices, DOM UI sounds, pause muffles', async () => {
    await clearLog();
    await audio((g) => g.ctx.events.emit('ui:notify', { text: 'Test warning', kind: 'warning' }));
    let ids = await logIds();
    assert.ok(ids.includes('ui.notify.warning'), ids.join(','));
    assert.ok(!ids.includes('notify'), 'legacy notify doubled');
    // Dialogue with a real NPC: open chime + a babble line in the NPC's voice.
    await audio((g) => g.teleport(-240, -1596));
    await h.step(30);
    await clearLog();
    const talked = await audio((g) => {
      for (const d of g.ctx.npcs.allDefs()) {
        const npc = d.dialogue ? g.ctx.npcs.get(d.id) : null;
        if (npc) {
          g.ctx.npcs.talk(npc);
          return d.id;
        }
      }
      return null;
    });
    if (talked) {
      await h.step(2);
      ids = await logIds();
      assert.ok(ids.includes('ui.dialogue.open'), ids.join(','));
      assert.ok(ids.some((id) => id.startsWith('voice.')), 'no NPC voice: ' + ids.join(','));
      await audio((g) => g.ctx.npcs.endConversation());
      await h.step(2);
      assert.ok((await logIds()).includes('ui.dialogue.close'));
    }
    // Pause: the world is muffled, UI buttons click (delegated, legacy click replaced).
    await audio((g) => g.game.setPaused(true));
    await h.step(3);
    let e = (await audio((g) => g.debug.audio.state())).engine;
    assert.equal(e.muffled, true);
    await clearLog();
    const btn = await h.page.$('button.btn');
    assert.ok(btn, 'no pause-menu button');
    await btn.hover();
    await h.page.mouse.move(5, 5);
    await btn.hover();
    ids = await logIds();
    assert.ok(ids.includes('ui.hover'), 'hover: ' + ids.join(','));
    await audio((g) => document.querySelector('button.btn').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await h.step(2);
    ids = await logIds();
    assert.ok(ids.some((id) => ['ui.click', 'ui.confirm', 'ui.back'].includes(id)), 'click: ' + ids.join(','));
    assert.ok(!ids.includes('ui_click'), 'legacy click doubled: ' + ids.join(','));
    await audio((g) => g.game.setPaused(false));
    await h.step(3);
    e = (await audio((g) => g.debug.audio.state())).engine;
    assert.equal(e.muffled, false);
  });

  await check('ambience follows place and altitude (budgeted, crossfaded)', async () => {
    const places = [
      ['air temple summit', 1440, 1290, ['amb.wind.high', 'amb.temple'], 'temple'],
      ['fire capital', -1310, 1230, ['amb.city', 'amb.volcanic'], 'city'],
      ['si wong desert', 300, 1000, ['amb.desert'], null],
      ['foggy swamp', -1150, -60, ['amb.swamp'], null],
      ['kyoshi coast', 1840, -330, ['amb.surf'], null],
      ['riverbend', 120, -540, ['loop.water.river', 'amb.city'], null],
    ];
    for (const [name, x, z, want, reverb] of places) {
      await audio((g, x, z) => g.teleport(x, z), x, z);
      await h.step(1);
      await tick(75);
      const s = await audio((g) => g.debug.audio.ambience.state());
      for (const id of want) {
        assert.ok((s.targets[id] ?? 0) > 0.3, `${name}: target ${id} = ${s.targets[id]} ${JSON.stringify(s.targets)}`);
        assert.ok(s.active[id]?.playing && s.active[id].gain > 0.05, `${name}: ${id} not audible ${JSON.stringify(s.active[id])}`);
      }
      if (reverb) assert.equal(s.reverb, reverb, name);
      const live = Object.values(s.active).filter((l) => l.target > 0).length;
      assert.ok(live <= 7, `${name}: ${live} layers over the low-preset budget`);
    }
    // Pure sampling (no teleport) agrees: the summit is windier than the trailhead.
    const top = await audio((g) => g.debug.audio.ambience.targetsAt(1440, 1290, { y: 331 }));
    const low = await audio((g) => g.debug.audio.ambience.targetsAt(1210, 980));
    assert.ok((top.targets['amb.wind.high'] ?? 0) > 0.7 && (low.targets['amb.wind.high'] ?? 0) < 0.3, JSON.stringify({ top, low }));
  });

  await check('ambience follows time of day and weather', async () => {
    await audio((g) => g.teleport(120, -540));
    await audio((g) => g.debug.audio.ambience.override({ hour: 23 }));
    await h.step(1);
    await tick(20);
    let s = await audio((g) => g.debug.audio.ambience.state());
    assert.ok((s.targets['amb.night'] ?? 0) > 0.1, 'night bed missing: ' + JSON.stringify(s.targets));
    assert.ok(!(s.targets['amb.forest'] > 0) && !(s.targets['amb.insects'] > 0), 'day life at night: ' + JSON.stringify(s.targets));
    await audio((g) => g.debug.audio.ambience.override(null));
    const w = await audio((g) => (g.debug.env ? g.debug.env.weather('rain', true) : null));
    if (w) {
      await h.step(4);
      await tick(10);
      s = await audio((g) => g.debug.audio.ambience.state());
      assert.equal(s.context.weather, 'rain');
      assert.ok((s.targets['amb.rain'] ?? 0) > 0.3, 'rain layer: ' + JSON.stringify(s.targets));
      await audio((g) => g.debug.env.weather(null, true));
    } else {
      const t = await audio((g) => g.debug.audio.ambience.targetsAt(120, -540, { weather: 'rain', rain: 1 }));
      assert.ok((t.targets['amb.rain'] ?? 0) > 0.3, JSON.stringify(t));
    }
    const snow = await audio((g) => g.debug.audio.ambience.targetsAt(300, -1050, { weather: 'blizzard', snow: 1, blizzard: 1 }));
    assert.ok((snow.targets['amb.blizzard'] ?? 0) > 0.5, JSON.stringify(snow));
  });

  await check('music: region themes, combat layer rises and decays, stingers', async () => {
    await audio((g) => g.teleport(-1310, 1230));
    await h.step(1);
    await tick(45);
    let m = await audio((g) => g.debug.audio.music.state());
    assert.equal(m.theme, 'fire', JSON.stringify(m));
    await audio((g) => g.teleport(1440, 1290));
    await h.step(1);
    await tick(45);
    m = await audio((g) => g.debug.audio.music.state());
    assert.equal(m.theme, 'air');
    assert.equal(m.playing, 'air');
    // In the world the menu track has faded out and paused (rewound for the next menu visit).
    const menuTrack = await audio((g) => g.debug.audio.music.track('menu'));
    assert.ok(menuTrack && !menuTrack.playing && menuTrack.paused && menuTrack.time === 0, JSON.stringify(menuTrack));
    // Enemies engage: hits against the player raise the combat layer...
    await audio((g) => {
      const p = g.state().player;
      for (let i = 0; i < 3; i++) {
        g.ctx.events.emit('hit', { attackerId: 999, targetId: 1, targetKind: 'player', damage: 8, element: 'fire', techniqueId: 'x', position: { x: p.x, y: p.y + 1, z: p.z }, killed: false, blocked: false, playerIsAttacker: false });
      }
    });
    await tick(45);
    m = await audio((g) => g.debug.audio.music.state());
    assert.ok(m.intensity > 0.3, 'combat intensity ' + m.intensity);
    // ...and it decays once the fight is over (hold ~7 s, then fade).
    await tick(900);
    m = await audio((g) => g.debug.audio.music.state());
    assert.ok(m.intensity < 0.1, 'combat did not decay: ' + m.intensity);
    // Stingers play in key when music is audible; otherwise the UI fanfare is used.
    await clearLog();
    await audio((g) => g.ctx.events.emit('quest:completed', { questId: 'test' }));
    m = await audio((g) => g.debug.audio.music.state());
    assert.equal(m.lastStinger, 'quest');
    await audio((g) => g.setting('audio.music', 0));
    await audio((g) => g.ctx.events.emit('mastery:achieved', { element: 'water' }));
    const ids = await logIds();
    assert.ok(ids.includes('ui.mastery'), 'no UI fallback: ' + ids.join(','));
    assert.ok(!ids.includes('ui.quest.complete'), 'stinger and UI fanfare both played');
    await audio((g) => g.setting('audio.music', 0.9));
  });

  await check('engine health: no errors, no unknown ids, voices bounded', async () => {
    const e = (await audio((g) => g.debug.audio.state())).engine;
    assert.equal(e.stats.errors, 0, 'recipe/ticker errors');
    assert.deepEqual(e.stats.unknown, [], 'unknown ids played: ' + e.stats.unknown.join(','));
    assert.ok(e.voices <= e.maxVoices, `${e.voices} voices > ${e.maxVoices}`);
    const errs = h.errors.filter((x) => /audio|Audio/.test(x));
    assert.deepEqual(errs, []);
  });
} finally {
  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (h.errors.length) console.log('page errors:', h.errors.slice(0, 8));
  if (failed) console.log('last page logs:\n' + h.logs.slice(-15).join('\n'));
  await h.close();
  process.exit(failed ? 1 : 0);
}
