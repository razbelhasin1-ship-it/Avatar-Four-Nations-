import * as THREE from 'three';
import { DEFAULT_APPEARANCE, sanitizeAppearance, type Appearance } from '../character/Appearance';
import { Humanoid } from '../character/Humanoid';
import { getTechnique } from '../combat/CombatSystem';
import type { Combatant } from '../combat/types';
import type { GameContext } from '../core/GameContext';
import { angleDiff, clamp, damp, dampAngle } from '../core/MathUtil';
import type { Persistable } from '../core/Save';
import { ELEMENTS, type Element, type SurfaceType } from '../core/types';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { KinematicBody } from '../entities/KinematicBody';
import { STARTS } from '../world/WorldLayout';
import { cosmeticById } from '../data/cosmetics';
import { ElementPlay } from './play/ElementPlay';

/** Movement profile per element (the Avatar moves in the style of the active element). */
export interface MoveStyle {
  walk: number;
  run: number;
  sprint: number;
  accel: number;
  airControl: number;
  jump: number;
  turn: number;
  /** Knockback taken multiplier. */
  stability: number;
  dodgeSpeed: number;
  dodgeTime: number;
  dodgeCost: number;
}

export const MOVE_STYLES: Record<Element, MoveStyle> = {
  air: { walk: 2.4, run: 7.6, sprint: 11.5, accel: 16, airControl: 0.85, jump: 9.6, turn: 14, stability: 1.25, dodgeSpeed: 17, dodgeTime: 0.32, dodgeCost: 10 },
  water: { walk: 2.2, run: 7.0, sprint: 9.6, accel: 11, airControl: 0.5, jump: 7.8, turn: 10, stability: 1.0, dodgeSpeed: 12, dodgeTime: 0.38, dodgeCost: 12 },
  earth: { walk: 2.0, run: 6.7, sprint: 9.0, accel: 9, airControl: 0.35, jump: 7.2, turn: 9, stability: 0.45, dodgeSpeed: 10, dodgeTime: 0.3, dodgeCost: 12 },
  fire: { walk: 2.3, run: 7.3, sprint: 10.2, accel: 14, airControl: 0.55, jump: 8.0, turn: 12, stability: 0.85, dodgeSpeed: 15, dodgeTime: 0.28, dodgeCost: 12 },
};

const SURFACE_SOUND: Partial<Record<SurfaceType, string>> = {
  snow: 'footstep_snow',
  packedsnow: 'footstep_snow',
  stone: 'footstep_stone',
  cobble: 'footstep_stone',
  plaster: 'footstep_stone',
  rock: 'footstep_stone',
  ice: 'footstep_stone',
  wood: 'footstep_stone',
  water: 'footstep_water',
  mud: 'footstep_water',
};

const DEFORMABLE: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['snow', 'packedsnow', 'sand', 'mud', 'ash']);

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

export class Player extends Entity implements Combatant, Persistable {
  readonly kind = 'player' as const;
  readonly saveKey = 'player';
  readonly isPlayer = true;
  humanoid: Humanoid;
  characterName = 'Avatar';
  appearance: Appearance;
  element: Element = 'air';
  chi = 100;
  maxChi = 100;
  waterReserve = 0;
  /** Something carrying the player (a water spout) sets its own pace and full control instead of walking. */
  ride: { speed: number; sprint: number; accel: number } | null = null;
  maxWaterReserve = 60;
  /** Seconds since last combat action (chi regen, music). */
  sinceCombat = 99;
  lockTarget: Entity | null = null;
  /** Point the crosshair points at (updated each frame). */
  readonly aimPoint3 = new THREE.Vector3();
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  private dodgeTimer = 0;
  private dodgeDir = new THREE.Vector3();
  private dodgeCooldown = 0;
  invuln = 0;
  gliding = false;
  private airJumps = 0;
  private chargeId: string | null = null;
  private chargeTime = 0;
  private bufferedAction: { id: string; t: number } | null = null;
  private lastYaw = 0;
  /** Safe respawn point (last grounded non-hostile spot near a landmark). */
  readonly safePoint = new THREE.Vector3();
  private safeTimer = 0;
  defeated = false;
  private defeatTimer = 0;
  /** Set when riding a mount: the anchor to follow. */
  mountAnchor: THREE.Object3D | null = null;
  /** External systems can lock controls (cutscene/training intro). */
  controlLock = 0;
  playTime = 0;
  /** Playful bending while exploring (held attack): water orb, lifted rock, palm flame. */
  readonly play: ElementPlay;

