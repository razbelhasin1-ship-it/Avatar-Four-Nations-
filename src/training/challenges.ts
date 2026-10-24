import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import { ELEMENT_INFO, type Element } from '../core/types';
import { getTechnique } from '../combat/CombatSystem';
import type { Combatant, Projectile } from '../combat/types';
import type { ChallengeDef } from '../data/masters';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import { npcLook } from '../character/looks';

/**
 * Training challenge runtime: the interactive part of a master's lesson or trial.
 * Every challenge is real gameplay — targets take real hits from CombatSystem,
 * launchers fire real projectiles (blocked by real walls/shields), rings check
 * the player's actual movement, sparring uses the encounters module.
 */

export interface ChallengeEnv {
  ctx: GameContext;
  /** Training floor centre (y = floor). */
  center: THREE.Vector3;
  radius: number;
  /** Player start position and facing (unit XZ vector into the field). */
  start: THREE.Vector3;
  forward: THREE.Vector3;
  element: Element;
  /** Lesson technique (credit filter) — null for trials/awakenings. */
  technique: string | null;
  /** Player casts: technique id → ctx.time.elapsed of the last cast. */
  lastCast: Map<string, number>;
  /** Display name of the master (spar partner names). */
  masterName: string;
}

export type ChallengeStatus = 'running' | 'success' | 'failed';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function techName(id: string | null | undefined): string {
  return (id && getTechnique(id)?.name) || 'bending';
}

/** Floor height near (x,z) on the training level. */
function floorAt(env: ChallengeEnv, x: number, z: number): number {
  const g = env.ctx.world.groundAt(x, z, env.center.y + 2.5).y;
  return Math.abs(g - env.center.y) > 2.5 ? env.center.y : g;
}

function stdMat(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

// =============================================================================
// Entities
// =============================================================================

export type TargetRole = 'normal' | 'marked' | 'decoy';

/** Breakable practice post with a painted board. kind 'target': only the player/allies hurt it. */
export class TrainingTarget extends Entity {
  readonly kind = 'target' as const;
  broken = false;
  wrongHits = 0;
  validHits = 0;
  revealed: boolean;
  private wobble = 0;
  private readonly visual = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly ringMat: THREE.MeshStandardMaterial;
  onBreak: ((t: TrainingTarget) => void) | null = null;
  onWrong: ((t: TrainingTarget, hit: HitInfo) => void) | null = null;

  constructor(
    readonly role: TargetRole,
    hp: number,
    readonly accepts: (hit: HitInfo) => boolean,
    readonly hiddenUntilRevealed = false,
  ) {
    super();
    this.name = role === 'decoy' ? 'Warrior Post' : 'Practice Target';
    this.team = 'neutral';
    this.tags.add('dummy');
    this.tags.add('training_target');
    if (hiddenUntilRevealed) this.tags.add('hidden');
    this.height = 1.9;
    this.radius = 0.45;
    this.health = new Health(hp, 9999, 0);
    this.revealed = !hiddenUntilRevealed;
    const wood = stdMat('#7a5634');
    const face = stdMat(role === 'marked' ? '#f1d48a' : role === 'decoy' ? '#6f8aa6' : '#d8c070');
    this.ringMat = stdMat(role === 'marked' ? '#c0302a' : role === 'decoy' ? '#2f4a66' : '#b03a2a', { emissive: role === 'marked' ? '#5a1008' : '#000000' });
    this.mats.push(wood, face, this.ringMat);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      mesh.castShadow = true;
      mesh.userData.ownsGeometry = true;
      this.visual.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.32, 0.38, 0.18, 10), wood, 0, 0.09, 0);
    add(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 8), wood, 0, 0.8, 0);
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 18), face, 0, 1.45, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.27, 0.05, 6, 20), this.ringMat, 0, 1.45, 0.045);
    add(new THREE.TorusGeometry(0.27, 0.05, 6, 20), this.ringMat, 0, 1.45, -0.045);
    if (role === 'marked') add(new THREE.ConeGeometry(0.12, 0.3, 8), this.ringMat, 0, 2.15, 0, Math.PI);
    this.root.add(this.visual);
    this.visual.visible = this.revealed;
  }

  reveal(seconds = 8): void {
    this.revealed = true;
    this.visual.visible = true;
    this.revealTimer = seconds;
  }
  private revealTimer = 0;

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    const none: HitResult = { damage: 0, killed: false, blocked: false, staggered: false };
    if (this.broken) return none;
    this.wobble = Math.min(1.2, this.wobble + 0.5);
    if (!this.accepts(hit)) {
      this.wrongHits++;
      this.onWrong?.(this, hit);
      return none;
    }
    this.validHits++;
    const res = super.receiveHit({ ...hit, knockback: undefined, launch: undefined, status: undefined }, ctx);
    if (this.role === 'decoy') this.onWrong?.(this, hit);
    return res;
  }

  protected override onDeath(ctx: GameContext): void {
    this.broken = true;
    this.visual.visible = false;
    const p = this.aimPoint(tmpA);
    ctx.vfx.burst('debris', p, { count: 16, color: '#c8a050' });
    ctx.vfx.burst('dust', this.position, { count: 8 });
    ctx.audio.play('hit', { position: p, volume: 0.6, pitch: 0.8 });
    this.onBreak?.(this);
  }

  update(dt: number, ctx: GameContext): void {
    this.wobble = Math.max(0, this.wobble - dt * 1.8);
    const a = Math.sin(ctx.time.elapsed * 15) * this.wobble * 0.2;
    this.visual.rotation.set(a, 0, a * 0.6);
    if (this.hiddenUntilRevealed && this.revealTimer > 0) {
      this.revealTimer -= dt;
      if (this.revealTimer <= 0 && !this.broken) this.visual.visible = false;
    }
    if (this.role === 'marked' && !this.broken) this.ringMat.emissiveIntensity = 0.6 + Math.sin(ctx.time.elapsed * 5) * 0.4;
  }

  override dispose(): void {
    for (const m of this.mats) m.dispose();
    super.dispose();
  }
}

