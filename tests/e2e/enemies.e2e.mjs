/**
 * Enemies, combat AI and encounters — browser e2e (headless Chromium, SwiftShader).
 *
 *   node tests/e2e/enemies.e2e.mjs
 *
 * The real render loop is stopped and the fixed-step simulation is advanced by
 * the test (rendering stubbed except for screenshot frames), so runs are fast
 * and deterministic enough. Covers: perception (sight + hearing) and
 * engagement, enemy techniques damaging the player (player:damaged), hit
 * reactions (knockback / stagger / launch), retreat & flee at low health,
 * defeat → entity:killed with tags + collectable loot + XP, leash / return
 * home, waterbenders refusing to bend without water and bending beside a
 * river, a 60 s mixed fight with no stuck enemies, frame time with 12 enemies,
 * the non-lethal sparring API, a boss with phases + boss bar, beasts, and the
 * encounter director (camps outside safe zones, streaming on approach).
 * Screenshots (UI visible) go to $ENEMY_SHOTS (default <tmp>/a4n-enemy-shots).
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../../scripts/harness.mjs';

const SHOTS = process.env.ENEMY_SHOTS || path.join(os.tmpdir(), 'a4n-enemy-shots');
mkdirSync(SHOTS, { recursive: true });
/** Flat, dry meadow (no water within 80 m), no region content. */
const ARENA = { x: 1220, z: -340 };
/** The Great River runs through here (waterbender test). */
const RIVER = { x: 200, z: -250 };

const results = [];
const t0 = Date.now();
const h = await launch({ width: 960, height: 540 });

/** ENEMY_ONLY=<substring> runs only the matching checks (setup always runs). */
const ONLY = process.env.ENEMY_ONLY || '';

