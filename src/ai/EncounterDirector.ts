/**
 * Encounter director — module `encounters` (ctx.extra.get('encounters')).
 *
 * Spawns and streams hostile encounters around the player during campaign
 * sessions: wilderness camps (spots published as `camp_<id>` by region
 * builders, otherwise sensible points along the ROADS between regions),
 * road patrols, roadside ambushes, coastal pirate coves, wild beasts and three
 * named bosses with phases (Fire Nation commander at the Western Causeway,
 * Dai Li captain at Lake Laogai, pirate captain on the southern coast).
 * Composition depends on the region (nation, biome, coast); levels scale with
 * region danger and the player's level. Never spawns inside safe zones (start
 * areas, city centres, villages, the tutorial isle, master training grounds,
 * docks and merchants). Respawn timers, a cap on simultaneous enemies, spawns
 * preferably outside the camera view, attack tokens (at most 3 attackers at
 * once), player-noise propagation, loot and XP rewards, enemy HUD layer.
 *
 * -----------------------------------------------------------------------------
 * Sparring API (for the training / master system)
 * -----------------------------------------------------------------------------
 *   const enc = ctx.extra.get('encounters') as EncounterDirector;
 *   const duel = enc.spawnSparringPartner({
 *     element: 'fire',                 // the partner bends this element
 *     level: 4,                        // optional, default: the player's level
 *     position: { x, y?, z },          // optional, default: 7 m in front of the player
 *     name: 'Master Jeong',            // optional display name
 *     appearance,                      // optional Appearance (e.g. the master's look)
 *     threshold: 0.15,                 // optional HP fraction that ends the duel
 *     onVictory: () => {},             // the PLAYER won (partner fell below threshold)
 *     onDefeat: () => {},              // the PLAYER lost (player fell below threshold)
 *     onEnd: (result) => {},           // 'victory' | 'defeat' | 'cancelled'
 *     persist: false,                  // keep the partner standing after the duel
 *   });
 *   duel.entity; duel.active; duel.end();   // end() cancels (no callbacks but onEnd('cancelled'))
 *
 * The duel is non-lethal: neither side can drop to 0 HP (hits from the partner
 * are clamped on the player; the partner clamps its own damage), there is no
 * loot, no XP bonus and no entity:killed event. When either side drops below
 * the threshold both are restored to full health, statuses are cleared, the
 * partner bows and (unless `persist`) leaves after a few seconds. The partner
 * uses real techniques of its element through CombatSystem (a waterbending
 * partner needs real water nearby, like everyone else).
 *
 * Debug: window.__game.debug.enemies = { spawn, list, killAll, encounters, ... }.
 */
import * as THREE from 'three';
import type { Appearance } from '../character/Appearance';
import { npcLook } from '../character/looks';
import type { GameContext, GameSystem } from '../core/GameContext';
import { hashString } from '../core/MathUtil';
import { Random } from '../core/Random';
import type { Element } from '../core/types';
import {
  BOSS_ENCOUNTERS,
  DEFAULT_DANGER,
  ENCOUNTER_TABLES,
  ENEMY_ARCHETYPES,
  REGION_DANGER,
  type BossPhase,
  type EncounterTemplate,
  type EncounterZone,
  type EnemyArchetype,
} from '../data/enemies';
import type { HitInfo } from '../entities/Entity';
import type { Player } from '../player/Player';
import { allSpots, getSpot, spotsWithPrefix } from '../world/Spots';
import { LAKES, LANDMARKS, ROADS, STARTS, TUTORIAL_SPAWN } from '../world/WorldLayout';
import { disposeAttackResources } from './attacks';
import { Enemy, type EnemyOptions } from './Enemy';
import { EnemyUI } from './EnemyUI';
import { LootManager } from './Loot';
import type { AiHost, Noise } from './types';

export interface SparringOptions {
  element: Element;
  level?: number;
  position?: { x: number; y?: number; z: number };
  name?: string;
  appearance?: Appearance;
  threshold?: number;
  onVictory?: () => void;
  onDefeat?: () => void;
  onEnd?: (result: 'victory' | 'defeat' | 'cancelled') => void;
  persist?: boolean;
}

export interface SparringHandle {
  readonly entity: Enemy;
  readonly active: boolean;
  end(): void;
}

type CampKind = 'camp' | 'patrol' | 'ambush' | 'beast' | 'boss';

interface Camp {
  id: string;
  kind: CampKind;
  zone: EncounterZone;
  x: number;
  z: number;
  members: string[];
  boss: string | null;
  label: string;
  state: 'dormant' | 'active' | 'cleared';
  respawnAt: number;
  alive: Set<Enemy>;
  defeated: number;
  pendingT: number;
  patrol: THREE.Vector3[];
  fire: { obj: THREE.Object3D; emitter: { stop(): void } } | null;
}

interface Duel {
  enemy: Enemy;
  opts: SparringOptions;
  threshold: number;
  active: boolean;
  endT: number;
}

const MAX_ENEMIES = 14;
const ACTIVATE_DIST = 150;
const DEACTIVATE_DIST = 240;
const SAFE_KINDS = new Set(['capital', 'city', 'village', 'temple', 'training']);
/** Fixed coves on the southern coasts (validated at runtime). */
const COVES = [
  { x: 740, z: 1300 },
  { x: -220, z: 1260 },
  { x: -540, z: 1140 },
];