/** Stone post with a glowing orb that fires projectiles at the player (defense drills). */
export class Launcher extends Entity implements Combatant {
  readonly kind = 'target' as const;
  readonly humanoid = null;
  readonly isPlayer = false;
  chi = 100;
  maxChi = 100;
  waterReserve = 0;
  maxWaterReserve = 0;
  private readonly mats: THREE.Material[] = [];
  private readonly orb: THREE.Mesh;
  private glow = 0;

  constructor(public element: Element) {
    super();
    this.name = 'Training Launcher';
    this.team = 'hostile';
    this.targetable = false;
    this.tags.add('training_launcher');
    this.height = 1.6;
    const stone = stdMat('#8a8070');
    const orbMat = new THREE.MeshStandardMaterial({ color: ELEMENT_INFO[element].color, emissive: ELEMENT_INFO[element].glow, emissiveIntensity: 0.4, roughness: 0.4 });
    this.mats.push(stone, orbMat);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 8), stone);
    base.position.y = 0.6;
    base.userData.ownsGeometry = true;
    base.castShadow = true;
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), orbMat);
    this.orb.position.y = 1.45;
    this.orb.userData.ownsGeometry = true;
    this.root.add(base, this.orb);
  }

  castOrigin(_which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3 {
    return this.orb.getWorldPosition(out);
  }

  powerMultiplier(): number {
    return 1;
  }

  flash(): void {
    this.glow = 1;
  }

  update(dt: number): void {
    this.glow = Math.max(0, this.glow - dt * 3);
    (this.orb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + this.glow * 2.5;
    this.orb.scale.setScalar(1 + this.glow * 0.4);
  }

  override dispose(): void {
    for (const m of this.mats) m.dispose();
    super.dispose();
  }
}

/** Brazier / kettle fed by fire hits. */
export class FlameTarget extends Entity {
  readonly kind = 'target' as const;
  level = 1;
  techFeeds = 0;
  private lastFeed = -10;
  private readonly mats: THREE.Material[] = [];
  private readonly fire: THREE.Mesh;
  private readonly fireMat: THREE.MeshBasicMaterial;

  constructor(
    readonly mode: 'sustain' | 'fill',
    readonly technique: string | null,
  ) {
    super();
    this.name = mode === 'fill' ? 'Tea Kettle' : 'Sacred Brazier';
    this.team = 'neutral';
    this.tags.add('dummy');
    this.tags.add('training_flame');
    this.height = 1.4;
    this.radius = 0.7;
    this.health = new Health(100000, 9999, 0);
    this.level = mode === 'fill' ? 0 : 1;
    const metal = stdMat(mode === 'fill' ? '#4a4a50' : '#6a4a2a', { metalness: 0.6, roughness: 0.5 });
    const coal = stdMat('#2a1a10');
    this.fireMat = new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats.push(metal, coal, this.fireMat);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y;
      mesh.userData.ownsGeometry = true;
      mesh.castShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    if (mode === 'fill') {
      mk(new THREE.CylinderGeometry(0.5, 0.6, 0.6, 12), coal, 0.3);
      mk(new THREE.SphereGeometry(0.45, 14, 10), metal, 1.05);
      mk(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6), metal, 1.45).rotation.z = 0.9;
    } else {
      mk(new THREE.CylinderGeometry(0.15, 0.25, 0.9, 8), metal, 0.45);
      mk(new THREE.CylinderGeometry(0.7, 0.45, 0.35, 14), metal, 1.05);
    }
    this.fire = mk(new THREE.ConeGeometry(0.45, 1.1, 10, 1, true), this.fireMat, mode === 'fill' ? 0.45 : 1.75);
    this.fire.castShadow = false;
  }

  override receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    const none: HitResult = { damage: 0, killed: false, blocked: false, staggered: false };
    if (hit.element !== 'fire') {
      if (hit.element === 'water' && this.mode === 'sustain') this.level = Math.max(0, this.level - 0.3);
      return none;
    }
    const now = ctx.time.elapsed;
    const isTech = !this.technique || hit.techniqueId === this.technique;
    if (now - this.lastFeed < 0.12) return none;
    this.lastFeed = now;
    if (this.mode === 'sustain') this.level = Math.min(1, this.level + (isTech ? 0.75 : 0.12));
    else if (isTech) this.level = Math.min(1, this.level + 0.09);
    if (isTech) this.techFeeds++;
    ctx.vfx.burst('embers', this.aimPoint(tmpA), { count: 8 });
    return { ...none, damage: 0.01 };
  }

  update(dt: number, ctx: GameContext): void {
    if (this.mode === 'fill') this.level = Math.max(0, this.level - dt * 0.035);
    const lv = this.mode === 'fill' ? 0.3 + this.level * 0.7 : this.level;
    this.fire.scale.set(0.4 + lv * 0.8, 0.2 + lv * 1.1, 0.4 + lv * 0.8);
    this.fireMat.opacity = lv > 0.02 ? 0.5 + lv * 0.4 : 0;
    this.fire.rotation.y += dt * 3;
    if (this.mode === 'fill' && this.level > 0.6 && Math.random() < dt * 6) ctx.vfx.burst('steam', tmpA.copy(this.position).setY(this.position.y + 1.5), { count: 2 });
    if (this.mode === 'sustain' && lv > 0.05 && Math.random() < dt * 8) ctx.vfx.burst('flame', tmpA.copy(this.position).setY(this.position.y + 1.4), { count: 2 });
  }

  override dispose(): void {
    for (const m of this.mats) m.dispose();
    super.dispose();
  }
}

// =============================================================================
// Challenges
// =============================================================================

