import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { Emitter } from '../../../vfx/VFX';
import { registerTechnique } from '../../CombatSystem';
import { clamp01 } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast, Projectile } from '../../types';
import { contactsAlongPath, douse, fxOf, GatherStream, handPos, refundWater, spill, type PathContact } from './shared';

/**
 * Water Jet (channel): a narrow, high-pressure stream from both palms. The
 * beam is steered by the bender's aim (turn-rate limited), stops at walls and
 * terrain, and is the hitbox: every ~0.16 s it damages and pushes whatever it
 * touches (intended damage over time), cuts through hostile projectiles and
 * hisses fire into steam. The bender braces against the recoil.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
export const JET = { range: 18, radius: 0.2, hitRadius: 0.48, tick: 0.16, damage: 3.2, push: 5 };

class JetEffect implements WaterEffect {
  readonly kind = 'jet';
  castId: number;
  private readonly fx: WaterFX;
  private readonly beam: StreamBody;
  readonly dir = new THREE.Vector3();
  readonly start = new THREE.Vector3();
  readonly end = new THREE.Vector3();
  private t = 0;
  private active = false;
  private stopT = -1;
  private tickT = 0;
  private emitter: Emitter | null = null;
  private loop: LoopHandle | null = null;
  private readonly contacts: PathContact[] = [];
  private readonly near: Projectile[] = [];
  private samples: number[][] = [];
  ticks = 0;
  readonly hits: Array<{ id: number; frame: number }> = [];

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    this.dir.copy(cast.aimDir).normalize();
    // High pressure: fast streaks, lots of foam, a faint glow so the beam reads at range.
    this.beam = new StreamBody(this.fx, { flow: 26, foam: 1.6, glow: 0.18, opacity: 0.95 }, 1, 6, 8);
    this.beam.wobble = 0.02;
  }

  start_(): void {
    this.active = true;
    const ctx = this.cast.ctx;
    this.emitter = ctx.vfx.emitter('spray', 40, { size: 0.9, speed: 1.2, spread: 1.2 });
    this.loop = ctx.audio.loop('water_jet', { position: this.cast.caster.position, volume: 0.7 });
  }

  stop(): void {
    if (this.stopT >= 0) return;
    const wasActive = this.active;
    this.stopT = 0;
    this.active = false;
    this.emitter?.stop();
    this.loop?.stop(0.2);
    if (!wasActive) return;
    this.fx.droplets(this.beam.path, 0, this.beam.path.length, 10);
    spill(this.cast, this.end, this.cast.water.amount * 0.5);
  }

  private desiredDir(out: THREE.Vector3): THREE.Vector3 {
    const c = this.cast.caster as unknown as { aimDir?: THREE.Vector3 };
    if (this.cast.caster.isPlayer && c.aimDir) return out.copy(c.aimDir);
    const target = this.cast.target;
    if (target && target.alive) return target.aimPoint(out).sub(this.start).normalize();
    return out.copy(this.cast.aimDir);
  }

  update(dt: number): boolean {
    this.t += dt;
    const ctx = this.cast.ctx;
    const caster = this.cast.caster;
    handPos(caster, 'hands', this.start).addScaledVector(this.dir, 0.3);
    if (this.stopT >= 0) {
      this.stopT += dt;
      this.beam.tail = clamp01(this.stopT / 0.18);
      this.beam.build(6);
      return this.stopT < 0.18;
    }
    if (!this.active) {
      this.beam.hide();
      return this.t < 4;
    }
    // Steer toward the aim (limited turn rate).
    const want = this.desiredDir(tA);
    const ang = this.dir.angleTo(want);
    const maxTurn = 1.6 * dt;
    if (ang > 1e-4) this.dir.lerp(want, Math.min(1, maxTurn / ang)).normalize();
    // Beam length: stop at terrain / colliders.
    const hit = ctx.world.raycast(this.start, this.dir, JET.range);
    const len = hit ? Math.max(0.5, hit.distance) : JET.range;
    this.end.copy(this.start).addScaledVector(this.dir, len);
    const p = this.beam.pts;
    const time = this.fx.time;
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      p[i].copy(this.start).addScaledVector(this.dir, len * u);
      // Slight sag and pressure flutter in the middle.
      p[i].y -= Math.sin(Math.PI * u) * 0.12 * len * 0.05;
      p[i].x += Math.sin(time * 40 + i * 2.1) * 0.03 * u;
      p[i].z += Math.cos(time * 37 + i * 1.7) * 0.03 * u;
    }
    this.beam.radius = JET.radius * (1 + 0.12 * Math.sin(time * 30));
    // Tight at the palms, flaring slightly toward the impact; never thinner than the hitbox core.
    this.beam.profile = (u) => capTaper(u, 0.02, 0.03) * (0.85 + 0.35 * u);
    if (Math.random() < dt * 12) ctx.vfx.burst('spray', this.start, { count: 1, size: 0.5, speed: 0.6 });
    this.beam.build(6);
    if (this.emitter) {
      this.emitter.position.copy(this.end);
      this.emitter.direction.copy(this.dir).negate();
    }
    this.loop?.setPosition(this.start);
    // Recoil: braced, but pushed back slowly.
    caster.body?.impulse(-this.dir.x * 0.12, 0, -this.dir.z * 0.12);
    // Damage ticks along the visible beam.
    this.tickT -= dt;
    this.samples = [];
    if (this.tickT <= 0) {
      this.tickT = JET.tick;
      this.ticks++;
      const L = this.beam.path.length;
      contactsAlongPath(this.cast, this.beam.path, 0.2, L, JET.hitRadius, this.contacts, this.samples);
      for (const c of this.contacts) {
        const res = this.cast.hit(c.e, { damage: JET.damage, knockback: tB.copy(this.dir).setY(0).normalize().multiplyScalar(JET.push).clone(), stagger: 7, status: [{ type: 'soaked', duration: 6 }], point: c.point }, true);
        if (res) {
          this.hits.push({ id: c.e.id, frame: ctx.time.frame });
          douse(this.cast, c.e);
          ctx.vfx.burst('splash', c.point, { count: 6, speed: 1 });
        }
      }
      // Cut through hostile projectiles crossing the beam.
      for (let i = 0; i <= 6; i++) {
        this.beam.path.at((L * i) / 6, tA);
        for (const q of ctx.combat.projectilesInRadius(tA, 0.6, this.near)) {
          if (q.cast.caster === caster || !ctx.combat.canHarm(q.cast.caster, caster)) continue;
          q.kill();
          if (q.cast.def.element === 'fire') this.fx.steam(q.position, 1);
          else ctx.vfx.burst('splash', q.position, { count: 6 });
        }
      }
      if (hit) {
        ctx.world.fx.wet(this.end, 1.2);
        ctx.world.fx.disturb(this.end, 2, 0.6);
      }
    }
    return true;
  }

  trace(): Record<string, unknown> {
    return { start: this.start.toArray(), end: this.end.toArray(), dir: this.dir.toArray(), active: this.active, samples: this.samples, hitRadius: JET.hitRadius, ticks: this.ticks };
  }

  dispose(): void {
    this.beam.dispose();
    this.emitter?.stop();
    this.loop?.stop(0.1);
  }
}

registerTechnique({
  id: 'water_jet',
  name: 'Water Jet',
  element: 'water',
  kind: 'ability',
  tier: 3,
  description: 'Compress water into a thin, high-pressure jet from both palms. Steer it with your aim to push foes back and wear them down; it slices through projectiles and douses flames.',
  usage: 'Ability (channel ~2.4 s). Hold your aim on a target. Needs a good amount of water.',
  icon: 'water',
  chiCost: 22,
  cooldown: 3.5,
  water: { amount: 20 },
  windup: 0.3,
  recovery: 0.4,
  movement: 'root',
  airborne: false,
  channel: 2.4,
  interruptible: true,
  range: 18,
  begin(cast) {
    const a = cast.caster.humanoid?.animator;
    a?.play('water_jet_brace', { fadeIn: 0.08, hold: true });
    a?.play('water_blast', { fadeIn: 0.05, speed: 1.1 });
    cast.data.jet = fxOf(cast).add(new JetEffect(cast));
    cast.data.gather = fxOf(cast).add(new GatherStream(cast, { hand: 'hands', duration: cast.def.windup * 0.9, radius: 0.18 }));
  },
  release(cast) {
    cast.data.released = true;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    (cast.data.jet as JetEffect).start_();
    cast.caster.humanoid?.animator.play('water_jet_hold', { fadeIn: 0.1 });
    cast.ctx.audio.play('water_launch', { position: cast.caster.position, volume: 0.7, pitch: 1.4 });
  },
  channelUpdate(cast) {
    return cast.caster.alive;
  },
  end(cast, interrupted) {
    const a = cast.caster.humanoid?.animator;
    a?.stop('water_jet_brace', 0.2);
    a?.stop('water_jet_hold', 0.2);
    const jet = cast.data.jet as JetEffect | undefined;
    if (!cast.data.released) {
      jet?.stop();
      if (interrupted) {
        (cast.data.gather as GatherStream | undefined)?.drop();
        refundWater(cast);
      }
      return;
    }
    jet?.stop();
  },
  aiScore(_c, _t, dist) {
    return dist > 4 && dist < 16 ? 0.45 : 0;
  },
});
