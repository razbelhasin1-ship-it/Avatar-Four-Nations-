import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { ProjectileVisual } from '../../combat/types';
import { debris, effect } from './loop';
import { flameMaterial, setOpacity, type FlameOptions } from './materials';
import { Trail } from './ribbon';
import { arcSheet, coneTube, crossPlanes, flatRing, ringWall, shared, teardrop } from './shapes';

/**
 * Fire effect builders: shaped, shader-driven flame meshes (not just particles)
 * so firebending reads on every preset — the low preset has no bloom and only
 * 40% particles, so the meshes carry the silhouette and particles add life.
 */

const Z = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();

function q(ctx: GameContext): 'low' | 'medium' | 'high' {
  return ctx.vfx.quality;
}

const sphereGeo = (ctx: GameContext) => shared(`fx_sphere_${q(ctx)}`, () => new THREE.SphereGeometry(1, q(ctx) === 'low' ? 14 : 22, q(ctx) === 'low' ? 10 : 16));
const tearGeo = () => shared('fx_teardrop', () => teardrop(12, 12));

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
// Projectile visuals
// ---------------------------------------------------------------------------

/** Fire bolt (punch / kick): teardrop flame + hot core + trail + embers. */
export function fireBoltVisual(ctx: GameContext, radius: number, o: { length?: number; palette?: FlameOptions['palette']; trail?: number } = {}): ProjectileVisual {
  const group = new THREE.Group();
  const len = o.length ?? radius * 7;
  const w = radius * 1.25;
  const outerMat = flameMaterial({ palette: o.palette ?? 'fire', rimFade: true, scroll: [0.2, 3.4], scale: [1.2, 1.7], intensity: 1.35, heat: -0.12 });
  const outer = new THREE.Mesh(tearGeo(), outerMat);
  const shellMat = flameMaterial({ palette: 'ember', blend: 'normal', rimFade: true, scroll: [-0.3, 2.6], scale: [1, 1.2], intensity: 1.0, opacity: 0.75, heat: -0.15 });
  const shell = new THREE.Mesh(tearGeo(), shellMat);
  const coreMat = flameMaterial({ mode: 'volume', palette: 'hot', intensity: 1.3, heat: 0, scale: [2, 2], scroll: [0.6, -2] });
  const core = new THREE.Mesh(sphereGeo(ctx), coreMat);
  core.scale.setScalar(radius * 0.45);
  group.add(shell, outer, core);
  const { trail, mat: trailMat } = flameTrail(ctx, radius * 3.2, o.trail ?? 0.18, { palette: o.palette ?? 'fire' });
  const embers = ctx.vfx.emitter('embers', q(ctx) === 'low' ? 24 : 50, { speed: 0.5, size: 1 }, 3);
  const flames = ctx.vfx.emitter('flame', q(ctx) === 'low' ? 20 : 40, { speed: 0.3, size: radius * 2.2 }, 3);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      const v = tmp.copy(p.velocity);
      if (v.lengthSq() > 1e-6) {
        v.normalize().negate();
        outer.quaternion.setFromUnitVectors(Z, v);
        shell.quaternion.copy(outer.quaternion);
      }
      const fl = 1 + Math.sin(t * 40) * 0.08;
      const grow = Math.min(1, 0.45 + t * 9);
      outer.scale.set(w * fl * grow, w * fl * grow, len * grow * (0.9 + Math.sin(t * 27) * 0.12));
      shell.scale.set(w * 1.45 * grow, w * 1.45 * grow, len * 1.3 * grow * (0.92 + Math.sin(t * 19 + 1) * 0.1));
      trail.push(p.position, ctx.time.elapsed);
      trail.update(ctx.time.elapsed, ctx.camera.position);
      embers.position.copy(p.position);
      flames.position.copy(p.position);
    },
    dispose: () => {
      embers.stop();
      flames.stop();
      outerMat.dispose();
      shellMat.dispose();
      coreMat.dispose();
      releaseTrail(ctx, trail, trailMat);
    },
  };
}

