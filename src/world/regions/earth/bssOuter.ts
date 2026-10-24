import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import { heightAt } from '../../Heightfield';
import type { P2 } from '../../WorldLayout';
import { AGRARIAN_AVENUES, C, GROUND, INNER, LAKE_LAOGAI, OUTER, outerR, qkey, RAIL, RAIL_LINES, STATIONS, STATION_HALF, thetaOf, type RailLine } from './bssLayout';
import { lanternsAlong, pavedStrip } from './cityKit';
import type { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';
import { spandrelGeometry } from './geom';
import { crates, mat4, tree } from './parts';
import { BSS } from './spots';

/**
 * Ba Sing Se outside the Inner Wall and above the streets: the Agrarian Zone
 * (fields, farmsteads, tree-lined avenues, Lake Laogai boathouse and reeds)
 * and the monorail: arched stone viaducts on tall piers, stations with green
 * roofs and a train car resting at the Lower Ring west station.
 */

const PIER_W = 2.6;
const PIER_D = 4.6;
const DECK_W = 5.4;
const SPAN = 17;

interface Pier {
  x: number;
  z: number;
  /** Deck height above the pier. */
  y: number;
  /** Unit tangent of the line. */
  tx: number;
  tz: number;
}

/** Densify a rail line into evenly spaced pier stations (by arc length). */
function railPiers(line: RailLine): Pier[] {
  const pts = line.points;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / SPAN));
  const out: Pier[] = [];
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
    const a = pts[seg], b = pts[seg + 1];
    const l = cum[seg + 1] - cum[seg] || 1;
    const t = (s - cum[seg]) / l;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l });
  }
  return out;
}

const PIERS = RAIL_LINES.map((l) => ({ id: l.id, piers: railPiers(l) }));

/** Keep houses / fields away from the viaduct piers and stations. */
export function railExclusions(env: BuildEnv): void {
  for (const { piers } of PIERS) for (const p of piers) env.excl.circle(p.x, p.z, 3.6);
  for (const s of [STATIONS.lowerWest, STATIONS.lowerNorth, STATIONS.lowerEast]) env.excl.circle(s.x, s.z, 6);
}

/** One viaduct span between two piers: deck slab, parapets, rails, arch spandrel. */
function span(b: ContentBuilder, a: Pier, c: Pier, first: boolean): void {
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx);
  const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
  const rise = c.y - a.y;
  const pitch = Math.atan2(rise, len);
  const my = (a.y + c.y) / 2;
  const L = Math.hypot(len, rise) + 0.3;
  // Deck slab (top = rail level) and parapets.
  b.box('stone_light', { x: mx, y: my - 0.6, z: mz, sx: L, sy: 1.2, sz: DECK_W, yaw, roll: pitch });
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  for (const sd of [-1, 1]) {
    b.box('stone_tan', { x: mx + nx * sd * (DECK_W / 2 - 0.25), y: my + 0.45, z: mz + nz * sd * (DECK_W / 2 - 0.25), sx: L, sy: 0.9, sz: 0.5, yaw, roll: pitch });
    b.box('iron', { x: mx + nx * sd * 0.75, y: my + 0.08, z: mz + nz * sd * 0.75, sx: L, sy: 0.16, sz: 0.18, yaw, roll: pitch }, { castShadow: false });
  }
  // Walkable deck (ramp on graded spurs) + parapet colliders.
  const lo = Math.min(a.y, c.y), hi = Math.max(a.y, c.y);
  b.collider({ shape: 'box', x: mx, y: (lo + hi) / 2 - 0.6, z: mz, hx: len / 2 + 0.05, hz: DECK_W / 2, hy: (hi - lo) / 2 + 0.6, yaw: rise >= 0 ? yaw : yaw + Math.PI, slopeRise: Math.abs(rise) > 0.01 ? Math.abs(rise) : 0, walkable: true, solid: true, surface: 'stone' });
  for (const sd of [-1, 1]) b.collider({ shape: 'box', x: mx + nx * sd * (DECK_W / 2 - 0.25), y: my + 0.6, z: mz + nz * sd * (DECK_W / 2 - 0.25), hx: len / 2, hz: 0.25, hy: 0.9, yaw, walkable: false, solid: true });
  // Arch spandrel under the deck between the piers.
  const clear = len - PIER_W;
  if (clear > 4) {
    const r = clear / 2;
    const h = r + 1.2;
    const g = spandrelGeometry(clear, h, PIER_D - 0.6, 10);
    b.mesh('stone_light', g, { x: mx, y: Math.min(a.y, c.y) - 1.2 - h, z: mz, yaw });
    g.dispose();
  }
  void first;
}