  constructor(private readonly ctx: GameContext) {
    super();
    this.name = 'Avatar';
    this.team = 'player';
    this.tags.add('player');
    this.appearance = structuredClone(DEFAULT_APPEARANCE.air);
    this.humanoid = new Humanoid(this.appearance, { castShadow: true });
    this.root.add(this.humanoid.root);
    this.height = this.humanoid.height;
    this.radius = 0.36;
    this.body = new KinematicBody(0.34, this.height);
    this.health = new Health(120, 60, 20);
    this.humanoid.animator.onFootstep = (foot) => this.onFootstep(foot);
    this.play = new ElementPlay(ctx, this);
  }

  setAppearance(a: Appearance): void {
    this.appearance = a;
    this.humanoid.setAppearance(a);
    this.height = this.humanoid.height;
    if (this.body) this.body.height = this.height;
    this.maxWaterReserve = this.hasAccessoryEffect('water_flask') ? 60 : 60;
    this.ctx.events.emit('appearance:changed', {});
  }

  hasAccessoryEffect(effect: string): boolean {
    return cosmeticById(this.appearance.outfit.accessory)?.effect === effect;
  }

  get style(): MoveStyle {
    return MOVE_STYLES[this.element];
  }

  castOrigin(which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3 {
    const h = this.humanoid;
    h.root.updateWorldMatrix(true, true);
    switch (which) {
      case 'handL':
        return h.anchors.handL.getWorldPosition(out);
      case 'handR':
        return h.anchors.handR.getWorldPosition(out);
      case 'hands':
        h.anchors.handL.getWorldPosition(out);
        return out.add(h.anchors.handR.getWorldPosition(tmpC)).multiplyScalar(0.5);
      case 'feet':
        return out.copy(this.root.position);
      default:
        return h.anchors.chest.getWorldPosition(out);
    }
  }

  powerMultiplier(): number {
    const lvl = 1 + (this.ctx.progression.level - 1) * 0.04;
    const mastery = this.ctx.progression.mastery[this.element]?.mastered ? 1.15 : 1;
    return lvl * mastery * this.ctx.avatar.powerBonus;
  }

  /** Switch active bending element (only to unlocked elements). */
  switchElement(e: Element, silent = false): boolean {
    if (!this.ctx.progression.canBend(e) || e === this.element) return false;
    this.play.stop('cancel');
    this.element = e;
    this.humanoid.animator.loco.style = e;
    this.chargeId = null;
    if (!silent) {
      this.ctx.events.emit('element:switched', { element: e });
      this.ctx.audio.play('whoosh', { volume: 0.4, pitch: 1.4 });
      const colors: Record<Element, string> = { air: '#f4f0e0', water: '#9fd8ff', earth: '#b9a07a', fire: '#ffa050' };
      this.ctx.vfx.burst(e === 'fire' ? 'embers' : e === 'water' ? 'splash' : e === 'earth' ? 'dust' : 'swirl', this.aimPoint(tmpA), { count: 10, color: colors[e] });
    }
    return true;
  }

  cycleElement(dir: 1 | -1): void {
    const avail = ELEMENTS.filter((e) => this.ctx.progression.canBend(e));
    if (avail.length < 2) return;
    const i = avail.indexOf(this.element);
    this.switchElement(avail[(i + dir + avail.length) % avail.length]);
  }

  // ---------------------------------------------------------------------------
  // Aiming
  // ---------------------------------------------------------------------------

  private updateAim(): void {
    const cam = this.ctx.camera;
    const origin = cam.getWorldPosition(tmpA);
    const dir = cam.getWorldDirection(tmpB);
    // Start the ray at the player's depth to avoid hitting things behind them.
    const toPlayer = this.root.position.clone().sub(origin).dot(dir);
    origin.addScaledVector(dir, Math.max(0, toPlayer));
    const hit = this.ctx.world.raycast(origin, dir, 90);
    if (hit) this.aimPoint3.copy(hit.point);
    else this.aimPoint3.copy(origin).addScaledVector(dir, 90);
    // Aim assist / lock-on
    let target: Entity | null = this.lockTarget && this.lockTarget.alive ? this.lockTarget : null;
    if (!target && this.ctx.settings.data.controls.autoTarget) target = this.findAssistTarget(origin, dir);
    const chest = this.castOrigin('chest', tmpC);
    if (target) {
      target.aimPoint(this.aimPoint3);
    }
    this.aimDir.copy(this.aimPoint3).sub(chest).normalize();
  }

  private findAssistTarget(origin: THREE.Vector3, dir: THREE.Vector3): Entity | null {
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of this.ctx.entities.queryRadius(this.root.position, 28)) {
      if (e === this || !this.ctx.combat.canHarm(this, e)) continue;
      const to = e.aimPoint(tmpC).sub(origin);
      const dist = to.length();
      const ang = to.normalize().angleTo(dir);
      if (ang > 0.22) continue;
      const score = ang * 30 + dist * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  toggleLock(): void {
    if (this.lockTarget) {
      this.lockTarget = null;
      return;
    }
    const cam = this.ctx.camera;
    const f = cam.getWorldDirection(tmpB).setY(0).normalize();
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of this.ctx.entities.queryRadius(this.root.position, 32)) {
      if (e === this || !this.ctx.combat.canHarm(this, e)) continue;
      const to = tmpC.copy(e.position).sub(this.root.position).setY(0);
      const d = to.length();
      if (d < 0.1) continue;
      const dot = to.normalize().dot(f);
      if (dot < 0.2) continue;
      const score = d * (2 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.lockTarget = best;
  }

  // ---------------------------------------------------------------------------
  // Techniques
  // ---------------------------------------------------------------------------

  private techniqueFor(kind: 'basic' | 'heavy', e: Element): string | null {
    for (const id of this.ctx.progression.learnedFor(e)) {
      const d = getTechnique(id);
      if (d && d.kind === kind && d.element === e) return id;
    }
    return null;
  }

  /** Attempt a technique now; buffer it briefly if busy. */
  useTechnique(id: string, charge = 0): boolean {
    const target = this.lockTarget && this.lockTarget.alive ? this.lockTarget : null;
    const res = this.ctx.combat.tryCast(this, id, { aimDir: this.aimDir.clone(), aimPoint: this.aimPoint3.clone(), target, charge });
    if (res.ok) {
      this.sinceCombat = 0;
      this.bufferedAction = null;
      this.gliding = false;
      return true;
    }
    if (res.reason === 'busy') this.bufferedAction = { id, t: 0.3 };
    return false;
  }

  private handleCombatInput(dt: number): void {
    const input = this.ctx.input;
    const e = this.element;
    const sphere = this.ctx.avatar.sphereActive;
    // Playful bending first (another action pressed ends it): a quick tap held back while
    // exploring comes out as the normal attack here.
    const tapped = this.play.update(dt, true);
    // Ultimates replace slots while the Elements Sphere is active.
    const slotIds: Array<string | null> = sphere
      ? ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado']
      : this.ctx.progression.slotsFor(e);
    const actions = ['ability1', 'ability2', 'ability3', 'ability4'] as const;
    actions.forEach((a, i) => {
      if (input.wasPressed(a)) {
        const id = slotIds[i];
        if (id) this.useTechnique(id);
        else this.ctx.events.emit('ui:notify', { text: 'No technique in this slot — open the Technique Library (K).', kind: 'warning', duration: 2 });
      }
    });
    if (input.wasPressed('ability5')) {
      if (sphere) this.useTechnique('ult_cataclysm');
      else this.ctx.events.emit('ui:notify', { text: 'Combined techniques require the Elements Sphere.', kind: 'warning', duration: 2 });
    }
    // Attack: fires on press, except exploring with water, a rock or (fire) an open hand to play
    // with, where a hold becomes play and a tap fires on release (ElementPlay).
    if ((input.wasPressed('attack') && !this.play.pressAttack()) || tapped) {
      const id = this.techniqueFor('basic', e);
      if (id) this.useTechnique(id);
    }
    // Heavy: hold aim to charge, release to fire.
    const heavy = this.techniqueFor('heavy', e);
    if (heavy) {
      if (input.wasPressed('aim')) {
        this.chargeId = heavy;
        this.chargeTime = 0;
      }
      if (this.chargeId && input.isDown('aim')) {
        this.chargeTime += dt;
        if (Math.random() < dt * 20) {
          const p = this.castOrigin('hands', tmpA);
          this.ctx.vfx.burst(e === 'fire' ? 'flame' : e === 'water' ? 'spray' : e === 'earth' ? 'dust' : 'swirl', p, { count: 1, speed: 0.3, size: 0.5 });
        }
      }
      if (this.chargeId && input.wasReleased('aim')) {
        const def = getTechnique(this.chargeId);
        const charge = def?.chargeTime ? clamp(this.chargeTime / def.chargeTime, 0, 1) : 1;
        this.useTechnique(this.chargeId, charge);
        this.chargeId = null;
      }
    }
    if (this.bufferedAction) {
      this.bufferedAction.t -= dt;
      if (this.bufferedAction.t <= 0) this.bufferedAction = null;
      else if (!this.ctx.combat.isBusy(this)) this.useTechnique(this.bufferedAction.id);
    }
  }

  get charging(): number {
    if (!this.chargeId) return 0;
    const def = getTechnique(this.chargeId);
    return def?.chargeTime ? clamp(this.chargeTime / def.chargeTime, 0, 1) : 0;
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private onFootstep(foot: 'L' | 'R'): void {
    const b = this.body!;
    if (!b.grounded) return;
    const speed = b.horizontalSpeed;
    const surface = b.surface;
    const heavy = this.element === 'earth' && speed > 5;
    const pos = this.root.position;
    this.ctx.events.emit('player:footstep', { surface, position: { x: pos.x, y: pos.y, z: pos.z }, foot, speed, yaw: this.yaw, heavy });
    this.ctx.audio.play(SURFACE_SOUND[surface] ?? 'footstep', { position: pos, volume: Math.min(1, 0.35 + speed * 0.07) * (heavy ? 1.4 : 1), pitch: heavy ? 0.7 : 1 });
    if (DEFORMABLE.has(surface)) {
      const side = foot === 'L' ? 1 : -1;
      const fp = tmpA.set(pos.x + Math.cos(this.yaw) * 0.12 * side, pos.y, pos.z - Math.sin(this.yaw) * 0.12 * side);
      this.ctx.world.fx.footprint(fp, this.yaw, foot, speed > 6 ? 'run' : 'walk', surface);
      if (surface === 'snow' && speed > 6) this.ctx.vfx.burst('snow', fp, { count: 2, speed: 0.5 });
      if (surface === 'sand' && speed > 6) this.ctx.vfx.burst('sand', fp, { count: 1, speed: 0.3, size: 0.6 });
    }
    if (heavy && Math.random() < 0.5) this.ctx.vfx.burst('dust', pos, { count: 2, speed: 0.4 });
  }

  private updateMovement(dt: number): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const body = this.body!;
    const st = this.style;
    const anim = this.humanoid.animator;
    const locked = this.controlLock > 0 || this.defeated;
    this.controlLock = Math.max(0, this.controlLock - dt);

    // Camera-relative input.
    const camF = ctx.camera.getWorldDirection(tmpA).setY(0);
    if (camF.lengthSq() < 1e-6) camF.set(0, 0, 1);
    camF.normalize();
    const camR = tmpB.set(-camF.z, 0, camF.x); // right-hand vector (camera right)
    const mv = locked ? { x: 0, y: 0 } : input.move;
    const wish = tmpC.set(0, 0, 0).addScaledVector(camF, mv.y).addScaledVector(camR, mv.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 1e-3) wish.normalize();

    const sprinting = !locked && input.isDown('sprint') && wishLen > 0.3 && (body.grounded || !!this.ride);
    let speed = wishLen < 0.5 ? st.walk + (st.run - st.walk) * (wishLen / 0.5) * 0.5 : st.run;
    if (sprinting) speed = st.sprint;
    if (this.ride) speed = (sprinting ? this.ride.sprint : this.ride.speed) * Math.min(1, wishLen * 1.6);
    // Movement restrictions from casting.
    const mm = ctx.combat.movementMode(this);
    if (mm === 'root') speed = 0;
    else if (mm === 'slow') speed *= 0.4;
    speed *= this.speedFactor;
    if (body.swimming) speed = Math.min(speed, 3.2);
    else if (body.inWater) speed *= 0.75;
    // Holding a water orb or a rock: a careful walk.
    if (this.play.moveFactor < 1) speed = Math.min(speed, st.run) * this.play.moveFactor;
    speed *= ctx.avatar.boosts.speed; // [avatar] Avatar State boost (1 when inactive)

    // Dodge
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    if (!locked && input.wasPressed('dodge') && this.dodgeCooldown <= 0 && this.chi >= st.dodgeCost && !body.swimming) {
      if (ctx.combat.isCommitted(this)) ctx.combat.interrupt(this, false);
      this.chi -= st.dodgeCost;
      this.dodgeTimer = st.dodgeTime;
      this.dodgeCooldown = st.dodgeTime + 0.25;
      this.invuln = st.dodgeTime * 0.8;
      this.dodgeDir.copy(wishLen > 0.1 ? wish : tmpA.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)));
      const el = this.element;
      const pos = this.root.position;
      anim.play(el === 'air' ? 'dodge_air' : el === 'fire' ? 'dodge_fire' : el === 'earth' ? 'dodge_earth' : 'dodge_water', { fadeIn: 0.04 });
      ctx.events.emit('player:dodged', { position: { x: pos.x, y: pos.y, z: pos.z }, element: el });
      ctx.audio.play('whoosh', { position: pos, volume: 0.6, pitch: el === 'air' ? 1.3 : 1 });
      const fx = el === 'air' ? 'air' : el === 'fire' ? 'fire' : el === 'earth' ? 'dust' : 'splash';
      ctx.vfx.burst(fx, tmpA.copy(pos).setY(pos.y + 0.8), { count: 10, dir: this.dodgeDir.clone().negate(), spread: 0.6 });
      if (el === 'air') body.launch(3.5);
    }

    let targetVel = tmpA.copy(wish).multiplyScalar(speed);
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      targetVel = tmpA.copy(this.dodgeDir).multiplyScalar(st.dodgeSpeed);
      body.move.copy(targetVel);
    } else {
      const ice = body.surface === 'ice' && body.grounded;
      let accel = this.ride ? this.ride.accel : body.grounded ? st.accel : st.accel * st.airControl;
      if (ice) accel *= this.element === 'water' ? 0.6 : 0.18; // waterbenders surf the ice
      if (ice && this.element === 'water' && sprinting) targetVel.multiplyScalar(1.35);
      const k = 1 - Math.exp(-accel * dt);
      body.move.x += (targetVel.x - body.move.x) * k;
      body.move.z += (targetVel.z - body.move.z) * k;
    }

    // Facing
    const moving = body.move.lengthSq() > 0.25;
    let desiredYaw = this.yaw;
    const aimingHeavy = !!this.chargeId && input.isDown('aim');
    if (this.lockTarget && this.lockTarget.alive) {
      const t = this.lockTarget.position;
      desiredYaw = Math.atan2(t.x - this.root.position.x, t.z - this.root.position.z);
    } else if (aimingHeavy || ctx.combat.isBusy(this) || this.play.facesAim) {
      desiredYaw = Math.atan2(this.aimDir.x, this.aimDir.z);
    } else if (moving && this.dodgeTimer <= 0) {
      desiredYaw = Math.atan2(body.move.x, body.move.z);
    }
    this.yaw = dampAngle(this.yaw, desiredYaw, st.turn, dt);

    // Jump / air jump / glide
    if (!locked && input.wasPressed('jump')) {
      const coyote = body.airTime < 0.12;
      if ((body.grounded || coyote) && !body.swimming) {
        body.velocity.y = st.jump * ctx.avatar.boosts.jump;
        body.grounded = false;
        this.airJumps = 0;
        anim.play('jump_start', { fadeIn: 0.05 });
        ctx.audio.play('jump', { position: this.root.position, volume: 0.5 });
        ctx.events.emit('player:jumped', { position: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z }, double: false });
        if (this.element === 'air') ctx.vfx.burst('air', this.root.position, { count: 8, dir: new THREE.Vector3(0, -1, 0), spread: 1.4 });
      } else if (body.swimming) {
        body.velocity.y = 4;
      } else if (this.element === 'air' && this.airJumps < (ctx.progression.knows('air_jump') ? 2 : 1) && this.chi >= 8) {
        this.airJumps++;
        this.chi -= 8;
        body.velocity.y = st.jump * 0.9;
        ctx.vfx.burst('swirl', this.root.position, { count: 14, swirl: 6 });
        ctx.audio.play('whoosh', { position: this.root.position, volume: 0.5, pitch: 1.5 });
        ctx.events.emit('player:jumped', { position: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z }, double: true });
      }
    }
    // Airbender glide: hold jump while falling.
    const canGlide = this.element === 'air' && !body.grounded && !body.swimming && body.velocity.y < -1 && input.isDown('jump') && !locked;
    if (canGlide !== this.gliding) {
      this.gliding = canGlide;
      ctx.events.emit('player:glide', { active: canGlide });
    }
    if (this.gliding) {
      const glider = this.hasAccessoryEffect('glider') ? 1.25 : 1;
      body.velocity.y = Math.max(body.velocity.y, -2.2 / glider);
      const fwd = tmpB.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const glideSpeed = 12 * glider;
      body.move.x = damp(body.move.x, fwd.x * glideSpeed + wish.x * 3, 2, dt);
      body.move.z = damp(body.move.z, fwd.z * glideSpeed + wish.z * 3, 2, dt);
      if (wishLen > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 2.5, dt);
      if (Math.random() < dt * 8) ctx.vfx.burst('air', this.castOrigin('hands', tmpA), { count: 1, speed: 0.4 });
    }
    if (body.grounded) this.airJumps = 0;

    // Knockback stability
    body.external.multiplyScalar(1); // style applied at impulse time (see receiveHit)

    const wasGrounded = body.grounded;
    body.step(dt, this.root.position, ctx.world);
    if (body.justLanded) {
      const s = body.lastLandingSpeed;
      anim.notifyLanding(s);
      if (s > 7) {
        const pos = this.root.position;
        ctx.events.emit('player:landed', { speed: s, surface: body.surface, position: { x: pos.x, y: pos.y, z: pos.z } });
        ctx.audio.play('land', { position: pos, volume: Math.min(1, s / 15) });
        if (DEFORMABLE.has(body.surface)) {
          ctx.world.fx.footprint(pos, this.yaw, 'L', 'land', body.surface);
          ctx.vfx.burst(body.surface === 'sand' ? 'sand' : body.surface === 'mud' ? 'dust' : 'snowpuff', pos, { count: 10 });
        } else ctx.vfx.burst('dust', pos, { count: Math.round(s / 2) });
        ctx.world.fx.disturb(pos, 2 + s * 0.2, Math.min(1, s / 15));
        if (this.element === 'earth' && s > 10) {
          ctx.vfx.ring(pos.clone().setY(pos.y + 0.1), '#b9a07a', 5, 0.4);
          ctx.events.emit('camera:shake', { intensity: 0.25, duration: 0.25 });
        }
        // Fall damage only for big falls (airbenders and gliders are exempt).
        if (s > 24 && this.element !== 'air' && !ctx.avatar.active) {
          this.health!.hp = Math.max(1, this.health!.hp - (s - 24) * 3);
        }
      }
    }
    void wasGrounded;

    // Falling out of the world / deep water safety
    if (this.root.position.y < -60) this.respawnAtSafePoint();

    this.root.rotation.y = this.yaw;
    const turnRate = angleDiff(this.lastYaw, this.yaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    anim.loco.speed = body.horizontalSpeed;
    anim.loco.grounded = body.grounded;
    anim.loco.vy = body.velocity.y;
    anim.loco.sprinting = sprinting;
    anim.loco.swimming = body.swimming;
    anim.loco.gliding = this.gliding;
    anim.loco.sliding = body.sliding;
    anim.loco.mounted = !!this.mountAnchor;
    anim.loco.turnRate = turnRate;
    anim.loco.style = this.element;
    anim.loco.idleVariant = ctx.avatar.active && !body.grounded ? 'float' : 'stand';
  }

  // ---------------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------------

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    if (this.invuln > 0 || this.defeated) return { damage: 0, killed: false, blocked: false, staggered: false };
    const st = this.style;
    if (hit.knockback) hit.knockback.multiplyScalar(st.stability * ctx.avatar.boosts.knockbackTaken);
    hit.damage *= ctx.avatar.boosts.damageTaken;
    const res = super.receiveHit(hit, ctx);
    this.sinceCombat = 0;
    if (res.damage > 0) {
      this.humanoid.flash('#ff6040', 0.12);
      this.humanoid.animator.hitReact(Math.min(1.2, res.damage / 20));
      if (res.staggered) ctx.combat.interrupt(this, true);
    }
    return res;
  }

  protected override onDeath(ctx: GameContext): void {
    // The Avatar is never truly killed: defeat → recover at a safe place.
    this.alive = true;
    this.health!.hp = 1;
    if (this.defeated) return;
    this.defeated = true;
    this.defeatTimer = 0;
    this.lockTarget = null;
    ctx.avatar.deactivate();
    ctx.combat.interrupt(this, false);
    this.humanoid.animator.play('knockdown', { hold: true, fadeIn: 0.05 });
    ctx.events.emit('player:defeated', {});
  }

  /** Called by the defeat UI ("Recover"). */
  recover(): void {
    if (!this.defeated) return;
    this.defeated = false;
    this.humanoid.animator.stop('knockdown');
    this.health!.reset();
    this.chi = this.maxChi;
    this.respawnAtSafePoint();
    this.invuln = 2;
    this.ctx.events.emit('player:respawned', { position: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z } });
  }

  respawnAtSafePoint(): void {
    const p = this.safePoint;
    const g = this.ctx.world.groundAt(p.x, p.z, p.y + 2);
    this.teleport(new THREE.Vector3(p.x, g.y + 0.1, p.z));
  }

  teleport(p: THREE.Vector3, yaw?: number): void {
    this.play.stop('cancel');
    this.body!.place(p, this.root.position);
    this.safePoint.copy(p);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.root.rotation.y = yaw;
    }
    this.ctx.cameraRig.snapBehind();
  }

  private updateSafePoint(dt: number): void {
    this.safeTimer -= dt;
    if (this.safeTimer > 0) return;
    this.safeTimer = 2;
    const b = this.body!;
    if (!b.grounded || b.inWater || b.sliding || this.sinceCombat < 6) return;
    this.safePoint.copy(this.root.position);
  }

  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    this.playTime += dt;
    const h = this.health!;
    h.update(dt);
    const dot = this.updateStatuses(dt);
    if (dot > 0 && !this.defeated) {
      h.hp = Math.max(0, h.hp - dot);
      if (h.hp <= 0) this.onDeath(ctx);
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceCombat += dt;
    // Chi regeneration (faster out of combat).
    this.chi = Math.min(this.maxChi, this.chi + (this.sinceCombat > 4 ? 22 : 9) * dt);
    // Slow health regen out of combat.
    if (this.sinceCombat > 8 && !this.defeated) h.heal(4 * dt);

    if (this.mountAnchor) {
      // Riding: follow the saddle, let the companion system drive movement.
      this.mountAnchor.getWorldPosition(this.root.position);
      const q = this.mountAnchor.getWorldQuaternion(new THREE.Quaternion());
      this.yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      this.root.rotation.y = this.yaw;
      this.body!.velocity.set(0, 0, 0);
      this.humanoid.animator.loco.mounted = true;
      this.humanoid.animator.loco.speed = 0;
      this.humanoid.animator.loco.grounded = true;
      this.updateAim();
      if (!ctx.ui.blocksGameplay) this.handleCombatInput(dt);
      else this.play.update(dt, false);
      this.humanoid.update(dt);
      return;
    }

    if (this.defeated) {
      this.play.update(dt, false);
      this.defeatTimer += dt;
      this.body!.move.set(0, 0, 0);
      this.body!.step(dt, this.root.position, ctx.world);
      this.humanoid.update(dt);
      return;
    }

    if (!ctx.ui.blocksGameplay) {
      const input = ctx.input;
      if (input.wasPressed('elementNext')) this.cycleElement(1);
      if (input.wasPressed('elementPrev')) this.cycleElement(-1);
      if (input.wasPressed('lockOn')) this.toggleLock();
    }
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.position.distanceTo(this.root.position) > 40)) this.lockTarget = null;
    this.updateAim();
    this.updateMovement(dt);
    if (!ctx.ui.blocksGameplay && this.controlLock <= 0) this.handleCombatInput(dt);
    else this.play.update(dt, false);
    this.updateSafePoint(dt);
    this.humanoid.update(dt);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    if (this.ctx.session.kind === 'tutorial') return undefined;
    const b = this.body!;
    const here = b.grounded && !b.inWater && !this.defeated && !this.mountAnchor;
    const sp = here ? this.root.position : this.safePoint.lengthSq() > 0 ? this.safePoint : this.root.position;
    return {
      v: 1,
      name: this.characterName,
      appearance: this.appearance,
      element: this.element,
      hp: this.health!.hp,
      pos: { x: sp.x, y: sp.y, z: sp.z },
      yaw: this.yaw,
      playTime: this.playTime,
    };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (typeof data.name === 'string') this.characterName = data.name.slice(0, 24) || 'Avatar';
    const start = this.ctx.progression.startingElement;
    this.setAppearance(sanitizeAppearance(data.appearance, DEFAULT_APPEARANCE[start]));
    if (ELEMENTS.includes(data.element) && this.ctx.progression.canBend(data.element)) this.element = data.element;
    else this.element = start;
    if (typeof data.hp === 'number') this.health!.hp = clamp(data.hp, 1, this.health!.maxHp);
    if (data.pos && [data.pos.x, data.pos.y, data.pos.z].every((v: any) => typeof v === 'number' && isFinite(v))) {
      this.safePoint.set(data.pos.x, data.pos.y, data.pos.z);
    } else {
      const s = STARTS[start];
      this.safePoint.set(s.spawn.x, 0, s.spawn.z);
    }
    if (typeof data.yaw === 'number') this.yaw = data.yaw;
    if (typeof data.playTime === 'number') this.playTime = data.playTime;
  }

  reset(): void {
    this.characterName = 'Avatar';
    this.element = 'air';
    this.chi = this.maxChi;
    this.waterReserve = 0;
    this.health!.reset();
    this.defeated = false;
    this.lockTarget = null;
    this.playTime = 0;
    this.safePoint.set(0, 0, 0);
  }
}
