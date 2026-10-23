import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import { createWaterMaterial } from '../../combat/water/WaterMaterials';
import type { GameContext } from '../../core/GameContext';
import type { Player } from '../../player/Player';
import type { Emitter } from '../../vfx/VFX';
import { debris } from '../../vfx/effects/loop';
import { flameMaterial, setOpacity, windMaterial } from '../../vfx/effects/materials';
import { Trail } from '../../vfx/effects/ribbon';
import { earthTint, rockGeometry, stoneMaterial } from '../../vfx/effects/rocks';
import { shared, shellSphere, shellTorus } from '../../vfx/effects/shapes';
import { windSpiral } from '../../vfx/effects/wind';
import { byQuality, dynamicLights } from './common';

/**
 * Elements Sphere formation (Avatar State after all four masteries).
 *
 * Sequence (seconds after activation): build-up (spirit gathers inward) →
 * 0.5 initial burst (AvatarStateSystem wave) → 0.6 air vortex arrives (wind
 * bands spin up) → 1.0 water ribbons flow in (they freeze and melt) → 1.4
 * real rocks tear out of the ground and rise into orbit → 1.85 fire ribbons
 * ignite with embers and light → 2.3 everything converges into one rotating
 * formation (water weaves between the stones on the same orbit, wind bands
 * guide the motion, fire spirals on the sphere surface) → 2.75 outward wave.
 *
 * The formation follows the Avatar (walking, jumping, combat), stays
 * translucent at a radius around the chest so it never hides the character
 * or targets, scales with the effects quality and frees everything on
 * dispose(). Ultimates call pulse() / converge().
 */
export const SPHERE_SEQUENCE = 2.8;

const AIR_IN = 0.6;
const WATER_IN = 1.0;
const EARTH_IN = 1.4;
const FIRE_IN = 1.85;
const CONVERGE_IN = 2.3;
const CONVERGE_END = 2.75;
const RADIUS = 2.3;

interface Rock {
  mesh: THREE.Mesh;
  slot: number;
  start: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
  launched: boolean;
  delay: number;
}

