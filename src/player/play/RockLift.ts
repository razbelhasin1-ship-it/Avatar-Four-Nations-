import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext } from '../../core/GameContext';
import { rockImpact } from '../../vfx/effects/earth';
import { addEffect, debris } from '../../vfx/effects/loop';
import type { EnvironmentSystem } from '../../world/env/EnvironmentSystem';
import type { RockRef, VegetationSystem } from '../../world/env/Vegetation';
import type { Player } from '../Player';
import { aimRay, HeldFollow, holdBand, holdPoint, type PlayInteraction } from './common';

/**
 * Earthbending play: hold the attack while looking at a loose rock or a modest boulder and
 * the real rock rises out of its bed in a burst of dust and grit, then floats in front of
 * the bender, following the aim (look up/down to raise/lower it), tilting with its motion
 * and turning slowly. Letting go drops it: it falls, lands with a thud and a dust cloud,
 * and stays where it fell (its collider moves with it).
 *
 * The rocks are the world's own vegetation rocks (VegetationSystem.borrowRock): the instance
 * and its collider are hidden while it is lifted and written back at its new resting place.
 * Only rocks up to MAX_SCALE are liftable (no hill-sized boulders, never buildings).
 */

/** Liftable rock sizes (vegetation scale: small rocks 0.35–1.25, boulders 1.7–3.3). */
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.9;
/** Metres from the bender to a rock they may lift. */
const REACH = 13;
/** Rising time (s). */
const RISE = 0.6;
/** The rock's visual centre sits this far (× height scale) above its placement point. */
const CENTER = 0.25;

const tO = new THREE.Vector3();
const tD = new THREE.Vector3();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const ID_Q = new THREE.Quaternion();

function vegetation(ctx: GameContext): VegetationSystem | null {
  return (ctx.extra.get('environment') as EnvironmentSystem | undefined)?.vegetation ?? null;
}

/** The liftable rock under the crosshair (in reach and in sight), or null. */
export function findRockTarget(ctx: GameContext, player: Player): RockRef | null {
  const veg = vegetation(ctx);
  if (!veg) return null;
  aimRay(ctx, player, tO, tD);
  // Anything solid in front of the rock hides it (boulders' own colliders sit inside their sphere).
  const solid = ctx.world.raycast(tO, tD, 45);
  const ref = veg.pickRock(tO, tD, Math.min(45, (solid ? solid.distance : 45) + 1.2), { minScale: MIN_SCALE, maxScale: MAX_SCALE });
  if (!ref) return null;
  const p = player.position;
  if (Math.hypot(ref.x - p.x, ref.z - p.z) > REACH + ref.sxz) return null;
  const chest = player.castOrigin('chest', tA);
  const top = tB.set(ref.x, ref.y + (CENTER + 0.66) * ref.sy + 0.25, ref.z);
  if (!ctx.world.hasLineOfSight(chest, top)) return null;
  return ref;
}

/** Rock material matching the vegetation shader's colouring (vertex colour × instance tint). */
function rockMaterial(tint: [number, number, number]): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTint = { value: new THREE.Vector3(...tint) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = uTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 veg;\nuniform vec3 uTint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb *= mix( vec3( 1.0 ), uTint, veg.y );');
  };
  mat.customProgramCacheKey = () => 'lifted-rock-v1';
  return mat;
}

function hexTint(t: [number, number, number]): string {
  return '#' + new THREE.Color(t[0] * 0.55, t[1] * 0.55, t[2] * 0.55).getHexString();
}

export class RockLift implements PlayInteraction {
  readonly kind = 'earth' as const;
  readonly facesAim = true;
  readonly moveFactor: number;
  /** Pivot at the rock's visual centre (position + rotation); the mesh hangs inside it. */
  private readonly pivot = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly spinAxis = new THREE.Vector3();
  private t = 0;
  private band: 'low' | 'mid' | 'high' = 'mid';
  private loop: LoopHandle | null = null;
  private crumbleT = 0;
  private released = false;
  private readonly holdDist: number;
  /** Swings around the bender (never through them); heavier stones answer more slowly. */
  private readonly follow: HeldFollow;
  private following = false;