const SPARRING_TECHNIQUES: Record<Element, EnemyArchetype['techniques']> = {
  air: [
    { id: 'air_palm', weight: 3, max: 8, tell: 0.4, burst: [2, 3] },
    { id: 'air_blast', weight: 1, min: 3, max: 14, tell: 0.7, charge: 0.6, cooldown: 2 },
    { id: 'air_sweep', weight: 1, max: 7, tell: 0.5, cooldown: 3 },
  ],
  water: [
    { id: 'water_whip', weight: 3, max: 9, tell: 0.4, burst: [2, 3] },
    { id: 'water_blast', weight: 1, min: 4, max: 18, tell: 0.7, charge: 0.5, cooldown: 2 },
    { id: 'atk_staff', weight: 0, max: 2.6, tell: 0.45 },
  ],
  earth: [
    { id: 'earth_strike', weight: 3, max: 16, tell: 0.45, burst: [1, 3] },
    { id: 'earth_pillar', weight: 1, min: 4, max: 14, tell: 0.6, cooldown: 3 },
  ],
  fire: [
    { id: 'fire_jab', weight: 3, max: 14, tell: 0.4, burst: [2, 4] },
    { id: 'fire_blast', weight: 1, min: 4, max: 20, tell: 0.75, charge: 0.6, cooldown: 2 },
    { id: 'flame_sweep', weight: 1, max: 6, tell: 0.5, cooldown: 3 },
  ],
};

const tmpV = new THREE.Vector3();

export class EncounterDirector implements GameSystem, AiHost {
  private ctx!: GameContext;
  readonly enemies: Enemy[] = [];
  private camps: Camp[] = [];
  private safe: Array<{ x: number; z: number; r: number }> = [];
  private noiseList: Noise[] = [];
  private readonly loot = new LootManager();
  private readonly ui = new EnemyUI();
  private campT = 0;
  private duels: Duel[] = [];
  private campfireGeo: THREE.BufferGeometry | null = null;
  private campfireMat: THREE.Material | null = null;
  /** Session statistics (tests / debug). */
  readonly stats = { spawned: 0, defeated: 0, fled: 0, bossesDefeated: [] as string[], campsCleared: 0 };
  private playerHitPatched = false;
  /** Director-driven camp streaming (tests switch it off for deterministic arenas). */
  campsEnabled = true;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const ev = ctx.events;
    const noise = (x: number, y: number, z: number, radius: number, combat: boolean) => {
      this.noiseList.push({ x, y, z, radius, combat, t: ctx.time.elapsed });
      if (this.noiseList.length > 24) this.noiseList.shift();
    };
    ev.on('player:footstep', (e) => noise(e.position.x, e.position.y, e.position.z, 2.5 + e.speed * 1.5 + (e.heavy ? 5 : 0), false));
    ev.on('player:landed', (e) => noise(e.position.x, e.position.y, e.position.z, 6 + e.speed * 0.8, false));
    ev.on('technique:cast', (e) => {
      if (e.isPlayer) noise(e.position.x, e.position.y, e.position.z, 30, true);
    });
    ev.on('hit', (e) => {
      if (e.playerIsAttacker) noise(e.position.x, e.position.y, e.position.z, 22, true);
    });
    // window.__game is installed right after every system's init().
    queueMicrotask(() => this.installDebug());
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  onSessionStart(ctx: GameContext): void {
    this.installDebug();
    this.reset();
    ctx.scene.add(this.loot.group);
    this.buildSafeZones();
    if (ctx.session.kind === 'campaign') this.buildCamps();
  }

  onSessionEnd(ctx: GameContext): void {
    for (const d of this.duels) d.active = false;
    this.duels = [];
    this.unpatchPlayer();
    // EntityManager clears (and disposes) every non-player entity after this.
    this.enemies.length = 0;
    for (const c of this.camps) this.removeCampfire(c);
    this.camps = [];
    this.loot.clear();
    ctx.scene.remove(this.loot.group);
    this.ui.clear();
    this.noiseList = [];
    disposeAttackResources();
    this.campfireGeo?.dispose();
    this.campfireMat?.dispose();
    this.campfireGeo = null;
    this.campfireMat = null;
  }

  private reset(): void {
    this.enemies.length = 0;
    this.tokenSince.clear();
    this.lastToken.clear();
    this.camps = [];
    this.duels = [];
    this.noiseList = [];
    this.stats.spawned = this.stats.defeated = this.stats.fled = this.stats.campsCleared = 0;
    this.stats.bossesDefeated = [];
  }

  // ---------------------------------------------------------------------------
  // Safe zones & placement
  // ---------------------------------------------------------------------------

  private buildSafeZones(): void {
    const s: Array<{ x: number; z: number; r: number }> = [];
    for (const st of Object.values(STARTS)) s.push({ x: st.spawn.x, z: st.spawn.z, r: 240 });
    for (const l of LANDMARKS) if (SAFE_KINDS.has(l.kind)) s.push({ x: l.x, z: l.z, r: l.discoverRadius + (l.kind === 'training' ? 45 : 75) });
    s.push({ x: TUTORIAL_SPAWN.x, z: TUTORIAL_SPAWN.z, r: 320 });
    for (const [id, sp] of allSpots()) {
      if (id.startsWith('master_') || id.startsWith('training_')) s.push({ x: sp.x, z: sp.z, r: 50 });
      else if (id.startsWith('merchant_') || id.startsWith('giver_') || id.startsWith('dock_')) s.push({ x: sp.x, z: sp.z, r: 35 });
    }
    this.safe = s;
  }

