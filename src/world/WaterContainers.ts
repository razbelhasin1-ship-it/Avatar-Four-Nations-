import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import { allSpots, type Spot } from './Spots';

/**
 * Water jars and rain barrels beside market stalls and quest givers in the
 * towns and cities: small, finite waterbending sources (a whip uses 4 units)
 * whose water level visibly drops as you gather from them and slowly refills.
 *
 * Containers are placed lazily when the player first comes near a spot, so the
 * surrounding city (its stalls and walls) has streamed in and the placement
 * checks can keep them out of buildings. Each one gets a solid collider and a
 * registered water source; the meshes are four InstancedMeshes in total.
 */

const MAX = 96;
/** Units a container holds when full and refills per second. */
const CAPACITY = 16;
const REGEN = 0.15;
/** Place a spot's container once the player is this close (the city around it is built by then). */
const PLACE_RANGE = 120;
const JAR_H = 0.9;
const BARREL_H = 0.95;

type Kind = 'jar' | 'barrel';

interface Container {
  id: string;
  kind: Kind;
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fill: number;
}

/** Clay body tint per nation (wilds and unknown places use plain clay). */
const CLAY: Record<string, string> = { earth: '#a2643c', fire: '#7c2a20', air: '#cbbfa6' };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function jarGeometry(): THREE.BufferGeometry {
  // Wide-bellied storage jar with a rolled lip (profile: radius at height).
  const prof: Array<[number, number]> = [
    [0.0, 0.0], [0.22, 0.0], [0.33, 0.12], [0.4, 0.34], [0.38, 0.56], [0.3, 0.74], [0.25, 0.82], [0.29, 0.87], [0.3, 0.9], [0.26, 0.9], [0.24, 0.84],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  g.computeVertexNormals();
  return g;
}

function barrelGeometry(): THREE.BufferGeometry {
  const prof: Array<[number, number]> = [[0.0, 0.0], [0.34, 0.0], [0.38, 0.2], [0.4, 0.47], [0.38, 0.75], [0.34, 0.95], [0.31, 0.95], [0.31, 0.9]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  g.computeVertexNormals();
  return g;
}

export class WaterContainers implements GameSystem {
  private ctx!: GameContext;
  private readonly group = new THREE.Group();
  private jars!: THREE.InstancedMesh;
  private barrels!: THREE.InstancedMesh;
  private hoops!: THREE.InstancedMesh;
  private water!: THREE.InstancedMesh;
  private readonly placed = new Map<string, Container>();
  /** Spots checked and found without room for a container (never retried). */
  private readonly skipped = new Set<string>();
  private candidates: Array<[string, Spot]> = [];
  private scanT = 0;
  private count = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = 'water-containers';
    const clay = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: '#6e4b2c', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#3a3836', roughness: 0.6, metalness: 0.4 });
    const water = new THREE.MeshStandardMaterial({ color: '#2d6f95', roughness: 0.08, metalness: 0.1, emissive: '#0b2b3d', transparent: true, opacity: 0.92 });
    this.jars = new THREE.InstancedMesh(jarGeometry(), clay, MAX);
    this.barrels = new THREE.InstancedMesh(barrelGeometry(), wood, MAX);
    const hoop = new THREE.TorusGeometry(0.39, 0.018, 4, 18).rotateX(Math.PI / 2);
    this.hoops = new THREE.InstancedMesh(hoop, iron, MAX * 2);
    this.water = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), water, MAX);
    for (const im of [this.jars, this.barrels, this.hoops, this.water]) {
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    ctx.scene.add(this.group);
    // Every market stall and quest giver in a settlement; the Water Tribes already live on canals.
    this.candidates = allSpots().filter(([id, s]) => (id.startsWith('merchant_') || id.startsWith('giver_')) && !this.isWaterTribe(s));
    queueMicrotask(() => {
      const g = (window as unknown as { __game?: { debug: Record<string, unknown> } }).__game;
      if (g) g.debug.waterContainers = { list: () => [...this.placed.values()].map((c) => ({ id: c.id, kind: c.kind, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), fill: +c.fill.toFixed(2) })), skipped: () => [...this.skipped], candidates: () => this.candidates.length };
    });
  }

  private isWaterTribe(s: Spot): boolean {
    const r = this.ctx.world.regionAt(s.x, s.z);
    return r?.nation === 'water';
  }

  update(dt: number): void {
    const p = this.ctx.player;
    if (!p || !this.ctx.session.active || this.ctx.session.kind !== 'campaign') return;
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.5;
    for (const [id, spot] of this.candidates) {
      if (this.placed.has(id) || this.skipped.has(id) || this.count >= MAX) continue;
      if (Math.hypot(spot.x - p.position.x, spot.z - p.position.z) > PLACE_RANGE) continue;
      this.tryPlace(id, spot);
    }
  }

  /** Find free, flat ground beside the spot (not in water, nothing solid there) and put a container on it. */
  private tryPlace(id: string, spot: Spot): void {
    const world = this.ctx.world;
    const spotY = spot.y ?? world.groundAt(spot.x, spot.z).y;
    const h = hash(id);
    const a0 = ((h % 360) * Math.PI) / 180;
    for (const r of [1.8, 2.4, 3.0]) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k * Math.PI) / 4;
        const x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r;
        const g = world.groundAt(x, z, spotY + 1.2);
        if (Math.abs(g.y - spotY) > 0.35) continue;
        let flat = true;
        for (const [ox, oz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
          if (Math.abs(world.groundAt(x + ox, z + oz, spotY + 1.2).y - g.y) > 0.12) flat = false;
        }
        if (!flat || world.waterAt(x, z)) continue;
        this.v.set(x, g.y + 0.75, z);
        if (world.collision.overlapSphere(this.v, 0.6)) continue;
        this.create(id, (h >> 9) % 3 === 0 ? 'barrel' : 'jar', x, g.y, z, a + Math.PI);
        return;
      }
    }
    this.skipped.add(id);
  }

  private create(id: string, kind: Kind, x: number, y: number, z: number, yaw: number): void {
    const ctx = this.ctx;
    const index = this.count++;
    const c: Container = { id, kind, index, x, y, z, yaw, fill: 1 };
    this.placed.set(id, c);
    const height = kind === 'jar' ? JAR_H : BARREL_H;
    ctx.world.collision.add({ shape: 'cylinder', x, y: y + height / 2, z, r: 0.4, hy: height / 2, walkable: true, solid: true, surface: kind === 'jar' ? 'stone' : 'wood', tag: 'water_container' });
    // Bodies (the unused kind's slot is collapsed to zero scale).
    const body = kind === 'jar' ? this.jars : this.barrels;
    const other = kind === 'jar' ? this.barrels : this.jars;
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    body.setMatrixAt(index, this.m.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1)));
    other.setMatrixAt(index, this.m.makeScale(0, 0, 0));
    if (kind === 'jar') {
      const nation = ctx.world.regionAt(x, z)?.nation ?? '';
      body.setColorAt(index, new THREE.Color(CLAY[nation] ?? '#93603e'));
    }
    for (let k = 0; k < 2; k++) {
      const hy = kind === 'barrel' ? y + (k === 0 ? 0.22 : 0.74) : 0;
      this.hoops.setMatrixAt(index * 2 + k, kind === 'barrel' ? this.m.compose(this.v.set(x, hy, z), this.q, this.s.set(1, 1, 1)) : this.m.makeScale(0, 0, 0));
    }
    for (const im of [this.jars, this.barrels]) im.count = this.count;
    this.hoops.count = this.count * 2;
    this.water.count = this.count;
    for (const im of [this.jars, this.barrels, this.hoops]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.setLevel(c, 1);
    ctx.water.register({
      id: `jar:${id}`,
      type: 'fountain',
      label: kind === 'jar' ? 'Water jar' : 'Rain barrel',
      x,
      y: y + height - 0.08,
      z,
      r: 0.3,
      capacity: CAPACITY,
      regen: REGEN,
      size: 'small',
      onChange: (amount, capacity) => this.setLevel(c, capacity > 0 ? amount / capacity : 0),
    });
  }

  /** Water surface sinks into the container as it empties (hidden when dry). */
  private setLevel(c: Container, fill: number): void {
    c.fill = fill;
    const top = c.kind === 'jar' ? JAR_H - 0.1 : BARREL_H - 0.06;
    const depth = c.kind === 'jar' ? 0.55 : 0.75;
    const y = c.y + top - (1 - fill) * depth;
    // Radius follows the vessel's profile: the jar's neck widens into the belly as the level drops.
    const radius = c.kind === 'jar' ? 0.25 + 0.12 * Math.min(1, (1 - fill) * 1.6) : 0.33;
    const sc = fill > 0.02 ? radius : 0;
    this.water.setMatrixAt(c.index, this.m.compose(this.v.set(c.x, y, c.z), this.q.identity(), this.s.set(sc, 1, sc)));
    this.water.instanceMatrix.needsUpdate = true;
  }
}