export abstract class Challenge {
  status: ChallengeStatus = 'running';
  failReason = '';
  time = 0;
  readonly limit: number;
  protected readonly ctx: GameContext;
  protected readonly entities: Entity[] = [];
  protected readonly objects: THREE.Object3D[] = [];
  protected readonly colliders: number[] = [];
  private readonly offs: Array<() => void> = [];

  constructor(
    protected readonly env: ChallengeEnv,
    limit: number,
  ) {
    this.ctx = env.ctx;
    this.limit = limit;
  }

  abstract objective(): string;
  abstract counter(): string;
  abstract progress(): number;
  /** Hint line (keys / technique). */
  hint(): string {
    return this.env.technique ? `Use ${techName(this.env.technique)}` : `Use your ${ELEMENT_INFO[this.env.element].name.toLowerCase()}bending`;
  }

  /** Build entities/objects. */
  abstract start(): void;

  update(dt: number): void {
    if (this.status !== 'running') return;
    this.time += dt;
    this.tick(dt);
    if (this.status === 'running' && this.time >= this.limit) this.fail(this.timeoutReason());
  }

  protected abstract tick(dt: number): void;

  protected timeoutReason(): string {
    return 'Time ran out.';
  }

  protected succeed(): void {
    if (this.status === 'running') this.status = 'success';
  }

  protected fail(reason: string): void {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.failReason = reason;
  }

  protected on<K extends keyof GameEvents>(name: K, fn: (p: GameEvents[K]) => void): void {
    this.offs.push(this.ctx.events.on(name, fn as any) as unknown as () => void);
  }

  protected addEntity<T extends Entity>(e: T, x: number, z: number, y?: number): T {
    e.position.set(x, y ?? floorAt(this.env, x, z), z);
    this.ctx.entities.add(e);
    this.entities.push(e);
    return e;
  }

  protected addObject(o: THREE.Object3D): void {
    this.ctx.scene.add(o);
    this.objects.push(o);
  }

  /** Point in the field: `along` metres ahead of the start, `side` metres to the right. */
  protected field(along: number, side: number): THREE.Vector3 {
    const f = this.env.forward;
    const rx = -f.z, rz = f.x;
    return new THREE.Vector3(this.env.start.x + f.x * along + rx * side, 0, this.env.start.z + f.z * along + rz * side);
  }

  protected facePlayer(e: Entity): void {
    const p = this.ctx.player!;
    e.yaw = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
    e.root.rotation.y = e.yaw;
  }

  protected recentlyCast(id: string, window: number): boolean {
    const t = this.env.lastCast.get(id);
    if (t !== undefined && this.ctx.time.elapsed - t <= window) return true;
    const p = this.ctx.player;
    return !!p && this.ctx.combat.activeCast(p)?.def.id === id;
  }

