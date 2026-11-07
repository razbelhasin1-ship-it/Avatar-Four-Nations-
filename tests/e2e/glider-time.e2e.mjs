/**
 * Glider staff + Pass Time E2E.
 *  Glider staff:
 *  - worn, it is a prop of its own (not baked into the body mesh), slung on the back
 *  - airbending puts it in the hands (fists closed on it) and the wind leaves from its head;
 *    a moment later it goes back on the back
 *  - hold Jump while falling: it snaps open into wings and flies a flat, long glide
 *  - tap Jump: a gust (chi) lifts it; hold Sprint: a dive builds speed, released it swoops up
 *  - an updraft column over the temple cliffs carries it up
 *  - Dodge folds it; landing folds it, no fall damage
 *  - without it an airbender still glides on spread arms (the old glide)
 *  Pass Time:
 *  - the pause menu shows the clock; Pass Time opens a dial, a slider and quick choices
 *  - at night "Skip the Night" plays the time-lapse to dawn: the day count moves on, the
 *    `time:skipped` event fires, controls come back
 *  - a quick choice waits until that hour; enemies nearby block it (the reason is shown)
 * Run: node tests/e2e/glider-time.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(['PASS', name, `${((Date.now() - t0) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 6).join(' ')]);
  }
  console.log(results[results.length - 1].join(' | '));
};
const st = () => h.eval((g) => g.debug.glider.state());
const hold = (action, on) => h.eval((g, a) => g.ctx.input.setVirtual(a.action, a.on), { action, on });
/** Step until pred(state) or n frames. */
async function stepUntil(pred, n = 120, dt = 1 / 30) {
  for (let i = 0; i < n; i += 5) {
    await h.step(5, dt);
    const s = await st();
    if (pred(s)) return s;
  }
  return st();
}
/** Put the player `up` metres over the spawn, gliding (glider open, jump released). */
async function launchGlider(up = 300) {
  await h.eval((g, up) => {
    const p = g.ctx.player;
    g.teleport(p.position.x, p.position.z, p.position.y + up);
    g.ctx.input.setVirtual('jump', true);
  }, up);
  const s = await stepUntil((s) => s.flying && s.open > 0.99, 90);
  await hold('jump', false);
  await h.step(2, 1 / 30);
  return s;
}

