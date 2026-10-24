import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Entity } from '../entities/Entity';
import type { Creature } from './Creature';
import type { CompanionSystem } from './CompanionSystem';

/**
 * Riding: mounting / dismounting transitions, ground riding (walk / run /
 * gallop, jump, swim or refuse deep water) and flight (take-off, climb with
 * Jump, descend with Dodge, boost with Sprint, banking turns, stamina,
 * terrain-following floor, automatic landing). Specials on Interact (E).
 *
 * Bending while mounted: Player.handleCombatInput keeps running in the saddle,
 * so attacks and abilities work from any mount (ground or air). Movement
 * keys drive the mount instead of the rider (Jump = jump / climb, Dodge =
 * descend), so dodges and the glider are unavailable while riding, and the
 * Avatar State dismounts you (CompanionSystem). Waterbending draws are
 * blocked while mounted by the water system.
 */

const CAMERA: Record<string, { dist: number; height: number }> = {
  sky_bison: { dist: 7, height: 2.6 },
  dragon: { dist: 9, height: 2.2 },
  polar_bear_dog: { dist: 1.2, height: 0.5 },
  badgermole: { dist: 1.2, height: 0.4 },
  ostrich_horse: { dist: 0.6, height: 0.3 },
};

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export class RidingController {
  mount: Creature | null = null;
  private trans: { t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; on: boolean } | null = null;
  /** Fly toward this point instead of reading input (tests / scripted). */
  autopilot: THREE.Vector3 | null = null;
  /** Challenge ride (not yet bonded): no saddle, no specials. */
  challengeRide = false;
  stamina = 0;
  private tired = false;
  private emergency = false;
  private specialCd = 0;
  private charging = 0;
  private readonly charged = new Set<number>();
  private tremorT = 0;
  private savedDamageTaken = 1;
  /** Odometer while riding (tests, bond growth). */
  distance = 0;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext) {}

  get transitioning(): boolean {
    return !!this.trans;
  }

  has(ability: string): boolean {
    const c = this.mount;
    if (!c) return false;
    if (this.challengeRide) return ability === 'flight';
    const rec = c.companionId ? this.sys.record(c.companionId) : null;
    return !!rec && rec.abilities.includes(ability);
  }

  staminaMax(c: Creature): number {
    const s = c.def.fly?.stamina ?? 0;
    if (s <= 0) return Infinity;
    return s * (this.hasFor(c, 'endurance') ? 3 : 1);
  }

  private hasFor(c: Creature, ability: string): boolean {
    const rec = c.companionId ? this.sys.record(c.companionId) : null;
    return !!rec && rec.abilities.includes(ability);
  }

  canMount(c: Creature): boolean {
    const p = this.ctx.player;
    return !!p && !this.mount && !p.defeated && c.def.rideable && !c.disposed && (c.mode === 'companion' || this.challengeRide);
  }

  /** Climb onto `c` (short arc transition), then the player follows its saddle. */
  mountUp(c: Creature, opts: { challenge?: boolean } = {}): boolean {
    const p = this.ctx.player;
    if (!p || this.mount || p.defeated || !c.def.rideable || c.disposed) return false;
    if (c.mode !== 'companion' && !opts.challenge) return false;
    if (this.ctx.avatar.active) {
      this.ctx.events.emit('ui:notify', { text: 'You cannot ride while in the Avatar State.', kind: 'warning', duration: 2.5 });
      return false;
    }
    this.challengeRide = !!opts.challenge;
    this.mount = c;
    c.setState('ridden');
    c.autoAvoid = false;
    c.stopMoving();
    c.lookAt = null;
    c.model.setSaddle(c.mode === 'companion');
    const seat = this.seatPos(c, tmpA);
    this.trans = { t: 0, dur: 0.55, from: p.position.clone(), to: seat.clone(), on: true };
    p.controlLock = Math.max(p.controlLock, 0.6);
    const max = this.staminaMax(c);
    this.stamina = Number.isFinite(max) ? Math.min(max, this.stamina > 0 ? this.stamina : max) : Infinity;
    this.tired = false;
    this.emergency = false;
    this.distance = 0;
    const cam = CAMERA[c.def.id] ?? { dist: 1, height: 0.4 };
    this.ctx.cameraRig.extraDistance = cam.dist;
    this.ctx.cameraRig.extraHeight = cam.height;
    this.ctx.audio.play(c.def.sounds.content ?? c.def.sounds.call, { position: c.aimPoint(tmpB), volume: 0.7 });
    return true;
  }

  private seatPos(c: Creature, out: THREE.Vector3): THREE.Vector3 {
    c.model.root.updateMatrixWorld(true);
    const seat = c.model.seat;
    if (seat) return seat.getWorldPosition(out);
    return out.copy(c.position).setY(c.position.y + c.height);
  }

  /**
   * Get off. Refuses high above ground unless forced (forced dismounts in
   * flight drop the rider, who lands with the normal physics).
   */
  dismount(force = false): boolean {
    const c = this.mount;
    const p = this.ctx.player;
    if (!c || !p) return false;
    if (this.trans?.on) {
      // Cancel mid-climb.
      this.trans = null;
    }
    const alt = c.position.y - c.groundY(c.position.x, c.position.z, c.position.y + 1);
    if (c.flying && alt > 6 && !force) {
      this.ctx.events.emit('ui:notify', { text: `Too high to jump off — hold ${this.ctx.input.label('dodge')} to descend and land first.`, kind: 'warning', duration: 2.5 });
      return false;
    }
    // Safe ground beside the mount: left (+X local), right, behind, then a search.
    let to: THREE.Vector3 | null = null;
    const side = c.radius + 1.2;
    const cands = [
      [Math.cos(c.yaw) * side, -Math.sin(c.yaw) * side],
      [-Math.cos(c.yaw) * side, Math.sin(c.yaw) * side],
      [-Math.sin(c.yaw) * (c.radius * 1.8 + 1), -Math.cos(c.yaw) * (c.radius * 1.8 + 1)],
    ];
    if (!(c.flying && alt > 6)) {
      for (const [dx, dz] of cands) {
        const x = c.position.x + dx, z = c.position.z + dz;
        const g = this.ctx.world.groundAt(x, z, c.position.y + 3);
        const w = this.ctx.world.liquidAt(x, z);
        if (w && w.level - g.y > 1.2) continue;
        if (Math.abs(g.y - c.position.y) > 3 && !c.flying) continue;
        if (!this.ctx.world.hasLineOfSight(tmpA.copy(c.position).setY(c.position.y + 1), tmpB.set(x, g.y + 1, z))) continue;
        to = new THREE.Vector3(x, g.y + 0.05, z);
        break;
      }
      to ??= c.findStandSpot(c.position.x, c.position.z, c.radius + 1, c.radius + 10);
    }
    p.mountAnchor = null;
    if (to) this.trans = { t: 0, dur: 0.42, from: p.position.clone(), to, on: false };
    else {
      // Mid-air drop: the rider falls from the saddle.
      p.body!.velocity.set(0, 0, 0);
      p.body!.grounded = false;
    }
    p.damageTaken = this.savedDamageTaken || 1;
    c.autoAvoid = true;
    c.climbInput = 0;
    c.phaseWalls = false;
    c.model.root.position.y = 0;
    c.stopMoving();
    if (c.mode === 'companion') c.setState('follow');
    else c.setState('idle', 3);
    if (c.flying && force && c.mode === 'companion') c.land();
    this.mount = null;
    this.autopilot = null;
    this.challengeRide = false;
    this.ctx.cameraRig.extraDistance = 0;
    this.ctx.cameraRig.extraHeight = 0;
    const was = this.sys.mounted;
    this.sys.mounted = false;
    this.sys.mountedFlying = false;
    if (was) this.ctx.events.emit('mount:changed', { companionId: null, flying: false });
    return true;
  }

  /** Drop everything immediately (session end). */
  reset(): void {
    const p = this.ctx.player;
    if (p) p.mountAnchor = null;
    if (this.mount) {
      this.mount.autoAvoid = true;
      this.mount.phaseWalls = false;
    }
    this.mount = null;
    this.trans = null;
    this.autopilot = null;
    this.challengeRide = false;
    this.ctx.cameraRig.extraDistance = 0;
    this.ctx.cameraRig.extraHeight = 0;
    this.sys.mounted = false;
    this.sys.mountedFlying = false;
  }

  /** Heavy damage: ground mounts throw you, flying mounts make an emergency landing. */
  onHeavyHit(): void {
    const c = this.mount;
    if (!c) return;
    if (c.flying) {
      this.emergency = true;
      c.land();
      this.ctx.events.emit('ui:notify', { text: `${c.name} is hurt and dives to land!`, kind: 'warning', duration: 2.5 });
    } else {
      this.dismount(true);
      this.ctx.player?.body?.impulse(0, 4, 0);
      this.ctx.events.emit('ui:notify', { text: 'You are thrown from the saddle!', kind: 'warning', duration: 2 });
    }
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    // Mount / dismount transition (runs after the player's own update).
    if (this.trans) {
      const tr = this.trans;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      const e = k * k * (3 - 2 * k);
      if (tr.on && this.mount) this.seatPos(this.mount, tr.to);
      p.root.position.lerpVectors(tr.from, tr.to, e);
      p.root.position.y += Math.sin(k * Math.PI) * (tr.on ? 1.2 : 0.8);
      p.body!.velocity.set(0, 0, 0);
      p.controlLock = Math.max(p.controlLock, 0.1);
      if (k >= 1) {
        this.trans = null;
        if (tr.on && this.mount) {
          p.mountAnchor = this.mount.model.seat ?? this.mount.model.root;
          this.savedDamageTaken = p.damageTaken;
          if (this.has('fortify')) p.damageTaken = this.savedDamageTaken * 0.67;
          this.sys.mounted = true;
          this.sys.mountedFlying = this.mount.flying;
          ctx.events.emit('mount:changed', { companionId: this.mount.companionId ?? this.mount.uid, flying: this.mount.flying });
        } else if (!tr.on) {
          p.teleport(tr.to);
          p.controlLock = 0;
        }
      }
      if (this.mount) {
        this.mount.stopMoving();
        this.mount.locomote(dt);
        this.mount.animate(dt);
      }
      return;
    }
    const c = this.mount;
    if (!c) return;
    if (c.disposed || p.defeated) {
      this.reset();
      return;
    }
    this.specialCd = Math.max(0, this.specialCd - dt);
    const before = tmpA.copy(c.position);
    if (this.autopilot) this.autopilotStep(c);
    else this.inputStep(c, dt);
    c.locomote(dt);
    c.animate(dt);
    this.distance += Math.hypot(c.position.x - before.x, c.position.z - before.z);
    this.perks(c, dt);
    // Flying state changes.
    if (c.flying !== this.sys.mountedFlying) {
      this.sys.mountedFlying = c.flying;
      ctx.events.emit('mount:changed', { companionId: c.companionId ?? c.uid, flying: c.flying });
      if (!c.flying && this.emergency) {
        this.emergency = false;
        this.dismount(true);
        return;
      }
    }
    // Rider follows the saddle exactly (no one-frame lag).
    c.model.root.updateMatrixWorld(true);
    const seat = c.model.seat ?? c.model.root;
    seat.getWorldPosition(p.root.position);
    seat.getWorldQuaternion(tmpQ);
    p.yaw = tmpE.setFromQuaternion(tmpQ, 'YXZ').y;
    p.root.rotation.y = p.yaw;
    p.body!.velocity.set(0, 0, 0);
    p.safePoint.copy(c.position);
  }

  private inputStep(c: Creature, dt: number): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const blocked = ctx.ui.blocksGameplay;
    const camF = ctx.camera.getWorldDirection(tmpB).setY(0);
    if (camF.lengthSq() < 1e-6) camF.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    camF.normalize();
    const mv = blocked ? { x: 0, y: 0 } : input.move;
    const wx = camF.x * mv.y + -camF.z * mv.x;
    const wz = camF.z * mv.y + camF.x * mv.x;
    const wishLen = Math.min(1, Math.hypot(wx, wz));
    const wishYaw = wishLen > 0.05 ? Math.atan2(wx, wz) : c.yaw;
    const d = c.def;
    const rec = c.companionId ? this.sys.record(c.companionId) : null;
    c.turnMul = 1 + (rec ? rec.bond / 150 : 0);
    const sprint = !blocked && input.isDown('sprint');
    const jump = !blocked && input.isDown('jump');
    const jumpPressed = !blocked && input.wasPressed('jump');
    const down = !blocked && input.isDown('dodge');
    if (c.flying && d.fly) {
      const f = d.fly;
      const boosting = sprint && this.has('boost') && !this.tired;
      let speed = wishLen > 0.1 ? (boosting ? f.boost : f.cruise) * Math.min(1, 0.35 + wishLen) : 3;
      if (this.tired) speed = Math.min(speed, f.cruise * 0.6);
      c.steer(wishYaw, speed);
      c.climbInput = this.tired || this.emergency ? 0 : jump ? 1 : down ? -1 : 0;
      // Stamina (bison).
      if (Number.isFinite(this.stamina)) {
        const drain = boosting ? 2.5 : this.has('carry') ? 0 : 1;
        this.stamina = Math.max(0, this.stamina - drain * dt);
        if (this.stamina <= 0 && !this.tired) {
          this.tired = true;
          c.land();
          ctx.events.emit('ui:notify', { text: `${c.name} is exhausted and glides down to rest.`, kind: 'warning', duration: 3 });
        }
      }
      // Landing: descend close to the ground.
      const alt = c.position.y - c.groundY(c.position.x, c.position.z, c.position.y + 1);
      if ((down && alt < 3.5) || this.tired) c.land();
      if (jumpPressed && c.landing && !this.tired && !this.emergency) {
        c.landing = false;
        c.wantAlt = NaN;
      }
    } else {
      // Ground.
      const max = this.staminaMax(c);
      if (Number.isFinite(max)) {
        this.stamina = Math.min(max, this.stamina + 6 * dt);
        if (this.tired && this.stamina > max * 0.35) this.tired = false;
      }
      let speed = wishLen < 0.05 ? 0 : wishLen < 0.5 ? d.walk : d.run;
      if (sprint && wishLen > 0.3 && (this.has('sprint') || d.id === 'ostrich_horse' && this.has('ride'))) speed = d.sprint * (this.has('windrunner') ? 1.18 : 1);
      if (this.charging > 0) speed = d.sprint * 1.3;
      // Badgermole burrowing: tunnel under walls.
      const burrow = sprint && this.has('burrow') && wishLen > 0.1;
      c.phaseWalls = burrow;
      c.model.root.position.y = burrow ? -c.height * 0.55 : 0;
      if (burrow) {
        speed = d.run;
        if (Math.random() < dt * 8) ctx.vfx.burst('debris', c.position, { count: 3, speed: 2 });
      }
      c.steer(wishYaw, speed);
      c.climbInput = 0;
      if (jumpPressed) {
        if (d.flying && (this.has('flight') || this.challengeRide)) {
          if (this.tired) ctx.events.emit('ui:notify', { text: `${c.name} needs to rest before flying again.`, kind: 'info', duration: 2 });
          else c.takeOff(c.position.y + 6);
        } else if (d.jump > 0 && c.body!.grounded) c.body!.launch(d.jump * (this.has('leap') ? 1.45 : 1));
      }
      if (!c.body!.canSwim && c.body!.waterDepth > d.wadeDepth * 0.8 && Math.random() < dt * 0.6) {
        ctx.events.emit('ui:notify', { text: `${c.name} refuses to go into deep water.`, kind: 'info', duration: 1.5 });
      }
    }
    if (!blocked && input.wasPressed('interact') && !ctx.interactions.current) this.special(c);
  }

  /** Steer toward the autopilot target using the same flight model. */
  private autopilotStep(c: Creature): void {
    const t = this.autopilot!;
    const f = c.def.fly;
    if (!c.flying) c.takeOff(t.y);
    const yaw = Math.atan2(t.x - c.position.x, t.z - c.position.z);
    const dist = Math.hypot(t.x - c.position.x, t.z - c.position.z);
    c.steer(yaw, f ? Math.min(f.cruise, Math.max(6, dist * 0.6)) : c.def.run);
    const dy = t.y - c.position.y;
    c.climbInput = dy > 2 ? 1 : dy < -2 ? -0.6 : 0;
  }

  // ---------------------------------------------------------------- specials & perks

  private hostilesNear(center: THREE.Vector3, radius: number): Entity[] {
    return this.ctx.entities.queryRadius(center, radius, { teams: ['hostile'], aliveOnly: true }).concat(this.ctx.entities.queryRadius(center, radius, { kinds: ['target'], aliveOnly: true }));
  }

  /** Companion attack through the CombatSystem (the companion is the attacker). */
  hitCone(c: Creature, origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number, info: { damage: number; element: 'fire' | 'air' | 'earth'; techniqueId: string; knockback?: number; launch?: number; burn?: boolean }): number {
    let n = 0;
    for (const e of this.hostilesNear(origin, range + 2)) {
      if (this.charged.has(e.id) && info.techniqueId === 'companion_charge') continue;
      const ap = e.aimPoint(tmpA);
      const dx = ap.x - origin.x, dz = ap.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + e.radius) continue;
      if (dist > 0.5 && Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.z) / (dist * Math.hypot(dir.x, dir.z) || 1)))) > halfAngle) continue;
      const kb = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(info.knockback ?? 0);
      const res = this.ctx.combat.applyHit(c, e, {
        attacker: c,
        damage: info.damage,
        element: info.element,
        techniqueId: info.techniqueId,
        knockback: kb,
        launch: info.launch,
        stagger: 20,
        status: info.burn ? [{ type: 'burn', duration: 3, magnitude: 1 }] : undefined,
        point: ap.clone(),
      });
      if (res) {
        n++;
        if (info.techniqueId === 'companion_charge') this.charged.add(e.id);
      }
    }
    return n;
  }

  /** Dragonfire (also used by the summoned dragon's guard behaviour). */
  breathFire(c: Creature, dir: THREE.Vector3): number {
    const inferno = this.hasFor(c, 'inferno');
    const mouth = c.model.mouth.getWorldPosition(new THREE.Vector3());
    const range = inferno ? 22 : 16;
    for (let i = 0; i < 4; i++) {
      const p = mouth.clone().addScaledVector(dir, 2 + i * (range / 4));
      this.ctx.vfx.burst('flame', p, { count: 10, dir, spread: 0.35, speed: 9, size: 1.4 + i * 0.4 });
    }
    this.ctx.vfx.flash(mouth, '#ff9a40', 8, 0.3, 20);
    this.ctx.audio.play('creature.dragon.roar', { position: mouth, volume: 0.9 });
    this.ctx.events.emit('bending:heat', { position: { x: mouth.x + dir.x * range * 0.5, y: mouth.y, z: mouth.z + dir.z * range * 0.5 }, radius: range * 0.5, intensity: 2, casterId: c.id });
    return this.hitCone(c, mouth, dir, range, inferno ? 0.7 : 0.5, { damage: inferno ? 34 : 22, element: 'fire', techniqueId: 'companion_dragonfire', knockback: 6, burn: true });
  }

  private special(c: Creature): void {
    if (this.specialCd > 0 || this.challengeRide) return;
    const ctx = this.ctx;
    const aim = ctx.player!.aimDir.clone().setY(0);
    if (aim.lengthSq() < 1e-4) aim.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    aim.normalize();
    const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    if (this.has('fire_breath')) {
      this.breathFire(c, ctx.player!.aimDir.clone().normalize());
      this.specialCd = 2.2;
    } else if (this.has('gust')) {
      const o = c.aimPoint(new THREE.Vector3());
      ctx.vfx.burst('air', o.clone().addScaledVector(fwd, 4), { count: 30, dir: fwd, spread: 0.6, speed: 14 });
      ctx.vfx.ring(o, '#eef6ff', 10, 0.6);
      ctx.audio.play('creature.skybison.groan', { position: o });
      this.hitCone(c, o, fwd, 14, 0.8, { damage: 14, element: 'air', techniqueId: 'companion_gust', knockback: 18, launch: 4 });
      this.specialCd = 4;
    } else if (this.has('charge')) {
      this.charging = 1.6;
      this.charged.clear();
      ctx.audio.play(c.def.sounds.alarm, { position: c.position });
      this.specialCd = 5;
    } else if (this.has('kick')) {
      const o = c.aimPoint(new THREE.Vector3());
      c.forcedAction = 'kick';
      setTimeout(() => {
        if (c.forcedAction === 'kick') c.forcedAction = null;
      }, 600);
      ctx.vfx.burst('dust', o.clone().addScaledVector(fwd, 1.5), { count: 10, speed: 3 });
      this.hitCone(c, o, fwd, 3.5, 0.9, { damage: 16, element: 'earth', techniqueId: 'companion_kick', knockback: 14, launch: 6 });
      this.specialCd = 1.6;
    } else if (this.has('dig')) {
      const surf = c.body!.surface;
      c.forcedAction = 'dig';
      setTimeout(() => {
        if (c.forcedAction === 'dig') c.forcedAction = null;
      }, 1500);
      ctx.vfx.burst('debris', c.position, { count: 16, speed: 3 });
      this.specialCd = 12;
      if (surf === 'dirt' || surf === 'grass' || surf === 'sand' || surf === 'mud') {
        const r = Math.random();
        const item = r < 0.15 ? 'jade_shard' : r < 0.6 ? 'glowing_mushroom' : null;
        if (item) ctx.inventory.add(item, 1);
        else ctx.events.emit('ui:notify', { text: 'Nothing here but worms.', kind: 'info', duration: 1.5 });
      } else ctx.events.emit('ui:notify', { text: 'The ground is too hard to dig here.', kind: 'info', duration: 1.5 });
    }
  }

  private perks(c: Creature, dt: number): void {
    if (this.charging > 0) {
      this.charging -= dt;
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      this.hitCone(c, c.aimPoint(new THREE.Vector3()), fwd, c.radius + 2.2, 1.1, { damage: 18, element: 'earth', techniqueId: 'companion_charge', knockback: 16, launch: 3 });
    }
    if (this.has('tremor')) {
      this.tremorT -= dt;
      if (this.tremorT <= 0) {
        this.tremorT = 6;
        const revealed = this.ctx.entities.queryRadius(c.position, 40, { teams: ['hostile'] }).map((e) => e.id);
        this.ctx.vfx.ring(c.position, '#c8a060', 40, 1.2);
        this.ctx.events.emit('seismic:pulse', { position: { x: c.position.x, y: c.position.y, z: c.position.z }, radius: 40, casterId: c.id, revealed });
      }
    }
  }
}