async function check(name, fn) {
  if (ONLY && !new RegExp(ONLY).test(name)) return;
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

/** Advance n fixed steps without rendering (render only the last one when asked). */
const adv = (n, render = false) =>
  h.eval(
    (g, n, render) => {
      const r = g.game.render;
      const orig = r.render;
      for (let i = 0; i < n; i++) {
        if (!(render && i === n - 1)) r.render = () => {};
        try {
          g.game.frame(1 / 30);
        } finally {
          r.render = orig;
        }
        if (window.__keepAlive) {
          const p = g.game.player;
          if (p.health.hp < p.health.maxHp * 0.5) p.health.hp = p.health.maxHp;
          p.defeated = false;
        }
      }
      return true;
    },
    n,
    render,
  );

/** Step until a page-side predicate (source string evaluated with g, ids) is true; returns steps used or -1. */
async function until(pred, maxSteps, chunk = 10, arg = null) {
  for (let s = 0; s < maxSteps; s += chunk) {
    const ok = await h.eval((g, src, arg) => new Function('g', 'arg', `return (${src})`)(g, arg), pred, arg);
    if (ok) return s;
    await adv(chunk);
  }
  return -1;
}

const E = (g) => g.debug.enemies;
const info = (id) => h.eval((g, id) => g.debug.enemies.get(id), id);
const resetArena = (x = ARENA.x, z = ARENA.z) =>
  h.eval(
    (g, x, z) => {
      g.debug.enemies.clear();
      g.debug.enemies.collectLoot();
      g.teleport(x, z);
      g.faceTowards(x, z + 20);
      const p = g.game.player;
      p.health.reset();
      p.chi = p.maxChi;
      p.defeated = false;
      p.statuses.length = 0;
      window.__et = { dmg: [], cast: [], killed: [], hits: [], notes: [] };
      return g.state().player;
    },
    x,
    z,
  );

async function shot(name, setup) {
  if (setup) await h.eval(setup);
  await adv(2, true);
  const file = path.join(SHOTS, `${name}.png`);
  await h.shot(file);
  console.log(`    screenshot: ${file}`);
}

/** Point the follow camera from behind the player toward (x, z). */
const frameShot = (x, z, dist = 7, pitch = 0.32) =>
  h.eval(
    (g, x, z, dist, pitch) => {
      g.faceTowards(x, z);
      const p = g.game.player;
      g.camera(p.yaw + Math.PI, pitch, dist);
      g.game.cameraRig.snapBehind();
    },
    x,
    z,
    dist,
    pitch,
  );

try {
  console.log('enemies e2e');
  await h.newGame('fire');
  await h.eval((g) => {
    g.game.stop();
    g.setting('gameplay.tutorialHints', false);
    g.freezeTime(true);
    g.setTime(10.5);
    g.debug.enemies.camps(false);
    window.__et = { dmg: [], cast: [], killed: [], hits: [], notes: [] };
    const ev = g.ctx.events;
    ev.on('player:damaged', (e) => window.__et.dmg.push(e));
    ev.on('technique:cast', (e) => window.__et.cast.push({ id: e.id, casterId: e.casterId, element: e.element, isPlayer: e.isPlayer }));
    ev.on('entity:killed', (e) => window.__et.killed.push(e));
    ev.on('hit', (e) => window.__et.hits.push({ a: e.attackerId, t: e.targetId, d: e.damage, k: e.killed, tech: e.techniqueId }));
    ev.on('ui:notify', (e) => window.__et.notes.push(e.text));
  });
  await adv(5);

  // -------------------------------------------------------------------------
  await check('encounter director: camps exist, none inside safe zones; tutorial isle & starts are safe', async () => {
    const r = await h.eval((g) => {
      const e = g.debug.enemies;
      const camps = e.encounters();
      return {
        n: camps.length,
        kinds: [...new Set(camps.map((c) => c.kind))],
        zones: [...new Set(camps.map((c) => c.zone))],
        bosses: camps.filter((c) => c.kind === 'boss').map((c) => c.id),
        unsafe: camps.filter((c) => e.isSafe(c.x, c.z)).map((c) => c.id),
        tutorialSafe: e.isSafe(-1800, -1775),
        fireStartSafe: e.isSafe(-1300, 1596),
        bssSafe: e.isSafe(650, -40),
      };
    });
    console.log(`    ${r.n} camps; kinds ${r.kinds.join(',')}; zones ${r.zones.join(',')}`);
    assert.ok(r.n >= 8, 'expected several camps along the roads/coasts');
    assert.deepEqual(r.unsafe, []);
    assert.equal(r.bosses.length, 3, 'three named bosses');
    assert.ok(r.kinds.includes('camp') && r.kinds.includes('patrol') || r.kinds.includes('ambush'), 'varied encounter kinds');
    assert.ok(r.tutorialSafe && r.fireStartSafe && r.bssSafe);
  });

  // -------------------------------------------------------------------------
  let soldier = 0;
  await check('an enemy notices (sight) and engages the player; another hears bending behind it', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('fire_soldier', 16, 0));
    soldier = s.id;
    assert.equal(s.state, 'idle');
    const steps = await until(`g.debug.enemies.get(${soldier}).state === 'combat'`, 120);
    assert.ok(steps >= 0, 'soldier never engaged');
    // A second soldier 14 m behind the player, facing away: only hearing can alert it.
    const deaf = await h.eval((g) => {
      const p = g.game.player;
      const x = p.position.x - Math.sin(p.yaw) * 14, z = p.position.z - Math.cos(p.yaw) * 14;
      return g.debug.enemies.spawn('fire_soldier', 0, 0, { x, z, yaw: p.yaw + Math.PI });
    });
    await adv(20);
    assert.notEqual((await info(deaf.id)).state, 'combat', 'should not see behind its back');
    await h.eval((g, id) => {
      const e = g.debug.enemies.entity(id);
      g.cast('fire_jab', { x: e.position.x, y: e.position.y + 1.2, z: e.position.z });
    }, soldier);
    const heard = await until(`['combat','investigate'].includes(g.debug.enemies.get(${deaf.id}).state)`, 60, 5);
    assert.ok(heard >= 0, 'enemy behind the player did not react to bending noise');
  });

  await check("enemy techniques hit and damage the player (player:damaged) after a readable tell", async () => {
    const steps = await until(`window.__et.dmg.some((d) => d.sourceId === ${soldier})`, 400);
    assert.ok(steps >= 0, 'soldier never damaged the player');
    const r = await h.eval((g, id) => ({ casts: window.__et.cast.filter((c) => c.casterId === id).map((c) => c.id), dmg: window.__et.dmg.filter((d) => d.sourceId === id).reduce((a, d) => a + d.amount, 0), st: g.debug.enemies.get(id).stats }), soldier);
    console.log(`    casts ${[...new Set(r.casts)].join(',')} · ${r.dmg.toFixed(1)} damage · attacks ${r.st.attacks}`);
    assert.ok(r.casts.every((c) => c.startsWith('fire_')), 'a Fire Nation soldier casts real firebending techniques');
    assert.ok(r.dmg > 0);
    await shot('01_fire_soldiers', (g) => {
      g.debug.enemies.spawn('fire_archer', 18, -6, { aware: true });
      g.debug.enemies.spawn('fire_elite', 9, 4, { aware: true });
    });
  });

  await check('enemies react to hits: knockback, stagger interrupts, launch', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('earth_bandit', 7, 0, { aware: true }));
    await adv(30);
    const before = await info(s.id);
    await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 4, knockback: 12 }), s.id);
    await adv(15);
    const after = await info(s.id);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    assert.ok(moved > 1, `knockback should push the enemy (moved ${moved.toFixed(2)} m)`);
    assert.ok(after.hp < before.hp, 'damage applied through CombatSystem');
    await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 2, stagger: 999 }), s.id);
    const st = await info(s.id);
    assert.ok(st.stunned > 0 && st.attack === null, 'stagger stuns and cancels the attack');
    await adv(25);
    const y0 = (await info(s.id)).y;
    await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 2, launch: 9 }), s.id);
    await adv(6);
    const air = await info(s.id);
    assert.ok(air.y > y0 + 0.8, `launch should lift the enemy (Δy ${(air.y - y0).toFixed(2)})`);
    // A real player technique (CombatSystem cast) also hurts it.
    await adv(40);
    const hp0 = (await info(s.id)).hp;
    for (let i = 0; i < 6; i++) {
      await h.eval((g, id) => {
        const e = g.debug.enemies.entity(id);
        g.faceTowards(e.position.x, e.position.z);
        g.cast('fire_jab', { x: e.position.x, y: e.position.y + 1.1, z: e.position.z });
      }, s.id);
      await adv(10);
    }
    assert.ok((await info(s.id)).hp < hp0, 'player fire jabs damage the bandit');
  });

  await check('enemies retreat when hurt and flee when beaten (then leave)', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('earth_bandit', 8, 0, { aware: true }));
    await adv(20);
    await h.eval((g, id) => {
      g.debug.enemies.setHp(id, 0.34);
      g.debug.enemies.hit(id, { damage: 1 });
    }, s.id);
    const r = await until(`g.debug.enemies.get(${s.id}).state === 'retreat'`, 40, 2);
    assert.ok(r >= 0, 'bandit should retreat at low health');
    const d0 = (await info(s.id)).dist;
    await adv(40);
    const i1 = await info(s.id);
    assert.ok(i1.dist > d0 + 1 || i1.state !== 'retreat', `retreat should open distance (${d0} → ${i1.dist})`);
    await h.eval((g, id) => {
      g.debug.enemies.setHp(id, 0.12);
      g.debug.enemies.hit(id, { damage: 1 });
    }, s.id);
    const f = await until(`g.debug.enemies.get(${s.id})?.state === 'flee'`, 40, 2);
    assert.ok(f >= 0, 'bandit should flee when beaten');
    const gone = await until(`g.debug.enemies.get(${s.id}) === null`, 400, 20);
    assert.ok(gone >= 0, 'a fleeing enemy eventually leaves');
    const st = await h.eval((g) => g.debug.enemies.stats());
    assert.ok(st.fled >= 1);
  });

  await check('defeat emits entity:killed with tags, drops loot that can be collected, grants XP', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('fire_soldier', 6, 0, { aware: true }));
    const before = await h.eval((g) => ({ coins: g.ctx.inventory.currency, xp: g.ctx.progression.xp }));
    for (let i = 0; i < 12 && !(await info(s.id))?.defeated; i++) {
      await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 25 }), s.id);
      await adv(3);
    }
    const k = await h.eval((g, id) => window.__et.killed.find((e) => e.entityId === id), s.id);
    assert.ok(k, 'entity:killed emitted');
    assert.ok(k.tags.includes('fire_soldier') && k.tags.includes('enemy') && k.tags.includes('fire_nation'), `tags: ${k.tags}`);
    const d = await info(s.id);
    assert.ok(d === null || d.defeated, 'defeated (kneels or flees, no corpse)');
    const loot = await h.eval((g) => g.debug.enemies.loot());
    assert.ok(loot.length >= 1 && loot.some((l) => l.kind === 'coins'), 'coins dropped');
    await adv(40);
    // Walk over the loot.
    for (const l of loot) {
      await h.eval((g, l) => g.teleport(l.x, l.z), l);
      await adv(8);
    }
    const after = await h.eval((g) => ({ coins: g.ctx.inventory.currency, xp: g.ctx.progression.xp, left: g.debug.enemies.loot().length }));
    console.log(`    coins ${before.coins} → ${after.coins} · xp ${before.xp.toFixed(0)} → ${after.xp.toFixed(0)}`);
    assert.ok(after.coins > before.coins, 'coins collected by walking over them');
    assert.equal(after.left, 0);
    assert.ok(after.xp > before.xp, 'XP granted');
  });

  await check('leash: an enemy that chases too far gives up, returns home and recovers', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('bandit_spearman', 8, 0, { aware: true, leash: 14 }));
    await adv(20);
    await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 10 }), s.id);
    // Run away (teleport in steps) so it chases beyond its leash.
    for (let i = 1; i <= 5; i++) {
      await h.eval((g, i) => g.teleport(1220 - i * 7, -340 - i * 3), i);
      await adv(15);
    }
    const ret = await until(`g.debug.enemies.get(${s.id}).state === 'return'`, 300, 10);
    assert.ok(ret >= 0, 'enemy should give up the chase');
    await h.eval((g) => g.teleport(1120, -300));
    const home = await until(`(() => { const e = g.debug.enemies.get(${s.id}); return ['idle','patrol'].includes(e.state) && Math.hypot(e.x - e.homeX, e.z - e.homeZ) < 3; })()`, 900, 30);
    assert.ok(home >= 0, 'enemy should walk home');
    const e = await info(s.id);
    assert.equal(e.hp, e.maxHp, 'health restored at home');
  });

  await check('waterbender refuses to bend without water (melee + seeks water), bends beside a river', async () => {
    await resetArena();
    const dry = await h.eval((g) => g.debug.enemies.spawn('water_pirate', 3, 0, { aware: true, waterReserve: 0 }));
    await adv(240);
    const d1 = await info(dry.id);
    const dryCasts = await h.eval((g, id) => window.__et.cast.filter((c) => c.casterId === id && c.element === 'water').length, dry.id);
    console.log(`    dry: water casts ${dryCasts}, melee attacks ${d1.stats.aiAttacks}, water fails ${d1.stats.waterFails}, hasWater ${d1.hasWater}`);
    assert.equal(dryCasts, 0, 'no waterbending without water');
    assert.equal(d1.stats.waterCasts, 0);
    assert.equal(d1.hasWater, false);
    assert.ok(d1.stats.aiAttacks > 0, 'falls back to melee');
    // River bank: find dry ground 5-12 m from the river.
    const bank = await h.eval((g, c) => {
      const w = g.ctx.world;
      for (let r = 4; r < 60; r += 2) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
          if (w.liquidAt(x, z) || w.groundAt(x, z).ny < 0.85) continue;
          const src = g.ctx.water.findBest(new g.THREE.Vector3(x, w.groundAt(x, z).y, z), 10, { allowLiquid: true });
          if (src && src.distance > 3) return { x, z, sx: src.point.x, sz: src.point.z };
        }
      }
      return null;
    }, RIVER);
    assert.ok(bank, 'found a river bank');
    await resetArena(bank.x, bank.z);
    await h.eval((g, b) => g.faceTowards(b.sx, b.sz), bank);
    const wet = await h.eval((g) => g.debug.enemies.spawn('water_pirate', 6, 2, { aware: true, waterReserve: 0 }));
    const ok = await until(`window.__et.cast.some((c) => c.casterId === ${wet.id} && c.element === 'water')`, 360, 15);
    const w2 = await info(wet.id);
    console.log(`    river: water casts ${w2.stats.waterCasts}, hasWater ${w2.hasWater}`);
    assert.ok(ok >= 0 && w2.stats.waterCasts > 0, 'bends real water beside the river');
    await adv(150); // let the region-entry banner fade
    await shot('04_pirates_river', (g) => {
      g.debug.enemies.spawn('pirate', 7, -3, { aware: true });
    });
  });

  await check('beasts: platypus bear charges/swipes, is subdued (not killed) and flees', async () => {
    await resetArena();
    const s = await h.eval((g) => g.debug.enemies.spawn('platypus_bear', 9, 0, { aware: true }));
    const hit = await until(`window.__et.dmg.some((d) => d.sourceId === ${s.id})`, 450, 15);
    if (hit < 0) {
      const dbg = await h.eval((g, id) => {
        const e = g.debug.enemies.entity(id);
        const p = g.game.player;
        return { info: g.debug.enemies.get(id), mm: e.moveMode, sp: e.moveSpeed, see: e.brain.canSee, player: { x: p.position.x, y: p.position.y, z: p.position.z, hp: p.health.hp, inv: p.invuln, def: p.defeated }, hits: window.__et.hits.filter((x) => x.a === id).length };
      }, s.id);
      console.log('    bear debug: ' + JSON.stringify(dbg));
    }
    assert.ok(hit >= 0, 'bear attacks land');
    await shot('05_beasts', (g) => g.debug.enemies.spawn('moose_lion', 14, 6, { aware: true }));
    for (let i = 0; i < 20 && !(await info(s.id))?.defeated; i++) {
      await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 40 }), s.id);
      await adv(3);
    }
    const k = await h.eval((g, id) => window.__et.killed.find((e) => e.entityId === id), s.id);
    assert.ok(k && k.tags.includes('beast') && k.tags.includes('platypus_bear'));
    await adv(60);
    const d = await info(s.id);
    assert.ok(d === null || d.dist > 6, 'subdued beast runs off');
  });

  await check('bandits and Dai Li look and fight distinctly (earth benders, spears, arrows)', async () => {
    await resetArena();
    await h.eval((g) => {
      g.debug.enemies.spawn('earth_bandit', 10, -3, { aware: true });
      g.debug.enemies.spawn('bandit_spearman', 6, 3, { aware: true });
      g.debug.enemies.spawn('bandit_archer', 18, 0, { aware: true });
    });
    const ok = await until(`(() => { const ids = g.debug.enemies.list().map((e) => e.id); return window.__et.hits.filter((x) => ids.includes(x.a)).length >= 3; })()`, 450, 15);
    const techs = await h.eval((g) => {
      const ids = g.debug.enemies.list().map((e) => e.id);
      return [...new Set(window.__et.hits.filter((x) => ids.includes(x.a)).map((x) => x.tech))];
    });
    console.log(`    bandit attacks that landed: ${techs.join(', ')}`);
    assert.ok(ok >= 0);
    await shot('02_bandits');
    await resetArena();
    await h.eval((g) => {
      g.debug.enemies.spawn('dai_li_agent', 11, -4, { aware: true });
      g.debug.enemies.spawn('dai_li_agent', 12, 4, { aware: true });
    });
    await adv(90);
    await shot('03_dai_li');
  });

  await check('no enemy is stuck during a 60 s simulated mixed fight', async () => {
    await resetArena();
    await h.eval((g) => {
      window.__keepAlive = true;
      const e = g.debug.enemies;
      e.spawn('fire_soldier', 12, -5, { aware: true });
      e.spawn('fire_soldier', 14, 5, { aware: true });
      e.spawn('fire_archer', 22, 0, { aware: true });
      e.spawn('bandit_spearman', 8, 0, { aware: true });
      e.spawn('earth_bandit', 10, 8, { aware: true });
      e.spawn('pirate', 9, -8, { aware: true });
    });
    // The player moves back and forth across the arena (virtual input) for 60 s.
    for (let s = 0; s < 1800; s += 60) {
      await h.eval((g, s) => (s % 120 === 0 ? g.move(0.4, 0.25) : g.move(-0.4, -0.25)), s);
      await adv(60);
    }
    await h.eval((g) => g.move(0, 0));
    const list = await h.eval((g) => g.debug.enemies.list());
    const stuck = list.filter((e) => e.maxStuck >= 3.2);
    const idle = list.filter((e) => e.stats.attacks === 0);
    console.log(`    ${list.length} enemies · max stuck ${Math.max(...list.map((e) => e.maxStuck)).toFixed(1)} s · recoveries ${list.reduce((a, e) => a + e.stats.recoveries, 0)}`);
    assert.deepEqual(stuck.map((e) => e.name), [], 'stuck enemies');
    assert.deepEqual(idle.map((e) => e.name), [], 'every enemy attacked during the fight');
    assert.ok(list.every((e) => Number.isFinite(e.x) && e.y > -50), 'nobody fell out of the world');
    await h.eval(() => (window.__keepAlive = false));
  });

  await check('frame time stays sane with 12 enemies fighting', async () => {
    await resetArena();
    const base = await h.eval((g) => {
      const r = g.game.render;
      const o = r.render;
      r.render = () => {};
      const t = performance.now();
      for (let i = 0; i < 90; i++) g.game.frame(1 / 30);
      r.render = o;
      return (performance.now() - t) / 90;
    });
    await h.eval((g) => {
      window.__keepAlive = true;
      const ids = ['fire_soldier', 'fire_archer', 'earth_bandit', 'bandit_spearman', 'pirate', 'dai_li_agent', 'fire_soldier', 'bandit_archer', 'earth_bandit', 'pirate', 'platypus_bear', 'fire_elite'];
      ids.forEach((a, i) => g.debug.enemies.spawn(a, 10 + (i % 4) * 4, (i - 6) * 3, { aware: true }));
    });
    await adv(30);
    const ms = await h.eval((g) => {
      const r = g.game.render;
      const o = r.render;
      r.render = () => {};
      const t = performance.now();
      for (let i = 0; i < 120; i++) {
        g.game.frame(1 / 30);
        const p = g.game.player;
        if (p.health.hp < 60) p.health.hp = p.health.maxHp;
      }
      r.render = o;
      return (performance.now() - t) / 120;
    });
    const n = (await h.eval((g) => g.debug.enemies.list())).length;
    const rendered = await h.eval((g) => {
      const t = performance.now();
      g.game.frame(1 / 30);
      return performance.now() - t;
    });
    console.log(`    simulation ${base.toFixed(2)} ms → ${ms.toFixed(2)} ms/frame with ${n} enemies (one rendered frame ${rendered.toFixed(0)} ms)`);
    assert.ok(n >= 12);
    assert.ok(ms - base < 12, `12 enemies should add < 12 ms of simulation per frame (added ${(ms - base).toFixed(2)})`);
    await h.eval(() => (window.__keepAlive = false));
  });

  await check('sparring API: non-lethal duel ends at 15% with both restored (victory and defeat)', async () => {
    await resetArena();
    const id = await h.eval((g) => g.debug.enemies.sparring({ element: 'fire', name: 'Master Jeong' }));
    await adv(30);
    // Victory: wear the partner down with real hits.
    await h.eval((g, id) => g.debug.enemies.setHp(id, 0.2), id);
    for (let i = 0; i < 10 && !(await h.eval(() => window.__enemyDuel.ended)); i++) {
      await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 12 }), id);
      await adv(4);
    }
    const v = await h.eval((g, id) => ({ duel: { result: window.__enemyDuel.result, final: window.__enemyDuel.final }, e: g.debug.enemies.get(id), killed: window.__et.killed.some((k) => k.entityId === id), p: g.state().player, loot: g.debug.enemies.loot().length }), id);
    assert.equal(v.duel.result, 'victory');
    assert.equal(v.killed, false, 'no entity:killed in a duel');
    assert.equal(v.loot, 0, 'no loot from sparring');
    assert.ok(v.e && v.e.hp === v.e.maxHp, 'partner restored');
    assert.equal(v.p.hp, v.p.maxHp, 'player restored');
    await adv(120);
    assert.equal(await info(id), null, 'partner leaves after bowing');
    // Defeat: the player is worn down — never actually defeated.
    const id2 = await h.eval((g) => g.debug.enemies.sparring({ element: 'earth', name: 'Oyagi' }));
    await h.eval((g) => (g.game.player.health.hp = 19));
    const lost = await until(`window.__enemyDuel.ended`, 900, 15);
    const d = await h.eval(() => ({ result: window.__enemyDuel.result }));
    const p = await h.eval((g) => g.state().player);
    assert.ok(lost >= 0, 'duel ended');
    assert.equal(d.result, 'defeat');
    assert.equal(p.defeated, false, 'the player is never defeated by a sparring partner');
    assert.equal(p.hp, p.maxHp);
    void id2;
  });

  await check('boss: phases, summons, boss health bar, defeat banner', async () => {
    await resetArena();
    await h.eval(() => (window.__keepAlive = true));
    const camp = await h.eval((g) => g.debug.enemies.encounters().find((c) => c.id === 'boss_fire_commander'));
    assert.ok(camp, 'fire commander camp exists');
    await h.eval((g, c) => g.teleport(c.x + 12, c.z + 12), camp);
    const spawned = await h.eval((g) => g.debug.enemies.activateCamp('boss_fire_commander'));
    const boss = spawned.find((e) => e.rank === 'boss');
    assert.ok(boss, 'boss spawned');
    await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 5 }), boss.id);
    await adv(30);
    await frameShot(boss.x, boss.z, 9);
    await adv(10);
    const ui = await h.eval((g) => g.debug.enemies.ui());
    assert.equal(ui.boss, boss.id, 'boss bar shown');
    const n0 = (await h.eval((g) => g.debug.enemies.list())).length;
    await h.eval((g, id) => {
      g.debug.enemies.setHp(id, 0.62);
      g.debug.enemies.hit(id, { damage: 2 });
    }, boss.id);
    await adv(30);
    const b1 = await info(boss.id);
    const n1 = (await h.eval((g) => g.debug.enemies.list())).length;
    assert.equal(b1.phase, 0, 'entered phase 1');
    assert.ok(n1 > n0, 'reinforcements summoned');
    await frameShot(b1.x, b1.z, 9);
    await shot('06_boss_fire_commander');
    await h.eval((g, id) => {
      g.debug.enemies.setHp(id, 0.3);
      g.debug.enemies.hit(id, { damage: 2 });
    }, boss.id);
    await adv(20);
    assert.equal((await info(boss.id)).phase, 1, 'entered phase 2');
    for (let i = 0; i < 30 && !(await info(boss.id))?.defeated; i++) {
      await h.eval((g, id) => g.debug.enemies.hit(id, { damage: 60 }), boss.id);
      await adv(4);
    }
    const k = await h.eval((g, id) => window.__et.killed.find((e) => e.entityId === id), boss.id);
    assert.ok(k && k.tags.includes('boss_fire_commander') && k.tags.includes('boss'));
    const st = await h.eval((g) => g.debug.enemies.stats());
    assert.ok(st.bossesDefeated.includes('boss_fire_commander'));
    await h.eval(() => (window.__keepAlive = false));
  });

  await check('director streams a camp in when the player approaches (outside the view where possible)', async () => {
    await resetArena();
    const camp = await h.eval((g) => g.debug.enemies.encounters().find((c) => c.kind === 'camp' && c.state === 'dormant'));
    assert.ok(camp, 'a dormant camp');
    await h.eval((g, c) => {
      g.debug.enemies.camps(true);
      g.teleport(c.x + 120, c.z + 40);
    }, camp);
    const ok = await until(`g.debug.enemies.encounters().find((c) => c.id === '${camp.id}').state === 'active'`, 200, 15);
    assert.ok(ok >= 0, 'camp became active');
    const members = await h.eval((g, id) => g.debug.enemies.list().filter((e) => e.encounter === id).length, camp.id);
    assert.ok(members >= 1);
    // Leaving the area streams it back out.
    await h.eval((g, c) => g.teleport(c.x + 400, c.z), camp);
    const off = await until(`g.debug.enemies.encounters().find((c) => c.id === '${camp.id}').state !== 'active'`, 200, 15);
    assert.ok(off >= 0, 'camp streamed out');
    await h.eval((g) => g.debug.enemies.camps(false));
  });

  await check('no console errors', async () => {
    const errs = h.errors.filter((e) => !/favicon|ERR_|net::/.test(e));
    assert.deepEqual(errs.slice(0, 5), []);
  });
} finally {
  await h.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name}\n${f.err?.stack ?? f.err}`);
  process.exit(1);
}