  dispose(): void {
    for (const off of this.offs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.offs.length = 0;
    for (const e of this.entities) if (!e.disposed) this.ctx.entities.remove(e);
    this.entities.length = 0;
    for (const o of this.objects) {
      o.removeFromParent();
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mm = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
          else mm.dispose();
        }
      });
    }
    this.objects.length = 0;
    for (const id of this.colliders) this.ctx.world.collision.remove(id);
    this.colliders.length = 0;
  }

  /** Debug/test view. */
  debugInfo(): Record<string, unknown> {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Target practice / precision / water targets
// ---------------------------------------------------------------------------

class TargetsChallenge extends Challenge {
  private targets: TrainingTarget[] = [];
  private broken = 0;
  private mistakes = 0;
  private wrongTechNotice = 0;
  private drewSnow = false;
  private snowRequired = false;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'targets' | 'precision' | 'waterTargets' }>,
  ) {
    super(env, def.time);
  }

  private get need(): number {
    return this.def.type === 'precision' ? this.def.marked : this.def.count;
  }

  objective(): string {
    const d = this.def;
    if (d.type === 'precision') return d.hidden ? 'Stomp to sense the hidden targets, then break them' : `Break only the marked targets${d.technique ? ` with ${techName(d.technique)}` : ''}`;
    if (d.type === 'waterTargets') return `${this.snowRequired && !this.drewSnow ? 'Draw water from the snow, then b' : 'Draw water and b'}reak the targets`;
    return `Break the targets${d.technique ? ` with ${techName(d.technique)}` : ''}`;
  }

  counter(): string {
    const m = this.def.type === 'precision' && this.def.maxMistakes !== undefined ? `  ·  mistakes ${this.mistakes}/${this.def.maxMistakes}` : '';
    return `${this.broken} / ${this.need}${m}`;
  }

  progress(): number {
    return this.broken / Math.max(1, this.need);
  }

  override hint(): string {
    const d = this.def;
    if (d.type === 'precision' && d.hidden) return `Slam (hold ${this.ctx.input.label('aim')}) or land hard to feel the targets through the ground`;
    if (d.type === 'waterTargets') return 'Stand near the water · Draw Water, then strike';
    return super.hint();
  }

  start(): void {
    const d = this.def;
    const env = this.env;
    const tech = d.type === 'waterTargets' ? null : d.technique ?? null;
    const elementFilter: Element = d.type === 'waterTargets' ? 'water' : env.element;
    const accepts = (hit: HitInfo) => hit.attacker === this.ctx.player && (tech ? hit.techniqueId === tech : hit.element === elementFilter);
    // A lesson target breaks on one clean hit with the taught technique; free practice (awakenings, trials) needs real damage.
    const hp = d.type === 'targets' ? d.hp ?? (tech ? 1 : 8) : 1;
    const pts = this.layout();
    const roles: TargetRole[] = [];
    if (d.type === 'precision') {
      let m = d.marked, k = d.decoys;
      while (m + k > 0) {
        if (m > 0 && (roles.length % 2 === 0 || k === 0)) {
          roles.push('marked');
          m--;
        } else {
          roles.push('decoy');
          k--;
        }
      }
    }
    pts.forEach((p, i) => {
      const role: TargetRole = roles[i] ?? 'normal';
      const t = this.addEntity(new TrainingTarget(role, hp, role === 'decoy' ? () => true : accepts, d.type === 'precision' && !!d.hidden), p.x, p.z);
      this.facePlayer(t);
      t.onBreak = () => {
        if (t.role === 'decoy') return;
        this.broken++;
        if (this.broken >= this.need) this.checkDone();
      };
      t.onWrong = (_t, hit) => {
        if (t.role === 'decoy' && hit.attacker === this.ctx.player) {
          this.mistakes++;
          this.ctx.events.emit('ui:notify', { text: 'Not that one — only the marked targets!', kind: 'warning', duration: 2 });
          if (d.type === 'precision' && d.maxMistakes !== undefined && this.mistakes > d.maxMistakes) this.fail('Too many unmarked targets hit.');
        } else if (hit.attacker === this.ctx.player && tech && this.time - this.wrongTechNotice > 3) {
          this.wrongTechNotice = this.time;
          this.ctx.events.emit('ui:notify', { text: `The master wants ${techName(tech)} here.`, kind: 'warning', duration: 2.5 });
        }
      };
      this.targets.push(t);
    });
    if (d.type === 'precision' && d.hidden) {
      this.on('seismic:pulse', (e) => {
        for (const t of this.targets) if (e.revealed.includes(t.id) || Math.hypot(t.position.x - e.position.x, t.position.z - e.position.z) < e.radius) t.reveal(9);
      });
      // Landing / slams with Seismic Sense practise reveal through the earth module; a heavy landing also counts.
      this.on('player:landed', (e) => {
        if (e.speed < 7) return;
        for (const t of this.targets) if (Math.hypot(t.position.x - e.position.x, t.position.z - e.position.z) < 14) t.reveal(7);
      });
      this.on('technique:cast', (e) => {
        if (!e.isPlayer || (e.id !== 'earth_slam' && e.id !== 'earth_strike')) return;
        for (const t of this.targets) if (Math.hypot(t.position.x - e.position.x, t.position.z - e.position.z) < (e.id === 'earth_slam' ? 16 : 6)) t.reveal(8);
      });
    }
    if (d.type === 'waterTargets') {
      this.snowRequired = !!d.snow && this.ctx.water.findAll(this.env.center, 28, { allowIce: true, allowSnow: true }).some((h) => h.type === 'snow');
      this.on('water:drawn', (e) => {
        if (e.sourceType === 'snow') this.drewSnow = true;
      });
    }
  }

  private checkDone(): void {
    if (this.broken < this.need) return;
    if (this.snowRequired && !this.drewSnow) return;
    this.succeed();
  }

  protected tick(): void {
    if (this.broken >= this.need) this.checkDone();
  }

  private layout(): THREE.Vector3[] {
    const d = this.def;
    const r = this.env.radius;
    const n = d.type === 'precision' ? d.marked + d.decoys : d.count;
    const dist = Math.min(('dist' in d && d.dist) || 6, r * 1.45);
    const pts: THREE.Vector3[] = [];
    const layout = d.type === 'targets' ? d.layout : d.type === 'precision' ? 'arc' : 'scatter';
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      switch (layout) {
        case 'ring': {
          const a = (i / n) * Math.PI * 2;
          pts.push(this.field(Math.cos(a) * dist, Math.sin(a) * dist));
          break;
        }
        case 'line':
          pts.push(this.field(4 + i * dist, (i % 2 ? 0.35 : -0.35)));
          break;
        case 'far': {
          const a = (u - 0.5) * 1.1;
          const dd = dist + (i % 2) * 2.5;
          pts.push(this.field(Math.cos(a) * dd, Math.sin(a) * dd));
          break;
        }
        case 'cluster': {
          const g = Math.floor(i / 2), k = i % 2;
          const a = (g - (Math.ceil(n / 2) - 1) / 2) * 0.75;
          pts.push(this.field(Math.cos(a) * dist + k * 1.1, Math.sin(a) * dist + (k ? 0.9 : -0.6)));
          break;
        }
        case 'scatter': {
          const a = (u - 0.5) * 2.2 + (i % 2 ? 0.15 : -0.15);
          const dd = dist * (0.6 + ((i * 37) % 5) * 0.12);
          pts.push(this.field(Math.cos(a) * dd + 2, Math.sin(a) * dd));
          break;
        }
        default: {
          const a = (u - 0.5) * (n > 4 ? 2.0 : 1.5);
          pts.push(this.field(Math.cos(a) * dist, Math.sin(a) * dist));
        }
      }
    }
    return pts;
  }

  override debugInfo(): Record<string, unknown> {
    return {
      targets: this.targets.map((t) => ({ id: t.id, role: t.role, broken: t.broken, x: +t.position.x.toFixed(2), y: +t.position.y.toFixed(2), z: +t.position.z.toFixed(2), revealed: t.revealed })),
      broken: this.broken,
      mistakes: this.mistakes,
      drewSnow: this.drewSnow,
      snowRequired: this.snowRequired,
    };
  }
}

// ---------------------------------------------------------------------------
// Defense drills (launchers)
// ---------------------------------------------------------------------------

interface Shot {
  p: Projectile;
  launcher: Launcher;
  outcome: 'flying' | 'hit' | 'credit' | 'miss';
}