  /** True inside a safe zone (start areas, city centres, villages, tutorial isle, training grounds…). */
  isSafe(x: number, z: number, margin = 0): boolean {
    for (const s of this.safe) if (Math.hypot(x - s.x, z - s.z) < s.r + margin) return true;
    return false;
  }

  /** Dry, walkable, not too steep, not in a safe zone. */
  private validSpot(x: number, z: number): boolean {
    const w = this.ctx.world;
    if (this.isSafe(x, z, 10)) return false;
    const g = w.groundAt(x, z);
    if (g.y < 0.4 || g.ny < 0.82) return false;
    const liq = w.liquidAt(x, z);
    if (liq && liq.level > g.y - 0.1) return false;
    return Math.abs(x) < 2000 && Math.abs(z) < 2000;
  }

  zoneAt(x: number, z: number): EncounterZone {
    const w = this.ctx.world;
    const laogai = LAKES.find((l) => l.id === 'lake_laogai');
    if (laogai && Math.hypot(x - laogai.x, z - laogai.z) < 170) return 'laogai';
    const region = w.regionAt(x, z);
    const nation = region?.nation;
    if (nation === 'fire' || (x < -600 && z > 450)) return 'fire';
    const biome = w.biomeAt(x, z);
    if (biome === 'swamp' || region?.id === 'foggy_swamp') return 'swamp';
    if (biome === 'desert' || biome === 'savanna') return 'desert';
    let coast = false;
    for (let i = 0; i < 8 && !coast; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = w.waterAt(x + Math.cos(a) * 32, z + Math.sin(a) * 32);
      if (h && h.kind === 'ocean') coast = true;
    }
    const polar = biome === 'polar' || biome === 'tundra' || biome === 'boreal';
    if (coast) return polar ? 'polar' : 'coast';
    if (polar) return 'polar';
    if (nation === 'earth') return 'earth';
    return 'wild';
  }

  levelFor(arch: EnemyArchetype, x: number, z: number): number {
    const region = this.ctx.world.regionAt(x, z);
    const danger = region ? REGION_DANGER[region.id] ?? DEFAULT_DANGER : DEFAULT_DANGER;
    const pl = this.ctx.progression.level;
    const rankBonus = arch.rank === 'boss' ? 4 : arch.rank === 'elite' ? 2 : 0;
    return Math.max(1, Math.min(50, Math.round(danger * 1.5 + pl * 0.75 + rankBonus)));
  }

  private pickTemplate(zone: EncounterZone, rng: Random, kinds?: CampKind[]): EncounterTemplate {
    let list = ENCOUNTER_TABLES[zone];
    if (kinds) {
      const f = list.filter((t) => kinds.includes(t.kind));
      if (f.length) list = f;
    }
    return rng.weighted(list, list.map((t) => t.weight));
  }

  private buildCamps(): void {
    const camps: Camp[] = [];
    const make = (id: string, kind: CampKind, zone: EncounterZone, x: number, z: number, members: string[], label: string, boss: string | null = null): Camp => ({
      id, kind, zone, x, z, members, boss, label, state: 'dormant', respawnAt: 0, alive: new Set(), defeated: 0, pendingT: 0, patrol: [], fire: null,
    });
    const near = (x: number, z: number, r: number) => camps.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    // 1. Named bosses.
    const bossSpots = new Set<string>();
    for (const b of BOSS_ENCOUNTERS) {
      if (b.spot) bossSpots.add(b.spot);
      const sp = b.spot ? getSpot(b.spot) : undefined;
      const x = sp?.x ?? b.x, z = sp?.z ?? b.z;
      if (this.isSafe(x, z)) continue;
      camps.push(make(b.id, 'boss', this.zoneAt(x, z), x, z, b.guards.slice(), b.label, b.boss));
    }
    // 2. Camps published by region builders.
    for (const [id, sp] of spotsWithPrefix('camp_')) {
      if (bossSpots.has(id) || this.isSafe(sp.x, sp.z)) continue;
      const zone = this.zoneAt(sp.x, sp.z);
      const rng = new Random(hashString(id));
      const t = this.pickTemplate(zone, rng, ['camp', 'beast']);
      camps.push(make(id, t.kind, zone, sp.x, sp.z, t.members.slice(), sp.label ?? 'Camp'));
    }
    // 3. Coastal pirate coves.
    for (const [i, c] of COVES.entries()) {
      if (!this.validSpot(c.x, c.z) || near(c.x, c.z, 160)) continue;
      const zone = this.zoneAt(c.x, c.z);
      const rng = new Random(9001 + i);
      const t = this.pickTemplate(zone === 'coast' || zone === 'polar' ? zone : 'coast', rng, ['camp']);
      camps.push(make(`cove_${i}`, 'camp', 'coast', c.x, c.z, t.members.slice(), 'Pirate cove'));
    }
    // 4. Fallback: points along the roads between regions.
    for (const road of ROADS) {
      const pts = road.points;
      let along = 0;
      let next = 110;
      let side = 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        while (next <= along + len) {
          const s = next - along;
          const rx = a.x + dx * s, rz = a.z + dz * s;
          next += 210;
          side = -side;
          const rng = new Random(hashString(`${road.id}:${Math.round(s)}:${i}`));
          const zone = this.zoneAt(rx, rz);
          const t = this.pickTemplate(zone, rng);
          const off = t.kind === 'patrol' ? 0 : t.kind === 'ambush' ? 12 : 22;
          const cx = rx + -dz * off * side, cz = rz + dx * off * side;
          if (!this.validSpot(cx, cz) || near(cx, cz, 170)) continue;
          const camp = make(`road_${road.id}_${camps.length}`, t.kind, zone, cx, cz, t.members.slice(), t.kind === 'patrol' ? 'Road patrol' : t.kind === 'ambush' ? 'Roadside ambush' : t.kind === 'beast' ? 'Beast territory' : 'Camp');
          if (t.kind === 'patrol') {
            for (const k of [-40, 40]) {
              const px = rx + dx * k, pz = rz + dz * k;
              if (this.validSpot(px, pz)) camp.patrol.push(new THREE.Vector3(px, 0, pz));
            }
            if (camp.patrol.length < 2) camp.kind = 'camp';
          }
          camps.push(camp);
        }
        along += len;
      }
    }
    this.camps = camps;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  /** Spawn an enemy of an archetype at a world position (y snapped to the ground). */
  spawnEnemy(archId: string, pos: { x: number; y?: number; z: number }, o: EnemyOptions = {}): Enemy | null {
    const arch = ENEMY_ARCHETYPES[archId];
    if (!arch) return null;
    return this.spawnArch(arch, pos, o);
  }

