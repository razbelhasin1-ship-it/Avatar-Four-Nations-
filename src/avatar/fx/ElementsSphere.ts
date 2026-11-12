import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import { createWaterMaterial } from '../../combat/water/WaterMaterials';
import type { GameContext } from '../../core/GameContext';
import type { Player } from '../../player/Player';
import type { Emitter } from '../../vfx/VFX';
import { debris } from '../../vfx/effects/loop';
import { earthTint, rockGeometry, stoneMaterial } from '../../vfx/effects/rocks';
import { shared, shellSphere } from '../../vfx/effects/shapes';
import { windSpiral } from '../../vfx/effects/wind';
import { byQuality, dynamicLights } from './common';
import { airShellMaterial, flameRingGeometry, flameRingMaterial, ringTube, type FlameRingSpec } from './sphereMaterials';

/**
 * Elements Sphere (the Avatar State once all four elements can be bent), after the series' Sozin's Comet frame:
 * the Avatar hangs at the centre of a sphere of whirling air, a translucent bubble streaked by the
 * wind circling it, girdled at the waist by a broad band of fire that reaches past the sphere,
 * with a ring of water spinning on a steep tilt and stones torn from the ground orbiting inside.
 * The fire is a ring of tongues of flame racing round (camera-facing ribbons bent along the ring),
 * so it reads as fire from the gameplay camera above as well as from the side.
 *
 * Sequence (seconds after activation): build-up (spirit gathers inward) → 0.5 initial burst
 * (AvatarStateSystem wave) → 0.6 the air sphere blows open → 1.0 the water ring draws itself
 * round → 1.4 rocks tear out of the ground and rise into orbit → 1.85 the fire band ignites and
 * races once round → 2.3-2.75 the formation tightens and settles; the outward wave.
 *
 * Around a grounded Avatar the sphere rests on the ground (it never sinks into it) and the Avatar
 * rises toward its centre when still; the fire band follows the waist. Everything stays
 * translucent over the Avatar, scales with the effects quality and frees its materials on
 * dispose(). Ultimates call pulse() / converge() / burst().
 */
export const SPHERE_SEQUENCE = 2.8;

const AIR_IN = 0.6;
const WATER_IN = 1.0;
const EARTH_IN = 1.4;
const FIRE_IN = 1.85;
const CONVERGE_IN = 2.3;
const CONVERGE_END = 2.75;
/** Air sphere radius (m): about twice the Avatar's height across, as in the series. */
const RADIUS = 2.0;
/** Seconds for the ignition to race once round the fire band. */
const IGNITE = 0.4;
/** Fire band: radii (m) its flames span, close round the waist out well past the sphere. */
const BAND_IN = 0.9;
const BAND_OUT = 3.3;
/**
 * The band's two layers: the flame body (orange and yellow tongues with red, ragged edges that
 * partly cover what is behind them) and the white-hot core (thin additive streaks through its
 * middle). Counts per effects quality [low, medium, high].
 */
const FLAME_BODY: Omit<FlameRingSpec, 'count'> & { counts: readonly [number, number, number] } = {
  counts: [90, 150, 210], inner: BAND_IN, outer: BAND_OUT, spread: 0.22, length: [1.1, 2.4], width: [0.3, 0.55],
  heat: [0.45, 0.95], alpha: [0.45, 0.7], occlusion: 0.75, speed: 2.6, cycle: [0.9, 1.7], seed: 1,
};
const FLAME_CORE: Omit<FlameRingSpec, 'count'> & { counts: readonly [number, number, number] } = {
  counts: [32, 52, 72], inner: 1.3, outer: 2.6, spread: 0.045, length: [1.0, 2.0], width: [0.12, 0.2],
  heat: [0.9, 1.15], alpha: [0.2, 0.38], occlusion: 0, speed: 2.9, cycle: [0.7, 1.3], seed: 2,
};
/** Water ring: radius and tilt from the horizontal (rad). */
const WATER_R = 1.78;
const WATER_TILT = 1.2;

interface Rock {
  mesh: THREE.Mesh;
  /** Own orbit inside the sphere: radius (× RADIUS), inclination, node, angular speed, phase. */
  orbit: { r: number; incl: number; node: number; speed: number; phase: number };
  start: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
  launched: boolean;
  delay: number;
}