class DefenseChallenge extends Challenge {
  private launchers: Launcher[] = [];
  private shots: Shot[] = [];
  private fired = 0;
  private credited = 0;
  private hits = 0;
  private nextShot = 1.8;
  private interval: number;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'defense' }>,
  ) {
    super(env, def.time);
    this.interval = Math.max(2.2, (def.time * 0.78) / def.shots);
  }

  objective(): string {
    const t = this.def.technique ? ` with ${techName(this.def.technique)}` : '';
    switch (this.def.mode) {
      case 'block':
        return `Block the incoming bolts${t}`;
      case 'deflect':
        return `Deflect the incoming bolts${t}`;
      case 'evade':
        return 'Evade the incoming bolts';
      case 'armor':
        return `Take the bolts while armoured${t}`;
      default:
        return 'Block, deflect or evade the bolts';
    }
  }

  counter(): string {
    return `${this.credited} / ${this.def.need}  ·  hits ${this.hits}/${this.def.maxHits ?? '∞'}`;
  }

  progress(): number {
    return this.credited / this.def.need;
  }

  start(): void {
    const n = this.def.launchers;
    const spread = this.def.mode === 'block' ? 0.38 : 1.4;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * spread;
      const d = Math.min(11, this.env.radius * 1.2);
      const p = this.field(Math.cos(a) * d, Math.sin(a) * d);
      const l = this.addEntity(new Launcher(this.env.element === 'air' ? 'fire' : this.env.element === 'fire' ? 'water' : this.env.element === 'water' ? 'earth' : 'fire'), p.x, p.z);
      this.facePlayer(l);
      this.launchers.push(l);
    }
  }

  private fire(): void {
    const p = this.ctx.player!;
    const l = this.launchers[this.fired % this.launchers.length];
    this.fired++;
    l.flash();
    const origin = l.castOrigin('chest', new THREE.Vector3());
    const aim = p.aimPoint(new THREE.Vector3());
    const dir = aim.sub(origin).normalize();
    origin.addScaledVector(dir, 0.5);
    const def = getTechnique(l.element === 'water' ? 'water_whip' : l.element === 'earth' ? 'earth_strike' : 'fire_jab');
    if (!def) return;
    const color = ELEMENT_INFO[l.element].color;
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat);
    const shot: Shot = { p: null as unknown as Projectile, launcher: l, outcome: 'flying' };
    const near = (pt: THREE.Vector3) => pt.distanceTo(this.ctx.player!.position) < 6;
    shot.p = this.ctx.combat.detachedCast(l, def, origin, dir, p).projectile({
      position: origin,
      velocity: dir.clone().multiplyScalar(12.5),
      radius: 0.3,
      life: 3.2,
      damage: 7,
      knockback: 2.5,
      visual: {
        object: mesh,
        update: (pr) => mesh.position.copy(pr.position),
        dispose: () => {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          mat.dispose();
        },
      },
      onHitEntity: (pr, e, res) => {
        if (pr.cast.caster !== l) return void this.resolve(shot, 'deflected');
        if (e === this.ctx.player) this.resolve(shot, res?.blocked ? 'blocked' : 'hit');
      },
      onHitWorld: (pr, pt) => {
        if (pr.cast.caster !== l) return void this.resolve(shot, 'deflected');
        this.resolve(shot, near(pt) && pt.y > floorAt(this.env, pt.x, pt.z) + 0.35 ? 'blocked' : 'missed');
      },
      onExpire: (pr) => this.resolve(shot, pr.cast.caster !== l ? 'deflected' : 'missed'),
    });
    this.shots.push(shot);
    this.ctx.audio.play('whoosh', { position: origin, volume: 0.35, pitch: 1.6 });
  }

  private resolve(s: Shot, how: 'blocked' | 'deflected' | 'hit' | 'missed' | 'absorbed'): void {
    if (s.outcome !== 'flying') return;
    const mode = this.def.mode;
    const tech = this.def.technique;
    const p = this.ctx.player!;
    let credit = false;
    let hit = false;
    const techOk = (w: number) => !tech || this.recentlyCast(tech, w);
    if (how === 'hit') {
      if (mode === 'armor' && p.hasStatus('armor') && techOk(30)) credit = true;
      else hit = true;
    } else if (mode === 'armor') {
      credit = false;
    } else if (how === 'deflected') {
      credit = (mode === 'deflect' || mode === 'any' || mode === 'block') && techOk(5);
    } else if (how === 'blocked' || how === 'absorbed') {
      credit = (mode === 'block' || mode === 'any' || mode === 'deflect') && techOk(mode === 'block' ? 12 : 5);
    } else if (how === 'missed') {
      credit = mode === 'evade' || mode === 'any';
    }
    s.outcome = credit ? 'credit' : hit ? 'hit' : 'miss';
    if (credit) {
      this.credited++;
      this.ctx.vfx.ring(s.p.position.clone(), '#bfe6ff', 0.8, 0.35);
      if (this.credited >= this.def.need) this.succeed();
    }
    if (hit) {
      this.hits++;
      if (this.def.maxHits !== undefined && this.hits > this.def.maxHits) this.fail('You were hit too many times.');
    }
  }

  protected tick(dt: number): void {
    this.nextShot -= dt;
    if (this.nextShot <= 0 && this.fired < this.def.shots) {
      this.nextShot = this.interval;
      this.fire();
    }
    for (const s of this.shots) {
      if (s.outcome !== 'flying') continue;
      if (!s.p.alive) this.resolve(s, s.p.cast.caster !== s.launcher ? 'deflected' : 'absorbed');
    }
    if (this.fired >= this.def.shots && this.shots.every((s) => s.outcome !== 'flying') && this.credited < this.def.need) this.fail('Not enough bolts stopped. Try again.');
  }

  override debugInfo(): Record<string, unknown> {
    return { fired: this.fired, credited: this.credited, hits: this.hits, launchers: this.launchers.map((l) => ({ x: l.position.x, z: l.position.z })) };
  }
}

// ---------------------------------------------------------------------------
// Movement trials (rings)
// ---------------------------------------------------------------------------

