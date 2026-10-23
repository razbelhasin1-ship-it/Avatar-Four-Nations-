/**
 * Shared harness for the bending e2e suites (combat-air / combat-fire /
 * combat-earth). Each suite learns every technique, stands in an empty flat
 * meadow, spawns weighted sparring dummies (they have physics bodies, so
 * knockback / launches / pulls really move them) and casts every castable
 * technique of its element, asserting on real gameplay state: damage dealt,
 * displacement, launches, construct colliders appearing and disappearing,
 * movement techniques displacing the player, channels ending, projectiles
 * deflected or blocked, and no runaway projectile / effect / particle counts.
 *
 * The real render loop is stopped; the suites advance the fixed-step
 * simulation themselves (only the frames that are screenshotted are rendered,
 * which keeps SwiftShader fast). A mid-effect screenshot (UI hidden, 960x540)
 * is saved per technique into $COMBAT_SHOTS (default: <tmpdir>/a4n-combat-shots).
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../../scripts/harness.mjs';

/** Empty, flat meadow (no region content, no water within 24 m). */
export const ARENA = { x: 1220, z: -340 };
export const SHOT_DIR = process.env.COMBAT_SHOTS || path.join(os.tmpdir(), 'a4n-combat-shots');

/** Install the in-page helpers (window.__ct). Runs inside the page. */
function installHelpers(g) {
  const THREE = g.THREE;
  const ct = {
    peaks: null,
    origin: null,
    targets: [],
    events: [],
    /** Advance n fixed steps; only the last renders when `render`. */
    advance(n, render) {
      const r = g.game.render;
      const orig = r.render;
      for (let i = 0; i < n; i++) {
        const draw = render && i === n - 1;
        if (!draw) r.render = () => {};
        try {
          g.game.frame(1 / 30);
        } finally {
          r.render = orig;
        }
        ct.track();
      }
      return ct.snapshot();
    },
    begin(targets) {
      const p = g.game.player;
      ct.origin = { x: p.position.x, y: p.position.y, z: p.position.z };
      ct.targets = targets.map((t) => {
        const e = g.ctx.entities.get(t.id);
        const q = e ? e.position : t;
        return { id: t.id, x: q.x, y: q.y, z: q.z, moved: 0, rise: 0, away: 0 };
      });
      const st = g.debug.bending.stats();
      ct.peaks = { colliders: st.bendingColliders, colliders0: st.bendingColliders, projectiles: st.projectiles, particles: st.particles, effects: st.effects, constructs: st.constructs, playerMoved: 0, playerRise: 0, phases: [], guarding: false, statuses: [] };
      ct.events = [];
    },
    track() {
      const pk = ct.peaks;
      if (!pk) return;
      const st = g.debug.bending.stats();
      pk.colliders = Math.max(pk.colliders, st.bendingColliders);
      pk.projectiles = Math.max(pk.projectiles, st.projectiles);
      pk.particles = Math.max(pk.particles, st.particles);
      pk.effects = Math.max(pk.effects, st.effects);
      pk.constructs = Math.max(pk.constructs, st.constructs);
      const p = g.game.player;
      const o = ct.origin;
      pk.playerMoved = Math.max(pk.playerMoved, Math.hypot(p.position.x - o.x, p.position.z - o.z));
      pk.playerRise = Math.max(pk.playerRise, p.position.y - o.y);
      if (p.guarding) pk.guarding = true;
      for (const s of p.statuses) if (!pk.statuses.includes(s.type)) pk.statuses.push(s.type);
      const c = g.debug.bending.activeCast();
      if (c && !pk.phases.includes(c.phase)) pk.phases.push(c.phase);
      for (const t of ct.targets) {
        const e = g.ctx.entities.get(t.id);
        if (!e) continue;
        t.moved = Math.max(t.moved, Math.hypot(e.position.x - t.x, e.position.z - t.z));
        t.rise = Math.max(t.rise, e.position.y - t.y);
        t.away = Math.max(t.away, Math.hypot(e.position.x - o.x, e.position.z - o.z) - Math.hypot(t.x - o.x, t.z - o.z));
      }
    },
    snapshot() {
      const st = g.debug.bending.stats();
      const p = g.debug.bending.player();
      return {
        playerId: g.game.player.id,
        stats: st,
        player: p,
        cast: g.debug.bending.activeCast(),
        peaks: ct.peaks ? { ...ct.peaks } : null,
        targets: ct.targets.map((t) => ({ ...t, ...(g.debug.bending.target(t.id) || {}) })),
        events: ct.events.slice(),
      };
    },
    /** Clear the arena: remove dummies, finish casts, restore the player. */
    reset(x, z) {
      for (const e of [...g.ctx.entities.all()]) if (e.kind === 'target') g.ctx.entities.remove(e.id);
      g.ctx.input.setVirtualMove(0, 0);
      const p = g.game.player;
      for (let i = 0; i < 400 && g.debug.bending.activeCast(); i++) ct.advance(1, false);
      for (const s of [...p.statuses]) p.removeStatus(s.type);
      g.teleport(x, z);
      p.body.velocity.set(0, 0, 0);
      p.body.external.set(0, 0, 0);
      g.faceTowards(x, z + 10);
      if (p.health) p.health.hp = p.health.maxHp;
      g.debug.bending.refresh();
      ct.advance(3, false);
    },
    /**
     * Frame the action: a camera behind and to the side of the player (follows when
     * `follow`). It looks at a point `far` metres straight ahead of the player: the
     * player aims with the camera (and faces the aim while casting), so the camera's
     * centre ray must land in front of the player or casts would veer sideways.
     */
    camera(back, side, up, far, follow) {
      const p = g.game.player;
      const f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
      const r = { x: -f.z, z: f.x };
      const P0 = p.position.clone();
      g.game.cameraRig.setScripted((_dt, cam) => {
        const P = follow ? p.position : P0;
        cam.position.set(P.x - f.x * back + r.x * side, P.y + up, P.z - f.z * back + r.z * side);
        cam.lookAt(P.x + f.x * far, P.y + 0.6, P.z + f.z * far);
      });
    },
  };
  window.__ct = ct;
  g.ctx.events.on('seismic:pulse', (e) => ct.events.push({ type: 'seismic', revealed: e.revealed }));
  g.ctx.events.on('player:jumped', (e) => ct.events.push({ type: 'jump', double: e.double }));
  g.ctx.events.on('hit', (e) => ct.events.push({ type: 'hit', attacker: e.attackerId, target: e.targetId, damage: e.damage, technique: e.techniqueId, blocked: !!e.blocked }));
  void THREE;
}

