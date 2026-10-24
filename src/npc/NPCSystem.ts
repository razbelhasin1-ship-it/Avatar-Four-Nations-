import * as THREE from 'three';
import { DEFAULT_APPEARANCE, type Appearance, cloneAppearance, HAIR_COLORS, SKIN_TONES } from '../character/Appearance';
import { Humanoid } from '../character/Humanoid';
import { npcLook } from '../character/looks';
import type { GameContext, GameSystem } from '../core/GameContext';
import { angleDiff, dampAngle } from '../core/MathUtil';
import { Random } from '../core/Random';
import type { Element } from '../core/types';
import { DIALOGUES } from '../data/dialogues';
import { NPCS } from '../data/npcs';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { KinematicBody } from '../entities/KinematicBody';
import type { DialogueAction, DialogueCondition, DialogueDef, DialogueNode, NPCDef } from './NPCTypes';

const NATION_PALETTES: Record<string, Array<[string, string, string, string]>> = {
  air: [['#e8a33a', '#c8642a', '#f4d48a', '#7a3a1a'], ['#d9a040', '#b8582a', '#f0e0b0', '#6a3010']],
  water: [['#2f5f9e', '#1e3a66', '#e9eef5', '#d9c9a8'], ['#3a74b8', '#24467a', '#dfe8f2', '#c8b898'], ['#5a7ea8', '#2a3f5f', '#f0f0f0', '#a89878']],
  earth: [['#4f7f3a', '#2f4f25', '#c9b27a', '#6b4a2a'], ['#6a8a3a', '#3a5a2a', '#d8c890', '#5a3a1a'], ['#5a6a3a', '#7a6a4a', '#c0a870', '#4a3a2a']],
  fire: [['#a8241c', '#2a1a18', '#d4a43a', '#5a1410'], ['#8a2a1a', '#3a2020', '#c09030', '#4a1010'], ['#b03a2a', '#1a1414', '#e0b050', '#6a1a10']],
  neutral: [['#8a7a5a', '#5a4a3a', '#c8b890', '#3a2a1a'], ['#7a6a5a', '#4a4a3a', '#b8a888', '#2a2a2a']],
};

const NATION_OUTFITS: Record<string, Array<Partial<Appearance['outfit']>>> = {
  air: [{ top: 'air_monk_robe', bottom: 'air_trousers', footwear: 'air_boots', outer: 'air_mantle', belt: 'air_sash' }],
  water: [
    { top: 'water_parka', bottom: 'water_trousers', footwear: 'water_fur_boots', gloves: 'water_mittens', belt: 'water_belt' },
    { top: 'water_tunic', bottom: 'water_skirt', footwear: 'water_fur_boots', belt: 'water_belt' },
  ],
  earth: [
    { top: 'earth_tunic', bottom: 'earth_trousers', footwear: 'earth_boots', belt: 'earth_belt' },
    { top: 'earth_traveler', bottom: 'earth_trousers', footwear: 'earth_sandals', headwear: 'earth_straw_hat' },
    { top: 'earth_formal', bottom: 'earth_robe_skirt', footwear: 'earth_boots', headwear: 'earth_hairpin' },
  ],
  fire: [
    { top: 'fire_tunic', bottom: 'fire_trousers', footwear: 'fire_boots', belt: 'fire_belt', headwear: 'fire_hair_crown' },
    { top: 'fire_armor_light', bottom: 'fire_trousers', footwear: 'fire_armored_boots', belt: 'fire_belt' },
  ],
  neutral: [{ top: 'earth_traveler', bottom: 'earth_trousers', footwear: 'earth_boots', belt: 'rope_belt' }],
};

/** Deterministic procedural appearance for background NPCs. */
export function generateAppearance(seed: number, nation: string, role: string): Appearance {
  // Nation/role-appropriate citizens (outfit presets, palettes, hair, faces): src/character/looks.ts
  return npcLook(seed, nation, role);
}