function pier(b: ContentBuilder, p: Pier, deckY: number): void {
  const g = heightAt(p.x, p.z);
  const base = Math.min(GROUND, g) - 0.5;
  const top = deckY - 1.2;
  const yaw = Math.atan2(-p.tz, p.tx);
  b.box('stone_light', { x: p.x, y: (base + top) / 2, z: p.z, sx: PIER_W, sy: top - base, sz: PIER_D, yaw }, { collide: true, walkable: false });
  b.box('stone_tan', { x: p.x, y: base + 1.4, z: p.z, sx: PIER_W + 0.8, sy: 2.8, sz: PIER_D + 0.8, yaw });
  b.box('stone_tan', { x: p.x, y: top - 0.4, z: p.z, sx: PIER_W + 0.5, sy: 0.8, sz: PIER_D + 0.5, yaw });
}

/** Station: wide platform + green-roofed hall on the deck. */
function station(b: ContentBuilder, x: number, y: number, z: number, theta: number): void {
  const yaw = Math.atan2(Math.cos(theta), -Math.sin(theta)) - Math.PI / 2; // long axis tangent to the ring
  b.box('stone_light', { x, y: y - 0.6, z, sx: STATION_HALF * 2, sy: 1.2, sz: 12, yaw }, { collide: true, walkable: true });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const lx of [-6, -2, 2, 6]) {
    for (const lz of [-5, 5]) {
      b.box('wood_red', { x: x + lx * c + lz * s, y: y + 2.2, z: z - lx * s + lz * c, sx: 0.5, sy: 4.4, sz: 0.5, yaw }, { collide: true, walkable: false });
    }
  }
  b.box('wood_dark', { x, y: y + 4.5, z, sx: STATION_HALF * 2 + 0.6, sy: 0.4, sz: 11, yaw });
  b.roof('roof_green', { x, y: y + 4.7, z, w: STATION_HALF * 2, d: 10.5, height: 3.2, yaw, overhang: 1.6, style: 'hip', curve: 0.9, ridge: 'gold' });
  // Under-station support block (two piers).
  for (const lz of [-4, 4]) {
    const px = x + lz * s, pz = z + lz * c;
    b.box('stone_light', { x: px, y: (GROUND + y - 1.2) / 2, z: pz, sx: 4, sy: y - 1.2 - GROUND, sz: 3, yaw }, { collide: true, walkable: false });
  }
}