interface FireRibbon {
  trail: Trail;
  mat: THREE.ShaderMaterial;
  phase: number;
  lit: boolean;
  head: THREE.Vector3;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (t: number): number => {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

export class ElementsSphere {
  /** World-space anchor at the Avatar's chest. */
  readonly group = new THREE.Group();
  /** Rotating formation (child of group). */
  private readonly formation = new THREE.Group();
  private t = 0;
  private releasing = false;
  private releaseT = 0;
  private disposed = false;
  private flare = 0;
  private convergeT = 0;
  private convergeDur = 0;
  private expand = 0;
  private spinAngle = 0;
  private readonly center = new THREE.Vector3();
  // Air
  private readonly windBands: THREE.Mesh[] = [];
  private windShell: THREE.Mesh | null = null;
  private readonly windMats: THREE.ShaderMaterial[] = [];
  private windSpiralDone = false;
  // Water
  private readonly waterRibbons: THREE.Mesh[] = [];
  private readonly waterMats: THREE.ShaderMaterial[] = [];
  private ice = 0;
  private iceClock = 0;
  private iceState: 'liquid' | 'freezing' | 'frozen' | 'melting' = 'liquid';
  // Earth
  private readonly rocks: Rock[] = [];
  private readonly rockTint: string;
  // Fire
  private readonly fires: FireRibbon[] = [];
  private embers: Emitter | null = null;
  private readonly light: THREE.PointLight | null;
  private readonly loop: LoopHandle;

  constructor(private readonly ctx: GameContext, private readonly player: Player) {
    this.group.name = 'elements_sphere';
    this.group.add(this.formation);
    ctx.vfx.group.add(this.group);
    const q = ctx.vfx.quality;
    // --- Air: wind bands on tilted great circles (+ a faint vortex shell on medium/high).
    const nBands = byQuality(ctx, 2, 3, 3);
    const bandGeo = shared(`avatar_sphere_band_${q}`, () => shellTorus(0.05, q === 'low' ? 6 : 8, q === 'low' ? 48 : 72));
    for (let i = 0; i < nBands; i++) {
      const m = windMaterial({ color: '#ffffff', tint: '#cfe3f0', opacity: 0, speed: 2.6 + i * 0.4, repeat: [1, 7], threshold: 0.42, body: 0.08, wrapFlow: true, wrapAcross: true });
      this.windMats.push(m);
      const band = new THREE.Mesh(bandGeo, m);
      band.rotation.set(Math.PI / 2 + (i - 1) * 0.55, 0, i * 1.05);
      band.scale.setScalar(RADIUS * 1.08);
      this.windBands.push(band);
      this.formation.add(band);
    }
    if (q !== 'low') {
      const m = windMaterial({ color: '#ffffff', tint: '#cfe6f5', opacity: 0, speed: 1.4, repeat: [3, 4], threshold: 0.55, body: 0.0, wrapFlow: true, wrapAcross: true, rim: true });
      this.windMats.push(m);
      this.windShell = new THREE.Mesh(shared('avatar_sphere_shell', () => shellSphere(1, 28, 18)), m);
      this.windShell.scale.setScalar(RADIUS * 1.15);
      this.group.add(this.windShell);
    }
    // --- Water: ribbons weaving in and out on the rocks' orbit.
    const nWater = byQuality(ctx, 1, 2, 2);
    for (let i = 0; i < nWater; i++) {
      const geo = shared(`avatar_sphere_water_${i}_${q}`, () => waterRibbonGeometry(i, q === 'low' ? 64 : 110, q === 'low' ? 5 : 7));
      const m = createWaterMaterial({ opacity: 0, flow: 3.2, foam: 1.2, glow: 0.25 });
      m.side = THREE.DoubleSide;
      this.waterMats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = i === 0 ? 0.32 : -0.42;
      mesh.rotation.z = i === 0 ? 0.12 : -0.2;
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.waterRibbons.push(mesh);
      this.formation.add(mesh);
    }
    // --- Earth: real rock geometry torn from the ground under the Avatar.
    const g = ctx.world.groundAt(player.position.x, player.position.z, player.position.y + 1.5);
    this.rockTint = earthTint(g.surface);
    const nRocks = byQuality(ctx, 5, 7, 9);
    for (let i = 0; i < nRocks; i++) {
      const size = 0.17 + ((i * 37) % 10) / 10 * 0.14;
      const mesh = new THREE.Mesh(rockGeometry(i, 1), stoneMaterial(this.rockTint));
      mesh.scale.setScalar(size);
      mesh.castShadow = q !== 'low';
      mesh.visible = false;
      this.formation.add(mesh);
      this.rocks.push({ mesh, slot: i / nRocks, start: new THREE.Vector3(), spin: new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(2.2), size, launched: false, delay: i * 0.055 });
    }
    // --- Fire: flame ribbons spiralling on the sphere surface.
    const nFire = byQuality(ctx, 2, 3, 4);
    for (let i = 0; i < nFire; i++) {
      const mat = flameMaterial({ sheet: true, palette: 'fire', scroll: [0, 2.4], scale: [1, 2.2], intensity: 1.3, opacity: 0 });
      const trail = new Trail(mat, { width: 0.42, life: 0.42, maxPoints: q === 'low' ? 14 : 22, minDist: 0.1 });
      trail.mesh.renderOrder = 4;
      ctx.vfx.group.add(trail.mesh);
      this.fires.push({ trail, mat, phase: (i / nFire) * Math.PI * 2, lit: false, head: new THREE.Vector3() });
    }
    if (dynamicLights(ctx)) {
      this.light = new THREE.PointLight('#ffb070', 0, 10, 2);
      this.group.add(this.light);
    } else this.light = null;
    this.loop = ctx.audio.loop('loop.avatar.sphere', { position: player.position, volume: 0.6 });
    this.follow(0);
  }

  /** Spin-up flash (an ultimate was cast). */
  pulse(strength = 1): void {
    this.flare = Math.max(this.flare, strength);
  }

  /** Pull every element tight around the Avatar for `seconds`, then burst back out (Cataclysm). */
  converge(seconds: number): void {
    this.convergeT = seconds;
    this.convergeDur = Math.max(0.01, seconds);
  }

  /** Throw the elements outward briefly (blast). */
  burst(): void {
    this.convergeT = 0;
    this.expand = 1;
    this.flare = 1;
  }

  release(quiet = false): void {
    if (this.releasing) return;
    this.releasing = true;
    this.releaseT = 0;
    this.embers?.stop();
    this.loop.stop(0.4);
    if (quiet) return;
    const c = this.center;
    this.ctx.vfx.burst('splash', c, { count: 18, radius: RADIUS * 0.8, speed: 2 });
    this.ctx.vfx.burst('fire', c, { count: 14, radius: RADIUS * 0.8, speed: 1.5 });
    this.ctx.vfx.burst('air', c, { count: 12, spread: 2, speed: 2.5 });
    this.ctx.audio.play('avatar.sphere.release', { position: c, volume: 0.9 });
  }

  /** Debug / test info. */
  info(): Record<string, unknown> {
    const vis = (arr: THREE.Object3D[]) => arr.filter((o) => o.visible).length;
    return {
      t: +this.t.toFixed(2),
      phase: this.phaseName(),
      wind: this.windBands.length + (this.windShell ? 1 : 0),
      water: vis(this.waterRibbons),
      rocks: vis(this.rocks.map((r) => r.mesh)),
      fire: this.fires.filter((f) => f.lit).length,
      ice: +this.ice.toFixed(2),
      radius: +this.radiusScale().toFixed(2),
      center: this.center.toArray().map((v) => +v.toFixed(2)),
    };
  }

  private phaseName(): string {
    const t = this.t;
    if (this.releasing) return 'release';
    if (t < 0.5) return 'buildup';
    if (t < AIR_IN) return 'burst';
    if (t < WATER_IN) return 'air';
    if (t < EARTH_IN) return 'water';
    if (t < FIRE_IN) return 'earth';
    if (t < CONVERGE_IN) return 'fire';
    if (t < CONVERGE_END) return 'converge';
    return 'formation';
  }

  private radiusScale(): number {
    const pre = 1 + 0.25 * (1 - smooth(CONVERGE_IN, CONVERGE_END, this.t));
    const conv = this.convergeT > 0 ? 1 - 0.55 * smooth(0, 0.35, this.convergeDur - this.convergeT + 0.001) : 1;
    const rel = this.releasing ? 1 + 1.6 * smooth(0, 0.5, this.releaseT) : 1;
    return pre * conv * (1 + 0.6 * this.expand) * rel;
  }

  private follow(dt: number): void {
    const p = this.player;
    const hover = p.humanoid ? p.humanoid.root.position.y : 0;
    const target = tA.set(p.position.x, p.position.y + 1.15 + hover, p.position.z);
    // Stick to the Avatar (tiny lag on big jumps reads as inertia, never more than a few cm).
    if (dt <= 0 || this.center.distanceToSquared(target) > 4) this.center.copy(target);
    else this.center.lerp(target, Math.min(1, dt * 30));
    this.group.position.copy(this.center);
  }

  /** Advance; returns false when the release has finished (caller disposes). */
  update(dt: number): boolean {
    if (this.disposed) return false;
    const ctx = this.ctx;
    this.t += dt;
    if (this.releasing) this.releaseT += dt;
    this.follow(dt);
    this.flare = Math.max(0, this.flare - dt * 1.2);
    this.expand = Math.max(0, this.expand - dt * 1.6);
    if (this.convergeT > 0) this.convergeT = Math.max(0, this.convergeT - dt);
    const t = this.t;
    const fade = this.releasing ? 1 - smooth(0, 0.5, this.releaseT) : 1;
    const R = RADIUS * this.radiusScale();
    const spinRate = 0.55 + 1.8 * this.flare + 1.2 * (1 - smooth(CONVERGE_IN, CONVERGE_END, t)) + (this.convergeT > 0 ? 2.5 : 0);
    this.spinAngle += dt * spinRate;
    this.formation.rotation.y = this.spinAngle;
    const c = this.center;
    this.loop.setPosition(c);

    // Build-up: spirit energy gathers inward.
    if (t < 0.5 && !this.releasing && Math.random() < dt * 40) {
      const n = byQuality(ctx, 2, 3, 5);
      for (let i = 0; i < n; i++) {
        const p = tB.randomDirection().multiplyScalar(2.5 + Math.random()).add(c);
        ctx.vfx.burst('spirit', p, { count: 1, dir: tC.subVectors(c, p), spread: 0.05, speed: 2.4, life: 0.8 });
      }
    }

    // --- Air.
    const air = smooth(AIR_IN, AIR_IN + 0.45, t) * fade;
    if (t >= AIR_IN && !this.windSpiralDone && !this.releasing) {
      this.windSpiralDone = true;
      windSpiral(ctx, tA.copy(this.player.position), { height: 3.2, r0: 0.7, r1: RADIUS * 1.1, duration: 0.65, turns: 2.2, count: byQuality(ctx, 1, 2, 3) });
      ctx.vfx.burst('swirl', c, { count: 16, swirl: 9, radius: RADIUS * 0.8, speed: 1.2 });
      ctx.world.fx.disturb(this.player.position, 8, 1.2);
    }
    this.windBands.forEach((b, i) => {
      b.scale.setScalar(R * (1.04 + 0.03 * i) * (0.4 + 0.6 * air));
      b.rotateY(dt * (0.8 + 0.3 * i) * (1 + this.flare * 2));
    });
    // Translucent: the Avatar and targets stay readable through the formation.
    this.windMats.forEach((m, i) => setOpacity(m, (i < this.windBands.length ? 0.34 : 0.1) * air));
    if (this.windShell) {
      this.windShell.scale.setScalar(R * 1.15);
      this.windShell.rotation.y += dt * 0.6;
    }

    // --- Water (ribbons flow in, then periodically freeze and melt).
    const water = smooth(WATER_IN, WATER_IN + 0.5, t) * fade;
    this.waterRibbons.forEach((w, i) => {
      w.visible = water > 0.01;
      const grow = smooth(WATER_IN + i * 0.1, WATER_IN + 0.5 + i * 0.1, t);
      const idx = w.geometry.index;
      if (idx) w.geometry.setDrawRange(0, Math.floor((idx.count / 6) * grow) * 6);
      w.scale.setScalar(R / RADIUS);
      w.rotation.y += dt * (i ? -0.25 : 0.2);
    });
    this.updateIce(dt, water);
    this.waterMats.forEach((m) => {
      m.uniforms.uOpacity.value = 0.88 * water;
      m.uniforms.uIce.value = this.ice;
      m.uniforms.uGlow.value = 0.25 + 0.5 * this.flare;
    });
    if (t >= WATER_IN && t < WATER_IN + 0.4 && !this.releasing && Math.random() < dt * 20) {
      ctx.vfx.burst('splash', tA.copy(c).addScaledVector(tB.randomDirection(), R), { count: 3, speed: 0.8 });
    }

    // --- Earth (rocks rise from the ground, then orbit; water weaves between them).
    for (const r of this.rocks) this.updateRock(r, dt, R, fade);

    // --- Fire.
    const fire = smooth(FIRE_IN, FIRE_IN + 0.4, t) * fade;
    const now = ctx.time.elapsed;
    const cam = ctx.camera.position;
    for (const f of this.fires) {
      if (!f.lit && t >= FIRE_IN && !this.releasing) {
        f.lit = true;
        this.fireHead(f, R, t);
        ctx.vfx.burst('fire', f.head, { count: 8, speed: 1.4 });
        ctx.vfx.burst('embers', f.head, { count: 8, speed: 2 });
        if (!this.embers) {
          this.embers = ctx.vfx.emitter('embers', byQuality(ctx, 6, 10, 16), { radius: RADIUS * 0.7, speed: 0.6 });
          ctx.audio.play('bend_fire_whoosh', { position: c, volume: 0.6 });
        }
      }
      if (!f.lit) continue;
      this.fireHead(f, R, t);
      if (!this.releasing) f.trail.push(f.head, now);
      f.trail.update(now, cam);
      setOpacity(f.mat, fire);
    }
    if (this.embers) this.embers.position.copy(c);
    if (this.light) {
      const flick = 0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 7.3);
      this.light.intensity = 12 * fire * flick + 10 * this.flare;
      this.light.color.setRGB(1, 0.72 + 0.2 * air * (1 - fire), 0.5 + 0.4 * (1 - fire));
    }
    return !this.releasing || this.releaseT < 0.55;
  }

  private fireHead(f: FireRibbon, R: number, t: number): void {
    const w = 2.3 * (1 + this.flare);
    const a = f.phase + this.spinAngle * 1.6 + t * w;
    const y = Math.sin(a * 0.62 + f.phase * 1.7) * R * 0.62;
    const rxz = Math.sqrt(Math.max(0.05, R * R - y * y)) * 1.02;
    f.head.set(this.center.x + Math.cos(a) * rxz, this.center.y + y, this.center.z + Math.sin(a) * rxz);
  }

  private updateIce(dt: number, water: number): void {
    if (water <= 0.01) return;
    this.iceClock += dt;
    const c = this.center;
    const vfx = this.ctx.vfx;
    switch (this.iceState) {
      case 'liquid':
        // First freeze is part of the entry sequence, then every ~7 s.
        if (this.iceClock > (this.t < 3 ? 0.55 : 6.5) && !this.releasing) {
          this.iceState = 'freezing';
          this.iceClock = 0;
          vfx.burst('ice', c, { count: 12, radius: RADIUS, speed: 0.6 });
          this.ctx.audio.play('ice_form', { position: c, volume: 0.5 });
        }
        break;
      case 'freezing':
        this.ice = Math.min(1, this.ice + dt / 0.35);
        if (this.ice >= 1) {
          this.iceState = 'frozen';
          this.iceClock = 0;
        }
        break;
      case 'frozen':
        if (this.iceClock > (this.t < 3 ? 0.3 : 1.6) || this.releasing) {
          this.iceState = 'melting';
          this.iceClock = 0;
        }
        break;
      case 'melting':
        this.ice = Math.max(0, this.ice - dt / 0.5);
        if (Math.random() < dt * 12) vfx.burst('splash', tA.copy(c).addScaledVector(tB.randomDirection(), RADIUS), { count: 2, speed: 0.5 });
        if (this.ice <= 0) {
          this.iceState = 'liquid';
          this.iceClock = 0;
        }
        break;
    }
  }

  private updateRock(r: Rock, dt: number, R: number, fade: number): void {
    const ctx = this.ctx;
    const launchAt = EARTH_IN + r.delay;
    const m = r.mesh;
    if (!r.launched) {
      if (this.t < launchAt || this.releasing) return;
      r.launched = true;
      // Torn out of the ground in front of / around the Avatar.
      const a = r.slot * Math.PI * 2 + this.spinAngle;
      const dist = 1.6 + (r.slot * 7) % 1.4;
      const p = this.player.position;
      const gx = p.x + Math.cos(a) * dist, gz = p.z + Math.sin(a) * dist;
      const gy = ctx.world.groundAt(gx, gz, p.y + 1.5).y;
      r.start.set(gx, gy - 0.1, gz);
      const base = tA.set(gx, gy + 0.1, gz);
      ctx.vfx.burst('dust', base, { count: 5, radius: 0.35, speed: 1.2 });
      debris(base, byQuality(ctx, 2, 4, 5), { spread: 0.8, speed: 4, size: 0.06, radius: 0.3, color: this.rockTint, life: 1.2 });
      if (r.slot === 0) {
        ctx.world.fx.crack(tA.set(p.x, gy, p.z), 2.6);
        ctx.audio.play('bend_earth_rise', { position: base, volume: 0.7 });
      }
      m.visible = true;
    }
    // Orbit slot (formation-local), tilted plane with a weave so water can flow around.
    const a = r.slot * Math.PI * 2 + this.t * 1.1;
    const orbitY = Math.sin(a * 2 + r.slot * 5) * 0.28 * R + Math.sin(a) * 0.22 * R;
    const rr = R * 0.96;
    const slot = tB.set(Math.cos(a) * rr, orbitY, Math.sin(a) * rr);
    const k = Math.min(1, (this.t - launchAt) / 0.5);
    if (k < 1 && !this.releasing) {
      // Rising from the ground: start (world) → slot (formation-local).
      this.formation.updateWorldMatrix(true, false);
      const startLocal = this.formation.worldToLocal(tC.copy(r.start));
      m.position.lerpVectors(startLocal, slot, Math.min(1.1, easeOutBack(k)));
    } else if (this.releasing) {
      // Flung outward and dropped.
      m.position.copy(slot).multiplyScalar(1 + this.releaseT * 1.2);
      m.position.y -= 9 * this.releaseT * this.releaseT;
    } else m.position.copy(slot);
    m.rotation.x += r.spin.x * dt * (1 + this.flare * 3);
    m.rotation.y += r.spin.y * dt;
    m.rotation.z += r.spin.z * dt;
    m.scale.setScalar(r.size * (0.4 + 0.6 * Math.min(1, k * 2)) * (this.releasing ? fade : 1));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.embers?.stop();
    this.loop.stop(0.2);
    this.group.removeFromParent();
    for (const m of this.windMats) m.dispose();
    for (const m of this.waterMats) m.dispose();
    for (const f of this.fires) {
      f.trail.mesh.removeFromParent();
      f.trail.dispose();
      f.mat.dispose();
    }
    this.light?.dispose();
    // Rock geometry / stone material and the band / shell / ribbon shapes are shared caches.
  }
}

/** Closed ribbon of water around a sphere of radius RADIUS, weaving in/out (3 lobes) and up/down; uv.y = arc length. */
function waterRibbonGeometry(seed: number, segs: number, radial: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 24;
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const r = RADIUS * (0.98 + 0.08 * Math.sin(3 * th + seed * 1.7));
    const y = RADIUS * 0.3 * Math.sin(2 * th + seed * 1.3);
    pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, 0.085, radial, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const len = curve.getLength();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, v, u * len);
  }
  g.computeBoundingSphere();
  return g;
}