/** Charged fireball: roiling volume + halo + core + wide trail + smoke. */
export function fireballVisual(ctx: GameContext, radius: number): ProjectileVisual {
  const group = new THREE.Group();
  const body = flameMaterial({ mode: 'volume', blend: 'normal', palette: 'fire', intensity: 1.25, displace: 0.12, scale: [1.6, 1.6], scroll: [0.4, -1.4], heat: 0.1 });
  const halo = flameMaterial({ mode: 'volume', palette: 'ember', intensity: 1.0, opacity: 0.5, displace: 0.2, scale: [1.2, 1.2], scroll: [-0.3, -1.8] });
  const core = flameMaterial({ mode: 'volume', palette: 'hot', intensity: 1.6, heat: 0.2, scale: [2.2, 2.2], scroll: [0.8, -2] });
  const g = sphereGeo(ctx);
  const mBody = new THREE.Mesh(g, body);
  mBody.scale.setScalar(radius);
  const mHalo = new THREE.Mesh(g, halo);
  mHalo.scale.setScalar(radius * 1.45);
  const mCore = new THREE.Mesh(g, core);
  mCore.scale.setScalar(radius * 0.55);
  group.add(mHalo, mBody, mCore);
  const { trail, mat: trailMat } = flameTrail(ctx, radius * 2.4, 0.2);
  const em = ctx.vfx.emitter('fire', q(ctx) === 'low' ? 30 : 70, { speed: 0.6, size: 1 + radius }, 4);
  const smoke = ctx.vfx.emitter('smoke', q(ctx) === 'low' ? 4 : 10, { speed: 0.4, size: radius }, 4);
  let t = 0;
  return {
    object: group,
    update: (p, dt) => {
      t += dt;
      mBody.rotation.y += dt * 4;
      mHalo.rotation.x += dt * 3;
      const pulse = 1 + Math.sin(t * 22) * 0.06;
      mBody.scale.setScalar(radius * pulse);
      trail.push(p.position, ctx.time.elapsed);
      trail.update(ctx.time.elapsed, ctx.camera.position);
      em.position.copy(p.position);
      smoke.position.copy(p.position);
    },
    dispose: () => {
      em.stop();
      smoke.stop();
      body.dispose();
      halo.dispose();
      core.dispose();
      releaseTrail(ctx, trail, trailMat);
    },
  };
}

// ---------------------------------------------------------------------------
// One-shot effects
// ---------------------------------------------------------------------------

