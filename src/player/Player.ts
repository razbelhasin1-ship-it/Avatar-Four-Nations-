import * as THREE from 'three';
import { DEFAULT_APPEARANCE, sanitizeAppearance, type Appearance } from '../character/Appearance';
import { Humanoid } from '../character/Humanoid';
import { allTechniques, getTechnique } from '../combat/CombatSystem';
import type { Combatant } from '../combat/types';
import type { GameContext } from '../core/GameContext';
import { angleDiff, clamp, damp, dampAngle } from '../core/MathUtil';
import type { Persistable } from '../core/Save';
import { ELEMENTS, type Element, type SurfaceType } from '../core/types';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { KinematicBody } from '../entities/KinematicBody';
import { originStart } from '../data/starts';
import { cosmeticById } from '../data/cosmetics';
import { releaseWindTrail, windRing, windTrail } from '../vfx/effects/wind';
import { setOpacity } from '../vfx/effects/materials';
import type { Trail } from '../vfx/effects/ribbon';
import type { LoopHandle } from '../audio/AudioEngine';
import { GLIDER, gust, newGliderState, stepGlider, type GliderState } from './glider/flight';
import { GliderStaff, HANG } from './glider/GliderStaff';
import { UpdraftField } from './glider/Updrafts';
import './glider/sounds';
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

