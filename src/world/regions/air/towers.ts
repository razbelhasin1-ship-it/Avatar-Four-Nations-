import * as THREE from 'three';
import { SimplexNoise } from '../../../core/Noise';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import * as G from './geom';
import { am, archedWindowGeo, faceYaw, pine, portal, repeatProp, waterfall, type Kit, type P2 } from './parts';

/**
 * Air Nomad towers as in the show: a very tall, slender, truly round white
 * shaft (six to eight times as tall as it is wide) ringed by mouldings, with
 * rows of small dark windows, a columned gallery under the eaves and a blue
 * conical pagoda roof whose eaves flare and turn up, crowned by a gold
 * finial. Also the thin rock spires topped with green that rise from the sea
 * of clouds around the temple.
 */

/** Conical pagoda roof with flared, upturned eaves (eave lip at y = 0.075 h). */
export function pagodaRoof(r: number, h: number, eave: number, segments = 36): THREE.BufferGeometry {
  const R = r + eave;
  const prof: Array<[number, number]> = [
    [R, h * 0.075],
    [R * 0.965, 0],
    [R * 0.86, h * 0.035],
    [r + eave * 0.35, h * 0.1],
    [r * 0.92, h * 0.2],
    [r * 0.7, h * 0.36],
    [r * 0.5, h * 0.53],
    [r * 0.32, h * 0.71],
    [r * 0.16, h * 0.87],
    [r * 0.03, h],
  ];
  const shell = G.lathe(prof, segments, 1.4);
  const soffit = G.ring(r * 0.96, R, h * 0.075 - 0.03, segments, true);
  return G.mergeAll([shell, soffit]);
}

export interface NomadTowerOpts {
  x: number;
  z: number;
  /** Floor height at the foot. */
  y: number;
  r: number;
  /** Shaft height (top of the cornice). */
  h: number;
  roofH?: number;
  eave?: number;
  finial?: number;
  /** Footing depth below y on uneven ground. */
  base?: number;
  /** Door facing (yaw). */
  door?: number;
  segments?: number;
}

