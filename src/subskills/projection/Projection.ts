import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import { Humanoid } from '../../character/Humanoid';
import type { GameContext, GameSystem } from '../../core/GameContext';
import type { Action } from '../../core/Input';
import type { TechniqueFailReason } from '../../core/types';
import { PROJECTION, REACTIONS } from '../../data/subskills';
import type { Entity } from '../../entities/Entity';
import type { NPC } from '../../npc/NPCSystem';
import { h } from '../../ui/dom';
import type { MoonSystem } from '../Moon';
import { getSpot } from '../../world/Spots';
import { LANDMARKS } from '../../world/WorldLayout';
import { BSS, GROUND } from '../../world/regions/earth/bssLayout';

export type ProjectionState = 'idle' | 'meditating' | 'projecting' | 'returning';

/** People who sense a projected spirit (monks, masters, elders, healers... and spirits). */
const SPIRIT_SENSITIVE = new Set(['monk', 'master', 'elder', 'healer']);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Spiritual projection (Air sub-skill). Meditate (hold the key, in quiet) and the spirit leaves the
 * body: a translucent pale blue-white figure you fly through walls, floors and water, and speak with
 * people through ("Reach out"). The body stays where it sat, meditating and faintly glowing — it
 * keeps simulating, can be attacked, and a hit snaps the spirit back (the hit still lands).
 *
 *  - Focus drains while projecting (slower in places of strong spiritual energy and at the
 *    solstice); local roaming is limited to PROJECTION.roamRadius around the body.
 *  - Spirit Sight reveals hidden spirits, quest traces and sealed doors through walls and maps
 *    the closed spaces around you; Bond Lock carries the spirit to a bonded character in seconds;
 *    Call Out speaks to one from afar (a bonded companion comes to guard your body).
 *  - Return follows a streak of light back to the body (wherever it is now).
 *  - No bending, no attacks, no picking up or moving anything. Zone changes, loading screens,
 *    defeat and the end of a session all bring the spirit home at once.
 * Camera: CameraRig.follow; interactions: InteractionSystem.focus (talk only, "Reach out").
 */