class RingsChallenge extends Challenge {
  private rings: Array<{ obj: THREE.Mesh; mat: THREE.MeshBasicMaterial; pos: THREE.Vector3; r: number }> = [];
  private index = 0;
  private warned = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'rings' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return `Pass through the glowing rings in order${this.def.technique ? ` using ${techName(this.def.technique)}` : ''}`;
  }

  counter(): string {
    return `${this.index} / ${this.rings.length}`;
  }

  progress(): number {
    return this.index / Math.max(1, this.rings.length);
  }

  override hint(): string {
    if (this.def.path === 'climb') return 'Jump, then jump again in mid-air — the high rings need every leap';
    return super.hint();
  }

  start(): void {
    const d = this.def;
    const r = this.env.radius;
    const pts: Array<{ p: THREE.Vector3; h: number }> = [];
    for (let i = 0; i < d.count; i++) {
      switch (d.path) {
        case 'climb': {
          const hs = [2.0, 3.6, 5.6, 3.6, 5.8, 4.0];
          pts.push({ p: this.field(3.5 + i * 3.2, i % 2 ? 1.5 : -1.5), h: hs[i % hs.length] });
          break;
        }
        case 'circle': {
          const rr = Math.min(d.radius ?? 9, r * 0.7);
          const a = (i / d.count) * Math.PI * 2 + Math.PI;
          const c = this.field(rr * 0.6 + 0.5, 0);
          pts.push({ p: new THREE.Vector3(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr), h: 1.3 });
          break;
        }
        case 'zigzag':
          pts.push({ p: this.field(4 + i * (r * 1.3) / d.count, i % 2 ? r * 0.35 : -r * 0.35), h: 1.3 });
          break;
        default:
          pts.push({ p: this.field(4.5 + i * 3.0, 0), h: 1.3 });
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const { p, h } = pts[i];
      const y = floorAt(this.env, p.x, p.z) + h;
      const pos = new THREE.Vector3(p.x, y, p.z);
      const ringR = 1.45;
      const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? '#ffd27a' : '#9fd8ff', transparent: true, opacity: i === 0 ? 0.95 : 0.45, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.09, 8, 36), mat);
      mesh.position.copy(pos);
      const next = pts[i + 1]?.p ?? this.field(100, 0);
      const prev = i > 0 ? pts[i - 1].p : this.env.start;
      mesh.rotation.y = Math.atan2(next.x - prev.x, next.z - prev.z);
      this.addObject(mesh);
      this.rings.push({ obj: mesh, mat, pos, r: ringR });
    }
  }

  protected tick(): void {
    const ring = this.rings[this.index];
    if (!ring) return;
    const p = this.ctx.player!;
    const chestY = p.position.y + 1.0;
    const dxz = Math.hypot(p.position.x - ring.pos.x, p.position.z - ring.pos.z);
    ring.obj.rotation.z += 0.02;
    if (dxz < ring.r + 0.4 && Math.abs(chestY - ring.pos.y) < 0.95) {
      const tech = this.def.technique;
      if (tech && !this.recentlyCast(tech, 2.5)) {
        if (this.time - this.warned > 2.5) {
          this.warned = this.time;
          this.ctx.events.emit('ui:notify', { text: `Pass the ring using ${techName(tech)}!`, kind: 'warning', duration: 2 });
        }
        return;
      }
      this.ctx.vfx.ring(ring.pos.clone(), '#ffd27a', 1.8, 0.4, { vertical: true });
      this.ctx.audio.play('ui_click', { bus: 'ui', volume: 0.5, pitch: 1.3 + this.index * 0.08 });
      ring.mat.color.set('#7fd17a');
      ring.mat.opacity = 0.15;
      this.index++;
      const nx = this.rings[this.index];
      if (nx) {
        nx.mat.color.set('#ffd27a');
        nx.mat.opacity = 0.95;
      } else this.succeed();
    }
  }

  override debugInfo(): Record<string, unknown> {
    return { index: this.index, rings: this.rings.map((r) => ({ x: +r.pos.x.toFixed(2), y: +r.pos.y.toFixed(2), z: +r.pos.z.toFixed(2) })) };
  }
}

// ---------------------------------------------------------------------------
// Sparring
// ---------------------------------------------------------------------------

interface SparHandleLike {
  readonly entity: Entity;
  readonly active: boolean;
  end(): void;
}

class SparChallenge extends Challenge {
  private round = 0;
  private handle: SparHandleLike | null = null;
  private used = 0;
  private waitNext = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'spar' }>,
  ) {
    super(env, 240);
  }

  objective(): string {
    return `Win the sparring duel${this.def.rounds > 1 ? 's' : ''}${this.def.mustUse ? ` — use ${techName(this.def.mustUse)} at least once` : ''}`;
  }

  counter(): string {
    return `Duel ${Math.min(this.round + 1, this.def.rounds)} / ${this.def.rounds}${this.def.mustUse ? `  ·  ${techName(this.def.mustUse)} ×${this.used}` : ''}`;
  }

  progress(): number {
    return this.round / this.def.rounds;
  }

  override hint(): string {
    return 'Non-lethal: the duel ends when either side is beaten down';
  }

  start(): void {
    this.on('technique:cast', (e) => {
      if (e.isPlayer && this.def.mustUse && e.id === this.def.mustUse) this.used++;
    });
    this.spawnPartner();
  }

  private spawnPartner(): void {
    const enc = this.ctx.extra.get('encounters') as { spawnSparringPartner?(o: Record<string, unknown>): SparHandleLike } | undefined;
    if (!enc?.spawnSparringPartner) {
      this.fail('No sparring partner is available.');
      return;
    }
    const p = this.field(6, (this.round % 2 ? 1.5 : -1.5));
    const names = ['Senior Student', 'Second Student', 'Third Student'];
    const nation = this.env.element;
    const level = Math.min(this.def.level ?? this.ctx.progression.level, this.ctx.progression.level + 3);
    this.handle = enc.spawnSparringPartner({
      element: this.def.element,
      level: Math.max(1, level),
      position: { x: p.x, y: floorAt(this.env, p.x, p.z) + 0.05, z: p.z },
      name: `${names[this.round % names.length]} of ${this.env.masterName}`,
      appearance: npcLook(7000 + this.round * 13 + nation.length, nation, 'student'),
      threshold: 0.2,
      onVictory: () => {
        this.round++;
        if (this.round >= this.def.rounds) {
          if (this.def.mustUse && this.used < 1) this.fail(`You won — but the master wanted to see ${techName(this.def.mustUse)}.`);
          else this.succeed();
        } else this.waitNext = 3.2;
      },
      onDefeat: () => this.fail('You yielded the duel.'),
    });
  }

  protected tick(dt: number): void {
    if (this.waitNext > 0) {
      this.waitNext -= dt;
      if (this.waitNext <= 0 && this.status === 'running') this.spawnPartner();
    }
  }

  override dispose(): void {
    if (this.handle?.active) this.handle.end();
    this.handle = null;
    super.dispose();
  }

  override debugInfo(): Record<string, unknown> {
    const e = this.handle?.entity;
    return { round: this.round, used: this.used, partner: e ? { id: e.id, hp: e.health?.hp ?? 0, maxHp: e.health?.maxHp ?? 0, active: this.handle?.active } : null };
  }
}

