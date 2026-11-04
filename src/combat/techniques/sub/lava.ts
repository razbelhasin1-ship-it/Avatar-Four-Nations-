import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { LAVA } from '../../../data/subskills';
import type { Entity } from '../../../entities/Entity';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant, ProjectileVisual } from '../../types';
import { anim, resolveTarget, shake } from '../bending/util';
import { aimGround, gate, lavaCheck, lavaSys, SOURCE, subSys, type Pre } from './common';

/**
 * Lavabending (Earth sub-skill): Melt, Lava Disc, Lava Pool, Lava Stream, Lava Moat, Divert and
 * Cool, and Eruption (Avatar State only). A stomp-and-lift stance melts the earth; the shaping
 * and sending are flowing, waterbending-like arm motions. Lava itself is the shared runtime in
 * src/subskills/lava/LavaSystem.ts (spread, burn, cool, steam, enemy avoidance).
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

// Shared visuals (created once, reused by every cast).
let fragGeo: THREE.BufferGeometry | null = null;
let discGeo: THREE.BufferGeometry | null = null;
let colGeo: THREE.BufferGeometry | null = null;
let hotMat: THREE.MeshStandardMaterial | null = null;
let rockMat: THREE.MeshStandardMaterial | null = null;
function mats(): { hot: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial } {
  hotMat ??= new THREE.MeshStandardMaterial({ color: '#4a1406', emissive: '#ff5a12', emissiveIntensity: 2.4, roughness: 0.6 });
  rockMat ??= new THREE.MeshStandardMaterial({ color: '#5a4a3e', roughness: 0.95 });
  return { hot: hotMat, rock: rockMat };
}

function used(cast: Cast): void {
  if (cast.isPlayer) subSys(cast.ctx)?.noteUse('lava', cast.def.id);
}

const common = {
  element: 'earth' as const,
  subSkill: 'lava' as const,
  tier: 4 as const,
  innate: SOURCE.lava,
  airborne: false,
  interruptible: true,
};

// ---------------------------------------------------------------------------
// 1. Melt
// ---------------------------------------------------------------------------

registerTechnique({
  ...common,
  id: 'lava_melt',
  name: 'Melt',
  kind: 'ability',
  description: 'Stomp, then lift: a patch of earth, stone or rubble softens into glowing lava. It spreads a little and burns anyone in it — you too — until it crusts over into stone.',
  usage: 'Aim at nearby ground and press. Needs earth: never metal, ice, snow, wood or water (a loose stone nearby will do on ice and metal floors).',
  icon: '🌋',
  chiCost: LAVA.melt.chi,
  cooldown: LAVA.melt.cooldown,
  windup: 0.5,
  recovery: 0.5,
  movement: 'root',
  range: LAVA.melt.range,
  precheck: lavaCheck('lava_melt', LAVA.melt.range),
  begin(cast) {
    anim(cast.caster, 'stomp', { speed: 1.25, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    const at = aimGround(ctx, cast.caster, LAVA.melt.range, tA, null, cast.aimPoint);
    const m = lava.meltable(at.x, at.z, at.y);
    if (!m.ok) return;
    // On ice or metal the loose stone is what melts: it is used up.
    if (m.stone) {
      at.set(m.stone.x, at.y, m.stone.z);
      m.stone.take();
    }
    anim(cast.caster, 'lift_up', { speed: 1.3, fadeIn: 0.08 });
    ctx.world.fx.crack(at, LAVA.melt.radius * 0.8);
    lava.spawnPatch({ x: at.x, z: at.z, r: m.stone ? LAVA.melt.radius * 0.7 : LAVA.melt.radius, source: cast.isPlayer ? 'player' : 'world', ownerId: cast.caster.id, kind: 'melt', warm: 0.25, life: cast.isPlayer ? LAVA.patchLife : 5 });
    ctx.audio.play('sub.lava.melt', { position: at, volume: 1 });
    ctx.audio.play('bend_earth_sink', { position: at, volume: 0.5, pitch: 0.6 });
    shake(ctx, at, 0.18, 0.3);
    used(cast);
  },
  aiScore: (_c, _t, dist) => (dist < 10 ? 0.3 : 0),
});

// ---------------------------------------------------------------------------
// 2. Lava Disc
// ---------------------------------------------------------------------------

/** Three bits of earth pulled into a spinning, glowing disc. */
function discVisual(): ProjectileVisual {
  const { hot, rock } = mats();
  discGeo ??= new THREE.CylinderGeometry(0.42, 0.42, 0.09, 20);
  fragGeo ??= new THREE.DodecahedronGeometry(0.13, 0);
  const g = new THREE.Group();
  const disc = new THREE.Mesh(discGeo, hot);
  g.add(disc);
  const rim = new THREE.Mesh(discGeo, rock);
  rim.scale.set(1.08, 0.6, 1.08);
  g.add(rim);
  let t = 0;
  return {
    object: g,
    update(p, dt) {
      t += dt;
      // Flat in the direction of travel, spinning like a shuriken.
      const v = p.velocity;
      g.rotation.set(0, Math.atan2(v.x, v.z), 0);
      disc.rotation.y = t * 22;
      rim.rotation.y = t * 22;
    },
    dispose() {
      /* shared geometry and materials */
    },
  };
}

