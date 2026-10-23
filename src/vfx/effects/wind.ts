import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { effect } from './loop';
import { setOpacity, windMaterial, type WindOptions } from './materials';
import { Trail } from './ribbon';
import { arcSheet, coneTube, flatRing, ringWall, shared, shellSphere, shellTorus, spiral } from './shapes';

/**
 * Wind effect builders. Air is drawn as moving, curling streaks on translucent
 * shells — crescents, cones, rings and spirals echoing the air-nomad swirl —
 * never as coloured balls. Shapes match the hit volumes of the techniques.
 */

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

function q(ctx: GameContext): 'low' | 'medium' | 'high' {
  return ctx.vfx.quality;
}

const WHITE = '#ffffff';
const TINT = '#bfe0f2';

/** A crescent of wind (palm strikes): curved streaky sheet that travels and widens. */
export function windBlade(
  ctx: GameContext,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  o: { length: number; duration: number; r0?: number; r1?: number; height?: number; arc?: number; roll?: number; opacity?: number; layers?: number } ,
): void {
  const low = q(ctx) === 'low';
  const layers = o.layers ?? (low ? 1 : 2);
  const arc = o.arc ?? 2.3;
  const geo = shared(`fx_blade_${arc.toFixed(2)}_${low ? 'l' : 'h'}`, () => arcSheet({ radius: 1, arc, height: 1, segA: low ? 18 : 30, segH: 4, taper: 1, flow: 'arc' }));
  const d = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(Z, d);
  if (o.roll) quat.multiply(new THREE.Quaternion().setFromAxisAngle(Z, o.roll));
  for (let i = 0; i < layers; i++) {
    const mat = windMaterial({ speed: 3.2 + i, repeat: [1.5, 3], threshold: 0.48, body: 0.14, opacity: (o.opacity ?? 0.85) * (i ? 0.6 : 1), fade: [0.25, 0.25], color: WHITE, tint: TINT });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.copy(quat);
    const lag = i * 0.05;
    const r0 = o.r0 ?? 0.6, r1 = o.r1 ?? 2.4, h = o.height ?? 1.4;
    ctx.vfx.addTransient(mesh, o.duration + lag, (t) => {
      const lt = Math.max(0, Math.min(1, (t * (o.duration + lag) - lag) / o.duration));
      const e = 1 - (1 - lt) * (1 - lt);
      mesh.position.copy(origin).addScaledVector(d, o.length * e - (1 - e) * 0.4);
      const r = r0 + (r1 - r0) * e;
      mesh.scale.set(r, h * (0.6 + e * 0.6), r * 0.55);
      setOpacity(mat, (o.opacity ?? 0.85) * (i ? 0.6 : 1) * (lt < 0.15 ? lt / 0.15 : lt > 0.6 ? 1 - (lt - 0.6) / 0.4 : 1));
    }, () => mat.dispose());
  }
}

/** Expanding cone shell along `dir` (air blast). */
export function windCone(ctx: GameContext, origin: THREE.Vector3, dir: THREE.Vector3, o: { length: number; radius: number; duration: number; opacity?: number }): void {
  const low = q(ctx) === 'low';
  const geo = shared(`fx_wcone_${low ? 'l' : 'h'}`, () => coneTube(0.08, 1, low ? 14 : 22, low ? 6 : 10));
  const d = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(Z, d);
  const mats = [
    windMaterial({ speed: 4.5, repeat: [5, 1.4], threshold: 0.45, body: 0.1, opacity: o.opacity ?? 0.8, fade: [0.05, 0.45], wrapAcross: true, rim: true }),
    windMaterial({ speed: 6, repeat: [3, 1], threshold: 0.55, body: 0.04, opacity: (o.opacity ?? 0.8) * 0.7, fade: [0.05, 0.5], wrapAcross: true }),
  ];
  mats.forEach((mat, i) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.quaternion.copy(quat);
    ctx.vfx.addTransient(mesh, o.duration * (1 + i * 0.2), (t) => {
      const e = 1 - Math.pow(1 - t, 2);
      const k = i ? 0.75 : 1;
      mesh.scale.set(o.radius * (0.3 + e * 0.7) * k, o.radius * (0.3 + e * 0.7) * k, o.length * (0.25 + e * 0.75));
      mesh.rotation.z += 0.05;
      setOpacity(mat, (o.opacity ?? 0.8) * (i ? 0.7 : 1) * (t < 0.1 ? t / 0.1 : 1 - Math.max(0, t - 0.45) / 0.55));
    }, () => mat.dispose());
  });
}