interface FireLayer {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** Base brightness. */
  intensity: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (t: number): number => {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const frac = (x: number): number => x - Math.floor(x);

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

export class ElementsSphere {
  /** World-space anchor at the sphere's centre. */
  readonly group = new THREE.Group();
  /** Fire band (child of group), held at the Avatar's waist. */
  private readonly band = new THREE.Group();
  /** Turns the tilted water ring about the vertical. */
  private readonly waterPivot = new THREE.Group();
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
  /** Fire band height relative to the centre (m). */
  private bandOffset = -0.34;
  // Air
  private readonly shells: THREE.Mesh[] = [];
  private readonly airMats: THREE.ShaderMaterial[] = [];
  private airSpin = 0;
  private windSpiralDone = false;
  // Water
  private readonly water: THREE.Mesh;
  private readonly waterMat: THREE.ShaderMaterial;
  // Earth
  private readonly rocks: Rock[] = [];
  private readonly rockTint: string;
  // Fire
  private readonly fires: FireLayer[] = [];
  /** Integrated band time (s): runs faster while the band flares or spins up. */
  private fireSpin = 0;
  private fireLit = false;
  private sparkClock = 0;
  private embers: Emitter | null = null;
  private readonly light: THREE.PointLight | null;
  private readonly loop: LoopHandle;

  constructor(private readonly ctx: GameContext, private readonly player: Player) {
    this.group.name = 'elements_sphere';
    ctx.vfx.group.add(this.group);
    const q = ctx.vfx.quality;
    const low = q === 'low';
    // --- Air: the far side (seen from inside) under everything, the near side over the water and stones.
    const shellGeo = shared(`avatar_sphere_air_${q}`, () => shellSphere(1, low ? 40 : 64, low ? 24 : 40));
    for (const inner of [true, false]) {
      const m = airShellMaterial({ inner });
      const s = new THREE.Mesh(shellGeo, m);
      s.renderOrder = inner ? 1 : 3;
      s.visible = false;
      this.airMats.push(m);
      this.shells.push(s);
      this.group.add(s);
    }
    // --- Water: one ring on a steep tilt, precessing about the vertical while it flows round.
    const wgeo = shared(`avatar_sphere_water_ring_${q}`, () => ringTube(WATER_R, low ? 0.11 : 0.1, low ? 72 : 128, low ? 6 : 8));
    this.waterMat = createWaterMaterial({ opacity: 0, flow: 4.2, foam: 1.5, glow: 0.18, shallow: '#d9f2ff', deep: '#5aa2d8' });
    this.waterMat.side = THREE.DoubleSide;
    this.water = new THREE.Mesh(wgeo, this.waterMat);
    this.water.rotation.z = WATER_TILT;
    this.water.renderOrder = 2;
    this.water.visible = false;
    this.waterPivot.rotation.y = 0.55;
    this.waterPivot.add(this.water);
    this.group.add(this.waterPivot);
    // --- Earth: real rock torn from the ground under the Avatar, each stone on its own orbit inside.
    const g = ctx.world.groundAt(player.position.x, player.position.z, player.position.y + 1.5);
    this.rockTint = earthTint(g.surface);
    const nRocks = byQuality(ctx, 5, 7, 9);
    for (let i = 0; i < nRocks; i++) {
      const size = 0.09 + frac(i * 0.618 + 0.3) * 0.09;
      const mesh = new THREE.Mesh(rockGeometry(i, 1), stoneMaterial(this.rockTint));
      mesh.scale.setScalar(size);
      mesh.castShadow = !low;
      mesh.visible = false;
      this.group.add(mesh);
      this.rocks.push({
        mesh,
        orbit: { r: 0.62 + 0.26 * frac(i * 0.618), incl: -0.75 + 1.5 * frac(i * 0.382 + 0.1), node: i * 2.39996, speed: 0.85 + 0.4 * frac(i * 0.73), phase: (i / nRocks) * Math.PI * 2 },
        start: new THREE.Vector3(),
        spin: new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(2.2),
        size,
        launched: false,
        delay: i * 0.05,
      });
    }
    // --- Fire: one broad band at the waist: the flame body, then the white-hot core over it.
    const qi = low ? 0 : q === 'medium' ? 1 : 2;
    ([[FLAME_BODY, 1.1, 4], [FLAME_CORE, 0.85, 5]] as const).forEach(([spec, intensity, order], i) => {
      const geo = shared(`avatar_sphere_flames_${i}_${q}`, () => flameRingGeometry({ ...spec, count: spec.counts[qi] }));
      const mat = flameRingMaterial(intensity);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      mesh.visible = false;
      this.band.add(mesh);
      this.fires.push({ mesh, mat, intensity });
    });
    this.group.add(this.band);
    if (dynamicLights(ctx)) {
      this.light = new THREE.PointLight('#ff9a48', 0, 11, 2);
      this.band.add(this.light);
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
    const band = tA.copy(c).setY(c.y + this.bandOffset);
    this.ctx.vfx.burst('splash', c, { count: 18, radius: RADIUS * 0.85, speed: 2 });
    if (this.fireLit) this.ctx.vfx.burst('fire', band, { count: 20, radius: RADIUS, speed: 2.4 });
    this.ctx.vfx.burst('air', c, { count: 14, spread: 2, speed: 2.8 });
    this.ctx.audio.play('avatar.sphere.release', { position: c, volume: 0.9 });
  }

  /** Debug / test info. */
  info(): Record<string, unknown> {
    const vis = (arr: THREE.Object3D[]) => arr.filter((o) => o.visible).length;
    return {
      t: +this.t.toFixed(2),
      phase: this.phaseName(),
      wind: vis(this.shells),
      water: this.water.visible ? 1 : 0,
      rocks: vis(this.rocks.map((r) => r.mesh)),
      fire: vis(this.fires.map((f) => f.mesh)),
      ice: 0,
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
    const feet = p.position.y;
    // Resting on the ground around a grounded Avatar; centred on the chest once it floats higher.
    const target = tA.set(p.position.x, Math.max(feet + 1.15 + hover, feet + RADIUS - 0.06), p.position.z);
    // Stick to the Avatar (tiny lag on big jumps reads as inertia, never more than a few cm).
    if (dt <= 0 || this.center.distanceToSquared(target) > 4) this.center.copy(target);
    else this.center.lerp(target, Math.min(1, dt * 30));
    this.group.position.copy(this.center);
    // The fire band girdles the waist.
    this.bandOffset = feet + 0.98 + hover - this.center.y;
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
    const k = this.radiusScale();
    const R = RADIUS * k;
    const settling = 1 - smooth(CONVERGE_IN, CONVERGE_END, t);
    const spinRate = 0.55 + 1.8 * this.flare + 1.2 * settling + (this.convergeT > 0 ? 2.5 : 0);
    this.spinAngle += dt * spinRate;
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

    // --- Fire state first (it lights the air).
    if (!this.fireLit && t >= FIRE_IN && !this.releasing) this.ignite();
    const fire = this.fireLit ? smooth(FIRE_IN, FIRE_IN + 0.25, t) * fade : 0;

    // --- Air: the sphere blows open, then whirls.
    const air = smooth(AIR_IN, AIR_IN + 0.45, t) * fade;
    if (t >= AIR_IN && !this.windSpiralDone && !this.releasing) {
      this.windSpiralDone = true;
      windSpiral(ctx, tA.copy(this.player.position), { height: 3.4, r0: 0.7, r1: RADIUS * 1.1, duration: 0.65, turns: 2.2, count: byQuality(ctx, 1, 2, 3) });
      ctx.vfx.burst('swirl', c, { count: 16, swirl: 9, radius: RADIUS * 0.8, speed: 1.2 });
      ctx.world.fx.disturb(this.player.position, 8, 1.2);
    }
    const open = this.releasing ? 1 : easeOutBack(Math.max(0, Math.min(1, (t - AIR_IN) / 0.5)));
    const airR = R * Math.max(0.04, open);
    this.airSpin += dt * (0.34 + 0.5 * settling + 0.9 * this.flare + (this.convergeT > 0 ? 1.4 : 0));
    this.shells.forEach((s, i) => {
      s.visible = air > 0.005;
      s.scale.setScalar(airR * (i === 0 ? 0.985 : 1));
    });
    for (const m of this.airMats) {
      const u = m.uniforms;
      u.uOpacity.value = air;
      u.uSpin.value = this.airSpin;
      u.uWarm.value = 0.3 * fire;
      u.uBandY.value = Math.max(-0.9, Math.min(0.9, this.bandOffset / Math.max(0.5, airR)));
      u.uGust.value = 0.6 + 0.8 * this.flare + 0.4 * settling;
    }

    // --- Water: the ring draws itself round, then flows and precesses.
    const water = smooth(WATER_IN, WATER_IN + 0.5, t) * fade;
    this.water.visible = water > 0.01;
    const idx = this.water.geometry.index;
    if (idx) {
      const draw = this.releasing ? 1 : smooth(WATER_IN, WATER_IN + 0.55, t);
      this.water.geometry.setDrawRange(0, Math.floor((idx.count / 6) * draw) * 6);
    }
    this.water.scale.setScalar(k);
    this.waterPivot.rotation.y += dt * (0.28 + 0.9 * this.flare + 0.4 * settling);
    this.waterMat.uniforms.uOpacity.value = 0.86 * water;
    this.waterMat.uniforms.uGlow.value = 0.18 + 0.5 * this.flare;
    if (t >= WATER_IN && t < WATER_IN + 0.45 && !this.releasing && Math.random() < dt * 18) {
      this.water.updateWorldMatrix(true, false);
      const a = Math.random() * Math.PI * 2;
      ctx.vfx.burst('splash', this.water.localToWorld(tA.set(Math.cos(a) * WATER_R, 0, Math.sin(a) * WATER_R)), { count: 3, speed: 0.8 });
    }

    // --- Earth: stones rise from the ground, then orbit inside the sphere.
    for (const r of this.rocks) this.updateRock(r, dt, R, fade);

    // --- Fire band at the waist.
    const reveal = this.fireLit ? (this.releasing ? 2 : Math.min(2, (t - FIRE_IN) / IGNITE)) : 0;
    this.band.position.y = this.bandOffset;
    this.band.scale.set(k, 1 + 0.3 * this.flare, k);
    this.fireSpin += dt * (1 + 1.5 * this.flare + 0.6 * settling + (this.convergeT > 0 ? 1.5 : 0));
    for (const f of this.fires) {
      const u = f.mat.uniforms;
      f.mesh.visible = fire > 0.003;
      u.uOpacity.value = fire;
      u.uReveal.value = reveal;
      u.uClock.value = t;
      u.uSpin.value = this.fireSpin;
      u.uSize.value = k;
      u.uIntensity.value = f.intensity * (1 + 0.8 * this.flare);
    }
    if (this.fireLit && !this.releasing) {
      this.band.updateWorldMatrix(true, false);
      if (reveal < 1) {
        // The ignition front throws flame as it races round.
        if (Math.random() < dt * 40) {
          const a = reveal * Math.PI * 2;
          const r = BAND_IN + Math.random() * (BAND_OUT - BAND_IN);
          ctx.vfx.burst('fire', this.band.localToWorld(tA.set(Math.cos(a) * r, 0, Math.sin(a) * r)), { count: 2, speed: 1.3 });
        }
      } else if (fire > 0.5) {
        // Tongues licking off the band now and then.
        this.sparkClock -= dt;
        if (this.sparkClock <= 0) {
          this.sparkClock = byQuality(ctx, 0.28, 0.16, 0.1);
          const a = Math.random() * Math.PI * 2;
          const r = 1.1 + Math.random() * (BAND_OUT - 1.4);
          ctx.vfx.burst('fire', this.band.localToWorld(tA.set(Math.cos(a) * r, 0, Math.sin(a) * r)), { count: 1, speed: 0.9 });
        }
      }
    }
    if (this.embers) this.embers.position.set(c.x, c.y + this.bandOffset, c.z);
    if (this.light) {
      const flick = 0.82 + 0.18 * Math.sin(t * 17) * Math.sin(t * 7.3);
      this.light.intensity = 4.5 * fire * flick + 6 * this.flare;
      this.light.color.setRGB(1, 0.66 + 0.1 * flick, 0.36);
    }
    return !this.releasing || this.releaseT < 0.55;
  }

  /** The band catches at one point and the flame races round it. */
  private ignite(): void {
    const ctx = this.ctx;
    this.fireLit = true;
    this.band.updateWorldMatrix(true, false);
    const start = this.band.localToWorld(tA.set(1.5, 0, 0));
    ctx.vfx.burst('fire', start, { count: 10, speed: 1.6 });
    ctx.vfx.burst('embers', start, { count: 10, speed: 2.2 });
    if (!this.embers) this.embers = ctx.vfx.emitter('embers', byQuality(ctx, 6, 10, 16), { radius: RADIUS * 0.9, speed: 0.6 });
    ctx.audio.play('bend_fire_whoosh', { position: this.center, volume: 0.7 });
  }

  private updateRock(r: Rock, dt: number, R: number, fade: number): void {
    const ctx = this.ctx;
    const launchAt = EARTH_IN + r.delay;
    const m = r.mesh;
    if (!r.launched) {
      if (this.t < launchAt || this.releasing) return;
      r.launched = true;
      // Torn out of the ground around the Avatar.
      const a = r.orbit.phase + this.spinAngle;
      const dist = 1.6 + frac(r.orbit.phase * 1.7) * 1.4;
      const p = this.player.position;
      const gx = p.x + Math.cos(a) * dist, gz = p.z + Math.sin(a) * dist;
      const gy = ctx.world.groundAt(gx, gz, p.y + 1.5).y;
      r.start.set(gx, gy - 0.1, gz);
      const base = tA.set(gx, gy + 0.1, gz);
      ctx.vfx.burst('dust', base, { count: 5, radius: 0.35, speed: 1.2 });
      debris(base, byQuality(ctx, 2, 4, 5), { spread: 0.8, speed: 4, size: 0.06, radius: 0.3, color: this.rockTint, life: 1.2 });
      if (r.delay === 0) {
        ctx.world.fx.crack(tA.set(p.x, gy, p.z), 2.6);
        ctx.audio.play('bend_earth_rise', { position: base, volume: 0.7 });
      }
      m.visible = true;
    }
    // Its own tilted orbit inside the sphere (sphere-local).
    const o = r.orbit;
    const a = o.phase + this.t * o.speed + this.spinAngle * 0.4;
    const rr = R * o.r;
    const x0 = Math.cos(a) * rr, z0 = Math.sin(a) * rr;
    const y1 = z0 * Math.sin(o.incl), z1 = z0 * Math.cos(o.incl);
    const cn = Math.cos(o.node), sn = Math.sin(o.node);
    const slot = tB.set(x0 * cn + z1 * sn, y1, -x0 * sn + z1 * cn);
    const rise = Math.min(1, (this.t - launchAt) / 0.5);
    if (rise < 1 && !this.releasing) {
      // Rising from the ground: start (world) → slot (sphere-local).
      this.group.updateWorldMatrix(true, false);
      const startLocal = this.group.worldToLocal(tC.copy(r.start));
      m.position.lerpVectors(startLocal, slot, Math.min(1.1, easeOutBack(rise)));
    } else if (this.releasing) {
      // Flung outward and dropped.
      m.position.copy(slot).multiplyScalar(1 + this.releaseT * 1.2);
      m.position.y -= 9 * this.releaseT * this.releaseT;
    } else m.position.copy(slot);
    m.rotation.x += r.spin.x * dt * (1 + this.flare * 3);
    m.rotation.y += r.spin.y * dt;
    m.rotation.z += r.spin.z * dt;
    m.scale.setScalar(r.size * (0.4 + 0.6 * Math.min(1, rise * 2)) * (this.releasing ? fade : 1));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.embers?.stop();
    this.loop.stop(0.2);
    this.group.removeFromParent();
    for (const m of this.airMats) m.dispose();
    this.waterMat.dispose();
    for (const f of this.fires) f.mat.dispose();
    this.light?.dispose();
    // Rock geometry / stone material and the shell / ring / flame shapes are shared caches.
  }
}
