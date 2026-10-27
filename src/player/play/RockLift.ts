import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext } from '../../core/GameContext';
import type { SurfaceType } from '../../core/types';
import { rockImpact } from '../../vfx/effects/earth';
import { addEffect, debris } from '../../vfx/effects/loop';
import type { EnvironmentSystem } from '../../world/env/EnvironmentSystem';
import type { RockRef, VegetationSystem } from '../../world/env/Vegetation';
import { createTerrainSample, sampleTerrain } from '../../world/Heightfield';
import type { Player } from '../Player';
import { aimRay, HeldFollow, holdBand, holdPoint, type PlayInteraction } from './common';
import { rockMaterial, type LooseStone, type LooseStones } from './Stones';

/**
 * Earthbending play: hold the attack and a rock rises in a burst of dust and grit, then floats
 * in front of the bender, following the aim (look up/down to raise/lower it), tilting with its
 * motion and turning slowly. Letting go drops it: it falls, lands with a thud and a dust cloud,
 * and stays where it fell.
 *
 * Which rock (findLiftTarget), in order:
 *  - the world's own rock under the crosshair (VegetationSystem.borrowRock: the instance and its
 *    collider are hidden while it is lifted and written back where it lands) or a loose stone
 *    set down earlier (LooseStones), with aim assist that widens with distance;
 *  - else one lying right in front of the bender (the camera easily looks over small stones);
 *  - else a stone torn out of the earth where the crosshair meets the ground in reach, or just
 *    in front of the bender: natural ground only (soil, grass, sand, rock, paving), never
 *    floors, decks, snow, ice or water. Once set down it stays as a loose stone.
 * Only rocks up to MAX_SCALE are liftable (no hill-sized boulders, never buildings).
 */

/** Liftable rock sizes (vegetation scale: small rocks 0.35–1.25, boulders 1.7–3.3). */
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.2;
/** Metres from the bender to a rock they may lift. */
const REACH = 13;
/** Aim assist: metres around a rock that still count as aiming at it, plus AIM_CONE per metre away. */
const AIM_SLACK = 0.45;
const AIM_CONE = 0.05;
/** A rock this close in front of the bender is taken even when the crosshair passes over it. */
const NEAR = 4.5;
/** Metres to the ground under the crosshair that a stone can be torn from. */
const GROUND_REACH = 9;
/** Ground a stone can be torn from: natural soil and rock, and the paving laid on it. */
const EARTH: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['grass', 'tallgrass', 'dirt', 'mud', 'gravel', 'sand', 'rock', 'stone', 'cobble', 'ash']);
/** Built floors (colliders) that count as earth: stone streets, plazas, courtyards, terraces. */
const PAVING: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['stone', 'cobble', 'rock', 'gravel', 'dirt']);
const PAVING_TINT: readonly [number, number, number] = [0.7, 0.67, 0.62];
/** Rising time (s). */
const RISE = 0.6;
/** The rock's visual centre sits this far (× height scale) above its placement point. */
const CENTER = 0.25;

const tO = new THREE.Vector3();
const tD = new THREE.Vector3();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const ID_Q = new THREE.Quaternion();
const ts = createTerrainSample();

type RockShape = Pick<RockRef, 'x' | 'y' | 'z' | 'yaw' | 'sxz' | 'sy' | 'tint'>;

/** What a hold lifts: a world rock, a loose stone set down earlier, or a stone torn from the ground. */
export type LiftTarget =
  | { source: 'rock'; rock: RockShape; ref: RockRef }
  | { source: 'stone'; rock: RockShape; stone: LooseStone }
  | { source: 'ground'; rock: RockShape };

function vegetation(ctx: GameContext): VegetationSystem | null {
  return (ctx.extra.get('environment') as EnvironmentSystem | undefined)?.vegetation ?? null;
}