export async function openArena(element) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const h = await launch({ width: 960, height: 540 });
  await h.newGame(element);
  await h.eval((g) => {
    g.game.stop();
    g.learnAll();
    g.hideUI(true);
    g.setTime(13);
    g.freezeTime(true);
  });
  await h.eval(installHelpers);
  await h.eval((g, a) => window.__ct.reset(a.x, a.z), ARENA);
  // Let terrain/props around the arena stream in.
  await h.eval(() => window.__ct.advance(20, false));
  return h;
}

export const adv = (h, n, render = false) => h.eval((_g, n, r) => window.__ct.advance(n, r), n, render);
export const snap = (h) => h.eval(() => window.__ct.snapshot());

/**
 * Run one technique trial.
 * spec: {
 *   id, name?, targets?: [dist, side][], casts?: 1, gap?: frames between casts,
 *   charge?: 0..1, aim?: 'target' | 'forward' | {dist, side, y}, frames: total frames after the first cast,
 *   shots?: frame numbers to screenshot, cam?: {back, side, up, look, follow},
 *   during?(h, frame) — async hook called before each frame chunk, check(r) — assertions on the result,
 *   settle?: frames to let constructs/effects end before the cleanup check (default 150)
 * }
 */
export async function trial(h, element, spec, results) {
  const name = spec.name ?? spec.id;
  const shots = [];
  try {
    await h.eval((_g, a) => window.__ct.reset(a.x, a.z), ARENA);
    const targets = await h.eval((g, list) => list.map(([d, s, hp]) => g.debug.bending.spawnTarget(d, s, hp ?? 400)), spec.targets ?? [[7, 0.6], [5, -2.5], [4, 2.6]]);
    // Let the spawned dummies settle and enter the spatial index before casting.
    if (targets.length) await adv(h, 2);
    await h.eval((_g, t) => window.__ct.begin(t), targets);
    const cam = spec.cam ?? {};
    await h.eval((_g, c) => window.__ct.camera(c.back ?? 5.5, c.side ?? 2.6, c.up ?? 2.6, c.far ?? 25, !!c.follow), cam);
    if (spec.setup) await spec.setup(h, targets);
    const doCast = async () =>
      h.eval(
        (g, a) => {
          const p = g.game.player;
          let aim = null;
          if (a.aim === 'target' && a.t) aim = { x: a.t.x, y: a.t.y + 1.2, z: a.t.z };
          else if (a.aim && typeof a.aim === 'object') {
            const f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
            const r = { x: -f.z, z: f.x };
            aim = { x: p.position.x + f.x * a.aim.dist + r.x * (a.aim.side ?? 0), y: p.position.y + (a.aim.y ?? 1.2), z: p.position.z + f.z * a.aim.dist + r.z * (a.aim.side ?? 0) };
          }
          if (a.aim === 'target' && a.t) {
            const e = g.ctx.entities.get(a.t.id);
            if (e) aim = { x: e.position.x, y: e.position.y + 1.2, z: e.position.z };
          }
          return g.cast(a.id, aim, a.charge);
        },
        { id: spec.id, aim: spec.aim ?? 'target', t: targets[0] ?? null, charge: spec.charge ?? 1 },
      );
    const casts = [];
    casts.push(await doCast());
    assert.ok(casts[0].ok, `${name}: cast failed ${JSON.stringify(casts[0])}`);
    const marks = new Set(spec.shots ?? []);
    const castAt = new Set();
    for (let i = 1; i < (spec.casts ?? 1); i++) castAt.add(i * (spec.gap ?? 8));
    let frame = 0;
    const total = spec.frames ?? 30;
    while (frame < total) {
      // Next interesting frame: a screenshot, a follow-up cast, a `during` hook or the end.
      let next = total;
      for (const m of [...marks, ...castAt, ...(spec.hooks ?? [])]) if (m > frame && m < next) next = m;
      await adv(h, next - frame, marks.has(next));
      frame = next;
      if (marks.has(frame)) {
        const file = path.join(SHOT_DIR, `${element}_${name}_${String(frame).padStart(2, '0')}.png`);
        await h.shot(file, { timeout: 180000 });
        shots.push(file);
      }
      if (castAt.has(frame)) {
        if (spec.refresh) await h.eval((g) => g.debug.bending.refresh());
        const r = await doCast();
        casts.push(r);
        assert.ok(r.ok, `${name}: follow-up cast ${casts.length} failed ${JSON.stringify(r)}`);
      }
      if (spec.during) await spec.during(h, frame);
    }
    const res = await snap(h);
    res.casts = casts;
    if (spec.check) await spec.check(res, h);
    // Cleanup: everything the technique made must end and be removed.
    const settle = spec.settle ?? 150;
    const after = await adv(h, settle, false);
    assert.equal(after.stats.casts === 0 || after.cast === null, true, `${name}: cast still active after settling ${JSON.stringify(after.cast)}`);
    assert.equal(after.stats.movers, 0, `${name}: movers left running`);
    assert.equal(after.stats.projectiles, 0, `${name}: projectiles left alive`);
    assert.equal(after.stats.constructs, 0, `${name}: constructs left standing ${JSON.stringify(after.stats.constructKinds)}`);
    assert.equal(after.stats.bendingColliders, res.peaks.colliders0, `${name}: construct collider count did not return (${res.peaks.colliders0} -> ${after.stats.bendingColliders})`);
    assert.ok(after.stats.effects <= 2, `${name}: ${after.stats.effects} live effects after settling`);
    assert.ok(res.peaks.projectiles < 40, `${name}: runaway projectiles ${res.peaks.projectiles}`);
    assert.ok(res.peaks.effects < 120, `${name}: runaway effects ${res.peaks.effects}`);
    results.push(['PASS', name, summary(res)]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
  return shots;
}

export function summary(r) {
  const t = r.targets.map((x) => `${(x.totalDamage ?? 0).toFixed(0)}dmg/${x.moved.toFixed(1)}m/${x.rise.toFixed(1)}up`).join(' ');
  const pk = r.peaks;
  return `targets[${t}] player ${pk.playerMoved.toFixed(1)}m/${pk.playerRise.toFixed(1)}up colliders ${pk.colliders0}->${pk.colliders} proj ${pk.projectiles} fx ${pk.effects} particles ${pk.particles}`;
}

/** Helpers for checks. */
export const dealt = (r) => r.targets.reduce((s, t) => s + (t.totalDamage ?? 0), 0);
export const hitCount = (r) => r.targets.filter((t) => (t.totalDamage ?? 0) > 0).length;

export async function finish(h, element, results, shots) {
  const errors = h.errors.filter((e) => !/favicon|ERR_CONNECTION|net::/i.test(e));
  if (errors.length) results.push(['FAIL', 'no console errors', errors.slice(0, 8).join(' | ')]);
  else results.push(['PASS', 'no console errors']);
  for (const r of results) console.log(r.join(' | '));
  console.log(`screenshots (${shots.length}) in ${SHOT_DIR}:`);
  for (const s of shots) console.log('  ' + s);
  await h.close();
  if (results.some((r) => r[0] === 'FAIL')) process.exitCode = 1;
}
