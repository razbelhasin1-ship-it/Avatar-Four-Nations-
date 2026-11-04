import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import { Enemy } from '../../ai/Enemy';
import type { Combatant } from '../../combat/types';
import type { GameContext, GameSystem } from '../../core/GameContext';
import type { TechniqueFailReason } from '../../core/types';
import { BLOOD, STRAIN } from '../../data/subskills';
import type { Entity } from '../../entities/Entity';
import type { LavaSystem } from '../lava/LavaSystem';
import type { MoonSystem } from '../Moon';
import type { SubSkillSystem } from '../SubSkills';
import { h } from '../../ui/dom';
import './clips';
import { guardHud } from '../hudGuard';

/**
 * Bloodbending (Water sub-skill, The Last Airbender level).
 *
 * A hold seizes the water in a living body: the target freezes, fully aware, unable to move or
 * bend (Entity.held: enemies and NPCs skip their own AI, tryCast refuses). While holding you can
 * steer it on a short leash (Puppet: walk, turn, shove, drop a weapon), turn its attack on another
 * hostile (Redirect), hold a second body at high Water mastery, and Release at will.
 *
 * Rules: only on the full-moon night with the moon up (moonless use only with the Korra flag and
 * its training); every hold ends at sunrise; living targets only (no spirits, no machines); never
 * damages or kills by itself; never forces an ally or innocent into harm (no lava, no deep water,
 * no drops) and redirected attacks land only on hostiles. A hold breaks when you are hurt (lost
 * concentration), at sunrise, when chi runs out, out of range or sight, when the target is a
 * waterbender of equal or greater skill (a struggle, then they break free) or in the Avatar State,
 * and — safely — on defeat, travel, cutscenes and the end of a session. Heavy continuous chi per
 * target; every use adds Moral Strain (SubSkillSystem).
 * The same runtime lets scripted characters (Hama) hold the player and allies.
 */

export interface Hold {
  holder: Entity;
  target: Entity;
  t: number;
  hostile: boolean;
  startX: number;
  startZ: number;
  /** Equal or stronger waterbender: seconds of struggle before breaking free (0 = none). */
  resist: number;
  struggle: number;
  subdue: boolean;
  puppetMove: THREE.Vector3;
  lines: THREE.LineSegments;
  disarmedUntil: number;
  lastSeen: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const LIMBS = ['handL', 'handR', 'footL', 'footR', 'head'] as const;

export class BloodbendingSystem implements GameSystem {
  private ctx!: GameContext;
  readonly holds: Hold[] = [];
  /** Puppet mode: your movement keys steer the held body instead of your own. */
  puppeting = false;
  private hum: LoopHandle | null = null;
  private lineMat: THREE.LineBasicMaterial | null = null;
  private creakT = 0;
  private struggleEl: HTMLElement | null = null;
  private struggleFill: HTMLElement | null = null;
  private struggleText: HTMLElement | null = null;
  /** The player is held by someone else (scripted: Hama). */
  playerHold: Hold | null = null;
  /** Mash-to-break progress when the player is held (draw on the moon). */
  breakFree = 0;
  readonly stats = { holds: 0, released: {} as Record<string, number>, redirects: 0, shoves: 0, resisted: 0, lifts: 0 };
  /** Quest scripts: told whenever a hold starts or ends. */
  readonly listeners: Array<(h: Hold, started: boolean, reason?: string) => void> = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('moon:sunrise', () => this.releaseAll('sunrise'));
    ctx.events.on('player:damaged', () => this.releaseByPlayer('concentration'));
    ctx.events.on('player:defeated', () => this.releaseAll('defeated'));
    ctx.events.on('travel:started', () => this.releaseAll('travel'));
    ctx.events.on('session:ending', () => this.releaseAll('session'));
    ctx.events.on('avatarState:changed', (e) => {
      // The Avatar State nullifies a hold on the Avatar.
      if (e.active && this.playerHold) this.release(this.playerHold, 'avatarState');
    });
    // Disarmed bodies cannot start attacks for a moment.
    Enemy.thinkHooks.push((en) => {
      const until = (en as unknown as { _disarmedUntil?: number })._disarmedUntil ?? 0;
      if (until > ctx.time.elapsed) en.attackToken = false;
    });
    this.buildStruggle();
    this.installDebug();
  }

  onSessionEnd(): void {
    this.releaseAll('session');
  }

