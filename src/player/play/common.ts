import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Player } from '../Player';

/** The three playful interactions (Airbending has none). */
export type PlayKind = 'water' | 'earth' | 'fire';

/**
 * One running interaction (water orb, lifted rock, palm flame). The controller (ElementPlay)
 * owns at most one; release() hands the object to a self-finishing effect (a falling orb, a
 * settling rock, a dying flame) so the controller is free again at once.
 */
export interface PlayInteraction {
  readonly kind: PlayKind;
  /** Movement speed multiplier while held (1 = unrestricted). */
  readonly moveFactor: number;
  /** The bender turns to face the aim (water/earth) instead of the walking direction. */
  readonly facesAim: boolean;
  /** Advance while the input is held; false = it cannot continue (then it is released). */
  update(dt: number): boolean;
  /** Input released / interrupted: let go (falls, settles, fades) through a self-finishing effect. */
  release(): void;
  /** Remove at once without aftermath (session end): nothing may stay behind. */
  dispose(): void;
  debug(): Record<string, unknown>;
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

/** Camera ray starting at the bender's depth (the crosshair convention used by Player.updateAim). */
export function aimRay(ctx: GameContext, player: Player, origin: THREE.Vector3, dir: THREE.Vector3): void {
  ctx.camera.getWorldPosition(origin);
  ctx.camera.getWorldDirection(dir);
  const toPlayer = tA.copy(player.position).sub(origin).dot(dir);
  origin.addScaledVector(dir, Math.max(0, toPlayer - 0.6));
}

/**
 * Where a held object floats: `dist` metres in front of the chest along the camera heading.
 * Looking up raises it, looking down lowers it (camera pitch maps to height, the resting
 * camera keeps it at chest height); clamped above the ground or water surface and to a few
 * metres above the bender, and kept in front of walls.
 */
export function holdPoint(ctx: GameContext, player: Player, dist: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const dir = ctx.camera.getWorldDirection(tA);
  const flat = Math.hypot(dir.x, dir.z) || 1;
  const fx = dir.x / flat, fz = dir.z / flat;
  // Camera pitch: about -0.28 at rest (looking a little down), -1.2 straight down, +0.55 up.
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) + 0.28;
  const chest = player.castOrigin('chest', tB);
  const rise = pitch >= 0 ? pitch * 4.2 : pitch * 2.6;
  let x = chest.x + fx * dist, z = chest.z + fz * dist;
  // Never through a wall: stop short of the first thing between the chest and the spot.
  const to = tA.set(fx, 0, fz);
  const wall = ctx.world.raycast(chest, to, dist + radius);
  if (wall && wall.distance < dist + radius) {
    const d = Math.max(0.9, wall.distance - radius - 0.1);
    x = chest.x + fx * d;
    z = chest.z + fz * d;
  }
  const ground = ctx.world.groundAt(x, z, chest.y + 3).y;
  const water = ctx.world.liquidAt(x, z);
  const floor = Math.max(ground, water ? water.level : -Infinity) + radius + 0.1;
  const y = Math.min(Math.max(chest.y - 0.02 + rise, floor), player.position.y + 4.8);
  return out.set(x, Math.max(y, floor), z);
}

function spring1(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const e = Math.exp(-omega * dt);
  const dx = x - target;
  const tmp = (v + omega * dx) * dt;
  return [target + (dx + tmp) * e, (v - omega * tmp) * e];
}

/**
 * Follows a hold point the way a bent object should: it swings AROUND the bender (springs on
 * bearing, reach and height, so turning sweeps it along an arc instead of cutting through
 * the body), lagging a little behind quick turns. `vel` is the resulting world velocity.
 */
export class HeldFollow {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private az = 0;
  private azV = 0;
  private rad = 0;
  private radV = 0;
  private y = 0;
  private yV = 0;

  constructor(private readonly omega: number) {}

  /** Start from a world position (relative to the bender's chest). */
  reset(chest: THREE.Vector3, at: THREE.Vector3): void {
    this.az = Math.atan2(at.x - chest.x, at.z - chest.z);
    this.rad = Math.hypot(at.x - chest.x, at.z - chest.z);
    this.y = at.y;
    this.azV = this.radV = this.yV = 0;
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
  }

  update(chest: THREE.Vector3, target: THREE.Vector3, dt: number): void {
    if (dt <= 0) return;
    let d = Math.atan2(target.x - chest.x, target.z - chest.z) - this.az;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    [this.az, this.azV] = spring1(this.az, this.azV, this.az + d, this.omega, dt);
    [this.rad, this.radV] = spring1(this.rad, this.radV, Math.hypot(target.x - chest.x, target.z - chest.z), this.omega, dt);
    [this.y, this.yV] = spring1(this.y, this.yV, target.y, this.omega, dt);
    const x = chest.x + Math.sin(this.az) * this.rad, z = chest.z + Math.cos(this.az) * this.rad;
    this.vel.set((x - this.pos.x) / dt, (this.y - this.pos.y) / dt, (z - this.pos.z) / dt);
    this.pos.set(x, this.y, z);
  }
}

/** Arm pose to use for an object held at `y` relative to the chest (with hysteresis around the current one). */
export function holdBand(y: number, chestY: number, current: 'low' | 'mid' | 'high'): 'low' | 'mid' | 'high' {
  const d = y - chestY;
  if (current === 'high') return d < 0.95 ? (d < -0.75 ? 'low' : 'mid') : 'high';
  if (current === 'low') return d > -0.45 ? (d > 1.25 ? 'high' : 'mid') : 'low';
  return d > 1.25 ? 'high' : d < -0.75 ? 'low' : 'mid';
}
