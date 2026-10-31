import * as THREE from 'three';
import type { Element } from '../core/types';

/**
 * Body markings beyond the Air Nomad tattoo layouts (Tattoo.ts): the designs an airbender's arrows
 * can be drawn in, and face paints / marks from the four nations. Everything is drawn
 * procedurally into one shared texture atlas that the character material samples:
 *
 *  - arrow designs: an arrowhead cell and a repeating shaft cell per design, mapped onto the
 *    tattoo paths (head, arms, legs) in path space — R = main ink, G = second ink
 *  - face paints: a cell per paint in face space (front projection of the head in units of the
 *    half distance between the eyes, eyes at x = ±1, y = 0) — R, G, B = three paint colours,
 *    layered in that order
 *
 * Pure data and canvas drawing; the material and Humanoid wire it in.
 */

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export type ArrowDesign = 'classic' | 'swirl' | 'glyph' | 'glyph_light' | 'filigree' | 'ornate' | 'tribal';

export const ARROW_DESIGNS: Array<{ id: ArrowDesign; name: string; desc: string }> = [
  { id: 'classic', name: 'Classic', desc: 'The plain sky-blue arrow, as the masters of the four temples wear it.' },
  { id: 'swirl', name: 'Swirled', desc: 'A blue arrow filled with curling wind patterns and a darker outline.' },
  { id: 'glyph', name: 'Ink Glyph', desc: 'Dark runic line-work: a ringed spiral in a diamond with wing marks, and a column of runes down the shaft.' },
  { id: 'glyph_light', name: 'Pale Glyph', desc: 'The runic glyphs in fine pale-blue lines edged in blue.' },
  { id: 'filigree', name: 'Filigree', desc: 'An open arrow of mirrored wind scrolls over a falling drop, in light blue edged in blue.' },
  { id: 'ornate', name: 'Ornate', desc: 'A pale arrowhead filled with fine blue filigree.' },
  { id: 'tribal', name: 'Tribal', desc: 'A bold deep-blue arrow with light carved patterns.' },
];

export type FacePaint =
  | 'none'
  | 'air_painted_arrow'
  | 'water_war_paint'
  | 'water_mark_wise'
  | 'water_mark_brave'
  | 'water_mark_trusted'
  | 'earth_kyoshi'
  | 'earth_freedom'
  | 'fire_third_eye'
  | 'fire_painted_lady';

export interface FacePaintDef {
  id: FacePaint;
  name: string;
  nation: Element | 'any';
  desc: string;
  /** Paint colours for the atlas layers R, G, B. */
  colors: [string, string, string];
}

export const FACE_PAINTS: FacePaintDef[] = [
  { id: 'none', name: 'None', nation: 'any', desc: 'A bare face.', colors: ['#000000', '#000000', '#000000'] },
  {
    id: 'air_painted_arrow',
    name: 'Painted Arrow',
    nation: 'air',
    desc: 'A blue arrow painted on the brow, as the Air Acolytes painted theirs: worn in admiration, not earned like a master’s tattoo.',
    colors: ['#3d8fe2', '#000000', '#000000'],
  },
  {
    id: 'water_war_paint',
    name: 'Southern Warrior Paint',
    nation: 'water',
    desc: 'Southern Water Tribe war paint as Sokka wore it: dark grey over the brow down the bridge of the nose, white below the eyes.',
    colors: ['#e7eaee', '#44474f', '#000000'],
  },
  {
    id: 'water_mark_wise',
    name: 'Mark of the Wise',
    nation: 'water',
    desc: 'Painted on the brow after the ice-dodging rite, for the one who steered the boat with wisdom.',
    colors: ['#22406b', '#000000', '#000000'],
  },
  {
    id: 'water_mark_brave',
    name: 'Mark of the Brave',
    nation: 'water',
    desc: 'Painted on the brow after the ice-dodging rite, for the one who faced the ice without fear.',
    colors: ['#22406b', '#000000', '#000000'],
  },
  {
    id: 'water_mark_trusted',
    name: 'Mark of the Trusted',
    nation: 'water',
    desc: 'Painted on the brow after the ice-dodging rite, for the one the crew could rely on.',
    colors: ['#22406b', '#000000', '#000000'],
  },
  {
    id: 'earth_kyoshi',
    name: 'Kyoshi Warrior Makeup',
    nation: 'earth',
    desc: 'The face paint of the Kyoshi Warriors, after Avatar Kyoshi: a white face, red eyeshadow sweeping to the temples, black liner and red lips.',
    colors: ['#f2efe9', '#b51f2b', '#141216'],
  },
  {
    id: 'earth_freedom',
    name: 'Freedom Fighter Paint',
    nation: 'earth',
    desc: 'Red war paint beneath the eyes, as Smellerbee wore it among Jet’s Freedom Fighters.',
    colors: ['#a1271f', '#000000', '#000000'],
  },
  {
    id: 'fire_third_eye',
    name: 'Third Eye',
    nation: 'fire',
    desc: 'The red eye on the forehead of a combustionbender, like P’Li and Combustion Man. It lets you combustionbend: focus, and an exploding beam leaps from your brow.',
    colors: ['#c62a38', '#5c1219', '#ffb0a0'],
  },
  {
    id: 'fire_painted_lady',
    name: 'The Painted Lady',
    nation: 'fire',
    desc: 'The pale face and red markings of the Painted Lady, the river spirit of Jang Hui.',
    colors: ['#f4ebe4', '#b7253a', '#000000'],
  },
];