// ---------------------------------------------------------------------------
// Ledge / height
// ---------------------------------------------------------------------------

class LedgeChallenge extends Challenge {
  private top = 0;
  private spot = new THREE.Vector3();
  private hold = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'ledge' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return this.def.mode === 'platform' ? `Reach the top of the stone ledge${this.def.technique ? ` with ${techName(this.def.technique)}` : ''}` : `Rise ${this.def.height} m above the ground${this.def.technique ? ` on ${techName(this.def.technique)}` : ''}`;
  }

  counter(): string {
    const p = this.ctx.player!;
    const h = Math.max(0, p.position.y - this.env.center.y);
    return `${h.toFixed(1)} m / ${this.def.height} m`;
  }

  progress(): number {
    const p = this.ctx.player!;
    return Math.min(1, Math.max(0, p.position.y - this.env.center.y) / this.def.height);
  }

  start(): void {
    if (this.def.mode !== 'platform') return;
    const c = this.field(7, 0);
    const floor = floorAt(this.env, c.x, c.z);
    this.top = floor + this.def.height;
    this.spot.set(c.x, this.top, c.z);
    const hx = 1.6, hz = 1.6, hy = this.def.height / 2;
    const yaw = Math.atan2(this.env.forward.x, this.env.forward.z);
    const mat = stdMat('#8a7a62');
    const capMat = stdMat('#c9b27a', { emissive: '#3a2a08' });
    const block = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
    block.position.set(c.x, floor + hy, c.z);
    block.rotation.y = yaw;
    block.castShadow = true;
    block.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.1, 0.08, hz * 2 + 0.1), capMat);
    cap.position.set(0, hy + 0.04, 0);
    block.add(cap);
    this.addObject(block);
    this.colliders.push(this.ctx.world.collision.add({ shape: 'box', x: c.x, y: floor + hy, z: c.z, hx, hy, hz, yaw, walkable: true, surface: 'stone', tag: 'training_ledge' }));
  }

  protected tick(dt: number): void {
    const p = this.ctx.player!;
    const tech = this.def.technique;
    const techOk = !tech || this.recentlyCast(tech, this.def.mode === 'platform' ? 10 : 3);
    if (this.def.mode === 'platform') {
      const on = Math.hypot(p.position.x - this.spot.x, p.position.z - this.spot.z) < 2.0 && p.position.y > this.top - 0.35;
      this.hold = on ? this.hold + dt : 0;
      if (on && this.hold > 0.4) {
        if (techOk) this.succeed();
        else if (this.hold < 0.5) this.ctx.events.emit('ui:notify', { text: `Climb down and use ${techName(tech)} to get up here.`, kind: 'warning', duration: 2.5 });
      }
    } else if (p.position.y - this.env.center.y >= this.def.height && techOk) this.succeed();
  }

  override debugInfo(): Record<string, unknown> {
    return { top: this.top, x: this.spot.x, z: this.spot.z };
  }
}

// ---------------------------------------------------------------------------
// Flame (brazier sustain / kettle fill)
// ---------------------------------------------------------------------------

class FlameChallenge extends Challenge {
  private target!: FlameTarget;
  private held = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'flame' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return this.def.mode === 'fill' ? `Heat the kettle until it sings${this.def.technique ? ` with ${techName(this.def.technique)}` : ''}` : `Keep the sacred flame burning${this.def.technique ? ` — feed it with ${techName(this.def.technique)}` : ''}`;
  }

  counter(): string {
    if (this.def.mode === 'fill') return `Heat ${Math.round(this.target.level * 100)}%`;
    return `Flame ${Math.round(this.target.level * 100)}%  ·  ${Math.min(this.def.duration ?? 20, this.held).toFixed(0)} / ${this.def.duration ?? 20} s`;
  }

  progress(): number {
    return this.def.mode === 'fill' ? this.target.level : Math.min(1, this.held / (this.def.duration ?? 20));
  }

  start(): void {
    const p = this.field(5.5, 0);
    this.target = this.addEntity(new FlameTarget(this.def.mode, this.def.technique ?? null), p.x, p.z);
  }

  protected tick(dt: number): void {
    const t = this.target;
    if (this.def.mode === 'fill') {
      if (t.level >= 0.999) this.succeed();
      return;
    }
    t.level = Math.max(0, t.level - dt / 10);
    if (t.level <= 0) return this.fail('The flame went out.');
    this.held += dt;
    if (this.held >= (this.def.duration ?? 20)) {
      if (this.def.technique && t.techFeeds < 1) return this.fail(`Feed the flame with ${techName(this.def.technique)}.`);
      this.succeed();
    }
  }

  override debugInfo(): Record<string, unknown> {
    return { id: this.target?.id, level: this.target?.level, feeds: this.target?.techFeeds, x: this.target?.position.x, y: this.target?.position.y, z: this.target?.position.z };
  }
}

// ---------------------------------------------------------------------------
// Stance in the gale
// ---------------------------------------------------------------------------

