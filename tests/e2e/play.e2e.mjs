/**
 * Playful bending E2E (src/player/play): hold the attack while exploring to float a water orb
 * drawn from real water (river, rain barrel), lift a real rock, or kindle a flame in the right
 * palm — and the attack itself is unchanged (taps, combat targets, Airbending).
 * Run: node tests/e2e/play.e2e.mjs   (SHOT_DIR=/path for screenshots)
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  try {
    // Every check starts with the attack released (a failed check must not leave it held).
    await h.eval((g) => g.ctx.input.setVirtual('attack', false));
    await h.step(2);
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const ev = (fn, ...a) => h.eval(fn, ...a);
const st = () => ev((g) => g.debug.play.state());
const down = (on) => ev((g, on) => g.ctx.input.setVirtual('attack', on), on);
const shot = async (n) => {
  if (!SHOT_DIR) return;
  await h.page.screenshot({ path: `${SHOT_DIR}/play_${n}.png`, timeout: 8000 }).catch(() => {});
};
/** Scene objects the interactions create (must all be gone after release / cancellation). */
const leftovers = () => ev((g) => {
  const names = new Set(['water_orb', 'lifted_rock', 'palm_flame']);
  let n = 0;
  g.ctx.scene.traverse((o) => {
    if (names.has(o.name) || (o.children?.some?.((c) => c.name === 'lifted_rock'))) n++;
  });
  return n;
});
const castCount = () => ev((g) => g.__playCasts ?? 0);
/** Casts plus failed casts (a water attack with no water in reach fails, but it was the attack). */
const attempts = () => ev((g) => g.__playAttempts ?? 0);

