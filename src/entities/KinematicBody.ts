import * as THREE from 'three';
import type { SurfaceType } from '../core/types';

/** World queries a body needs (implemented by World). */
export interface PhysicsWorld {
  /** Highest ground (terrain, frozen water, walkable collider) at or below maxY. */
  groundAt(x: number, z: number, maxY: number): { y: number; surface: SurfaceType; ny: number; nx: number; nz: number; colliderId: number };
  /** Liquid water surface above terrain, if any. */
  liquidAt(x: number, z: number): { level: number } | null;
  resolveWalls(pos: THREE.Vector3, radius: number, height: number, stepUp: number): boolean;
}

const MAX_WALK_SLOPE_NY = Math.cos((50 * Math.PI) / 180);

/**
 * Character-style kinematic body: gravity, ground snapping (terrain + walkable
 * colliders), wall sliding, steep-slope sliding, swimming, knockback impulses.
 *
 * Controllers write `move` (desired horizontal velocity) each frame; external
 * forces go through impulse()/launch() and decay with friction.
 */
export class KinematicBody {
  readonly velocity = new THREE.Vector3();
  /** Desired horizontal velocity from the controller/AI (m/s). */
  readonly move = new THREE.Vector3();
  /** Decaying external velocity (knockback, wind, explosions). */
  readonly external = new THREE.Vector3();
  grounded = false;
  groundY = 0;
  surface: SurfaceType = 'dirt';
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  groundColliderId = 0;
  gravity = 24;
  gravityScale = 1;
  stepUp = 0.5;
  /** Max fall speed (m/s). */
  terminal = 45;
  inWater = false;
  waterDepth = 0;
  swimming = false;
  sliding = false;
  /** Seconds since leaving the ground (for coyote time). */
  airTime = 0;
  /** Vertical speed at the last landing (for landing impacts / footprints). */
  lastLandingSpeed = 0;
  justLanded = false;
  /** Disable gravity & ground (flying mounts, cinematic). */
  kinematic = false;
  /** Whether this body can swim (otherwise treated as wading / sinking slowly). */
  canSwim = true;
  readonly prevPosition = new THREE.Vector3();

  constructor(public radius = 0.35, public height = 1.75) {}

  impulse(x: number, y: number, z: number): void {
    this.external.x += x;
    this.external.z += z;
    if (y !== 0) this.launch(y);
  }

  launch(vy: number): void {
    this.velocity.y = Math.max(this.velocity.y, vy);
    this.grounded = false;
  }

  /** Teleport and clear motion. */
  place(pos: THREE.Vector3, target: THREE.Vector3): void {
    target.copy(pos);
    this.prevPosition.copy(pos);
    this.velocity.set(0, 0, 0);
    this.external.set(0, 0, 0);
    this.move.set(0, 0, 0);
  }

  step(dt: number, pos: THREE.Vector3, world: PhysicsWorld): void {
    this.prevPosition.copy(pos);
    this.justLanded = false;
    if (this.kinematic) {
      pos.addScaledVector(this.velocity, dt);
      return;
    }
    // External velocity friction.
    const fr = this.grounded ? 7 : 1.2;
    const decay = Math.exp(-fr * dt);
    this.external.x *= decay;
    this.external.z *= decay;
    if (Math.abs(this.external.x) < 0.01) this.external.x = 0;
    if (Math.abs(this.external.z) < 0.01) this.external.z = 0;

    this.velocity.x = this.move.x + this.external.x;
    this.velocity.z = this.move.z + this.external.z;

    if (!this.grounded || this.velocity.y > 0) {
      const g = this.gravity * this.gravityScale * (this.swimming ? 0.15 : 1);
      this.velocity.y = Math.max(-this.terminal, this.velocity.y - g * dt);
    }

    // Substep to avoid tunnelling through thin walls.
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    const steps = Math.min(8, Math.max(1, Math.ceil((speed * dt) / (this.radius * 0.9))));
    const sdt = dt / steps;
    let landed = false;
    for (let i = 0; i < steps; i++) {
      pos.x += this.velocity.x * sdt;
      pos.z += this.velocity.z * sdt;
      pos.y += this.velocity.y * sdt;
      world.resolveWalls(pos, this.radius, this.height, this.stepUp);
      const wasGrounded = this.grounded;
      const g = world.groundAt(pos.x, pos.z, pos.y + this.stepUp);
      const snap = wasGrounded && this.velocity.y <= 0.01 ? 0.45 : 0.02;
      if (pos.y <= g.y + snap) {
        if (!wasGrounded && this.velocity.y < 0) {
          this.lastLandingSpeed = -this.velocity.y;
          landed = true;
        }
        pos.y = g.y;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.grounded = true;
        this.groundY = g.y;
        this.surface = g.surface;
        this.groundNormal.set(g.nx, g.ny, g.nz);
        this.groundColliderId = g.colliderId;
      } else {
        this.grounded = false;
      }
    }
    if (landed) this.justLanded = true;

    // Steep slopes: slide down.
    this.sliding = false;
    if (this.grounded && this.groundNormal.y < MAX_WALK_SLOPE_NY && this.groundColliderId === 0) {
      this.sliding = true;
      const n = this.groundNormal;
      this.external.x += n.x * 14 * dt;
      this.external.z += n.z * 14 * dt;
    }

    // Water.
    const w = world.liquidAt(pos.x, pos.z);
    this.inWater = !!w && w.level > pos.y + 0.05;
    this.waterDepth = w ? Math.max(0, w.level - pos.y) : 0;
    this.swimming = this.canSwim && this.waterDepth > this.height * 0.62;
    if (this.swimming && w) {
      // Float with shoulders at the surface.
      const target = w.level - this.height * 0.62;
      if (pos.y < target) {
        pos.y += Math.min(target - pos.y, 3 * dt);
        if (this.velocity.y < 0) this.velocity.y *= 0.5;
      }
      this.grounded = false;
    }
    this.airTime = this.grounded || this.swimming ? 0 : this.airTime + dt;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