/** A slender Air Nomad tower; returns the height of the finial tip. */
export function nomadTower(k: Kit, o: NomadTowerOpts): number {
  const seg = o.segments ?? 36;
  const b = k.main;
  const roofH = o.roofH ?? o.r * 3.3;
  const eave = o.eave ?? Math.max(1.0, o.r * 0.55);
  const top = o.y + o.h;
  if (o.base && o.base > 0) b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y - o.base, r: o.r * 1.14, rTop: o.r * 1.08, h: o.base + 0.05, segments: seg });
  b.cylinder('stone_white', { x: o.x, z: o.z, y: o.y, r: o.r + 0.45, h: 1.1, segments: seg });
  b.cylinder('stone_light', { x: o.x, z: o.z, y: o.y + 1.1, r: o.r + 0.25, h: 0.35, segments: seg });
  b.cylinder('plaster_white', { x: o.x, z: o.z, y: o.y + 1.45, r: o.r, h: o.h - 1.45, segments: seg });
  // Ring mouldings every storey (a heavier ring with a warm band every third) and rows of small dark windows.
  const storey = 3.6;
  const per = Math.max(4, Math.round((Math.PI * 2 * o.r) / 2.3));
  for (let i = 0; ; i++) {
    const fy = o.y + 1.45 + i * storey;
    if (fy + storey > top - 3.4) break;
    const wy = fy + 1.05;
    for (let j = 0; j < per; j++) {
      const a = ((j + (i % 2) * 0.5) / per) * Math.PI * 2;
      repeatProp(k.props, 'nt_window', () => archedWindowGeo(), am('shadow'), { x: o.x + Math.cos(a) * (o.r - 0.03), y: wy, z: o.z + Math.sin(a) * (o.r - 0.03), yaw: faceYaw(Math.cos(a), Math.sin(a)), sx: 0.6, sy: 0.72, sz: 0.55 }, false);
    }
    const ry = fy + storey - 0.2;
    const heavy = (i + 1) % 3 === 0;
    b.cylinder(heavy ? 'stone_light' : 'stone_white', { x: o.x, z: o.z, y: ry, r: o.r + (heavy ? 0.24 : 0.11), h: heavy ? 0.42 : 0.2, segments: seg });
    if (heavy) b.cylinder(am('trimOrange'), { x: o.x, z: o.z, y: ry - 0.14, r: o.r + 0.06, h: 0.12, segments: seg });
  }
  // Gallery under the eaves: a ledge, slim columns and a rail.
  const gy = top - 3.2;
  b.cylinder('stone_white', { x: o.x, z: o.z, y: gy, r: o.r + 0.95, h: 0.32, segments: seg });
  const nc = Math.max(8, Math.round((Math.PI * 2 * (o.r + 0.8)) / 1.6));
  for (let i = 0; i < nc; i++) {
    const a = ((i + 0.5) / nc) * Math.PI * 2;
    repeatProp(k.props, 'nt_col', () => new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6).translate(0, 1.3, 0), 'stone_white', { x: o.x + Math.cos(a) * (o.r + 0.75), y: gy + 0.32, z: o.z + Math.sin(a) * (o.r + 0.75) }, false);
    repeatProp(k.props, 'nt_rail', () => new THREE.CylinderGeometry(0.05, 0.06, 0.62, 5).translate(0, 0.31, 0), 'stone_white', { x: o.x + Math.cos(a + Math.PI / nc) * (o.r + 0.85), y: gy + 0.32, z: o.z + Math.sin(a + Math.PI / nc) * (o.r + 0.85) }, false);
  }
  const rail = G.annulusSector(o.r + 0.78, o.r + 0.94, 0, Math.PI * 2, gy + 0.9, gy + 1.0, seg);
  b.mesh('stone_white', rail, { x: o.x, y: 0, z: o.z });
  rail.dispose();
  b.cylinder('stone_light', { x: o.x, z: o.z, y: top - 0.55, r: o.r + 0.45, h: 0.55, segments: seg });
  b.cylinder(am('trimOrange'), { x: o.x, z: o.z, y: top - 0.68, r: o.r + 0.36, h: 0.13, segments: seg });
  const roof = pagodaRoof(o.r + 0.3, roofH, eave, seg + 4);
  b.mesh(am('roof'), roof, { x: o.x, y: top, z: o.z });
  roof.dispose();
  const f = G.finialGeometry(o.finial ?? Math.max(0.8, o.r * 0.34));
  b.mesh('gold', f, { x: o.x, y: top + roofH * 0.965, z: o.z });
  f.dispose();
  if (o.door !== undefined) portal(k, o.x + Math.sin(o.door) * (o.r + 0.47), o.y, o.z + Math.cos(o.door) * (o.r + 0.47), o.door, 2.2, 3.4);
  const bottom = o.y - (o.base ?? 0);
  b.collider({ shape: 'cylinder', x: o.x, y: (bottom + top) / 2, z: o.z, r: o.r + 0.45, hy: (top - bottom) / 2, walkable: false, solid: true, surface: 'stone' });
  b.collider({ shape: 'cylinder', x: o.x, y: top + roofH * 0.2, z: o.z, r: o.r + 0.6, hy: roofH * 0.2, walkable: true, solid: true, surface: 'stone' });
  return top + roofH * 1.0 + 1;
}

// ---------------------------------------------------------------------------
// Rock spires in the sea of clouds
// ---------------------------------------------------------------------------

const noise = new SimplexNoise(2718);

/**
 * Weathered rock pinnacle: strong taper with pinches, bulges and a couple of
 * ledges up its height, vertical flutes, a slight lean; flat top at y = h.
 */
export function rockSpireGeometry(seed: number, r: number, h: number): THREE.BufferGeometry {
  const radial = 20, rows = 26;
  const P: number[] = [], I: number[] = [];
  const lean = 0.07 * noise.noise2(seed, 0.5);
  const ledges = [0.3 + 0.2 * (noise.noise2(seed, 4.4) * 0.5 + 0.5), 0.62 + 0.15 * (noise.noise2(seed, 7.7) * 0.5 + 0.5)];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = t * h;
    let prof = 1 - 0.48 * t + 0.16 * Math.sin(t * Math.PI * 2.3 + seed) + 0.12 * noise.noise2(t * 4 + seed, 1.7);
    for (const l of ledges) prof *= t < l ? 1 + 0.12 * Math.min(1, (l - t) * 12) : 1;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const flute = 0.1 * Math.abs(Math.sin(a * 5 + seed)) + 0.22 * noise.noise2(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6 + t * 3.1);
      const rr = Math.max(r * 0.2, r * prof * (1 + flute));
      P.push(Math.cos(a) * rr + lean * y, y, Math.sin(a) * rr);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * radial + i, b = j * radial + ((i + 1) % radial), c = a + radial, d = b + radial;
      I.push(a, c, b, b, c, d);
    }
  }
  const centre = P.length / 3;
  P.push(lean * h, h, 0);
  for (let i = 0; i < radial; i++) I.push(rows * radial + i, centre, rows * radial + ((i + 1) % radial));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Spires around the temple mountain: [x, z, base radius, top height, waterfall]. */
