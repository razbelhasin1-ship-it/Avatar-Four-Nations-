import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, sanitizeAppearance } from '../../src/character/Appearance';
import * as THREE from 'three';
import { ARROW_DESIGNS, FACE_PAINTS, arrowHeadCell, arrowInks, arrowShaftCell, drawFacePaint, facePaintCell, facePaintDef, facePaintsFor, type FacePaint } from '../../src/character/Markings';
import { ELEMENTS } from '../../src/core/types';

describe('markings catalogue', () => {
  it('has seven arrow designs and unique face paints with valid colours', () => {
    expect(ARROW_DESIGNS.map((d) => d.id)).toEqual(['classic', 'swirl', 'glyph', 'glyph_light', 'filigree', 'ornate', 'tribal']);
    const ids = FACE_PAINTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FACE_PAINTS) for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('offers each nation only its own markings (and none)', () => {
    for (const n of ELEMENTS) {
      const list = facePaintsFor(n);
      expect(list[0].id).toBe('none');
      expect(list.length).toBeGreaterThan(1);
      for (const p of list) expect(p.nation === n || p.nation === 'any').toBe(true);
    }
    expect(facePaintsFor('water').map((p) => p.id)).toContain('water_war_paint');
    expect(facePaintsFor('air').map((p) => p.id)).not.toContain('water_war_paint');
  });

  it('keeps atlas cells inside the texture', () => {
    const inside = (c: number[]) => c[0] >= 0 && c[1] >= 0 && c[0] + c[2] <= 1 && c[1] + c[3] <= 1;
    for (const d of ARROW_DESIGNS) {
      expect(inside(arrowHeadCell(d.id))).toBe(true);
      expect(inside(arrowShaftCell(d.id))).toBe(true);
      expect(arrowInks(d.id, '#2f7fd6')).toHaveLength(2);
    }
    for (const p of FACE_PAINTS) expect(inside(facePaintCell(p.id))).toBe(true);
  });

  it('saves round-trip; unknown designs and paints fall back', () => {
    const a = sanitizeAppearance({ ...DEFAULT_APPEARANCE.water, facePaint: 'water_war_paint', arrowDesign: 'filigree' }, DEFAULT_APPEARANCE.water);
    expect(a.facePaint).toBe('water_war_paint');
    expect(a.arrowDesign).toBe('filigree');
    const b = sanitizeAppearance({ ...DEFAULT_APPEARANCE.air, facePaint: 'clown', arrowDesign: 7 }, DEFAULT_APPEARANCE.air);
    expect(b.facePaint ?? 'none').toBe('none');
    expect(b.arrowDesign ?? 'classic').toBe('classic');
    const old = sanitizeAppearance({ ...DEFAULT_APPEARANCE.fire }, DEFAULT_APPEARANCE.fire);
    expect(old.facePaint ?? 'none').toBe('none');
  });
});

/** Filled shapes a face paint layer draws, in face units (eyes at ±1, y up), via a recording context. */
function shapes(id: Exclude<FacePaint, 'none'>, layer: 0 | 1 | 2 = 0): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  const ctx = {
    beginPath: () => (cur = []),
    moveTo: (x: number, y: number) => cur.push([x, y]),
    lineTo: (x: number, y: number) => cur.push([x, y]),
    quadraticCurveTo: (_a: number, _b: number, x: number, y: number) => cur.push([x, y]),
    arc: (x: number, y: number, r: number) => {
      for (let i = 0; i < 16; i++) cur.push([x + Math.cos((i / 16) * Math.PI * 2) * r, y + Math.sin((i / 16) * Math.PI * 2) * r]);
    },
    ellipse: () => undefined,
    closePath: () => undefined,
    fill: () => out.push(cur),
    stroke: () => out.push(cur),
  };
  // Identity map: shapes come back in face units (y up).
  drawFacePaint(id, ctx as unknown as CanvasRenderingContext2D, (x, y) => [x, y], layer, 1);
  return out;
}
const box = (pts: Array<[number, number]>) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  y1: Math.max(...pts.map((p) => p[1])),
});

describe('Southern Water Tribe rite marks (as in "Bato of the Water Tribe")', () => {
  it('Mark of the Trusted: one arc, arched up (∩), centred on the brow below the hairline', () => {
    const s = shapes('water_mark_trusted');
    expect(s).toHaveLength(1);
    const b = box(s[0]);
    expect(Math.abs(b.x0 + b.x1)).toBeLessThan(0.02);
    expect(b.x1).toBeGreaterThan(0.55);
    // The crown (middle) is higher than the tips.
    const mid = s[0].filter((p) => Math.abs(p[0]) < 0.08);
    const tips = s[0].filter((p) => Math.abs(p[0]) > b.x1 - 0.08);
    expect(Math.min(...mid.map((p) => p[1]))).toBeGreaterThan(Math.max(...tips.map((p) => p[1])));
    // Between the brows (~0.6-0.8) and the hairline (~1.55).
    expect(b.y0).toBeGreaterThan(0.9);
    expect(b.y1).toBeLessThan(1.52);
  });

  it('Mark of the Wise: the same arc with a dot centred beneath it', () => {
    const s = shapes('water_mark_wise');
    expect(s).toHaveLength(2);
    expect(box(s[0])).toEqual(box(shapes('water_mark_trusted')[0]));
    const dot = box(s[1]);
    const cx = (dot.x0 + dot.x1) / 2, cy = (dot.y0 + dot.y1) / 2;
    expect(Math.abs(cx)).toBeLessThan(0.01);
    // Under the arc's crown and clear of it.
    const crownLow = Math.min(...s[0].filter((p) => Math.abs(p[0]) < 0.08).map((p) => p[1]));
    expect(dot.y1).toBeLessThan(crownLow - 0.05);
    expect(cy).toBeGreaterThan(0.8);
    expect(dot.x1 - dot.x0).toBeLessThan(0.3);
  });

  it('Mark of the Brave: a crescent moon, thick at the lower left, horns open to the upper right', () => {
    const s = shapes('water_mark_brave');
    expect(s).toHaveLength(1);
    const b = box(s[0]);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    expect(Math.abs(cx)).toBeLessThan(0.08);
    expect(b.x1 - b.x0).toBeGreaterThan(0.5);
    expect(b.y1).toBeLessThan(1.52);
    // The body's mass (its outline points) sits opposite the opening.
    const n = s[0].length;
    const mx = s[0].reduce((a, p) => a + p[0], 0) / n - 0;
    const my = s[0].reduce((a, p) => a + p[1], 0) / n - 1.1;
    expect(mx).toBeLessThan(0);
    expect(my).toBeLessThan(0);
  });

  it('are painted in near-black navy ink, with the show lore in their descriptions', () => {
    for (const [id, words] of [
      ['water_mark_wise', ['dot', 'Sokka']],
      ['water_mark_brave', ['crescent', 'Katara']],
      ['water_mark_trusted', ['without its dot', 'Aang']],
    ] as const) {
      const d = facePaintDef(id);
      const ink = new THREE.Color(d.colors[0]);
      expect(0.2126 * ink.r + 0.7152 * ink.g + 0.0722 * ink.b).toBeLessThan(0.04);
      for (const w of words) expect(d.desc).toContain(w);
    }
  });
});