try {
  await h.newGame('water');
  await h.step(5);
  await ev((g) => {
    g.unlockAllElements();
    g.__playCasts = 0;
    g.__playAttempts = 0;
    g.ctx.events.on('technique:cast', (e) => {
      if (e.isPlayer) {
        g.__playCasts++;
        g.__playAttempts++;
      }
    });
    g.ctx.events.on('technique:failed', () => g.__playAttempts++);
  });
  // A dry spot on the Great River's east bank by Riverbend Village.
  const bank = await ev((g) => {
    let x = 110;
    while (g.ctx.world.liquidAt(x, -540) && x < 200) x += 0.5;
    return { x: x + 3.5, z: -540, waterX: x - 3, wy: g.ctx.world.liquidAt(x - 3, -540)?.level ?? 0 };
  });

  await check('1-2. water: hold at a river forms an orb; look up / down raises and lowers it', async () => {
    await ev((g, b) => g.teleport(b.x, b.z), bank);
    await h.step(40);
    await ev((g, b) => g.debug.play.aimAt(b.waterX, b.wy, b.z), bank);
    await h.step(2);
    const t = await ev((g) => g.debug.play.target());
    assert.equal(t?.type, 'river', 'river under the crosshair: ' + JSON.stringify(t));
    const c0 = await castCount();
    await down(true);
    await h.step(4);
    assert.equal((await st()).pending?.kind, 'water', 'press held back while deciding');
    await h.step(30);
    const s = await st();
    assert.equal(s.active, 'water');
    assert.equal(s.current.formed, 1, JSON.stringify(s.current));
    assert.ok(s.current.radius > 0.35 && s.current.radius < 0.5, 'medium orb: ' + s.current.radius);
    assert.equal(await castCount(), c0, 'no attack while forming the orb');
    await shot('water_held');
    const y0 = s.current.orb[1];
    await ev((g) => { g.ctx.cameraRig.pitch = -0.4; });
    await h.step(30);
    const up = (await st()).current.orb[1];
    await ev((g) => { g.ctx.cameraRig.pitch = 0.9; });
    await h.step(30);
    const low = (await st()).current.orb[1];
    assert.ok(up > y0 + 1.5, `looking up raises it (${y0} → ${up})`);
    assert.ok(low < y0 - 0.5, `looking down lowers it (${y0} → ${low})`);
    await ev((g) => { g.ctx.cameraRig.pitch = 0.28; g.ctx.cameraRig.yaw += 1.2; });
    await h.step(15);
    const sw = (await st()).current.orb;
    const p = (await h.state()).player;
    assert.ok(Math.hypot(sw[0] - p.x, sw[2] - p.z) > 1.4, 'swinging around, never through the bender');
    await down(false);
    await h.step(2);
    assert.equal((await st()).active, null, 'released');
    await h.step(60);
    assert.equal(await leftovers(), 0, 'the orb splashed and is gone');
  });

  await check('3-4. rain barrel: the orb takes real water; an empty barrel gives no orb', async () => {
    await ev((g) => g.teleport(120, -560));
    await h.step(90);
    const jar = await ev((g) => {
      const w = g.ctx.world;
      for (const j of g.debug.waterContainers.list()) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = j.x + Math.cos(a) * 3.2, z = j.z + Math.sin(a) * 3.2;
          const gy = w.groundAt(x, z, j.y + 2).y;
          if (Math.abs(gy - j.y) > 0.6 || w.collision.overlapSphere({ x, y: gy + 0.9, z }, 0.45)) continue;
          return { ...j, px: x, pz: z };
        }
      }
      return null;
    });
    assert.ok(jar, 'a water jar / rain barrel by the village stalls');
    const id = 'jar:' + jar.id;
    await ev((g, j) => g.teleport(j.px, j.pz), jar);
    await h.step(10);
    await ev((g, id) => { const s = g.ctx.water.get(id); s.amount = s.capacity; s.onChange?.(s.amount, s.capacity); }, id);
    await ev((g, j) => g.debug.play.aimAt(j.x, j.y + 0.8, j.z), jar);
    await h.step(2);
    const t = await ev((g) => g.debug.play.target());
    assert.equal(t?.id, id, 'the barrel is the target: ' + JSON.stringify(t));
    await down(true);
    await h.step(14);
    const s = await st();
    assert.equal(s.current?.source?.id, id);
    const left = await ev((g, id) => g.ctx.water.get(id).amount, id);
    assert.ok(left < 9, 'the barrel gave 8 of its 16 units: ' + left);
    await h.step(20);
    await shot('barrel_orb');
    await down(false);
    await h.step(40);
    // Empty: nothing to bend (a clear message instead of an orb).
    await ev((g, id) => { const s = g.ctx.water.get(id); s.amount = 0; s.regen = 0; s.onChange?.(0, s.capacity); }, id);
    await ev((g, j) => g.debug.play.aimAt(j.x, j.y + 0.8, j.z), jar);
    await h.step(30);
    const refused = (await st()).stats.refused;
    await down(true);
    await h.step(14);
    const e = await st();
    assert.equal(e.active, null, 'no orb from an empty barrel');
    assert.equal(e.stats.refused, refused + 1, 'told it is empty');
    await down(false);
    await h.step(5);
    // No water in view at all: the press is an ordinary attack at once.
    await ev((g) => { g.ctx.cameraRig.pitch = -0.5; });
    await h.step(30);
    const c0 = await attempts();
    await down(true);
    await h.step(1);
    assert.equal((await st()).pending, null, 'nothing to bend: no hold-back');
    assert.equal(await attempts(), c0 + 1, 'the attack went off on the press');
    await h.step(12);
    assert.equal((await st()).active, null);
    await down(false);
    await h.step(30);
    await ev((g, id) => { const s = g.ctx.water.get(id); s.regen = 0.15; }, id);
  });

  await check('5. earth: hold at a rock lifts the real rock; it moves with the aim and settles where dropped', async () => {
    await ev((g) => g.setElement('earth'));
    let rock = null;
    for (const [x, z] of [[135, -540], [260, -700], [-40, -900], [400, -400]]) {
      await ev((g, x, z) => g.teleport(x, z), x, z);
      await h.step(60);
      rock = await ev((g) => {
        const p = g.ctx.player.position;
        const list = g.debug.env.vegetationNear(p.x, p.z, 120).filter((r) => r.species === 'rock' && r.scale >= 0.5 && r.scale <= 1.6 && !g.ctx.world.liquidAt(r.x, r.z));
        list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        return list[0] ?? null;
      });
      if (rock) break;
    }
    assert.ok(rock, 'a liftable rock nearby');
    await ev((g, r) => g.teleport(r.x + 5, r.z + 1.5), rock);
    await h.step(30);
    await ev((g, r) => g.debug.play.aimAt(r.x, r.y + 0.3 * r.scale, r.z), rock);
    await h.step(2);
    const t = await ev((g) => g.debug.play.target());
    assert.equal(t?.kind, 'earth', 'rock under the crosshair: ' + JSON.stringify(t));
    const c0 = await castCount();
    await down(true);
    await h.step(14);
    assert.equal((await st()).active, 'earth');
    const hidden = await ev((g, r) => g.debug.env.vegetationNear(r.x, r.z, 0.5).filter((v) => v.species === 'rock').length, rock);
    assert.equal(hidden, 0, 'the world rock itself was lifted (its instance is hidden)');
    await h.step(30);
    const held = (await st()).current;
    assert.ok(!held.rising && held.pos[1] > rock.y + 0.8, 'floating: ' + JSON.stringify(held));
    await ev((g) => { g.ctx.cameraRig.pitch = -0.35; });
    await h.step(30);
    const up = (await st()).current.pos[1];
    assert.ok(up > held.pos[1] + 1, `looking up raises it (${held.pos[1]} → ${up})`);
    await shot('rock_up');
    assert.equal(await castCount(), c0, 'no Rock Strike while lifting');
    await ev((g) => { g.ctx.cameraRig.pitch = 0.28; g.ctx.cameraRig.yaw -= 0.7; });
    await h.step(30);
    await down(false);
    await h.step(60);
    assert.equal((await st()).active, null);
    assert.equal(await leftovers(), 0, 'no floating rock left');
    const now = await ev((g, r) => g.debug.env.vegetationNear(r.x, r.z, 14).filter((v) => v.species === 'rock' && Math.abs(v.scale - r.scale) < 1e-3), rock);
    assert.equal(now.length, 1, 'the rock is back in the world');
    assert.ok(Math.hypot(now[0].x - rock.x, now[0].z - rock.z) > 0.8, 'resting where it was dropped');
    await shot('rock_landed');
  });

  await check('6-7. fire: a small flame in the right palm, following the hand while walking', async () => {
    await ev((g) => g.setElement('fire'));
    await ev((g) => g.teleport(140, -545));
    await h.step(40);
    const c0 = await castCount();
    await down(true);
    await h.step(20);
    let s = await st();
    assert.equal(s.active, 'fire');
    assert.equal(s.current.kindled, true, 'kindled: ' + JSON.stringify(s.current));
    assert.equal(await castCount(), c0, 'no fire attack for the palm flame');
    await ev((g) => g.move(0, 1));
    for (let i = 0; i < 3; i++) {
      await h.step(8);
      s = await st();
      const f = s.current.flame, hd = s.current.hand;
      assert.ok(Math.hypot(f[0] - hd[0], f[2] - hd[2]) < 0.06 && f[1] - hd[1] > 0 && f[1] - hd[1] < 0.1, `flame on the right hand: ${f} vs ${hd}`);
    }
    await shot('palm_flame_walk');
    await ev((g) => g.move(0, 0));
    await down(false);
    await h.step(30);
    assert.equal((await st()).active, null);
    assert.equal(await leftovers(), 0, 'the flame died out');
  });

  await check('8-9. ordinary attacks unchanged: taps, combat targets (press = attack), Airbending', async () => {
    await h.step(30);
    // Exploring: a tap still attacks (on release).
    let c0 = await castCount();
    await down(true);
    await h.step(2);
    await down(false);
    await h.step(2);
    assert.equal(await castCount(), c0 + 1, 'tap → fire attack');
    // A target in the crosshair: attack on the press frame, holding never plays.
    await h.step(40);
    const d = await ev((g) => g.spawnDummy(6));
    await ev((g, d) => g.debug.play.aimAt(d.x, d.y + 1.2, d.z), d);
    await h.step(2);
    c0 = await castCount();
    await down(true);
    await h.step(1);
    const s = await st();
    assert.equal(s.inCombat, true);
    assert.equal(s.pending, null);
    assert.equal(await castCount(), c0 + 1, 'combat: the attack fires on press');
    await h.step(15);
    assert.equal((await st()).active, null, 'combat hold: no playful flame');
    await down(false);
    await h.step(5);
    // Heavy attack (hold aim) still charges and fires.
    const heavy = await ev((g) => g.techniques().find((t) => t.element === 'fire' && t.kind === 'heavy')?.id ?? null);
    if (heavy) {
      await ev((g) => g.ctx.progression.learn(g.techniques().find((t) => t.element === 'fire' && t.kind === 'heavy').id, 'debug', true));
      c0 = await castCount();
      await ev((g) => g.ctx.input.setVirtual('aim', true));
      await h.step(20);
      await ev((g) => g.ctx.input.setVirtual('aim', false));
      await h.step(10);
      assert.equal(await castCount(), c0 + 1, 'heavy charge + release still casts');
    }
    // Airbending: never plays, the press is the attack.
    await ev((g) => g.setElement('air'));
    await ev((g) => { for (const e of g.ctx.entities.all()) if (e.kind === 'target' || e.constructor?.name === 'TrainingDummy') e.alive = false; });
    await h.step(60);
    c0 = await castCount();
    await down(true);
    await h.step(1);
    assert.equal((await st()).pending, null, 'air: no hold-back');
    assert.equal(await castCount(), c0 + 1, 'air: attack on press');
    await h.step(15);
    assert.equal((await st()).active, null, 'air: no playful bending');
    await down(false);
    await h.step(5);
  });

  await check('10. nothing stuck: cancelled by dodge, element switch, damage, menus; scene change cleans up', async () => {
    await ev((g) => g.setElement('fire'));
    await h.step(40);
    const start = async () => {
      await down(true);
      await h.step(14);
      assert.equal((await st()).active, 'fire');
    };
    await start();
    await ev((g) => g.ctx.input.setVirtual('dodge', true));
    await h.step(1);
    await ev((g) => g.ctx.input.setVirtual('dodge', false));
    await h.step(2);
    assert.equal((await st()).active, null, 'dodge ends it');
    await down(false);
    await h.step(30);
    await start();
    await ev((g) => g.setElement('water'));
    await h.step(2);
    assert.equal((await st()).active, null, 'element switch ends it');
    await down(false);
    await ev((g) => g.setElement('fire'));
    await h.step(40);
    await start();
    await ev((g) => g.ctx.events.emit('player:damaged', { amount: 10 }));
    await h.step(2);
    assert.equal((await st()).active, null, 'being hit ends it');
    await down(false);
    await h.step(40);
    await start();
    // A menu pauses play; letting go meanwhile ends it once the game resumes.
    await ev((g) => g.ctx.ui.open('map'));
    await h.step(3);
    await down(false);
    await h.step(3);
    await ev((g) => g.ctx.ui.close('map'));
    await h.step(3);
    assert.equal((await st()).active, null, 'released during a menu: ended');
    await h.step(40);
    assert.equal(await leftovers(), 0);
    // Water orb held when the journey ends: removed with the session.
    await ev((g) => g.setElement('water'));
    await ev((g, b) => g.teleport(b.x, b.z), bank);
    await h.step(40);
    await ev((g, b) => g.debug.play.aimAt(b.waterX, b.wy, b.z), bank);
    await h.step(2);
    await down(true);
    await h.step(20);
    assert.equal((await st()).active, 'water');
    await ev((g) => g.exitToMenu(false));
    await h.step(5);
    await down(false);
    assert.equal((await st()).active, null);
    assert.equal(await leftovers(), 0, 'no orb left behind after the session');
  });

  await check('touch: holding the ATTACK button and sliding the thumb steers the camera (and the held element)', async () => {
    await h.newGame('fire');
    await h.step(10);
    await ev((g) => g.teleport(140, -545));
    await h.step(40);
    const has = await h.page.evaluate(() => !!document.querySelector('.touch .tbtn[data-touch="attack"]'));
    assert.ok(has, 'touch ATTACK button exists');
    const fire = (type, x, y) =>
      h.page.evaluate(([type, x, y]) => {
        const el = document.querySelector('.touch .tbtn[data-touch="attack"]');
        el.dispatchEvent(new PointerEvent(type, { pointerId: 41, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch' }));
      }, [type, x, y]);
    // A plain tap-and-slide (no play yet) must not turn the camera.
    await fire('pointerdown', 700, 400);
    const yaw0 = await ev((g) => g.ctx.cameraRig.yaw);
    await fire('pointermove', 760, 400);
    await h.step(1);
    assert.equal(await ev((g) => g.ctx.cameraRig.yaw), yaw0, 'no camera turn before play starts');
    await h.step(14);
    assert.equal((await st()).active, 'fire', 'held: palm flame');
    const yaw1 = await ev((g) => g.ctx.cameraRig.yaw);
    for (let i = 1; i <= 4; i++) {
      await fire('pointermove', 760 + i * 25, 400 - i * 6);
      await h.step(1);
    }
    const yaw2 = await ev((g) => g.ctx.cameraRig.yaw);
    assert.ok(Math.abs(yaw2 - yaw1) > 0.05, `sliding while held turns the camera (${yaw1} → ${yaw2})`);
    await fire('pointerup', 860, 376);
    await h.step(30);
    assert.equal((await st()).active, null, 'lifting the thumb lets go');
  });

  await check('11. graphics settings: no console errors (low preset, high effects)', async () => {
    assert.equal(h.errors.length, 0, 'console errors: ' + h.errors.slice(0, 5).join('\n'));
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
