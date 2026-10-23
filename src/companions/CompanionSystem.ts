import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import { abilitiesAt, bondLevelName, HOMELAND_FOOD, speciesById, type HabitatDef, type SpeciesDef } from '../data/creatures';
import { itemById } from '../data/items';
import { h } from '../ui/dom';
import { ModelViewer } from './debugViewer';
import { Creature } from './Creature';
import { HabitatManager } from './Habitats';
import { TamingManager } from './Taming';
import { RidingController } from './Riding';
import { DragonTrial } from './DragonTrial';
import { StableScreen } from './StableScreen';

/**
 * Animal companions: species habitats, wild creature spawning, discovery,
 * taming/bonding, the companion stable, summoning and riding.
 *
 * Public API used by other systems (keep stable):
 *  - bondedCount(speciesId?)            number of bonded companions (quests)
 *  - mounted                            true while riding
 *  - mountedFlying                      true while riding a flying mount
 *  - dismount()                         force dismount (cutscenes, Avatar State)
 *  - bonded                             list of bonded companion records (UI)
 *  - discoveredSpecies                  bestiary
 *
 * Persistence (saveKey 'companions', v2): bonded records (id, species, name,
 * bond, abilities, variant, scale, home, summoned), discovered species, wild
 * taming trust per individual (kept — patience is never wasted), story flags
 * (rescues, Sun Stone, dragon), clues found. Challenge progress is not saved.
 */
export interface CompanionRecord {
  id: string;
  speciesId: string;
  name: string;
  bond: number; // 0..100
  variant: number;
  /** Abilities unlocked through bonding (e.g. 'flight', 'sprint', 'dig'). */
  abilities: string[];
  /** Whether it is the active companion of its role (mount / pet) for the F key. */
  active: boolean;
  /** Home position when dismissed. */
  home?: { x: number; z: number };
  /** Habitat it came from. */
  habitat?: string;
  /** Individual size. */
  scale?: number;
  /** Currently out with the player. */
  summoned?: boolean;
  /** Bond-progress accumulators. */
  together?: number;
  travelled?: number;
  fedAt?: number;
}

