import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { ProjectileVisual } from '../../combat/types';
import { debris, effect } from './loop';
import { flameBallMaterial, flameMaterial, flameStreakMaterial, setOpacity, type FlameBallOptions, type FlameOptions } from './materials';
import { Trail } from './ribbon';
import { arcSheet, billboardGeometry, coneTube, crossPlanes, flatRing, ringWall, shared, streakGeometry } from './shapes';

/**
 * Fire effect builders: shaped, shader-driven flame meshes (not just particles)
 * so firebending reads on every preset — the low preset has no bloom and only
 * 40% particles, so the meshes carry the silhouette and particles add life.
 */

const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function q(ctx: GameContext): 'low' | 'medium' | 'high' {
  return ctx.vfx.quality;
}


/** Trail that keeps fading on its own after its owner is gone. */
function releaseTrail(ctx: GameContext, trail: Trail, mat: THREE.Material): void {
  effect(
    () => {
      trail.update(ctx.time.elapsed, ctx.camera.position);
      return trail.length > 1;
    },
    () => {
      trail.mesh.removeFromParent();
      trail.dispose();
      mat.dispose();
    },
  );
}

export function flameTrail(ctx: GameContext, width: number, life: number, o: FlameOptions = {}): { trail: Trail; mat: THREE.ShaderMaterial } {
  const mat = flameMaterial({ sheet: true, scroll: [0, 2.2], scale: [1, 2.5], intensity: 1.8, ...o });
  const trail = new Trail(mat, { width, life, maxPoints: q(ctx) === 'low' ? 14 : 24, minDist: 0.12 });
  ctx.vfx.group.add(trail.mesh);
  return { trail, mat };
}

// ---------------------------------------------------------------------------
// Flame billboards
// ---------------------------------------------------------------------------

/** Camera-facing swirling ball of fire; scale = diameter. The caller disposes the material. */
function ballMesh(o: FlameBallOptions): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = flameBallMaterial(o);
  const mesh = new THREE.Mesh(billboardGeometry(), mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/** Camera-facing comet of flame trailing behind the mesh's position along -dir. */
function streakMesh(o: FlameOptions & { length: number; width: number }): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = flameStreakMaterial(o);
  const mesh = new THREE.Mesh(streakGeometry(), mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// Projectile visuals
// ---------------------------------------------------------------------------

/** Fire bolt (punch / kick): a comet of flame — swirling hot head, tongues streaming behind — plus trail and embers. */
export function fireBoltVisual(ctx: GameContext, radius: number, o: { length?: number; palette?: FlameOptions['palette']; trail?: number } = {}): ProjectileVisual {
  const group = new THREE.Group();
  const len = o.length ?? radius * 7;
  const pal = o.palette ?? 'fire';
  const tail = streakMesh({ palette: pal, blend: 'normal', intensity: 1.25, length: len, width: radius * 2.6, scale: [1, 2.4], scroll: [0.15, 3.2] });
  const head = ballMesh({ palette: pal, intensity: 1.05, swirl: 0.9, heat: 0.25 });
  group.add(tail.mesh, head.mesh);
  const uDir = tail.mat.uniforms.uDir.value as THREE.Vector3;
  const { trail, mat: trailMat } = flameTrail(ctx, radius * 2.2, o.trail ?? 0.16, { palette: pal });
  const embers = ctx.vfx.emitter('embers', q(ctx) === 'low' ? 24 : 50, { speed: 0.5, size: 1 }, 3);
  const flames = ctx.vfx.emitter('flame', q(ctx) === 'low' ? 20 : 40, { speed: 0.3, size: radius * 2.2 }, 3);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      if (p.velocity.lengthSq() > 1e-6) uDir.copy(p.velocity).normalize();
      const grow = Math.min(1, 0.45 + t * 9);
      tail.mat.uniforms.uLength.value = len * grow * (0.9 + Math.sin(t * 27) * 0.1);
      tail.mat.uniforms.uWidth.value = radius * 2.6 * grow;
      head.mesh.scale.setScalar(radius * 2.4 * grow * (1 + Math.sin(t * 40) * 0.06));
      trail.push(p.position, ctx.time.elapsed);
      trail.update(ctx.time.elapsed, ctx.camera.position);
      embers.position.copy(p.position);
      flames.position.copy(p.position);
    },
    dispose: () => {
      embers.stop();
      flames.stop();
      tail.mat.dispose();
      head.mat.dispose();
      releaseTrail(ctx, trail, trailMat);
    },
  };
}