class StanceChallenge extends Challenge {
  private held = 0;
  private gustT = 2;
  private circle!: THREE.Mesh;
  private c = new THREE.Vector3();
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'stance' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return 'Hold your ground inside the circle while the gale pushes you';
  }

  counter(): string {
    return `${this.held.toFixed(1)} / ${this.def.duration} s`;
  }

  progress(): number {
    return this.held / this.def.duration;
  }

  override hint(): string {
    return 'Step back into the circle after each gust · Stone Guard / Rock Armor brace you';
  }

  start(): void {
    const p = this.ctx.player!;
    this.c.copy(p.position);
    const mat = new THREE.MeshBasicMaterial({ color: '#f1d48a', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    this.circle = new THREE.Mesh(new THREE.RingGeometry(this.def.radius - 0.12, this.def.radius, 48), mat);
    this.circle.rotation.x = -Math.PI / 2;
    this.circle.position.set(this.c.x, this.c.y + 0.06, this.c.z);
    this.addObject(this.circle);
  }

  protected tick(dt: number): void {
    const p = this.ctx.player!;
    const inside = Math.hypot(p.position.x - this.c.x, p.position.z - this.c.z) < this.def.radius;
    if (inside) this.held += dt;
    else if (this.held > 0) {
      this.held = Math.max(0, this.held - dt * 3);
    }
    this.gustT -= dt;
    if (this.gustT <= 0 && p.body) {
      this.gustT = 1.6 + Math.random() * 1.2;
      const a = Math.random() * Math.PI * 2;
      let k = this.def.gust;
      if (p.guarding) k *= 0.35;
      if (p.hasStatus('armor')) k *= 0.3;
      if (p.element === 'earth') k *= 0.7;
      p.body.impulse(Math.cos(a) * k, 0, Math.sin(a) * k);
      this.ctx.vfx.burst('air', p.aimPoint(tmpB).addScaledVector(new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)), 1.5), { count: 14, dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) });
      this.ctx.audio.play('whoosh', { position: p.position, volume: 0.5, pitch: 0.7 });
    }
    (this.circle.material as THREE.MeshBasicMaterial).color.set(inside ? '#f1d48a' : '#e0503a');
    if (this.held >= this.def.duration) this.succeed();
  }
}

// ---------------------------------------------------------------------------
// Healing / reserve
// ---------------------------------------------------------------------------

class HealChallenge extends Challenge {
  private casts = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'heal' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return `Heal yourself to ${Math.round(this.def.targetFrac * 100)}% with ${techName(this.def.technique)}`;
  }

  counter(): string {
    const h = this.ctx.player!.health!;
    return `Health ${Math.round(h.fraction * 100)}%`;
  }

  progress(): number {
    const h = this.ctx.player!.health!;
    return Math.min(1, Math.max(0, (h.fraction - this.def.startFrac) / (this.def.targetFrac - this.def.startFrac)));
  }

  override hint(): string {
    return 'Stay near water · the technique heals over a few seconds';
  }

  start(): void {
    const h = this.ctx.player!.health!;
    h.hp = Math.min(h.hp, h.maxHp * this.def.startFrac);
    this.ctx.vfx.burst('spirit', this.ctx.player!.aimPoint(tmpA), { count: 10 });
    this.on('technique:cast', (e) => {
      if (e.isPlayer && e.id === this.def.technique) this.casts++;
    });
  }

  protected tick(): void {
    const h = this.ctx.player!.health!;
    if (this.casts > 0 && h.fraction >= this.def.targetFrac - 1e-3) this.succeed();
  }
}

class ReserveChallenge extends Challenge {
  private gained = 0;
  private last = 0;
  constructor(
    env: ChallengeEnv,
    private readonly def: Extract<ChallengeDef, { type: 'reserve' }>,
  ) {
    super(env, def.time);
  }

  objective(): string {
    return `Gather water from the air and plants with ${techName(this.def.technique)}`;
  }

  counter(): string {
    return `${Math.floor(this.gained)} / ${this.def.amount} water`;
  }

  progress(): number {
    return this.gained / this.def.amount;
  }

  start(): void {
    this.last = this.ctx.player!.waterReserve;
  }

  protected tick(): void {
    const p = this.ctx.player!;
    const r = p.waterReserve;
    if (r > this.last && this.recentlyCast(this.def.technique, 4)) this.gained += r - this.last;
    this.last = r;
    if (this.gained >= this.def.amount) this.succeed();
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createChallenge(def: ChallengeDef, env: ChallengeEnv): Challenge {
  switch (def.type) {
    case 'targets':
    case 'precision':
    case 'waterTargets':
      return new TargetsChallenge(env, def);
    case 'defense':
      return new DefenseChallenge(env, def);
    case 'rings':
      return new RingsChallenge(env, def);
    case 'spar':
      return new SparChallenge(env, def);
    case 'ledge':
      return new LedgeChallenge(env, def);
    case 'flame':
      return new FlameChallenge(env, def);
    case 'stance':
      return new StanceChallenge(env, def);
    case 'heal':
      return new HealChallenge(env, def);
    case 'reserve':
      return new ReserveChallenge(env, def);
  }
}

/** Human-readable name of a challenge type (journal / HUD). */
export function challengeKind(def: ChallengeDef): string {
  switch (def.type) {
    case 'targets':
      return 'Target practice';
    case 'precision':
      return 'Precision drill';
    case 'waterTargets':
      return 'Water drawing drill';
    case 'defense':
      return 'Defense drill';
    case 'rings':
      return 'Movement trial';
    case 'spar':
      return 'Sparring duel';
    case 'ledge':
      return 'Ascent trial';
    case 'flame':
      return 'Flame discipline';
    case 'stance':
      return 'Stance in the gale';
    case 'heal':
      return 'Healing practice';
    case 'reserve':
      return 'Gathering practice';
  }
}
