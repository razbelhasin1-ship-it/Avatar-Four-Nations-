import type { HouseAtlas } from './atlas';
import { GeoBuilder, roofInto, type UVRect, type V3 } from './geom';

/**
 * House archetypes: low-poly local-space geometry (origin = ground centre,
 * front = +Z) textured from the shared HouseAtlas. They are stamped into
 * merged per-chunk batches by ChunkSet.addHouse().
 */

export interface HouseArchetype {
  id: string;
  geo: GeoBuilder;
  /** Wall footprint and heights (local, before scale). */
  w: number;
  d: number;
  h: number;
  plinth: number;
  roofH: number;
  /** Collider box (half extents) and height. */
  colHX: number;
  colHZ: number;
  colH: number;
  /** Visual span incl. overhang / awnings (spacing). */
  spanW: number;
  spanD: number;
  /** Extra depth in front (+Z) taken by porches / awnings. */
  front: number;
}

interface HouseSpec {
  id: string;
  w: number;
  d: number;
  h: number;
  front: string;
  side: string;
  back?: string;
  roof: string;
  roofStyle: 'hip' | 'gable';
  roofH: number;
  overhang: number;
  curve: number;
  /** Pent (skirt) roof heights above the plinth on front/back. */
  pents?: number[];
  pentSides?: boolean;
  awning?: string;
  porch?: { depth: number; cols: number };
  plinth?: number;
  chimney?: boolean;
  stilts?: number;
}

function pentRoof(g: GeoBuilder, a: HouseAtlas, w: number, d: number, y: number, depth: number, sides: boolean): void {
  const tiles = a.get('roofA');
  const soffit = a.get('wood');
  const t: UVRect = { u0: tiles.u0, v0: tiles.v0, u1: tiles.u0 + (tiles.u1 - tiles.u0) * Math.min(1, (w + 0.6) / 12), v1: tiles.v0 + (tiles.v1 - tiles.v0) * (1.1 / 8) };
  const drop = 0.55;
  const faces: Array<[number, number, number]> = [
    [0, 1, w],
    [Math.PI, 1, w],
  ];
  if (sides) faces.push([Math.PI / 2, 0, d], [-Math.PI / 2, 0, d]);
  for (const [rot, , len] of faces) {
    const half = rot === 0 || rot === Math.PI ? d / 2 : w / 2;
    const c = Math.cos(rot), s = Math.sin(rot);
    // Local (u along wall, n outward) → x,z
    const P = (u: number, n: number, yy: number): V3 => [u * c + n * s, yy, -u * s + n * c];
    const l = len / 2 + 0.35;
    // Tiles (top surface)
    g.quad(P(-l, half + depth, y), P(l, half + depth, y), P(l, half, y + drop), P(-l, half, y + drop), t);
    // Underside
    g.quad(P(l, half + depth, y - 0.02), P(-l, half + depth, y - 0.02), P(-l, half, y + drop - 0.08), P(l, half, y + drop - 0.08), soffit);
  }
}