export class NPC extends Entity {
  readonly kind = 'npc' as const;
  readonly humanoid: Humanoid;
  readonly home = new THREE.Vector3();
  private target = new THREE.Vector3();
  private waitTimer = 0;
  private pathIndex = 0;
  talking = false;
  /** Set by the NPC system: look at this point when non-null. */
  lookAt: THREE.Vector3 | null = null;
  private unregisterInteract: (() => void) | null = null;
  private markerSprite: THREE.Sprite | null = null;
  // [additive: training] Combatant surface so masters can demonstrate real techniques
  // through CombatSystem (ctx.combat.tryCast(npc, id, { force: true, free: true })).
  readonly isPlayer = false;
  element: Element = 'air';
  chi = 100;
  maxChi = 100;
  waterReserve = 0;
  maxWaterReserve = 40;
  // [additive: NPC life] Civilians flee from nearby fighting for a few seconds.
  fleeTimer = 0;
  readonly fleeFrom = new THREE.Vector3();

  constructor(readonly def: NPCDef, private readonly sys: NPCSystem) {
    super();
    this.name = def.name;
    this.team = 'neutral';
    this.tags.add('npc');
    this.tags.add(def.role);
    if (def.element) this.tags.add(`bender_${def.element}`);
    const app = def.appearance ?? generateAppearance(def.appearanceSeed ?? hashId(def.id), def.nation, def.role);
    this.humanoid = new Humanoid(app, { castShadow: true });
    this.root.add(this.humanoid.root);
    this.height = this.humanoid.height;
    this.body = new KinematicBody(0.32, this.height);
    this.health = new Health(9999, 999);
    this.yaw = def.yaw ?? 0;
    this.element = def.element ?? 'air';
    const style = def.element ?? (def.role === 'elder' ? 'elder' : def.role === 'guard' || def.role === 'soldier' ? 'guard' : def.role === 'child' ? 'child' : 'npc');
    this.humanoid.animator.loco.style = style;
    if (def.behavior.type === 'idle') this.humanoid.animator.loco.idleVariant = def.behavior.variant ?? 'stand';
    if (def.behavior.type === 'train') this.humanoid.animator.loco.idleVariant = 'stand';
  }

  spawnAt(ctx: GameContext): void {
    const d = this.def;
    const y = d.y ?? ctx.world.groundAt(d.x, d.z, d.y !== undefined ? d.y + 1 : Infinity).y;
    this.root.position.set(d.x, y, d.z);
    this.home.copy(this.root.position);
    this.target.copy(this.home);
    this.root.rotation.y = this.yaw;
    if (d.dialogue || d.role === 'master' || d.role === 'merchant' || d.role === 'quest') {
      this.unregisterInteract = ctx.interactions.register({
        id: `npc:${d.id}`,
        position: this.root.position,
        radius: 3.2,
        label: `Talk to ${d.name}${d.title ? `, ${d.title}` : ''}`,
        priority: d.role === 'master' ? 2 : 1,
        enabled: () => this.alive && !this.talking,
        interact: () => this.sys.talk(this),
      });
    }
    this.updateMarker(ctx);
  }

