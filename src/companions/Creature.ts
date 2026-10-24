import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { KinematicBody } from '../entities/KinematicBody';
import type { SurfaceType } from '../core/types';
import type { SpeciesDef } from '../data/creatures';
import { defaultAnim, type AnimInput, type CreatureAction, type CreatureModel } from './models/CreatureModel';
import { createModel } from './models';

/**
 * A living creature in the world: wild habitat member, ambient wildlife or a
 * bonded companion. Owns its procedural model, a kinematic body and a small,
 * robust behaviour state machine. Scripted sequences (taming challenges, the
 * dragon's test, riding) take over through `state = 'scripted' | 'ridden'`
 * and the steering API (steer / flyTo / stopMoving).
 *
 * Movement rules: animals move along their facing (no strafing), turn at the
 * species turn rate, probe ahead for slopes / deep water / walls and steer
 * around them, keep flyers above terrain, and recover when stuck (detour,
 * hop, take-off, and as a last resort an off-screen relocation).
 */

export type CreatureMode = 'wild' | 'ambient' | 'companion';
export type BrainState =
  | 'idle'
  | 'graze'
  | 'wander'
  | 'rest'
  | 'investigate'
  | 'wary'
  | 'flee'
  | 'defend'
  | 'home'
  | 'trapped'
  | 'injured'
  | 'burrowed'
  | 'follow'
  | 'arrive'
  | 'leave'
  | 'perch'
  | 'scripted'
  | 'ridden';

const DEFORMABLE = new Set<SurfaceType>(['snow', 'sand', 'mud', 'ash', 'dirt']);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Small deterministic PRNG (habitat spawns, wander choices per individual). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export interface CreatureGroup {
  id: string;
  members: Creature[];
  /** Shared grazing / gathering point. */
  readonly center: THREE.Vector3;
  retarget: number;
}

export class Creature extends Entity {
  readonly kind = 'creature' as const;
  readonly def: SpeciesDef;
  readonly model: CreatureModel;
  readonly anim: AnimInput = defaultAnim();
  readonly uid: string;
  mode: CreatureMode;
  state: BrainState = 'idle';
  stateT = 0;
  stateDur = 3;
  readonly home = new THREE.Vector3();
  leash = 60;
  group: CreatureGroup | null = null;
  /** Bonded record id (companions). */
  companionId: string | null = null;
  scale: number;
  variant: number;
  /** Current horizontal speed (m/s) along facing. */
  speed = 0;
  /** Desired heading / speed (set by AI or rider). */
  wantYaw = 0;
  wantSpeed = 0;
  /** Flight. */
  flying = false;
  /** Absolute target altitude while flying (NaN = hold). */
  wantAlt = NaN;
  /** Manual climb input (-1..1) for riders; overrides wantAlt when non-zero. */
  climbInput = 0;
  vy = 0;
  /** Wants to land when flying (AI). */
  landing = false;
  /** Disable obstacle probing (riders steer themselves). */
  autoAvoid = true;
  /** Pass through walls (badgermole burrowing). */
  phaseWalls = false;
  /** Rider speed multiplier (perks, bond responsiveness). */
  turnMul = 1;
  readonly target = new THREE.Vector3();
  hasTarget = false;
  /** Seconds the creature has failed to make progress. */
  stuckT = 0;
  stuckCount = 0;
  /** Number of stuck recoveries performed (debug / tests). */
  recoveries = 0;
  /** Temporary detour point (stuck recovery) — the goal target is kept. */
  private readonly detour = new THREE.Vector3();
  private detourT = 0;
  private readonly progressAt = new THREE.Vector3();
  private progressT = 0;
  private probeT = 0;
  private avoidOffset = 0;
  private lastYaw = 0;
  /** Fear 0..1 (wild); decays over time. */
  fear = 0;
  /** Fed / interacted recently — used for "happy" reactions. */
  happyT = 0;
  /** Calls / ambient sounds. */
  private callT = 4 + Math.random() * 10;
  private footT = 0;
  readonly rand: () => number;
  private ctxRef: GameContext;
  /** Hook used by the companion system (taming, discovery, scripted states). */
  onThink: ((c: Creature, dt: number) => void) | null = null;
  /** Called when the creature would be "defeated" (companions retreat instead). */
  onExhausted: ((c: Creature) => void) | null = null;
  /** Overrides the model action (taming poses, scripted moments). */
  forcedAction: CreatureAction | null = null;
  /** Point the head tracks (null = player when relevant). */
  lookAt: THREE.Vector3 | null = null;