  constructor(private readonly ctx: GameContext, private readonly player: Player, readonly ref: RockRef, geometry: THREE.BufferGeometry) {
    const s = ref.sxz;
    this.moveFactor = s > 1.3 ? 0.4 : 0.55;
    // Bigger rocks float further out and answer more slowly.
    this.holdDist = 2.0 + 1.25 * s;
    this.follow = new HeldFollow(7.5 / Math.sqrt(Math.max(0.5, s)));
    this.mat = rockMaterial(ref.tint);
    this.mesh = new THREE.Mesh(geometry, this.mat);
    this.mesh.name = 'lifted_rock';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.scale.set(s, ref.sy, s);
    this.mesh.position.set(0, -CENTER * ref.sy, 0);
    this.pivot.add(this.mesh);
    this.pivot.quaternion.setFromAxisAngle(UP, ref.yaw);
    this.start.set(ref.x, ref.y + CENTER * ref.sy, ref.z);
    this.pos.copy(this.start);
    this.pivot.position.copy(this.pos);
    ctx.vfx.group.add(this.pivot);
    this.spinAxis.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
    player.humanoid.animator.play('play_earth_lift', { fadeIn: 0.06 });
    // Torn out of the ground: dust, grit, a crack where it lay and a deep rumble.
    const base = tA.set(ref.x, ref.y + 0.05, ref.z);
    ctx.vfx.burst('dust', base, { count: Math.round(10 + s * 10), radius: s * 0.8, speed: 1.1 + s * 0.5 });
    ctx.vfx.burst('debris', base, { count: Math.round(5 + s * 5), color: hexTint(ref.tint) });
    debris(base, Math.round(5 + s * 6), { spread: 1.1, speed: 3 + s * 1.5, size: 0.06 + s * 0.06, radius: s * 0.4, color: hexTint(ref.tint), life: 1.4 });
    ctx.world.fx.crack(tB.set(ref.x, ctx.world.groundAt(ref.x, ref.z, ref.y + 1).y, ref.z), 0.5 + s * 0.6);
    ctx.world.fx.disturb(base, 1.5 + s, 0.6);
    ctx.audio.play('bend_earth_rise', { position: base, volume: Math.min(1, 0.45 + s * 0.3), pitch: 1.25 - Math.min(0.5, s * 0.25) });
    ctx.audio.play('bend_earth_crumble', { position: base, volume: 0.35 });
    if (s > 1.3) ctx.events.emit('camera:shake', { intensity: 0.12, duration: 0.25 });
    this.loop = ctx.audio.loop('bend_rumble_loop', { position: this.pos, volume: 0.07 + s * 0.04 });
  }

  update(dt: number): boolean {
    const ctx = this.ctx;
    const r = this.ref;
    this.t += dt;
    holdPoint(ctx, this.player, this.holdDist, 0.75 * r.sxz + 0.2, this.target);
    if (this.t < RISE) {
      // Rising: straight up out of its bed first, then over to the hold point.
      const k = this.t / RISE;
      const up = Math.min(1, k * 1.8);
      const over = Math.max(0, (k - 0.35) / 0.65);
      const e = over * over * (3 - 2 * over);
      const lift = this.start.y + (1 - (1 - up) * (1 - up)) * (0.8 + 0.4 * r.sy);
      this.pos.set(this.start.x + (this.target.x - this.start.x) * e, lift + (this.target.y - lift) * e, this.start.z + (this.target.z - this.start.z) * e);
      this.vel.set(0, 0, 0);
      // Grit trickles off the underside.
      this.crumbleT -= dt;
      if (this.crumbleT <= 0) {
        this.crumbleT = 0.08;
        debris(tA.copy(this.pos).setY(this.pos.y - 0.5 * r.sy), 1, { spread: 0.4, speed: 0.6, size: 0.05 + r.sxz * 0.03, radius: r.sxz * 0.5, color: hexTint(r.tint), life: 1.2 });
      }
    } else {
      const chestNow = this.player.castOrigin('chest', tB);
      if (!this.following) {
        this.following = true;
        this.follow.reset(chestNow, this.pos);
      }
      this.follow.update(chestNow, this.target, dt);
      this.pos.copy(this.follow.pos);
      this.vel.copy(this.follow.vel);
      // Hold pose follows the height.
      const chest = this.player.castOrigin('chest', tB);
      const band = holdBand(this.pos.y, chest.y, this.band);
      if (band !== this.band || !this.player.humanoid.animator.isPlaying(this.clipFor(band))) {
        this.band = band;
        if (!this.player.humanoid.animator.isPlaying('play_earth_lift')) this.player.humanoid.animator.play(this.clipFor(band), { fadeIn: 0.25 });
      }
      // Occasional grit falling from the floating stone.
      this.crumbleT -= dt;
      if (this.crumbleT <= 0) {
        this.crumbleT = 0.5 + Math.random() * 0.8;
        debris(tA.copy(this.pos).setY(this.pos.y - 0.5 * r.sy), 1, { spread: 0.3, speed: 0.3, size: 0.04 + r.sxz * 0.02, radius: r.sxz * 0.4, color: hexTint(r.tint), life: 1.2 });
      }
    }
    // A solid stone: slow turn, a tilt into its motion, a slight bob.
    const tilt = tA.set(this.vel.z, 0, -this.vel.x).multiplyScalar(0.05 / Math.sqrt(r.sxz));
    this.pivot.quaternion.multiply(tQ.setFromAxisAngle(this.spinAxis, dt * 0.35));
    if (tilt.lengthSq() > 1e-6) {
      const ang = Math.min(0.03, tilt.length() * dt * 2);
      this.pivot.quaternion.premultiply(tQ.setFromAxisAngle(tilt.normalize(), ang));
    }
    // Bending keeps it roughly upright: the tilt eases back once the motion stops.
    const up = tB.set(0, 1, 0).applyQuaternion(this.pivot.quaternion);
    this.pivot.quaternion.premultiply(tQ.setFromUnitVectors(up, UP).slerp(ID_Q, 1 - Math.min(1, dt * 0.9)));
    this.pivot.position.copy(this.pos).setY(this.pos.y + 0.04 * Math.sin(this.t * 1.9));
    this.loop?.setPosition(this.pos);
    // Too far from where it was lifted (walking away with it): let it go.
    return Math.hypot(this.pos.x - this.start.x, this.pos.z - this.start.z) < 28;
  }

