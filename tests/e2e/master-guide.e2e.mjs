// Master guide: finding the masters of every nation, and the teacher of any ability.
//  - Journal → Masters lists every master (hidden ones as rumours) with where they are and how to get there;
//  - tracking a master or an ability starts a guide quest: HUD objective, road route on the map, next
//    waypoint on the compass; it survives save/load, can be removed, and can be tracked again once done;
//  - the Technique Library's "Find teacher" tracks the lesson that teaches a locked technique;
//  - sub-skill HUD bits (moon chip…) hide while a screen is open; phone layout keeps 44 px targets.
// Run: node tests/e2e/master-guide.e2e.mjs   (ONLY=desk|phone runs one half; SHOTS=dir saves screenshots)
import assert from 'node:assert/strict';
import { launch } from '../../scripts/harness.mjs';

const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);
const SHOTS = process.env.SHOTS || '';
let h = null;
const ev = (fn, ...a) => h.eval(fn, ...a);
/** Deterministic steps (the real-time loop is stopped), never rendered. */
const step = (n, dt = 1 / 30) => ev((g, n, dt) => { const R = g.ctx.render, r = R.render; R.render = () => {}; try { for (let i = 0; i < n; i++) g.step(1, dt); } finally { R.render = r; } }, n, dt);
const click = (sel) => ev((g, sel) => { const el = document.querySelector(sel); if (el) el.click(); return !!el; }, sel);
const text = (sel) => ev((g, sel) => document.querySelector(sel)?.textContent ?? null, sel);
const screen = () => ev((g) => g.ctx.ui.currentScreen);
const closeAll = () => ev((g) => { while (g.ctx.ui.currentScreen) g.ctx.ui.close(); g.ctx.ui.hideDialogue(); });
const shot = async (name) => {
  if (!SHOTS) return;
  await h.step(2);
  // Screens fade in on CSS time, which barely moves between deterministic steps: settle them first.
  await h.page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
      } catch {}
    }
  });
  await h.shot(`${SHOTS}/${name}.jpg`, { quality: 82, timeout: 120000 }).catch((e) => console.log('   (screenshot failed)', e.message.split('\n')[0]));
};
/** Open Journal → Masters, view + element filter. */
async function openMasters(view = 'masters', el = 'all') {
  await closeAll();
  await ev((g) => g.ctx.ui.open('journal'));
  await step(1);
  assert.ok(await click('.gs-tab[data-tab="masters"]'), 'masters tab');
  await click(`[data-mg-view="${view}"]`);
  await click(`[data-mg-el="${el}"]`);
  await step(1);
}
const tracked = () => ev((g) => g.ctx.quests.tracked);
const active = (id) => ev((g, id) => g.ctx.quests.isActive(id), id);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Visible interactive elements of the top-most in-game screen smaller than 44 px (as ui.e2e). */
const smallTargets = () => h.page.evaluate(() => {
  const roots = document.querySelectorAll('.gs-frame, .ps-menu');
  const root = roots[roots.length - 1];
  if (!root) return ['no screen'];
  for (const a of root.getAnimations({ subtree: true })) {
    try {
      a.finish();
    } catch {}
  }
  const out = [];
  for (const el of root.querySelectorAll('button, summary, [role="tab"]')) {
    if (el.offsetParent === null || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || '').trim().slice(0, 16)}"`);
  }
  return out;
});

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