  private spawnArch(arch: EnemyArchetype, pos: { x: number; y?: number; z: number }, o: EnemyOptions = {}): Enemy {
    const ctx = this.ctx;
    const g = ctx.world.groundAt(pos.x, pos.z, pos.y !== undefined ? pos.y + 1.5 : Infinity);
    const home = new THREE.Vector3(pos.x, g.y + 0.02, pos.z);
    const level = o.level ?? this.levelFor(arch, pos.x, pos.z);
    // Rogue waterbenders spawned beside real water start with a little of it already drawn.
    let reserve = o.waterReserve;
    if (reserve === undefined && arch.element === 'water') reserve = ctx.water.findBest(home, 18, { allowLiquid: true }) ? 12 : 0;
    const e = new Enemy(arch, this, { ...o, home: o.home ?? home, level, waterReserve: reserve ?? 0 });
    e.root.position.copy(home);
    e.body!.place(home, e.root.position);
    ctx.entities.add(e);
    this.enemies.push(e);
    this.stats.spawned++;
    return e;
  }

  private spawnCamp(c: Camp): void {
    const ctx = this.ctx;
    const rng = new Random(hashString(c.id) + Math.floor(ctx.time.elapsed));
    const list = c.boss ? [c.boss, ...c.members] : c.members;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const archId = list[i];
      const arch = ENEMY_ARCHETYPES[archId];
      if (!arch) continue;
      let x = c.x, z = c.z;
      if (c.kind === 'patrol' && c.patrol.length) {
        const p = c.patrol[0];
        x = p.x + (i - (n - 1) / 2) * 1.6;
        z = p.z + (i % 2) * 1.2;
      } else if (!(c.boss && i === 0)) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const r = c.kind === 'ambush' ? rng.range(2, 6) : c.kind === 'beast' ? 0 : rng.range(3, 6.5);
        x = c.x + Math.cos(a) * r;
        z = c.z + Math.sin(a) * r;
      }
      if (!this.validSpot(x, z)) {
        x = c.x;
        z = c.z;
      }
      const e = this.spawnArch(arch, { x, z }, {
        encounterId: c.id,
        ambush: c.kind === 'ambush',
        patrol: c.kind === 'patrol' ? c.patrol.map((p) => p.clone().setY(ctx.world.groundAt(p.x, p.z).y)) : undefined,
        yaw: Math.atan2(c.x - x, c.z - z) + (c.kind === 'camp' ? Math.PI : 0),
        seed: hashString(`${c.id}:${i}`),
      });
      c.alive.add(e);
    }
    c.state = 'active';
    c.pendingT = 0;
    if (c.kind === 'camp' || c.kind === 'boss') this.addCampfire(c);
  }

  private addCampfire(c: Camp): void {
    if (c.fire) return;
    const ctx = this.ctx;
    this.campfireGeo ??= new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6).rotateZ(Math.PI / 2);
    this.campfireMat ??= new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.95, emissive: '#3a1000', emissiveIntensity: 0.5 });
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(this.campfireGeo, this.campfireMat);
      m.rotation.y = (i / 4) * Math.PI;
      m.position.y = 0.08;
      g.add(m);
    }
    const y = ctx.world.groundAt(c.x, c.z).y;
    g.position.set(c.x, y, c.z);
    ctx.scene.add(g);
    const em = ctx.vfx.emitter('flame', 10, { speed: 0.6, spread: 0.3 });
    em.position.set(c.x, y + 0.25, c.z);
    const smoke = ctx.vfx.emitter('smoke', 2, { speed: 0.4, size: 0.8 });
    smoke.position.set(c.x, y + 0.9, c.z);
    c.fire = { obj: g, emitter: { stop: () => (em.stop(), smoke.stop()) } };
  }

  private removeCampfire(c: Camp): void {
    if (!c.fire) return;
    c.fire.emitter.stop();
    this.ctx?.scene.remove(c.fire.obj);
    c.fire = null;
  }

  private campInView(c: Camp): boolean {
    const cam = this.ctx.camera;
    tmpV.set(c.x, this.ctx.world.heightAt(c.x, c.z) + 1, c.z).project(cam);
    return tmpV.z < 1 && Math.abs(tmpV.x) < 1.15 && Math.abs(tmpV.y) < 1.15;
  }

  private updateCamps(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p || ctx.session.kind !== 'campaign' || !this.campsEnabled) return;
    const now = ctx.time.elapsed;
    const count = this.enemies.filter((e) => !e.sparring && !e.isReleased).length;
    let budget = MAX_ENEMIES - count;
    for (const c of this.camps) {
      const d = Math.hypot(p.position.x - c.x, p.position.z - c.z);
      if (c.state === 'cleared') {
        if (now >= c.respawnAt && d > 200) c.state = 'dormant';
        continue;
      }
      if (c.state === 'dormant') {
        const size = c.members.length + (c.boss ? 1 : 0);
        if (d < ACTIVATE_DIST && size <= budget) {
          if (d > 105 || !this.campInView(c) || c.pendingT > 3) {
            this.spawnCamp(c);
            budget -= size;
          } else c.pendingT += dt;
        }
        continue;
      }
      // Active.
      for (const e of [...c.alive]) if (e.isReleased || e.disposed) c.alive.delete(e);
      if (c.alive.size === 0) {
        c.state = 'cleared';
        c.respawnAt = now + (c.kind === 'boss' ? 900 : 300);
        this.removeCampfire(c);
        if (c.defeated > 0) {
          this.stats.campsCleared++;
          if (c.kind !== 'beast') ctx.ui.notify(c.kind === 'boss' ? `${c.label} is quiet again` : `${c.label} cleared`, 'success', 2.5);
        }
        continue;
      }
      if (d > DEACTIVATE_DIST) {
        const busy = [...c.alive].some((e) => e.brain.state === 'combat' && !e.defeated);
        if (!busy) {
          for (const e of c.alive) this.removeEnemy(e);
          c.alive.clear();
          c.state = 'dormant';
          this.removeCampfire(c);
        }
      }
    }
  }

  private removeEnemy(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (!e.disposed) this.ctx.entities.remove(e);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    const now = ctx.time.elapsed;
    this.noiseList = this.noiseList.filter((n) => now - n.t < 1.2);
    // Drop enemies removed by someone else (session clear, other systems).
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].disposed) this.enemies.splice(i, 1);
    this.campT -= dt;
    if (this.campT <= 0) {
      this.campT = 0.5;
      this.updateCamps(0.5);
    }
    this.assignTokens(now);
    this.updateDuels(now);
    this.loot.update(dt, ctx);
    this.ui.update(dt, ctx, this.enemies);
  }

  private tokenSince = new Map<number, number>();

  private assignTokens(now: number): void {
    const diff = this.ctx.settings.data.gameplay.difficulty;
    const fighting = this.enemies.filter((e) => !e.defeated && !e.isReleased && e.brain.state === 'combat');
    const bossFight = fighting.some((e) => e.rank === 'boss');
    const slots = (diff === 'story' ? 2 : 3) - (bossFight ? 1 : 0);
    const holders: Enemy[] = [];
    const rest: Enemy[] = [];
    for (const e of fighting) {
      if (e.rank === 'boss' || e.sparring) {
        e.attackToken = true;
        continue;
      }
      const since = this.tokenSince.get(e.id);
      // Holders keep their token for a while (no thrashing), then rotate if others wait.
      if (e.attackToken && since !== undefined && now - since < 7) holders.push(e);
      else rest.push(e);
    }
    const p = this.ctx.player;
    // Fair rotation: whoever has waited longest for a token goes first (distance breaks ties).
    for (const e of rest) if (!this.lastToken.has(e.id)) this.lastToken.set(e.id, now);
    rest.sort((a, b) => {
      const w = (this.lastToken.get(a.id) ?? now) - (this.lastToken.get(b.id) ?? now);
      if (Math.abs(w) > 0.5) return w;
      return p ? a.position.distanceToSquared(p.position) - b.position.distanceToSquared(p.position) : 0;
    });
    const winners = new Set<Enemy>(holders.slice(0, slots));
    for (const e of rest) {
      if (winners.size >= slots) break;
      winners.add(e);
    }
    for (const e of this.enemies) {
      if (e.rank === 'boss' || e.sparring) continue;
      const had = e.attackToken;
      e.attackToken = winners.has(e);
      if (e.attackToken && !had) this.tokenSince.set(e.id, now);
      if (e.attackToken) this.lastToken.set(e.id, now);
      else this.tokenSince.delete(e.id);
    }
    if (this.lastToken.size > 64) {
      for (const id of [...this.lastToken.keys()]) if (!this.enemies.some((e) => e.id === id)) this.lastToken.delete(id);
      for (const id of [...this.tokenSince.keys()]) if (!this.enemies.some((e) => e.id === id)) this.tokenSince.delete(id);
    }
  }

  private lastToken = new Map<number, number>();

  // ---------------------------------------------------------------------------
  // AiHost
  // ---------------------------------------------------------------------------

  hasToken(e: Enemy): boolean {
    return e.attackToken;
  }

  noises(): readonly Noise[] {
    return this.noiseList;
  }

  alertAllies(src: Enemy, at: THREE.Vector3): void {
    for (const e of this.enemies) {
      if (e === src || e.defeated || e.sparring || e.isReleased) continue;
      const sameGroup = (src.encounterId && e.encounterId === src.encounterId) || e.arch.faction === src.arch.faction;
      if (!sameGroup) continue;
      if (e.position.distanceTo(src.position) > 30) continue;
      e.brain.hearAlly(this.ctx, at);
    }
  }

  onEnemyDefeated(e: Enemy, hit: HitInfo): void {
    const ctx = this.ctx;
    const now = ctx.time.elapsed;
    this.stats.defeated++;
    const camp = e.encounterId ? this.camps.find((c) => c.id === e.encounterId) : undefined;
    if (camp) camp.defeated++;
    const byPlayer = (hit.attacker && hit.attacker.kind === 'player') || now - e.lastHitByPlayerT < 20;
    if (byPlayer && !e.sparring) {
      this.loot.spawnFor(ctx, e.arch, e.position, e.level);
      ctx.progression.addXP(Math.round(e.arch.xp * (1 + (e.level - 1) * 0.05)));
    }
    if (e.rank === 'boss') {
      this.stats.bossesDefeated.push(e.arch.id);
      ctx.ui.showBanner(`${e.name} Defeated`, e.arch.title ?? '');
      ctx.ui.notify(`${e.name} yields!`, 'success', 4);
      ctx.events.emit('camera:shake', { intensity: 0.25, duration: 0.4 });
      // The rest of the boss's crew loses heart.
      for (const o of this.enemies) if (o !== e && o.encounterId && o.encounterId === e.encounterId && !o.defeated) o.brain.setState('flee');
    } else if (e.beast) ctx.ui.notify(`The ${e.name.toLowerCase()} retreats, subdued.`, 'info', 2.5);
  }

  onBossPhase(e: Enemy, phase: BossPhase): void {
    const ctx = this.ctx;
    ctx.ui.notify(phase.text, 'warning', 3.5);
    if (!phase.summon) return;
    for (const [i, id] of phase.summon.entries()) {
      const a = (i / phase.summon.length) * Math.PI * 2 + e.yaw + Math.PI / 2;
      let x = e.position.x + Math.cos(a) * 5, z = e.position.z + Math.sin(a) * 5;
      if (!this.validSpot(x, z)) {
        x = e.position.x;
        z = e.position.z;
      }
      const m = this.spawnEnemy(id, { x, y: e.position.y, z }, { encounterId: e.encounterId, level: Math.max(1, e.level - 2), seed: e.id * 13 + i, home: e.home.clone() });
      if (m) {
        ctx.vfx.burst('dust', m.position, { count: 10, speed: 2 });
        if (e.brain.target) m.brain.hearAlly(ctx, e.brain.target.position);
        const camp = e.encounterId ? this.camps.find((c) => c.id === e.encounterId) : undefined;
        camp?.alive.add(m);
      }
    }
  }

  release(e: Enemy): void {
    if (!e.defeated) this.stats.fled++;
    this.removeEnemy(e);
  }

  // ---------------------------------------------------------------------------
  // Sparring
  // ---------------------------------------------------------------------------

  spawnSparringPartner(o: SparringOptions): SparringHandle {
    const ctx = this.ctx;
    const p = ctx.player!;
    const el = o.element;
    const base = el === 'fire' ? ENEMY_ARCHETYPES.fire_elite : el === 'earth' ? ENEMY_ARCHETYPES.earth_bandit : el === 'water' ? ENEMY_ARCHETYPES.water_pirate : ENEMY_ARCHETYPES.fire_elite;
    const arch: EnemyArchetype = {
      ...base,
      id: `sparring_${el}`,
      name: o.name ?? 'Sparring Partner',
      title: 'Sparring Duel',
      faction: base.faction,
      element: el,
      props: [],
      tags: ['sparring', `sparring_${el}`],
      rank: 'elite',
      hp: 150,
      power: 0.55,
      techniques: SPARRING_TECHNIQUES[el],
      behaviour: { ...base.behaviour, retreatAt: 0, fleeAt: 0, callAllies: false, leash: 9999, preferred: el === 'water' ? 6 : el === 'earth' ? 9 : el === 'air' ? 5 : 7, block: 0.3, dodge: 0.3 },
      loot: { coins: [0, 0], items: [] },
      xp: 0,
      phases: undefined,
    };
    let pos: { x: number; y?: number; z: number };
    if (o.position) pos = o.position;
    else {
      const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      pos = { x: p.position.x + f.x * 7, y: p.position.y, z: p.position.z + f.z * 7 };
    }
    const appearance = o.appearance ?? npcLook(hashString(`${el}:${o.name ?? 'spar'}`), el, 'student');
    const e = this.spawnArch(arch, pos, { sparring: true, element: el, level: o.level ?? ctx.progression.level, appearance, name: arch.name, yaw: Math.atan2(p.position.x - pos.x, p.position.z - pos.z) });
    e.humanoid!.animator.loco.style = el;
    e.waterReserve = el === 'water' ? 0 : 0;
    const duel: Duel = { enemy: e, opts: o, threshold: o.threshold ?? 0.15, active: true, endT: 0 };
    this.duels.push(duel);
    this.patchPlayer();
    e.humanoid?.animator.play('bow', { fadeIn: 0.1 });
    const self = this;
    return {
      entity: e,
      get active() {
        return duel.active;
      },
      end() {
        self.endDuel(duel, 'cancelled');
      },
    };
  }

  /** Clamp sparring-partner damage on the player so a duel can never defeat them. */
  private patchPlayer(): void {
    if (this.playerHitPatched) return;
    const p = this.ctx.player as Player | null;
    if (!p) return;
    const proto = Object.getPrototypeOf(p) as Player;
    const self = this;
    (p as any).receiveHit = function (this: Player, hit: HitInfo, ctx: GameContext) {
      const duel = self.duels.find((d) => d.active && hit.attacker === d.enemy);
      if (duel && this.health) {
        const room = Math.max(0, this.health.hp - 1) / Math.max(0.01, this.damageTaken);
        if (hit.damage > room) hit = { ...hit, damage: room };
      }
      const res = proto.receiveHit.call(this, hit, ctx);
      if (duel && this.health && this.health.fraction < duel.threshold) self.onSparringThreshold(duel.enemy, false);
      return res;
    };
    this.playerHitPatched = true;
  }

  private unpatchPlayer(): void {
    if (!this.playerHitPatched) return;
    const p = this.ctx.player as any;
    if (p && Object.prototype.hasOwnProperty.call(p, 'receiveHit')) delete p.receiveHit;
    this.playerHitPatched = false;
  }

  onSparringThreshold(e: Enemy, playerWon: boolean): void {
    const d = this.duels.find((x) => x.enemy === e && x.active);
    if (d) this.endDuel(d, playerWon ? 'victory' : 'defeat');
  }

  private endDuel(d: Duel, result: 'victory' | 'defeat' | 'cancelled'): void {
    if (!d.active) return;
    d.active = false;
    const ctx = this.ctx;
    const e = d.enemy;
    const p = ctx.player;
    e.cancelAttack(ctx);
    ctx.combat.interrupt(e, false);
    e.health!.reset();
    e.statuses.length = 0;
    e.stunned = 0;
    e.moveMode = 'stop';
    e.targetable = false;
    e.team = 'neutral';
    if (p && p.health) {
      p.health.reset();
      p.statuses.length = 0;
      p.stunned = 0;
    }
    e.humanoid?.animator.play('bow', { fadeIn: 0.15 });
    d.endT = ctx.time.elapsed;
    if (result !== 'cancelled') {
      ctx.ui.notify(result === 'victory' ? 'You won the sparring duel!' : 'You yield the duel — train and try again.', result === 'victory' ? 'success' : 'info', 3);
    }
    try {
      if (result === 'victory') d.opts.onVictory?.();
      else if (result === 'defeat') d.opts.onDefeat?.();
      d.opts.onEnd?.(result);
    } catch (err) {
      console.error('[encounters] sparring callback failed', err);
    }
    if (!this.duels.some((x) => x.active)) this.unpatchPlayer();
  }

  private updateDuels(now: number): void {
    for (let i = this.duels.length - 1; i >= 0; i--) {
      const d = this.duels[i];
      if (d.active) continue;
      if (d.opts.persist) {
        this.duels.splice(i, 1);
        continue;
      }
      if (now - d.endT > 3) {
        d.enemy.vanish(this.ctx);
        this.duels.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Debug / automation
  // ---------------------------------------------------------------------------

  private info(e: Enemy) {
    const p = this.ctx.player;
    return {
      id: e.id,
      arch: e.arch.id,
      name: e.name,
      rank: e.rank,
      level: e.level,
      state: e.brain.state,
      hp: +(e.health?.hp ?? 0).toFixed(1),
      maxHp: e.health?.maxHp ?? 0,
      x: +e.position.x.toFixed(2),
      y: +e.position.y.toFixed(2),
      z: +e.position.z.toFixed(2),
      homeX: +e.home.x.toFixed(1),
      homeZ: +e.home.z.toFixed(1),
      dist: p ? +e.position.distanceTo(p.position).toFixed(2) : null,
      alive: e.alive,
      defeated: e.defeated,
      attack: e.attack ? { id: e.attack.tech.id, phase: e.attack.phase } : null,
      token: e.attackToken,
      guarding: e.guarding,
      stunned: e.stunned,
      awareness: +e.brain.awareness.toFixed(2),
      hasWater: e.brain.hasWater,
      water: +e.waterReserve.toFixed(1),
      maxStuck: e.maxStuck,
      stuck: e.stuckTime,
      phase: e.phaseIndex,
      encounter: e.encounterId,
      tags: [...e.tags],
      stats: { ...e.stats },
      lastFail: e.lastFail,
      vy: +(e.body?.velocity.y ?? 0).toFixed(2),
      grounded: e.body?.grounded ?? true,
    };
  }

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const g = (window as any).__game;
    if (!g || !g.debug || g.debug.enemies) return;
    const self = this;
    const ctx = () => self.ctx;
    g.debug.enemies = {
      director: self,
      archetypes: () => Object.keys(ENEMY_ARCHETYPES),
      /** Spawn an archetype `dist` m in front of the player (`side` m to the right). */
      spawn(archetype: string, dist = 10, side = 0, opts: EnemyOptions & { aware?: boolean; x?: number; z?: number } = {}) {
        const c = ctx();
        const p = c.player!;
        const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const r = new THREE.Vector3(-f.z, 0, f.x);
        const x = opts.x ?? p.position.x + f.x * dist + r.x * side;
        const z = opts.z ?? p.position.z + f.z * dist + r.z * side;
        const e = self.spawnEnemy(archetype, { x, y: p.position.y, z }, { yaw: Math.atan2(p.position.x - x, p.position.z - z), ...opts });
        if (!e) return null;
        if (opts.aware) e.brain.hearAlly(c, p.position);
        return self.info(e);
      },
      list: () => self.enemies.filter((e) => !e.isReleased).map((e) => self.info(e)),
      get: (id: number) => {
        const e = self.enemies.find((x) => x.id === id);
        return e ? self.info(e) : null;
      },
      entity: (id: number) => self.enemies.find((x) => x.id === id) ?? null,
      /** Defeat every enemy through CombatSystem (events, loot, XP fire normally). */
      killAll() {
        const c = ctx();
        let n = 0;
        for (const e of [...self.enemies]) {
          if (e.defeated || e.sparring || !e.health) continue;
          e.health.invulnerable = 0;
          c.combat.applyHit(c.player, e, { attacker: c.player, damage: e.health.hp / Math.max(0.01, e.damageTaken) + 1, element: 'avatar', techniqueId: 'debug', unblockable: true });
          n++;
        }
        return n;
      },
      clear() {
        for (const e of [...self.enemies]) self.removeEnemy(e);
        return self.enemies.length;
      },
      setHp(id: number, frac: number) {
        const e = self.enemies.find((x) => x.id === id);
        if (!e?.health) return null;
        e.health.hp = Math.max(1, e.health.maxHp * frac);
        return e.health.hp;
      },
      /** Apply a hit from the player (tests reactions: stagger / knockback / launch). */
      hit(id: number, o: { damage?: number; knockback?: number; launch?: number; stagger?: number; knockdown?: boolean } = {}) {
        const c = ctx();
        const e = self.enemies.find((x) => x.id === id);
        const p = c.player!;
        if (!e) return null;
        const dir = e.position.clone().sub(p.position).setY(0).normalize();
        const res = c.combat.applyHit(p, e, { attacker: p, damage: o.damage ?? 10, element: p.element, techniqueId: 'debug_hit', knockback: dir.multiplyScalar(o.knockback ?? 0), launch: o.launch, stagger: o.stagger, knockdown: o.knockdown, point: e.aimPoint() });
        return res;
      },
      encounters: () =>
        self.camps.map((c) => ({ id: c.id, kind: c.kind, zone: c.zone, x: Math.round(c.x), z: Math.round(c.z), state: c.state, alive: c.alive.size, members: c.members, boss: c.boss, label: c.label })),
      /** Force-spawn a camp now (tests / screenshots). */
      activateCamp(id: string) {
        const c = self.camps.find((x) => x.id === id);
        if (!c) return false;
        if (c.state !== 'active') self.spawnCamp(c);
        return [...c.alive].map((e) => self.info(e));
      },
      camps(on = true) {
        self.campsEnabled = on;
        return on;
      },
      isSafe: (x: number, z: number) => self.isSafe(x, z),
      zoneAt: (x: number, z: number) => self.zoneAt(x, z),
      safeZones: () => self.safe.slice(),
      loot: () => self.loot.list(),
      lootCollected: () => ({ ...self.loot.collected }),
      collectLoot: () => self.loot.collectAll(ctx()),
      ui: () => ({ plates: self.ui.platesShown, boss: self.ui.bossShown, arrows: self.ui.arrowsShown }),
      stats: () => ({ ...self.stats, enemies: self.enemies.length, max: MAX_ENEMIES, tokens: self.enemies.filter((e) => e.attackToken).length, noises: self.noiseList.length, loot: self.loot.count }),
      sparring(opts: Partial<SparringOptions> & { element: Element }) {
        const w = window as any;
        w.__enemyDuel = { result: null, ended: false };
        const h = self.spawnSparringPartner({
          ...opts,
          onVictory: () => (w.__enemyDuel.result = 'victory'),
          onDefeat: () => (w.__enemyDuel.result = 'defeat'),
          onEnd: (r) => {
            w.__enemyDuel.ended = true;
            w.__enemyDuel.final = r;
          },
        });
        w.__enemyDuel.id = h.entity.id;
        w.__enemyDuel.handle = h;
        return h.entity.id;
      },
    };
  }
}