export class CompanionSystem implements GameSystem, Persistable {
  readonly saveKey = 'companions';
  protected ctx!: GameContext;
  bonded: CompanionRecord[] = [];
  mounted = false;
  mountedFlying = false;
  /** Creature ids the player has discovered (journal/bestiary). */
  readonly discoveredSpecies = new Set<string>();
  /** Story flags: rescued:<uid>, shard:<id>, sun_stone_set, dragon_called. */
  readonly flags = new Set<string>();
  readonly cluesFound = new Set<string>();
  /** Taming trust of wild individuals (uid → 0..100), persisted. */
  readonly wildTrust = new Map<string, number>();
  /** Habitats seen (bestiary). */
  readonly habitatsKnown = new Set<string>();
  /** Every live creature by uid (wild, ambient and companions). */
  readonly creatures = new Map<string, Creature>();
  habitats!: HabitatManager;
  taming!: TamingManager;
  riding!: RidingController;
  dragon!: DragonTrial;
  /** Tests: skip the naming prompt on bonding. */
  autoName = false;
  private viewer!: ModelViewer;
  private hud: HTMLElement | null = null;
  private hudText = '';
  private discoverT = 0;
  private upkeepT = 0;
  private lastPlayerPos = new THREE.Vector3();
  private guardCd = 0;
  private petUnreg = new Map<string, () => void>();
  private readonly frustum = new THREE.Frustum();
  private readonly projM = new THREE.Matrix4();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.viewer = new ModelViewer(ctx);
    this.habitats = new HabitatManager(this, ctx);
    this.taming = new TamingManager(this, ctx);
    this.riding = new RidingController(this, ctx);
    this.dragon = new DragonTrial(this, ctx);
    ctx.events.on('player:damaged', (e) => {
      const p = ctx.player;
      if (!p) return;
      if (this.mounted && e.amount >= Math.max(30, (p.health?.maxHp ?? 100) * 0.22)) this.riding.onHeavyHit();
      // Guardian perk: companions strike back.
      if (e.sourceId && this.guardCd <= 0) {
        const src = ctx.entities.get(e.sourceId);
        if (src && src.alive && src.team === 'hostile') {
          for (const c of this.companionCreatures()) {
            const rec = this.record(c.companionId!);
            if (!rec || !rec.abilities.includes('guard') || c.state === 'ridden') continue;
            if (c.position.distanceTo(src.position) > 30) continue;
            this.guardCd = 3;
            if (c.def.id === 'dragon') this.riding.breathFire(c, src.position.clone().sub(c.position).normalize());
            else ctx.combat.applyHit(c, src, { attacker: c, damage: 16, element: 'earth', techniqueId: 'companion_guard', knockback: src.position.clone().sub(c.position).setY(0).normalize().multiplyScalar(10), stagger: 25 });
          }
        }
      }
    });
    ctx.events.on('quest:completed', () => {
      for (const c of this.companionCreatures()) this.addBond(c.companionId!, 4);
    });
    ctx.events.on('avatarState:changed', (e) => {
      if (e.active && this.mounted) this.riding.dismount(true);
    });
    queueMicrotask(() => {
      ctx.ui.registerScreen('companions', (ui) => new StableScreen(ui, this));
      const g = (window as any).__game;
      if (!g) return;
      g.debug.companions = this.debugApi();
    });
  }

  // ---------------------------------------------------------------- creature registry

  registerCreature(c: Creature, habitat: HabitatDef | null): void {
    this.ctx.entities.add(c);
    this.creatures.set(c.uid, c);
    c.onExhausted = (cr) => this.onExhausted(cr);
    if (c.mode === 'wild') this.taming.attach(c);
    if (habitat) this.habitatsKnown.add(habitat.id);
  }

  removeCreature(c: Creature): void {
    this.taming.detach(c);
    this.habitats.forget(c);
    this.petUnreg.get(c.uid)?.();
    this.petUnreg.delete(c.uid);
    if (this.creatures.get(c.uid) === c) this.creatures.delete(c.uid);
    if (this.riding.mount === c) this.riding.reset();
    this.ctx.entities.remove(c);
  }

  creatureByUid(uid: string): Creature | null {
    return this.creatures.get(uid) ?? null;
  }

  isUidBonded(uid: string): boolean {
    return this.bonded.some((r) => r.id === uid);
  }

  wildCreatures(): Creature[] {
    const out: Creature[] = [];
    for (const c of this.creatures.values()) if (c.mode === 'wild') out.push(c);
    return out;
  }

  ambientCreatures(): Creature[] {
    const out: Creature[] = [];
    for (const c of this.creatures.values()) if (c.mode === 'ambient') out.push(c);
    return out;
  }

  companionCreatures(): Creature[] {
    const out: Creature[] = [];
    for (const c of this.creatures.values()) if (c.mode === 'companion' && c.companionId) out.push(c);
    return out;
  }

  record(id: string): CompanionRecord | null {
    return this.bonded.find((r) => r.id === id) ?? null;
  }

  creatureFor(id: string): Creature | null {
    for (const c of this.creatures.values()) if (c.companionId === id && !c.disposed) return c;
    return null;
  }

  onHabitatSpawned(h: HabitatDef): void {
    this.habitatsKnown.add(h.id);
  }

  clueFound(key: string, h: HabitatDef): void {
    const fresh = !this.cluesFound.has(key);
    this.cluesFound.add(key);
    this.habitatsKnown.add(h.id);
    if (fresh) this.ctx.progression.addXP(10);
  }

  // ---------------------------------------------------------------- lifecycle

  onSessionStart(ctx: GameContext, isNew: boolean): void {
    if (isNew && ctx.session.kind === 'campaign') {
      const food = HOMELAND_FOOD[ctx.progression.startingElement];
      if (food && !ctx.inventory.has(food.item)) ctx.inventory.add(food.item, food.count, true);
    }
    this.lastPlayerPos.copy(ctx.player?.position ?? this.lastPlayerPos);
    // Companions that were out with you come back.
    for (const r of this.bonded) if (r.summoned) this.spawnCompanion(r, 'near');
  }

  onSessionEnd(): void {
    this.viewer.clear();
    this.riding.reset();
    this.taming.clear();
    this.dragon.clear();
    this.habitats.clear();
    for (const c of [...this.creatures.values()]) this.removeCreature(c);
    this.creatures.clear();
    this.hudShow('');
  }

  update(dt: number): void {
    this.viewer.update(dt);
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p || !ctx.session.active) return;
    this.guardCd = Math.max(0, this.guardCd - dt);
    this.habitats.update(dt);
    this.habitats.updateProps();
    this.taming.update(dt);
    this.dragon.update(dt);
    this.riding.update(dt);
    // Avatar State: entering it throws you off the mount (activation is refused while mounted, so do it here).
    if (this.mounted && !ctx.ui.blocksGameplay && ctx.input.wasPressed('avatarState')) {
      this.riding.dismount(true);
      ctx.avatar.activate();
    }
    if (!ctx.ui.blocksGameplay && ctx.input.wasPressed('companion')) this.onCompanionKey();
    this.upkeep(dt);
    this.discoverT -= dt;
    if (this.discoverT <= 0) {
      this.discoverT = 0.3;
      this.checkDiscovery();
    }
    this.updateHud();
  }

  /** F: dismount / mount the nearby summoned mount / call it / summon the active one. */
  onCompanionKey(): void {
    if (this.riding.transitioning) return;
    if (this.mounted || this.riding.mount) {
      this.riding.dismount(false);
      return;
    }
    const p = this.ctx.player!;
    const mounts = this.companionCreatures().filter((c) => c.def.rideable && c.state !== 'leave');
    const near = mounts.filter((c) => Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z) < c.radius + 4.5 && Math.abs(c.position.y - p.position.y) < 4);
    if (near.length) {
      this.riding.mountUp(near[0]);
      return;
    }
    if (mounts.length) {
      const c = mounts[0];
      c.setState('arrive');
      this.ctx.audio.play('ui.interact', { volume: 0.5 });
      this.ctx.events.emit('ui:notify', { text: `You whistle — ${this.record(c.companionId!)?.name ?? c.name} comes to you.`, kind: 'info', duration: 2 });
      return;
    }
    const active = this.bonded.find((r) => r.active && speciesById(r.speciesId)?.rideable) ?? this.bonded.find((r) => speciesById(r.speciesId)?.rideable);
    if (active) {
      this.summon(active.id);
      return;
    }
    const pet = this.bonded.find((r) => r.active) ?? this.bonded[0];
    if (pet) this.summon(pet.id);
    else this.ctx.events.emit('ui:notify', { text: 'You have no companions yet. Find animals in the wild and earn their trust (P: Companion Stable).', kind: 'info', duration: 3 });
  }

  // ---------------------------------------------------------------- bonding

  /** Turn a wild creature into a bonded companion (it stays with you). */
  bondCreature(c: Creature, name?: string): CompanionRecord | null {
    if (c.mode === 'companion') return this.record(c.companionId!);
    const def = c.def;
    const id = this.isUidBonded(c.uid) ? `${c.uid}~${Date.now().toString(36)}` : c.uid;
    const used = new Set(this.bonded.map((r) => r.name));
    const defaultName = name ?? def.names.find((n) => !used.has(n)) ?? def.name;
    const role = def.role;
    const hab = c.uid.includes('#') ? c.uid.split('#')[0] : undefined;
    const rec: CompanionRecord = {
      id,
      speciesId: def.id,
      name: defaultName.slice(0, 24),
      bond: 10,
      variant: c.variant,
      abilities: abilitiesAt(def.id, 10),
      active: !this.bonded.some((r) => r.active && speciesById(r.speciesId)?.role === role),
      home: { x: c.home.x, z: c.home.z },
      habitat: hab,
      scale: c.scale,
      summoned: true,
      together: 0,
      travelled: 0,
    };
    // One mount and one pet out at a time.
    for (const other of this.companionCreatures()) if (other.def.role === role && other !== c) this.dismiss(other.companionId!);
    this.bonded.push(rec);
    this.taming.detach(c);
    this.habitats.forget(c);
    c.mode = 'companion';
    c.team = 'ally';
    c.companionId = id;
    if (this.riding.mount === c) {
      // Bonded mid-ride (bison flight challenge): it is your saddled mount now.
      this.riding.challengeRide = false;
      c.model.setSaddle(true);
    }
    c.fear = 0;
    c.happyT = 4;
    c.forcedAction = c.forcedAction === 'bow' ? 'bow' : null;
    c.health!.maxHp = def.hp;
    c.health!.hp = def.hp;
    if (c.state !== 'ridden') c.setState('follow');
    c.leash = 1e9;
    this.discoveredSpecies.add(def.id);
    this.attachPetInteraction(c);
    this.ctx.events.emit('companion:bonded', { companionId: id, speciesId: def.id, name: rec.name });
    this.ctx.events.emit('ui:notify', { text: `${def.name} bonded! It will follow you — open the Companion Stable (P) to name it.`, kind: 'success', duration: 5, icon: '💛' });
    this.ctx.audio.play('ui.levelup', { volume: 0.7 });
    if (!this.autoName && !this.ctx.ui.blocksGameplay) this.ctx.ui.open('companions', { name: id });
    return rec;
  }

  rename(id: string, name: string): boolean {
    const r = this.record(id);
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!r || !n) return false;
    r.name = n;
    const c = this.creatureFor(id);
    if (c) c.name = n;
    return true;
  }

  setActive(id: string): void {
    const r = this.record(id);
    if (!r) return;
    const role = speciesById(r.speciesId)?.role;
    for (const o of this.bonded) if (speciesById(o.speciesId)?.role === role) o.active = false;
    r.active = true;
  }

  addBond(id: string, amount: number): void {
    const r = this.record(id);
    if (!r) return;
    const before = r.abilities.slice();
    r.bond = Math.max(0, Math.min(100, r.bond + amount));
    r.abilities = abilitiesAt(r.speciesId, r.bond);
    const def = speciesById(r.speciesId);
    for (const a of r.abilities) {
      if (before.includes(a)) continue;
      const u = def?.bondUnlocks.find((x) => x.ability === a);
      if (u) this.ctx.events.emit('ui:notify', { text: `${r.name} — bond ${bondLevelName(r.bond)}: ${u.name}. ${u.description}`, kind: 'learn', duration: 6, icon: '💛' });
    }
  }

  // ---------------------------------------------------------------- summon / dismiss

  private visible(pos: THREE.Vector3): boolean {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this.projM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    return this.frustum.containsPoint(pos);
  }

  /** Find an off-screen spawn point behind the camera (no pop-in). */
  private spawnPoint(def: SpeciesDef, dist: number): THREE.Vector3 {
    const ctx = this.ctx;
    const p = ctx.player!;
    const camF = ctx.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const base = Math.atan2(-camF.x, -camF.z);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      const a = base + off;
      const x = p.position.x + Math.sin(a) * dist, z = p.position.z + Math.cos(a) * dist;
      const g = ctx.world.groundAt(x, z, Math.max(ctx.world.heightAt(x, z) + 3, p.position.y + 2.5));
      const w = ctx.world.liquidAt(x, z);
      const pos = new THREE.Vector3(x, g.y, z);
      if (def.flying) {
        pos.y = Math.max(g.y, w?.level ?? -1e9, p.position.y) + 25 + def.size.length;
        return pos;
      }
      if (w && w.level - g.y > 0.6) continue;
      if (g.colliderId === 0 && g.ny < def.maxSlopeNy) continue;
      if (this.visible(pos.clone().setY(pos.y + 1)) && off !== Math.PI) continue;
      return pos;
    }
    return new THREE.Vector3(p.position.x - Math.sin(p.yaw) * 6, p.position.y, p.position.z - Math.cos(p.yaw) * 6);
  }

  private spawnCompanion(r: CompanionRecord, how: 'near' | 'far'): Creature | null {
    const def = speciesById(r.speciesId);
    const p = this.ctx.player;
    if (!def || !p) return null;
    const existing = this.creatureFor(r.id);
    if (existing) return existing;
    let c: Creature;
    try {
      c = new Creature(this.ctx, def, r.id, { mode: 'companion', variant: r.variant, scale: r.scale ?? 1 });
    } catch (err) {
      console.warn('[Companions] cannot spawn companion', err);
      return null;
    }
    c.companionId = r.id;
    c.name = r.name;
    c.leash = 1e9;
    const dist = how === 'near' ? 8 + def.radius * 2 : def.flying ? 70 : 40;
    const pos = this.spawnPoint(def, dist);
    c.placeAt(pos, Math.atan2(p.position.x - pos.x, p.position.z - pos.z));
    c.home.set(r.home?.x ?? pos.x, 0, r.home?.z ?? pos.z);
    this.registerCreature(c, null);
    if (def.flying && pos.y > this.ctx.world.groundAt(pos.x, pos.z).y + 2) c.takeOff(pos.y);
    c.setState('arrive');
    this.attachPetInteraction(c);
    return c;
  }

  summon(id: string): boolean {
    const r = this.record(id);
    if (!r || !this.ctx.player) return false;
    const role = speciesById(r.speciesId)?.role;
    for (const o of this.companionCreatures()) if (o.companionId !== id && o.def.role === role && o.state !== 'leave') this.dismiss(o.companionId!);
    const c = this.creatureFor(id) ?? this.spawnCompanion(r, 'far');
    if (!c) return false;
    if (c.state !== 'ridden') c.setState('arrive');
    r.summoned = true;
    this.ctx.events.emit('companion:summoned', { companionId: id });
    this.ctx.events.emit('ui:notify', { text: `You call ${r.name}. ${c.def.flying ? 'A shape appears in the sky…' : 'You hear it coming!'}`, kind: 'info', duration: 2.5 });
    this.ctx.audio.play(c.def.sounds.call, { position: c.position, volume: 1, range: 400 });
    return true;
  }

  dismiss(id: string, home = false): boolean {
    const r = this.record(id);
    if (!r) return false;
    const c = this.creatureFor(id);
    if (c && this.riding.mount === c) {
      if (!this.riding.dismount(false)) return false;
    }
    r.summoned = false;
    if (home && r.habitat) {
      const hab = this.habitats.allHabitats().find((x) => x.id === r.habitat);
      if (hab) {
        const ctr = this.habitats.centre(hab);
        r.home = { x: ctr.x, z: ctr.z };
      }
    }
    if (c) {
      c.setState('leave');
      c.stateT = 0;
    }
    this.ctx.events.emit('companion:dismissed', { companionId: id });
    return true;
  }

  /** Force dismount (cutscenes, travel, Avatar State). */
  dismount(): void {
    if (this.riding?.mount || this.riding?.transitioning) this.riding.dismount(true);
    this.mounted = false;
    this.mountedFlying = false;
  }

  private onExhausted(c: Creature): void {
    if (c.mode !== 'companion' || !c.companionId) {
      c.scare(1, c.position);
      return;
    }
    if (this.riding.mount === c) this.riding.dismount(true);
    const r = this.record(c.companionId);
    this.ctx.events.emit('ui:notify', { text: `${r?.name ?? c.name} is hurt and limps home to recover.`, kind: 'warning', duration: 4 });
    this.dismiss(c.companionId);
  }

  /** E on your own companion: feed it (bond) or give it a scratch. */
  private attachPetInteraction(c: Creature): void {
    if (this.petUnreg.has(c.uid)) return;
    const self = this;
    const off = this.ctx.interactions.register({
      id: `pet:${c.uid}`,
      position: c.root.position,
      radius: c.radius + 2.6,
      get label() {
        const r = c.companionId ? self.record(c.companionId) : null;
        const food = self.foodFor(c.def);
        return food ? `Feed ${r?.name ?? c.name} (${itemById(food)?.name ?? food})` : `Pet ${r?.name ?? c.name}`;
      },
      priority: 1,
      enabled: () => c.mode === 'companion' && c.state !== 'ridden' && c.state !== 'leave' && !this.mounted,
      interact: () => this.petCompanion(c),
    });
    this.petUnreg.set(c.uid, off);
  }

  private foodFor(def: SpeciesDef): string | null {
    for (const id of [...def.diet.preferred, ...def.diet.liked]) if (this.ctx.inventory.has(id)) return id;
    return null;
  }

  petCompanion(c: Creature): void {
    const r = c.companionId ? this.record(c.companionId) : null;
    if (!r) return;
    const now = this.ctx.time.elapsed;
    const food = this.foodFor(c.def);
    c.happyT = 3;
    c.forcedAction = food ? 'eat' : 'happy';
    setTimeout(() => {
      if (c.forcedAction === 'eat' || c.forcedAction === 'happy') c.forcedAction = null;
    }, 1800);
    this.ctx.audio.play(c.def.sounds.content ?? c.def.sounds.call, { position: c.position, volume: 0.7 });
    if (food && now - (r.fedAt ?? -1e9) > 60) {
      this.ctx.inventory.remove(food, 1);
      r.fedAt = now;
      this.addBond(r.id, 3);
      this.ctx.events.emit('ui:notify', { text: `${r.name} munches happily. Bond ${Math.round(r.bond)}%`, kind: 'success', duration: 2.5 });
    } else if (food) {
      this.ctx.events.emit('ui:notify', { text: `${r.name} is full — it nuzzles you instead.`, kind: 'info', duration: 2 });
    }
  }

  // ---------------------------------------------------------------- per-frame upkeep

  private upkeep(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const moved = Math.hypot(p.position.x - this.lastPlayerPos.x, p.position.z - this.lastPlayerPos.z);
    this.lastPlayerPos.copy(p.position);
    const travelled = moved < 50 ? moved : 0; // ignore teleports
    for (const c of this.companionCreatures()) {
      const r = this.record(c.companionId!);
      if (!r) continue;
      if (c.state === 'leave') {
        const d = c.distToPlayer || c.position.distanceTo(p.position);
        if ((d > 30 && !this.visible(c.aimPoint())) || d > 90 || c.stateT > 25) this.removeCreature(c);
        continue;
      }
      // Bond: time together and travel together.
      r.together = (r.together ?? 0) + dt;
      if (r.together >= 120) {
        r.together -= 120;
        this.addBond(r.id, 1);
      }
      if (c.state === 'ridden' || c.position.distanceTo(p.position) < 40) {
        r.travelled = (r.travelled ?? 0) + travelled;
        if (r.travelled >= 250) {
          r.travelled -= 250;
          this.addBond(r.id, 1);
        }
      }
      // Far behind (e.g. after fast travel): catch up off-screen.
      const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
      if (d > 220 && c.state !== 'ridden') {
        const pos = this.spawnPoint(c.def, 35);
        c.placeAt(pos, c.yaw);
        if (c.def.flying && pos.y > ctx.world.groundAt(pos.x, pos.z).y + 2) c.takeOff(pos.y);
        else {
          c.flying = false;
          c.body!.kinematic = false;
        }
        c.setState('arrive');
      }
    }
    this.petPerks(dt);
    // Summoned-dragon guard fire.
    this.upkeepT -= dt;
    if (this.upkeepT > 0) return;
    this.upkeepT = 0.5;
    for (const c of this.companionCreatures()) {
      const r = this.record(c.companionId!);
      if (!r || c.state === 'ridden' || c.state === 'leave') continue;
      if (c.def.id === 'dragon' && r.abilities.includes('fire_breath')) {
        const foe = ctx.entities.nearest(p.position, 14, { teams: ['hostile'], aliveOnly: true });
        if (foe && this.guardCd <= 0 && c.position.distanceTo(foe.position) < 26) {
          this.guardCd = 4;
          this.riding.breathFire(c, foe.aimPoint(new THREE.Vector3()).sub(c.model.mouth.getWorldPosition(new THREE.Vector3())).normalize());
        }
      }
    }
  }

  private fetchT = 120;

  /** Pet perks: lemur shoulder perch + fetch, turtle-duck comfort. */
  private petPerks(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const speed = p.body?.horizontalSpeed ?? 0;
    for (const c of this.companionCreatures()) {
      const r = this.record(c.companionId!);
      if (!r || c.state === 'leave') continue;
      const d = c.position.distanceTo(p.position);
      if (c.def.id === 'winged_lemur' && r.abilities.includes('perch')) {
        const calm = speed < 2.6 && !this.mounted && !p.defeated;
        if (c.state === 'perch') {
          if (!calm) {
            c.body!.kinematic = false;
            c.setState('follow');
            c.takeOff(p.position.y + 2.5);
          } else {
            // Left shoulder (+X local), slightly behind.
            const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
            const pos = new THREE.Vector3(p.position.x + cy * 0.2 - sy * 0.05, p.position.y + 1.5 * (p.height / 1.75), p.position.z - sy * 0.2 - cy * 0.05);
            c.placeAt(pos, p.yaw);
            c.flying = false;
            c.body!.kinematic = true;
          }
        } else if (calm && d < 3.5 && c.state === 'follow' && c.stateT > 3) {
          c.setState('perch');
        }
        if (r.abilities.includes('fetch')) {
          this.fetchT -= dt;
          if (this.fetchT <= 0) {
            this.fetchT = 150 + Math.random() * 90;
            ctx.inventory.add('lychee_nuts', 1, true);
            ctx.events.emit('ui:notify', { text: `${r.name} brings you a lychee nut it found!`, kind: 'info', duration: 3, icon: '🐒' });
          }
        }
      }
      if (c.def.id === 'turtle_duck' && r.abilities.includes('comfort') && d < 8 && p.health && !p.defeated) p.health.heal(2 * dt);
    }
  }

  private checkDiscovery(): void {
    const p = this.ctx.player!;
    for (const c of this.creatures.values()) {
      if (c.mode === 'companion' || this.discoveredSpecies.has(c.def.id)) continue;
      const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
      const range = Math.max(14, c.def.size.length * 3.5);
      if (d > range || !c.model.root.visible) continue;
      this.discoveredSpecies.add(c.def.id);
      this.ctx.events.emit('creature:discovered', { speciesId: c.def.id, creatureId: c.uid });
      this.ctx.events.emit('ui:notify', { text: `New creature: ${c.def.name}. Added to the bestiary (P).`, kind: 'discovery', duration: 4, icon: '🐾' });
    }
  }

  // ---------------------------------------------------------------- HUD hint

  private hudShow(text: string): void {
    if (text === this.hudText) return;
    this.hudText = text;
    if (!this.hud) {
      if (!text) return;
      this.hud = h('div.companion-hint', {
        style: {
          position: 'absolute',
          left: '50%',
          bottom: '150px',
          transform: 'translateX(-50%)',
          padding: '5px 12px',
          borderRadius: '8px',
          background: 'rgba(12,12,20,0.6)',
          color: '#f3ead2',
          font: '13px/1.4 system-ui, sans-serif',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        },
      });
      this.ctx.ui.layers.hud.appendChild(this.hud);
    }
    this.hud.style.display = text ? 'block' : 'none';
    this.hud.innerHTML = text;
  }

  private updateHud(): void {
    const ctx = this.ctx;
    const k = (a: Parameters<GameContext['input']['label']>[0]) => `<b>${ctx.input.label(a)}</b>`;
    const ch = this.taming.challenge;
    const R = this.riding;
    let t = '';
    if (ch) t = ch.status();
    else if (R.mount) {
      const c = R.mount;
      const name = c.companionId ? this.record(c.companionId)?.name ?? c.name : c.name;
      if (c.flying) {
        const st = Number.isFinite(R.stamina) ? ` · stamina ${Math.round((R.stamina / R.staminaMax(c)) * 100)}%` : '';
        t = `${name}: ${k('jump')} climb · ${k('dodge')} descend/land · ${R.has('boost') ? `${k('sprint')} boost · ` : ''}${R.has('fire_breath') || R.has('gust') ? `${k('interact')} ${R.has('fire_breath') ? 'dragonfire' : 'tail gust'} · ` : ''}${k('companion')} dismount${st}`;
      } else {
        const sp = R.has('sprint') ? `${k('sprint')} gallop · ` : R.has('burrow') ? `${k('sprint')} burrow · ` : '';
        const ex = c.def.flying ? `${k('jump')} take off · ` : c.def.jump > 0 ? `${k('jump')} jump · ` : '';
        const spc = R.has('charge') ? 'charge' : R.has('kick') ? 'kick' : R.has('dig') ? 'dig' : '';
        t = `${name}: ${sp}${ex}${spc ? `${k('interact')} ${spc} · ` : ''}${k('companion')} dismount`;
      }
    } else if (!ctx.ui.blocksGameplay) {
      const p = ctx.player!;
      for (const c of this.companionCreatures()) {
        if (!c.def.rideable || c.state === 'leave') continue;
        if (Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z) < c.radius + 4.5) {
          t = `${k('companion')} Ride ${this.record(c.companionId!)?.name ?? c.name}`;
          break;
        }
      }
    }
    this.hudShow(t);
  }

  // ---------------------------------------------------------------- persistence

  bondedCount(speciesId?: string): number {
    return this.bonded.filter((c) => !speciesId || c.speciesId === speciesId).length;
  }

  serialize(): unknown {
    if (this.ctx?.session.kind === 'tutorial') return undefined;
    return {
      v: 2,
      bonded: this.bonded.map((r) => ({ ...r, abilities: [...r.abilities] })),
      discovered: [...this.discoveredSpecies],
      trust: Object.fromEntries([...this.wildTrust].map(([k, v]) => [k, Math.round(v * 10) / 10])),
      flags: [...this.flags],
      clues: [...this.cluesFound],
      habitats: [...this.habitatsKnown],
    };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.bonded)) {
      const seen = new Set<string>(this.bonded.map((r) => r.id));
      for (const r of data.bonded) {
        if (!r || typeof r.id !== 'string' || typeof r.speciesId !== 'string' || seen.has(r.id) || !speciesById(r.speciesId)) continue;
        seen.add(r.id);
        const bond = typeof r.bond === 'number' && Number.isFinite(r.bond) ? Math.max(0, Math.min(100, r.bond)) : 10;
        this.bonded.push({
          id: r.id,
          speciesId: r.speciesId,
          name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 24) : speciesById(r.speciesId)!.name,
          bond,
          variant: typeof r.variant === 'number' ? r.variant : 0,
          abilities: abilitiesAt(r.speciesId, bond),
          active: !!r.active,
          home: r.home && typeof r.home.x === 'number' && typeof r.home.z === 'number' ? { x: r.home.x, z: r.home.z } : undefined,
          habitat: typeof r.habitat === 'string' ? r.habitat : undefined,
          scale: typeof r.scale === 'number' && r.scale > 0.3 && r.scale < 2 ? r.scale : 1,
          summoned: !!r.summoned,
          together: typeof r.together === 'number' ? r.together : 0,
          travelled: typeof r.travelled === 'number' ? r.travelled : 0,
        });
      }
    }
    if (Array.isArray(data.discovered)) for (const s of data.discovered) if (typeof s === 'string') this.discoveredSpecies.add(s);
    if (data.trust && typeof data.trust === 'object') for (const [k, v] of Object.entries(data.trust)) if (typeof v === 'number' && Number.isFinite(v)) this.wildTrust.set(k, Math.max(0, Math.min(100, v)));
    if (Array.isArray(data.flags)) for (const f of data.flags) if (typeof f === 'string') this.flags.add(f);
    if (Array.isArray(data.clues)) for (const f of data.clues) if (typeof f === 'string') this.cluesFound.add(f);
    if (Array.isArray(data.habitats)) for (const f of data.habitats) if (typeof f === 'string') this.habitatsKnown.add(f);
  }

  reset(): void {
    this.bonded = [];
    this.discoveredSpecies.clear();
    this.flags.clear();
    this.cluesFound.clear();
    this.habitatsKnown.clear();
    this.wildTrust.clear();
    this.mounted = false;
    this.mountedFlying = false;
  }

  // ---------------------------------------------------------------- debug / tests

  private debugApi(): Record<string, unknown> {
    const self = this;
    const ctx = this.ctx;
    const info = (c: Creature) => ({
      uid: c.uid,
      species: c.def.id,
      mode: c.mode,
      state: c.state,
      trust: Math.round(self.taming.getTrust(c.uid) * 10) / 10,
      x: +c.position.x.toFixed(2),
      y: +c.position.y.toFixed(2),
      z: +c.position.z.toFixed(2),
      flying: c.flying,
      dist: +c.position.distanceTo(ctx.player?.position ?? c.position).toFixed(2),
      scale: c.scale,
      recoveries: c.recoveries,
      visible: c.model.root.visible,
      companionId: c.companionId,
    });
    return {
      viewModel: (species: string, opts?: any) => this.viewer.show(species, opts),
      clearModels: () => this.viewer.clear(),
      state: () => ({
        bonded: self.bonded.map((r) => ({ ...r })),
        mounted: self.mounted,
        mountedFlying: self.mountedFlying,
        mount: self.riding.mount ? info(self.riding.mount) : null,
        stamina: Number.isFinite(self.riding.stamina) ? self.riding.stamina : null,
        discovered: [...self.discoveredSpecies],
        flags: [...self.flags],
        challenge: self.taming.challenge ? { kind: self.taming.challenge.kind, stage: self.taming.challenge.stage, t: self.taming.challenge.t, uid: self.taming.challenge.creature.uid, finish: (self.taming.challenge as any).finish?.toArray?.() ?? null } : null,
        habitats: [...self.habitats.spawned.keys()],
        ambientCells: self.habitats.ambient.size,
      }),
      creatures: (species?: string) => [...self.creatures.values()].filter((c) => !species || c.def.id === species).map(info),
      creature: (uid: string) => {
        const c = self.creatureByUid(uid);
        return c ? info(c) : null;
      },
      /** Spawn a wild creature near the player (debug). */
      spawnWild: (species: string, dist = 10, side = 0, opts: { scale?: number; mode?: 'wild' | 'ambient' } = {}) => {
        const def = speciesById(species);
        const p = ctx.player;
        if (!def || !p) return null;
        const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const x = p.position.x + f.x * dist + f.z * side, z = p.position.z + f.z * dist - f.x * side;
        const uid = `debug:${species}:${Math.random().toString(36).slice(2, 7)}`;
        const c = new Creature(ctx, def, uid, { mode: opts.mode ?? 'wild', scale: opts.scale ?? 1 });
        c.placeAt(new THREE.Vector3(x, ctx.world.groundAt(x, z).y, z), Math.atan2(p.position.x - x, p.position.z - z));
        c.home.copy(c.position);
        c.leash = 40;
        self.registerCreature(c, null);
        c.setState('idle', 5);
        return info(c);
      },
      setTrust: (uid: string, v: number) => {
        const c = self.creatureByUid(uid);
        if (c) self.taming.setTrust(c, v, true);
        return c ? self.taming.getTrust(uid) : null;
      },
      /** E on a wild creature (the real interaction path). */
      interact: (uid: string) => {
        const c = self.creatureByUid(uid);
        if (!c) return false;
        const it = ctx.interactions.get(`tame:${uid}`);
        if (!it || (it.enabled && !it.enabled())) return false;
        it.interact(ctx);
        return true;
      },
      label: (uid: string) => ctx.interactions.get(`tame:${uid}`)?.label ?? null,
      /** Simulate a bending cast by the player (element / technique) — exercises the real event path. */
      cast: (element: string, id = 'debug_cast') => {
        const p = ctx.player!;
        ctx.events.emit('technique:cast', { id, casterId: p.id, element: element as any, isPlayer: true, position: { x: p.position.x, y: p.position.y, z: p.position.z } });
      },
      bond: (uid: string, name?: string) => {
        const c = self.creatureByUid(uid);
        return c ? self.bondCreature(c, name)?.id ?? null : null;
      },
      rename: (id: string, name: string) => self.rename(id, name),
      summon: (id: string) => self.summon(id),
      dismiss: (id: string, home = false) => self.dismiss(id, home),
      setActive: (id: string) => self.setActive(id),
      addBond: (id: string, n: number) => self.addBond(id, n),
      mount: () => {
        const c = self.companionCreatures().find((x) => x.def.rideable && x.state !== 'leave');
        return c ? self.riding.mountUp(c) : false;
      },
      dismountNow: (force = false) => self.riding.dismount(force),
      key: (action: string, down: boolean) => ctx.input.setVirtual(action as any, down),
      autopilot: (on: boolean) => (self.taming.autopilot = on),
      setAutoName: (on: boolean) => (self.autoName = on),
      startChallenge: (uid: string) => {
        const c = self.creatureByUid(uid);
        return c ? self.taming.startChallenge(c) : false;
      },
      dragon: () => self.dragon.snapshot(),
      useAltar: () => self.dragon.useAltar(),
      startDragonTest: () => self.dragon.startTest(),
      dragonPositions: () => ({ ruins: self.dragon.ruins().toArray(), altar: self.dragon.altar().toArray(), plaza: self.dragon.plaza().toArray(), perch: self.dragon.perch().toArray(), shards: [0, 1, 2].map((i) => self.dragon.shardPos(i).toArray()) }),
      takeShard: (i: number) => {
        const id = ['shard_a', 'shard_b', 'shard_c'][i];
        const it = ctx.interactions.get(`sunstone:${id}`);
        if (!it || (it.enabled && !it.enabled())) return false;
        it.interact(ctx);
        return true;
      },
      streaming: (on: boolean) => (self.habitats.enabled = on),
      clearWild: () => {
        for (const c of [...self.creatures.values()]) if (c.mode !== 'companion') self.removeCreature(c);
        self.habitats.clear();
      },
      /** Pen a creature in on all sides and make it walk to a target outside (stuck-recovery test). */
      stuckTest: (uid: string, tx: number, tz: number) => {
        const c = self.creatureByUid(uid);
        if (!c) return false;
        const col = ctx.world.collision;
        const yaw = Math.atan2(tx - c.position.x, tz - c.position.z);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const R = c.radius + 1.2;
        const y = c.position.y + 2;
        const wall = (cx: number, cz: number, hx: number, hz: number) => col.add({ shape: 'box', x: cx, y, z: cz, hx, hy: 3, hz, yaw, tag: 'companion_stuck_test' });
        wall(c.position.x + fx * R, c.position.z + fz * R, R + 0.6, 0.4); // front
        wall(c.position.x + rx * R, c.position.z + rz * R, 0.4, R); // right
        wall(c.position.x - rx * R, c.position.z - rz * R, 0.4, R); // left
        wall(c.position.x - fx * R, c.position.z - fz * R, R + 0.6, 0.4); // back: fully penned in
        c.setState('scripted');
        c.moveTo(tx, tz, c.def.run);
        return true;
      },
      clearStuckTest: () => ctx.world.collision.removeByTag('companion_stuck_test'),
      moveTo: (uid: string, x: number, z: number, speed?: number) => {
        const c = self.creatureByUid(uid);
        if (!c) return false;
        c.moveTo(x, z, speed ?? c.def.run);
        return true;
      },
      /**
       * Tests: advance n fixed simulation frames without drawing them (long flights,
       * headless software rendering is the bottleneck). Gameplay code runs unchanged.
       */
      fastSteps: (n: number, dt = 1 / 30) => {
        const r = ctx.render as any;
        r.render = () => {};
        try {
          for (let i = 0; i < n; i++) (ctx.game as any).frame(dt);
        } finally {
          delete r.render;
        }
        return n;
      },
      /** Place a creature exactly (screenshots / tests). */
      place: (uid: string, x: number, z: number, yaw = 0, freeze = true) => {
        const c = self.creatureByUid(uid);
        if (!c) return false;
        c.placeAt(new THREE.Vector3(x, ctx.world.groundAt(x, z, ctx.world.heightAt(x, z) + 3).y, z), yaw);
        c.stopMoving();
        if (freeze) c.setState('scripted');
        return true;
      },
      setState: (uid: string, s: string) => {
        const c = self.creatureByUid(uid);
        if (c) c.setState(s as any, 30);
        return !!c;
      },
    };
  }
}