  constructor(ctx: GameContext, def: SpeciesDef, uid: string, opts: { mode: CreatureMode; variant?: number; scale?: number; seed?: number }) {
    super();
    this.ctxRef = ctx;
    this.def = def;
    this.uid = uid;
    this.mode = opts.mode;
    this.variant = opts.variant ?? 0;
    this.scale = opts.scale ?? 1;
    this.rand = rng(opts.seed ?? Math.floor(Math.random() * 1e9));
    const q = ctx.settings.data.graphics.preset as string;
    const detail = q === 'low' ? 0.6 : q === 'medium' ? 0.8 : 1;
    const model = createModel(def.id, this.variant, detail, this.scale);
    if (!model) throw new Error(`[Creature] no model for ${def.id}`);
    this.model = model;
    this.model.setShadows(ctx.settings.data.graphics.shadows !== 'off' && def.size.length > 1.2);
    this.root.add(this.model.root);
    this.name = def.name;
    this.radius = Math.max(0.2, def.radius * this.scale);
    this.height = def.size.height * this.scale;
    this.team = opts.mode === 'companion' ? 'ally' : 'wildlife';
    this.tags.add('creature');
    this.tags.add(def.id);
    this.health = new Health(def.hp * (opts.mode === 'companion' ? 1 : 0.6), 60, 20);
    const body = new KinematicBody(Math.min(this.radius, 2.2), this.height);
    body.stepUp = def.stepUp * Math.max(0.6, this.scale);
    body.canSwim = def.canSwim || def.locomotion === 'amphibious' || def.locomotion === 'swimmer';
    this.body = body;
    this.model.onFootfall = (side, heavy) => this.footfall(side, heavy);
  }

  get ctx(): GameContext {
    return this.ctxRef;
  }

  get isFlyer(): boolean {
    return this.def.flying;
  }