function buildHouse(a: HouseAtlas, s: HouseSpec): HouseArchetype {
  const g = new GeoBuilder();
  const plinth = s.plinth ?? 0;
  const stilts = s.stilts ?? 0;
  const y0 = plinth + stilts;
  const front = a.get(s.front), side = a.get(s.side), back = a.get(s.back ?? s.side);
  const stone = a.get('stone');
  const wood = a.get('wood');
  if (stilts > 0) {
    const post = a.get('woodDark');
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) g.box((sx * (s.w - 0.4)) / 2, stilts / 2, (sz * (s.d - 0.4)) / 2, 0.3, stilts, 0.3, { px: post, nx: post, pz: post, nz: post });
    // Deck under the house
    g.box(0, stilts - 0.12, 0, s.w + 1.2, 0.24, s.d + 1.2, { py: wood, ny: wood, pz: wood, nz: wood, px: wood, nx: wood });
  }
  if (plinth > 0) {
    const extra = s.porch ? s.porch.depth : 0;
    g.box(0, plinth / 2, extra / 2, s.w + 0.6, plinth, s.d + 0.6 + extra, { px: stone, nx: stone, pz: stone, nz: stone, py: stone });
  }
  g.box(0, y0 + s.h / 2, 0, s.w, s.h, s.d, { pz: front, nz: back, px: side, nx: side });
  roofInto(g, {
    cx: 0,
    cy: y0 + s.h,
    cz: 0,
    w: s.w + s.overhang * 2,
    d: s.d + s.overhang * 2,
    h: s.roofH,
    style: s.roofStyle,
    curve: s.curve,
    tiles: a.get(s.roof),
    tileW: 12,
    tileH: 8,
    soffit: wood,
    overhang: s.overhang,
    gable: a.get('plasterCream'),
    ridge: a.get('ridge'),
  });
  for (const ph of s.pents ?? []) pentRoof(g, a, s.w, s.d, y0 + ph, 0.95, !!s.pentSides);
  let frontExtra = 0;
  if (s.awning) {
    const aw = a.get(s.awning);
    const yTop = y0 + Math.min(3.1, s.h - 0.9);
    const out = 1.9;
    const hw = s.w / 2 - 0.25;
    const zf = s.d / 2;
    g.quad([-hw, yTop - 0.6, zf + out], [hw, yTop - 0.6, zf + out], [hw, yTop, zf + 0.02], [-hw, yTop, zf + 0.02], aw);
    g.quad([hw, yTop - 0.62, zf + out], [-hw, yTop - 0.62, zf + out], [-hw, yTop - 0.02, zf + 0.02], [hw, yTop - 0.02, zf + 0.02], aw);
    // Valance strip
    g.quad([-hw, yTop - 0.95, zf + out], [hw, yTop - 0.95, zf + out], [hw, yTop - 0.6, zf + out], [-hw, yTop - 0.6, zf + out], aw);
    const pole = a.get('woodDark');
    for (const sx of [-1, 1]) g.box(sx * (hw - 0.1), y0 + (yTop - 0.6 - y0) / 2, zf + out - 0.1, 0.1, yTop - 0.6 - y0, 0.1, { px: pole, nx: pole, pz: pole, nz: pole });
    frontExtra = out;
  }
  if (s.porch) {
    const p = s.porch;
    const yTop = y0 + s.h - 0.25;
    const zf = s.d / 2;
    const tiles = a.get(s.roof);
    const t: UVRect = { u0: tiles.u0, v0: tiles.v0, u1: tiles.u0 + (tiles.u1 - tiles.u0) * Math.min(1, (s.w + 1) / 12), v1: tiles.v0 + (tiles.v1 - tiles.v0) * ((p.depth + 0.6) / 8) };
    const hw = s.w / 2 + 0.5;
    g.quad([-hw, yTop - 0.75, zf + p.depth + 0.5], [hw, yTop - 0.75, zf + p.depth + 0.5], [hw, yTop, zf], [-hw, yTop, zf], t);
    g.quad([hw, yTop - 0.8, zf + p.depth + 0.5], [-hw, yTop - 0.8, zf + p.depth + 0.5], [-hw, yTop - 0.05, zf], [hw, yTop - 0.05, zf], wood);
    const col = a.get('woodRed');
    const colH = yTop - 0.78 - y0;
    for (let i = 0; i < p.cols; i++) {
      const x = -s.w / 2 + 0.3 + (i * (s.w - 0.6)) / (p.cols - 1);
      g.box(x, y0 + colH / 2, zf + p.depth - 0.1, 0.32, colH, 0.32, { px: col, nx: col, pz: col, nz: col });
    }
    frontExtra = p.depth;
  }
  if (s.chimney) {
    g.box(s.w * 0.22, y0 + s.h + s.roofH * 0.55, -s.d * 0.12, 0.6, s.roofH * 0.9 + 0.6, 0.6, { px: stone, nx: stone, pz: stone, nz: stone, py: a.get('dark') });
  }
  return {
    id: s.id,
    geo: g,
    w: s.w,
    d: s.d,
    h: s.h,
    plinth: y0,
    roofH: s.roofH,
    colHX: s.w / 2 + 0.05,
    colHZ: s.d / 2 + 0.05,
    colH: y0 + s.h + s.roofH * 0.5,
    spanW: s.w + s.overhang * 2,
    spanD: s.d + s.overhang * 2 + frontExtra,
    front: frontExtra,
  };
}

