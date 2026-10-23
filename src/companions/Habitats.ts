import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { HABITATS, SPECIES, speciesById, type ClueKind, type ForageDef, type HabitatDef, type SpeciesDef } from '../data/creatures';
import { itemById } from '../data/items';
import { getSpot, spotsWithPrefix } from '../world/Spots';
import { Creature, rng, type CreatureGroup } from './Creature';
import type { CompanionSystem } from './CompanionSystem';

/**
 * Habitat streaming: spawns herds / families / flocks at their habitats when
 * the player comes near and despawns them far away; ambient wildlife per
 * biome on a deterministic cell grid; discovery clues (tracks, nests, burrow
 * mounds, fur, bones, scorch marks) and forage spots for taming food.
 *
 * Habitat centres come from published `habitat_*` spots when they exist,
 * then the habitat landmark, then the catalogue coordinates.
 */

const HABITAT_SPOTS: Record<string, string> = {
  bison_meadow: 'habitat_sky_bison_1',
  sun_warrior_ruins: 'habitat_dragon_1',
  palace_pond: 'habitat_turtleduck_1',
};

const AMBIENT = SPECIES.filter((s) => s.role === 'ambient' && s.biomes?.length);
const CELL = 140;

interface SpawnedHabitat {
  def: HabitatDef;
  centre: THREE.Vector3;
  /** Usable roaming radius (a published spot's clear radius wins over the catalogue radius). */
  area: number;
  creatures: Creature[];
  group: CreatureGroup;
  props: THREE.Object3D[];
  unreg: Array<() => void>;
}

interface ForageState {
  readyAt: number;
  fruit: THREE.Object3D | null;
}

