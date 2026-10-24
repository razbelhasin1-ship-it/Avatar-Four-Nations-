/**
 * Avatar State / Elements Sphere / ultimates e2e (deterministic h.step-style
 * simulation; the render loop is stopped and only screenshot frames render).
 *
 *   node tests/e2e/avatar.e2e.mjs            # gameplay checks (+ a few shots)
 *   AVATAR_SHOTS=/dir node tests/e2e/avatar.e2e.mjs
 *   AVATAR_BEAUTY=1 ...                      # medium-preset beauty shots too
 *
 * Covers: the rebindable input enters the standard state before mastery
 * (boosts applied, wave knocks a dummy back, glow/hover/wind), clean exit,
 * spirit drain / regen / empty-spirit exit, the same input entering the
 * Elements Sphere after masterAll (sequence + formation follows the player,
 * HUD shows the five ultimates), every ultimate damaging and displacing
 * weighted sparring dummies, lights/effects removed on deactivate, counts back
 * to baseline after 10 activations, travel and save/load safety.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../../scripts/harness.mjs';

const ARENA = { x: -300, z: 450 }; // empty flat meadow away from region content, no water within 30 m
const SHOTS = process.env.AVATAR_SHOTS || path.join(os.tmpdir(), 'a4n-avatar-shots');
const BEAUTY = !!process.env.AVATAR_BEAUTY;
mkdirSync(SHOTS, { recursive: true });

const results = [];
/** Gameplay-only checks are skipped by the (medium preset) beauty-shot run. */
async function gcheck(name, fn) {
  if (!BEAUTY) await check(name, fn);
}
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e && e.message ? e.message.slice(0, 600) : String(e)]);
  }
}

/** In-page helpers (window.__av). */
function install(g, arena) {
  const av = {
    /** Back to the arena, facing south (+Z). */
    home() {
      g.teleport(arena.x, arena.z);
      g.faceTowards(arena.x, arena.z + 40);
    },
    /** Advance n fixed steps without rendering (fast on SwiftShader). */
    adv(n) {
      const r = g.game.render;
      const orig = r.render;
      r.render = () => {};
      try {
        for (let i = 0; i < n; i++) g.game.frame(1 / 30);
      } finally {
        r.render = orig;
      }
    },
    /** One rendered frame (for screenshots). */
    draw() {
      g.game.frame(1 / 30);
    },
    counts() {
      const c = g.debug.avatar.counts();
      let named = 0;
      g.ctx.scene.traverse((o) => {
        if (o.name === 'avatar_aura' || o.name === 'elements_sphere') named++;
      });
      return { ...c, named, colliders: g.debug.bending.stats().bendingColliders };
    },
    spawn(dist, side, hp = 600) {
      return g.debug.bending.spawnTarget(dist, side, hp);
    },
    clearTargets() {
      for (const e of [...g.ctx.entities.all()]) if (e.kind === 'target') g.ctx.entities.remove(e);
    },
    refresh() {
      g.debug.bending.refresh();
      g.debug.avatar.setSpirit(100);
    },
    glow() {
      const cu = g.game.player.humanoid.material.cu;
      return { eye: cu.uEyeGlow.value, tat: cu.uTatGlow.value, rim: cu.uRim.value };
    },
    target(id) {
      return g.debug.bending.target(id);
    },
    /** Facing used by frame() (null = the player's current yaw); set to the cast direction for ultimate shots. */
    frameYaw: null,
    /** Free camera relative to the player (forward f, side s, up u) looking at a point offset (lf, ls, lu). */
    frame(f, s, u, lf = 0, ls = 0, lu = 1.2) {
      const p = g.game.player;
      const yaw = av.frameYaw ?? p.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const sx = -fz, sz = fx;
      const at = (a, b, c) => ({ x: p.position.x + fx * a + sx * b, y: p.position.y + c, z: p.position.z + fz * a + sz * b });
      g.freeCamera(at(f, s, u), at(lf, ls, lu));
    },
  };
  window.__av = av;
  return true;
}

const PRESET = BEAUTY ? 'medium' : 'low';
const h = await launch({ width: 960, height: 540, preset: PRESET });
const ev = (fn, ...args) => h.eval(fn, ...args);
const shot = async (name) => {
  await ev(() => window.__av.draw());
  const f = path.join(SHOTS, name);
  await h.shot(f, { timeout: 120000 });
  return f;
};