export type ArchetypeId = 'L1' | 'L2' | 'L3' | 'L3b' | 'L4' | 'L5' | 'M1' | 'M2' | 'F1' | 'F2' | 'F3' | 'R1' | 'R1s' | 'G1';

export function buildArchetypes(a: HouseAtlas): Record<ArchetypeId, HouseArchetype> {
  const specs: HouseSpec[] = [
    { id: 'L1', w: 6, d: 5, h: 3.4, front: 'L1f', side: 'L1s', back: 'L1b', roof: 'roofA', roofStyle: 'hip', roofH: 2.0, overhang: 0.75, curve: 0.35 },
    { id: 'L2', w: 5.6, d: 7, h: 6.2, front: 'L2f', side: 'L2s', roof: 'roofB', roofStyle: 'gable', roofH: 2.2, overhang: 0.7, curve: 0.3, pents: [3.1] },
    { id: 'L3', w: 7, d: 6, h: 4.4, front: 'L3f', side: 'L3s', roof: 'roofA', roofStyle: 'hip', roofH: 2.2, overhang: 0.8, curve: 0.35, awning: 'awningGreen' },
    { id: 'L3b', w: 7, d: 6, h: 4.4, front: 'L3f', side: 'L3s', back: 'L1b', roof: 'roofD', roofStyle: 'hip', roofH: 2.2, overhang: 0.8, curve: 0.35, awning: 'awningRed' },
    { id: 'L4', w: 6.6, d: 6.6, h: 9, front: 'L4f', side: 'L4s', roof: 'roofB', roofStyle: 'hip', roofH: 2.6, overhang: 0.8, curve: 0.45, pents: [3.0, 6.0], pentSides: true },
    { id: 'L5', w: 10.4, d: 5.4, h: 3.6, front: 'L5f', side: 'L5s', back: 'L1b', roof: 'roofA', roofStyle: 'gable', roofH: 2.2, overhang: 0.7, curve: 0.3 },
    { id: 'M1', w: 11, d: 8.5, h: 4.6, front: 'M1f', side: 'M1s', roof: 'roofA', roofStyle: 'hip', roofH: 3.0, overhang: 1.0, curve: 0.55, plinth: 0.6, porch: { depth: 2.2, cols: 4 } },
    { id: 'M2', w: 9, d: 8, h: 7.6, front: 'M2f', side: 'M2s', roof: 'roofD', roofStyle: 'hip', roofH: 2.8, overhang: 0.9, curve: 0.5, plinth: 0.6, pents: [3.8], pentSides: true },
    { id: 'F1', w: 8, d: 5.6, h: 3.2, front: 'F1f', side: 'F1s', roof: 'roofC', roofStyle: 'hip', roofH: 2.4, overhang: 0.7, curve: 0.15, chimney: true },
    { id: 'F2', w: 10, d: 7, h: 4.4, front: 'F2f', side: 'F2s', roof: 'roofC', roofStyle: 'gable', roofH: 3.0, overhang: 0.6, curve: 0.1 },
    { id: 'F3', w: 4, d: 3.6, h: 2.6, front: 'F3f', side: 'F3s', roof: 'roofC', roofStyle: 'gable', roofH: 1.6, overhang: 0.4, curve: 0.1 },
    { id: 'R1', w: 7, d: 5.6, h: 3.4, front: 'R1f', side: 'R1s', roof: 'roofB', roofStyle: 'gable', roofH: 2.2, overhang: 0.7, curve: 0.3 },
    { id: 'R1s', w: 7, d: 5.6, h: 3.4, front: 'R1f', side: 'R1s', roof: 'roofB', roofStyle: 'gable', roofH: 2.2, overhang: 0.7, curve: 0.3, stilts: 1.6 },
    { id: 'G1', w: 9, d: 7.5, h: 6.6, front: 'G1f', side: 'G1s', roof: 'roofA', roofStyle: 'hip', roofH: 2.8, overhang: 0.9, curve: 0.5, plinth: 0.5, pents: [3.4], pentSides: true },
  ];
  const out = {} as Record<ArchetypeId, HouseArchetype>;
  for (const s of specs) out[s.id as ArchetypeId] = buildHouse(a, s);
  return out;
}