  get forward(): THREE.Vector3 {
    return tmpV2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Chest height point (aim / prompts). */
  override aimPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.root.position).setY(this.root.position.y + this.height * 0.55);
  }

  placeAt(pos: THREE.Vector3, yaw = this.yaw): void {
    this.body!.place(pos, this.root.position);
    this.yaw = yaw;
    this.wantYaw = yaw;
    this.lastYaw = yaw;
    this.root.rotation.y = yaw;
    this.progressAt.copy(pos);
    this.progressT = 0;
    this.stuckT = 0;
  }

  setState(s: BrainState, dur = 3): void {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
      this.anim.actionT = 0;
    }
    this.stateDur = dur;
  }

  // ------------------------------------------------------------------ steering

  /** Walk/run/fly toward a point at `speed`. */
  moveTo(x: number, z: number, speed: number): void {
    this.target.set(x, 0, z);
    this.hasTarget = true;
    this.wantSpeed = speed;
  }

  /** Steer along a world direction (riders). */
  steer(yaw: number, speed: number): void {
    this.hasTarget = false;
    this.wantYaw = yaw;
    this.wantSpeed = speed;
  }

  stopMoving(): void {
    this.hasTarget = false;
    this.wantSpeed = 0;
  }

  takeOff(alt?: number): void {
    if (!this.isFlyer) return;
    this.flying = true;
    this.landing = false;
    this.body!.kinematic = true;
    this.body!.velocity.set(0, 0, 0);
    this.vy = Math.max(this.vy, 2);
    const g = this.groundY(this.root.position.x, this.root.position.z);
    this.wantAlt = alt ?? g + 18 + this.height * 2;
  }

  land(): void {
    if (this.flying) this.landing = true;
  }

  /** Terrain / walkable ground / water surface (whichever is higher) below a point. */
  groundY(x: number, z: number, maxY = Infinity): number {
    const w = this.ctx.world;
    const g = w.groundAt(x, z, maxY).y;
    const l = w.liquidAt(x, z);
    return l ? Math.max(g, l.level) : g;
  }

  /**
   * Can this creature stand/walk at (x, z) coming from height y?
   * Checks slope, step height, deep water (non-swimmers) and solid colliders.
   */
  passable(x: number, z: number, fromY: number, dist: number): boolean {
    const d = this.def;
    const w = this.ctx.world;
    const g = w.groundAt(x, z, fromY + this.body!.stepUp + 1.5);
    const water = w.liquidAt(x, z);
    const depth = water ? water.level - g.y : 0;
    if (d.locomotion === 'swimmer') return !!water && depth > 1.2;
    if (g.colliderId === 0 && g.ny < d.maxSlopeNy && !(water && depth > 0.5)) return false;
    const rise = g.y - fromY;
    if (rise > Math.max(this.body!.stepUp, dist * 0.9)) return false;
    if (rise < -Math.max(4, dist * 1.4) && !this.flying) return false; // cliff drop
    if (water && depth > d.wadeDepth * this.scale && !this.body!.canSwim) return false;
    if (!this.phaseWalls && dist > 0.5) {
      tmpV.copy(this.root.position).setY(fromY + Math.min(this.height * 0.5, 1.2));
      const dir = new THREE.Vector3(x - this.root.position.x, 0, z - this.root.position.z);
      const len = dir.length();
      if (len > 0.01) {
        dir.multiplyScalar(1 / len);
        const hit = w.raycast(tmpV, dir, len + this.radius);
        if (hit && hit.colliderId !== 0) return false;
      }
    }
    return true;
  }

  private chooseHeading(desired: number, speed: number): number {
    if (!this.autoAvoid || speed < 0.05) return desired;
    this.probeT -= 1;
    if (this.probeT > 0) return desired + this.avoidOffset;
    this.probeT = 6; // re-probe every few frames
    const pos = this.root.position;
    const look = Math.max(this.radius * 1.6 + 1, Math.min(10, speed * 0.9));
    const offsets = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, Math.PI];
    // Prefer continuing the current detour side first.
    if (this.avoidOffset !== 0) offsets.splice(1, 0, this.avoidOffset);
    for (const o of offsets) {
      const a = desired + o;
      const x = pos.x + Math.sin(a) * look, z = pos.z + Math.cos(a) * look;
      if (this.flying || this.passable(x, z, pos.y, look)) {
        this.avoidOffset = o;
        return a;
      }
    }
    this.avoidOffset = 0;
    return desired + Math.PI;
  }

  /** Integrate locomotion for one step (ground, swim or flight). */
  locomote(dt: number): void {
    const body = this.body!;
    const pos = this.root.position;
    const d = this.def;
    const sf = this.speedFactor;
    if (this.detourT > 0) {
      this.detourT -= dt;
      const dx = this.detour.x - pos.x, dz = this.detour.z - pos.z;
      if (Math.hypot(dx, dz) < Math.max(1, this.radius)) this.detourT = 0;
      else {
        this.wantYaw = Math.atan2(dx, dz);
        this.wantSpeed = Math.max(this.wantSpeed, d.walk);
      }
    } else if (this.hasTarget) {
      const dx = this.target.x - pos.x, dz = this.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const arrive = Math.max(0.6, this.radius * 0.8);
      if (dist < arrive) {
        this.hasTarget = false;
        this.wantSpeed = 0;
      } else {
        this.wantYaw = Math.atan2(dx, dz);
        // Brake for arrival: never faster than the speed it can still stop from (v = sqrt(2·a·d)).
        const decel = (this.flying ? 2.6 : 1) * d.accel * 2.2 * Math.max(1, this.turnMul);
        const vmax = Math.sqrt(2 * decel * Math.max(0, dist - arrive)) * 0.9;
        this.wantSpeed = Math.min(this.wantSpeed, Math.max(d.walk * 0.5, vmax));
      }
    }
    const desired = this.wantSpeed > 0.05 ? this.chooseHeading(this.wantYaw, this.wantSpeed) : this.yaw;
    const turnRate = (this.flying && d.fly ? d.fly.turn : d.turn) * this.turnMul * (this.scale < 0.8 ? 1.4 : 1);
    const diff = angleDiff(this.yaw, desired);
    const maxTurn = turnRate * dt * (this.speed < 0.5 ? 1.6 : 1);
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    // Speed: accelerate toward want (slower while turning sharply).
    let want = this.wantSpeed * sf * (Math.abs(diff) > 1.4 && !this.flying ? 0.35 : 1);
    if (body.swimming && !this.flying && d.locomotion !== 'swimmer') want = Math.min(want, Math.max(d.swimSpeed, 1));
    const acc = (this.flying ? 2.6 : 1) * d.accel * (want < this.speed ? 2.2 : 1) * Math.max(1, this.turnMul);
    this.speed += Math.max(-acc * dt, Math.min(acc * dt, want - this.speed));
    if (Math.abs(this.speed) < 0.01) this.speed = 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);

    if (this.flying) this.flyStep(dt, fx, fz);
    else if (d.locomotion === 'swimmer') this.swimStep(dt, fx, fz);
    else {
      body.kinematic = false;
      body.move.set(fx * this.speed, 0, fz * this.speed);
      if (this.phaseWalls) {
        // Burrowing: move under walls (no wall resolution), stay on terrain.
        pos.x += fx * this.speed * dt;
        pos.z += fz * this.speed * dt;
        const g = this.ctx.world.heightAt(pos.x, pos.z);
        pos.y = g;
        body.grounded = true;
        body.velocity.set(0, 0, 0);
      } else body.step(dt, pos, this.ctx.world);
      // Refuse deep water for non-swimmers (riders included): back out.
      if (!body.canSwim && body.waterDepth > d.wadeDepth * this.scale) {
        pos.x -= fx * this.speed * dt * 1.2;
        pos.z -= fz * this.speed * dt * 1.2;
        this.speed = 0;
      }
    }
    const turn = angleDiff(this.lastYaw, this.yaw) / Math.max(1e-3, dt);
    this.lastYaw = this.yaw;
    this.root.rotation.y = this.yaw;
    this.anim.turn = THREE.MathUtils.lerp(this.anim.turn, turn, Math.min(1, dt * 6));
    this.trackProgress(dt);
  }

  private flyStep(dt: number, fx: number, fz: number): void {
    const body = this.body!;
    const pos = this.root.position;
    const f = this.def.fly!;
    body.kinematic = true;
    const ahead = Math.max(6, this.speed * 2.2);
    const gHere = this.groundY(pos.x, pos.z);
    const gAhead = Math.max(this.groundY(pos.x + fx * ahead, pos.z + fz * ahead), this.groundY(pos.x + fx * ahead * 0.5, pos.z + fz * ahead * 0.5));
    const clearance = this.landing ? 0 : Math.max(2.5, this.height * 0.9);
    const floor = Math.max(gHere, gAhead) + clearance;
    const ceiling = Math.min(gHere + 320, 760);
    let wantVy: number;
    if (this.landing) {
      wantVy = -Math.min(f.descend, Math.max(1.5, (pos.y - gHere) * 0.8));
    } else if (this.climbInput !== 0) {
      wantVy = this.climbInput > 0 ? f.climb * this.climbInput : f.descend * this.climbInput;
    } else if (!Number.isNaN(this.wantAlt)) {
      wantVy = THREE.MathUtils.clamp((this.wantAlt - pos.y) * 0.9, -f.descend, f.climb);
    } else wantVy = 0;
    // Terrain avoidance always wins.
    if (!this.landing && pos.y < floor) wantVy = Math.max(wantVy, Math.min(f.climb * 1.6, (floor - pos.y) * 2 + 2));
    if (pos.y > ceiling) wantVy = Math.min(wantVy, -1);
    this.vy += THREE.MathUtils.clamp(wantVy - this.vy, -f.climb * 2 * dt, f.climb * 2 * dt);
    pos.x += fx * this.speed * dt;
    pos.z += fz * this.speed * dt;
    pos.y += this.vy * dt;
    // Buildings / colliders.
    this.ctx.world.resolveWalls(pos, Math.min(this.radius, 2.2), Math.min(this.height, 3), 0.2);
    const minY = this.groundY(pos.x, pos.z, pos.y + 2);
    if (pos.y < minY) {
      pos.y = minY;
      if (this.vy < 0) this.vy = 0;
    }
    body.velocity.set(fx * this.speed, this.vy, fz * this.speed);
    // Touchdown.
    if (this.landing && pos.y - minY < 0.35) {
      this.flying = false;
      this.landing = false;
      this.wantAlt = NaN;
      this.vy = 0;
      body.kinematic = false;
      body.velocity.set(0, 0, 0);
      body.grounded = true;
      pos.y = minY;
      this.speed = Math.min(this.speed, this.def.run);
    }
  }

  private swimStep(dt: number, fx: number, fz: number): void {
    const pos = this.root.position;
    const body = this.body!;
    body.kinematic = true;
    const nx = pos.x + fx * this.speed * dt, nz = pos.z + fz * this.speed * dt;
    const w = this.ctx.world.liquidAt(nx, nz);
    const g = this.ctx.world.heightAt(nx, nz);
    if (w && w.level - g > 1.2) {
      pos.x = nx;
      pos.z = nz;
      pos.y = THREE.MathUtils.lerp(pos.y, w.level - this.height * 0.45, Math.min(1, dt * 3));
    } else this.speed *= 0.5;
    body.swimming = true;
    body.inWater = true;
  }

  private trackProgress(dt: number): void {
    const moving = this.wantSpeed > 0.4 && (this.hasTarget || this.state === 'ridden' || this.state === 'follow');
    this.progressT += dt;
    if (!moving) {
      this.progressT = 0;
      this.progressAt.copy(this.root.position);
      this.stuckT = Math.max(0, this.stuckT - dt);
      return;
    }
    if (this.progressT >= 1.5) {
      const moved = Math.hypot(this.root.position.x - this.progressAt.x, this.root.position.z - this.progressAt.z) + Math.abs(this.root.position.y - this.progressAt.y) * 0.5;
      const expected = Math.max(0.4, this.wantSpeed * 1.5 * 0.2);
      if (moved < expected) this.stuckT += this.progressT;
      else {
        this.stuckT = 0;
        this.stuckCount = 0;
      }
      this.progressT = 0;
      this.progressAt.copy(this.root.position);
    }
  }

  /**
   * Stuck recovery: called by AI when stuckT is high. Escalates: detour →
   * hop / take-off → relocation near `toward` (only if off-screen or far).
   */
  recoverStuck(toward: THREE.Vector3, visible: boolean): void {
    this.stuckCount++;
    this.stuckT = 0;
    this.recoveries++;
    const pos = this.root.position;
    if (this.stuckCount === 1) {
      // Detour: back off at an angle, then resume the goal.
      const a = this.yaw + Math.PI + (this.rand() < 0.5 ? 0.9 : -0.9);
      this.detour.set(pos.x + Math.sin(a) * (4 + this.radius * 2), 0, pos.z + Math.cos(a) * (4 + this.radius * 2));
      this.detourT = 4;
      this.avoidOffset = 0;
      return;
    }
    if (this.stuckCount === 2) {
      if (this.isFlyer && this.state !== 'ridden') this.takeOff();
      else if (this.body!.grounded && !this.flying) this.body!.launch(Math.max(4, this.def.jump || 5));
      return;
    }
    if (!visible || pos.distanceTo(toward) > 60 || this.stuckCount >= 4) {
      const spot = this.findStandSpot(toward.x, toward.z, 3 + this.radius * 2, 18);
      if (spot) {
        this.placeAt(spot, this.yaw);
        this.flying = false;
        this.body!.kinematic = false;
      }
      this.stuckCount = 0;
    }
  }

  /** Roughly inside the camera view (relocations only happen off-screen). */
  onScreen(): boolean {
    if (this.distToPlayer > 160) return false;
    const v = tmpV.copy(this.root.position).setY(this.root.position.y + this.height * 0.5).project(this.ctx.camera);
    return v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
  }

  /** Nearest passable ground around (x, z) (spiral search). */
  findStandSpot(x: number, z: number, minR: number, maxR: number, refY = this.root.position.y): THREE.Vector3 | null {
    const w = this.ctx.world;
    for (let r = minR; r <= maxR; r += 2) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + r;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        const g = w.groundAt(px, pz, Math.max(w.heightAt(px, pz) + 3, refY + 2.5));
        const water = w.liquidAt(px, pz);
        if (water && water.level - g.y > 0.6 && this.def.locomotion !== 'swimmer') continue;
        if (g.colliderId === 0 && g.ny < this.def.maxSlopeNy) continue;
        return new THREE.Vector3(px, g.y, pz);
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, ctx: GameContext): void {
    if (this.state === 'ridden') return; // the riding controller drives it
    this.updateStatuses(dt);
    this.health?.update(dt);
    this.stateT += dt;
    this.fear = Math.max(0, this.fear - dt * 0.12);
    this.happyT = Math.max(0, this.happyT - dt);
    this.onThink?.(this, dt);
    if (this.state !== 'scripted') {
      if (this.mode === 'companion') this.thinkCompanion(dt, ctx);
      else this.thinkWild(dt, ctx);
    }
    // Stuck recovery (any state with a goal: AI, scripted sequences, followers).
    if (this.stuckT > (this.mode === 'companion' ? 2.5 : 3)) {
      const p = ctx.player;
      const toward = this.mode === 'companion' && p && this.state !== 'leave' ? p.position : this.hasTarget ? tmpV.set(this.target.x, this.root.position.y, this.target.z) : this.home;
      this.recoverStuck(toward.clone(), this.onScreen());
    }
    this.locomote(dt);
    this.animate(dt);
    this.ambientSounds(dt, ctx);
  }

  /** Model animation from the current motion + state. */
  animate(dt: number): void {
    const a = this.anim;
    const body = this.body!;
    a.dt = dt;
    a.time += dt;
    a.actionT += dt;
    a.speed = this.flying ? Math.max(this.speed, 2) : Math.hypot(body.velocity.x, body.velocity.z) || this.speed;
    a.flying = this.flying;
    a.grounded = !this.flying && (body.grounded || body.swimming);
    a.swimming = !this.flying && body.swimming;
    a.vy = this.flying ? this.vy : body.velocity.y;
    const act = this.forcedAction ?? this.stateAction();
    if (act !== a.action) {
      a.action = act;
      a.actionT = 0;
    }
    a.excite = THREE.MathUtils.clamp(this.happyT > 0 ? 1 : this.fear * 0.8 + (this.state === 'follow' || this.state === 'arrive' ? 0.4 : 0), 0, 1);
    a.boost = this.speed > this.def.run * 1.05 || (this.flying && !!this.def.fly && this.speed > this.def.fly.cruise * 1.1);
    const p = this.ctx.player;
    if (this.lookAt) a.look = this.lookAt;
    else if (p && this.distToPlayer < Math.max(18, this.def.size.length * 3) && this.state !== 'flee' && this.state !== 'rest' && this.state !== 'trapped') {
      a.look = a.look ?? new THREE.Vector3();
      p.aimPoint(a.look);
    } else a.look = null;
    this.model.update(a);
  }

  private stateAction(): CreatureAction {
    switch (this.state) {
      case 'graze':
        return this.def.id === 'badgermole' ? 'dig' : this.def.id === 'winged_lemur' || this.def.id === 'cat_owl' ? 'sniff' : 'graze';
      case 'rest':
        return 'rest';
      case 'wary':
        return 'alert';
      case 'defend':
        return this.stateT < 1.2 ? 'roar' : 'alert';
      case 'trapped':
        return 'trapped';
      case 'injured':
        return 'injured';
      case 'investigate':
        return 'sniff';
      case 'perch':
        return 'perch';
      case 'burrowed':
        return 'dig';
      case 'idle':
        return this.happyT > 0 ? 'happy' : 'none';
      case 'follow':
        return this.speed < 0.2 && this.stateT > 6 && this.def.role === 'mount' ? 'sit' : this.happyT > 0 ? 'happy' : 'none';
      default:
        return 'none';
    }
  }

  private footfall(side: 'L' | 'R', heavy: boolean): void {
    if (this.flying || this.def.size.length < 0.9 || this.distToPlayer > 80) return;
    const body = this.body!;
    if (!body.grounded || !DEFORMABLE.has(body.surface)) return;
    const now = this.anim.time;
    if (now - this.footT < 0.18) return;
    this.footT = now;
    const s = side === 'L' ? 1 : -1;
    const w = Math.max(0.25, this.def.size.width * this.scale * 0.32);
    const p = tmpV.set(this.root.position.x + Math.cos(this.yaw) * w * s, this.root.position.y, this.root.position.z - Math.sin(this.yaw) * w * s);
    this.ctx.world.fx.footprint(p, this.yaw, side, heavy || this.speed > this.def.walk * 1.6 ? 'run' : 'walk', body.surface);
  }

  private ambientSounds(dt: number, ctx: GameContext): void {
    this.callT -= dt;
    if (this.callT > 0) return;
    this.callT = 8 + this.rand() * 16;
    if (this.distToPlayer > 90 || this.state === 'burrowed') return;
    const id = this.fear > 0.4 ? this.def.sounds.alarm : (this.def.sounds.content ?? this.def.sounds.call);
    ctx.audio.play(id, { position: this.aimPoint(tmpV), volume: 0.5 + Math.min(0.5, this.def.size.length / 12), range: 60 + this.def.size.length * 10 });
  }

  // ------------------------------------------------------------------ AI: wild

  private thinkWild(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    const pos = this.root.position;
    const t = this.def.taming;
    const st = this.state;
    if (st === 'trapped' || st === 'injured') {
      this.stopMoving();
      return;
    }
    if (st === 'burrowed') {
      this.stopMoving();
      if (this.stateT > this.stateDur) {
        this.model.root.visible = true;
        this.setState('idle', 2);
      }
      return;
    }
    // Flight upkeep for wild flyers.
    if (this.flying && (st === 'idle' || st === 'graze' || st === 'rest' || st === 'home')) this.land();

    // Leash: always drift home when too far.
    const fromHome = Math.hypot(pos.x - this.home.x, pos.z - this.home.z);
    if (fromHome > this.leash && st !== 'flee' && st !== 'home') this.setState('home', 20);


    switch (st) {
      case 'idle':
      case 'graze':
      case 'rest':
        this.stopMoving();
        if (this.stateT > this.stateDur) this.pickIdle();
        break;
      case 'wander':
        if (!this.hasTarget || this.stateT > this.stateDur) this.setState(this.rand() < 0.5 ? 'graze' : 'idle', 4 + this.rand() * 8);
        break;
      case 'home':
        if (fromHome < this.leash * 0.4 || this.stateT > this.stateDur) {
          this.setState('idle', 2);
          this.stopMoving();
        } else if (this.isFlyer && fromHome > 80 && !this.flying && this.def.id !== 'winged_lemur') {
          this.takeOff();
        } else this.moveTo(this.home.x, this.home.z, this.flying && this.def.fly ? this.def.fly.cruise * 0.6 : this.def.run * 0.6);
        if (this.flying && fromHome < 25) this.land();
        break;
      case 'wary': {
        if (!p) break;
        const dx = pos.x - p.position.x, dz = pos.z - p.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        const comfort = t?.comfort ?? 8;
        if (dl > comfort * 1.6 || this.stateT > this.stateDur) {
          this.setState('idle', 2);
          this.stopMoving();
        } else {
          // Back away while facing the player.
          this.moveTo(pos.x + (dx / dl) * 6, pos.z + (dz / dl) * 6, this.def.walk);
        }
        break;
      }
      case 'flee': {
        if (this.stateT > this.stateDur) {
          this.setState('home', 25);
          break;
        }
        if (!this.hasTarget && p) {
          const dx = pos.x - p.position.x, dz = pos.z - p.position.z;
          const dl = Math.hypot(dx, dz) || 1;
          const run = this.flying ? 40 : 25;
          let tx = pos.x + (dx / dl) * run, tz = pos.z + (dz / dl) * run;
          // Stay roughly within the home range.
          if (Math.hypot(tx - this.home.x, tz - this.home.z) > this.leash) {
            tx = (tx + this.home.x) / 2;
            tz = (tz + this.home.z) / 2;
          }
          const sp = this.flying && this.def.fly ? this.def.fly.cruise : this.def.sprint;
          this.moveTo(tx, tz, sp);
        }
        break;
      }
      case 'defend': {
        // Bluff charge: roar, rush toward the intruder, stop short.
        if (!p) break;
        const d = this.distToPlayer;
        if (this.stateT < 1.2) {
          this.steer(Math.atan2(p.position.x - pos.x, p.position.z - pos.z), 0);
        } else if (this.stateT < 3.2 && d > 3.2) {
          this.moveTo(p.position.x, p.position.z, this.def.run);
        } else {
          if (d < 3.4 && this.stateT < 3.6) {
            // Shove the intruder back (no damage — a warning).
            const pb = p.body;
            if (pb) {
              const dx = p.position.x - pos.x, dz = p.position.z - pos.z;
              const dl = Math.hypot(dx, dz) || 1;
              pb.impulse((dx / dl) * 9, 3, (dz / dl) * 9);
            }
            ctx.events.emit('camera:shake', { intensity: 0.25, duration: 0.3 });
          }
          this.setState('wary', 4);
        }
        break;
      }
      case 'investigate':
        if (!p || this.stateT > this.stateDur) {
          this.setState('idle', 3);
          break;
        }
        if (this.distToPlayer > 3 + this.radius) this.moveTo(p.position.x, p.position.z, this.def.walk);
        else this.stopMoving();
        break;
      default:
        break;
    }
  }

  /** Choose the next calm activity (herds stay together). */
  pickIdle(): void {
    const r = this.rand();
    const pos = this.root.position;
    if (this.def.nocturnal && this.rand() < 0.3) {
      this.setState('rest', 10 + this.rand() * 15);
      return;
    }
    // Herd flights: now and then one sky bison swims up into the sky and circles the
    // meadow — a silhouette travellers can spot from far away.
    if (this.def.id === 'sky_bison' && this.mode === 'wild' && r < 0.1 && !this.group?.members.some((m) => m.flying)) {
      const a = this.rand() * Math.PI * 2;
      const tx = this.home.x + Math.sin(a) * this.leash * 0.8, tz = this.home.z + Math.cos(a) * this.leash * 0.8;
      this.setState('wander', 40);
      this.takeOff(Math.max(this.groundY(pos.x, pos.z), this.groundY(tx, tz)) + 30 + this.rand() * 20);
      this.moveTo(tx, tz, (this.def.fly?.cruise ?? 12) * 0.5);
      return;
    }
    if (r < 0.45) {
      // Wander: herd centre or around home.
      const c = this.group ? this.group.center : this.home;
      const rad = this.group ? 6 + this.radius * 3 : Math.min(this.leash * 0.6, 25);
      const a = this.rand() * Math.PI * 2;
      const dist = rad * (0.3 + this.rand() * 0.7);
      let tx = c.x + Math.sin(a) * dist, tz = c.z + Math.cos(a) * dist;
      if (this.def.locomotion === 'swimmer') {
        tx = pos.x + Math.sin(a) * 15;
        tz = pos.z + Math.cos(a) * 15;
      }
      this.setState('wander', 12 + this.rand() * 10);
      const wantFly = this.isFlyer && (this.def.id === 'cat_owl' || this.def.id === 'winged_lemur') && this.rand() < 0.35;
      if (wantFly && !this.flying) this.takeOff(this.groundY(tx, tz) + 4 + this.rand() * 6);
      this.moveTo(tx, tz, this.flying && this.def.fly ? this.def.fly.cruise * 0.5 : this.def.walk);
    } else if (r < 0.8) this.setState('graze', 5 + this.rand() * 10);
    else if (r < 0.92) this.setState('rest', 8 + this.rand() * 14);
    else this.setState('idle', 3 + this.rand() * 4);
  }

  /** Frighten a wild animal (sprinting, combat, bending nearby). */
  scare(amount: number, from: THREE.Vector3): void {
    if (this.mode === 'companion' || this.state === 'trapped' || this.state === 'injured' || this.state === 'scripted') return;
    this.fear = Math.min(1, this.fear + amount);
    if (this.def.temperament === 'proud') return;
    const d = Math.hypot(from.x - this.root.position.x, from.z - this.root.position.z);
    if (this.def.temperament === 'wary' && this.scale >= 0.9 && this.fear > 0.35 && d < 22 && this.state !== 'defend') {
      this.setState('defend', 4);
      this.ctx.audio.play(this.def.sounds.alarm, { position: this.aimPoint(tmpV), volume: 0.9 });
      return;
    }
    if (this.def.temperament === 'blind' && this.fear > 0.3) {
      // Badgermoles dig in and wait it out.
      this.setState('burrowed', 6 + this.rand() * 5);
      this.ctx.vfx.burst('debris', this.root.position, { count: 14, speed: 3 });
      this.ctx.vfx.burst('dust', this.root.position, { count: 10, speed: 1.5, radius: this.radius });
      this.model.root.visible = false;
      return;
    }
    if (this.fear > 0.5 || (this.fear > 0.25 && this.def.temperament === 'skittish')) {
      if (this.state !== 'flee') {
        this.setState('flee', 5 + this.rand() * 4);
        this.hasTarget = false;
        if (this.isFlyer && (this.def.id !== 'sky_bison' || this.fear > 0.7)) this.takeOff(this.groundY(this.root.position.x, this.root.position.z) + (this.def.size.length > 3 ? 30 : 8));
      }
    } else if (this.state !== 'flee') this.setState('wary', 3 + this.rand() * 3);
  }

  // ------------------------------------------------------------------ AI: companion

  /** Companion follow distance (behind the player). */
  get followDist(): number {
    return this.radius + (this.def.role === 'pet' ? 1.6 : 3.2);
  }

  private thinkCompanion(_dt: number, ctx: GameContext): void {
    const p = ctx.player;
    if (!p) return;
    const pos = this.root.position;
    const pp = p.position;
    const d = Math.hypot(pp.x - pos.x, pp.z - pos.z);
    if (this.state === 'leave') {
      // Walk / fly away home; the system despawns us once out of sight.
      const dx = pos.x - pp.x, dz = pos.z - pp.z;
      const dl = Math.hypot(dx, dz) || 1;
      if (this.isFlyer && !this.flying && this.stateT > 0.8) this.takeOff(this.groundY(pos.x, pos.z) + 40);
      const sp = this.flying && this.def.fly ? this.def.fly.cruise : this.def.run;
      this.moveTo(pos.x + (dx / dl) * 40, pos.z + (dz / dl) * 40, sp);
      return;
    }
    if (this.state === 'perch') {
      this.stopMoving();
      return;
    }
    // Following idles a few metres off; a called mount (arrive) comes within mounting reach
    // (CompanionSystem mounts within radius + 4.5 m), or pressing F would only whistle again.
    const far = this.state === 'arrive' && this.def.rideable ? this.radius + 3.5 : this.followDist + 3;
    if (this.state === 'arrive' && d <= far) this.setState('follow');
    if (d > far) {
      if (this.state !== 'arrive' && this.state !== 'follow') this.setState('follow');
      const fly = this.isFlyer && (this.flying || d > 45 || (this.def.role === 'pet' && d > 12));
      if (fly && !this.flying) this.takeOff(this.groundY(pos.x, pos.z) + (this.def.role === 'pet' ? 3 : 14));
      // Aim for a point beside/behind the player.
      const side = this.def.role === 'pet' ? 1.2 : -1;
      const bx = pp.x - Math.sin(p.yaw) * (this.followDist * 0.8) + Math.cos(p.yaw) * side * (this.radius + 1);
      const bz = pp.z - Math.cos(p.yaw) * (this.followDist * 0.8) - Math.sin(p.yaw) * side * (this.radius + 1);
      let sp = d > 25 ? this.def.sprint : d > 10 ? this.def.run : Math.max(this.def.walk, Math.min(this.def.run, (p.body?.horizontalSpeed ?? 2) * 1.05));
      if (this.flying && this.def.fly) {
        sp = d > 60 ? this.def.fly.boost : d > 20 ? this.def.fly.cruise : Math.max(4, this.def.fly.cruise * 0.4);
        const pg = this.groundY(pp.x, pp.z);
        this.wantAlt = d > 30 ? Math.max(pg, this.groundY(pos.x, pos.z)) + 12 : pg + (this.def.role === 'pet' ? 2.5 : 1);
        if (d < 20 + this.radius && this.def.role === 'mount') this.land();
      }
      this.moveTo(bx, bz, sp);
    } else {
      this.stopMoving();
      if (this.flying && (this.def.role === 'mount' || this.def.id === 'winged_lemur')) this.land();
      // Face the player loosely.
      if (d > 1) this.wantYaw = Math.atan2(pp.x - pos.x, pp.z - pos.z);
    }
  }

  // ------------------------------------------------------------------ combat hooks

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    const res = super.receiveHit(hit, ctx);
    if (this.mode !== 'companion' && res.damage > 0) this.scare(0.8, hit.attacker?.position ?? this.root.position);
    return res;
  }

  protected override onDeath(): void {
    // Animals in this game are never killed: they collapse, then limp away to recover.
    this.alive = true;
    if (this.health) this.health.hp = this.health.maxHp * 0.25;
    this.onExhausted?.(this);
  }

  override dispose(): void {
    super.dispose();
    this.model.dispose();
  }
}