export function facePaintDef(id: string | undefined): FacePaintDef {
  return FACE_PAINTS.find((p) => p.id === id) ?? FACE_PAINTS[0];
}

/** Face paints a character of `nation` can choose (its own and those of any nation). */
export function facePaintsFor(nation: Element): FacePaintDef[] {
  return FACE_PAINTS.filter((p) => p.nation === nation || p.nation === 'any');
}

// -----------------------------------------------------------------------------
// Atlas layout
// -----------------------------------------------------------------------------

export const ATLAS_SIZE = 1024;
const HEAD_CELL = 128;
const SHAFT_W = 128;
const SHAFT_H = 256;
const SHAFT_Y = HEAD_CELL;
const FACE_CELL = 192;
const FACE_Y = SHAFT_Y + SHAFT_H;
const FACE_COLS = 5;

/**
 * Head cell, in units of the arrowhead: X across (half width 1 at the base), Y along toward the
 * tip (tip at 0, base at −1); the cell spans X ±HX and Y from Y0 to Y1. The shaft cell: X in
 * units of the shaft half width (±SX), Y in periods (two stacked, one sampled from the middle).
 */
export const ARROW_CELL = { HX: 1.33, Y0: -1.5, Y1: 0.1, SX: 1.6 } as const;
/** Face cell: x across (eyes at ±1), y up (eyes at 0), in units of the half distance between the eyes. */
export const FACE_SPACE = { X: 2.6, Y0: -3.2, Y1: 3.0 } as const;

/** Atlas UV rectangle [u0, v0, du, dv] (v down, texture uploaded without flip). */
export type Cell = [number, number, number, number];

const designIndex = (d: ArrowDesign) => Math.max(0, ARROW_DESIGNS.findIndex((x) => x.id === d));

export function arrowHeadCell(d: ArrowDesign): Cell {
  const i = designIndex(d);
  return [(i * HEAD_CELL + 2) / ATLAS_SIZE, 2 / ATLAS_SIZE, (HEAD_CELL - 4) / ATLAS_SIZE, (HEAD_CELL - 4) / ATLAS_SIZE];
}

export function arrowShaftCell(d: ArrowDesign): Cell {
  const i = designIndex(d);
  return [(i * SHAFT_W) / ATLAS_SIZE, SHAFT_Y / ATLAS_SIZE, SHAFT_W / ATLAS_SIZE, SHAFT_H / ATLAS_SIZE];
}

export function facePaintCell(id: FacePaint): Cell {
  const i = Math.max(0, FACE_PAINTS.findIndex((p) => p.id === id) - 1);
  const x = (i % FACE_COLS) * FACE_CELL, y = FACE_Y + Math.floor(i / FACE_COLS) * FACE_CELL;
  return [(x + 3) / ATLAS_SIZE, (y + 3) / ATLAS_SIZE, (FACE_CELL - 6) / ATLAS_SIZE, (FACE_CELL - 6) / ATLAS_SIZE];
}

/** Ink colours of an arrow design from the chosen tattoo colour: [main (R), second (G)]. */
export function arrowInks(d: ArrowDesign, tattoo: string): [THREE.Color, THREE.Color] {
  const base = new THREE.Color(tattoo);
  const light = (k: number) => base.clone().lerp(new THREE.Color(1, 1, 1), k);
  const dark = (k: number) => base.clone().multiplyScalar(k);
  switch (d) {
    case 'swirl':
      return [base.clone(), dark(0.5)];
    case 'glyph':
      return [base.clone(), new THREE.Color('#1b2534')];
    case 'glyph_light':
      return [base.clone(), light(0.55)];
    case 'filigree':
      return [base.clone(), light(0.5)];
    case 'ornate':
      return [light(0.5), dark(0.85)];
    case 'tribal':
      return [light(0.4), dark(0.55)];
    case 'classic':
    default:
      return [base.clone(), base.clone()];
  }
}

// -----------------------------------------------------------------------------
// Drawing
// -----------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
/** Map from design units to canvas pixels. */
type Map2 = (x: number, y: number) => [number, number];
type Layer = 0 | 1 | 2;

/** Each layer of a design: a function drawing that layer's shapes in white (or a colour). */
interface Painter {
  (c: Ctx, m: Map2, layer: Layer, px: number): void;
}