/** Charged fireball: a roiling, swirling ball with a white-hot heart and a streaming tail, shedding flame and smoke. */
export function fireballVisual(ctx: GameContext, radius: number): ProjectileVisual {
  const group = new THREE.Group();
  const outer = ballMesh({ palette: 'fire', blend: 'normal', intensity: 1.2, swirl: 0.55, heat: 0.05 });
  const inner = ballMesh({ palette: 'hot', intensity: 0.85, swirl: -0.8, heat: 0.3 });
  const tail = streakMesh({ palette: 'fire', blend: 'normal', intensity: 1.2, length: radius * 5, width: radius * 2.3, scale: [1, 2], scroll: [0.15, 2.6] });
  group.add(tail.mesh, outer.mesh, inner.mesh);
  const uDir = tail.mat.uniforms.uDir.value as THREE.Vector3;
  const { trail, mat: trailMat } = flameTrail(ctx, radius * 1.8, 0.2);
  const em = ctx.vfx.emitter('fire', q(ctx) === 'low' ? 30 : 70, { speed: 0.6, size: 1 + radius }, 4);
  const smoke = ctx.vfx.emitter('smoke', q(ctx) === 'low' ? 4 : 10, { speed: 0.4, size: radius }, 4);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      if (p.velocity.lengthSq() > 1e-6) uDir.copy(p.velocity).normalize();
      const pulse = 1 + Math.sin(t * 22) * 0.05;
      outer.mesh.scale.setScalar(radius * 2.7 * pulse);
      inner.mesh.scale.setScalar(radius * 1.5 * (1 + Math.sin(t * 31 + 1) * 0.07));
      trail.push(p.position, ctx.time.elapsed);
      trail.update(ctx.time.elapsed, ctx.camera.position);
      em.position.copy(p.position);
      smoke.position.copy(p.position);
    },
    dispose: () => {
      em.stop();
      smoke.stop();
      outer.mat.dispose();
      inner.mat.dispose();
      tail.mat.dispose();
      releaseTrail(ctx, trail, trailMat);
    },
  };
}

// ---------------------------------------------------------------------------
// One-shot effects
// ---------------------------------------------------------------------------

/** Short jet of flame bursting out of a fist/foot along `dir` (punches, kicks). */
export function fireMuzzle(ctx: GameContext, pos: THREE.Vector3, dir: THREE.Vector3, size = 1): void {
  const d = dir.clone().normalize();
  const len = 1.15 * size;
  const jet = streakMesh({ blend: 'normal', intensity: 1.3, heat: 0.1, length: len, width: 0.55 * size, scroll: [0.1, 3.8], scale: [1, 1.6] });
  (jet.mat.uniforms.uDir.value as THREE.Vector3).copy(d);
  ctx.vfx.addTransient(jet.mesh, 0.17, (t) => {
    const l = len * (0.35 + t * 0.9);
    jet.mat.uniforms.uLength.value = l;
    jet.mat.uniforms.uWidth.value = 0.55 * size * (0.8 + t * 0.6);
    jet.mesh.position.copy(pos).addScaledVector(d, l * 0.85);
    setOpacity(jet.mat, 1 - t * t);
  }, () => jet.mat.dispose());
  ctx.vfx.burst('flame', pos, { count: 5, dir: d, spread: 0.35, speed: 2.4, size: size * 0.8 });
  ctx.vfx.flash(pos, '#ff9a40', 1.4 * size, 0.08, 6);
}