  updateMarker(ctx: GameContext): void {
    const kind = this.sys.markerFor(this.def);
    if (this.markerSprite) {
      this.root.remove(this.markerSprite);
      (this.markerSprite.material as THREE.SpriteMaterial).dispose();
      this.markerSprite = null;
    }
    if (kind === 'none') return;
    const tex = this.sys.markerTexture(kind);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.45, 0.45, 0.45);
    s.position.y = this.height + 0.45;
    s.renderOrder = 30;
    this.markerSprite = s;
    this.root.add(s);
    void ctx;
  }

  castOrigin(which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3 {
    if (which === 'feet') return out.copy(this.root.position);
    const h = this.humanoid;
    h.root.updateWorldMatrix(true, true);
    if (which === 'handL') return h.anchors.handL.getWorldPosition(out);
    if (which === 'handR') return h.anchors.handR.getWorldPosition(out);
    if (which === 'hands') {
      h.anchors.handL.getWorldPosition(out);
      return out.add(h.anchors.handR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    }
    return h.anchors.chest.getWorldPosition(out);
  }

  powerMultiplier(): number {
    return 1;
  }

  override receiveHit(hit: HitInfo, _ctx: GameContext): HitResult {
    // Civilians are not damageable; they flinch and move away.
    this.humanoid.animator.hitReact(0.6);
    if (hit.knockback && this.body) this.body.impulse(hit.knockback.x * 0.3, 0, hit.knockback.z * 0.3);
    return { damage: 0, killed: false, blocked: false, staggered: false };
  }

  update(dt: number, ctx: GameContext): void {
    const body = this.body!;
    const b = this.def.behavior;
    let desiredSpeed = 0;
    const pos = this.root.position;
    if (this.fleeTimer > 0 && !this.talking) {
      // [additive: NPC life] run away from danger, then walk back home.
      this.fleeTimer -= dt;
      const ax = pos.x - this.fleeFrom.x, az = pos.z - this.fleeFrom.z;
      const l = Math.hypot(ax, az) || 1;
      this.target.set(pos.x + (ax / l) * 4, pos.y, pos.z + (az / l) * 4);
      desiredSpeed = 3.6;
    } else if (!this.talking && (b.type === 'idle' || b.type === 'train' || b.type === 'converse') && Math.hypot(pos.x - this.home.x, pos.z - this.home.z) > 1.2) {
      this.target.copy(this.home);
      desiredSpeed = 1.4;
    } else if (!this.talking) {
      if (b.type === 'wander') {
        if (pos.distanceTo(this.target) < 0.8) {
          this.waitTimer -= dt;
          if (this.waitTimer <= 0) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * b.radius;
            this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
            this.target.y = ctx.world.groundAt(this.target.x, this.target.z, this.home.y + 3).y;
            this.waitTimer = 2 + Math.random() * 6;
          }
        } else desiredSpeed = 1.3;
      } else if (b.type === 'patrol' && b.path.length > 1) {
        const wp = b.path[this.pathIndex % b.path.length];
        this.target.set(wp.x, pos.y, wp.z);
        if (Math.hypot(pos.x - wp.x, pos.z - wp.z) < 1) {
          this.pathIndex = (this.pathIndex + 1) % b.path.length;
        } else desiredSpeed = 1.5;
      }
    }
    let desiredYaw = this.yaw;
    if (desiredSpeed > 0) {
      const dx = this.target.x - pos.x, dz = this.target.z - pos.z;
      desiredYaw = Math.atan2(dx, dz);
    }
    const look = this.lookAt ?? (this.talking && ctx.player ? ctx.player.position : null);
    if (look && desiredSpeed === 0) desiredYaw = Math.atan2(look.x - pos.x, look.z - pos.z);
    const turn = angleDiff(this.yaw, desiredYaw);
    this.yaw = dampAngle(this.yaw, desiredYaw, 6, dt);
    if (desiredSpeed > 0 && Math.abs(turn) < 1.2) {
      body.move.set(Math.sin(this.yaw) * desiredSpeed, 0, Math.cos(this.yaw) * desiredSpeed);
    } else body.move.set(0, 0, 0);
    body.step(dt, pos, ctx.world);
    if (Math.hypot(pos.x - this.home.x, pos.z - this.home.z) > 60) {
      // Lost (pushed off a ledge etc.) — return home.
      pos.copy(this.home);
    }
    this.root.rotation.y = this.yaw;
    const a = this.humanoid.animator.loco;
    a.speed = body.horizontalSpeed;
    a.grounded = body.grounded;
    a.vy = body.velocity.y;
    a.swimming = body.swimming;
    a.turnRate = turn / Math.max(dt, 1e-3);
    if (this.def.behavior.type === 'train' && !this.talking && Math.random() < dt * 0.25) {
      this.humanoid.animator.play(this.def.element ? `${this.def.element}_form` : 'npc_gesture', { fadeIn: 0.2 });
    }
    if (this.distToPlayer < 140) this.humanoid.update(dt);
  }

  override dispose(): void {
    this.unregisterInteract?.();
    this.humanoid.dispose();
    if (this.markerSprite) (this.markerSprite.material as THREE.SpriteMaterial).dispose();
    super.dispose();
  }
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type DialogueActionHandler = (ctx: GameContext, action: DialogueAction, npc: NPC | null) => void;

/**
 * Spawns NPCs from data near the player (streaming), runs dialogue.
 * Other systems can add NPC definitions at runtime with addDef() and handle
 * custom dialogue actions with onAction().
 */
export class NPCSystem implements GameSystem {
  private ctx!: GameContext;
  private defs = new Map<string, NPCDef>();
  private live = new Map<string, NPC>();
  private dialogues = new Map<string, DialogueDef>();
  private actionHandlers = new Map<string, DialogueActionHandler>();
  /** [additive: training] NPCs whose conversation is driven by code (masters, merchants). */
  private talkHandlers = new Map<string, (npc: NPC) => void>();
  private markerTextures = new Map<string, THREE.Texture>();
  private streamTimer = 0;
  /** Active conversation. */
  talkingTo: NPC | null = null;
  spawnRadius = 220;
  despawnRadius = 300;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    for (const d of NPCS) this.addDef(d);
    for (const dlg of DIALOGUES) this.addDialogue(dlg);
    ctx.events.on('quest:started', () => this.refreshMarkers());
    ctx.events.on('quest:completed', () => this.refreshMarkers());
    ctx.events.on('quest:updated', () => this.refreshMarkers());
    // [additive: NPC life] civilians flee from fights (not from training targets or sparring).
    ctx.events.on('hit', (e) => {
      if (e.targetKind === 'target' || e.targetKind === 'npc') return;
      const a = ctx.entities.get(e.attackerId), t = ctx.entities.get(e.targetId);
      if (a?.tags.has('sparring') || t?.tags.has('sparring') || a?.tags.has('training_launcher')) return;
      this.alarm(e.position.x, e.position.z);
    });
  }

  /** [additive: NPC life] Danger at (x,z): nearby civilians flee, guards turn to look. */
  alarm(x: number, z: number, radius = 16): void {
    for (const n of this.live.values()) {
      const d = Math.hypot(n.position.x - x, n.position.z - z);
      if (d > radius || n.talking) continue;
      const r = n.def.role;
      if (r === 'master' || r === 'guard' || r === 'soldier') {
        n.lookAt = new THREE.Vector3(x, n.position.y, z);
        setTimeout(() => (n.lookAt = null), 3000);
        continue;
      }
      if (n.fleeTimer <= 0) n.humanoid.animator.hitReact(0.3);
      n.fleeTimer = 3.5 + Math.random() * 2;
      n.fleeFrom.set(x, 0, z);
    }
  }

  addDef(d: NPCDef): void {
    this.defs.set(d.id, d);
  }

  addDialogue(d: DialogueDef): void {
    this.dialogues.set(d.id, d);
  }

  onAction(type: string, h: DialogueActionHandler): void {
    this.actionHandlers.set(type, h);
  }

  /**
   * [additive: training] Drive an NPC's conversation from code: `handler` shows its own
   * dialogue (ctx.ui.showDialogue) and must finish with endConversation().
   */
  onTalk(npcId: string, handler: (npc: NPC) => void): void {
    this.talkHandlers.set(npcId, handler);
  }

  /** [additive: training] Live NPCs (read-only iteration). */
  liveNPCs(): IterableIterator<NPC> {
    return this.live.values();
  }

  getDef(id: string): NPCDef | undefined {
    return this.defs.get(id);
  }

  allDefs(): IterableIterator<NPCDef> {
    return this.defs.values();
  }

  get(id: string): NPC | undefined {
    return this.live.get(id);
  }

  /** World position of an NPC (live or from data). */
  positionOf(id: string): THREE.Vector3 | null {
    const n = this.live.get(id);
    if (n) return n.position;
    const d = this.defs.get(id);
    if (!d) return null;
    return new THREE.Vector3(d.x, d.y ?? this.ctx.world.heightAt(d.x, d.z), d.z);
  }

  markerFor(d: NPCDef): 'quest' | 'master' | 'merchant' | 'none' {
    if (d.marker) return d.marker;
    const q = this.ctx.quests;
    for (const [qid] of q.active) {
      const def = q.get(qid);
      const prog = q.active.get(qid)!;
      const step = def?.steps[prog.step];
      if (step?.objectives.some((o, i) => !prog.done[i] && ((o.type === 'talk' && o.npc === d.id) || (o.type === 'training' && o.master === d.id)))) return 'quest';
    }
    if (d.offers && !q.isActive(d.offers) && !q.isComplete(d.offers)) return 'quest';
    if (d.role === 'master') return 'master';
    if (d.role === 'merchant') return 'merchant';
    return 'none';
  }

  markerTexture(kind: string): THREE.Texture {
    let t = this.markerTextures.get(kind);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = kind === 'quest' ? '#ffcc33' : kind === 'master' ? '#9fd8ff' : '#b8e090';
    g.strokeStyle = '#2a1a08';
    g.lineWidth = 5;
    g.font = 'bold 50px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const ch = kind === 'quest' ? '!' : kind === 'master' ? '✦' : '◆';
    g.strokeText(ch, 32, 34);
    g.fillText(ch, 32, 34);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.markerTextures.set(kind, t);
    return t;
  }

  refreshMarkers(): void {
    for (const n of this.live.values()) n.updateMarker(this.ctx);
  }

  private shouldExist(d: NPCDef): boolean {
    if (d.hidden) return false;
    if (d.requiresFlag && !this.ctx.quests.hasFlag(d.requiresFlag)) return false;
    if (d.condition && !this.checkCondition(d.condition)) return false;
    if (d.schedule && d.schedule !== 'always') {
      const hour = this.ctx.world.sky?.timeOfDay ?? 12;
      const night = hour >= 21 || hour < 5.5;
      if ((d.schedule === 'day' && night) || (d.schedule === 'night' && !night)) return false;
    }
    return true;
  }

  spawn(d: NPCDef): NPC {
    const existing = this.live.get(d.id);
    if (existing) return existing;
    const npc = new NPC(d, this);
    npc.spawnAt(this.ctx);
    this.ctx.entities.add(npc);
    this.live.set(d.id, npc);
    return npc;
  }

  despawn(id: string): void {
    const n = this.live.get(id);
    if (!n) return;
    this.live.delete(id);
    this.ctx.entities.remove(n);
  }

  private stream(): void {
    const p = this.ctx.player;
    if (!p) return;
    for (const d of this.defs.values()) {
      const dist = Math.hypot(d.x - p.position.x, d.z - p.position.z);
      const live = this.live.has(d.id);
      if (!live && dist < this.spawnRadius && this.shouldExist(d)) this.spawn(d);
      else if (live && (dist > this.despawnRadius || !this.shouldExist(d)) && this.talkingTo?.def.id !== d.id) this.despawn(d.id);
    }
  }

  update(dt: number): void {
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) {
      this.streamTimer = 0.75;
      this.stream();
    }
  }

  onSessionStart(): void {
    this.streamTimer = 0;
    this.stream();
  }

  onSessionEnd(): void {
    for (const id of [...this.live.keys()]) this.despawn(id);
    this.talkingTo = null;
  }

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------

  checkCondition(c: DialogueCondition | undefined): boolean {
    if (!c) return true;
    const ctx = this.ctx;
    const q = ctx.quests;
    const pr = ctx.progression;
    if (c.flag && !q.hasFlag(c.flag)) return false;
    if (c.notFlag && q.hasFlag(c.notFlag)) return false;
    if (c.questActive && !q.isActive(c.questActive)) return false;
    if (c.questComplete && !q.isComplete(c.questComplete)) return false;
    if (c.questNotStarted && (q.isActive(c.questNotStarted) || q.isComplete(c.questNotStarted))) return false;
    if (c.canBend && !pr.canBend(c.canBend)) return false;
    if (c.cannotBend && pr.canBend(c.cannotBend)) return false;
    if (c.knows && !pr.knows(c.knows)) return false;
    if (c.notKnows && pr.knows(c.notKnows)) return false;
    if (c.mastered && !pr.mastery[c.mastered].mastered) return false;
    if (c.trialAvailable && !pr.trialAvailable(c.trialAvailable)) return false;
    if (c.startingElement && pr.startingElement !== c.startingElement) return false;
    if (c.sphere !== undefined && pr.elementsSphereUnlocked !== c.sphere) return false;
    if (c.minCurrency !== undefined && ctx.inventory.currency < c.minCurrency) return false;
    if (c.hasItem && !ctx.inventory.has(c.hasItem)) return false;
    return true;
  }

  runActions(actions: DialogueAction[] | undefined, npc: NPC | null): void {
    if (!actions) return;
    const questTypes = new Set(['startQuest', 'setFlag', 'notify', 'giveItem', 'giveCosmetic', 'learn', 'unlockElement', 'currency', 'revealLocation', 'takeItem']);
    for (const a of actions) {
      if (questTypes.has(a.type)) {
        this.ctx.quests.runActions([a as any]);
        continue;
      }
      if (a.type === 'heal') {
        const p = this.ctx.player;
        if (p?.health) {
          p.health.heal(p.health.maxHp);
          this.ctx.vfx.burst('heal', p.aimPoint(), { count: 20 });
        }
        continue;
      }
      const h = this.actionHandlers.get(a.type === 'custom' ? a.id : a.type);
      if (h) h(this.ctx, a, npc);
      else console.warn('[Dialogue] no handler for action', a);
    }
  }

  /** Begin a conversation with an NPC. */
  talk(npc: NPC): void {
    this.ctx.events.emit('npc:interact', { npcId: npc.def.id });
    const custom = this.talkHandlers.get(npc.def.id);
    if (custom) {
      this.talkingTo = npc;
      npc.talking = true;
      this.ctx.events.emit('dialogue:started', { npcId: npc.def.id, dialogueId: `code:${npc.def.id}` });
      custom(npc);
      return;
    }
    const dlg = npc.def.dialogue ? this.dialogues.get(npc.def.dialogue) : undefined;
    if (!dlg) {
      this.ctx.events.emit('ui:notify', { text: `${npc.def.name}: "${this.smallTalk(npc)}"`, kind: 'info', duration: 3.5 });
      return;
    }
    const entry = dlg.start.find((s) => this.checkCondition(s.condition));
    if (!entry) return;
    this.talkingTo = npc;
    npc.talking = true;
    this.ctx.events.emit('dialogue:started', { npcId: npc.def.id, dialogueId: dlg.id });
    this.showNode(dlg, entry.node, npc);
  }

  private smallTalk(npc: NPC): string {
    const lines: Record<string, string[]> = {
      water: ['The ice sings when the moon is full.', 'Mind the canals — the boats wait for no one.', 'Have you tried stewed sea prunes?'],
      earth: ['There is no war in Ba Sing Se.', 'My cabbages! Oh... sorry, wrong cart.', 'The trains run on earthbending, you know.'],
      fire: ['Long live the Fire Lord.', 'The palace gardens are lovely this time of year.', 'Have you seen the turtle-ducks?'],
      air: ['The wind carries all things home.', 'Monk Gyatso would have liked you.', 'Mind the bison, they nibble.'],
      neutral: ['Safe travels, stranger.', 'The roads are not safe these days.'],
    };
    const pool = lines[npc.def.nation] ?? lines.neutral;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private showNode(dlg: DialogueDef, nodeId: string, npc: NPC): void {
    const node: DialogueNode | undefined = dlg.nodes[nodeId];
    if (!node) {
      this.endConversation(dlg);
      return;
    }
    this.runActions(node.actions, npc);
    const choices = (node.choices ?? []).filter((c) => this.checkCondition(c.condition));
    const speaker = node.speaker ?? `${npc.def.name}${npc.def.title ? ` · ${npc.def.title}` : ''}`;
    this.ctx.ui.showDialogue({
      speaker,
      text: node.text,
      choices: choices.length
        ? choices.map((c) => ({
            text: c.text,
            onSelect: () => {
              this.runActions(c.actions, npc);
              if (c.end || !c.next) this.endConversation(dlg);
              else this.showNode(dlg, c.next, npc);
            },
          }))
        : [
            {
              text: node.next ? 'Continue' : 'Farewell',
              onSelect: () => {
                if (node.next && !node.end) this.showNode(dlg, node.next, npc);
                else this.endConversation(dlg);
              },
            },
          ],
    });
  }

  endConversation(dlg?: DialogueDef): void {
    const npc = this.talkingTo;
    this.ctx.ui.hideDialogue();
    if (npc) {
      npc.talking = false;
      this.ctx.events.emit('dialogue:ended', { npcId: npc.def.id, dialogueId: dlg?.id ?? '' });
    }
    this.talkingTo = null;
    this.refreshMarkers();
  }
}