registerTechnique({
  ...common,
  id: 'lava_disc',
  name: 'Lava Disc',
  kind: 'ability',
  description: 'Pull three fragments of earth together into a spinning disc of molten rock and fling it. It cuts through wood and shields, slices light metal and sets flammables alight.',
  usage: 'Aim and press. Short range; pierces through several targets; blocks and guards do not stop it.',
  icon: '☄️',
  chiCost: LAVA.disc.chi,
  cooldown: LAVA.disc.cooldown,
  windup: 0.6,
  recovery: 0.4,
  movement: 'slow',
  range: LAVA.disc.range,
  precheck: (c, ctx): Pre => gate('lava_disc', c, ctx) ?? (lavaSys(ctx)?.meltable(c.position.x, c.position.z, c.position.y).ok || lavaSys(ctx)?.lavaAt(c.position.x, c.position.z, 6) ? null : { reason: 'state', message: 'There is no earth here to make a disc from.' }),
  begin(cast) {
    anim(cast.caster, 'circle_arms', { speed: 1.5, fadeIn: 0.05 });
    // Three fragments rise from the ground and melt together in front of the chest.
    const ctx = cast.ctx;
    const c = cast.caster;
    const f = tA.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const chest = c.castOrigin('chest', tB).addScaledVector(f, 0.7);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + c.yaw;
      const from = chest.clone().add(new THREE.Vector3(Math.cos(a) * 1.1, -1.2, Math.sin(a) * 1.1));
      ctx.vfx.burst('debris', from, { count: 3, dir: chest.clone().sub(from), spread: 0.15, speed: 3.2, size: 0.18, color: '#6b5544', life: 0.45 });
      ctx.vfx.burst('dust', from, { count: 2, speed: 0.6 });
    }
    ctx.audio.play('bend_earth_rise', { position: chest, volume: 0.5, pitch: 1.4 });
  },
  release(cast) {
    const ctx = cast.ctx;
    anim(cast.caster, 'whip_r', { speed: 1.3, fadeIn: 0.04 });
    const origin = cast.caster.castOrigin('hands', tA);
    const dir = tB.copy(cast.aimDir);
    if (dir.y > 0.25) dir.y = 0.25;
    dir.normalize();
    ctx.vfx.burst('embers', origin, { count: 8, dir, spread: 0.3, speed: 4 });
    ctx.audio.play('sub.lava.disc', { position: origin, volume: 0.9 });
    cast.projectile({
      position: origin.clone(),
      velocity: dir.clone().multiplyScalar(LAVA.disc.speed),
      radius: 0.45,
      gravity: 0,
      life: LAVA.disc.range / LAVA.disc.speed,
      damage: 0,
      pierce: LAVA.disc.pierce,
      visual: discVisual(),
      onHitEntity(p, e) {
        // Molten rock: guards and shields do not stop it.
        cast.hit(e, { damage: LAVA.disc.damage, unblockable: true, knockback: p.velocity.clone().setY(0).normalize().multiplyScalar(4), stagger: 45, status: [{ type: 'burn', duration: 3, magnitude: 1.2 }], point: p.position.clone() });
        ctx.vfx.burst('embers', p.position, { count: 10, speed: 3.5 });
        ctx.events.emit('bending:heat', { position: { x: p.position.x, y: p.position.y, z: p.position.z }, radius: 1.5, intensity: 1, casterId: cast.caster.id });
      },
      onHitWorld(p, point) {
        ctx.vfx.burst('embers', point, { count: 14, speed: 4 });
        ctx.vfx.burst('smoke', point, { count: 3, speed: 0.8, color: '#8a7b70' });
        ctx.audio.play('sub.lava.hiss', { position: point, volume: 0.6 });
        // It sets what burns alight and leaves a little molten spatter where it lands.
        ctx.events.emit('bending:heat', { position: { x: point.x, y: point.y, z: point.z }, radius: 2, intensity: 1, casterId: cast.caster.id });
        const lava = lavaSys(ctx);
        if (lava && lava.meltable(point.x, point.z, point.y).ok && Math.abs(point.y - ctx.world.groundAt(point.x, point.z, point.y + 1).y) < 0.6)
          lava.spawnPatch({ x: point.x, z: point.z, r: 0.9, life: 3, source: cast.isPlayer ? 'player' : 'world', ownerId: cast.caster.id, spread: 0, kind: 'melt' });
        void p;
      },
    });
    used(cast);
  },
  aiScore: (_c, _t, dist) => (dist < LAVA.disc.range ? 0.5 : 0),
});