/** In reach, not underfoot, and nothing solid between the chest and it (its own collider and bed don't count). */
function liftable(ctx: GameContext, player: Player, r: RockShape): boolean {
  const p = player.position;
  const flat = Math.hypot(r.x - p.x, r.z - p.z);
  if (flat > REACH + r.sxz) return false;
  if (flat < 0.8 * r.sxz + 0.35 && p.y > r.y + 0.3 * r.sy) return false;
  const chest = player.castOrigin('chest', tA);
  const to = tB.set(r.x, r.y + CENTER * r.sy, r.z).sub(chest);
  const d = to.length();
  if (d < 0.01) return true;
  const hit = ctx.world.raycast(chest, to.divideScalar(d), d);
  return !hit || hit.distance >= d - (0.9 * Math.max(r.sxz, 0.7 * r.sy) + 0.3);
}

/** A stone torn out of the earth at (x, z), or null where the ground is not earth or has no room. */
function earthAt(ctx: GameContext, player: Player, x: number, z: number): LiftTarget | null {
  const p = player.position;
  const g = ctx.world.groundAt(x, z, p.y + 2.5);
  // The earth itself, or built stone (city streets, plazas, terraces); never snow, ice,
  // water, lava, or wooden, plastered and metal floors.
  if (!EARTH.has(g.surface) || g.ny < 0.6 || Math.abs(g.y - p.y) > 2.5) return null;
  if (g.colliderId !== 0 && !PAVING.has(g.surface)) return null;
  const w = ctx.world.liquidAt(x, z);
  if (w && w.level > g.y - 0.05) return null;
  // Room for it to come up (not under a wall, a tree trunk or a boulder).
  if (ctx.world.collision.overlapSphere(tA.set(x, g.y + 0.6, z), 0.5)) return null;
  const chest = player.castOrigin('chest', tB);
  const to = tC.set(x, g.y + 0.3, z).sub(chest);
  const d = to.length();
  const hit = d > 0.01 ? ctx.world.raycast(chest, to.divideScalar(d), d) : null;
  if (hit && hit.distance < d - 0.6) return null;
  // Coloured like what it comes from: paving stone, or the soil (the world's rocks follow the same tint).
  const c = g.surface === 'stone' || g.surface === 'cobble' ? PAVING_TINT : sampleTerrain(x, z, g.y, 1 - g.ny, ts).soil;
  const sxz = 0.55 + Math.random() * 0.2;
  const j = (): number => 0.9 + Math.random() * 0.15;
  return { source: 'ground', rock: { x, y: g.y - 0.1, z, yaw: Math.random() * Math.PI * 2, sxz, sy: sxz * (0.75 + Math.random() * 0.2), tint: [c[0] * j(), c[1] * j(), c[2] * j()] } };
}