export function* buildRail(env: BuildEnv, site: EarthRegion): Generator<unknown, void, unknown> {
  const rq = (x: number, z: number) => env.chunks.named('major', `q:${qkey(x, z)}`).builder;
  for (const { piers } of PIERS) {
    for (let i = 0; i < piers.length; i++) {
      const p = piers[i];
      const nearStation = [STATIONS.lowerWest, STATIONS.lowerNorth, STATIONS.lowerEast].some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 9);
      if (!nearStation) pier(rq(p.x, p.z), p, p.y);
      if (i > 0) span(rq((piers[i - 1].x + p.x) / 2, (piers[i - 1].z + p.z) / 2), piers[i - 1], p, i === 1);
    }
    yield;
  }
  const sb = rq(STATIONS.lowerNorth.x, STATIONS.lowerNorth.z);
  for (const s of [STATIONS.lowerWest, STATIONS.lowerNorth, STATIONS.lowerEast]) station(sb, s.x, s.y, s.z, s.theta);
  for (const s of [STATIONS.outerWest, STATIONS.outerEast, STATIONS.outerSouth]) {
    // Wall-top station: roofed platform on the outer wall walkway.
    const yaw = Math.atan2(Math.cos(s.theta), -Math.sin(s.theta)) - Math.PI / 2;
    for (const lx of [-5, 5]) for (const lz of [-3, 3]) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      sb.box('wood_red', { x: s.x + lx * c + lz * sn, y: s.y + 2.1, z: s.z - lx * sn + lz * c, sx: 0.45, sy: 4.2, sz: 0.45, yaw }, { collide: true, walkable: false });
    }
    sb.roof('roof_green', { x: s.x, y: s.y + 4.3, z: s.z, w: 12, d: 8, height: 2.6, yaw, overhang: 1.4, style: 'hip', curve: 0.9, ridge: 'gold' });
  }
  // A train car resting at the Lower Ring west station.
  {
    const s = STATIONS.lowerWest;
    const yaw = Math.atan2(Math.cos(s.theta), -Math.sin(s.theta)) - Math.PI / 2;
    const tb = rq(s.x, s.z);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const off = -2.2; // on the track side of the platform
    const x = s.x + off * sn, z = s.z + off * c;
    tb.block(env.mats.trainBody, { x, y: s.y + 0.4, z, sx: 13, sy: 3.2, sz: 3.2, yaw }, { collide: true, walkable: true });
    tb.box(env.mats.trainWindow, { x, y: s.y + 2.5, z, sx: 11.4, sy: 1.0, sz: 3.26, yaw }, { castShadow: false });
    tb.box('roof_green', { x, y: s.y + 3.75, z, sx: 13.4, sy: 0.3, sz: 3.6, yaw });
    for (const e of [-1, 1]) tb.box('gold', { x: x + c * e * 6.6, y: s.y + 2, z: z - sn * e * 6.6, sx: 0.2, sy: 2.6, sz: 2.6, yaw });
    site.mark('train', x, s.y, z);
  }
  site.mark('stationWest', STATIONS.lowerWest.x, STATIONS.lowerWest.y, STATIONS.lowerWest.z);

  // Monorail rides: boarding booths under the Lower Ring stations and on the Outer Wall
  // platforms carry the player between the Lower Ring and the wall walkway.
  const rides: Array<{ id: string; from: P2 & { y: number }; to: P2 & { y: number }; label: string }> = [
    { id: 'bss_monorail_lower_west', from: { x: STATIONS.lowerWest.x, y: GROUND, z: STATIONS.lowerWest.z }, to: STATIONS.outerWest, label: 'Ride the monorail to the Outer Wall (west)' },
    { id: 'bss_monorail_outer_west', from: STATIONS.outerWest, to: { x: STATIONS.lowerWest.x, y: GROUND, z: STATIONS.lowerWest.z }, label: 'Ride the monorail into the Lower Ring' },
    { id: 'bss_monorail_lower_east', from: { x: STATIONS.lowerEast.x, y: GROUND, z: STATIONS.lowerEast.z }, to: STATIONS.outerEast, label: 'Ride the monorail to the Outer Wall (east)' },
    { id: 'bss_monorail_outer_east', from: STATIONS.outerEast, to: { x: STATIONS.lowerEast.x, y: GROUND, z: STATIONS.lowerEast.z }, label: 'Ride the monorail into the Lower Ring' },
  ];
  const kb = env.chunks.named('props', 'rail_booths').builder;
  for (const r of rides) {
    if (r.from.y === GROUND) {
      // Ticket booth at street level under the station.
      kb.block('wood_red', { x: r.from.x + 3.2, y: GROUND, z: r.from.z, sx: 1.6, sy: 2.4, sz: 2.2 }, { collide: true, walkable: false });
      kb.roof('roof_green', { x: r.from.x + 3.2, y: GROUND + 2.4, z: r.from.z, w: 1.6, d: 2.2, height: 0.8, overhang: 0.5, style: 'hip', curve: 0.7 });
    }
    const dest = new THREE.Vector3(r.to.x, r.to.y + 0.05, r.to.z);
    env.interactables.push({
      id: r.id,
      position: new THREE.Vector3(r.from.x, r.from.y + 1, r.from.z),
      radius: 3.5,
      label: r.label,
      priority: 2,
      interact: (ctx) => {
        ctx.player?.teleport(dest.clone());
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Agrarian Zone
// ---------------------------------------------------------------------------

function quadrant(x: number, z: number): string {
  return `${x < C.x ? 'w' : 'e'}${z < C.z ? 'n' : 's'}`;
}

export function* buildAgrarian(env: BuildEnv, site: EarthRegion): Generator<unknown, void, unknown> {
  const { chunks, mats, excl, rnd, arch } = env;
  const Y = GROUND;
  // Avenues: paving + tree rows + lanterns near the gates.
  for (const av of AGRARIAN_AVENUES) excl.polyline(av.points, av.width / 2 + 3);
  excl.circle(LAKE_LAOGAI.x, LAKE_LAOGAI.z, LAKE_LAOGAI.r + 14);
  excl.circle(BSS.boathouse.x, BSS.boathouse.z, 10);
  for (const av of AGRARIAN_AVENUES) {
    pavedStrip(chunks.named('major', 'ground').builder, mats.road, av.points, av.width, Y + 0.03, 4);
    const pts = av.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
      for (let s = 10; s < len - 6; s += 14) {
        for (const sd of [-1, 1]) {
          const x = a.x + tx * s - tz * sd * (av.width / 2 + 2.5), z = a.z + tz * s + tx * sd * (av.width / 2 + 2.5);
          tree(chunks.named('props', `agr_trees_${quadrant(x, z)}`).builder, mats, x, Y, z, rnd.range(1.0, 1.35), (s / 14) % 4 === 1 ? 'blossom' : 'round', rnd.range(0, 6));
        }
      }
    }
    lanternsAlong(env, [pts[0], { x: pts[0].x + (pts[1].x - pts[0].x) * 0.12, z: pts[0].z + (pts[1].z - pts[0].z) * 0.12 }], av.width / 2 + 0.8, Y, 10);
  }
  yield;
  // Fields on a polar grid (merged per quadrant; one draw call per crop texture per quadrant).
  const crops = [...mats.crops.slice(0, 3), mats.paddy];
  let fields = 0;
  let farms = 0;
  const r0 = INNER.r + INNER.thick / 2 + 14;
  for (let r = r0; r < 400; r += 24) {
    const dth = 30 / r;
    for (let th = rnd.range(0, dth); th < Math.PI * 2; th += dth) {
      const rOut = outerR(th) - OUTER.thick / 2 - 6;
      if (r + 12 > rOut) continue;
      const x = C.x + Math.cos(th) * (r + 11), z = C.z + Math.sin(th) * (r + 11);
      const yaw = Math.atan2(Math.cos(th), Math.sin(th));
      const hw = (dth * (r + 11)) / 2 - 1.6, hd = 10;
      if (excl.rectBlocked(x, z, hw, hd, yaw, 1)) {
        continue;
      }
      if (Math.abs(heightAt(x, z) - Y) > 0.3) continue;
      const q = quadrant(x, z);
      if (rnd.chance(0.12)) {
        // Farmstead: two or three farm buildings around a yard.
        const ids = ['F1', 'F2', 'F3'] as const;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const n = 2 + (rnd.chance(0.5) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = arch[ids[i % 3]];
          const lx = (i - (n - 1) / 2) * (hw * 0.62), lz = i === 1 ? -3 : 2;
          env.chunks.addHouse(a, x + lx * c + lz * s, Y, z - lx * s + lz * c, yaw + (i === 1 ? 0 : (i - 1) * 0.35), { tint: new THREE.Color().setHSL(0.09, 0.15, 0.92 + rnd.range(-0.05, 0.05)) });
          farms++;
        }
        crates(chunks.named('detail', `agr_detail_${q}`).builder, x + rnd.range(-3, 3), Y, z + rnd.range(-3, 3), rnd, 3);
        tree(chunks.named('props', `agr_trees_${q}`).builder, mats, x + c * (hw - 1), Y, z - s * (hw - 1), 1.2, 'round', rnd.range(0, 6));
        continue;
      }
      const g = new THREE.PlaneGeometry(hw * 2, hd * 2);
      g.rotateX(-Math.PI / 2);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (hw / 4), uv.getY(i) * (hd / 4));
      chunks.named('houses', `agr_fields_${q}`).builder.mesh(crops[Math.floor(rnd.next() * crops.length)], g, { x, y: Y + 0.04, z, yaw }, { castShadow: false });
      g.dispose();
      fields++;
      // Occasional tree at the field corner.
      if (rnd.chance(0.25)) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        tree(chunks.named('props', `agr_trees_${q}`).builder, mats, x + c * (hw + 1.2) + s * hd, Y, z - s * (hw + 1.2) + c * hd, rnd.range(0.9, 1.3), rnd.chance(0.3) ? 'pine' : 'round', rnd.range(0, 6));
      }
    }
    yield;
  }
  site.mark('fields', fields, farms, 0);

  // Lake Laogai: boathouse, pier (dock_laogai) and reeds.
  {
    const b = chunks.named('props', 'laogai').builder;
    const bh = BSS.boathouse;
    env.chunks.addHouse(arch.R1s, bh.x, heightAt(bh.x, bh.z), bh.z, Math.PI / 2, { tint: new THREE.Color('#f2ece0') });
    const { a, b: e } = BSS.lakeDock;
    b.bridge({ a: new THREE.Vector3(a.x, 26.3, a.z), b: new THREE.Vector3(e.x, 26.3, e.z), width: 3, deck: 'wood', rail: 'wood_dark', support: 'wood_dark', supportBottom: 21, surface: 'wood' });
    site.mark('laogaiDockEnd', e.x - 1, 26.3, e.z);
    for (let i = 0; i < 70; i++) {
      const th = rnd.range(0, Math.PI * 2);
      const r = LAKE_LAOGAI.r + rnd.range(-6, 2);
      const x = LAKE_LAOGAI.x + Math.cos(th) * r, z = LAKE_LAOGAI.z + Math.sin(th) * r;
      if (Math.hypot(x - a.x, z - a.z) < 12 || Math.abs(z - a.z) < 3) continue;
      const h = heightAt(x, z);
      b.instance('reed', () => {
        const g = new THREE.ConeGeometry(0.5, 2.2, 5);
        g.translate(0, 1.1, 0);
        return g;
      }, mats.reed, mat4(x, Math.max(h, 24.9), z, th, rnd.range(0.7, 1.3)), false);
    }
  }
  void thetaOf;
  void RAIL;
}

/** Points helper for tests. */
export function railLines(): Array<{ id: string; piers: P2[] }> {
  return PIERS.map(({ id, piers }) => ({ id, piers: piers.map((p) => ({ x: p.x, z: p.z })) }));
}