const poly = (c: Ctx, m: Map2, pts: Array<[number, number]>, close = true) => {
  c.beginPath();
  pts.forEach(([x, y], i) => {
    const [px, py] = m(x, y);
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  });
  if (close) c.closePath();
};

const smoothPoly = (c: Ctx, m: Map2, pts: Array<[number, number]>) => {
  // Closed curve through midpoints (quadratic smoothing).
  const P = pts.map(([x, y]) => m(x, y));
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  c.beginPath();
  const s0 = mid(P[P.length - 1], P[0]);
  c.moveTo(s0[0], s0[1]);
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = mid(P[i], P[(i + 1) % P.length]);
    c.quadraticCurveTo(p[0], p[1], q[0], q[1]);
  }
  c.closePath();
};

const line = (c: Ctx, m: Map2, pts: Array<[number, number]>, w: number, px: number) => {
  poly(c, m, pts, false);
  c.lineWidth = w * px;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke();
};

const circle = (c: Ctx, m: Map2, x: number, y: number, r: number, px: number, fill = true, w = 0.06) => {
  const [cx, cy] = m(x, y);
  c.beginPath();
  c.arc(cx, cy, r * px, 0, Math.PI * 2);
  if (fill) c.fill();
  else {
    c.lineWidth = w * px;
    c.stroke();
  }
};

/** A spiral curl (koru) at (x, y) of radius r, turning `dir` (±1), as a polyline. */
const curl = (x: number, y: number, r: number, dir: number, a0 = 0, turns = 1.25): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = a0 + dir * k * turns * Math.PI * 2;
    const rr = r * (1 - 0.82 * k);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  return pts;
};

// --- Arrow designs -------------------------------------------------------------
// Head cell: tip at (0, 0) pointing to +Y; the plain triangle has its base at Y = −1 with half
// width 1; the shaft above it has half width SW. Shaft cell: shaft half width 1, Y in periods.

const SW = 0.39;
const TRI: Array<[number, number]> = [
  [0, 0],
  [-1, -1],
  [1, -1],
];

const headFill = (c: Ctx, m: Map2, k = 1) => {
  poly(c, m, TRI.map(([x, y]) => [x * k, y * k + (k - 1) * 0] as [number, number]));
  c.fill();
  poly(c, m, [
    [-SW, -0.98],
    [SW, -0.98],
    [SW, ARROW_CELL.Y0],
    [-SW, ARROW_CELL.Y0],
  ]);
  c.fill();
};

const triOutline = (c: Ctx, m: Map2, w: number, px: number, inset = 0) => {
  const k = 1 - inset;
  const cy = -1 / 3;
  line(
    c,
    m,
    [...TRI, TRI[0]].map(([x, y]) => [x * k, cy + (y - cy) * k] as [number, number]),
    w,
    px,
  );
};

/** Two sinuous lines braiding along the shaft (period 1). */
const braid = (c: Ctx, m: Map2, w: number, px: number, amp: number, y0: number, y1: number) => {
  for (const ph of [0, Math.PI]) {
    const pts: Array<[number, number]> = [];
    for (let y = y0; y <= y1 + 1e-6; y += 0.02) pts.push([Math.sin(y * Math.PI * 2 + ph) * amp, y]);
    line(c, m, pts, w, px);
  }
};

/**
 * Glyph arrowhead (line-work): a column of runes runs into a diamond holding a ringed spiral, with
 * outward-pointing wing triangles to either side, framed by the arrow's outline; a short stem with
 * cross-ticks carries the point down to the brow.
 */
function glyphHead(c: Ctx, m: Map2, px: number, w: number): void {
  line(c, m, [[-1.12, -1.0], [1.12, -1.0], [0, 0.04], [-1.12, -1.0]], w * 0.75, px);
  line(c, m, [[0, -1.2], [0.42, -0.66], [0, -0.14], [-0.42, -0.66], [0, -1.2]], w, px);
  circle(c, m, 0, -0.66, 0.2, px, false, w * 0.8);
  line(c, m, curl(0, -0.66, 0.13, 1, -Math.PI / 2, 1.0), w * 0.7, px);
  for (const s of [1, -1]) {
    line(c, m, [[0.5 * s, -0.46], [1.3 * s, -0.66], [0.5 * s, -0.86], [0.5 * s, -0.46]], w * 0.85, px);
    circle(c, m, 0.78 * s, -0.66, 0.06, px);
    line(c, m, [[1.3 * s, -0.66], [1.42 * s, -0.66]], w * 0.7, px);
    line(c, m, [[0.62 * s, -1.0], [0.62 * s, -1.12]], w * 0.6, px);
  }
  line(c, m, [[0, -0.14], [0, 0.0]], w * 0.8, px);
  line(c, m, [[-0.1, -0.08], [0.1, -0.08]], w * 0.6, px);
  line(c, m, [[0, -1.2], [0, ARROW_CELL.Y0]], w * 0.8, px);
  line(c, m, [[-0.22, -1.3], [0.22, -1.3]], w * 0.7, px);
  line(c, m, [[-0.18, -1.38], [0, -1.46], [0.18, -1.38]], w * 0.6, px);
}