try {
  if (run('desk')) {
    console.log('Master guide (desktop)');
    h = await launch({ width: 960, height: 540 });
    await h.newGame('earth');
    await step(20);
    await ev((g) => { g.setTime(11.5); g.freezeTime(true); g.game.stop(); });
    await step(4);
    const N = await ev((g) => [...g.ctx.quests.defs.keys()].filter((id) => id.startsWith('seek_master_')).length);

    await check('every master is in the journal and on the map (hidden ones as rumours at their clue)', async () => {
      assert.ok(N >= 12, `guide quests per master: ${N}`);
      await openMasters();
      const cards = await ev(() => [...document.querySelectorAll('.mg-card[data-master]')].map((c) => c.getAttribute('data-master')));
      assert.equal(new Set(cards).size, N, `master cards ${cards.length}/${N}`);
      const where = await ev(() => [...document.querySelectorAll('.mg-card')].filter((c) => !/\d(\.\d)? ?k?m (north|south|east|west)/.test(c.textContent ?? '')).length);
      assert.equal(where, 0, 'each card says how far and which way');
      const mk = await ev((g) => g.ctx.quests.markers().map((m) => m.questId));
      const masters = mk.filter((id) => id.startsWith('master:')).length;
      const rumours = mk.filter((id) => id.startsWith('rumour:'));
      assert.equal(masters + rumours.length, N, `map markers ${masters} masters + ${rumours.length} rumours`);
      assert.equal(rumours.length, 3, `rumours: ${rumours}`);
      await shot('d01_masters');
    });

    await check('tracking a master: guide quest, HUD objective, road route and the "Following" map view', async () => {
      await openMasters('masters', 'fire');
      await ev(() => document.querySelectorAll('.toasts .toast').forEach((t) => t.remove()));
      assert.ok(await click('[data-action="mg-track-master"][data-master="master_jeong"]'), 'track button');
      await step(1);
      assert.equal(await tracked(), 'seek_master_jeong');
      const toasts = await ev(() => [...document.querySelectorAll('.toasts .toast')].map((t) => t.textContent));
      assert.equal(toasts.length, 1, `one toast: ${JSON.stringify(toasts)}`);
      assert.match(toasts[0], /Tracking “Seek Master Jeong”/);
      const g0 = await ev((g) => ({ p: g.ctx.player.position.toArray(), target: g.debug.guide.target(), master: g.debug.guide.where('master_jeong').pos, route: g.debug.guide.route() }));
      assert.ok(flat(g0.target, g0.master) < 150, `target near the master: ${g0.target} vs ${g0.master}`);
      assert.ok(g0.route.length > 3, `a far master gets a road route: ${g0.route.length} points`);
      const len = g0.route.reduce((s, p, i) => (i ? s + Math.hypot(p.x - g0.route[i - 1].x, p.z - g0.route[i - 1].z) : 0), 0);
      const crow = flat(g0.p, g0.target);
      assert.ok(len >= crow - 1 && len < crow * 1.6, `route ${len.toFixed(0)} m vs ${crow.toFixed(0)} m as the crow flies`);
      assert.ok(Math.hypot(g0.route[0].x - g0.p[0], g0.route[0].z - g0.p[2]) < 2, 'the route starts at the player');
      assert.ok((await text('.mg-follow, [data-action="mg-follow-map"]')) !== null, 'the following banner');
      assert.ok(await click('[data-action="mg-follow-map"]'), 'show road on map');
      await step(2);
      assert.equal(await screen(), 'map');
      const follow = await text('.mp-follow');
      assert.ok(follow && /Seek Master Jeong/.test(follow) && /along the gold road/.test(follow), `map panel: ${follow}`);
      await shot('d02_map_route');
      await closeAll();
      await step(2);
      const hud = await text('.hud-quest');
      assert.ok(hud && /Seek Master Jeong/.test(hud) && /Travel to Fire Nation Capital/.test(hud), `HUD: ${hud}`);
    });

    await check('the compass points at the next road waypoint', async () => {
      await step(20);
      const wp = await ev((g) => g.debug.guide.waypoint());
      assert.ok(wp, 'a waypoint');
      assert.ok(await ev((g) => g.ctx.quests.markers().some((m) => m.questId === 'route:next' && m.compass)), 'route:next marker');
      await ev((g, wp) => { g.faceTowards(wp[0], wp[2]); g.ctx.cameraRig.snapBehind(); }, wp);
      await step(3);
      const marks = await ev(() => [...document.querySelectorAll('.compass .marker')].map((m) => m.textContent));
      assert.ok(marks.includes('◇'), `compass markers: ${marks}`);
      await shot('d03_compass');
    });

    await check('the guide survives save/load', async () => {
      assert.ok(await ev((g) => g.save('slot2')), 'save');
      await ev((g) => g.debug.guide.drop('seek_master_jeong'));
      assert.equal(await active('seek_master_jeong'), false);
      assert.ok(await ev((g) => g.loadGame('slot2')), 'load');
      await ev((g) => g.game.stop());
      await step(10);
      assert.equal(await tracked(), 'seek_master_jeong');
      assert.ok(await active('seek_master_jeong'));
    });

    await check('Journal → Quests: Remove drops a guide', async () => {
      await closeAll();
      await ev((g) => g.ctx.ui.open('journal'));
      await step(1);
      await click('.gs-tab[data-tab="quests"]');
      await step(1);
      assert.ok(await click('[data-quest="seek_master_jeong"]'), 'guide listed under Quests');
      await step(1);
      assert.ok(await click('[data-action="remove-guide"]'), 'remove button');
      await step(1);
      assert.equal(await active('seek_master_jeong'), false);
      assert.notEqual(await tracked(), 'seek_master_jeong');
      assert.equal(await ev(() => !!document.querySelector('[data-quest="seek_master_jeong"]')), false, 'gone from the list');
    });

    await check('"Find teacher" in the Technique Library tracks the lesson; learning it finishes the guide', async () => {
      await closeAll();
      await ev((g) => g.ctx.ui.open('techniques', 'earth'));
      await step(2);
      const tech = await ev(() => document.querySelector('[data-action="find-teacher"]')?.getAttribute('data-tech') ?? null);
      assert.ok(tech, 'a locked earth technique has "Find teacher"');
      const t = await ev((g, tech) => { const x = g.debug.guide.sys.lessonFor(tech); return x && { master: x.master.id, lesson: x.lesson.id, requires: x.lesson.requires ?? [] }; }, tech);
      assert.ok(t, 'a master teaches it');
      assert.ok(await click(`[data-action="find-teacher"][data-tech="${tech}"]`));
      await step(1);
      const qid = `learn_${t.lesson}`;
      assert.equal(await tracked(), qid);
      assert.match((await text(`[data-action="find-teacher"][data-tech="${tech}"]`)) ?? '', /Tracking/);
      await closeAll();
      // Go there: the travel step completes and earth is already known, so the guide points at the lesson.
      await ev((g, m) => g.debug.training.goto(m), t.master);
      await step(30, 0.1);
      const st = await ev((g, id) => { const p = g.ctx.quests.active.get(id); return p && g.ctx.quests.get(id).steps[p.step].id; }, qid);
      assert.ok(st === 'lesson' || st?.startsWith('prereq_'), `step after arriving: ${st}`);
      // Learning it (and what it builds on) completes the guide; it leaves no "completed" entry.
      await ev((g, qid, tech) => {
        for (const s of g.ctx.quests.get(qid).steps) if (s.id.startsWith('prereq_')) g.ctx.progression.learn(s.objectives[1].technique, 'master');
        g.ctx.progression.learn(tech, 'master');
      }, qid, tech);
      await step(4);
      assert.equal(await active(qid), false, 'guide done');
      assert.equal(await ev((g, id) => g.ctx.quests.isComplete(id), qid), false, 'no completed entry');
      assert.notEqual(await tracked(), qid);
    });

    await check('a hidden master is tracked through the rumour first; once read, it points at the master', async () => {
      const id = 'master_huu';
      assert.ok(await ev((g, id) => g.debug.guide.trackMaster(id), id));
      const s0 = await ev((g) => { const p = g.ctx.quests.active.get('seek_master_huu'); return { step: g.ctx.quests.get('seek_master_huu').steps[p.step].id, target: g.debug.guide.target() }; });
      assert.equal(s0.step, 'rumour');
      const huuClue = await ev((g) => g.ctx.quests.markers().find((m) => m.questId === 'rumour:master_huu')?.position.toArray() ?? null);
      assert.ok(huuClue && flat(s0.target, huuClue) < 10, `rumour target ${s0.target} at the clue ${huuClue}`);
      await ev((g) => g.ctx.quests.setFlag('clue_huu'));
      await step(2);
      const s1 = await ev((g) => { const p = g.ctx.quests.active.get('seek_master_huu'); return { step: g.ctx.quests.get('seek_master_huu').steps[p.step].id, target: g.debug.guide.target() }; });
      assert.equal(s1.step, 'travel');
      const pos = await ev((g) => g.debug.guide.where('master_huu').pos);
      assert.ok(flat(s1.target, pos) < 150, `now points at Huu: ${s1.target} vs ${pos}`);
      // A revealed master skips the rumour when tracked again.
      await ev((g) => g.debug.guide.drop('seek_master_huu'));
      await ev((g) => g.debug.guide.trackMaster('master_huu'));
      const s2 = await ev((g) => { const p = g.ctx.quests.active.get('seek_master_huu'); return g.ctx.quests.get('seek_master_huu').steps[p.step].id; });
      assert.equal(s2, 'travel');
    });

    await check('talking to the master finishes the seek guide, and it can be tracked again', async () => {
      const id = 'master_bumo';
      assert.ok(await ev((g, id) => g.debug.guide.trackMaster(id), id));
      await ev((g, id) => g.debug.training.goto(id), id);
      await step(30, 0.1);
      assert.equal(await ev((g) => { const p = g.ctx.quests.active.get('seek_master_bumo'); return p && g.ctx.quests.get('seek_master_bumo').steps[p.step].id; }), 'meet');
      assert.ok(await ev((g, id) => g.debug.training.talk(id), id), 'talk');
      await step(2);
      await closeAll();
      assert.equal(await active('seek_master_bumo'), false);
      assert.equal(await ev((g) => g.ctx.quests.isComplete('seek_master_bumo')), false);
      assert.ok(await ev((g, id) => g.debug.guide.trackMaster(id), id), 'tracked again');
      assert.equal(await tracked(), 'seek_master_bumo');
    });

    await check('abilities view: track an ability of another nation', async () => {
      await openMasters('abilities', 'water');
      const lesson = await ev(() => document.querySelector('[data-action="mg-track-ability"]')?.getAttribute('data-lesson') ?? null);
      assert.ok(lesson, 'a trackable water ability');
      assert.ok(await click(`[data-action="mg-track-ability"][data-lesson="${lesson}"]`));
      await step(1);
      assert.equal(await tracked(), `learn_${lesson}`);
      const st = await ev((g, id) => { const p = g.ctx.quests.active.get(id); return g.ctx.quests.get(id).steps.map((s) => s.id).join(',') + ' @' + p.step; }, `learn_${lesson}`);
      assert.match(st, /travel,awaken/, `steps: ${st}`);
      await shot('d04_abilities');
    });

    await check('sub-skill HUD (moon chip) hides while a screen is open', async () => {
      await openMasters();
      assert.equal(await ev(() => document.querySelector('.moon-chip')?.classList.contains('sk-screen-open') ?? null), true);
      await closeAll();
      await step(1);
      assert.equal(await ev(() => document.querySelector('.moon-chip')?.classList.contains('sk-screen-open') ?? null), false);
    });

    await check('no console errors', async () => {
      assert.deepEqual(h.errors, []);
    });
    await h.close();
    h = null;
  }

  if (run('phone')) {
    console.log('Master guide (phone landscape)');
    h = await launch({ width: 915, height: 412, hasTouch: true, isMobile: true });
    await h.newGame('water');
    await step(20);
    await ev((g) => { g.setTime(11.5); g.freezeTime(true); g.game.stop(); });
    await step(4);

    await check('phone: Masters page fits, 44 px targets, moon chip hidden', async () => {
      await openMasters();
      assert.deepEqual(await smallTargets(), [], 'masters tap targets');
      const over = await ev(() => { const b = document.querySelector('.gs-body .gs-scroll') ?? document.querySelector('.gs-body'); return b ? b.scrollWidth - b.clientWidth : -1; });
      assert.ok(over <= 1, `no sideways scroll (${over})`);
      assert.equal(await ev(() => document.querySelector('.moon-chip')?.classList.contains('sk-screen-open') ?? null), true);
      await shot('p01_masters');
      assert.ok(await click('[data-action="mg-track-master"][data-master="master_lien"]'));
      await step(1);
      assert.deepEqual(await smallTargets(), [], 'tracking banner targets');
      await click('[data-mg-view="abilities"]');
      await step(1);
      assert.deepEqual(await smallTargets(), [], 'abilities tap targets');
      await shot('p02_abilities');
      assert.ok(await click('[data-action="mg-follow-map"]'));
      await step(2);
      assert.equal(await screen(), 'map');
      assert.deepEqual(await smallTargets(), [], 'map tap targets');
      await shot('p03_map');
      await closeAll();
      await ev((g) => g.ctx.ui.open('techniques', 'earth'));
      await step(2);
      assert.deepEqual(await smallTargets(), [], 'technique tap targets (Find teacher)');
    });

    await check('phone: no console errors', async () => {
      assert.deepEqual(h.errors, []);
    });
  }
} finally {
  await h?.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