/** Short cone of flame at a fist/foot (muzzle flash for punches). */
export function fireMuzzle(ctx: GameContext, pos: THREE.Vector3, dir: THREE.Vector3, size = 1): void {
  const mat = flameMaterial({ rimFade: true, scroll: [0, 4], scale: [1, 1.4], intensity: 2.2, heat: 0.3 });
  const mesh = new THREE.Mesh(shared('fx_muzzle_cone', () => coneTube(0.25, 1, 10, 6)), mat);
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(Z, tmp.copy(dir).normalize());
  ctx.vfx.addTransient(mesh, 0.16, (t) => {
    const s = size * (0.4 + t * 0.9);
    mesh.scale.set(s * 0.45, s * 0.45, s * 1.3);
    setOpacity(mat, 1 - t);
  }, () => mat.dispose());
  ctx.vfx.burst('flame', pos, { count: 5, dir, spread: 0.35, speed: 2.4, size: size * 0.8 });
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
 * Fire explosion: a cluster of roiling fireballs that bloom, rise and burn away
 * (dissolve through the noise), a brief white-hot core, shock rings, embers,
 * smoke, debris and a scene flash.
 */
export function fireExplosion(ctx: GameContext, pos: THREE.Vector3, radius: number, o: ExplosionOptions = {}): void {
  const g = sphereGeo(ctx);
  const low = q(ctx) === 'low';
  const puffs = Math.min(low ? 4 : 7, 2 + Math.round(radius * 0.9));
  for (let i = 0; i < puffs; i++) {
    const main = i === 0;
    const size = radius * (main ? 0.62 : 0.34 + Math.random() * 0.22);
    const off = main ? new THREE.Vector3() : new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize().multiplyScalar(radius * (0.3 + Math.random() * 0.35));
    const delay = main ? 0 : Math.random() * 0.09;
    const life = 0.5 + radius * 0.05 + Math.random() * 0.2;
    const rise = radius * (0.35 + Math.random() * 0.4);
    const mat = flameMaterial({ mode: 'volume', blend: 'normal', palette: o.hot && main ? 'hot' : 'fire', intensity: 1.15, displace: 0.22, scale: [1.3, 1.3], scroll: [Math.random() - 0.5, -1.4], heat: 0.15 });
    const m = new THREE.Mesh(g, mat);
    m.position.copy(pos).add(off);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    m.scale.setScalar(0.001);
    const total = life + delay;
    ctx.vfx.addTransient(m, total, (t) => {
      const lt = Math.max(0, (t * total - delay) / life);
      if (lt <= 0) return;
      const grow = 1 - Math.pow(1 - Math.min(1, lt * 3.2), 3);
      m.scale.setScalar(size * (0.35 + grow * 0.8 + lt * 0.25));
      m.position.y = pos.y + off.y + rise * lt * lt;
      m.rotation.y += 0.02;
      mat.uniforms.uHeat.value = 0.3 - lt * 1.65;
      setOpacity(mat, lt < 0.7 ? 1 : 1 - (lt - 0.7) / 0.3);
    }, () => mat.dispose());
  }
  const core = flameMaterial({ mode: 'volume', palette: 'hot', intensity: 1.6, heat: 0.2, scale: [2, 2] });
  const mCore = new THREE.Mesh(g, core);
  mCore.position.copy(pos);
  mCore.renderOrder = 19;
  ctx.vfx.addTransient(mCore, 0.14, (t) => {
    mCore.scale.setScalar(radius * (0.2 + t * 0.4));
    setOpacity(core, 1 - t);
  }, () => core.dispose());
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
  if (nearGround) ctx.vfx.ring(ground.clone().setY(ground.y + 0.12), o.hot ? '#ffe2a0' : '#ff9a40', radius * 1.6, 0.45, { opacity: 0.85 });
  ctx.vfx.ring(pos, '#ffd090', radius * 1.2, 0.3, { vertical: true, normal: tmp.subVectors(ctx.camera.position, pos).normalize(), opacity: 0.5 });
  const n = q(ctx) === 'low' ? 1 : 2;
  ctx.vfx.burst('fire', pos, { count: 22 * n, speed: 1.6 + radius * 0.4, radius: radius * 0.4, size: 1 + radius * 0.25 });
  ctx.vfx.burst('embers', pos, { count: 18 * n, speed: 2 + radius * 0.5, spread: 1.6 });
  ctx.vfx.burst('sparks', pos, { count: 10 * n, speed: 1.4 });
  if (o.smoke !== false) ctx.vfx.burst('smoke', pos.clone().setY(pos.y + radius * 0.3), { count: 6 * n, radius: radius * 0.5, size: 0.8 + radius * 0.2 });
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
    const innerMat = flameMaterial({ rimFade: true, scroll: [-0.2, -5.5], scale: [2, 2.8], intensity: 1.5, palette: o.palette ?? 'fire', heat: 0.1 });
    const coreMat = flameMaterial({ rimFade: true, scroll: [0, -7], scale: [1, 3], intensity: 1.8, palette: 'hot', heat: 0.3 });
    this.mats.push(outerMat, innerMat, coreMat);
    const geo = shared(`fx_stream_${lowQ ? 'l' : 'h'}`, () => coneTube(0.12, 1, lowQ ? 10 : 16, lowQ ? 6 : 10));
    this.outer = new THREE.Mesh(geo, outerMat);
    this.inner = new THREE.Mesh(geo, innerMat);
    this.core = new THREE.Mesh(geo, coreMat);
    this.group.add(this.outer, this.inner, this.core);
    ctx.vfx.group.add(this.group);
    this.flames = ctx.vfx.emitter('flame', lowQ ? 40 : 90, { speed: 4, spread: 0.18, size: 1.4 * width });
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

/** Steam (fire meeting water). */
export function steam(ctx: GameContext, pos: THREE.Vector3, size = 1): void {
  ctx.vfx.burst('steam', pos, { count: Math.round(10 * size), radius: 0.5 * size, size: 0.8 + size * 0.5 });
  ctx.vfx.burst('mist', pos, { count: Math.round(3 * size), radius: 0.6 * size });
  ctx.audio.play('bend_steam', { position: pos, volume: Math.min(1, 0.4 + size * 0.3) });
}