/** Glyph shaft (period 1): a spine of runes — a crossed box, a barred tick, a ringed dot, a small diamond. */
function glyphShaft(c: Ctx, m: Map2, px: number, w: number): void {
  for (let k = -1; k < 3; k++) {
    line(c, m, [[0, k], [0, k + 0.06]], w, px);
    line(c, m, [[-0.5, k + 0.08], [0.5, k + 0.08], [0.5, k + 0.34], [-0.5, k + 0.34], [-0.5, k + 0.08]], w * 0.85, px);
    line(c, m, [[-0.5, k + 0.08], [0.5, k + 0.34]], w * 0.7, px);
    line(c, m, [[0.5, k + 0.08], [-0.5, k + 0.34]], w * 0.7, px);
    line(c, m, [[0, k + 0.34], [0, k + 0.46]], w, px);
    line(c, m, [[-0.72, k + 0.5], [0.72, k + 0.5]], w * 0.9, px);
    line(c, m, [[-0.72, k + 0.44], [-0.72, k + 0.56]], w * 0.7, px);
    line(c, m, [[0.72, k + 0.44], [0.72, k + 0.56]], w * 0.7, px);
    line(c, m, [[0, k + 0.5], [0, k + 0.58]], w, px);
    circle(c, m, 0, k + 0.68, 0.12, px, false, w * 0.7);
    circle(c, m, 0, k + 0.68, 0.04, px);
    line(c, m, [[0, k + 0.8], [0, k + 0.84]], w, px);
    line(c, m, [[0, k + 0.84], [0.2, k + 0.92], [0, k + 1.0], [-0.2, k + 0.92], [0, k + 0.84]], w * 0.8, px);
  }
}

/**
 * Filigree arrowhead: a fine outline whose top dips where the shaft comes in, two mirrored scrolls
 * curling in from the corners to meet over a small drop above the point, little hooks with dots at
 * the outer corners.
 */
function filigreeHead(c: Ctx, m: Map2, px: number, w: number): void {
  line(c, m, [[-1.12, -1.0], [-0.5, -1.0], [-0.39, -1.1], [-0.39, ARROW_CELL.Y0]], w, px);
  line(c, m, [[1.12, -1.0], [0.5, -1.0], [0.39, -1.1], [0.39, ARROW_CELL.Y0]], w, px);
  line(c, m, [[-1.12, -1.0], [0, 0.02], [1.12, -1.0]], w, px);
  for (const s of [1, -1]) {
    // A scroll from the centre line sweeping out and curling back in.
    const sc: Array<[number, number]> = [[0.04 * s, -0.94], [0.3 * s, -0.95], [0.6 * s, -0.86], [0.74 * s, -0.7]];
    const cu = curl(0.5 * s, -0.66, 0.24, s > 0 ? 1 : -1, s > 0 ? 0 : Math.PI, 1.2);
    line(c, m, [...sc, ...cu], w * 0.9, px);
    line(c, m, curl(0.24 * s, -0.4, 0.12, s > 0 ? -1 : 1, s > 0 ? Math.PI : 0, 1.1), w * 0.75, px);
    line(c, m, [[1.12 * s, -1.0], [1.26 * s, -1.06], [1.3 * s, -0.94]], w * 0.8, px);
    circle(c, m, 1.34 * s, -0.86, 0.05, px);
  }
  smoothPoly(c, m, [
    [0, -0.08],
    [-0.09, -0.26],
    [0, -0.4],
    [0.09, -0.26],
  ]);
  c.fill();
  line(c, m, [[0, -1.0], [0, -0.52]], w * 0.6, px);
  for (const s of [1, -1]) line(c, m, curl(0.2 * s, -1.26, 0.14, s > 0 ? 1 : -1, -Math.PI / 2, 1.0), w * 0.75, px);
}

/** Filigree shaft (period 1): mirrored scroll pairs on a fine spine between fine edges. */
function filigreeShaft(c: Ctx, m: Map2, px: number, w: number): void {
  line(c, m, [[-1, -0.1], [-1, 2.1]], w * 0.6, px);
  line(c, m, [[1, -0.1], [1, 2.1]], w * 0.6, px);
  line(c, m, [[0, -0.1], [0, 2.1]], w * 0.55, px);
  for (let k = -1; k < 3; k++) {
    for (const s of [1, -1]) {
      line(c, m, [[0, k + 0.12], [0.3 * s, k + 0.2], ...curl(0.48 * s, k + 0.48, 0.3, s > 0 ? 1 : -1, s > 0 ? -Math.PI / 2 : -Math.PI / 2, 1.15)], w, px);
    }
    circle(c, m, 0, k + 0.9, 0.07, px);
  }
}