function hash2(x: number, z: number, salt = 0): number {
  let h = (x * 374761393 + z * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}

export class HabitatManager {
  readonly spawned = new Map<string, SpawnedHabitat>();
  readonly ambient = new Map<string, Creature[]>();
  private readonly forage = new Map<string, ForageState>();
  private tick = 0;
  private shared: { mats: Record<string, THREE.Material>; geos: Record<string, THREE.BufferGeometry> } | null = null;
  /** Disable streaming (tests that want an empty world). */
  enabled = true;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext) {}

  /** Every habitat including spot-published ambient ones (otter-penguin floes, ...). */
  allHabitats(): HabitatDef[] {
    const list = [...HABITATS];
    for (const s of AMBIENT) {
      for (const [id, spot] of spotsWithPrefix(`habitat_${s.id}_`)) {
        list.push({ id, name: spot.label ?? s.name, species: s.id, x: spot.x, z: spot.z, radius: Math.max(14, spot.r ?? 14), count: s.group ? s.group[1] : 3, group: 'flock', clues: [], spawnRadius: 180 });
      }
    }
    return list;
  }

  /** Roaming radius: the published spot's clear radius when there is one. */
  area(h: HabitatDef): number {
    const spotId = HABITAT_SPOTS[h.id];
    const spot = spotId ? getSpot(spotId) : undefined;
    return spot?.r && spot.r >= 12 ? Math.min(h.radius, spot.r * 1.3) : h.radius;
  }

  centre(h: HabitatDef, out = new THREE.Vector3()): THREE.Vector3 {
    const spotId = HABITAT_SPOTS[h.id];
    const spot = spotId ? getSpot(spotId) : undefined;
    if (spot) return out.set(spot.x, spot.y ?? this.ctx.world.groundAt(spot.x, spot.z).y, spot.z);
    const lm = h.landmark ? this.ctx.world.landmark(h.landmark) : undefined;
    const x = lm?.x ?? h.x, z = lm?.z ?? h.z;
    return out.set(x, this.ctx.world.groundAt(x, z).y, z);
  }

  requirementMet(h: HabitatDef): boolean {
    if (!h.requires) return true;
    return this.sys.flags.has(h.requires);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p || !this.enabled || ctx.session.kind === 'tutorial') return;
    // Herd centres drift slowly so herds roam their meadow.
    for (const s of this.spawned.values()) this.updateGroup(s, dt);
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.5;
    const pp = p.position;
    for (const h of this.allHabitats()) {
      const s = this.spawned.get(h.id);
      const c = s ? s.centre : this.centre(h);
      const d = Math.hypot(pp.x - c.x, pp.z - c.z);
      if (!s && d < h.spawnRadius && this.requirementMet(h)) this.spawnHabitat(h, c);
      else if (s && (d > h.spawnRadius + 90 || !this.requirementMet(h))) this.despawnHabitat(h.id);
    }
    this.updateAmbient(pp);
  }

  private updateGroup(s: SpawnedHabitat, dt: number): void {
    const g = s.group;
    g.retarget -= dt;
    if (g.retarget > 0 || s.def.group !== 'herd') return;
    g.retarget = 35 + Math.random() * 25;
    const a = Math.random() * Math.PI * 2;
    const r = s.area * 0.45 * Math.random();
    const x = s.centre.x + Math.sin(a) * r, z = s.centre.z + Math.cos(a) * r;
    g.center.set(x, this.ctx.world.groundAt(x, z).y, z);
  }

  // ---------------------------------------------------------------- habitats

  private spawnHabitat(h: HabitatDef, centre: THREE.Vector3): void {
    const def = speciesById(h.species);
    if (!def) return;
    const group: CreatureGroup = { id: h.id, members: [], center: centre.clone(), retarget: 5 };
    const s: SpawnedHabitat = { def: h, centre: centre.clone(), area: this.area(h), creatures: [], group, props: [], unreg: [] };
    this.spawned.set(h.id, s);
    for (let i = 0; i < h.count; i++) {
      const uid = `${h.id}#${i}`;
      if (this.sys.isUidBonded(uid) || this.sys.creatureByUid(uid)) continue;
      const c = this.spawnMember(h, def, uid, i, centre, s.area);
      if (c) {
        s.creatures.push(c);
        group.members.push(c);
        c.group = h.group === 'herd' || h.group === 'flock' ? group : null;
      }
    }
    if (h.clues.length) for (let i = 0; i < h.clues.length; i++) this.buildClue(s, i);
    if (h.forage) this.buildForage(s, h.forage);
    this.sys.onHabitatSpawned(h);
  }

  private spawnMember(h: HabitatDef, def: SpeciesDef, uid: string, i: number, centre: THREE.Vector3, area: number): Creature | null {
    const r = rng(hashStr(uid));
    const pup = h.rescue?.kind === 'ice_trap' && h.rescue.member === i;
    const scale = pup ? 0.55 : 0.92 + r() * 0.16;
    const variant = Math.floor(r() * 3);
    let c: Creature;
    try {
      c = new Creature(this.ctx, def, uid, { mode: 'wild', variant, scale, seed: hashStr(uid) });
    } catch (err) {
      console.warn('[Companions] spawn failed', err);
      return null;
    }
    let pos: THREE.Vector3 | null = null;
    if (def.id === 'dragon') pos = centre.clone();
    else {
      for (let tries = 0; tries < 12 && !pos; tries++) {
        const a = r() * Math.PI * 2;
        const dist = (h.water ? 0.25 : 0.5) * area * Math.sqrt(r());
        const x = centre.x + Math.sin(a) * dist, z = centre.z + Math.cos(a) * dist;
        const g = this.ctx.world.groundAt(x, z, Math.max(this.ctx.world.heightAt(x, z) + 3, centre.y + 2.5));
        const water = this.ctx.world.liquidAt(x, z);
        const deep = water ? water.level - g.y : 0;
        if (def.locomotion === 'swimmer' ? deep > 2 : deep > 0.6 && !h.water) continue;
        if (g.colliderId === 0 && g.ny < def.maxSlopeNy) continue;
        pos = new THREE.Vector3(x, water && h.water ? Math.max(g.y, water.level - c.height * 0.45) : g.y, z);
      }
      pos ??= c.findStandSpot(centre.x, centre.z, 2, Math.max(10, area * 0.5), centre.y) ?? centre.clone();
    }
    c.placeAt(pos, r() * Math.PI * 2);
    c.home.copy(pos);
    c.leash = Math.max(18, area * 0.9);
    this.sys.registerCreature(c, h);
    // Rescue variants.
    if (h.rescue && h.rescue.member === i && !this.sys.flags.has(`rescued:${uid}`)) {
      c.setState(h.rescue.kind === 'ice_trap' ? 'trapped' : 'injured', 1e9);
      this.sys.taming.decorateRescue(c, h.rescue.kind);
    } else if (def.id === 'dragon') {
      c.setState('rest', 6);
      c.leash = 140;
    } else c.pickIdle();
    return c;
  }

  despawnHabitat(id: string): void {
    const s = this.spawned.get(id);
    if (!s) return;
    this.spawned.delete(id);
    for (const c of s.creatures) if (c.mode !== 'companion' && c.state !== 'ridden' && c.state !== 'scripted') this.sys.removeCreature(c);
    for (const u of s.unreg) u();
    for (const o of s.props) o.removeFromParent();
  }

  /** Remove a creature from its habitat bookkeeping (bonded / despawned elsewhere). */
  forget(c: Creature): void {
    for (const s of this.spawned.values()) {
      const i = s.creatures.indexOf(c);
      if (i >= 0) s.creatures.splice(i, 1);
      const j = s.group.members.indexOf(c);
      if (j >= 0) s.group.members.splice(j, 1);
    }
    for (const list of this.ambient.values()) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- ambient wildlife

  private ambientCap(): number {
    const pr = this.ctx.settings.data.graphics.preset as string;
    return pr === 'low' ? 8 : pr === 'medium' ? 14 : 22;
  }

  private updateAmbient(pp: THREE.Vector3): void {
    let count = 0;
    for (const list of this.ambient.values()) count += list.length;
    // Despawn far cells.
    for (const [key, list] of this.ambient) {
      const [cx, cz] = key.split(',').map(Number);
      const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
      if (Math.hypot(pp.x - x, pp.z - z) > 300) {
        for (const c of list) if (c.mode !== 'companion') this.sys.removeCreature(c);
        count -= list.length;
        this.ambient.delete(key);
      }
    }
    const R = 190;
    const x0 = Math.floor((pp.x - R) / CELL), x1 = Math.floor((pp.x + R) / CELL);
    const z0 = Math.floor((pp.z - R) / CELL), z1 = Math.floor((pp.z + R) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        if (this.ambient.has(key)) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        if (Math.hypot(pp.x - x, pp.z - z) > R) continue;
        if (count >= this.ambientCap()) return;
        const list = this.spawnCell(cx, cz, x, z);
        this.ambient.set(key, list);
        count += list.length;
      }
    }
  }

  private spawnCell(cx: number, cz: number, x: number, z: number): Creature[] {
    const out: Creature[] = [];
    if (Math.abs(x) > 2000 || Math.abs(z) > 2000) return out;
    if (hash2(cx, cz, 1) > 0.42) return out;
    const biome = this.ctx.world.biomeAt(x, z);
    const cands = AMBIENT.filter((s) => s.biomes!.includes(biome));
    if (!cands.length) return out;
    const def = cands[Math.floor(hash2(cx, cz, 2) * cands.length) % cands.length];
    const [lo, hi] = def.group ?? [1, 2];
    const n = lo + Math.floor(hash2(cx, cz, 3) * (hi - lo + 1));
    const r = rng(Math.floor(hash2(cx, cz, 4) * 1e9) + 7);
    // Group anchor: a valid spot near the cell centre.
    let ax = x, az = z, found = false;
    for (let t = 0; t < 10 && !found; t++) {
      ax = x + (r() - 0.5) * CELL * 0.6;
      az = z + (r() - 0.5) * CELL * 0.6;
      const g = this.ctx.world.groundAt(ax, az, this.ctx.world.heightAt(ax, az) + 3);
      const w = this.ctx.world.liquidAt(ax, az);
      const deep = w ? w.level - g.y : 0;
      found = def.locomotion === 'swimmer' ? deep > 3 : deep < 0.3 && g.ny > def.maxSlopeNy;
    }
    if (!found) return out;
    for (let i = 0; i < n; i++) {
      const uid = `amb:${cx},${cz}#${i}`;
      let c: Creature;
      try {
        c = new Creature(this.ctx, def, uid, { mode: 'ambient', variant: Math.floor(r() * 3), scale: 0.9 + r() * 0.2, seed: hashStr(uid) });
      } catch {
        continue;
      }
      const px = ax + (r() - 0.5) * 8, pz = az + (r() - 0.5) * 8;
      const g = this.ctx.world.groundAt(px, pz, this.ctx.world.heightAt(px, pz) + 3);
      const w = this.ctx.world.liquidAt(px, pz);
      const y = def.locomotion === 'swimmer' && w ? w.level - c.height * 0.45 : g.y;
      if (def.locomotion !== 'swimmer' && w && w.level - g.y > 0.6) {
        c.dispose();
        continue;
      }
      c.placeAt(new THREE.Vector3(px, y, pz), r() * Math.PI * 2);
      c.home.set(ax, g.y, az);
      c.leash = 45;
      this.sys.registerCreature(c, null);
      c.pickIdle();
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- props: clues & forage

  private res(): { mats: Record<string, THREE.Material>; geos: Record<string, THREE.BufferGeometry> } {
    if (this.shared) return this.shared;
    const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
    const mats: Record<string, THREE.Material> = {
      print: std('#3b2c20', { transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      fur: std('#f4f1ea'),
      earth: std('#6b5238'),
      hole: std('#16100b'),
      rock: std('#7d7a74'),
      bone: std('#e8e0cc'),
      scorch: std('#141210', { transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      glass: std('#3a2e2a', { roughness: 0.2, metalness: 0.3 }),
      nest: std('#8a6a3c'),
      egg: std('#efe6d2'),
      feather: std('#7a5636', { side: THREE.DoubleSide }),
      bark: std('#5a4030'),
      leaf: std('#4d8a3a'),
      peach: std('#f2a07a', { emissive: '#3a1408' }),
      ice: std('#cfe8f5', { roughness: 0.3 }),
      water: std('#123447', { roughness: 0.1 }),
      shroom: std('#7ff0d0', { emissive: '#2fb89a', emissiveIntensity: 1.2 }),
      stem: std('#d8d2c0'),
      cabbage: std('#8fcf6a'),
      berry: std('#d0303a'),
      basket: std('#a07a48'),
    };
    const geos: Record<string, THREE.BufferGeometry> = {
      print: new THREE.CircleGeometry(0.22, 10).rotateX(-Math.PI / 2),
      ball: new THREE.SphereGeometry(1, 10, 8),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cone: new THREE.ConeGeometry(1, 1, 10),
      torus: new THREE.TorusGeometry(1, 0.35, 8, 16).rotateX(Math.PI / 2),
      disc: new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
      plane: new THREE.PlaneGeometry(1, 1),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
    for (const m of Object.values(mats)) m.userData.shared = true;
    this.shared = { mats, geos };
    return this.shared;
  }

  private mesh(geo: string, mat: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0): THREE.Mesh {
    const r = this.res();
    const m = new THREE.Mesh(r.geos[geo], r.mats[mat]);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  }

  private placeProp(group: THREE.Group, x: number, z: number): THREE.Group {
    const g = this.ctx.world.groundAt(x, z);
    group.position.set(x, g.y, z);
    this.ctx.scene.add(group);
    return group;
  }

  private buildClue(s: SpawnedHabitat, i: number): void {
    const clue = s.def.clues[i];
    const x = s.centre.x + clue.dx, z = s.centre.z + clue.dz;
    const grp = new THREE.Group();
    grp.name = `clue:${s.def.id}:${i}`;
    const def = speciesById(s.def.species);
    const big = def ? Math.min(2.6, Math.max(0.7, def.size.length / 3.2)) : 1;
    this.clueShape(grp, clue.kind, big, x, z);
    this.placeProp(grp, x, z);
    s.props.push(grp);
    const key = `${s.def.id}:${i}`;
    const pos = grp.position.clone();
    const label = clueLabel(clue.kind);
    s.unreg.push(
      this.ctx.interactions.register({
        id: `clue:${key}`,
        position: pos,
        radius: 3.2 + big,
        label,
        priority: 1,
        interact: (ctx) => {
          ctx.events.emit('ui:notify', { text: clue.text, kind: 'discovery', duration: 7, icon: '🐾' });
          ctx.events.emit('world:interact', { kind: 'creature_clue', id: key, position: { x: pos.x, y: pos.y, z: pos.z } });
          this.sys.clueFound(key, s.def);
        },
      }),
    );
  }

  private clueShape(grp: THREE.Group, kind: ClueKind, big: number, wx: number, wz: number): void {
    const w = this.ctx.world;
    switch (kind) {
      case 'tracks': {
        // A trail of paired prints, following the terrain.
        for (let k = 0; k < 10; k++) {
          for (const side of [-1, 1]) {
            const lx = side * 0.45 * big + Math.sin(k * 0.5) * 0.4, lz = k * 1.3 * big - 6 * big;
            const y = w.groundAt(wx + lx, wz + lz).y - w.groundAt(wx, wz).y + 0.03;
            const m = this.mesh('print', 'print', lx, y, lz + (side > 0 ? 0.6 * big : 0), big * 1.6, 1, big * 2.1);
            grp.add(m);
          }
        }
        break;
      }
      case 'fur':
        for (let k = 0; k < 5; k++) grp.add(this.mesh('ball', 'fur', (k % 3) * 0.5 - 0.5, 0.15, Math.floor(k / 3) * 0.5, 0.25 + (k % 2) * 0.1, 0.15, 0.3));
        grp.add(this.mesh('ball', 'rock', 0.2, 0.2, -0.6, 0.8, 0.5, 0.7));
        break;
      case 'nest':
        grp.add(this.mesh('torus', 'nest', 0, 0.2, 0, 0.55, 0.6, 0.55));
        for (let k = 0; k < 3; k++) grp.add(this.mesh('ball', 'egg', Math.sin(k * 2.1) * 0.18, 0.18, Math.cos(k * 2.1) * 0.18, 0.1, 0.13, 0.1));
        break;
      case 'burrow':
        grp.add(this.mesh('ball', 'earth', 0, -0.4, 0, 2.6, 1.3, 2.4));
        grp.add(this.mesh('disc', 'hole', 0, 0.75, 1.6, 0.9, 1, 0.7));
        for (let k = 0; k < 6; k++) grp.add(this.mesh('ball', 'earth', Math.sin(k) * 2.6, 0, Math.cos(k * 1.3) * 2.6, 0.5, 0.3, 0.5));
        break;
      case 'scratches':
        grp.add(this.mesh('box', 'rock', 0, 1.1, 0, 2.6, 2.2, 1.6, 0.3));
        for (let k = 0; k < 4; k++) {
          const m = this.mesh('box', 'hole', -0.5 + k * 0.32, 1.2, 0.81, 0.07, 1.4, 0.04, 0.3);
          m.rotation.z = 0.25;
          grp.add(m);
        }
        break;
      case 'bones':
        for (let k = 0; k < 5; k++) {
          const m = this.mesh('cyl', 'bone', Math.sin(k * 1.7) * 0.5, 0.06, Math.cos(k * 2.3) * 0.5, 0.04, 0.6, 0.04);
          m.rotation.set(Math.PI / 2, k * 0.9, 0);
          grp.add(m);
        }
        break;
      case 'scorch':
        grp.add(this.mesh('disc', 'scorch', 0, 0.04, 0, 3.5, 1, 1.6, 0.4));
        grp.add(this.mesh('disc', 'scorch', 2.8, 0.05, 1.6, 2.2, 1, 1.1, 0.9));
        grp.add(this.mesh('ball', 'glass', -0.6, 0.1, 0.4, 0.7, 0.2, 0.5));
        break;
      case 'feathers':
        for (let k = 0; k < 4; k++) {
          const m = this.mesh('plane', 'feather', Math.sin(k) * 0.4, 0.05 + k * 0.01, Math.cos(k * 1.5) * 0.4, 0.12, 0.7, 1, k);
          m.rotation.x = -Math.PI / 2 + 0.1;
          grp.add(m);
        }
        break;
    }
  }

  private buildForage(s: SpawnedHabitat, f: ForageDef): void {
    const key = `${s.def.id}:forage`;
    const x = s.centre.x + f.dx, z = s.centre.z + f.dz;
    const grp = new THREE.Group();
    grp.name = `forage:${key}`;
    const fruit = new THREE.Group();
    switch (f.item) {
      case 'moon_peaches':
      case 'lychee_nuts': {
        const tree = f.item === 'moon_peaches';
        const h = tree ? 3.2 : 0.9;
        if (tree) grp.add(this.mesh('cyl', 'bark', 0, h / 2, 0, 0.22, h, 0.22));
        grp.add(this.mesh('ball', 'leaf', 0, h + (tree ? 0.6 : 0), 0, tree ? 1.8 : 1.0, tree ? 1.3 : 0.8, tree ? 1.8 : 1.0));
        for (let k = 0; k < 7; k++) {
          const a = k * 0.9;
          fruit.add(this.mesh('ball', tree ? 'peach' : 'berry', Math.sin(a) * (tree ? 1.5 : 0.9), h + (tree ? 0.2 : 0) + Math.cos(k * 1.7) * 0.5, Math.cos(a) * (tree ? 1.5 : 0.9), tree ? 0.16 : 0.07));
        }
        break;
      }
      case 'raw_fish':
        grp.add(this.mesh('disc', 'ice', 0, 0.03, 0, 1.6));
        grp.add(this.mesh('disc', 'water', 0, 0.05, 0, 0.75));
        fruit.add(this.mesh('ball', 'rock', 1.1, 0.12, 0.3, 0.3, 0.1, 0.12));
        break;
      case 'glowing_mushroom':
        for (let k = 0; k < 6; k++) {
          const a = k * 1.1, r = 0.3 + (k % 3) * 0.35;
          grp.add(this.mesh('cyl', 'stem', Math.sin(a) * r, 0.15, Math.cos(a) * r, 0.05, 0.3, 0.05));
          fruit.add(this.mesh('ball', 'shroom', Math.sin(a) * r, 0.32, Math.cos(a) * r, 0.18, 0.09, 0.18));
        }
        break;
      case 'cabbage':
        for (let k = 0; k < 6; k++) fruit.add(this.mesh('ball', 'cabbage', (k % 3) * 0.9 - 0.9, 0.25, Math.floor(k / 3) * 0.9 - 0.45, 0.32, 0.28, 0.32));
        break;
      default:
        grp.add(this.mesh('cyl', 'basket', 0, 0.2, 0, 0.35, 0.4, 0.35));
        fruit.add(this.mesh('ball', 'egg', 0, 0.42, 0, 0.25, 0.08, 0.25));
    }
    grp.add(fruit);
    this.placeProp(grp, x, z);
    s.props.push(grp);
    const st = this.forage.get(key) ?? { readyAt: 0, fruit: null };
    st.fruit = fruit;
    this.forage.set(key, st);
    fruit.visible = this.ctx.time.elapsed >= st.readyAt;
    const item = itemById(f.item);
    const pos = grp.position.clone();
    s.unreg.push(
      this.ctx.interactions.register({
        id: `forage:${key}`,
        position: pos,
        radius: 3.2,
        label: `Gather ${item?.name ?? f.item} (${f.label})`,
        priority: 2,
        enabled: () => this.ctx.time.elapsed >= st.readyAt,
        interact: (ctx) => {
          if (ctx.time.elapsed < st.readyAt) return;
          ctx.inventory.add(f.item, f.count);
          st.readyAt = ctx.time.elapsed + f.regrow;
          if (st.fruit) st.fruit.visible = false;
          ctx.audio.play('ui.pickup', { volume: 0.6 });
        },
      }),
    );
  }

  /** Per-frame forage regrowth visuals. */
  updateProps(): void {
    const now = this.ctx.time.elapsed;
    for (const st of this.forage.values()) if (st.fruit && !st.fruit.visible && now >= st.readyAt) st.fruit.visible = true;
  }

  clear(): void {
    for (const id of [...this.spawned.keys()]) this.despawnHabitat(id);
    for (const list of this.ambient.values()) for (const c of list) if (c.mode !== 'companion') this.sys.removeCreature(c);
    this.ambient.clear();
    this.forage.clear();
  }

  dispose(): void {
    this.clear();
    if (this.shared) {
      for (const g of Object.values(this.shared.geos)) g.dispose();
      for (const m of Object.values(this.shared.mats)) m.dispose();
      this.shared = null;
    }
  }
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clueLabel(kind: ClueKind): string {
  switch (kind) {
    case 'tracks':
      return 'Examine the tracks';
    case 'nest':
      return 'Examine the nest';
    case 'burrow':
      return 'Examine the burrow mound';
    case 'fur':
      return 'Examine the tufts of fur';
    case 'scratches':
      return 'Examine the claw marks';
    case 'bones':
      return 'Examine the remains';
    case 'scorch':
      return 'Examine the scorched rock';
    case 'feathers':
      return 'Examine the feathers';
  }
}