export interface ExplosionOptions {
  /** Hot white-gold blast instead of normal fire. */
  hot?: boolean;
  debris?: boolean;
  smoke?: boolean;
  column?: boolean;
}

/**
 * Fire explosion: a white-hot core swells into a roiling fireball that rises and cools
 * (white, yellow, orange, deep red), billowing puffs thrown outward, then smoke; embers,
 * sparks, a ground shock ring, debris and a scene flash.
 */
export function fireExplosion(ctx: GameContext, pos: THREE.Vector3, radius: number, o: ExplosionOptions = {}): void {
  const low = q(ctx) === 'low';
  const balls = low ? 2 : 3;
  for (let i = 0; i < balls; i++) {
    const main = i === 0;
    const b = ballMesh({ palette: o.hot && main ? 'hot' : 'fire', blend: 'normal', intensity: main ? 1.25 : 1.15, swirl: (Math.random() - 0.5) * 1.6, heat: 0.55 });
    const off = main ? new THREE.Vector3() : new THREE.Vector3(Math.random() - 0.5, 0.3 + Math.random() * 0.5, Math.random() - 0.5).normalize().multiplyScalar(radius * (0.3 + Math.random() * 0.25));
    const size = radius * (main ? 2.3 : 1.35 + Math.random() * 0.4);
    const life = 0.45 + radius * 0.05 + (main ? 0.12 : Math.random() * 0.15);
    const delay = main ? 0 : 0.03 + Math.random() * 0.08;
    const total = life + delay;
    b.mesh.position.copy(pos).add(off);
    b.mesh.scale.setScalar(0.001);
    ctx.vfx.addTransient(b.mesh, total, (t) => {
      const lt = (t * total - delay) / life;
      if (lt <= 0) return;
      const grow = 1 - Math.pow(1 - Math.min(1, lt * 2.6), 3);
      b.mesh.scale.setScalar(size * (0.3 + 0.7 * grow + lt * 0.15));
      b.mesh.position.y = pos.y + off.y + radius * 0.5 * lt * lt;
      // It cools as it grows: white-hot, yellow, orange, deep red, gone.
      b.mat.uniforms.uHeat.value = 0.55 - lt * 1.5;
      setOpacity(b.mat, lt < 0.6 ? 1 : 1 - (lt - 0.6) / 0.4);
    }, () => b.mat.dispose());
  }
  if (o.column) {
    const colMat = flameMaterial({ rimFade: true, scroll: [0.2, -2.6], scale: [2, 1.4], intensity: 1.5 });
    const col = new THREE.Mesh(shared('fx_column', () => coneTube(1, 0.35, 12, 8)), colMat);
    col.position.copy(pos);
    col.rotation.x = -Math.PI / 2;
    ctx.vfx.addTransient(col, 0.7, (t) => {
      const e = 1 - Math.pow(1 - t, 2);
      col.scale.set(radius * 0.22 * (1 - t * 0.3), radius * 0.22 * (1 - t * 0.3), radius * (0.3 + e * 1.1));
      colMat.uniforms.uHeat.value = 0.2 - t * 1.2;
      setOpacity(colMat, t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5);
    }, () => colMat.dispose());
  }
  const ground = pos.clone();
  ground.y = ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y;
  const nearGround = pos.y - ground.y < radius;
  if (nearGround) ctx.vfx.ring(ground.clone().setY(ground.y + 0.12), o.hot ? '#ffd890' : '#ff8a30', radius * 1.6, 0.45, { opacity: 0.6 });
  const n = low ? 1 : 2;
  // Billowing puffs thrown out of the blast; they swell, rise and cool.
  ctx.vfx.burst('fireball', pos, { count: (low ? 6 : 10) + Math.round(radius * 2), speed: 0.6 + radius * 0.55, radius: radius * 0.2, size: 0.45 + radius * 0.3 });
  ctx.vfx.burst('fire', pos, { count: 10 * n, speed: 1.6 + radius * 0.4, radius: radius * 0.3, size: 1 + radius * 0.2 });
  ctx.vfx.burst('embers', pos, { count: 18 * n, speed: 2 + radius * 0.5, spread: 1.6 });
  ctx.vfx.burst('sparks', pos, { count: 10 * n, speed: 1.4 });
  if (o.smoke !== false) ctx.vfx.burst('smoke', pos.clone().setY(pos.y + radius * 0.4), { count: 5 * n + Math.round(radius), radius: radius * 0.45, size: 0.8 + radius * 0.3, speed: 0.7 });
  if (o.debris !== false && nearGround) debris(ground.clone().setY(ground.y + 0.2), Math.round(4 + radius * 2), { spread: 1.2, speed: 5 + radius, size: 0.12, color: '#5a4a3c' });
  ctx.vfx.flash(pos, o.hot ? '#ffe0a0' : '#ff8a30', 6 + radius * 2, 0.32, 10 + radius * 4);
  if (nearGround) ctx.world.fx.scorch(ground, radius * 0.75);
  ctx.world.fx.disturb(pos, radius * 2.2, 1);
}