const ARROW_HEAD: Record<ArrowDesign, Painter> = {
  classic: (c, m, layer) => {
    if (layer === 0) headFill(c, m);
  },
  swirl: (c, m, layer, px) => {
    if (layer === 0) headFill(c, m);
    else if (layer === 1) {
      triOutline(c, m, 0.08, px);
      line(c, m, [[-SW, ARROW_CELL.Y0], [-SW, -1]], 0.07, px);
      line(c, m, [[SW, ARROW_CELL.Y0], [SW, -1]], 0.07, px);
      line(c, m, curl(-0.33, -0.72, 0.2, 1, Math.PI), 0.055, px);
      line(c, m, curl(0.33, -0.72, 0.2, -1, 0), 0.055, px);
      line(c, m, curl(0, -0.36, 0.13, 1, -Math.PI / 2), 0.05, px);
      line(c, m, curl(0, -1.25, 0.16, -1, Math.PI / 2), 0.05, px);
    }
  },
  glyph: (c, m, layer, px) => {
    if (layer === 1) glyphHead(c, m, px, 0.075);
  },
  // Pale lines over a slightly wider blue edge, so the fine pale work still reads on skin.
  glyph_light: (c, m, layer, px) => {
    if (layer === 0) glyphHead(c, m, px, 0.085);
    else if (layer === 1) glyphHead(c, m, px, 0.042);
  },
  filigree: (c, m, layer, px) => {
    if (layer === 0) filigreeHead(c, m, px, 0.08);
    else if (layer === 1) filigreeHead(c, m, px, 0.04);
  },
  ornate: (c, m, layer, px) => {
    if (layer === 0) headFill(c, m);
    else if (layer === 1) {
      const w = 0.05;
      triOutline(c, m, w, px);
      line(c, m, curl(-0.42, -0.8, 0.18, 1, Math.PI), w * 0.85, px);
      line(c, m, curl(0.42, -0.8, 0.18, -1, 0), w * 0.85, px);
      line(c, m, [[0, -0.15], [-0.18, -0.45], [0, -0.75], [0.18, -0.45], [0, -0.15]], w * 0.8, px);
      line(c, m, [[0, -0.75], [0, -0.98]], w * 0.7, px);
      braid(c, m, w * 0.8, px, SW * 0.75, ARROW_CELL.Y0, -1.0);
    }
  },
  tribal: (c, m, layer, px) => {
    if (layer === 1) headFill(c, m, 1.06);
    else if (layer === 0) {
      const w = 0.07;
      line(c, m, [[-0.62, -0.88], [0, -0.28], [0.62, -0.88]], w, px);
      line(c, m, [[-0.34, -0.9], [0, -0.56], [0.34, -0.9]], w, px);
      line(c, m, curl(-0.55, -0.62, 0.13, -1, 0), w * 0.8, px);
      line(c, m, curl(0.55, -0.62, 0.13, 1, Math.PI), w * 0.8, px);
      line(c, m, [[0, -1.0], [0, ARROW_CELL.Y0]], w * 0.8, px);
      for (const y of [-1.12, -1.3, -1.48]) line(c, m, [[-0.22, y - 0.07], [0, y], [0.22, y - 0.07]], w * 0.7, px);
    }
  },
};

const ARROW_SHAFT: Record<ArrowDesign, Painter> = {
  classic: (c, m, layer) => {
    if (layer === 0) {
      poly(c, m, [[-1, 0], [1, 0], [1, 2], [-1, 2]]);
      c.fill();
    }
  },
  swirl: (c, m, layer, px) => {
    if (layer === 0) {
      poly(c, m, [[-1, 0], [1, 0], [1, 2], [-1, 2]]);
      c.fill();
    } else if (layer === 1) {
      line(c, m, [[-0.92, -0.1], [-0.92, 2.1]], 0.16, px);
      line(c, m, [[0.92, -0.1], [0.92, 2.1]], 0.16, px);
      for (let k = 0; k < 3; k++) {
        line(c, m, curl(-0.25, k - 0.25, 0.42, 1, Math.PI / 2), 0.12, px);
        line(c, m, curl(0.25, k + 0.25, 0.42, -1, -Math.PI / 2), 0.12, px);
      }
    }
  },
  glyph: (c, m, layer, px) => {
    if (layer === 1) glyphShaft(c, m, px, 0.13);
  },
  glyph_light: (c, m, layer, px) => {
    if (layer === 0) glyphShaft(c, m, px, 0.14);
    else if (layer === 1) glyphShaft(c, m, px, 0.07);
  },
  filigree: (c, m, layer, px) => {
    if (layer === 0) filigreeShaft(c, m, px, 0.13);
    else if (layer === 1) filigreeShaft(c, m, px, 0.065);
  },
  ornate: (c, m, layer, px) => {
    if (layer === 0) {
      poly(c, m, [[-1, 0], [1, 0], [1, 2], [-1, 2]]);
      c.fill();
    } else if (layer === 1) braid(c, m, 0.1, px, 0.72, -0.1, 2.1);
  },
  tribal: (c, m, layer, px) => {
    if (layer === 1) {
      poly(c, m, [[-1.05, 0], [1.05, 0], [1.05, 2], [-1.05, 2]]);
      c.fill();
    } else if (layer === 0) {
      for (let k = -1; k < 3; k++) {
        line(c, m, [[-0.62, k + 0.15], [0, k + 0.55], [0.62, k + 0.15]], 0.15, px);
        line(c, m, [[-0.4, k + 0.62], [0, k + 0.88], [0.4, k + 0.62]], 0.11, px);
      }
    }
  },
};