try {
  await h.newGame('air');
  await h.eval((g) => {
    g.debug.enemies?.clear?.();
    g.freezeTime(true);
    g.setTime(14);
  });
  await h.step(10);
  const spawn = (await h.state()).player;

  await check('a new Air Nomad carries the glider staff', async () => {
    const s0 = await st();
    assert.equal(s0.staff, true, JSON.stringify(s0));
    assert.equal(await h.eval((g) => g.ctx.player.appearance.outfit.accessory), 'air_glider');
  });

  await check('without the staff an airbender still glides on spread arms', async () => {
    await h.eval((g) => {
      const pl = g.ctx.player;
      pl.setAppearance({ ...pl.appearance, outfit: { ...pl.appearance.outfit, accessory: 'none' } });
    });
    await h.step(2);
    const s0 = await st();
    assert.equal(s0.staff, false, JSON.stringify(s0));
    await h.eval((g, p) => {
      g.teleport(p.x, p.z, p.y + 40);
      g.ctx.input.setVirtual('jump', true);
    }, spawn);
    const s = await stepUntil((s) => s.gliding, 60);
    await hold('jump', false);
    assert.ok(s.gliding && !s.flying, JSON.stringify(s));
    await stepUntil((s) => !s.gliding, 200);
  });

  await check('worn, the glider staff is its own prop slung on the back (not baked into the body mesh)', async () => {
    await h.eval((g, p) => {
      const pl = g.ctx.player;
      pl.setAppearance({ ...pl.appearance, outfit: { ...pl.appearance.outfit, accessory: 'air_glider' } });
      g.teleport(p.x, p.z);
    }, spawn);
    await h.step(20);
    const s = await st();
    assert.equal(s.staff, true);
    assert.equal(s.mode, 'back');
    assert.equal(s.open, 0);
    assert.equal(s.meshAccessory, 'none_acc', 'the baked back staff is left out of the body mesh');
    assert.deepEqual(s.grip, [0, 0]);
  });

  await check('airbending puts the staff in the hands (fists closed) and the wind leaves from its head', async () => {
    await hold('attack', true);
    await h.step(2, 1 / 60);
    await hold('attack', false);
    await h.step(8, 1 / 60);
    const r = await h.eval((g) => {
      const v = g.ctx.player.castOrigin('handR', new g.THREE.Vector3());
      return { s: g.debug.glider.state(), tip: g.debug.glider.tip(), origin: { x: v.x, y: v.y, z: v.z }, pos: g.state().player };
    });
    assert.equal(r.s.mode, 'hand', JSON.stringify(r.s));
    assert.deepEqual(r.s.grip, [1, 1]);
    const d = Math.hypot(r.tip.x - r.origin.x, r.tip.y - r.origin.y, r.tip.z - r.origin.z);
    assert.ok(d < 0.05, `cast origin at the staff head (${d.toFixed(3)} m apart)`);
    const reach = Math.hypot(r.tip.x - r.pos.x, r.tip.z - r.pos.z);
    assert.ok(reach > 0.4 && reach < 2.2, `the head reaches out from the body (${reach.toFixed(2)} m)`);
    const back = await stepUntil((s) => s.mode === 'back', 150);
    assert.equal(back.mode, 'back', 'back on the back after a while');
  });

  await check('hold Jump while falling: the glider snaps open and flies a long, flat glide', async () => {
    const s = await launchGlider(300);
    assert.ok(s.flying && s.open > 0.99 && s.gliding, JSON.stringify(s));
    assert.equal(s.mode, 'glide');
    assert.ok(s.chase, 'the camera follows behind the glider');
    // Both fans spread wide to the sides (the big fan's tips ~2 m apart) and hang above the flier.
    const tips = await h.eval((g) => ({ t: g.debug.glider.wingTips(), p: g.ctx.player.position.y }));
    const span = Math.hypot(tips.t.left.x - tips.t.right.x, tips.t.left.z - tips.t.right.z);
    assert.ok(span > 1.6 && span < 2.6, `fan span ${span.toFixed(2)} m`);
    assert.ok(Math.min(tips.t.left.y, tips.t.right.y) > tips.p + 0.4, 'the fans ride above the flier');
    const a = await h.eval((g) => ({ ...g.state().player }));
    await h.step(150, 1 / 30); // 5 s
    const b = await h.eval((g) => ({ ...g.state().player, gl: g.debug.glider.state() }));
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const lost = a.y - b.y;
    assert.ok(b.gl.flying, 'still flying');
    assert.ok(dist > 55, `flew ${dist.toFixed(1)} m in 5 s`);
    assert.ok(lost > 0 && lost < 22, `lost ${lost.toFixed(1)} m of height`);
    assert.ok(dist / lost > 4, `glide ratio ${(dist / lost).toFixed(1)}`);
  });

  await check('tap Jump: a gust of wind lifts the glider (and costs chi)', async () => {
    const before = await st();
    await hold('jump', true);
    await h.step(1, 1 / 30);
    await hold('jump', false);
    await h.step(2, 1 / 30);
    const after = await h.eval((g) => ({ gl: g.debug.glider.state(), vy: g.ctx.player.body.velocity.y }));
    assert.ok(after.gl.lift > 3, JSON.stringify(after));
    assert.ok(after.vy > 0, `climbing (vy ${after.vy.toFixed(2)})`);
    assert.ok(after.gl.chi < before.chi - 10, `chi ${before.chi.toFixed(1)} → ${after.gl.chi.toFixed(1)}`);
  });

  await check('hold Sprint: the glider dives and builds speed; released it swoops back up', async () => {
    await h.step(60, 1 / 30);
    const cruise = await st();
    await hold('sprint', true);
    const dive = await stepUntil((s) => s.speed > 26, 150);
    await hold('sprint', false);
    assert.ok(dive.speed > 26, `dive speed ${dive.speed.toFixed(1)}`);
    // Nose down, and the view widens with the rush of speed.
    assert.ok(dive.attitude < -0.3, `attitude ${dive.attitude.toFixed(2)}`);
    assert.ok(dive.fov > cruise.fov + 3, `fov ${cruise.fov.toFixed(1)} → ${dive.fov.toFixed(1)}`);
    let climbed = false;
    for (let i = 0; i < 12 && !climbed; i++) {
      await h.step(5, 1 / 30);
      climbed = await h.eval((g) => g.ctx.player.body.velocity.y > 0.5);
    }
    assert.ok(climbed, 'swooped up after the dive');
  });

  await check('an updraft column over the temple cliffs carries a circling glider up (and wisps show it)', async () => {
    const r = await h.page.evaluate(async () => {
      const { getSpot } = await import('/src/world/Spots.ts');
      const s = getSpot('updraft_1');
      return s ? { x: s.x, z: s.z, y: s.y ?? 0 } : null;
    });
    assert.ok(r, 'updraft_1 spot');
    // Enter on the full-stick turning circle round the column's core (speed / turn rate ≈ 10 m), heading north.
    await h.eval((g, s) => {
      g.ctx.player.yaw = 0;
      g.teleport(s.x - 10, s.z, s.y + 40);
    }, r);
    if (!(await st()).flying) await launchGlider(0);
    // Hold the stick toward a heading a little to the right of the current one: a steady turn.
    const steer = () =>
      h.eval((g) => {
        const p = g.ctx.player;
        const want = p.yaw + 1.2;
        const dx = Math.sin(want), dz = Math.cos(want);
        const f = g.ctx.camera.getWorldDirection(new g.THREE.Vector3()).setY(0).normalize();
        g.ctx.input.setVirtualMove(dx * -f.z + dz * f.x, dx * f.x + dz * f.z);
      });
    const y0 = await h.eval((g) => g.ctx.player.position.y);
    let wisps = 0;
    for (let i = 0; i < 40; i++) {
      await steer();
      await h.step(3, 1 / 30);
      if (i === 20) wisps = await h.eval((g) => g.ctx.player.updraftField.live.size);
    }
    const b = await h.eval((g, s) => ({ y: g.ctx.player.position.y, d: Math.hypot(g.ctx.player.position.x - s.x, g.ctx.player.position.z - s.z), gl: g.debug.glider.state(), tips: g.debug.glider.wingTips() }), r);
    await h.eval((g) => g.ctx.input.setVirtualMove(0, 0));
    assert.ok(b.gl.flying, JSON.stringify(b));
    assert.ok(b.y > y0 + 15, `rose ${(b.y - y0).toFixed(1)} m in 4 s of circling (${b.d.toFixed(1)} m from the core)`);
    assert.ok(wisps > 0, `mist wisps rise in the column (${wisps} columns showing)`);
    // Circling left: the glider banks into the turn (its left fan tip dips) and the camera rolls with it.
    assert.ok(b.gl.bank > 0.2, `bank ${b.gl.bank.toFixed(2)}`);
    assert.ok(b.tips.left.y < b.tips.right.y - 0.3, `tips L ${b.tips.left.y.toFixed(2)} R ${b.tips.right.y.toFixed(2)}`);
    assert.ok(b.gl.roll > 0.03, `camera roll ${b.gl.roll.toFixed(3)}`);
  });

  await check('Dodge folds the glider; holding Jump while falling opens it again', async () => {
    await hold('dodge', true);
    await h.step(1, 1 / 30);
    await hold('dodge', false);
    await h.step(3, 1 / 30);
    let s = await st();
    assert.ok(!s.flying && !s.gliding, JSON.stringify(s));
    await h.step(30, 1 / 30);
    await hold('jump', true);
    s = await stepUntil((s) => s.flying, 60);
    await hold('jump', false);
    assert.ok(s.flying, 'reopened');
  });

  await check('flying into a wall stalls and folds it; holding Jump does not flap it open again', async () => {
    // The tower north of the courtyard (the glider from 25 m over the spawn, heading north, meets it).
    await h.eval((g, p) => {
      g.ctx.player.yaw = -0.17;
      g.teleport(p.x, p.z, p.y + 25);
      g.ctx.input.setVirtual('jump', true);
    }, spawn);
    await stepUntil((s) => s.flying, 60);
    const s = await stepUntil((s) => !s.flying, 240);
    assert.ok(!s.flying && s.y > spawn.y + 8, `folded in mid-air at the wall (${JSON.stringify(s)})`);
    await h.step(12, 1 / 30); // still holding Jump
    const held = await st();
    assert.ok(!held.flying, 'stays folded while Jump is still held');
    await hold('jump', false);
    await stepUntil(() => false, 90);
  });

  await check('landing folds the glider without fall damage', async () => {
    // The Sky Bison Meadow: open grass. Head away from the herders' shelter and dive to land.
    const m = await h.eval((g) => ({ x: 1368, z: 1052, y: g.ctx.world.groundAt(1368, 1052).y }));
    await h.eval((g, m) => {
      g.ctx.player.yaw = (3 * Math.PI) / 4;
      g.teleport(m.x, m.z, m.y + 14);
      g.ctx.input.setVirtual('jump', true);
    }, m);
    await stepUntil((s) => s.flying, 60);
    await hold('jump', false);
    await hold('sprint', true);
    const hp0 = (await h.state()).player.hp;
    const s = await stepUntil((s) => !s.flying, 240);
    await hold('sprint', false);
    const p = await (async () => {
      for (let i = 0; i < 20; i++) {
        const q = (await h.state()).player;
        if (q.grounded) return q;
        await h.step(3, 1 / 30);
      }
      return (await h.state()).player;
    })();
    assert.ok(!s.flying, 'folded');
    assert.ok(p.grounded, `on the ground (${JSON.stringify(p)})`);
    assert.ok(Math.hypot(p.x - m.x, p.z - m.z) < 40, 'landed in the meadow');
    assert.ok(p.hp >= hp0 - 0.01, `no damage (${hp0} → ${p.hp})`);
    const back = await stepUntil((s) => s.mode === 'back' && s.open === 0, 60);
    assert.equal(back.mode, 'back');
  });

  await check('pause menu: the clock, then Pass Time → dial, slider and quick choices', async () => {
    await h.eval((g) => g.setTime(22.5));
    await h.step(2);
    await h.eval((g) => g.game.setPaused(true));
    await h.page.waitForSelector('.ps-menu [data-action="time"]', { timeout: 10000 });
    const label = await h.page.$eval('.ps-menu [data-action="time"]', (e) => e.textContent);
    assert.match(label, /22:30/);
    await h.page.click('.ps-menu [data-action="time"]');
    await h.page.waitForSelector('.ts-dial svg', { timeout: 5000 });
    const ui = await h.page.evaluate(() => ({
      presets: document.querySelectorAll('.ts-preset').length,
      slider: !!document.querySelector('.ts-slider'),
      skip: !!document.querySelector('[data-action="skip-night"]'),
      wait: document.querySelector('[data-action="wait"]')?.textContent,
    }));
    assert.ok(ui.presets >= 5 && ui.slider && ui.skip, JSON.stringify(ui));
    assert.match(ui.wait, /06:00/);
  });

  await check('Skip the Night: the time-lapse runs to dawn, the day moves on, controls come back', async () => {
    const before = await h.eval((g) => ({ day: g.ctx.extra.get('moon')?.day ?? null }));
    await h.eval((g) => {
      window.__skipped = null;
      g.ctx.events.on('time:skipped', (e) => (window.__skipped = e));
      // The banner takes itself down after a few seconds of wall-clock time, which the software renderer
      // can spend on a few frames: record each banner as it appears.
      window.__banners = [];
      window.__bannerObs = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) if (n.classList?.contains('banner')) window.__banners.push(n.textContent);
      });
      window.__bannerObs.observe(document.body, { childList: true, subtree: true });
    });
    await h.page.click('[data-action="skip-night"]');
    await h.step(2);
    const mid = await h.eval((g) => ({ paused: g.game.paused, passing: g.debug.time.state().passing, lock: g.ctx.player.controlLock }));
    assert.ok(!mid.paused && mid.passing && mid.lock > 0, JSON.stringify(mid));
    for (let i = 0; i < 12; i++) {
      await h.step(10, 1 / 30);
      if (!(await h.eval((g) => g.debug.time.state().passing))) break;
    }
    const after = await h.eval((g) => {
      window.__bannerObs.disconnect();
      return { hour: g.ctx.world.sky.timeOfDay, day: g.ctx.extra.get('moon')?.day ?? null, ev: window.__skipped, lock: g.ctx.player.controlLock, passing: g.debug.time.state().passing, banner: window.__banners.filter((t) => /passed/.test(t)).at(-1) ?? window.__banners.join(' | ') };
    });
    assert.ok(!after.passing, 'done');
    assert.match(after.banner, /Dawn.*06:00.*7 h 30 min passed/, `banner: ${after.banner}`);
    assert.ok(Math.abs(after.hour - 6) < 0.02, `hour ${after.hour}`);
    assert.equal(after.day, before.day + 1, 'the night rolled into the next day');
    assert.ok(after.ev && Math.abs(after.ev.hours - 7.5) < 0.02, JSON.stringify(after.ev));
    assert.equal(after.lock, 0);
  });

  await check('a quick choice waits until that hour; enemies nearby block it', async () => {
    await h.eval((g) => g.game.setPaused(true));
    await h.page.waitForSelector('.ps-menu [data-action="time"]');
    await h.page.click('.ps-menu [data-action="time"]');
    await h.page.click('.ts-preset[data-hour="12"]');
    const wait = await h.page.$eval('[data-action="wait"]', (e) => e.textContent);
    assert.match(wait, /12:00/);
    await h.page.click('[data-action="wait"]');
    for (let i = 0; i < 12; i++) {
      await h.step(10, 1 / 30);
      if (!(await h.eval((g) => g.debug.time.state().passing))) break;
    }
    const hr = await h.eval((g) => g.ctx.world.sky.timeOfDay);
    assert.ok(Math.abs(hr - 12) < 0.02, `hour ${hr}`);
    // Enemies near: blocked, with the reason shown and the button disabled.
    await h.eval((g) => g.debug.enemies.spawn('fire_soldier', 12));
    await h.step(2);
    const reason = await h.eval((g) => g.debug.time.blockReason());
    assert.match(String(reason), /enemies/i);
    await h.eval((g) => g.game.setPaused(true));
    await h.page.waitForSelector('.ps-menu [data-action="time"]');
    await h.page.click('.ps-menu [data-action="time"]');
    const ui = await h.page.evaluate(() => ({ block: document.querySelector('.ts-block')?.textContent ?? '', disabled: document.querySelector('[data-action="wait"]')?.disabled }));
    assert.match(ui.block, /enemies/i);
    assert.equal(ui.disabled, true);
    assert.equal(await h.eval((g) => g.debug.time.skipTo(18)), false);
    await h.eval((g) => {
      g.game.setPaused(false);
      g.debug.enemies.clear();
    });
  });

  await check('no console errors', async () => {
    assert.equal(h.errors.length, 0, h.errors.slice(0, 5).join('\n'));
  });
} catch (e) {
  results.push(['FAIL', 'exception', e?.message ?? String(e)]);
  console.log('FAIL | exception |', e?.message ?? e);
} finally {
  await h.close();
}
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASSED');
process.exit(failed.length ? 1 : 0);