/** Air techniques bent with empty hands (the glider staff stays on the back). */
const FREE_HANDS: ReadonlySet<string> = new Set(['air_scooter']);
/** Airbending bent through the glider staff (the wind leaves from its head) hits this much harder. */
export const STAFF_AIR_POWER = 1.1;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
/** Glider effects' scratch points (tmpC holds the steering wish while the glider flies). */
const tmpFx = new THREE.Vector3();
const tmpFx2 = new THREE.Vector3();
const UP: Readonly<THREE.Vector3> = new THREE.Vector3(0, 1, 0);

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
  /** The glider staff (a prop of its own while the Glider Staff accessory is worn). */
  staff: GliderStaff | null = null;
  /** The open glider's flight (null while folded). */
  glider: GliderState | null = null;
  /** Seconds before the glider may open again (just folded). */
  private gliderWait = 0;
  /** Seconds the glider has been flying into something solid (it stalls and folds). */
  private gliderBlocked = 0;
  /** Folded against a wall: Jump must be let go before it can snap open again (no open-shut flapping). */
  private gliderRearm = false;
  /** Updraft columns: their lift, and the wisps that show them. */
  private updraftField: UpdraftField;
  /** Seconds the staff stays in the hands after airbending. */
  private staffLinger = 0;
  /** Camera pull-back applied for flight (eased; mounts own the camera offsets otherwise). */
  private camFlight = 0;
  /** Flight feel: the glider's attitude (rad, nose up +), its roll into turns (rad, left down +), airspeed 0..1 — eased. */
  private glideAttitude = 0;
  private glideBank = 0;
  private glideSpeedN = 0;
  /** The roar of the air while flying (a loop rising with speed). */
  private flightWind: LoopHandle | null = null;
  /** Streams of air off the big fan's tips. */
  private tipTrails: Array<{ trail: Trail; mat: THREE.ShaderMaterial }> = [];
  /** Hair and robes are streaming in the flight wind (Humanoid.wind set by the glider). */
  private flightWindOnCloth = false;
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
  /** [additive: sub-elements] Held pose while the body is left behind (meditating for a spiritual projection). */
  poseOverride: 'meditate' | 'kneel' | null = null;
  playTime = 0;
  /** Playful bending while exploring (held attack): water orb, lifted rock, palm flame. */
  readonly play: ElementPlay;

  constructor(private readonly ctx: GameContext) {
    super();
    this.name = 'Avatar';
    this.team = 'player';
    this.tags.add('player');
    this.appearance = structuredClone(DEFAULT_APPEARANCE.air);
    this.humanoid = new Humanoid(this.meshAppearance(this.appearance), { castShadow: true });
    this.root.add(this.humanoid.root);
    this.height = this.humanoid.height;
    this.radius = 0.36;
    this.body = new KinematicBody(0.34, this.height);
    this.health = new Health(120, 60, 20);
    this.humanoid.animator.onFootstep = (foot) => this.onFootstep(foot);
    this.play = new ElementPlay(ctx, this);
    this.updraftField = new UpdraftField(ctx);
    this.syncStaff();
    // The glider staff channels airbending: a little stronger through its head.
    ctx.combat.powerMods.push((c, def) => (c === this && this.staff && def.element === 'air' && !FREE_HANDS.has(def.id) ? STAFF_AIR_POWER : 1));
  }

  /** The look the body mesh is built from: a worn glider staff is a prop of its own (it moves), not part of the mesh. */
  private meshAppearance(a: Appearance): Appearance {
    if (cosmeticById(a.outfit.accessory)?.effect !== 'glider') return a;
    return { ...a, outfit: { ...a.outfit, accessory: 'none_acc' } };
  }

  /** Create or drop the glider staff prop to match the worn accessory. */
  private syncStaff(): void {
    const want = this.hasAccessoryEffect('glider');
    if (want && !this.staff) this.staff = new GliderStaff(this.humanoid);
    else if (!want && this.staff) {
      this.closeGlider(false);
      this.staff.dispose();
      this.staff = null;
    }
  }

  setAppearance(a: Appearance): void {
    this.appearance = a;
    this.humanoid.setAppearance(this.meshAppearance(a));
    this.syncStaff();
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
    // Airbending with the staff in hand: the wind leaves from its head.
    if (this.staff && this.staff.mode === 'hand' && this.element === 'air' && (which === 'handL' || which === 'handR' || which === 'hands')) {
      return this.staff.tipWorld(out);
    }
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
      // A ring of the new element round the feet: the stance shifts.
      this.ctx.vfx.ring(tmpA.copy(this.position).setY(this.position.y + 0.08), colors[e], 1.15, 0.32, { opacity: 0.55 });
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
    const pr = this.ctx.progression;
    for (const id of pr.learnedFor(e)) {
      const d = getTechnique(id);
      if (d && d.kind === kind && d.element === e) return id;
    }
    // Lent for a lesson or an element awakening (progression.knows covers them while it runs): the
    // awakening's targets are broken with the element's basic attack before it is ever learned.
    for (const d of allTechniques()) if (d.element === e && d.kind === kind && pr.knows(d.id)) return d.id;
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
    // (With the glider open, Dodge folds it instead — see updateGlider.)
    if (!locked && !this.glider && input.wasPressed('dodge') && this.dodgeCooldown <= 0 && this.chi >= st.dodgeCost && !body.swimming) {
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
    // A flier turns the glider (updateGlider), not the body.
    if (!this.glider) this.yaw = dampAngle(this.yaw, desiredYaw, st.turn, dt);

    // Jump / air jump / glide (with the glider open, Jump bends a gust under the wings instead)
    if (!locked && !this.glider && input.wasPressed('jump')) {
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
    if (this.staff && this.element === 'air') {
      // The glider staff: hold Jump while falling to snap the glider open, then fly it.
      this.updateGlider(dt, wish, wishLen, locked);
    } else {
      if (this.glider) this.closeGlider(false);
      // Airbender glide on spread arms (no glider): hold jump while falling.
      const canGlide = this.element === 'air' && !body.grounded && !body.swimming && body.velocity.y < -1 && input.isDown('jump') && !locked;
      if (canGlide !== this.gliding) {
        this.gliding = canGlide;
        ctx.events.emit('player:glide', { active: canGlide });
      }
      if (this.gliding) {
        body.velocity.y = Math.max(body.velocity.y, -2.2);
        const fwd = tmpB.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const glideSpeed = 12;
        body.move.x = damp(body.move.x, fwd.x * glideSpeed + wish.x * 3, 2, dt);
        body.move.z = damp(body.move.z, fwd.z * glideSpeed + wish.z * 3, 2, dt);
        if (wishLen > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 2.5, dt);
        if (Math.random() < dt * 8) ctx.vfx.burst('air', this.castOrigin('hands', tmpA), { count: 1, speed: 0.4 });
      }
    }
    if (body.grounded) this.airJumps = 0;

    // Knockback stability
    body.external.multiplyScalar(1); // style applied at impulse time (see receiveHit)

    const wasGrounded = body.grounded;
    const flyFrom = this.glider ? tmpB.copy(this.root.position) : null;
    body.step(dt, this.root.position, ctx.world);
    if (this.glider && flyFrom) this.afterGliderStep(dt, flyFrom);
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
    anim.loco.glider = !!this.glider;
    anim.loco.glideBodyPitch = this.glideAttitude + HANG;
    anim.loco.glideBank = this.glideBank;
    anim.loco.glideSpeed = this.glideSpeedN;
    anim.loco.sliding = body.sliding;
    anim.loco.mounted = !!this.mountAnchor;
    anim.loco.turnRate = turnRate;
    anim.loco.style = this.element;
    anim.loco.idleVariant = this.poseOverride ?? (ctx.avatar.sphereActive ? 'sphere' : ctx.avatar.active && !body.grounded ? 'float' : 'stand');
  }

  // ---------------------------------------------------------------------------
  // Glider (the glider staff)
  // ---------------------------------------------------------------------------

  /**
   * Fly the glider: hold Jump while falling to snap it open; it stays open until you land, touch
   * water, fold it (Dodge) or start bending. Steer with the stick; hold Sprint to dive and build
   * speed, let go to swoop back up; tap Jump to bend a gust of wind under the wings (chi); rising
   * air over the temple cliffs (updrafts) carries you up for free.
   */
  private updateGlider(dt: number, wish: THREE.Vector3, wishLen: number, locked: boolean): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const body = this.body!;
    this.gliderWait = Math.max(0, this.gliderWait - dt);
    if (!this.glider) {
      if (!input.isDown('jump') || body.grounded) this.gliderRearm = false;
      const canOpen =
        !locked && !body.grounded && !body.swimming && !body.inWater && body.velocity.y < -1 && input.isDown('jump') && !this.gliderRearm && this.gliderWait <= 0 && !ctx.combat.isBusy(this) && !this.ride && !this.mountAnchor && !ctx.avatar.sphereActive;
      if (canOpen) this.openGlider();
      return;
    }
    const g = this.glider;
    if (!locked && input.wasPressed('dodge')) {
      this.closeGlider(true);
      return;
    }
    if (body.grounded || body.swimming || body.inWater || ctx.combat.isBusy(this) || this.mountAnchor || ctx.avatar.sphereActive) {
      this.closeGlider(false);
      return;
    }
    const pos = this.root.position;
    // Bend a gust under the wings.
    if (!locked && input.wasPressed('jump')) {
      if (this.chi >= GLIDER.gustCost && gust(g)) {
        this.chi -= GLIDER.gustCost;
        const under = tmpFx.copy(pos).setY(pos.y + 0.4);
        windRing(ctx, under, { r0: 0.4, r1: 2.6, duration: 0.45, height: 0.5, axis: new THREE.Vector3(0, 1, 0), opacity: 0.85 });
        ctx.vfx.burst('air', under, { count: 16, dir: UP, spread: 1.1, speed: 3.2 });
        ctx.audio.play('bend_air_puff', { position: pos, volume: 0.75, pitch: 0.8 });
        ctx.events.emit('glider:gust', { chi: this.chi });
      } else if (this.chi < GLIDER.gustCost) {
        ctx.vfx.burst('air', tmpFx.copy(pos).setY(pos.y + 0.4), { count: 4, speed: 0.6 });
      }
    }
    // Steer: the heading turns toward the stick (camera-relative), at a glider's pace.
    const yaw0 = this.yaw;
    if (!locked && wishLen > 0.1) {
      const want = Math.atan2(wish.x, wish.z);
      const step = GLIDER.turnRate * Math.min(1, wishLen) * dt;
      const d = angleDiff(this.yaw, want);
      this.yaw += Math.max(-step, Math.min(step, d));
    }
    const lift = this.updraftField.liftAt(pos);
    const dive = !locked && input.isDown('sprint');
    const v = stepGlider(g, { dive, updraft: lift }, dt);
    body.gravityScale = 0;
    body.velocity.y = v.vy;
    body.move.set(Math.sin(this.yaw) * v.vh, 0, Math.cos(this.yaw) * v.vh);
    // Attitude follows the flight path (nose down diving, up swooping); glider and flier roll into
    // turns (the bank a real glider needs for the turn, toned down); the cloth billows with speed
    // and the fans flex up under lift, gusts and hard turns.
    const turn = angleDiff(yaw0, this.yaw) / Math.max(dt, 1e-3);
    const speedN = clamp((g.speed - GLIDER.minSpeed) / (GLIDER.maxSpeed - GLIDER.minSpeed), 0, 1);
    this.glideSpeedN = speedN;
    this.glideAttitude = damp(this.glideAttitude, clamp(g.pitch * 0.85 + 0.06, -0.62, 0.5), 5, dt);
    this.glideBank = damp(this.glideBank, clamp(((turn * g.speed) / 9.81) * 0.5, -0.6, 0.6), 4, dt);
    if (this.staff) {
      this.staff.flutter = clamp((g.speed - 6) / 22, 0.15, 1);
      this.staff.load = clamp(g.lift / 9 + lift / 12 + Math.abs(this.glideBank) * 0.6 + Math.max(0, speedN - 0.5) * 0.6, 0, 1);
    }
    this.flightFeel(dt, speedN);
    // Rising air shows as streaks rushing past.
    if (lift > 0.5 && Math.random() < dt * 14) ctx.vfx.burst('air', tmpFx.set(pos.x + (Math.random() - 0.5) * 4, pos.y - 2, pos.z + (Math.random() - 0.5) * 4), { count: 2, dir: UP, speed: 4, spread: 0.2 });
  }

  /** Flying: hair and robes stream in the wind, the air roars louder with speed, streams of air
   *  peel off the fan tips and streaks of air rush past the camera in a dive. */
  private flightFeel(dt: number, speedN: number): void {
    const ctx = this.ctx;
    const body = this.body!;
    // Airflow on hair and cloth (not while the Avatar State's own winds stir them).
    if (!ctx.avatar.active) {
      const t = this.playTime;
      const swirl = 3 + 5 * speedN;
      this.humanoid.wind.set(-body.move.x * 1.6 + Math.sin(t * 9.1) * swirl, -body.velocity.y * 1.2 + 4, -body.move.z * 1.6 + Math.cos(t * 7.3) * swirl);
      this.flightWindOnCloth = true;
    }
    // The roar of the air.
    if (!this.flightWind) this.flightWind = ctx.audio.loop('amb.wind.high', { volume: 0, bus: 'sfx' });
    this.flightWind.setVolume(0.14 + 0.62 * speedN * speedN);
    this.flightWind.setPitch(0.82 + 0.5 * speedN);
    this.flightWind.setParam('intensity', 0.3 + 0.7 * speedN);
    // Streams of air off the big fan's tips (stronger the faster).
    const s = this.staff;
    if (s && s.open > 0.95) {
      if (!this.tipTrails.length) for (let i = 0; i < 2; i++) this.tipTrails.push(windTrail(ctx, 0.09, 0.3, { opacity: 0.4 }));
      const now = ctx.time.elapsed;
      for (let i = 0; i < this.tipTrails.length; i++) {
        const tt = this.tipTrails[i];
        tt.trail.push(s.wingTipWorld(i === 0 ? 1 : -1, tmpFx), now);
        tt.trail.update(now, ctx.camera.position);
        setOpacity(tt.mat, 0.1 + 0.5 * speedN);
      }
    }
    // Streaks of air rushing past at speed.
    if (speedN > 0.45 && Math.random() < dt * (speedN - 0.45) * 40) {
      const cam = ctx.camera;
      const p = tmpFx2.copy(cam.position).addScaledVector(cam.getWorldDirection(tmpFx), 6 + Math.random() * 7);
      p.x += (Math.random() - 0.5) * 8;
      p.y += (Math.random() - 0.5) * 4;
      p.z += (Math.random() - 0.5) * 8;
      ctx.vfx.burst('air', p, { count: 1, dir: tmpFx.set(-body.move.x, -body.velocity.y, -body.move.z), spread: 0.04, speed: 16 + speedN * 16, size: 0.5 });
    }
  }

  /** The glider folded: still air on the cloth, the roar fades, the tip streams drift away. */
  private endFlightFeel(): void {
    if (this.flightWindOnCloth) {
      this.humanoid.wind.set(0, 0, 0);
      this.flightWindOnCloth = false;
    }
    this.flightWind?.stop(0.6);
    this.flightWind = null;
    for (const t of this.tipTrails) releaseWindTrail(this.ctx, t);
    this.tipTrails = [];
  }

  /** After the body moved: flying into something solid stalls the glider and it folds. */
  private afterGliderStep(dt: number, from: THREE.Vector3): void {
    const g = this.glider;
    const body = this.body!;
    if (!g) return;
    const want = Math.hypot(body.move.x, body.move.z) * dt;
    const got = Math.hypot(this.root.position.x - from.x, this.root.position.z - from.z);
    this.gliderBlocked = want > 0.05 && got < want * 0.35 ? this.gliderBlocked + dt : 0;
    if (this.gliderBlocked > 0.2) {
      this.closeGlider(false);
      this.gliderRearm = true;
      body.move.multiplyScalar(0.2);
      return;
    }
    if (body.grounded || body.swimming || body.inWater) this.closeGlider(false);
  }

  private openGlider(): void {
    const body = this.body!;
    const hs = Math.hypot(body.move.x, body.move.z);
    this.glider = newGliderState(Math.max(hs, 9 + Math.min(8, -body.velocity.y * 0.5)));
    this.gliderBlocked = 0;
    this.gliding = true;
    this.airJumps = 0;
    // Caught falling: the glider starts nose down and levels out as the fans bite.
    this.glideAttitude = -0.45;
    this.glideBank = 0;
    this.staff?.setMode('glide', 0.14);
    const pos = this.root.position;
    this.ctx.events.emit('player:glide', { active: true });
    // The fans flick open: cloth snap and a knock, a rush of air, the view kicks out a little.
    this.ctx.audio.play('glider.open', { position: pos, volume: 0.9 });
    this.ctx.audio.play('whoosh', { position: pos, volume: 0.6, pitch: 0.7 });
    this.ctx.events.emit('camera:impulse', { fovKick: 5, pullback: 0.5, duration: 0.5 });
    this.ctx.vfx.burst('air', tmpC.copy(pos).setY(pos.y + 1.4), { count: 14, spread: 1.4, speed: 1.6 });
  }

  /** Fold the glider (byPlayer: Dodge pressed — a short pause before it can snap open again). */
  closeGlider(byPlayer: boolean): void {
    if (!this.glider) return;
    this.glider = null;
    this.gliding = false;
    this.gliderWait = byPlayer ? 0.45 : 0.2;
    const body = this.body!;
    body.gravityScale = 1;
    if (this.staff) {
      this.staff.flutter = 0;
      this.staff.load = 0;
    }
    this.endFlightFeel();
    this.ctx.events.emit('player:glide', { active: false });
    this.ctx.audio.play('glider.fold', { position: this.root.position, volume: 0.8 });
    this.ctx.audio.play('whoosh', { position: this.root.position, volume: 0.35, pitch: 1.35 });
  }

  /** Fold the glider without a sound (a new journey, a load). */
  private foldGliderQuietly(): void {
    if (this.glider) this.ctx.events.emit('player:glide', { active: false });
    this.glider = null;
    this.gliding = false;
    this.gliderWait = 0;
    this.gliderRearm = false;
    if (this.body) this.body.gravityScale = 1;
    if (this.staff) {
      this.staff.flutter = 0;
      this.staff.load = 0;
      this.staff.setMode('back', 0);
    }
    this.endFlightFeel();
    this.glideBank = 0;
    this.glideAttitude = 0;
    this.staffLinger = 0;
    this.updraftField.clear();
  }

  /**
   * Where the staff is this frame: open above the back while gliding; in the hands while
   * airbending (and a moment after); slung on the back otherwise. Also the flight camera.
   */
  private updateStaff(dt: number): void {
    const s = this.staff;
    const cr = this.ctx.cameraRig;
    // Flight camera: pull back and up while the glider is open, swing in behind the heading (a chase
    // camera, unless the player turns it), widen with speed and roll a little with the bank (mounts
    // own the offsets otherwise).
    const camWant = this.glider && !this.mountAnchor ? 1 : 0;
    if (camWant || this.camFlight > 0) {
      this.camFlight = camWant ? Math.min(1, this.camFlight + dt * 1.8) : Math.max(0, this.camFlight - dt * 1.4);
      const k = this.mountAnchor ? 0 : this.camFlight * this.camFlight * (3 - 2 * this.camFlight);
      if (!this.mountAnchor) {
        cr.extraDistance = (1.4 + this.glideSpeedN * 1.2) * k;
        cr.extraHeight = 0.5 * k;
      }
      cr.extraFov = Math.min(10, this.glideSpeedN * 14) * k;
      cr.roll = this.glideBank * 0.22 * k;
    }
    cr.chaseYaw = camWant ? this.yaw : null;
    // Low behind the glider looking out to the horizon; above it looking down a dive; under it in a climb.
    cr.chasePitch = camWant ? clamp(0.14 - this.glideAttitude * 0.6, -0.15, 0.55) : null;
    // Wisps show the updraft columns (always for a glider, else with the ambient effects).
    this.updraftField.update(dt, !!s || this.ctx.settings.data.graphics.ambientEffects);
    if (!s) return;
    const anim = this.humanoid.animator;
    const cast = this.ctx.combat.activeCast(this);
    const airCast = !!cast && cast.phase !== 'done' && cast.def.element === 'air' && !FREE_HANDS.has(cast.def.id);
    if (airCast || (this.chargeId && this.element === 'air')) this.staffLinger = 2.2;
    else this.staffLinger = Math.max(0, this.staffLinger - dt);
    let mode: 'back' | 'hand' | 'glide' = 'back';
    if (this.glider) mode = 'glide';
    else if (this.element === 'air' && this.staffLinger > 0 && !this.mountAnchor && !this.defeated) mode = 'hand';
    s.setMode(mode, mode === 'hand' ? 0.1 : mode === 'glide' ? 0.14 : 0.3);
    s.update(dt);
    // Fists close round the shaft while it is held.
    const held = mode === 'hand' ? 1 : 0;
    anim.grip[0] = held;
    anim.grip[1] = held;
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
    // (Flying a glider, bending the wind keeps the mind busy: chi returns slowly.)
    this.chi = Math.min(this.maxChi, this.chi + (this.glider ? GLIDER.chiRegen : this.sinceCombat > 4 ? 26 : 13) * dt);
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
      this.updateStaff(dt);
      return;
    }

    if (this.defeated) {
      this.play.update(dt, false);
      this.defeatTimer += dt;
      this.body!.move.set(0, 0, 0);
      if (this.glider) this.closeGlider(false);
      this.body!.step(dt, this.root.position, ctx.world);
      this.humanoid.update(dt);
      this.updateStaff(dt);
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
    this.updateStaff(dt);
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
    this.foldGliderQuietly();
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
      const s = originStart(this.ctx.progression.origin, start);
      this.safePoint.set(s.spawn.x, s.spawn.y ?? 0, s.spawn.z);
    }
    if (typeof data.yaw === 'number') this.yaw = data.yaw;
    if (typeof data.playTime === 'number') this.playTime = data.playTime;
  }

  reset(): void {
    this.foldGliderQuietly();
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