// --- Face paints ---------------------------------------------------------------
// Face space: eyes at (±1, 0), brows ≈ +0.6, nose tip ≈ −1.0, mouth ≈ −1.6, chin ≈ −2.8.

const mirror = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, y]) => [-x, y]);

const FACE: Record<Exclude<FacePaint, 'none'>, Painter> = {
  air_painted_arrow: (c, m, layer) => {
    if (layer !== 0) return;
    // A painted arrow on the brow: the head points down to the brows, the shaft runs up the forehead.
    smoothPoly(c, m, [
      [0, 0.82],
      [-0.72, 1.72],
      [-0.26, 1.7],
      [-0.24, 3.1],
      [0.27, 3.1],
      [0.25, 1.69],
      [0.73, 1.73],
    ]);
    c.fill();
  },
  water_war_paint: (c, m, layer) => {
    if (layer === 0) {
      // White over the lower face, up to the eyes.
      poly(c, m, [
        [-2.7, 0.75],
        [2.7, 0.75],
        [2.7, -3.3],
        [-2.7, -3.3],
      ]);
      c.fill();
    } else if (layer === 1) {
      // Dark grey over the brow and forehead, coming down the bridge of the nose to its tip.
      const half: Array<[number, number]> = [
        [0, -1.0],
        [0.17, -0.62],
        [0.3, -0.05],
        [0.44, 0.4],
        [0.8, 0.56],
        [1.25, 0.58],
        [1.7, 0.5],
        [2.15, 0.36],
        [2.7, 0.22],
        [2.7, 2.15],
        [1.6, 2.5],
        [0.6, 2.62],
        [0, 2.65],
      ];
      poly(c, m, [...half, ...mirror(half).reverse()]);
      c.fill();
    }
  },
  water_mark_wise: (c, m, layer, px) => {
    if (layer !== 0) return;
    // A crescent cupping a point.
    const pts: Array<[number, number]> = [];
    for (let a = 0; a <= Math.PI + 1e-6; a += Math.PI / 24) pts.push([-Math.cos(a) * 0.5, 1.72 - Math.sin(a) * 0.46]);
    line(c, m, pts, 0.14, px);
    circle(c, m, 0, 1.78, 0.11, px);
  },
  water_mark_brave: (c, m, layer, px) => {
    if (layer !== 0) return;
    // Two rising chevrons over a short stroke.
    line(c, m, [[-0.5, 1.28], [0, 1.78], [0.5, 1.28]], 0.14, px);
    line(c, m, [[-0.34, 1.62], [0, 1.98], [0.34, 1.62]], 0.11, px);
    line(c, m, [[0, 1.35], [0, 1.02]], 0.12, px);
  },
  water_mark_trusted: (c, m, layer, px) => {
    if (layer !== 0) return;
    // Two hooks reaching for each other round a shared point.
    line(c, m, curl(-0.26, 1.5, 0.34, 1, Math.PI, 0.7), 0.13, px);
    line(c, m, curl(0.26, 1.5, 0.34, 1, 0, 0.7), 0.13, px);
    circle(c, m, 0, 1.5, 0.08, px);
  },
  earth_kyoshi: (c, m, layer, px) => {
    if (layer === 0) {
      // White over the whole face up to the hairline.
      smoothPoly(c, m, [
        [0, -3.1],
        [-1.4, -2.75],
        [-2.35, -1.7],
        [-2.75, 0],
        [-2.65, 1.7],
        [-1.8, 2.75],
        [0, 3.05],
        [1.8, 2.75],
        [2.65, 1.7],
        [2.75, 0],
        [2.35, -1.7],
        [1.4, -2.75],
      ]);
      c.fill();
    } else if (layer === 1) {
      // Red eyeshadow sweeping out and up to the temples, and red lips.
      const wing: Array<[number, number]> = [
        [0.5, 0.06],
        [0.72, 0.5],
        [1.2, 0.74],
        [1.75, 0.96],
        [2.32, 1.42],
        [2.15, 0.82],
        [1.85, 0.3],
        [1.5, -0.08],
        [1.1, -0.26],
        [0.72, -0.2],
      ];
      smoothPoly(c, m, wing);
      c.fill();
      smoothPoly(c, m, mirror(wing));
      c.fill();
      const [lx, ly] = m(0, -1.62);
      const [rx] = m(0.6, 0);
      const [, ry] = m(0, -1.62 - 0.2);
      c.beginPath();
      c.ellipse(lx, ly, Math.abs(rx - lx), Math.abs(ry - ly), 0, 0, Math.PI * 2);
      c.fill();
    } else {
      // Black liner along the upper lids, flicked out at the corners.
      for (const s of [1, -1]) {
        line(c, m, [[0.46 * s, 0.16], [0.82 * s, 0.32], [1.25 * s, 0.34], [1.62 * s, 0.4], [2.0 * s, 0.72]], 0.12, px);
        line(c, m, [[0.62 * s, -0.16], [1.0 * s, -0.22], [1.35 * s, -0.16]], 0.06, px);
      }
    }
  },
  earth_freedom: (c, m, layer) => {
    if (layer !== 0) return;
    // A long red stroke under each eye, tapering out over the cheekbone.
    const leaf: Array<[number, number]> = [
      [0.42, -0.36],
      [1.0, -0.3],
      [1.6, -0.2],
      [2.35, 0.12],
      [1.7, -0.5],
      [1.05, -0.66],
      [0.55, -0.6],
    ];
    smoothPoly(c, m, leaf);
    c.fill();
    smoothPoly(c, m, mirror(leaf));
    c.fill();
  },
  fire_third_eye: (c, m, layer, px) => {
    // An upright red eye in the middle of the forehead, as P'Li wore it: a red lens with a dark
    // rim and pupil, dark lines rising from it toward the hairline and one running down between
    // the brows, a bright glint.
    const lens = (k: number): Array<[number, number]> => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const y = 1.46 + Math.sin(a) * 0.5 * k;
        const x = Math.cos(a) * 0.21 * k * Math.sqrt(Math.max(0, 1 - Math.sin(a) ** 2)) * 1.0;
        pts.push([x, y]);
      }
      return pts;
    };
    if (layer === 0) {
      poly(c, m, lens(1));
      c.fill();
    } else if (layer === 1) {
      line(c, m, lens(1), 0.07, px);
      smoothPoly(c, m, [
        [0, 1.3],
        [-0.06, 1.46],
        [0, 1.62],
        [0.06, 1.46],
      ]);
      c.fill();
      line(c, m, [[0, 1.98], [0, 2.55]], 0.07, px);
      for (const s of [1, -1]) {
        line(c, m, [[0.05 * s, 1.94], [0.2 * s, 2.15], [0.3 * s, 2.45]], 0.06, px);
        line(c, m, [[0.1 * s, 1.82], [0.36 * s, 1.96], [0.5 * s, 2.2]], 0.05, px);
      }
      line(c, m, [[0, 0.94], [0, 0.62]], 0.07, px);
      line(c, m, [[0, 0.74], [0.12, 0.6]], 0.05, px);
      line(c, m, [[0, 0.74], [-0.12, 0.6]], 0.05, px);
    } else {
      circle(c, m, 0.06, 1.58, 0.05, px);
    }
  },
  fire_painted_lady: (c, m, layer, px) => {
    if (layer === 0) {
      // A pale wash over the face.
      c.globalAlpha = 0.6;
      smoothPoly(c, m, [
        [0, -3.0],
        [-1.4, -2.7],
        [-2.3, -1.6],
        [-2.65, 0.2],
        [-2.4, 1.9],
        [0, 2.6],
        [2.4, 1.9],
        [2.65, 0.2],
        [2.3, -1.6],
        [1.4, -2.7],
      ]);
      c.fill();
      c.globalAlpha = 1;
    } else if (layer === 1) {
      // A red drop on the brow, red tear-lines from the eyes down the cheeks, red lips.
      smoothPoly(c, m, [
        [0, 0.95],
        [-0.16, 1.32],
        [0, 1.9],
        [0.16, 1.32],
      ]);
      c.fill();
      for (const s of [1, -1]) {
        line(c, m, [[0.62 * s, -0.32], [0.95 * s, -0.62], [1.2 * s, -1.05], [1.32 * s, -1.42]], 0.11, px);
        line(c, m, [[1.3 * s, -0.28], [1.6 * s, -0.55], [1.78 * s, -0.86]], 0.08, px);
      }
      const [lx, ly] = m(0, -1.62);
      const [rx] = m(0.5, 0);
      const [, ry] = m(0, -1.62 - 0.17);
      c.beginPath();
      c.ellipse(lx, ly, Math.abs(rx - lx), Math.abs(ry - ly), 0, 0, Math.PI * 2);
      c.fill();
    }
  },
};