/** Expanding ring of wind around an axis (spin strikes, landings, jumps). */
export function windRing(ctx: GameContext, center: THREE.Vector3, o: { r0: number; r1: number; duration: number; height?: number; axis?: THREE.Vector3; spin?: number; opacity?: number; flat?: boolean }): void {
  const low = q(ctx) === 'low';
  const flat = o.flat ?? false;
  const geo = flat
    ? shared(`fx_wflat_${low ? 'l' : 'h'}`, () => flatRing(0.7, 1, Math.PI * 2, low ? 36 : 64, 'around'))
    : shared(`fx_wring_${low ? 'l' : 'h'}`, () => ringWall(1, 1, low ? 36 : 64, 'around', 0.15));
  const mat = windMaterial({ speed: 2.6 * (o.spin ?? 1), repeat: [1, 6], threshold: 0.42, body: 0.12, opacity: o.opacity ?? 0.85, wrapFlow: true, fade: [0, 0] });
  const mesh = new THREE.Mesh(geo, mat);
  const c0 = center.clone();
  const axis = o.axis ? o.axis.clone().normalize() : Y.clone();
  mesh.position.copy(c0);
  mesh.quaternion.setFromUnitVectors(Y, axis);
  const h = o.height ?? 1;
  ctx.vfx.addTransient(mesh, o.duration, (t) => {
    const e = 1 - Math.pow(1 - t, 2.4);
    const r = o.r0 + (o.r1 - o.r0) * e;
    mesh.scale.set(r, flat ? 1 : h * (1 - t * 0.5), r);
    if (!flat) mesh.position.copy(c0).addScaledVector(axis, -h * 0.5 * (1 - t * 0.5));
    setOpacity(mat, (o.opacity ?? 0.85) * (t < 0.1 ? t / 0.1 : 1 - Math.max(0, t - 0.35) / 0.65));
  }, () => mat.dispose());
}

