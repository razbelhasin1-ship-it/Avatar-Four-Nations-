import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, sanitizeAppearance } from '../../src/character/Appearance';
import { ARROW_DESIGNS, FACE_PAINTS, arrowHeadCell, arrowInks, arrowShaftCell, facePaintCell, facePaintsFor } from '../../src/character/Markings';
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