/** Small lingering tuft of flame on the ground (burning trails, aftermath). */
export function groundFlame(ctx: GameContext, pos: THREE.Vector3, life: number, size = 1): { position: THREE.Vector3; done: boolean } {
  const mat = flameMaterial({ sheet: true, scroll: [0.2, -2.6], scale: [1, 1.2], intensity: 1.8, seed: Math.random() * 20 });
  const mesh = new THREE.Mesh(shared('fx_tuft', () => crossPlanes(1, 1)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.random() * Math.PI;
  mesh.position.copy(pos);
  const h = size * (0.8 + Math.random() * 0.5);
  const handle = { position: pos.clone(), done: false };
  ctx.vfx.addTransient(mesh, life, (t) => {
    const grow = Math.min(1, t * life * 6);
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    mesh.scale.set(size * 0.75 * grow, size * 0.75 * grow, h * grow * (0.85 + Math.sin(t * life * 17) * 0.15) * fade);
    setOpacity(mat, fade);
    if (Math.random() < 0.05) ctx.vfx.burst('embers', pos, { count: 1, speed: 0.6 });
  }, () => {
    handle.done = true;
    mat.dispose();
  });
  return handle;
}

/** Crescent wall of flame tongues expanding from `origin` toward `dir` (flame sweep). */
export function flameArc(ctx: GameContext, origin: THREE.Vector3, dir: THREE.Vector3, o: { r0: number; r1: number; arc: number; height: number; duration: number; palette?: FlameOptions['palette'] }): void {
  const geo = arcSheet({ radius: 1, arc: o.arc, height: 1, segA: q(ctx) === 'low' ? 20 : 36, segH: 3, anchor: 'base', flow: 'up', taper: 0.55, flare: 0.25 });
  const mat = flameMaterial({ sheet: true, scroll: [0.6, -2.8], scale: [5, 1.1], intensity: 1.45, palette: o.palette, heat: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  mesh.rotation.y = Math.atan2(dir.x, dir.z);
  ctx.vfx.addTransient(mesh, o.duration, (t) => {
    const e = 1 - Math.pow(1 - t, 2);
    const r = o.r0 + (o.r1 - o.r0) * e;
    const hk = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) * 0.6;
    mesh.scale.set(r, o.height * hk, r);
    setOpacity(mat, t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
  }, () => {
    geo.dispose();
    mat.dispose();
  });
}

/**
 * Crescent of flame thrown by a sweeping slash (fire arc): a curved burning band that flies
 * along `dir` and widens as it goes, its flames streaming along the arc, a hotter core inside.
 * `roll` tilts the crescent about the travel axis (to follow the angle of the slash).
 */
export function flameBlade(
  ctx: GameContext,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  o: { length: number; duration: number; r0?: number; r1?: number; height?: number; arc?: number; roll?: number; palette?: FlameOptions['palette'] },
): void {
  const low = q(ctx) === 'low';
  const arc = o.arc ?? 2.3;
  const geo = shared(`fx_fblade_${arc.toFixed(2)}_${low ? 'l' : 'h'}`, () => arcSheet({ radius: 1, arc, height: 1, segA: low ? 18 : 32, segH: 3, taper: 1, flow: 'arc' }));
  const d = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(Z, d);
  if (o.roll) quat.multiply(new THREE.Quaternion().setFromAxisAngle(Z, o.roll));
  const r0 = o.r0 ?? 0.6, r1 = o.r1 ?? 2.6, h = o.height ?? 0.6;
  const layers = low ? 1 : 2;
  for (let i = 0; i < layers; i++) {
    const core = i === 1;
    const mat = flameMaterial({ sheet: true, scroll: [0.4, core ? -3.2 : -2.4], scale: [1.2, 4], intensity: core ? 2 : 1.45, palette: core ? 'hot' : o.palette, heat: core ? 0.35 : 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.copy(quat);
    const lag = core ? 0.03 : 0;
    ctx.vfx.addTransient(mesh, o.duration + lag, (t) => {
      const lt = Math.max(0, Math.min(1, (t * (o.duration + lag) - lag) / o.duration));
      const e = 1 - (1 - lt) * (1 - lt);
      mesh.position.copy(origin).addScaledVector(d, o.length * e - (1 - e) * 0.3);
      const r = (r0 + (r1 - r0) * e) * (core ? 0.94 : 1);
      // Flares up off the hand, then thins out as it burns away.
      const hh = h * (core ? 0.45 : 1) * (lt < 0.15 ? 0.45 + lt * 3.6 : 1.0 - (lt - 0.15) * 0.55);
      mesh.scale.set(r, hh, r * 0.55);
      setOpacity(mat, lt < 0.1 ? lt / 0.1 : lt > 0.55 ? 1 - (lt - 0.55) / 0.45 : 1);
    }, () => mat.dispose());
  }
}

/** Expanding horizontal ring of fire (spinning kicks, novas). */
export function flameRing(ctx: GameContext, center: THREE.Vector3, o: { r0: number; r1: number; height: number; duration: number; palette?: FlameOptions['palette'] }): void {
  const disk = flameMaterial({ sheet: true, scroll: [-1.2, -1.6], scale: [8, 1], intensity: 1.35, palette: o.palette, heat: 0 });
  const ringGeo = shared(`fx_flame_ring_${q(ctx)}`, () => flatRing(0.82, 1, Math.PI * 2, q(ctx) === 'low' ? 36 : 64, 'out'));
  const mDisk = new THREE.Mesh(ringGeo, disk);
  mDisk.position.copy(center);
  const wall = flameMaterial({ sheet: true, scroll: [0.8, -2.6], scale: [10, 1], intensity: 1.5, palette: o.palette });
  const wallGeo = shared(`fx_flame_wall_${q(ctx)}`, () => ringWall(1, 1, q(ctx) === 'low' ? 36 : 64, 'up', 0.12));
  const mWall = new THREE.Mesh(wallGeo, wall);
  mWall.position.copy(center).setY(center.y - o.height * 0.35);
  ctx.vfx.addTransient(mDisk, o.duration, (t) => {
    const e = 1 - Math.pow(1 - t, 2.2);
    const r = o.r0 + (o.r1 - o.r0) * e;
    mDisk.scale.set(r, 1, r);
    mDisk.rotation.y += 0.15;
    setOpacity(disk, t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
  }, () => disk.dispose());
  ctx.vfx.addTransient(mWall, o.duration, (t) => {
    const e = 1 - Math.pow(1 - t, 2.2);
    const r = o.r0 + (o.r1 - o.r0) * e;
    mWall.scale.set(r, o.height * (t < 0.15 ? t / 0.15 : 1.15 - t * 0.6), r);
    mWall.rotation.y -= 0.1;
    setOpacity(wall, t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5);
  }, () => wall.dispose());
}

/**
 * Continuous flame stream (flamethrower / breath). Call update() each frame with
 * origin, direction and length; dispose() when the channel ends.
 */
export class FlameStream {
  readonly group = new THREE.Group();
  private readonly outer: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly flames: ReturnType<GameContext['vfx']['emitter']>;
  private readonly smoke: ReturnType<GameContext['vfx']['emitter']>;
  private fade = 0;
  private t = 0;

  constructor(private readonly ctx: GameContext, private readonly width = 1, o: { palette?: FlameOptions['palette'] } = {}) {
    const lowQ = q(ctx) === 'low';
    const outerMat = flameMaterial({ rimFade: true, blend: 'normal', scroll: [0.3, -4.2], scale: [2, 2.2], intensity: 1.2, palette: o.palette ?? 'fire', opacity: 0.9, heat: -0.05 });
    const innerMat = flameMaterial({ rimFade: true, scroll: [-0.2, -5.5], scale: [2, 2.8], intensity: 1.2, palette: o.palette ?? 'fire', heat: 0.1 });
    const coreMat = flameMaterial({ rimFade: true, scroll: [0, -7], scale: [1, 3], intensity: 1.3, palette: 'hot', heat: 0.2 });
    this.mats.push(outerMat, innerMat, coreMat);
    const geo = shared(`fx_stream_${lowQ ? 'l' : 'h'}`, () => coneTube(0.12, 1, lowQ ? 10 : 16, lowQ ? 6 : 10));
    this.outer = new THREE.Mesh(geo, outerMat);
    this.inner = new THREE.Mesh(geo, innerMat);
    this.core = new THREE.Mesh(geo, coreMat);
    this.group.add(this.outer, this.inner, this.core);
    ctx.vfx.group.add(this.group);
    this.flames = ctx.vfx.emitter('flame', lowQ ? 40 : 90, { speed: 4, spread: 0.18, size: 0.95 * width });
    this.smoke = ctx.vfx.emitter('smoke', lowQ ? 6 : 14, { speed: 0.6, size: 1.2 * width });
  }

  update(dt: number, origin: THREE.Vector3, dir: THREE.Vector3, length: number, intensity = 1): void {
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt * 8);
    const k = this.fade * intensity;
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(Z, tmp.copy(dir).normalize());
    const w = this.width;
    const wob = 1 + Math.sin(this.t * 31) * 0.06;
    this.outer.scale.set(w * 1.35 * wob, w * 1.35 * wob, length * 1.02);
    this.inner.scale.set(w * 0.85, w * 0.85, length * 0.92);
    this.core.scale.set(w * 0.35, w * 0.35, length * 0.6);
    for (const m of this.mats) setOpacity(m, k);
    this.flames.position.copy(origin).addScaledVector(dir, 0.4);
    this.flames.direction.copy(dir);
    this.flames.options.speed = 2.4 + length * 0.35;
    this.smoke.position.copy(origin).addScaledVector(dir, length * 0.9);
  }

  /** Fade out over `fadeTime` then free everything. */
  dispose(fadeTime = 0.18): void {
    this.flames.stop();
    this.smoke.stop();
    let t = 0;
    effect(
      (dt) => {
        t += dt;
        const k = Math.max(0, 1 - t / fadeTime);
        for (const m of this.mats) setOpacity(m, k);
        this.group.scale.setScalar(1 + t * 1.5);
        return t < fadeTime;
      },
      () => {
        this.group.removeFromParent();
        for (const m of this.mats) m.dispose();
      },
    );
  }
}

/**
 * Fire shield: a disc of flame tongues radiating from a white-hot centre, spinning in front of
 * the bender and facing `dir`, its rim throwing off flames. update() every frame; pulse() swells
 * it (something burned away, a perfect block); dispose() lets it gutter out.
 */
export class FireWheel {
  readonly group = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly core: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private readonly mats: THREE.ShaderMaterial[] = [];
  private fade = 0;
  private flare = 0;
  private t = 0;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(private readonly ctx: GameContext, private readonly radius = 1.3) {
    const low = q(ctx) === 'low';
    const geo = shared(`fx_fire_wheel_${low ? 'l' : 'h'}`, () => flatRing(0.1, 1, Math.PI * 2, low ? 40 : 72, 'out'));
    const discMat = flameMaterial({ blend: 'normal', scroll: [0.35, -2.6], scale: [7, 1.15], intensity: 1.2, opacity: 0.95 });
    const innerMat = flameMaterial({ scroll: [-0.5, -3.2], scale: [5, 1.3], intensity: 1.0, palette: 'hot', heat: 0.15 });
    this.mats.push(discMat, innerMat);
    this.disc = new THREE.Mesh(geo, discMat);
    this.inner = new THREE.Mesh(geo, innerMat);
    this.core = ballMesh({ palette: 'hot', intensity: 0.9, swirl: 1.4, heat: 0.4 });
    this.group.add(this.disc, this.inner, this.core.mesh);
    ctx.vfx.group.add(this.group);
  }

  pulse(k = 1): void {
    this.flare = Math.min(1.5, this.flare + k);
  }

  update(dt: number, center: THREE.Vector3, dir: THREE.Vector3): void {
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt * 7);
    this.flare = Math.max(0, this.flare - dt * 4);
    const e = 1 - Math.pow(1 - this.fade, 3);
    const R = this.radius * (0.35 + 0.65 * e) * (1 + 0.12 * this.flare + Math.sin(this.t * 17) * 0.025);
    this.group.position.copy(center);
    this.group.quaternion.setFromUnitVectors(UP, tmp.copy(dir).normalize());
    // Both layers spin about the disc's normal, in opposite directions.
    this.disc.rotation.y = this.t * 4.2;
    this.inner.rotation.y = -this.t * 6;
    this.disc.scale.set(R, 1, R);
    this.inner.scale.set(R * 0.55, 1, R * 0.55);
    this.core.mesh.scale.setScalar(R * 0.75);
    setOpacity(this.mats[0], 0.95 * e);
    setOpacity(this.mats[1], e);
    setOpacity(this.core.mat, e);
    // The rim throws off tongues of flame, outward in the disc's plane.
    if (Math.random() < dt * (q(this.ctx) === 'low' ? 14 : 30)) {
      this.right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      this.up.set(0, 0, 1).applyQuaternion(this.group.quaternion);
      const a = Math.random() * Math.PI * 2;
      const out = tmp.copy(this.right).multiplyScalar(Math.cos(a)).addScaledVector(this.up, Math.sin(a));
      this.ctx.vfx.burst('flame', tmp2.copy(center).addScaledVector(out, R * 0.9), { count: 1, dir: out, spread: 0.3, speed: 1.2, size: 0.7 });
    }
  }

  /** Gutter out over `fadeTime` (0 = remove now) and free everything. */
  dispose(fadeTime = 0.2): void {
    const free = () => {
      this.group.removeFromParent();
      for (const m of this.mats) m.dispose();
      this.core.mat.dispose();
    };
    if (fadeTime <= 0) return free();
    let t = 0;
    effect(
      (dt) => {
        t += dt;
        const k = Math.max(0, 1 - t / fadeTime);
        for (const m of this.mats) setOpacity(m, k);
        setOpacity(this.core.mat, k);
        this.group.scale.setScalar(1 + t * 1.2);
        return t < fadeTime;
      },
      free,
    );
  }
}

/** Steam (fire meeting water). */
export function steam(ctx: GameContext, pos: THREE.Vector3, size = 1): void {
  ctx.vfx.burst('steam', pos, { count: Math.round(10 * size), radius: 0.5 * size, size: 0.8 + size * 0.5 });
  ctx.vfx.burst('mist', pos, { count: Math.round(3 * size), radius: 0.6 * size });
  ctx.audio.play('bend_steam', { position: pos, volume: Math.min(1, 0.4 + size * 0.3) });
}