/** Quick rising double helix of streaks (spin flourish, vortex accents). */
export function windSpiral(ctx: GameContext, base: THREE.Vector3, o: { height: number; r0: number; r1: number; duration: number; turns?: number; width?: number; opacity?: number; count?: number }): void {
  const low = q(ctx) === 'low';
  const n = o.count ?? (low ? 1 : 2);
  for (let i = 0; i < n; i++) {
    const geo = spiral({ turns: o.turns ?? 1.6, height: 1, r0: 1, r1: o.r1 / Math.max(0.01, o.r0), width: (o.width ?? 0.5) / Math.max(0.3, o.height), seg: low ? 36 : 64, phase: (i / n) * Math.PI * 2 });
    const mat = windMaterial({ speed: 3.5, repeat: [1, 3], threshold: 0.45, body: 0.16, opacity: o.opacity ?? 0.8, fade: [0.15, 0.35] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(base);
    ctx.vfx.addTransient(mesh, o.duration, (t) => {
      const e = 1 - Math.pow(1 - t, 2);
      mesh.scale.set(o.r0 * (0.6 + e * 0.6), o.height * (0.4 + e * 0.6), o.r0 * (0.6 + e * 0.6));
      mesh.rotation.y += 0.22;
      setOpacity(mat, (o.opacity ?? 0.8) * (t < 0.15 ? t / 0.15 : 1 - Math.max(0, t - 0.5) / 0.5));
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }
}

/** Trail of streaking air (dashes, palms, kicks). */
export function windTrail(ctx: GameContext, width: number, life: number, o: WindOptions = {}): { trail: Trail; mat: THREE.ShaderMaterial } {
  const mat = windMaterial({ speed: -3, repeat: [1, 2], threshold: 0.4, body: 0.2, opacity: 0.75, fade: [0.02, 0.6], ...o });
  const trail = new Trail(mat, { width, life, maxPoints: q(ctx) === 'low' ? 14 : 24, minDist: 0.12 });
  ctx.vfx.group.add(trail.mesh);
  return { trail, mat };
}

/** Keep updating a trail until it fades, then free it. */
export function releaseWindTrail(ctx: GameContext, t: { trail: Trail; mat: THREE.ShaderMaterial }): void {
  effect(
    () => {
      t.trail.update(ctx.time.elapsed, ctx.camera.position);
      return t.trail.length > 1;
    },
    () => {
      t.trail.mesh.removeFromParent();
      t.trail.dispose();
      t.mat.dispose();
    },
  );
}

/**
 * Spinning sphere of air with orbiting streak rings (Air Shield, Air Scooter
 * ball). update() each frame with centre/radius; dispose() fades it out.
 */
export class WindShell {
  readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];
  private t = 0;
  private fadeIn = 0;
  private readonly baseOpacity: number;

  constructor(private readonly ctx: GameContext, o: { rings?: number; opacity?: number; speed?: number } = {}) {
    const low = q(ctx) === 'low';
    this.baseOpacity = o.opacity ?? 0.85;
    const shellMat = windMaterial({ swapUV: true, wrapFlow: true, rim: true, speed: o.speed ?? 2.4, repeat: [2, 4], threshold: 0.42, body: 0.1, opacity: this.baseOpacity, fade: [0, 0] });
    this.mats.push(shellMat);
    this.shell = new THREE.Mesh(shared(`fx_wshell_${low ? 'l' : 'h'}`, () => shellSphere(1, low ? 18 : 28, low ? 12 : 18)), shellMat);
    this.group.add(this.shell);
    const n = o.rings ?? (low ? 2 : 3);
    for (let i = 0; i < n; i++) {
      const m = windMaterial({ swapUV: true, wrapFlow: true, wrapAcross: true, speed: (o.speed ?? 2.4) * 1.6, repeat: [1, 3], threshold: 0.35, body: 0.25, opacity: this.baseOpacity, fade: [0, 0] });
      this.mats.push(m);
      const ring = new THREE.Mesh(shared(`fx_wtorus_${low ? 'l' : 'h'}`, () => shellTorus(0.035, 6, low ? 40 : 64)), m);
      ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      ring.userData.spin = (i % 2 ? -1 : 1) * (3 + i * 1.3);
      ring.userData.tiltSpeed = 0.6 + i * 0.4;
      this.rings.push(ring);
      this.group.add(ring);
    }
    ctx.vfx.group.add(this.group);
  }

  update(dt: number, center: THREE.Vector3, radius: number, intensity = 1): void {
    this.t += dt;
    this.fadeIn = Math.min(1, this.fadeIn + dt * 6);
    this.group.position.copy(center);
    const k = this.fadeIn;
    this.shell.scale.setScalar(radius * (0.6 + 0.4 * k));
    this.shell.rotation.y += dt * 3.2;
    this.shell.rotation.x = Math.sin(this.t * 1.3) * 0.3;
    for (const r of this.rings) {
      r.scale.setScalar(radius * (1.02 + 0.04 * Math.sin(this.t * 7 + r.userData.spin)) * (0.6 + 0.4 * k));
      r.rotateOnAxis(Z, dt * r.userData.spin);
      r.rotation.x += dt * r.userData.tiltSpeed;
    }
    for (const m of this.mats) setOpacity(m, this.baseOpacity * k * intensity);
  }

  dispose(fade = 0.25): void {
    let t = 0;
    const start = this.group.scale.x;
    effect(
      (dt) => {
        t += dt;
        const k = Math.max(0, 1 - t / fade);
        for (const m of this.mats) setOpacity(m, this.baseOpacity * k);
        this.group.scale.setScalar(start * (1 + t * 2));
        return t < fade;
      },
      () => {
        this.group.removeFromParent();
        for (const m of this.mats) m.dispose();
      },
    );
  }
}

/** Travelling tornado (Vortex): stacked spinning funnel + spiral bands. */
export class Tornado {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly funnel: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly bands: THREE.Mesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private t = 0;
  opacity = 0;

  constructor(private readonly ctx: GameContext, private readonly height = 4.2, private readonly radius = 1.6) {
    const low = q(ctx) === 'low';
    const funnelGeo = shared(`fx_funnel_${low ? 'l' : 'h'}`, () => {
      const g = coneTube(0.22, 1, low ? 16 : 24, low ? 8 : 12);
      g.rotateX(-Math.PI / 2); // axis +Y, base (narrow) at y=0
      return g;
    });
    const m1 = windMaterial({ speed: 3.4, repeat: [4, 1.6], threshold: 0.42, body: 0.14, opacity: 0.85, wrapAcross: true, rim: true, fade: [0.1, 0.25] });
    const m2 = windMaterial({ speed: 5, repeat: [3, 1.2], threshold: 0.5, body: 0.06, opacity: 0.7, wrapAcross: true, fade: [0.05, 0.3], tint: '#d8c8a8' });
    this.mats.push(m1, m2);
    this.funnel = new THREE.Mesh(funnelGeo, m1);
    this.inner = new THREE.Mesh(funnelGeo, m2);
    this.group.add(this.funnel, this.inner);
    const n = low ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const g = spiral({ turns: 2.2, height: 1, r0: 0.25, r1: 1.05, width: 0.16, seg: low ? 40 : 72, phase: (i / n) * Math.PI * 2 });
      this.geos.push(g);
      const m = windMaterial({ speed: 4.2, repeat: [1, 4], threshold: 0.4, body: 0.2, opacity: 0.85, fade: [0.1, 0.2] });
      this.mats.push(m);
      const band = new THREE.Mesh(g, m);
      this.bands.push(band);
      this.group.add(band);
    }
    ctx.vfx.group.add(this.group);
  }

  update(dt: number, base: THREE.Vector3, scale = 1): void {
    this.t += dt;
    this.group.position.copy(base);
    const h = this.height * scale, r = this.radius * scale;
    this.funnel.scale.set(r, h, r);
    this.inner.scale.set(r * 0.7, h * 0.92, r * 0.7);
    this.funnel.rotation.y -= dt * 7;
    this.inner.rotation.y -= dt * 10;
    this.bands.forEach((b, i) => {
      b.scale.set(r * 1.05, h, r * 1.05);
      b.rotation.y -= dt * (8 + i * 2);
    });
    // Sway: the column leans a little as it moves.
    this.group.rotation.z = Math.sin(this.t * 2.3) * 0.08;
    this.group.rotation.x = Math.cos(this.t * 1.7) * 0.06;
    this.mats.forEach((m, i) => setOpacity(m, this.opacity * (i === 1 ? 0.7 : 0.85)));
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}

/** Puff of displaced air at an impact point. */
export function airPuff(ctx: GameContext, pos: THREE.Vector3, dir: THREE.Vector3 | null, size = 1): void {
  ctx.vfx.burst('air', pos, { count: Math.round(10 * size), dir: dir ?? undefined, spread: dir ? 0.7 : 1.6, speed: 1.2 * size, size: 0.8 + size * 0.4 });
  ctx.vfx.burst('swirl', pos, { count: Math.round(6 * size), swirl: 5, speed: 0.6 * size });
  windRing(ctx, pos, { r0: 0.2, r1: 1.2 * size, duration: 0.3, height: 0.5 * size, axis: dir ? tmp.copy(dir) : undefined, opacity: 0.7 });
}

/** Crescent of wind expanding outward from `origin` along the ground (sweeping kicks). */
export function windArc(ctx: GameContext, origin: THREE.Vector3, dir: THREE.Vector3, o: { r0: number; r1: number; arc: number; height: number; duration: number; opacity?: number }): void {
  const low = q(ctx) === 'low';
  const yaw = Math.atan2(dir.x, dir.z);
  const sheetGeo = shared(`fx_warc_${o.arc.toFixed(2)}_${low ? 'l' : 'h'}`, () => arcSheet({ radius: 1, arc: o.arc, height: 1, segA: low ? 20 : 36, segH: 3, anchor: 'base', flow: 'arc', taper: 0.7, flare: 0.3 }));
  const flatGeo = shared(`fx_wflatarc_${o.arc.toFixed(2)}_${low ? 'l' : 'h'}`, () => flatRing(0.75, 1, o.arc, low ? 20 : 36, 'around'));
  const mats = [
    windMaterial({ speed: 3.5, repeat: [1, 3], threshold: 0.42, body: 0.16, opacity: o.opacity ?? 0.85, fade: [0.2, 0.2] }),
    windMaterial({ speed: 4.5, repeat: [1, 4], threshold: 0.4, body: 0.12, opacity: (o.opacity ?? 0.85) * 0.8, fade: [0.2, 0.2], tint: '#e2d6bc' }),
  ];
  const sheet = new THREE.Mesh(sheetGeo, mats[0]);
  const flat = new THREE.Mesh(flatGeo, mats[1]);
  for (const m of [sheet, flat]) {
    m.position.copy(origin);
    m.rotation.y = yaw;
  }
  flat.position.y += 0.08;
  [sheet, flat].forEach((m, i) => {
    ctx.vfx.addTransient(m, o.duration, (t) => {
      const e = 1 - Math.pow(1 - t, 2);
      const r = o.r0 + (o.r1 - o.r0) * e;
      m.scale.set(r, i === 0 ? o.height * (1 - t * 0.4) : 1, r);
      setOpacity(mats[i], (o.opacity ?? 0.85) * (i ? 0.8 : 1) * (t < 0.1 ? t / 0.1 : 1 - Math.max(0, t - 0.5) / 0.5));
    }, () => mats[i].dispose());
  });
}
