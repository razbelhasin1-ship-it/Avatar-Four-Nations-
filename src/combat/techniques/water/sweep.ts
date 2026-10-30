import * as THREE from 'three';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast } from '../../types';
import { basis, douse, fxOf, GatherStream, refundWater, shake, spill } from './shared';

/**
 * Water Sweep: the bender drops low and sweeps both arms through a wide arc,
 * sending a ground-hugging crescent wave rolling outward. The wave's crest IS
 * the hitbox: anything inside the advancing band (and within the arc) is
 * knocked down and soaked, once per cast.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const ARC_PTS = 11;

export const SWEEP = { halfAngle: 1.08, r0: 1.1, r1: 9.5, duration: 0.62, band: [1.15, 0.55] as const };

class SweepEffect implements WaterEffect {
  readonly kind = 'sweep';
  castId: number;
  private readonly fx: WaterFX;
  private readonly crest: StreamBody;
  private readonly wake: StreamBody;
  private readonly center = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly r = new THREE.Vector3();
  private t = 0;
  rad = SWEEP.r0;
  readonly hits: Array<{ id: number; frame: number; rad: number; d: number }> = [];

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    basis(cast.aimDir, this.f, this.r);
    this.center.copy(cast.caster.position);
    this.crest = new StreamBody(this.fx, { flow: 10, foam: 1.2 }, 1.2, ARC_PTS);
    this.crest.wobble = 0.05;
    this.wake = new StreamBody(this.fx, { flow: 6, opacity: 0.55 }, 1, ARC_PTS);
    this.wake.wobble = 0.04;
  }

  private arcPoint(i: number, rad: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
    const a = -SWEEP.halfAngle + (2 * SWEEP.halfAngle * i) / (ARC_PTS - 1);
    const dx = this.f.x * Math.cos(a) + this.r.x * Math.sin(a);
    const dz = this.f.z * Math.cos(a) + this.r.z * Math.sin(a);
    const x = this.center.x + dx * rad, z = this.center.z + dz * rad;
    const ctx = this.cast.ctx;
    const g = ctx.world.groundAt(x, z, this.center.y + 4);
    const w = ctx.world.waterAt(x, z);
    const y = w && w.level > g.y ? w.level : g.y;
    return out.set(x, y + lift, z);
  }

  update(dt: number): boolean {
    this.t += dt;
    const D = SWEEP.duration;
    const prevRad = this.rad;
    const k = clamp01(this.t / D);
    this.rad = SWEEP.r0 + (SWEEP.r1 - SWEEP.r0) * easeOut(k);
    const fade = this.t > D ? clamp01((this.t - D) / 0.3) : 0;
    // A real wave: tall at first, flattening as it spreads.
    const h = 0.95 * (1 - 0.55 * k) * (1 - fade);
    for (let i = 0; i < ARC_PTS; i++) {
      const edge = Math.sin((Math.PI * i) / (ARC_PTS - 1));
      this.arcPoint(i, this.rad, h * (0.6 + 0.4 * edge) + 0.12, this.crest.pts[i]);
      this.arcPoint(i, Math.max(SWEEP.r0, this.rad - 1.1), 0.08, this.wake.pts[i]);
    }
    this.crest.radius = (0.42 + 0.2 * (1 - k)) * (1 - fade);
    this.crest.profile = (u) => capTaper(u, 0.12, 0.12) * (0.75 + 0.25 * Math.sin(Math.PI * u));
    this.crest.build(ARC_PTS);
    this.wake.radius = 0.2 * (1 - fade);
    this.wake.profile = (u) => capTaper(u, 0.2, 0.2);
    this.wake.build(ARC_PTS);
    if (fade < 1 && this.t <= D) {
      // Foam along the leading edge.
      const ctx = this.cast.ctx;
      // Spray thrown forward off the crest, foam along the leading edge.
      const spd = (this.rad - prevRad) / Math.max(1e-3, dt);
      for (let i = 0; i < 3; i++) {
        const j = Math.floor(Math.random() * ARC_PTS);
        const q = this.crest.pts[j];
        tA.set(q.x - this.center.x, 0, q.z - this.center.z).normalize().multiplyScalar(spd * 0.8);
        tA.y = 2.5;
        this.fx.shed(q, tA, 1, 1.2);
      }
      if (Math.random() < 0.5) ctx.vfx.burst('splash', this.crest.pts[Math.floor(Math.random() * ARC_PTS)], { count: 1, speed: 0.6, size: 0.7 });
      this.hitBand(prevRad, this.rad);
    }
    if (this.t > D && !this.cast.data.spilled) {
      this.cast.data.spilled = true;
      const mid = this.crest.pts[Math.floor(ARC_PTS / 2)];
      spill(this.cast, mid, this.cast.water.amount * 0.6);
      this.cast.ctx.world.fx.wet(mid, 3);
      this.fx.droplets(this.crest.path, 0, this.crest.path.length, 8);
    }
    return this.t < D + 0.3;
  }

  private hitBand(prevRad: number, rad: number): void {
    const cast = this.cast;
    const inner = Math.min(prevRad, rad) - SWEEP.band[0];
    const outer = rad + SWEEP.band[1];
    for (const e of cast.ctx.entities.queryRadius(this.center, outer + 1.5)) {
      if (e === cast.caster || !cast.ctx.combat.canHarm(cast.caster, e)) continue;
      const dx = e.position.x - this.center.x, dz = e.position.z - this.center.z;
      const d = Math.hypot(dx, dz);
      if (d + e.radius < inner || d - e.radius > outer) continue;
      const ang = Math.atan2(dx * this.r.x + dz * this.r.z, dx * this.f.x + dz * this.f.z);
      if (Math.abs(ang) > SWEEP.halfAngle + e.radius / Math.max(1, d)) continue;
      // Ground-level wave: must be near the ground under the target.
      const gy = cast.ctx.world.groundAt(e.position.x, e.position.z, e.position.y + 0.5).y;
      if (e.position.y - gy > 1.6) continue;
      const out = tA.set(dx, 0, dz).normalize();
      const res = cast.hit(e, { damage: 12, knockback: out.clone().multiplyScalar(10), launch: 2.5, stagger: 45, knockdown: true, status: [{ type: 'soaked', duration: 8 }], point: tB.copy(e.position).setY(gy + 0.6).clone() });
      if (res) {
        this.hits.push({ id: e.id, frame: cast.ctx.time.frame, rad, d });
        douse(cast, e);
        this.fx.splash(tB, 1, { volume: 0.7 });
        shake(cast, 0.12, 0.15);
      }
    }
  }

  trace(): Record<string, unknown> {
    return { center: this.center.toArray(), rad: this.rad, band: [this.rad - SWEEP.band[0], this.rad + SWEEP.band[1]], halfAngle: SWEEP.halfAngle, hits: this.hits.map((h) => h.id) };
  }

  dispose(): void {
    this.crest.dispose();
    this.wake.dispose();
  }
}

registerTechnique({
  id: 'water_sweep',
  name: 'Water Sweep',
  element: 'water',
  kind: 'ability',
  tier: 2,
  description: 'Drop low and sweep a wide crescent wave across the ground, knocking down everything in front of you.',
  usage: 'Ability. A ground-level wave in a wide arc (about 120°, 9 m). Needs water.',
  icon: 'water',
  chiCost: 18,
  cooldown: 2.8,
  water: { amount: 14 },
  windup: 0.3,
  recovery: 0.5,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 9,
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_sweep', { fadeIn: 0.05 });
    const c = cast.caster;
    cast.data.gather = fxOf(cast).add(
      new GatherStream(cast, {
        hand: 'hands',
        duration: cast.def.windup * 0.9,
        radius: 0.2,
        arc: 0.3,
        target: (out) => out.set(c.position.x + Math.sin(c.yaw) * 1.1, c.position.y + 0.25, c.position.z + Math.cos(c.yaw) * 1.1),
      }),
    );
  },
  release(cast) {
    cast.data.released = true;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    cast.data.sweep = fxOf(cast).add(new SweepEffect(cast));
    const p = cast.caster.position;
    cast.ctx.audio.play('water_launch', { position: p, volume: 0.9, pitch: 0.75 });
    cast.ctx.audio.play('water_impact', { position: p, volume: 0.5, pitch: 1.3 });
    cast.ctx.world.fx.disturb(p, 9, 1);
    shake(cast, 0.1, 0.2);
  },
  end(cast, interrupted) {
    if (interrupted && !cast.data.released) {
      (cast.data.gather as GatherStream | undefined)?.drop();
      refundWater(cast);
    }
  },
  aiScore(_c, _t, dist) {
    return dist < 8 ? 0.55 : 0;
  },
});