const SPIRES: Array<[number, number, number, number, boolean]> = [
  [1690, 1080, 19, 305, true],
  [1760, 1250, 23, 350, false],
  [1680, 1450, 17, 290, true],
  [1520, 1560, 21, 330, false],
  [1290, 1500, 18, 310, true],
  [1110, 1330, 20, 335, false],
  [1905, 1010, 26, 385, false],
  [1930, 1430, 22, 355, false],
  [1340, 1760, 25, 370, false],
  [1010, 1610, 23, 345, false],
  [1600, 1760, 18, 305, false],
  [1640, 1290, 14, 268, false],
  [1580, 1440, 13, 255, false],
];

/**
 * Pinnacles standing free round the foot of the temple mountain, a few taller
 * than its rim, so the temple reads as the crown of a cluster of spires:
 * [bearing from the summit in degrees, distance, base radius, top height].
 * Bearings keep clear of the switchback trail, the trailhead and the bison
 * meadow (about 185-250 degrees) and of the Shrine of the Four Winds (about
 * 20-65 degrees).
 */
const FLANK: Array<[number, number, number, number]> = [
  [0, 150, 15, 300], [72, 150, 14, 318], [92, 162, 17, 345], [114, 148, 13, 286],
  [136, 158, 16, 330], [160, 150, 13, 296], [178, 165, 15, 352], [258, 156, 14, 310],
  [280, 148, 17, 340], [306, 160, 13, 284], [330, 150, 15, 322],
];

/** Thin rock spires topped with grass and pines, some with a waterfall falling into the clouds. */
export function buildSpires(k: Kit, centre: P2): void {
  const rnd = new Random(4242);
  const spire = (x: number, z: number, r: number, topY: number, falls: boolean, i: number) => {
    const base = Math.min(heightAt(x, z), 110) - 12;
    const h = topY - base;
    const g = rockSpireGeometry(i * 13.7 + 3, r, h);
    const yaw = rnd.range(0, 6.28);
    k.main.mesh(am('rockSpire'), g, { x, y: base, z, yaw });
    g.dispose();
    // The spire leans along its local +X, so its top sits off the base centre.
    const lean = 0.07 * noise.noise2(i * 13.7 + 3, 0.5) * h;
    const lx = Math.cos(yaw) * lean, lz = -Math.sin(yaw) * lean;
    const tx = x + lx, tz = z + lz;
    // Green cap: a low grassy mound over the flat top, a few pines.
    const rt = r * 0.5;
    const cap = new THREE.SphereGeometry(rt * 1.04, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.22, 1);
    k.main.mesh(am('foliage'), cap, { x: tx, y: topY - 0.4, z: tz });
    cap.dispose();
    for (let p = 0; p < 4; p++) {
      const a = rnd.range(0, 6.28), d = rnd.range(0, rt * 0.6);
      pine(k, tx + Math.cos(a) * d, topY + rt * 0.12, tz + Math.sin(a) * d, p % 3, rnd.range(1.6, 2.6), rnd.range(0, 6), false);
    }
    // Three stacked cylinders follow the lean and the taper.
    for (let s = 0; s < 3; s++) {
      const t = (s + 0.5) / 3;
      k.main.collider({ shape: 'cylinder', x: x + lx * t, y: base + h * t, z: z + lz * t, r: r * 0.85 * (1 - 0.45 * t), hy: h / 6, walkable: true, solid: true, surface: 'rock' });
    }
    if (falls) {
      const a = Math.atan2(centre.z - tz, centre.x - tx) + rnd.range(-0.5, 0.5);
      const fx = Math.cos(a), fz = Math.sin(a);
      waterfall(k, { id: `air:spire_falls_${i}`, label: 'Spire falls', x: tx + fx * rt * 0.78, y: topY - 1.2, z: tz + fz * rt * 0.78, yaw: faceYaw(fx, fz), width: 3.5 + r * 0.08, drop: 150, out: 2.5, register: false });
    }
  };
  SPIRES.forEach(([x, z, r, topY, falls], i) => spire(x, z, r, topY, falls, i));
  FLANK.forEach(([deg, d, r, topY], i) => {
    const a = (deg * Math.PI) / 180;
    spire(centre.x + Math.cos(a) * d, centre.z + Math.sin(a) * d, r, topY, false, SPIRES.length + i);
  });
}