// ---------------------------------------------------------------------------
// 3. Lava Pool
// ---------------------------------------------------------------------------

registerTechnique({
  ...common,
  id: 'lava_pool',
  name: 'Lava Pool',
  kind: 'ability',
  description: 'The ground under your target glows, cracks — and gives way into a pool of lava. They must move, or burn.',
  usage: 'Lock on or aim at a foe and press. The cracks glow for a moment before the pool opens.',
  icon: '♨️',
  chiCost: LAVA.pool.chi,
  cooldown: LAVA.pool.cooldown,
  windup: 0.45,
  recovery: 0.45,
  movement: 'root',
  range: LAVA.pool.range,
  precheck: lavaCheck('lava_pool', LAVA.pool.range),
  begin(cast) {
    anim(cast.caster, 'push_two', { speed: 0.9, fadeIn: 0.06 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    const target: Entity | null = resolveTarget(cast, 3);
    const at = aimGround(ctx, cast.caster, LAVA.pool.range, tA, target, cast.aimPoint);
    if (!lava.meltable(at.x, at.z, at.y).ok) {
      ctx.events.emit('ui:notify', { text: 'The ground there will not melt.', kind: 'warning', duration: 2 });
      return;
    }
    ctx.world.fx.crack(at, LAVA.pool.radius);
    lava.spawnPatch({ x: at.x, z: at.z, r: LAVA.pool.radius, life: LAVA.pool.life, warm: 0.7, kind: 'pool', source: cast.isPlayer ? 'player' : 'world', ownerId: cast.caster.id, spread: 1 });
    ctx.audio.play('bend_earth_sink', { position: at, volume: 0.6, pitch: 0.55 });
    used(cast);
  },
  aiScore: (_c, _t, dist) => (dist < LAVA.pool.range ? 0.4 : 0),
});

// ---------------------------------------------------------------------------
// 4. Lava Stream
// ---------------------------------------------------------------------------

registerTechnique({
  ...common,
  id: 'lava_stream',
  name: 'Lava Stream',
  kind: 'ability',
  description: 'Send a tendril of lava rolling along the ground. It sweeps aside and burns whoever it touches, and bends to chase your target.',
  usage: 'Aim (or lock on) and press. The flow follows the ground and leaves a short-lived trail of lava.',
  icon: '〰️',
  chiCost: LAVA.stream.chi,
  cooldown: LAVA.stream.cooldown,
  windup: 0.55,
  recovery: 0.55,
  movement: 'root',
  range: LAVA.stream.range,
  precheck: lavaCheck('lava_stream', 3, true),
  begin(cast) {
    anim(cast.caster, 'circle_arms', { speed: 1.2, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    anim(cast.caster, 'whip_l', { speed: 1.05, fadeIn: 0.05 });
    const c = cast.caster;
    const target = resolveTarget(cast, 3);
    const aim = aimGround(ctx, c, LAVA.stream.range, tA, target, cast.aimPoint);
    const dx = aim.x - c.position.x, dz = aim.z - c.position.z;
    const l = Math.hypot(dx, dz) || 1;
    lava.startFlow({ x: c.position.x + (dx / l) * 1.6, z: c.position.z + (dz / l) * 1.6, dirX: dx, dirZ: dz, speed: LAVA.stream.speed, length: LAVA.stream.length, r: LAVA.stream.radius, life: 3.2, ownerId: c.id, source: cast.isPlayer ? 'player' : 'world', chase: target, damage: 22 * cast.power });
    ctx.audio.play('sub.lava.flow', { position: c.position, volume: 0.9 });
    used(cast);
  },
  aiScore: (_c, _t, dist) => (dist < LAVA.stream.range ? 0.45 : 0),
});

// ---------------------------------------------------------------------------
// 5. Lava Moat
// ---------------------------------------------------------------------------

function raiseColumn(cast: Cast, at: THREE.Vector3): void {
  const ctx = cast.ctx;
  const { hot } = mats();
  colGeo ??= new THREE.CylinderGeometry(0.7, 1.15, 3.4, 14, 3);
  const mesh = new THREE.Mesh(colGeo, hot);
  mesh.position.set(at.x, at.y - 1.6, at.z);
  ctx.vfx.group.add(mesh);
  const col = ctx.world.collision.add({ shape: 'cylinder', x: at.x, y: at.y + 1.6, z: at.z, r: 1.0, hy: 1.7, solid: true, walkable: false, surface: 'lava', tag: 'lava_column' });
  ctx.audio.play('sub.lava.melt', { position: at, volume: 1, pitch: 0.8 });
  ctx.vfx.burst('embers', at, { count: 18, speed: 5, radius: 0.8 });
  const lava = lavaSys(ctx);
  // Rise, burn whoever charges into it, then sink back into the ground.
  let t = 0;
  const step = () => {
    t += 0.05;
    mesh.position.y = at.y - 1.6 + Math.min(1, t / 0.25) * 3.3 - Math.max(0, t - 2.6) * 6;
    for (const e of ctx.entities.queryRadius(at, 1.9)) if (e !== cast.caster && e.alive && e.health) cast.hit(e, { damage: 18, knockback: tB.set(e.position.x - at.x, 0, e.position.z - at.z).normalize().multiplyScalar(9), launch: 2, stagger: 80, status: [{ type: 'burn', duration: 2 }] });
    if (t < 3.1 && ctx.session.active) lava?.after(0.05, step);
    else {
      ctx.vfx.group.remove(mesh);
      ctx.world.collision.remove(col);
    }
  };
  lava?.after(0.05, step);
}

registerTechnique({
  ...common,
  id: 'lava_moat',
  name: 'Lava Moat',
  kind: 'defense',
  description: 'Sweep your arms around you and the ground melts into a ring of lava that keeps melee fighters at bay. Charge at you, and a column of lava rises in the way.',
  usage: 'Press to ring yourself in lava for a few seconds. Foes panic and fall back; anyone crossing burns (allies too).',
  icon: '⭕',
  chiCost: LAVA.moat.chi,
  cooldown: LAVA.moat.cooldown,
  windup: 0.6,
  recovery: 0.4,
  movement: 'root',
  range: LAVA.moat.radius,
  precheck: lavaCheck('lava_moat', 3, true),
  begin(cast) {
    anim(cast.caster, 'circle_arms', { speed: 1.0, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    const c = cast.caster;
    const R = LAVA.moat.radius;
    const r = LAVA.moat.width;
    const n = Math.ceil((Math.PI * 2 * R) / (r * 1.45));
    const cells: Array<{ x: number; z: number; r: number }> = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = c.position.x + Math.sin(a) * R, z = c.position.z + Math.cos(a) * R;
      if (lava.meltable(x, z, c.position.y).ok) cells.push({ x, z, r });
    }
    if (!cells.length) return;
    lava.spawnPatch({ x: c.position.x, z: c.position.z, r, cells, life: LAVA.moat.life, kind: 'moat', source: cast.isPlayer ? 'player' : 'world', ownerId: c.id, spread: 0, warm: 0.2 });
    ctx.audio.play('sub.lava.flow', { position: c.position, volume: 1, pitch: 0.85 });
    shake(ctx, c.position, 0.15, 0.3);
    // A foe charging in: a column of lava rises in its path.
    let charger: Entity | null = null;
    let best: number = LAVA.moat.columnRange;
    for (const e of ctx.entities.queryRadius(c.position, LAVA.moat.columnRange)) {
      if (!ctx.combat.canHarm(c, e) || !e.body) continue;
      const to = tB.set(c.position.x - e.position.x, 0, c.position.z - e.position.z);
      const d = to.length();
      const v = e.body.velocity;
      const closing = d > 0.1 ? (v.x * to.x + v.z * to.z) / d : 0;
      if (closing > 2 && d < best) {
        best = d;
        charger = e;
      }
    }
    if (charger) {
      const d = Math.max(1.2, best - 1.6);
      const dir = tB.set(charger.position.x - c.position.x, 0, charger.position.z - c.position.z).normalize();
      const at = tA.set(c.position.x + dir.x * Math.min(d, R - 0.8), 0, c.position.z + dir.z * Math.min(d, R - 0.8));
      at.y = ctx.world.groundAt(at.x, at.z, c.position.y + 1.5).y;
      raiseColumn(cast, at.clone());
    }
    used(cast);
  },
  aiScore: (_c, _t, dist) => (dist < 4 ? 0.5 : 0),
});

// ---------------------------------------------------------------------------
// 6. Divert and Cool
// ---------------------------------------------------------------------------

function coolPrecheck(caster: Combatant, ctx: GameContext): Pre {
  const g = gate('lava_cool', caster, ctx);
  if (g) return g;
  const lava = lavaSys(ctx);
  if (!lava) return { reason: 'state', message: 'Lava is unavailable.' };
  const at = aimGround(ctx, caster, LAVA.cool.range, tA);
  if (lava.lavaAt(at.x, at.z, LAVA.cool.radius) || lava.diverters.some((d) => d.near(at.x, at.z))) return null;
  // Lava right around you counts too (cool your footing).
  if (lava.lavaAt(caster.position.x, caster.position.z, 3)) return null;
  return { reason: 'state', message: 'There is no lava within reach to divert or cool.' };
}

registerTechnique({
  ...common,
  id: 'lava_cool',
  name: 'Divert and Cool',
  kind: 'ability',
  description: 'Turn a flow of lava aside, and draw the heat out of lava — yours or the world\'s — so it sets into solid stone: instant bridges, steps, walls and safe footing.',
  usage: 'Aim at lava and press: it cools into stone (a hiss and a crack). Aimed at a moving wave or river of lava, it is turned aside first.',
  icon: '🪨',
  chiCost: LAVA.cool.chi,
  cooldown: LAVA.cool.cooldown,
  windup: 0.4,
  recovery: 0.35,
  movement: 'slow',
  range: LAVA.cool.range,
  precheck: coolPrecheck,
  begin(cast) {
    anim(cast.caster, 'push_two', { speed: 1.1, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    const c = cast.caster;
    const at = aimGround(ctx, c, LAVA.cool.range, tA, null, cast.aimPoint);
    let diverted = false;
    for (const d of lava.diverters) if (d.near(at.x, at.z) && d.divert(at.x, at.z, c.position.x, c.position.z)) diverted = true;
    let cooled = lava.coolAt(at.x, at.z, LAVA.cool.radius, false).length;
    if (!cooled && !diverted) cooled = lava.coolAt(c.position.x, c.position.z, 3, false).length;
    anim(c, 'lift_up', { speed: 1.4, fadeIn: 0.06 });
    if (diverted) ctx.audio.play('sub.lava.flow', { position: at, volume: 0.8, pitch: 0.7 });
    if (cooled || diverted) used(cast);
  },
});

// ---------------------------------------------------------------------------
// 7. Eruption (Avatar State only)
// ---------------------------------------------------------------------------

registerTechnique({
  ...common,
  id: 'lava_eruption',
  name: 'Eruption',
  kind: 'ability',
  requires: 'avatarState',
  description: 'In the Avatar State, wake the fire under the earth: after a long gather the ground erupts in fountains of lava. Huge, slow, indiscriminate and hard to aim — it can hurt your allies.',
  usage: 'Only in the Avatar State. Aim roughly and press; the vents open around where you aimed after a moment.',
  icon: '🌋',
  chiCost: LAVA.eruption.chi,
  cooldown: LAVA.eruption.cooldown,
  windup: 0.9,
  recovery: 0.9,
  movement: 'root',
  interruptible: false,
  range: LAVA.eruption.range,
  precheck: lavaCheck('lava_eruption', LAVA.eruption.range),
  begin(cast) {
    anim(cast.caster, 'slam_down', { speed: 0.8, fadeIn: 0.05 });
    cast.ctx.audio.play('sub.lava.rumble', { position: cast.caster.position, volume: 1 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const lava = lavaSys(ctx);
    if (!lava) return;
    anim(cast.caster, 'raise_two', { speed: 0.7, fadeIn: 0.08 });
    const aim = aimGround(ctx, cast.caster, LAVA.eruption.range, new THREE.Vector3(), null, cast.aimPoint);
    // Hard to aim: the centre wanders.
    const wa = Math.random() * Math.PI * 2, wr = Math.random() * 5;
    const center = new THREE.Vector3(aim.x + Math.cos(wa) * wr, aim.y, aim.z + Math.sin(wa) * wr);
    center.y = ctx.world.groundAt(center.x, center.z, aim.y + 2).y;
    ctx.world.fx.crack(center, LAVA.eruption.radius * 0.7);
    shake(ctx, center, 0.5, LAVA.eruption.delay + 0.6);
    lava.after(LAVA.eruption.delay, () => {
      if (!ctx.session.active) return;
      ctx.audio.play('sub.lava.erupt', { position: center, volume: 1 });
      if (!ctx.settings.data.gameplay.reduceIntenseEffects) ctx.vfx.flash(center, '#ff7a2a', 7, 0.35, 30);
      shake(ctx, center, 0.7, 0.9);
      // Indiscriminate blast: allies are not spared.
      cast.areaHit({ center: center.clone().setY(center.y + 1), radius: LAVA.eruption.radius * 0.55, height: 4, damage: LAVA.eruption.damage, launch: 9, stagger: 120, knockdown: true, friendlyFire: true, status: [{ type: 'burn', duration: 3 }] });
      for (let i = 0; i < LAVA.eruption.vents; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * LAVA.eruption.radius;
        const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
        const m = lava.meltable(x, z, center.y);
        if (!m.ok) continue;
        lava.spawnPatch({ x, z, r: 1.5 + Math.random() * 1.1, life: 7 + Math.random() * 3, kind: 'eruption', source: 'player', ownerId: cast.caster.id, spread: 2, capped: false });
        const vent = new THREE.Vector3(x, m.y + 0.3, z);
        ctx.vfx.burst('fireball', vent, { count: 6, dir: new THREE.Vector3(0, 1, 0), spread: 0.35, speed: 9, size: 1.2 });
        ctx.vfx.burst('embers', vent, { count: 16, dir: new THREE.Vector3(0, 1, 0), spread: 0.6, speed: 10 });
        ctx.vfx.burst('smoke', vent, { count: 5, speed: 2.5, size: 2.4, color: '#2a211d' });
        // Fountains: molten blobs arc out and splash down as small pools.
        for (let k = 0; k < 2; k++) {
          const b = Math.random() * Math.PI * 2;
          cast.projectile({
            position: vent.clone(),
            velocity: new THREE.Vector3(Math.cos(b) * (3 + Math.random() * 4), 9 + Math.random() * 5, Math.sin(b) * (3 + Math.random() * 4)),
            radius: 0.35,
            gravity: 18,
            life: 3,
            damage: 10,
            visual: blobVisual(),
            onHitWorld(_p, point) {
              if (lava.meltable(point.x, point.z, point.y).ok) lava.spawnPatch({ x: point.x, z: point.z, r: 0.9, life: 4, source: 'player', ownerId: cast.caster.id, spread: 0, kind: 'eruption', capped: false });
              ctx.vfx.burst('embers', point, { count: 8, speed: 3 });
            },
          });
        }
      }
    });
    used(cast);
  },
});

function blobVisual(): ProjectileVisual {
  const { hot } = mats();
  fragGeo ??= new THREE.DodecahedronGeometry(0.13, 0);
  const m = new THREE.Mesh(fragGeo, hot);
  m.scale.setScalar(2.4);
  return {
    object: m,
    update(_p, dt) {
      m.rotation.x += dt * 5;
      m.rotation.z += dt * 3;
    },
    dispose() {
      /* shared */
    },
  };
}
