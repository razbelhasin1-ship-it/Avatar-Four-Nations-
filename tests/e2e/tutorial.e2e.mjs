/**
 * Tutorial E2E: start from the main menu button, play through lessons with
 * simulated inputs, and verify campaign progress is untouched.
 * Run: node tests/e2e/tutorial.e2e.mjs
 */
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 960, height: 540 });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};
const tut = () => h.eval((g) => g.debug.tutorial.state());
const stepUntil = async (pred, maxFrames = 240) => {
  for (let i = 0; i < maxFrames; i += 10) {
    await h.step(10);
    if (await pred()) return true;
  }
  return false;
};
const atStep = (id) => async () => (await tut()).step === id;
const basicOf = (el, kind = 'basic') => h.eval((g, el, kind) => g.techniques().find((t) => t.element === el && t.kind === kind)?.id ?? null, el, kind);
const castAtDummy = (id) =>
  h.eval((g, id) => {
    const d = g.entities('target')[0];
    return g.cast(id, d ? { x: d.x, y: g.ctx.world.heightAt(d.x, d.z) + 1.2, z: d.z } : null, 1);
  }, id);

try {
  await check('tutorial starts from the main menu button', async () => {
    await h.page.click('[data-action="tutorial"]');
    await h.page.waitForFunction(() => window.__game.state().session.kind === 'tutorial', null, { timeout: 120000 });
    await h.step(5);
    const s = await tut();
    assert.equal(s.active, true);
    assert.equal(s.step, 'welcome');
    assert.ok(await h.page.isVisible('.tutorial-panel'), 'panel not visible');
  });
  await check('welcome → look (mouse look counted)', async () => {
    assert.ok(await stepUntil(atStep('look'), 300), 'did not reach look');
    for (let i = 0; i < 20; i++) {
      await h.eval((g) => g.ctx.input.addLook(40, 5));
      await h.step(1);
    }
    assert.ok(await stepUntil(atStep('move'), 120), 'look did not complete');
  });
  await check('move 12 m', async () => {
    await h.eval((g) => g.move(0, 1));
    const ok = await stepUntil(atStep('jump'), 300);
    await h.eval((g) => g.move(0, 0));
    assert.ok(ok, 'move did not complete');
  });
  await check('jump twice', async () => {
    for (let i = 0; i < 2; i++) {
      await h.eval((g) => g.ctx.input.setVirtual('jump', true));
      await h.step(2);
      await h.eval((g) => g.ctx.input.setVirtual('jump', false));
      await h.step(40);
    }
    assert.ok(await stepUntil(atStep('dodge'), 120), JSON.stringify(await tut()));
  });
  await check('dodge twice', async () => {
    for (let i = 0; i < 2; i++) {
      await h.eval((g) => g.ctx.input.setVirtual('dodge', true));
      await h.step(2);
      await h.eval((g) => g.ctx.input.setVirtual('dodge', false));
      await h.step(30);
    }
    assert.ok(await stepUntil(atStep('air_basic'), 120), JSON.stringify(await tut()));
  });
  await check('air strikes hit the spirit dummy', async () => {
    const id = await basicOf('air');
    assert.ok(id, 'no air basic technique');
    for (let i = 0; i < 6 && (await tut()).step === 'air_basic'; i++) {
      await castAtDummy(id);
      await h.step(15);
    }
    assert.ok(await stepUntil(atStep('air_heavy'), 120), JSON.stringify(await tut()));
  });
  await check('heavy technique', async () => {
    const id = await basicOf('air', 'heavy');
    await castAtDummy(id);
    assert.ok(await stepUntil(atStep('abilities'), 120), JSON.stringify(await tut()));
  });
  await check('skip through remaining lessons; Avatar State lesson completes via real toggle', async () => {
    await h.eval((g) => g.debug.tutorial.goto('avatar_state'));
    await h.step(5);
    await h.eval((g) => g.avatarState(true));
    await h.step(40);
    await h.eval((g) => g.avatarState(false));
    assert.ok(await stepUntil(atStep('sphere'), 120), JSON.stringify(await tut()));
  });
  await check('menus lesson completes when the map opens', async () => {
    await h.eval((g) => g.debug.tutorial.goto('menus'));
    await h.step(5);
    await h.eval((g) => g.ctx.ui.open('map'));
    await h.step(5);
    await h.eval((g) => g.ctx.ui.close('map'));
    assert.ok(await stepUntil(atStep('done'), 120), JSON.stringify(await tut()));
  });
  await check('leaving the tutorial writes no save', async () => {
    const before = await h.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('a4n.save.')).length);
    await h.eval((g) => g.exitToMenu(false));
    await h.step(5);
    const after = await h.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('a4n.save.')).length);
    assert.equal(after, before);
    assert.equal((await h.state()).mode, 'menu');
  });
} finally {
  for (const r of results) console.log(r.join(' | '));
  if (h.errors.length) console.log('CONSOLE ERRORS:\n' + h.errors.slice(0, 15).join('\n'));
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