// -----------------------------------------------------------------------------
// Atlas
// -----------------------------------------------------------------------------

const headMap = (x0: number, y0: number, w: number, h: number): Map2 => (x, y) => [x0 + ((x + ARROW_CELL.HX) / (2 * ARROW_CELL.HX)) * w, y0 + ((y - ARROW_CELL.Y0) / (ARROW_CELL.Y1 - ARROW_CELL.Y0)) * h];
const shaftMap = (x0: number, y0: number, w: number, h: number): Map2 => (x, y) => [x0 + ((x + ARROW_CELL.SX) / (2 * ARROW_CELL.SX)) * w, y0 + (y / 2) * h];
const faceMap = (x0: number, y0: number, w: number, h: number): Map2 => (x, y) => [x0 + ((x + FACE_SPACE.X) / (2 * FACE_SPACE.X)) * w, y0 + ((FACE_SPACE.Y1 - y) / (FACE_SPACE.Y1 - FACE_SPACE.Y0)) * h];

/** Draw one layer of a painter into its own canvas (white on black) and copy it into the atlas channel. */
function bake(dst: ImageData, x0: number, y0: number, w: number, h: number, ch: number, paint: (c: Ctx, m: Map2, px: number) => void, map: (x0: number, y0: number, w: number, h: number) => Map2, unitPx: number): void {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  paint(c, map(0, 0, w, h), unitPx);
  const src = c.getImageData(0, 0, w, h).data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = (j * w + i) * 4, d = ((y0 + j) * dst.width + (x0 + i)) * 4;
      dst.data[d + ch] = Math.max(dst.data[d + ch], src[s]);
    }
  }
}