  private clipFor(band: 'low' | 'mid' | 'high'): string {
    return band === 'high' ? 'play_earth_hold_high' : band === 'low' ? 'play_earth_hold_low' : 'play_earth_hold';
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    const ctx = this.ctx;
    const r = this.ref;
    const anim = this.player.humanoid.animator;
    anim.stop('play_earth_lift', 0.15);
    anim.stop(this.clipFor(this.band), 0.2);
    anim.play('play_earth_drop', { fadeIn: 0.08 });
    this.loop?.stop(0.3);
    this.loop = null;
    const pivot = this.pivot;
    const pos = this.pos.copy(pivot.position);
    const vel = this.vel.multiplyScalar(0.6);
    // Never onto the bender: nudge it out of their way.
    const p = this.player.position;
    const away = tA.set(pos.x - p.x, 0, pos.z - p.z);
    const minD = r.sxz * 0.9 + 0.6;
    if (away.length() < minD) {
      if (away.lengthSq() < 1e-6) away.set(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
      away.normalize();
      pos.x = p.x + away.x * minD;
      pos.z = p.z + away.z * minD;
    }
    const half = 0.62 * r.sy;
    let splashed = false;
    let t = 0;
    const veg = vegetation(ctx);
    const mesh = this.mesh;
    const mat = this.mat;
    let settled = false;
    addEffect({
      update: (dt) => {
        t += dt;
        vel.y -= 14 * dt;
        pos.addScaledVector(vel, dt);
        const w = ctx.world.liquidAt(pos.x, pos.z);
        if (w && !splashed && pos.y - half < w.level) {
          splashed = true;
          ctx.vfx.burst('splash', tB.set(pos.x, w.level, pos.z), { count: Math.round(10 + r.sxz * 10), speed: 1.2 + r.sxz });
          ctx.audio.play('water_splash', { position: pos, volume: 0.7 });
          vel.multiplyScalar(0.4);
        }
        const ground = ctx.world.groundAt(pos.x, pos.z, pos.y + half + 1).y;
        if (pos.y - half > ground && t < 5) {
          pivot.position.copy(pos);
          return true;
        }
        // Landed: settle a little into the ground, keep the heading, lose most of the tilt.
        pos.y = ground + half - 0.1 * r.sy;
        pivot.position.copy(pos);
        const fwd = tA.set(0, 0, 1).applyQuaternion(pivot.quaternion).setY(0);
        const yaw = fwd.lengthSq() > 1e-6 ? Math.atan2(fwd.x, fwd.z) : r.yaw;
        pivot.quaternion.slerp(tQ.setFromAxisAngle(UP, yaw), 0.75);
        const impact = Math.min(1, Math.abs(vel.y) / 9);
        const at = tB.set(pos.x, ground + 0.05, pos.z);
        if (!w) rockImpact(ctx, at, 0.35 + r.sxz * 0.45 * (0.4 + impact), hexTint(r.tint));
        ctx.audio.play('stone.impact', { position: at, volume: Math.min(1, 0.4 + r.sxz * 0.3 + impact * 0.3), pitch: 1.2 - Math.min(0.45, r.sxz * 0.22) });
        ctx.world.fx.disturb(at, 1.5 + r.sxz, 0.5 + impact * 0.5);
        if (r.sxz > 1.2 && impact > 0.4) ctx.events.emit('camera:shake', { intensity: 0.1 + 0.1 * impact, duration: 0.2 });
        // Back into the world at its new resting place (instance + collider).
        pivot.updateMatrixWorld(true);
        settled = !!veg && veg.returnRock(r, tM.copy(mesh.matrixWorld));
        return false;
      },
      dispose: () => {
        // Session ended mid-fall: the rock goes back where it was.
        if (!settled && veg) veg.returnRock(r);
        pivot.removeFromParent();
        mat.dispose();
      },
    });
  }

  dispose(): void {
    this.released = true;
    this.loop?.stop(0.1);
    this.loop = null;
    const anim = this.player.humanoid.animator;
    anim.stop('play_earth_lift', 0.1);
    anim.stop(this.clipFor(this.band), 0.1);
    vegetation(this.ctx)?.returnRock(this.ref);
    this.pivot.removeFromParent();
    this.mat.dispose();
  }

  debug(): Record<string, unknown> {
    const p = this.pivot.position;
    return {
      rock: { cell: this.ref.cell, index: this.ref.index, scale: +this.ref.sxz.toFixed(2) },
      rising: this.t < RISE,
      pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      start: [+this.start.x.toFixed(2), +this.start.y.toFixed(2), +this.start.z.toFixed(2)],
      band: this.band,
    };
  }
}