/** The rock a hold would lift right now (see the order above), or null (the press attacks). */
export function findLiftTarget(ctx: GameContext, player: Player, stones: LooseStones): LiftTarget | null {
  const veg = vegetation(ctx);
  if (!veg) return null;
  const p = player.position;
  aimRay(ctx, player, tO, tD);
  // Anything solid in front of a rock hides it (boulders' own colliders sit inside their sphere).
  const solid = ctx.world.raycast(tO, tD, 45);
  const maxD = Math.min(45, (solid ? solid.distance : 45) + 1.2);
  const ref = veg.pickRock(tO, tD, maxD, { minScale: MIN_SCALE, maxScale: MAX_SCALE, slack: AIM_SLACK, cone: AIM_CONE });
  const st = stones.pick(tO, tD, maxD, AIM_SLACK, AIM_CONE);
  const stoneFirst = !!st && (!ref || st.distance < ref.distance);
  if (st && stoneFirst && liftable(ctx, player, st.stone)) return { source: 'stone', rock: st.stone, stone: st.stone };
  if (ref && liftable(ctx, player, ref)) return { source: 'rock', rock: ref, ref };
  if (st && !stoneFirst && liftable(ctx, player, st.stone)) return { source: 'stone', rock: st.stone, stone: st.stone };
  // One lying right in front of the bender.
  const flat = Math.hypot(tD.x, tD.z);
  const fx = flat > 1e-3 ? tD.x / flat : Math.sin(player.yaw);
  const fz = flat > 1e-3 ? tD.z / flat : Math.cos(player.yaw);
  const ahead = (r: RockShape): boolean => {
    const dx = r.x - p.x, dz = r.z - p.z;
    const d = Math.hypot(dx, dz);
    return d - 0.9 * r.sxz <= NEAR && (d < 0.5 || (dx * fx + dz * fz) / d > 0.4) && liftable(ctx, player, r);
  };
  const ns = stones.nearest(p.x, p.z, NEAR + 1, ahead);
  const nr = veg.nearestRock(p.x, p.z, NEAR + MAX_SCALE, { minScale: MIN_SCALE, maxScale: MAX_SCALE, accept: ahead });
  if (ns && (!nr || Math.hypot(ns.x - p.x, ns.z - p.z) < nr.distance)) return { source: 'stone', rock: ns, stone: ns };
  if (nr) return { source: 'rock', rock: nr, ref: nr };
  // Otherwise tear one out of the ground: where the crosshair meets open ground in reach…
  if (solid && solid.colliderId === 0) {
    const d = Math.hypot(solid.point.x - p.x, solid.point.z - p.z);
    const t = d >= 1.4 && d <= GROUND_REACH ? earthAt(ctx, player, solid.point.x, solid.point.z) : null;
    if (t) return t;
  }
  // …or just in front of the bender, along the camera heading.
  for (const d of [2.6, 1.9]) {
    const t = earthAt(ctx, player, p.x + fx * d, p.z + fz * d);
    if (t) return t;
  }
  return null;
}