let atlas: THREE.Texture | null = null;

/** The shared markings atlas (built on first use; null where there is no DOM, e.g. unit tests). */
export function markingsAtlas(): THREE.Texture | null {
  if (atlas) return atlas;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_SIZE;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const headPx = HEAD_CELL / (2 * ARROW_CELL.HX);
  const shaftPx = SHAFT_W / (2 * ARROW_CELL.SX);
  ARROW_DESIGNS.forEach((d, i) => {
    for (const layer of [0, 1] as const) {
      bake(img, i * HEAD_CELL + 2, 2, HEAD_CELL - 4, HEAD_CELL - 4, layer, (cc, m, px) => ARROW_HEAD[d.id](cc, m, layer, px), headMap, headPx);
      bake(img, i * SHAFT_W, SHAFT_Y, SHAFT_W, SHAFT_H, layer, (cc, m, px) => ARROW_SHAFT[d.id](cc, m, layer, px), shaftMap, shaftPx);
    }
  });
  FACE_PAINTS.slice(1).forEach((p, i) => {
    const x = (i % FACE_COLS) * FACE_CELL, y = FACE_Y + Math.floor(i / FACE_COLS) * FACE_CELL;
    const unit = (FACE_CELL - 6) / (2 * FACE_SPACE.X);
    for (const layer of [0, 1, 2] as const) bake(img, x + 3, y + 3, FACE_CELL - 6, FACE_CELL - 6, layer, (cc, m, px) => FACE[p.id as Exclude<FacePaint, 'none'>](cc, m, layer, px), faceMap, unit);
  });
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.name = 'markings_atlas';
  atlas = t;
  return t;
}

// -----------------------------------------------------------------------------
// Thumbnails (creator chips)
// -----------------------------------------------------------------------------

/** A small picture of an arrow design on skin (head arrow pointing down to the brow). */
export function arrowThumb(d: ArrowDesign, tattoo: string, skin: string, size = 56): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.fillStyle = skin;
  c.fillRect(0, 0, size, size);
  const [inkA, inkB] = arrowInks(d, tattoo);
  const m = headMap(size * 0.1, 0, size * 0.8, size * 0.92);
  const px = (size * 0.8) / (2 * ARROW_CELL.HX);
  for (const layer of [0, 1] as const) {
    const col = '#' + (layer === 0 ? inkA : inkB).getHexString();
    c.fillStyle = col;
    c.strokeStyle = col;
    ARROW_HEAD[d](c, m, layer, px);
  }
  return cv;
}

/** A small picture of a face paint on a plain face (eyes and mouth sketched in). */
export function facePaintThumb(id: FacePaint, skin: string, size = 56): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#2a211b';
  c.fillRect(0, 0, size, size);
  const m = faceMap(0, 0, size, size);
  const px = size / (2 * FACE_SPACE.X);
  c.fillStyle = skin;
  smoothPoly(c, m, [
    [0, -3.0],
    [-1.5, -2.6],
    [-2.3, -1.4],
    [-2.5, 0.4],
    [-2.2, 2.2],
    [0, 3.0],
    [2.2, 2.2],
    [2.5, 0.4],
    [2.3, -1.4],
    [1.5, -2.6],
  ]);
  c.fill();
  if (id !== 'none') {
    const def = facePaintDef(id);
    for (const layer of [0, 1, 2] as const) {
      c.fillStyle = def.colors[layer];
      c.strokeStyle = def.colors[layer];
      FACE[id as Exclude<FacePaint, 'none'>](c, m, layer, px);
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = '#1a1210';
  for (const s of [1, -1]) {
    const [ex, ey] = m(s, 0);
    c.beginPath();
    c.ellipse(ex, ey, px * 0.36, px * 0.16, 0, 0, Math.PI * 2);
    c.fill();
  }
  return cv;
}