try {
  await h.newGame('air'); // Air Nomad default: arrow tattoos
  await ev((g) => {
    g.game.stop();
    g.freezeTime(true);
    g.setTime(13);
    g.hideUI(true);
  });
  await ev(install, ARENA);
  await ev(() => window.__av.home());
  await ev(() => window.__av.adv(30));

  /** Medium-preset beauty shots: standard state without and with tattoos, then the sphere build-up (leaves the sphere active). */
  async function beautyShots() {
    await check('beauty shots (medium preset, UI hidden)', async () => {
      await ev((g) => {
        window.__av.home();
        g.setTime(16.5);
        window.__av.clearTargets();
        g.debug.avatar.setSpirit(100);
      });
      await ev(() => window.__av.adv(30));
      // Non-tattooed character, standard state (temporarily lock the sphere).
      await ev((g) => {
        const a = structuredClone(g.game.player.appearance);
        a.tattoos = 'none';
        g.game.player.setAppearance(a);
        g.ctx.progression.elementsSphereUnlocked = false;
      });
      await ev((g) => g.debug.avatar.press());
      await ev(() => window.__av.adv(26));
      await ev(() => window.__av.frame(3.4, 0.8, 1.5, 0, 0, 1.15));
      await shot('beauty_state_no_tattoos.png');
      await ev((g) => g.debug.avatar.press());
      await ev(() => window.__av.adv(20));
      await ev((g) => {
        const a = structuredClone(g.game.player.appearance);
        a.tattoos = 'arrows';
        g.game.player.setAppearance(a);
      });
      await ev((g) => g.debug.avatar.press());
      await ev(() => window.__av.adv(26));
      await ev(() => window.__av.frame(3.4, -0.8, 1.5, 0, 0, 1.15));
      await shot('beauty_state_tattooed.png');
      await ev((g) => g.debug.avatar.press());
      await ev(() => window.__av.adv(20));
      // Elements Sphere build-up frames (the spirit-vision story moment is covered by masters.e2e; skip it here).
      await ev((g) => (g.ctx.quests.setFlag('sphere_vision'), g.masterAll()));
      await ev((g) => g.debug.avatar.press());
      const frames = [[16, 'a_air'], [12, 'b_water'], [14, 'c_earth'], [14, 'd_fire'], [30, 'e_formation']];
      for (const [n, name] of frames) {
        await ev((g, n) => window.__av.adv(n), n);
        await ev(() => window.__av.frame(5.2, 1.6, 2.2, 0, 0, 1.2));
        await shot(`beauty_sphere_${name}.png`);
      }
      await ev((g) => g.freeCamera(null));
    });
  }

  let baseline;
  await check('baseline: inactive, identity boosts, no avatar visuals', async () => {
    const s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.active, false);
    assert.equal(s.sphere, false);
    assert.equal(s.boosts.power, 1);
    baseline = await ev(() => window.__av.counts());
    assert.equal(baseline.named, 0);
    assert.equal(baseline.hover, 0);
  });

  await check('standard Avatar State via the (rebindable) input: boosts, wave, glow, hover, wind', async () => {
    const before = await ev((g) => ({ power: g.game.player.powerMultiplier(), range: g.ctx.water.rangeFor(g.game.player), cd: g.ctx.combat.cooldownFraction ? 1 : 1 }));
    const dummy = await ev(() => window.__av.spawn(3.5, 0));
    await ev(() => window.__av.adv(2));
    const p0 = await ev((g, id) => window.__av.target(id), dummy.id);
    const on = await ev((g) => g.debug.avatar.press());
    assert.equal(on, true, 'press enters the state');
    let s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.sphere, false, 'standard state before mastery');
    assert.ok(s.transition > 0 && s.transition < 1, 'transformation shorter than 1 s: ' + s.transition);
    await ev(() => window.__av.adv(24));
    s = await ev((g) => g.debug.avatar.state());
    const after = await ev((g) => ({ power: g.game.player.powerMultiplier(), range: g.ctx.water.rangeFor(g.game.player) }));
    assert.ok(Math.abs(after.power / before.power - 1.5) < 0.01, `power x1.5 (${before.power} -> ${after.power})`);
    assert.ok(after.range > before.range * 1.7, 'water draw range boosted');
    assert.equal(s.boosts.cooldown, 0.6);
    assert.ok(s.boosts.damageTaken < 1 && s.boosts.chiRegen > 0);
    const p1 = await ev((g, id) => window.__av.target(id), dummy.id);
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    assert.ok(moved > 0.5, 'activation wave knocked the dummy back: ' + moved.toFixed(2));
    assert.ok(p1.totalDamage > 0, 'wave hit through CombatSystem');
    const glow = await ev(() => window.__av.glow());
    assert.ok(glow.eye > 0.9 && glow.tat > 0.9, 'eyes + tattoos glow: ' + JSON.stringify(glow));
    const c = await ev(() => window.__av.counts());
    assert.ok(c.hover > 0.1, 'levitation hover ' + c.hover);
    assert.ok(c.wind > 1, 'hair/cloth wind ' + c.wind);
    assert.equal(c.named, 1, 'aura present');
    assert.ok(c.bloomBoost > 0.1);
    // HUD shows the boosts.
    const hud = await h.page.evaluate(() => document.querySelector('.spirit-info')?.textContent ?? '');
    assert.ok(/power/.test(hud) && /cd/.test(hud), 'HUD boost readout: ' + hud);
    await ev(() => window.__av.clearTargets());
  });

  await gcheck('standard state screenshot (tattooed)', async () => {
    await ev(() => window.__av.frame(3.6, 0.6, 1.5, 0, 0, 1.1));
    await shot(`avatar_state_tattooed_${PRESET}.png`);
  });

  await check('deactivate via input restores everything (glow, hover, wind, aura)', async () => {
    const off = await ev((g) => g.debug.avatar.press());
    assert.equal(off, false);
    await ev(() => window.__av.adv(20));
    const glow = await ev(() => window.__av.glow());
    assert.equal(glow.eye, 0);
    assert.equal(glow.tat, 0);
    assert.equal(glow.rim, 0);
    const c = await ev(() => window.__av.counts());
    assert.equal(c.named, 0, 'aura removed');
    assert.equal(c.hover, 0, 'hover restored exactly');
    assert.equal(c.wind, 0, 'wind restored');
    assert.equal(c.vfxChildren, baseline.vfxChildren, 'no leftover vfx objects');
    const s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.boosts.power, 1);
  });

  if (BEAUTY) await beautyShots();

  await gcheck('spirit drains while active, regenerates when not, empty spirit ends the state', async () => {
    await ev((g) => g.debug.avatar.setSpirit(50));
    await ev((g) => g.debug.avatar.press());
    await ev(() => window.__av.adv(90));
    let s = await ev((g) => g.debug.avatar.state());
    assert.ok(s.active && s.spirit < 47.5 && s.spirit > 45, 'drain ~1.1/s: ' + s.spirit);
    await ev((g) => g.debug.avatar.setSpirit(0.5));
    await ev(() => window.__av.adv(30));
    s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.active, false, 'empty spirit deactivates');
    const sp = s.spirit;
    await ev(() => window.__av.adv(60));
    s = await ev((g) => g.debug.avatar.state());
    assert.ok(s.spirit > sp + 4, 'regenerates: ' + sp + ' -> ' + s.spirit);
    // Below the threshold the input refuses (no long cooldown otherwise).
    await ev((g) => g.debug.avatar.setSpirit(10));
    const on = await ev((g) => g.debug.avatar.press());
    assert.equal(on, false);
    await ev((g) => g.debug.avatar.setSpirit(100));
    await ev(() => window.__av.adv(20));
  });

  await gcheck('dynamic lights: aura light exists while active and is removed on deactivate', async () => {
    await ev((g) => g.setting('graphics.dynamicLights', true));
    const l0 = (await ev(() => window.__av.counts())).lights;
    await ev((g) => g.debug.avatar.press());
    await ev(() => window.__av.adv(15));
    const l1 = (await ev(() => window.__av.counts())).lights;
    assert.ok(l1 > l0, `light added (${l0} -> ${l1})`);
    await ev((g) => g.debug.avatar.press());
    await ev(() => window.__av.adv(20));
    const l2 = (await ev(() => window.__av.counts())).lights;
    assert.equal(l2, l0, 'light removed');
    await ev((g) => g.setting('graphics.dynamicLights', false));
  });

  await gcheck('after masterAll the same input enters the Elements Sphere (sequence + formation)', async () => {
    // The spirit-vision dialogue that follows mastering everything would hold the controls (masters.e2e covers it).
    const pr = await ev((g) => (g.ctx.quests.setFlag('sphere_vision'), g.masterAll()));
    assert.equal(pr.sphereUnlocked, true);
    for (const id of ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado', 'ult_cataclysm']) assert.ok(pr.learned.includes(id), id + ' learned');
    await ev((g) => g.debug.avatar.press());
    const phases = [];
    for (let i = 0; i < 24; i++) {
      await ev(() => window.__av.adv(4));
      const s = await ev((g) => g.debug.avatar.state());
      phases.push(s.sphereFx?.phase);
    }
    let s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.sphere, true, 'sphere active');
    assert.equal(s.boosts.power, 1.9);
    for (const ph of ['air', 'water', 'earth', 'fire', 'converge']) assert.ok(phases.includes(ph), `phase ${ph} seen: ${phases.join(',')}`);
    await ev(() => window.__av.adv(10));
    s = await ev((g) => g.debug.avatar.state());
    const fx = s.sphereFx;
    assert.equal(fx.phase, 'formation');
    assert.ok(fx.rocks >= 5 && fx.water >= 1 && fx.fire >= 2 && fx.wind >= 2, JSON.stringify(fx));
    // Follows the Avatar.
    const p = await ev((g) => g.state().player);
    const d = Math.hypot(fx.center[0] - p.x, fx.center[2] - p.z);
    assert.ok(d < 0.2 && fx.center[1] > p.y + 1, 'centred on the Avatar: ' + JSON.stringify({ c: fx.center, p }));
    await ev((g) => {
      g.ctx.input.setVirtualMove(0, 1);
    });
    await ev(() => window.__av.adv(20));
    await ev((g) => g.ctx.input.setVirtualMove(0, 0));
    await ev(() => window.__av.adv(2));
    const s2 = await ev((g) => g.debug.avatar.state());
    const p2 = await ev((g) => g.state().player);
    assert.ok(Math.hypot(p2.x - p.x, p2.z - p.z) > 1, 'player walked');
    assert.ok(Math.hypot(s2.sphereFx.center[0] - p2.x, s2.sphereFx.center[2] - p2.z) < 0.3, 'sphere follows walking');
    // HUD: four ultimates + Cataclysm.
    await ev((g) => g.hideUI(false));
    await ev(() => window.__av.adv(2));
    const slots = await h.page.evaluate(() => [...document.querySelectorAll('.slots .slot.ultimate')].map((e) => e.dataset.id));
    assert.deepEqual(slots, ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado', 'ult_cataclysm']);
    await ev(() => window.__av.frame(-5.5, 1.5, 2.6, 2, 0, 1.2));
    await shot(`sphere_hud_${PRESET}.png`);
    await ev((g) => g.hideUI(true));
    await ev((g) => g.freeCamera(null));
  });

  const ULTS = [
    { id: 'ult_hurricane', targets: [[10, 0], [12, 3], [8, -3]], aim: 10, steps: 200, shotAt: 50, cam: [-10, 9, 6, 10, 0, 4] },
    { id: 'ult_tsunami', targets: [[6, 0], [12, 3], [18, -4]], aim: 20, steps: 120, shotAt: 40, cam: [3, 13, 8, 11, 0, 1] },
    { id: 'ult_earthquake', via: 'ability3', targets: [[5, 0], [8, 4], [11, -5]], aim: 6, steps: 90, shotAt: 26, cam: [-13, 7, 9, 3, 0, 0.5] },
    { id: 'ult_fire_tornado', targets: [[7, 0], [11, 0.5], [15, -1]], aim: 18, steps: 170, shotAt: 60, cam: [-9, 10, 5, 11, 0, 3] },
    { id: 'ult_cataclysm', via: 'ability5', targets: [[6, 0], [10, 5], [14, -6]], aim: 8, steps: 120, shotAt: 52, cam: [-14, 8, 11, 2, 0, 0.5] },
  ];
  for (const u of ULTS) {
    await check(`${u.id}: damages and displaces dummies through CombatSystem`, async () => {
      await ev(() => {
        window.__av.home();
        window.__av.refresh();
      });
      await ev(() => window.__av.adv(2));
      const st = await ev((g) => g.debug.avatar.state());
      assert.equal(st.sphere, true, 'still in the sphere');
      const ids = [];
      for (const [d, s] of u.targets) ids.push((await ev((g, d, s) => window.__av.spawn(d, s), d, s)).id);
      await ev(() => window.__av.adv(2));
      const before = await ev((g, ids) => ids.map((id) => window.__av.target(id)), ids);
      await ev((g) => (window.__av.frameYaw = g.game.player.yaw)); // shots framed along the cast direction
      const spirit0 = (await ev((g) => g.debug.avatar.state())).spirit;
      const res = u.via
        ? // Through the real input: the Player maps ability1-4 / ability5 to the ultimates while the sphere is active.
          await ev((g, action) => {
            g.ctx.input.setVirtual(action, true);
            window.__av.adv(1);
            g.ctx.input.setVirtual(action, false);
            const c = g.debug.bending.activeCast();
            return { ok: !!c, id: c ? c.id : null, water: null };
          }, u.via)
        : await ev((g, id, aim) => {
            const p = g.game.player;
            const a = { x: p.position.x + Math.sin(p.yaw) * aim, y: p.position.y + 1, z: p.position.z + Math.cos(p.yaw) * aim };
            return g.cast(id, a);
          }, u.id, u.aim);
      assert.equal(res.ok, true, 'cast ok: ' + JSON.stringify(res));
      if (u.via) assert.equal(res.id, u.id, `${u.via} casts ${u.id} while the sphere is active`);
      const spirit1 = (await ev((g) => g.debug.avatar.state())).spirit;
      assert.ok(spirit0 - spirit1 >= 14, `spirit spent ${spirit0} -> ${spirit1}`);
      let peakConstructs = 0;
      let shotDone = false;
      const shotAt = u.shotAt;
      for (let i = 0; i < u.steps; i += 2) {
        await ev(() => window.__av.adv(2));
        if (u.id === 'ult_earthquake' || u.id === 'ult_cataclysm') peakConstructs = Math.max(peakConstructs, (await ev(() => window.__av.counts())).constructs);
        if (!shotDone && i >= shotAt) {
          shotDone = true;
          await ev((g, c) => window.__av.frame(...c), u.cam);
          await shot(`${u.id}_${PRESET}.png`);
          await ev((g) => g.freeCamera(null));
        }
      }
      await ev(() => (window.__av.frameYaw = null));
      const after = await ev((g, ids) => ids.map((id) => window.__av.target(id)), ids);
      const report = after.map((a, i) => ({ dmg: +a.totalDamage.toFixed(1), moved: +Math.hypot(a.x - before[i].x, a.z - before[i].z).toFixed(2), maxLaunch: +a.maxLaunch.toFixed(1), kd: a.knockdowns, st: a.statuses }));
      const hitCount = report.filter((r) => r.dmg > 0).length;
      const movedCount = report.filter((r) => r.moved > 0.5 || r.maxLaunch > 1).length;
      assert.ok(hitCount >= 2, 'at least two dummies damaged: ' + JSON.stringify(report));
      assert.ok(movedCount >= 2, 'at least two dummies displaced: ' + JSON.stringify(report));
      if (u.id === 'ult_earthquake' || u.id === 'ult_cataclysm') assert.ok(peakConstructs > 0, 'rock formations raised');
      if (u.id === 'ult_tsunami') {
        const puddles = await ev((g) => [...g.ctx.water.list()].filter((s) => s.type === 'puddle' && s.id.startsWith('dyn_')).length);
        assert.ok(puddles > 0, 'the wave left bendable puddles');
        assert.equal(res.water?.source, 'conjured', 'no water nearby → conjured (canConjure ultimate)');
      }
      // Dedup: one-shot damage is bounded (no runaway repeated hits).
      for (const r of report) assert.ok(r.dmg < 400, 'bounded damage ' + r.dmg);
      await ev(() => window.__av.clearTargets());
    });
  }

  await gcheck('ultimates refused without the sphere / without spirit', async () => {
    await ev((g) => window.__av.refresh());
    await ev((g) => g.debug.avatar.setSpirit(5));
    const r1 = await ev((g) => g.cast('ult_earthquake'));
    assert.equal(r1.ok, false);
    await ev((g) => g.debug.avatar.setSpirit(100));
  });

  await gcheck('effects / constructs / colliders settle and 10 activations leave no trace', async () => {
    // Let every ultimate effect finish (rock formations sink).
    const wasOn = (await ev((g) => g.debug.avatar.state())).active;
    if (wasOn) await ev((g) => g.debug.avatar.press()); // leave the sphere
    await ev(() => window.__av.adv(300));
    const base = await ev(() => window.__av.counts());
    const diag = await ev((g) => ({ st: g.debug.avatar.state(), ui: g.state().ui, player: g.state().player }));
    assert.equal(base.named, 0, 'no avatar visuals left: ' + JSON.stringify({ wasOn, base, diag }));
    assert.equal(base.constructs, 0, 'rock formations sank');
    assert.equal(base.colliders, baseline.colliders, 'construct colliders removed');
    // (the input is debounced for 0.35 s, so each press is separated by >= 12 frames)
    for (let i = 0; i < 10; i++) {
      const on = await ev((g) => g.debug.avatar.press());
      assert.equal(on, true, 'activation ' + i);
      await ev((g, n) => window.__av.adv(n), i % 2 ? 12 : 95); // half of them through the full sphere sequence
      const off = await ev((g) => g.debug.avatar.press());
      assert.equal(off, false, 'deactivation ' + i);
      await ev(() => window.__av.adv(12));
    }
    await ev(() => window.__av.adv(150));
    const end = await ev(() => window.__av.counts());
    const s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.activations >= 10, true);
    assert.equal(end.named, 0, 'no avatar visuals left');
    assert.equal(end.vfxChildren, base.vfxChildren, `vfx children ${base.vfxChildren} -> ${end.vfxChildren}`);
    assert.equal(end.effects, base.effects, `effects ${base.effects} -> ${end.effects}`);
    assert.equal(end.lights, base.lights);
    assert.ok(end.geometries <= base.geometries + 2, `geometries ${base.geometries} -> ${end.geometries}`);
    assert.ok(end.particles <= base.particles + 40, `particles ${base.particles} -> ${end.particles}`);
    assert.equal(end.hover, 0);
    assert.equal(end.wind, 0);
    assert.equal(end.bloomBoost, 0);
  });

  await gcheck('travel (teleport far) leaves the state without a trace', async () => {
    assert.equal(await ev((g) => g.debug.avatar.press()), true, 'entered');
    await ev(() => window.__av.adv(10));
    await ev((g, a) => g.teleport(a.x + 400, a.z), ARENA);
    await ev(() => window.__av.adv(3));
    const s = await ev((g) => g.debug.avatar.state());
    assert.equal(s.active, false);
    const c = await ev(() => window.__av.counts());
    assert.equal(c.named, 0, 'no avatar visuals left: ' + JSON.stringify({ c, s }));
    assert.equal(c.hover, 0);
    await ev(() => window.__av.home());
    await ev(() => window.__av.adv(5));
  });

  await gcheck('save/load: spirit + sphere unlock persist, never active after load', async () => {
    await ev((g) => g.debug.avatar.setSpirit(37));
    await ev((g) => g.debug.avatar.press());
    await ev(() => window.__av.adv(3));
    const saved = await ev((g) => {
      g.save('slot3');
      return g.debug.avatar.state().spirit;
    });
    await ev((g) => g.loadGame('slot3'));
    await ev((g) => g.game.stop());
    await ev(() => window.__av.adv(3));
    const s = await ev((g) => g.debug.avatar.state());
    const st = await h.state();
    assert.equal(s.active, false, 'not active after load');
    assert.ok(Math.abs(s.spirit - saved) < 1, `spirit persisted (${saved} -> ${s.spirit})`);
    assert.equal(st.progression.sphereUnlocked, true);
    assert.ok(st.progression.learned.includes('ult_cataclysm'));
    const c = await ev(() => window.__av.counts());
    assert.equal(c.named, 0);
    assert.equal(c.hover, 0);
  });

} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