  get holding(): number {
    return this.holds.filter((h) => h.holder === this.ctx.player).length;
  }

  private subs(): SubSkillSystem | undefined {
    return this.ctx.extra.get('subskills') as SubSkillSystem | undefined;
  }

  private moon(): MoonSystem | undefined {
    return this.ctx.extra.get('moon') as MoonSystem | undefined;
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------

  /** Moon rule for the player: the full moon is up (or the Korra moonless extension). */
  moonAllows(): boolean {
    const s = this.subs();
    if (s?.korraFlag('ENABLE_MOONLESS_BLOODBENDING') && s.moonlessTrained) return true;
    return !!this.moon()?.fullMoonUp;
  }

  /** Why the player cannot bloodbend right now (vow, strain lock, moon), or null. */
  playerGate(): { reason: TechniqueFailReason; message: string } | null {
    const s = this.subs();
    if (s?.breakingLock) return { reason: 'locked', message: 'Your mind is breaking. Meditate with an elder before you bloodbend again.' };
    if (s?.vow === 'kept' && !s.emotionalMoment) return { reason: 'locked', message: 'You vowed never to bloodbend again.' };
    if (!this.moonAllows()) {
      const m = this.moon();
      const n = m?.nightsToFull() ?? 0;
      const when = m?.isFullMoonNight ? 'Wait for the moon to rise.' : n === 0 ? 'The full moon rises tonight.' : `The next full moon is ${n} night${n === 1 ? '' : 's'} away.`;
      return { reason: 'state', message: `Bloodbending needs the full moon in the sky. ${when}` };
    }
    return null;
  }

  /** Living bodies only: people and animals; never spirits, machines or training dummies. */
  living(e: Entity): boolean {
    if (!e.alive || !e.health) return false;
    if (e.kind !== 'enemy' && e.kind !== 'npc' && e.kind !== 'creature' && e.kind !== 'player') return false;
    if (e.tags.has('spirit') || e.tags.has('machine') || e.tags.has('construct')) return false;
    return true;
  }

  /** Water skill: equal or greater than the bender's means the target can resist. */
  waterSkill(e: Entity): number {
    const ctx = this.ctx;
    if (e === ctx.player) {
      const m = ctx.progression.mastery.water;
      return m.proficiency / 80 + (m.mastered ? 2 : 0);
    }
    const c = e as unknown as { element?: string; level?: number };
    if (c.element !== 'water') return -1;
    return (c.level ?? 1) / 3 + (e.tags.has('boss') ? 3 : 0) + (e.tags.has('master') || e.tags.has('waterMaster') ? 4 : 0);
  }

  maxHolds(holder: Entity): number {
    if (holder !== this.ctx.player) return 2;
    const pr = this.ctx.progression;
    return pr.knows('blood_second') && pr.mastery.water.proficiency >= BLOOD.secondHoldProficiency ? 2 : 1;
  }

  canSee(a: Entity, b: Entity): boolean {
    const from = (a as unknown as Combatant).castOrigin ? (a as unknown as Combatant).castOrigin('chest', tmpA) : tmpA.copy(a.position).setY(a.position.y + 1.4);
    const to = b.aimPoint(tmpB);
    const d = from.distanceTo(to);
    if (d < 1) return true;
    const dir = tmpC.copy(to).sub(from).normalize();
    return !this.ctx.world.raycast(from, dir, d - 0.4);
  }

  /** Best target for the player: lock-on / the one aimed at, living, in sight and range, not already held. */
  pickTarget(range: number = BLOOD.hold.range): Entity | null {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return null;
    const lock = (p as unknown as { lockTarget?: Entity | null }).lockTarget;
    const ok = (e: Entity) => e !== p && this.living(e) && !e.held && e.position.distanceTo(p.position) <= range && this.canSee(p, e);
    if (lock && ok(lock)) return lock;
    // Own vectors: canSee() below uses the shared scratch ones.
    const origin = p.castOrigin('chest', new THREE.Vector3());
    const dir = new THREE.Vector3().copy(p.aimPoint3).sub(origin).normalize();
    const to = new THREE.Vector3();
    let best: Entity | null = null;
    let bs = Infinity;
    for (const e of ctx.entities.queryRadius(p.position, range)) {
      if (!ok(e)) continue;
      e.aimPoint(to).sub(origin);
      const d = to.length();
      const ang = to.normalize().angleTo(dir);
      if (ang > 0.35) continue;
      const score = ang * 25 + d * 0.15 + (e.team === 'hostile' ? 0 : 4);
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Holding
  // ---------------------------------------------------------------------------

  /** Seize `target` (the holder pays and is responsible). Returns the hold, or null. */
  hold(holder: Entity, target: Entity, o: { subdue?: boolean } = {}): Hold | null {
    const ctx = this.ctx;
    if (!this.living(target) || target.held || target === holder) return null;
    if (this.holds.filter((x) => x.holder === holder).length >= this.maxHolds(holder)) return null;
    const isPlayer = holder === ctx.player;
    // Stop the bending act or attack in progress.
    const c = target as unknown as Combatant;
    if ((c as { humanoid?: unknown }).humanoid !== undefined) ctx.combat.interrupt(c, false);
    if (target instanceof Enemy) target.cancelAttack(ctx);
    target.held = { by: holder.id, move: new THREE.Vector3(), yaw: null };
    const hostile = target.team === 'hostile';
    const resistSkill = this.waterSkill(target);
    const mySkill = this.waterSkill(holder);
    const avatar = target === ctx.player && ctx.avatar.active;
    const hold: Hold = {
      holder,
      target,
      t: 0,
      hostile,
      startX: target.position.x,
      startZ: target.position.z,
      resist: avatar ? 0.05 : resistSkill >= 0 && resistSkill >= mySkill && isPlayer ? BLOOD.struggleTime : 0,
      struggle: 0,
      subdue: !!o.subdue,
      puppetMove: new THREE.Vector3(),
      lines: this.makeLines(),
      disarmedUntil: 0,
      lastSeen: ctx.time.elapsed,
    };
    this.holds.push(hold);
    this.stats.holds++;
    ctx.scene.add(hold.lines);
    // The marionette pose.
    const hum = (target as unknown as { humanoid?: { animator: { play(id: string, o?: object): unknown } } | null }).humanoid;
    hum?.animator.play('blood_held', { fadeIn: 0.08, hold: true });
    if (target === ctx.player) {
      this.playerHold = hold;
      this.breakFree = 0;
    }
    if (isPlayer) {
      const s = this.subs();
      s?.addStrain(hostile ? STRAIN.holdStartHostile : STRAIN.holdStartInnocent);
      s?.noteUse('blood', 'blood_hold');
      s?.witnessHold(target.position.x, target.position.z);
      // Psychic holds need no gesture; otherwise the hands curl into rigid claws.
      if (!hold.subdue) (ctx.player as { humanoid?: { animator: { play(id: string, o?: object): unknown } } | null } | null)?.humanoid?.animator.play('blood_bend', { fadeIn: 0.15, hold: true });
    }
    ctx.audio.play('sub.blood.creak', { position: target.position, volume: 0.9 });
    if (!this.hum) this.hum = ctx.audio.loop('sub.blood.hum', { volume: 0.8 });
    ctx.events.emit('bloodbending:hold', { targetId: target.id, active: true, hostile, byPlayer: isPlayer });
    for (const l of this.listeners) l(hold, true);
    return hold;
  }

  release(h: Hold, reason: string): void {
    const i = this.holds.indexOf(h);
    if (i < 0) return;
    const ctx = this.ctx;
    this.holds.splice(i, 1);
    const t = h.target;
    if (t.held && t.held.by === h.holder.id) t.held = null;
    const hum = (t as unknown as { humanoid?: { animator: { stop(id?: string, f?: number): void } } | null }).humanoid;
    hum?.animator.stop('blood_held', 0.25);
    h.lines.removeFromParent();
    h.lines.geometry.dispose();
    if (h === this.playerHold) {
      this.playerHold = null;
      this.breakFree = 0;
      if (ctx.player) ctx.player.controlLock = 0;
    }
    this.stats.released[reason] = (this.stats.released[reason] ?? 0) + 1;
    const byPlayer = h.holder === ctx.player;
    if (byPlayer && !this.holds.some((x) => x.holder === ctx.player)) {
      (ctx.player as { humanoid?: { animator: { stop(id?: string, f?: number): void } } | null } | null)?.humanoid?.animator.stop('blood_bend', 0.3);
      this.puppeting = false;
    }
    if (!this.holds.length) {
      try {
        this.hum?.stop(0.4);
      } catch {
        /* stopped */
      }
      this.hum = null;
    }
    ctx.audio.play('sub.blood.release', { position: t.position, volume: 0.7 });
    ctx.events.emit('bloodbending:hold', { targetId: t.id, active: false, hostile: h.hostile, reason, byPlayer });
    const msg: Record<string, string> = {
      sunrise: 'The sun rises — the hold dissolves.',
      concentration: 'Pain breaks your concentration — the hold slips.',
      resisted: `${t.name} breaks free — a waterbender as strong as you.`,
      chi: 'Your chi is spent — the hold slips.',
      sight: 'You lost sight of them — the hold slips.',
      avatarState: 'The Avatar State tears the hold apart.',
    };
    if (byPlayer && msg[reason]) ctx.events.emit('ui:notify', { text: msg[reason], kind: reason === 'sunrise' ? 'info' : 'warning', duration: 3 });
    for (const l of this.listeners) l(h, false, reason);
  }

  releaseAll(reason: string): void {
    for (const h of [...this.holds]) this.release(h, reason);
  }

  /** The player's own holds. */
  releaseByPlayer(reason: string): void {
    for (const h of [...this.holds]) if (h.holder === this.ctx.player) this.release(h, reason);
  }

  // ---------------------------------------------------------------------------
  // Puppet, redirect, lift
  // ---------------------------------------------------------------------------

  /** Toggle puppet mode (your movement steers the held body). */
  togglePuppet(): boolean {
    if (!this.holding) return false;
    const target = this.holds.find((x) => x.holder === this.ctx.player && !x.subdue);
    if (!target) return false;
    this.puppeting = !this.puppeting;
    this.ctx.events.emit('ui:notify', { text: this.puppeting ? 'Puppet: your movement steers them. Attack to shove, Aim to make them drop their weapon.' : 'You stop steering them.', kind: 'info', duration: 3 });
    return true;
  }

  /** Is (x, z) unsafe for a body that must not be harmed (lava, deep water, a drop)? */
  private unsafe(x: number, z: number, fromY: number): boolean {
    const ctx = this.ctx;
    const lava = ctx.extra.get('lava') as LavaSystem | undefined;
    if (lava?.lavaAt(x, z, 0.8)) return true;
    const g = ctx.world.groundAt(x, z, fromY + 1.2);
    if (fromY - g.y > 2.5) return true;
    const w = ctx.world.liquidAt(x, z);
    if (w && w.level - g.y > 0.9) return true;
    return false;
  }

  /** Shove: the held body lunges stiffly; only hostiles in front are pushed (no damage). */
  shove(): boolean {
    const ctx = this.ctx;
    const h = this.holds.find((x) => x.holder === ctx.player && !x.subdue);
    if (!h) return false;
    const t = h.target;
    const f = tmpA.set(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    (t as unknown as { humanoid?: { animator: { play(id: string, o?: object): unknown } } | null }).humanoid?.animator.play('blood_shove', { fadeIn: 0.03 });
    for (const e of ctx.entities.queryRadius(tmpB.copy(t.position).addScaledVector(f, 1.3), 1.4)) {
      if (e === t || e === ctx.player || e.team !== 'hostile' || !e.body) continue;
      e.body.velocity.addScaledVector(f, 7);
      e.stunned = Math.max(e.stunned, 0.6);
    }
    this.stats.shoves++;
    ctx.audio.play('sub.blood.creak', { position: t.position, volume: 0.6, pitch: 1.3 });
    return true;
  }

  /** Make the held body drop its weapon: it cannot attack for a while. */
  disarm(): boolean {
    const ctx = this.ctx;
    const h = this.holds.find((x) => x.holder === ctx.player && !x.subdue);
    if (!h) return false;
    (h.target as unknown as { _disarmedUntil?: number })._disarmedUntil = ctx.time.elapsed + 8;
    ctx.vfx.burst('debris', h.target.position.clone().setY(h.target.position.y + 1), { count: 2, speed: 2, size: 0.1, color: '#6b5a4a' });
    ctx.events.emit('ui:notify', { text: `${h.target.name}'s grip opens — the weapon falls.`, kind: 'info', duration: 2.5 });
    return true;
  }

  /**
   * Redirect: the held body's attack is turned on another hostile (it never lands on an ally or an
   * innocent). Damage comes from the attack, the bloodbender is responsible.
   */
  redirect(dealHit: (victim: Entity, damage: number) => void): Entity | null {
    const ctx = this.ctx;
    const h = this.holds.find((x) => x.holder === ctx.player && !x.subdue);
    if (!h) return null;
    const t = h.target;
    let best: Entity | null = null;
    let bd: number = BLOOD.redirect.range;
    for (const e of ctx.entities.queryRadius(t.position, BLOOD.redirect.range)) {
      if (e === t || e === ctx.player || e.team !== 'hostile' || !e.alive || !e.health || !this.living(e)) continue;
      const d = e.position.distanceTo(t.position);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return null;
    // The body turns, stiffly, and the attack it was making flies at the other foe.
    t.yaw = Math.atan2(best.position.x - t.position.x, best.position.z - t.position.z);
    if (t.held) t.held.yaw = t.yaw;
    (t as unknown as { humanoid?: { animator: { play(id: string, o?: object): unknown } } | null }).humanoid?.animator.play('blood_shove', { fadeIn: 0.03 });
    const arch = (t as unknown as { arch?: { damage?: number } }).arch;
    const base = t instanceof Enemy ? 12 + 4 * Math.min(6, t.level) : 10;
    dealHit(best, arch?.damage ?? base);
    const from = t.aimPoint(tmpA);
    const to = best.aimPoint(tmpB);
    ctx.vfx.burst('spray', from, { count: 6, dir: tmpC.copy(to).sub(from), spread: 0.15, speed: 9, color: '#dfefff' });
    this.stats.redirects++;
    if (h.holder === ctx.player) this.subs()?.addStrain(STRAIN.redirect);
    return best;
  }

  /** Korra extension: lift the held body and launch it a short distance (no damage). */
  lift(): boolean {
    const ctx = this.ctx;
    const h = this.holds.find((x) => x.holder === ctx.player);
    if (!h || !h.target.body) return false;
    const t = h.target;
    const p = ctx.player!;
    const dir = tmpA.set(t.position.x - p.position.x, 0, t.position.z - p.position.z).normalize();
    this.release(h, 'lifted');
    t.body!.velocity.set(dir.x * BLOOD.lift.launch, 4 + BLOOD.lift.height * 2, dir.z * BLOOD.lift.launch);
    t.body!.grounded = false;
    this.stats.lifts++;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    // Cutscenes release every hold safely.
    if (this.holds.length && ctx.cameraRig.isScripted && !this.scriptedOk) this.releaseAll('cutscene');
    const p = ctx.player;
    for (const h of [...this.holds]) {
      h.t += dt;
      const t = h.target;
      const byPlayer = h.holder === p;
      if (!t.alive || !h.holder.alive || t.disposed) {
        this.release(h, 'gone');
        continue;
      }
      // Range and sight (a moment's grace).
      const d = h.holder.position.distanceTo(t.position);
      if (byPlayer) {
        if (this.canSee(h.holder, t)) h.lastSeen = ctx.time.elapsed;
        if (d > BLOOD.hold.range * 1.6 || ctx.time.elapsed - h.lastSeen > 1.2) {
          this.release(h, 'sight');
          continue;
        }
        // Chi and strain, per held body.
        const pc = p as unknown as Combatant;
        pc.chi -= BLOOD.chiPerSecond * dt;
        if (pc.chi <= 0) {
          pc.chi = 0;
          this.release(h, 'chi');
          continue;
        }
        this.subs()?.addStrain((h.hostile ? STRAIN.perSecondHostile : STRAIN.perSecondInnocent) * dt);
        if (!this.moonAllows()) {
          this.release(h, 'sunrise');
          continue;
        }
      }
      // Resisting: a waterbender as strong as you struggles free.
      if (h.resist > 0) {
        h.struggle += dt;
        if (Math.random() < dt * 5) (t as unknown as { humanoid?: { animator: { hitReact(s?: number): void } } | null }).humanoid?.animator.hitReact(0.35);
        if (h.struggle >= h.resist) {
          this.stats.resisted++;
          this.release(h, h.resist < 0.1 ? 'avatarState' : 'resisted');
          continue;
        }
      }
      // Steering (puppet) — never into harm for allies and innocents.
      const m = t.held!.move;
      if (byPlayer && this.puppeting && !h.subdue) {
        const input = ctx.input;
        const camF = ctx.camera.getWorldDirection(tmpA).setY(0).normalize();
        const camR = tmpB.set(-camF.z, 0, camF.x);
        const mv = ctx.ui.blocksGameplay ? { x: 0, y: 0 } : input.move;
        m.set(0, 0, 0).addScaledVector(camF, mv.y).addScaledVector(camR, mv.x);
        if (m.lengthSq() > 1) m.normalize();
        m.multiplyScalar(BLOOD.puppet.speed);
        // Short leash around where the hold began.
        const nx = t.position.x + m.x * 0.5, nz = t.position.z + m.z * 0.5;
        if (Math.hypot(nx - h.startX, nz - h.startZ) > BLOOD.puppet.leash) m.set(0, 0, 0);
        if (!h.hostile && m.lengthSq() > 0 && this.unsafe(nx + m.x * 0.4, nz + m.z * 0.4, t.position.y)) m.set(0, 0, 0);
        if (m.lengthSq() > 0.01) t.held!.yaw = Math.atan2(m.x, m.z);
        if (input.wasPressed('attack')) this.shove();
        if (input.wasPressed('aim')) this.disarm();
        this.creakT -= dt;
        if (m.lengthSq() > 0.01 && this.creakT <= 0) {
          this.creakT = 0.9;
          ctx.audio.play('sub.blood.creak', { position: t.position, volume: 0.35, pitch: 0.9 + Math.random() * 0.2 });
        }
      } else m.set(0, 0, 0);
      this.updateLines(h);
    }
    // The bender stands rigid while holding (no walking away; puppet mode moves the other body).
    if (p && this.holding) {
      p.controlLock = Math.max(p.controlLock, 0.15);
      // Face the (first) held body.
      const h0 = this.holds.find((x) => x.holder === p);
      if (h0) {
        p.yaw = Math.atan2(h0.target.position.x - p.position.x, h0.target.position.z - p.position.z);
        p.root.rotation.y = p.yaw;
      }
    }
    // The player held by someone else: frozen; draw on the moon to break free.
    if (p && this.playerHold) this.updatePlayerHeld(dt, p);
    else this.showStruggle(false);
  }

  /** Scripted scenes (Hama) may keep holds during their own camera work. */
  scriptedOk = false;

  private updatePlayerHeld(dt: number, p: NonNullable<GameContext['player']>): void {
    const ctx = this.ctx;
    p.controlLock = Math.max(p.controlLock, 0.2);
    // Press attack/aim/jump repeatedly to fight the hold (stronger under the full moon).
    const input = ctx.input;
    const mash = (input.wasPressed('attack') ? 1 : 0) + (input.wasPressed('aim') ? 1 : 0) + (input.wasPressed('jump') ? 1 : 0) + (input.wasPressed('interact') ? 1 : 0);
    const moon = this.moon();
    const gain = (moon?.fullMoonUp ? 0.11 : 0.07) * (ctx.progression.mastery.water.mastered ? 1.25 : 1);
    this.breakFree = Math.max(0, this.breakFree + mash * gain - dt * 0.05);
    this.showStruggle(true);
    if (this.struggleFill) this.struggleFill.style.transform = `scaleX(${Math.min(1, this.breakFree).toFixed(3)})`;
    if (this.breakFree >= 1 && this.playerHold) {
      ctx.events.emit('ui:notify', { text: 'You draw on the moon and tear free!', kind: 'success', duration: 3 });
      this.release(this.playerHold, 'brokeFree');
    }
  }

  // ---------------------------------------------------------------------------
  // Visuals: thin water-like filaments, a pale glow in the moonlight
  // ---------------------------------------------------------------------------

  private makeLines(): THREE.LineSegments {
    this.lineMat ??= new THREE.LineBasicMaterial({ color: '#d6ecff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIMBS.length * 2 * 3 * 2), 3));
    const l = new THREE.LineSegments(g, this.lineMat);
    l.frustumCulled = false;
    l.name = 'blood_filaments';
    return l;
  }

  private anchor(e: Entity, name: (typeof LIMBS)[number] | 'chest', out: THREE.Vector3): THREE.Vector3 {
    const hum = (e as unknown as { humanoid?: { root: THREE.Object3D; anchors: Record<string, THREE.Object3D> } | null }).humanoid;
    if (hum?.anchors?.[name]) {
      return hum.anchors[name].getWorldPosition(out);
    }
    const y = name === 'head' ? e.height * 0.92 : name === 'footL' || name === 'footR' ? 0.2 : e.height * 0.6;
    return out.set(e.position.x + (name.endsWith('L') ? 0.2 : name.endsWith('R') ? -0.2 : 0), e.position.y + y, e.position.z);
  }

  private updateLines(h: Hold): void {
    const pos = h.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const t = this.ctx.time.elapsed;
    const holderHand = (k: number) => this.anchor(h.holder, k % 2 ? 'handR' : 'handL', tmpA);
    let k = 0;
    for (let i = 0; i < LIMBS.length; i++) {
      const limb = this.anchor(h.target, LIMBS[i], tmpB);
      const hand = holderHand(i);
      // Thread from the bender's hand to the limb, slightly sagging and shimmering.
      const mid = tmpC.copy(hand).lerp(limb, 0.5);
      mid.y -= 0.15 + 0.05 * Math.sin(t * 7 + i);
      pos.setXYZ(k++, hand.x, hand.y, hand.z);
      pos.setXYZ(k++, mid.x, mid.y, mid.z);
      pos.setXYZ(k++, mid.x, mid.y, mid.z);
      pos.setXYZ(k++, limb.x, limb.y, limb.z);
    }
    pos.needsUpdate = true;
    if (this.lineMat) this.lineMat.opacity = (this.ctx.settings.data.gameplay.reduceIntenseEffects ? 0.35 : 0.5) + 0.1 * Math.sin(t * 5);
    if (Math.random() < 0.15) this.ctx.vfx.burst('glow', this.anchor(h.target, 'chest', tmpB), { count: 1, speed: 0.2, color: '#cfe4ff', size: 0.6, life: 0.8 });
  }

  // ---------------------------------------------------------------------------
  // HUD: the struggle bar when you are held
  // ---------------------------------------------------------------------------

  private buildStruggle(): void {
    if (typeof document === 'undefined' || !this.ctx.ui?.layers) return;
    const css = document.createElement('style');
    css.dataset.module = 'bloodbending';
    css.textContent = `.bb-struggle{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);min-width:min(320px,86vw);padding:8px 14px 10px;border-radius:10px;
      background:rgba(12,16,26,.7);border:1px solid rgba(190,215,255,.4);color:#e8f0ff;font:13px var(--font-body,sans-serif);text-align:center;pointer-events:none;z-index:7}
      .bb-struggle.hidden{display:none}.bb-struggle .bb-bar{height:8px;margin-top:6px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
      .bb-struggle .bb-fill{height:100%;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,#8fb8ff,#f0f6ff)}`;
    document.head.appendChild(css);
    this.struggleFill = h('div.bb-fill');
    this.struggleText = h('div', 'Your body will not obey. Draw on the moon — press Attack, Aim and Jump to break free!');
    this.struggleEl = h('div.bb-struggle.hidden', this.struggleText, h('div.bb-bar', this.struggleFill));
    this.ctx.ui.layers.hud.appendChild(this.struggleEl);
    guardHud(this.ctx, this.struggleEl);
  }

  private showStruggle(on: boolean): void {
    this.struggleEl?.classList.toggle('hidden', !on);
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = (): boolean => {
      if (!w.__game) return false;
      w.__game.debug.blood = {
        sys: this,
        state: () => ({
          holds: this.holds.map((x) => ({ holder: x.holder.id, target: x.target.id, name: x.target.name, kind: x.target.kind, hostile: x.hostile, t: +x.t.toFixed(2), resist: x.resist, struggle: +x.struggle.toFixed(2), subdue: x.subdue })),
          puppeting: this.puppeting,
          playerHeld: !!this.playerHold,
          breakFree: +this.breakFree.toFixed(2),
          moonAllows: this.moonAllows(),
          gate: this.playerGate(),
          stats: JSON.parse(JSON.stringify(this.stats)),
        }),
        /** Hold an entity by id as the player (skips the cast and its gates). */
        holdId: (id: number) => {
          const e = this.ctx.entities.get(id);
          return e && this.ctx.player ? !!this.hold(this.ctx.player, e) : false;
        },
        /** Someone (entity id) holds the player — Hama's scene. */
        holdPlayer: (byId: number) => {
          const by = this.ctx.entities.get(byId);
          return by && this.ctx.player ? !!this.hold(by, this.ctx.player) : false;
        },
        releaseAll: (why = 'debug') => this.releaseAll(why),
        puppet: () => this.togglePuppet(),
        shove: () => this.shove(),
        disarm: () => this.disarm(),
        breakFree: (v = 1) => {
          this.breakFree = v;
          return this.breakFree;
        },
      };
      return true;
    };
    if (!install()) {
      const t = setInterval(() => {
        if (install()) clearInterval(t);
      }, 200);
    }
  }
}