export class ProjectionSystem implements GameSystem {
  private ctx!: GameContext;
  state: ProjectionState = 'idle';
  focus: number = PROJECTION.focusMax;
  private medT = 0;
  private holdAction: Action | null = null;
  private spirit: Humanoid | null = null;
  private spiritMat: THREE.MeshLambertMaterial | null = null;
  readonly spiritPos = new THREE.Vector3();
  private spiritYaw = 0;
  private readonly vel = new THREE.Vector3();
  private readonly retFrom = new THREE.Vector3();
  private retT = 0;
  private retDur: number = PROJECTION.returnTime;
  private readonly followProxy = { position: new THREE.Vector3(), height: 1.75 };
  private streak: THREE.Mesh | null = null;
  private tether: THREE.Line | null = null;
  private bodyGlow: THREE.Sprite | null = null;
  private glowTex: THREE.Texture | null = null;
  private hush: LoopHandle | null = null;
  private overlay: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private hudFocus: HTMLElement | null = null;
  private hudInfo: HTMLElement | null = null;
  private hudKeys: HTMLElement | null = null;
  private sightT = 0;
  private readonly sightMarks: THREE.Sprite[] = [];
  private markTex: THREE.Texture | null = null;
  private lastNoiseT = -99;
  private wonderT = 0;
  private bondTarget: { position: THREE.Vector3; name: string } | null = null;
  private bondT = 0;
  private readonly bondFrom = new THREE.Vector3();
  /** Why the last projection ended (tests / quests). */
  lastEnd: string | null = null;
  readonly stats = { projections: 0, interrupted: 0, reachOuts: 0, bondLocks: 0, callOuts: 0, sights: 0 };
  /** Quest scripts: called every frame while projecting (sealed alcoves, hidden spirits). */
  readonly watchers: Array<(pos: THREE.Vector3, sight: boolean) => void> = [];
  /** Sealed doors and closed spaces Spirit Sight reveals through rock (regions/quests add theirs). */
  readonly sealed: Array<{ x: number; y: number; z: number; label: string }> = [
    { x: BSS.laogai.door.x, y: GROUND + 2, z: BSS.laogai.door.z, label: 'Sealed stone door (Dai Li base)' },
    { x: BSS.laogai.hill.x, y: GROUND + 2, z: BSS.laogai.hill.z, label: 'Hidden halls under the hill' },
  ];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // No bending, no attacks while the spirit is away (only the projection moves).
    ctx.combat.castGates.push((c, def) => (c.isPlayer && this.state !== 'idle' && def.subSkill !== 'projection' ? { reason: 'state', message: 'You cannot bend while your spirit is away from your body.' } : null));
    ctx.events.on('player:damaged', () => {
      if (this.state === 'meditating') this.cancelMeditation('Your meditation was broken.');
      else if (this.state === 'projecting' || this.state === 'returning') this.end('struck', true);
    });
    ctx.events.on('hit', (e) => {
      const p = ctx.player;
      if (p && Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) < 30) this.lastNoiseT = ctx.time.elapsed;
    });
    ctx.events.on('travel:started', () => this.end('travel', true));
    ctx.events.on('player:defeated', () => this.end('defeated', true));
    ctx.events.on('session:ending', () => this.end('session', true));
    ctx.events.on('game:paused', () => this.syncAudio());
    this.buildHud();
    this.installDebug();
  }

  onSessionEnd(): void {
    this.end('session', true);
    if (this.spirit) {
      this.spirit.root.removeFromParent();
      this.spirit.dispose();
      this.spirit = null;
    }
  }

  get active(): boolean {
    return this.state === 'projecting' || this.state === 'returning';
  }

  // ---------------------------------------------------------------------------
  // Quiet & places
  // ---------------------------------------------------------------------------

  /** Spiritual places: the Spirit Oasis and the Air Temple's Avatar sanctuary. */
  spiritualPlace(p: THREE.Vector3): boolean {
    const spots: Array<{ x: number; z: number }> = [];
    const oasis = this.ctx.world.landmark('spirit_oasis') ?? { x: -220, z: -1372 };
    spots.push(oasis);
    const sanct = getSpot('shrine_air_avatars');
    if (sanct) spots.push(sanct);
    for (const s of spots) if (Math.hypot(s.x - p.x, s.z - p.z) < PROJECTION.spiritualRadius) return true;
    return false;
  }

  /** Why the player cannot start meditating here, or null. */
  quietCheck(): { reason: TechniqueFailReason; message: string } | null {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return { reason: 'state', message: 'No body to leave.' };
    if (this.state !== 'idle') return { reason: 'busy', message: 'You are already meditating.' };
    if (p.mountAnchor) return { reason: 'state', message: 'Dismount first: the body must sit still.' };
    if (p.body && (!p.body.grounded || p.body.swimming)) return { reason: 'state', message: 'You need solid ground to sit and meditate.' };
    if (ctx.time.elapsed - this.lastNoiseT < 5) return { reason: 'state', message: 'Too much noise. Wait for quiet.' };
    for (const e of ctx.entities.queryRadius(p.position, PROJECTION.quietHostileRadius)) {
      if (e.team === 'hostile' && e.alive && (e as { defeated?: boolean }).defeated !== true) return { reason: 'state', message: 'Not while enemies are near — find a silent place.' };
    }
    let crowd = 0;
    for (const n of ctx.npcs.liveNPCs()) if (Math.hypot(n.position.x - p.position.x, n.position.z - p.position.z) < PROJECTION.crowdRadius) crowd++;
    const crowdLife = (ctx.extra.get('crowdCount') as ((x: number, z: number, r: number) => number) | undefined)?.(p.position.x, p.position.z, PROJECTION.crowdRadius) ?? 0;
    if (crowd + crowdLife > PROJECTION.crowdMax) return { reason: 'state', message: 'Too many people around. Meditation needs a quiet place.' };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Meditation
  // ---------------------------------------------------------------------------

  /** Begin meditating; the spirit leaves after PROJECTION.meditateTime of quiet while `hold` stays down. */
  beginMeditation(hold: Action | null): boolean {
    if (this.state !== 'idle' || !this.ctx.player) return false;
    this.state = 'meditating';
    this.medT = 0;
    this.holdAction = hold;
    const p = this.ctx.player;
    p.poseOverride = 'meditate';
    p.controlLock = Math.max(p.controlLock, 0.3);
    this.ctx.events.emit('ui:notify', { text: hold ? 'Meditating… keep holding, and stay still.' : 'Meditating… stay still.', kind: 'info', duration: 2.5 });
    this.showHud(true);
    return true;
  }

  private cancelMeditation(why: string): void {
    if (this.state !== 'meditating') return;
    this.state = 'idle';
    this.lastEnd = why;
    if (this.ctx.player) this.ctx.player.poseOverride = null;
    this.showHud(false);
    this.ctx.events.emit('ui:notify', { text: why, kind: 'warning', duration: 2.5 });
  }

  private updateMeditation(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    p.controlLock = Math.max(p.controlLock, 0.3);
    const input = ctx.input;
    if (Math.hypot(input.move.x, input.move.y) > 0.3) return this.cancelMeditation('You moved — meditation broken.');
    if (this.holdAction && !input.isDown(this.holdAction) && this.medT > 0.15) return this.cancelMeditation('You let go too soon. Hold to meditate.');
    if (ctx.time.elapsed - this.lastNoiseT < 0.5) return this.cancelMeditation('A noise broke your focus.');
    for (const e of ctx.entities.queryRadius(p.position, PROJECTION.disturbRadius)) {
      if (e.team === 'hostile' && e.alive && (e as { defeated?: boolean }).defeated !== true) return this.cancelMeditation('An enemy is near — your meditation breaks.');
    }
    this.medT += dt * (this.spiritualPlace(p.position) ? 1.6 : 1);
    this.updateHud();
    if (this.medT >= PROJECTION.meditateTime) this.project();
  }

  // ---------------------------------------------------------------------------
  // Projecting
  // ---------------------------------------------------------------------------

  private ensureSpirit(): Humanoid {
    if (this.spirit) return this.spirit;
    const p = this.ctx.player!;
    const hum = new Humanoid(p.appearance, { lod: 'high', castShadow: false });
    // Translucent, pale blue-white: shaded enough to read as a body, glowing faintly, see-through.
    this.spiritMat ??= new THREE.MeshLambertMaterial({ color: '#d4e6ff', emissive: '#6f9ee8', emissiveIntensity: 0.55, transparent: true, opacity: 0.42, depthWrite: false });
    const mat = this.spiritMat;
    hum.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = 5;
      }
    });
    hum.animator.loco.idleVariant = 'float';
    hum.root.name = 'spirit_projection';
    this.spirit = hum;
    return hum;
  }

  /** The spirit leaves the body. */
  project(): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    this.state = 'projecting';
    this.focus = PROJECTION.focusMax;
    this.stats.projections++;
    const sp = this.ensureSpirit();
    // Rebuild if the player changed clothes since the last projection.
    p.castOrigin('chest', this.spiritPos);
    this.spiritPos.y -= 0.9;
    this.spiritPos.addScaledVector(tmpA.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)), 0.6);
    this.spiritYaw = p.yaw;
    this.vel.set(0, 1.2, 0);
    sp.root.position.copy(this.spiritPos);
    sp.root.rotation.y = this.spiritYaw;
    ctx.scene.add(sp.root);
    this.followProxy.position.copy(this.spiritPos);
    ctx.cameraRig.follow = this.followProxy;
    ctx.interactions.focus = {
      position: this.spiritPos,
      yaw: this.spiritYaw,
      filter: (i) => i.id.startsWith('npc:'),
      label: (i) => `Reach out — ${i.label.replace(/^Talk to /, '')}`,
    };
    this.ensureLines();
    this.bodyGlowOn(true);
    ctx.audio.play('sub.spirit.leave', { position: this.spiritPos, volume: 0.9 });
    this.hush = ctx.audio.loop('sub.spirit.hush', { volume: 0.55 });
    ctx.audio.duck('ambient', 0.7, 0.4, 999, 0.5);
    ctx.audio.duck('music', 0.5, 0.4, 999, 0.5);
    this.showOverlay(true);
    this.showHud(true);
    ctx.events.emit('projection:changed', { active: true });
    const place = this.spiritualPlace(p.position);
    ctx.events.emit('ui:notify', { text: place ? 'Your spirit rises — this place is strong in spiritual energy.' : 'Your spirit leaves your body.', kind: 'info', duration: 3 });
  }

  /** Back to the body: along a streak of light (or at once). */
  end(why: string, instant = false): void {
    if (this.state === 'meditating') {
      this.cancelMeditation(why === 'struck' ? 'Your meditation was broken.' : 'Meditation ended.');
      return;
    }
    if (this.state === 'idle') return;
    const ctx = this.ctx;
    this.lastEnd = why;
    if (why === 'struck') this.stats.interrupted++;
    if (instant || !ctx.player) {
      this.finishReturn();
      if (why === 'struck') ctx.events.emit('ui:notify', { text: 'Your body was struck — your spirit snaps back!', kind: 'warning', duration: 3 });
      return;
    }
    if (this.state === 'returning') return;
    this.state = 'returning';
    this.retFrom.copy(this.spiritPos);
    this.retT = 0;
    const bodyAt = ctx.player.castOrigin('chest', tmpA);
    this.retDur = PROJECTION.returnTime + Math.min(2.5, this.retFrom.distanceTo(bodyAt) / 60);
    ctx.audio.play('sub.spirit.return', { position: this.spiritPos, volume: 0.9 });
    if (why === 'focus') ctx.events.emit('ui:notify', { text: 'Your focus is spent — the streak of light pulls you home.', kind: 'info', duration: 3 });
  }

  private finishReturn(): void {
    const ctx = this.ctx;
    this.state = 'idle';
    if (this.spirit) this.spirit.root.removeFromParent();
    if (ctx.cameraRig.follow === this.followProxy) ctx.cameraRig.follow = null;
    ctx.interactions.focus = null;
    if (ctx.player) ctx.player.poseOverride = null;
    this.bodyGlowOn(false);
    if (this.streak) this.streak.visible = false;
    if (this.tether) this.tether.visible = false;
    this.clearSight();
    try {
      this.hush?.stop(0.6);
    } catch {
      /* stopped */
    }
    this.hush = null;
    ctx.audio.duck('ambient', 0, 0.05, 0, 0.6);
    ctx.audio.duck('music', 0, 0.05, 0, 0.6);
    this.showOverlay(false);
    this.showHud(false);
    this.bondTarget = null;
    ctx.events.emit('projection:changed', { active: false, reason: this.lastEnd ?? undefined });
  }

  private updateProjecting(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    p.controlLock = Math.max(p.controlLock, 0.3);
    p.poseOverride = 'meditate';
    const input = ctx.input;
    const moon = ctx.extra.get('moon') as MoonSystem | undefined;
    // Focus.
    let drain = PROJECTION.focusDrain;
    const place = this.spiritualPlace(this.spiritPos) || this.spiritualPlace(p.position);
    if (place) drain *= PROJECTION.spiritualDrainMul;
    if (moon?.isSolstice) drain *= PROJECTION.solsticeDrainMul;
    this.focus = Math.max(0, this.focus - drain * dt);
    if (this.spiritMat) this.spiritMat.opacity = (place || moon?.isSolstice ? 0.55 : 0.4) * (0.55 + 0.45 * (this.focus / PROJECTION.focusMax)) * (this.ctx.settings.data.gameplay.reduceIntenseEffects ? 0.85 : 1);
    if (this.focus <= 0) {
      this.end('focus');
      return;
    }
    // Bond Lock travel.
    if (this.bondTarget) {
      this.bondT += dt / PROJECTION.bondTravel;
      const k = Math.min(1, this.bondT);
      const e = k * k * (3 - 2 * k);
      const to = tmpA.copy(this.bondTarget.position).add(tmpB.set(0, 0.2, 0));
      this.spiritPos.lerpVectors(this.bondFrom, to, e);
      this.spiritPos.y += Math.sin(k * Math.PI) * Math.min(40, this.bondFrom.distanceTo(to) * 0.15);
      if (k >= 1) {
        this.ctx.events.emit('ui:notify', { text: `You are beside ${this.bondTarget.name}.`, kind: 'info', duration: 2.5 });
        this.bondTarget = null;
      }
    } else {
      // Free flight relative to the camera: through walls, floors and water.
      const camF = ctx.camera.getWorldDirection(tmpA).setY(0);
      if (camF.lengthSq() < 1e-6) camF.set(0, 0, 1);
      camF.normalize();
      const camR = tmpB.set(-camF.z, 0, camF.x);
      const mv = ctx.ui.blocksGameplay ? { x: 0, y: 0 } : input.move;
      const wish = tmpW.set(0, 0, 0).addScaledVector(camF, mv.y).addScaledVector(camR, mv.x);
      if (wish.lengthSq() > 1) wish.normalize();
      const speed = PROJECTION.spiritSpeed * (input.isDown('sprint') ? 1.6 : 1);
      const climb = (input.isDown('jump') ? 1 : 0) - (input.isDown('dodge') ? 1 : 0);
      this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x * speed, 6, dt);
      this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z * speed, 6, dt);
      this.vel.y = THREE.MathUtils.damp(this.vel.y, climb * PROJECTION.spiritClimb, 5, dt);
      this.spiritPos.addScaledVector(this.vel, dt);
      if (wish.lengthSq() > 0.01) this.spiritYaw = Math.atan2(wish.x, wish.z);
      // Local roaming stays within reach of the body.
      const dx = this.spiritPos.x - p.position.x, dz = this.spiritPos.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d > PROJECTION.roamRadius && !this.farFromBodyAllowed) {
        this.spiritPos.x = p.position.x + (dx / d) * PROJECTION.roamRadius;
        this.spiritPos.z = p.position.z + (dz / d) * PROJECTION.roamRadius;
      }
    }
    // Playable bounds: inside the map, not deep under the terrain, not up in the clouds.
    this.spiritPos.x = THREE.MathUtils.clamp(this.spiritPos.x, -2040, 2040);
    this.spiritPos.z = THREE.MathUtils.clamp(this.spiritPos.z, -2040, 2040);
    const gh = ctx.world.heightAt(this.spiritPos.x, this.spiritPos.z);
    this.spiritPos.y = THREE.MathUtils.clamp(this.spiritPos.y, gh - 0.2, gh + 60);
    this.placeSpirit(dt);
    // Abilities while projecting (fixed keys, shown on the projection HUD).
    if (!ctx.ui.blocksGameplay) {
      if (input.wasPressed('ability1')) this.spiritSight();
      if (input.wasPressed('ability2')) this.bondLock();
      if (input.wasPressed('ability3')) this.callOut();
      if (input.wasPressed('ability4') || input.wasPressed('ability5') || input.wasPressed('drawWater')) this.end('return');
    }
    // Spirit-sensitive people notice you with wonder.
    this.wonderT -= dt;
    if (this.wonderT <= 0) {
      this.wonderT = 1;
      this.reactWonder();
    }
    if (this.sightT > 0) {
      this.sightT -= dt;
      if (this.sightT <= 0) this.clearSight();
    }
    for (const w of this.watchers) w(this.spiritPos, this.sightT > 0);
    if (Math.random() < dt * 6 * ctx.settings.data.graphics.particleDensity) ctx.vfx.burst('spirit', tmpA.copy(this.spiritPos).setY(this.spiritPos.y + 0.6 + Math.random()), { count: 1, speed: 0.25, color: '#d8ecff', size: 0.5 });
    this.updateLines(false);
    this.updateHud();
  }

  /** Bond Lock may carry the spirit beyond the local roaming radius. */
  private farFromBodyAllowed = false;

  private placeSpirit(dt: number): void {
    const sp = this.spirit;
    if (!sp) return;
    sp.root.position.copy(this.spiritPos);
    sp.root.position.y += Math.sin(this.ctx.time.elapsed * 1.6) * 0.06;
    sp.root.rotation.y = THREE.MathUtils.lerp(sp.root.rotation.y, this.spiritYaw, Math.min(1, dt * 6));
    sp.animator.loco.idleVariant = 'float';
    sp.animator.loco.speed = 0;
    sp.animator.loco.grounded = false;
    sp.update(dt);
    this.followProxy.position.copy(this.spiritPos);
    const ifocus = this.ctx.interactions.focus;
    if (ifocus) ifocus.yaw = this.spiritYaw;
  }

  private updateReturning(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return this.finishReturn();
    p.controlLock = Math.max(p.controlLock, 0.3);
    this.retT += dt / this.retDur;
    const k = Math.min(1, this.retT);
    const e = k * k * (3 - 2 * k);
    const body = p.castOrigin('chest', tmpA);
    body.y -= 0.9;
    this.spiritPos.lerpVectors(this.retFrom, body, e);
    this.spiritPos.y += Math.sin(k * Math.PI) * Math.min(12, this.retFrom.distanceTo(body) * 0.12);
    this.placeSpirit(dt);
    this.updateLines(true);
    if (Math.random() < dt * 30) this.ctx.vfx.burst('spirit', this.spiritPos.clone().setY(this.spiritPos.y + 1), { count: 1, speed: 0.4, color: '#dff0ff' });
    this.updateHud();
    if (k >= 1) this.finishReturn();
  }

  update(dt: number, ctx: GameContext): void {
    void ctx;
    if (this.state === 'meditating') this.updateMeditation(dt);
    else if (this.state === 'projecting') this.updateProjecting(dt);
    else if (this.state === 'returning') this.updateReturning(dt);
    if (this.bodyGlow?.visible && ctx.player) {
      ctx.player.castOrigin('chest', this.bodyGlow.position);
      const s = 1.5 + Math.sin(ctx.time.elapsed * 2) * 0.12;
      this.bodyGlow.scale.set(s, s, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Abilities
  // ---------------------------------------------------------------------------

  /** Reveal hidden spirits, traces and sealed doors through walls; map the closed spaces around you. */
  spiritSight(): boolean {
    if (this.state !== 'projecting') return false;
    const ctx = this.ctx;
    this.stats.sights++;
    this.clearSight();
    this.sightT = 8;
    this.markTex ??= radialTexture('#bfe2ff');
    const mark = (x: number, y: number, z: number, color: string, scale = 1.4) => {
      const m = new THREE.SpriteMaterial({ map: this.markTex, color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(m);
      s.position.set(x, y, z);
      s.scale.set(scale, scale, 1);
      s.renderOrder = 20;
      ctx.scene.add(s);
      this.sightMarks.push(s);
    };
    const R = 60;
    let n = 0;
    for (const e of ctx.entities.queryRadius(this.spiritPos, R)) {
      if (e.tags.has('spirit') || e.tags.has('hidden')) {
        mark(e.position.x, e.position.y + 1.2, e.position.z, '#a8f0ff', 2.2);
        n++;
      }
    }
    // Quest traces and interactables (pickups, clues, doors) show through walls.
    for (const m of ctx.quests.markers()) {
      if (m.position.distanceTo(this.spiritPos) < R) {
        mark(m.position.x, m.position.y + 1, m.position.z, '#fff2b8', 1.6);
        n++;
      }
    }
    // Sealed doors and closed spaces.
    for (const c of this.sealed) {
      if (Math.hypot(c.x - this.spiritPos.x, c.z - this.spiritPos.z) > R * 1.5) continue;
      mark(c.x, c.y, c.z, '#c8b8ff', 2.4);
      n++;
    }
    // A map reveal of the closed spaces nearby.
    for (const l of LANDMARKS) {
      if (ctx.world.discovered.has(l.id) || Math.hypot(l.x - this.spiritPos.x, l.z - this.spiritPos.z) > 120) continue;
      ctx.world.discovered.add(l.id);
      ctx.events.emit('location:discovered', { locationId: l.id, name: l.name });
    }
    ctx.vfx.ring(this.spiritPos.clone().setY(this.spiritPos.y + 1), '#cfe6ff', R * 0.25, 0.9, { opacity: 0.5 });
    ctx.audio.play('sub.spirit.call', { position: this.spiritPos, volume: 0.5, pitch: 1.3 });
    ctx.events.emit('ui:notify', { text: n ? `Spirit Sight: ${n} hidden thing${n === 1 ? '' : 's'} revealed.` : 'Spirit Sight: nothing hidden here.', kind: 'info', duration: 2.5 });
    for (const w of this.watchers) w(this.spiritPos, true);
    return true;
  }

  private clearSight(): void {
    for (const s of this.sightMarks) {
      s.removeFromParent();
      (s.material as THREE.SpriteMaterial).dispose();
    }
    this.sightMarks.length = 0;
    this.sightT = 0;
  }

  /** Bonded characters: companions, masters you trained with, and quest-bonded people. */
  bonded(): Array<{ id: string; name: string; position: THREE.Vector3; kind: 'companion' | 'npc' }> {
    const ctx = this.ctx;
    const out: Array<{ id: string; name: string; position: THREE.Vector3; kind: 'companion' | 'npc' }> = [];
    for (const c of ctx.companions.companionCreatures()) {
      const rec = ctx.companions.bonded.find((r) => r.id === c.companionId);
      if (rec && rec.bond >= 40) out.push({ id: rec.id, name: rec.name, position: c.position, kind: 'companion' });
    }
    const training = ctx.extra.get('training') as { lessonsDoneWith?(id: string): number } | undefined;
    for (const n of ctx.npcs.liveNPCs()) {
      const id = n.def.id;
      const bondFlag = ctx.quests.hasFlag(`bond_${id}`);
      const taught = n.def.role === 'master' && ((training?.lessonsDoneWith?.(id) ?? 0) > 0 || ctx.quests.hasFlag(`met_${id}`));
      if (bondFlag || taught) out.push({ id, name: n.def.name, position: n.position, kind: 'npc' });
    }
    return out;
  }

  bondLock(targetId?: string): boolean {
    if (this.state !== 'projecting') return false;
    const ctx = this.ctx;
    const list = this.bonded();
    if (!list.length) {
      ctx.events.emit('ui:notify', { text: 'No one you share a strong bond with is within reach.', kind: 'warning', duration: 2.5 });
      return false;
    }
    if (this.focus < PROJECTION.bondFocus) {
      ctx.events.emit('ui:notify', { text: 'Not enough focus to cross that distance.', kind: 'warning', duration: 2 });
      return false;
    }
    // Pick the requested one, else the one the camera faces, else the nearest.
    let pick = targetId ? list.find((b) => b.id === targetId) : undefined;
    if (!pick) {
      const camF = ctx.camera.getWorldDirection(tmpA);
      let best = -2;
      for (const b of list) {
        const to = tmpB.copy(b.position).sub(this.spiritPos).normalize();
        const dot = to.dot(camF);
        if (dot > best) {
          best = dot;
          pick = b;
        }
      }
    }
    if (!pick) return false;
    this.focus -= PROJECTION.bondFocus;
    this.stats.bondLocks++;
    this.bondFrom.copy(this.spiritPos);
    this.bondT = 0;
    this.bondTarget = { position: pick.position, name: pick.name };
    this.farFromBodyAllowed = true;
    ctx.audio.play('sub.spirit.leave', { position: this.spiritPos, volume: 0.6, pitch: 1.2 });
    ctx.events.emit('ui:notify', { text: `Bond Lock: your spirit flies to ${pick.name}.`, kind: 'info', duration: 2.5 });
    return true;
  }

  /** Speak to a bonded character from afar; a bonded companion comes to guard your body. */
  callOut(targetId?: string): boolean {
    if (this.state !== 'projecting') return false;
    const ctx = this.ctx;
    if (this.focus < PROJECTION.callOutFocus) return false;
    const list = this.bonded();
    const pick = (targetId ? list.find((b) => b.id === targetId) : undefined) ?? list.find((b) => b.kind === 'companion') ?? list[0];
    const summonable = !pick ? ctx.companions.bonded.find((r) => r.bond >= 40) : null;
    if (!pick && !summonable) {
      ctx.events.emit('ui:notify', { text: 'You call out, but no one bonded to you can hear.', kind: 'warning', duration: 2.5 });
      return false;
    }
    this.focus -= PROJECTION.callOutFocus;
    this.stats.callOuts++;
    ctx.audio.play('sub.spirit.call', { position: this.spiritPos, volume: 0.8 });
    const id = pick?.id ?? summonable!.id;
    const name = pick?.name ?? summonable!.name;
    if (pick?.kind === 'companion' || summonable) ctx.companions.summon(id);
    ctx.events.emit('world:interact', { kind: 'spirit_call', id, position: { x: this.spiritPos.x, y: this.spiritPos.y, z: this.spiritPos.z } });
    ctx.events.emit('ui:notify', { text: `You call out to ${name}… and they hear you.`, kind: 'success', duration: 3 });
    return true;
  }

  private reactWonder(): void {
    const ctx = this.ctx;
    const rx = REACTIONS.find((r) => r.trigger === 'spirit');
    if (!rx) return;
    for (const n of ctx.npcs.liveNPCs()) {
      if (!SPIRIT_SENSITIVE.has(n.def.role) || n.talking) continue;
      if (n.position.distanceTo(this.spiritPos) > rx.radius) continue;
      (n as NPC).lookAt = this.spiritPos.clone();
      if (Math.random() < 0.15 && rx.lines?.length) ctx.events.emit('ui:notify', { text: `${n.def.name}: “${rx.lines[Math.floor(Math.random() * rx.lines.length)]}”`, kind: 'info', duration: 3 });
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Visuals: streak of light, tether thread, body glow, edge desaturation
  // ---------------------------------------------------------------------------

  private ensureLines(): void {
    const ctx = this.ctx;
    if (!this.streak) {
      const g = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      this.streak = new THREE.Mesh(g, m);
      this.streak.name = 'spirit_streak';
      this.streak.frustumCulled = false;
      this.streak.renderOrder = 6;
      ctx.scene.add(this.streak);
    }
    if (!this.tether) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
      const m = new THREE.LineBasicMaterial({ color: '#bcdcff', transparent: true, opacity: 0.25, depthWrite: false });
      this.tether = new THREE.Line(g, m);
      this.tether.name = 'spirit_tether';
      this.tether.frustumCulled = false;
      ctx.scene.add(this.tether);
    }
    this.streak.visible = false;
    this.tether.visible = true;
  }

  private updateLines(returning: boolean): void {
    const p = this.ctx.player;
    if (!p || !this.tether || !this.streak) return;
    const body = p.castOrigin('chest', tmpA);
    const sp = tmpB.copy(this.spiritPos).setY(this.spiritPos.y + 1.1);
    const pos = this.tether.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, body.x, body.y, body.z);
    pos.setXYZ(1, sp.x, sp.y, sp.z);
    pos.needsUpdate = true;
    this.tether.visible = !returning;
    // On return a bright streak of light joins spirit and body.
    this.streak.visible = returning;
    if (returning) {
      const len = body.distanceTo(sp);
      this.streak.position.copy(sp);
      this.streak.lookAt(body);
      this.streak.scale.set(1, 1, Math.max(0.01, len));
      (this.streak.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(this.ctx.time.elapsed * 14);
    }
  }

  private bodyGlowOn(on: boolean): void {
    const ctx = this.ctx;
    if (on && !this.bodyGlow) {
      this.glowTex ??= radialTexture('#d8ecff');
      this.bodyGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#cfe6ff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.bodyGlow.name = 'meditation_glow';
      ctx.scene.add(this.bodyGlow);
    }
    if (this.bodyGlow) this.bodyGlow.visible = on;
  }

  private syncAudio(): void {
    /* the hush loop follows the engine's pause handling */
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private buildHud(): void {
    if (typeof document === 'undefined' || !this.ctx.ui?.layers) return;
    injectCSS();
    this.overlay = h('div.proj-edge.hidden');
    this.hudFocus = h('div.proj-fill');
    this.hudInfo = h('div.proj-info');
    this.hudKeys = h('div.proj-keys');
    this.hud = h('div.proj-hud.hidden', h('div.proj-title', 'Spiritual Projection'), h('div.proj-bar', this.hudFocus), this.hudInfo, this.hudKeys);
    this.ctx.ui.layers.hud.append(this.overlay, this.hud);
  }

  private showOverlay(on: boolean): void {
    if (!this.overlay) return;
    this.overlay.classList.toggle('hidden', !on);
    this.overlay.classList.toggle('calm', this.ctx.settings.data.gameplay.reduceIntenseEffects);
  }

  private showHud(on: boolean): void {
    this.hud?.classList.toggle('hidden', !on);
    if (on) this.updateHud();
  }

  private updateHud(): void {
    if (!this.hud || this.hud.classList.contains('hidden')) return;
    const ctx = this.ctx;
    const L = (a: Action) => ctx.input.label(a);
    if (this.state === 'meditating') {
      this.hudFocus!.style.transform = `scaleX(${Math.min(1, this.medT / PROJECTION.meditateTime).toFixed(3)})`;
      this.hudInfo!.textContent = 'Meditating — stay still and quiet';
      this.hudKeys!.textContent = this.holdAction ? `Keep holding ${L(this.holdAction)}` : '';
      this.hud.dataset.mode = 'meditate';
      return;
    }
    this.hud.dataset.mode = 'project';
    this.hudFocus!.style.transform = `scaleX(${(this.focus / PROJECTION.focusMax).toFixed(3)})`;
    const p = ctx.player;
    const d = p ? Math.round(Math.hypot(this.spiritPos.x - p.position.x, this.spiritPos.z - p.position.z)) : 0;
    this.hudInfo!.textContent = this.state === 'returning' ? 'Returning along the streak of light…' : `Focus ${Math.ceil(this.focus)} · body ${d} m${d > PROJECTION.roamRadius ? ' (bond)' : ` / ${PROJECTION.roamRadius} m`}`;
    this.hudKeys!.textContent = `${L('ability1')} Spirit Sight · ${L('ability2')} Bond Lock · ${L('ability3')} Call Out · ${L('ability4')} Return · ${L('interact')} Reach out · ${L('jump')}/${L('dodge')} up/down`;
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = (): boolean => {
      if (!w.__game) return false;
      w.__game.debug.projection = {
        sys: this,
        /** Force a projection now (skips the quiet check and the meditation). */
        force: () => {
          if (this.state === 'idle') {
            this.beginMeditation(null);
            this.project();
          }
          return this.state;
        },
        meditate: () => this.beginMeditation(null),
        quiet: () => this.quietCheck(),
        state: () => ({
          state: this.state,
          focus: +this.focus.toFixed(1),
          spirit: this.spiritPos.toArray().map((v) => +v.toFixed(2)),
          body: this.ctx.player?.position.toArray().map((v) => +v.toFixed(2)) ?? null,
          lastEnd: this.lastEnd,
          sight: this.sightT > 0,
          marks: this.sightMarks.length,
          bonded: this.bonded().map((b) => b.id),
          camFollowsSpirit: this.ctx.cameraRig.follow === this.followProxy,
          stats: { ...this.stats },
        }),
        /** Move the spirit (debug). */
        moveTo: (x: number, y: number, z: number) => {
          this.spiritPos.set(x, y, z);
          this.vel.set(0, 0, 0);
        },
        sight: () => this.spiritSight(),
        bond: (id?: string) => this.bondLock(id),
        call: (id?: string) => this.callOut(id),
        returnNow: () => this.end('return'),
        finish: () => this.end('debug', true),
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

function radialTexture(color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color);
  grd.addColorStop(0.35, 'rgba(200,225,255,0.45)');
  grd.addColorStop(1, 'rgba(200,225,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CSS = `
.proj-edge{position:absolute;inset:0;pointer-events:none;z-index:1;
  background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(190,215,255,.16) 82%,rgba(210,228,255,.32) 100%);
  backdrop-filter:saturate(.35) brightness(1.04);-webkit-backdrop-filter:saturate(.35) brightness(1.04);
  -webkit-mask-image:radial-gradient(ellipse at center,transparent 50%,#000 92%);mask-image:radial-gradient(ellipse at center,transparent 50%,#000 92%)}
.proj-edge.calm{backdrop-filter:saturate(.7);-webkit-backdrop-filter:saturate(.7)}
.proj-edge.hidden{display:none}
.proj-hud{position:absolute;top:58px;left:50%;transform:translateX(-50%);min-width:min(360px,90vw);max-width:min(620px,94vw);padding:6px 12px 8px;
  border-radius:10px;background:rgba(14,22,36,.62);border:1px solid rgba(190,220,255,.35);color:#e6f0ff;font:12px var(--font-body,sans-serif);text-align:center;pointer-events:none;z-index:6}
.proj-hud.hidden{display:none}
.proj-hud .proj-title{font-family:var(--font-title,serif);letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:#bcd8ff}
.proj-hud .proj-bar{height:6px;margin:4px 0;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
.proj-hud .proj-fill{height:100%;transform-origin:left;background:linear-gradient(90deg,#9cc8ff,#eaf4ff);transition:transform .15s}
.proj-hud .proj-info{font-size:12px;color:#dbe8ff}
.proj-hud .proj-keys{font-size:11px;color:#9fb6d6;margin-top:3px}
#ui.touch-on .proj-hud{top:calc(64px + env(safe-area-inset-top,0px));max-width:min(460px,60vw)}
`;

let injected = false;
function injectCSS(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.module = 'projection';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export type { Entity };