/** Take the target out of the world and start lifting it (null: it is gone, the press attacks instead). */
export function liftRock(ctx: GameContext, player: Player, target: LiftTarget, stones: LooseStones): RockLift | null {
  const veg = vegetation(ctx);
  const geo = veg?.rockGeometry();
  if (!veg || !geo) return null;
  if (target.source === 'rock' && !veg.borrowRock(target.ref)) return null;
  if (target.source === 'stone' && !stones.take(target.stone)) return null;
  return new RockLift(ctx, player, target, geo, stones);
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
  private readonly r: RockShape;
  /** How far below the surface it starts (a stone torn out of the ground breaks through it). */
  private readonly depth: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly player: Player,
    readonly lift: LiftTarget,
    private readonly geometry: THREE.BufferGeometry,
    private readonly stones: LooseStones,
  ) {
    const r = (this.r = lift.rock);
    const s = r.sxz;
    this.moveFactor = s > 1.3 ? 0.4 : 0.55;
    // Bigger rocks float further out and answer more slowly.
    this.holdDist = 2.0 + 1.25 * s;
    this.follow = new HeldFollow(7.5 / Math.sqrt(Math.max(0.5, s)));
    this.mat = rockMaterial(r.tint);
    this.mesh = new THREE.Mesh(geometry, this.mat);
    this.mesh.name = 'lifted_rock';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.scale.set(s, r.sy, s);
    this.mesh.position.set(0, -CENTER * r.sy, 0);
    this.pivot.add(this.mesh);
    this.pivot.quaternion.setFromAxisAngle(UP, r.yaw);
    this.start.set(r.x, r.y + CENTER * r.sy, r.z);
    if (lift.source === 'stone') {
      // As it lies, tilted the way it landed.
      lift.stone.mesh.matrix.decompose(tA, this.pivot.quaternion, tB);
      this.start.set(0, CENTER, 0).applyMatrix4(lift.stone.mesh.matrix);
    }
    this.depth = lift.source === 'ground' ? 0.75 * r.sy : 0;
    this.start.y -= this.depth;
    this.pos.copy(this.start);
    this.pivot.position.copy(this.pos);
    ctx.vfx.group.add(this.pivot);
    this.spinAxis.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
    player.humanoid.animator.play('play_earth_lift', { fadeIn: 0.06 });
    // Torn out of the ground: dust, grit, a crack where it lay and a deep rumble.
    const torn = lift.source === 'ground' ? 1.35 : 1;
    const base = tA.set(r.x, r.y + 0.05, r.z);
    ctx.vfx.burst('dust', base, { count: Math.round((10 + s * 10) * torn), radius: s * 0.8, speed: 1.1 + s * 0.5 });
    ctx.vfx.burst('debris', base, { count: Math.round((5 + s * 5) * torn), color: hexTint(r.tint) });
    debris(base, Math.round((5 + s * 6) * torn), { spread: 1.1, speed: 3 + s * 1.5, size: 0.06 + s * 0.06, radius: s * 0.4, color: hexTint(r.tint), life: 1.4 });
    ctx.world.fx.crack(tB.set(r.x, ctx.world.groundAt(r.x, r.z, r.y + 1).y, r.z), (0.5 + s * 0.6) * torn);
    ctx.world.fx.disturb(base, 1.5 + s, 0.6);
    ctx.audio.play('bend_earth_rise', { position: base, volume: Math.min(1, 0.45 + s * 0.3), pitch: 1.25 - Math.min(0.5, s * 0.25) });
    ctx.audio.play('bend_earth_crumble', { position: base, volume: 0.35 });
    if (s > 1.3) ctx.events.emit('camera:shake', { intensity: 0.12, duration: 0.25 });
    this.loop = ctx.audio.loop('bend_rumble_loop', { position: this.pos, volume: 0.07 + s * 0.04 });
  }

  update(dt: number): boolean {
    const ctx = this.ctx;
    const r = this.r;
    this.t += dt;
    holdPoint(ctx, this.player, this.holdDist, 0.75 * r.sxz + 0.2, this.target);
    if (this.t < RISE) {
      // Rising: straight up out of its bed first, then over to the hold point.
      const k = this.t / RISE;
      const up = Math.min(1, k * 1.8);
      const over = Math.max(0, (k - 0.35) / 0.65);
      const e = over * over * (3 - 2 * over);
      const lift = this.start.y + (1 - (1 - up) * (1 - up)) * (0.8 + 0.4 * r.sy + this.depth);
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
    const r = this.r;
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
        // Back into the world at its new resting place.
        pivot.updateMatrixWorld(true);
        settled = this.settle(tM.copy(mesh.matrixWorld));
        return false;
      },
      dispose: () => {
        // Session ended mid-fall: the rock goes back where it was.
        if (!settled) this.restore();
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
    this.restore();
    this.pivot.removeFromParent();
    this.mat.dispose();
  }

  /**
   * Into the world where it landed (`matrix`: rock-local → world): a world rock gets its
   * instance and collider back there, a stone stays as a loose stone that can be lifted again.
   */
  private settle(matrix: THREE.Matrix4): boolean {
    const l = this.lift;
    if (l.source === 'rock') return !!vegetation(this.ctx)?.returnRock(l.ref, matrix);
    if (l.source === 'stone') return this.stones.put(l.stone, matrix);
    this.stones.add(this.geometry, matrix, l.rock.sxz, l.rock.sy, l.rock.tint);
    return true;
  }

  /** Never set down (session end): world rocks and loose stones are back where they were. */
  private restore(): void {
    const l = this.lift;
    if (l.source === 'rock') vegetation(this.ctx)?.returnRock(l.ref);
    else if (l.source === 'stone') this.stones.put(l.stone);
  }

  debug(): Record<string, unknown> {
    const p = this.pivot.position;
    return {
      rock: { source: this.lift.source, scale: +this.r.sxz.toFixed(2) },
      rising: this.t < RISE,
      pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      start: [+this.start.x.toFixed(2), +this.start.y.toFixed(2), +this.start.z.toFixed(2)],
      band: this.band,
    };
  }
}
