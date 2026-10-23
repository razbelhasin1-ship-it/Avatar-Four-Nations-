import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { FireRegion } from './FireRegion';
import { smooth01 } from './geom';
import { basaltMat, bannerDarkMat, crimsonMat, goldMat, ivoryMat } from './materials';
import { brazier, crest, lanternPost, local, roof, wallBanner } from './parts';
import { addFireSpots } from './spots';

/**
 * The Western Causeway: a monumental stone bridge across the Western Strait,
 * from the end of the mainland western_road (y ≈ 1.2) to the start of the
 * island's causeway road (-940, 960, y ≈ 11.2). Long-span semicircular arches
 * on cut-water piers, crimson parapets with gold coping, lantern posts, toll
 * towers with a gate at mid-span and a ceremonial gate at the mainland end.
 * The deck is a chain of walkable ramp colliders following the profile.
 */
export const CAUSEWAY = (() => {
  const a = { x: -772, z: 691 };
  const b = { x: -940, z: 960 };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  return { a, b, len, dir, width: 10, yA: 1.25, yB: 11.2, rampLen: 64, mid: 9.4, hump: 2.2 };
})();

/** Deck top height at distance s from the mainland end. */
export function causewayDeckY(s: number): number {
  const c = CAUSEWAY;
  if (s <= c.rampLen) return c.yA + (c.mid - c.yA) * smooth01(Math.max(0, s) / c.rampLen);
  const t = Math.min(1, (s - c.rampLen) / (c.len - c.rampLen));
  return c.mid + (c.yB - c.mid) * t + c.hump * Math.sin(Math.PI * t);
}

/** World position at distance s along the deck centreline (lateral offset `lat`, + = right of travel). */
export function causewayPoint(s: number, lat = 0): { x: number; z: number; y: number } {
  const c = CAUSEWAY;
  // Right of travel direction (dir.x, dir.z) is (-dir.z, dir.x) rotated… use (dir.z, -dir.x)·(-1) consistently:
  const rx = -c.dir.z, rz = c.dir.x;
  return { x: c.a.x + c.dir.x * s + rx * lat, z: c.a.z + c.dir.z * s + rz * lat, y: causewayDeckY(s) };
}

const SPAN = 22;
const PIER_W = 4;

export class WesternCauseway extends FireRegion {
  readonly id = 'fire_causeway';
  readonly center = { x: (CAUSEWAY.a.x + CAUSEWAY.b.x) / 2, z: (CAUSEWAY.a.z + CAUSEWAY.b.z) / 2 };
  readonly loadRadius = 480;

  protected construct(_ctx: GameContext): void {
    const s = this.layer('bridge', { far: true });
    const d = this.layer('bridge_detail');
    const c = CAUSEWAY;
    const yaw = Math.atan2(-c.dir.z, c.dir.x); // local +X along the bridge (mainland → island)
    const W = c.width;

    // --- Deck: chain of tilted slabs with ramp colliders, parapets on both sides.
    const seg = 5.5;
    const nSeg = Math.ceil(c.len / seg);
    for (let i = 0; i < nSeg; i++) {
      const s0 = (i * c.len) / nSeg, s1 = ((i + 1) * c.len) / nSeg;
      const p0 = causewayPoint(s0), p1 = causewayPoint(s1);
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      const L = s1 - s0;
      const rise = p1.y - p0.y;
      const roll = Math.atan2(rise, L);
      const ym = (p0.y + p1.y) / 2;
      s.box('paving', { x: mx, y: ym - 0.6, z: mz, sx: L + 0.08, sy: 1.2, sz: W, yaw, roll }, { castShadow: false });
      // Ramp collider: top rises along local +X (flip when descending).
      const up = rise >= 0;
      const hy = 0.8 + Math.abs(rise);
      const topHi = Math.max(p0.y, p1.y);
      this.rampCollider(s, mx, topHi - hy, mz, L / 2, hy, W / 2, up ? yaw : yaw + Math.PI, Math.abs(rise));
      // Parapets (visual tilted, collider upright).
      for (const side of [-1, 1]) {
        const o = local(mx, mz, yaw, 0, side * (W / 2 - 0.25));
        s.box(crimsonMat(), { x: o.x, y: ym + 0.5, z: o.z, sx: L + 0.06, sy: 1.0, sz: 0.5, yaw, roll });
        s.box(goldMat(), { x: o.x, y: ym + 1.04, z: o.z, sx: L + 0.06, sy: 0.08, sz: 0.62, yaw, roll }, { castShadow: false });
        s.collider({ shape: 'box', x: o.x, y: Math.min(p0.y, p1.y) + (Math.abs(rise) + 1.1) / 2, z: o.z, hx: L / 2, hy: (Math.abs(rise) + 1.1) / 2, hz: 0.25, yaw, walkable: false, solid: true });
      }
      // Fascia (ivory edge beam under the parapet).
      for (const side of [-1, 1]) {
        const o = local(mx, mz, yaw, 0, side * (W / 2 + 0.05));
        s.box(ivoryMat(), { x: o.x, y: ym - 0.75, z: o.z, sx: L + 0.06, sy: 1.1, sz: 0.3, yaw, roll }, { castShadow: false });
      }
    }

    // --- Piers and arches over the water.
    const nSpans = Math.floor((c.len - 20) / SPAN);
    const s0 = (c.len - nSpans * SPAN) / 2;
    for (let k = 0; k <= nSpans; k++) {
      const sp = s0 + k * SPAN;
      const p = causewayPoint(sp);
      const under = p.y - 1.2;
      // Pier: basalt shaft with cut-waters at both ends (across the bridge).
      s.box(basaltMat(), { x: p.x, y: (under - 18) / 2, z: p.z, sx: PIER_W, sy: under + 18, sz: W + 1.2, yaw });
      for (const side of [-1, 1]) {
        const cw = local(p.x, p.z, yaw, 0, side * (W / 2 + 0.6));
        s.box(basaltMat(), { x: cw.x, y: (Math.min(under, 4) - 18) / 2, z: cw.z, sx: PIER_W * 0.72, sy: Math.min(under, 4) + 18, sz: PIER_W * 0.72, yaw: yaw + Math.PI / 4 });
      }
      s.box(crimsonMat(), { x: p.x, y: 1.4, z: p.z, sx: PIER_W + 0.1, sy: 0.6, sz: W + 1.3, yaw });
      s.collider({ shape: 'box', x: p.x, y: (under - 18) / 2, z: p.z, hx: PIER_W / 2, hy: (under + 18) / 2, hz: (W + 2) / 2, yaw, walkable: true, solid: true });
      // Arch panel to the next pier (where the deck is high enough for a real arch).
      if (k < nSpans) {
        const q = causewayPoint(sp + SPAN);
        const uA = p.y - 1.2, uB = q.y - 1.2;
        const R = (SPAN - PIER_W) / 2;
        const uMin = Math.min(uA, uB);
        if (uMin > 4.5) {
          const spring = Math.min(uMin - R - 0.6, 1.0);
          const geo = archPanel(SPAN, R, spring, uA, uB, W - 0.2);
          const mid = causewayPoint(sp + SPAN / 2);
          s.mesh('stone_tan', geo, { x: mid.x, y: 0, z: mid.z, yaw });
          geo.dispose();
        } else {
          // Low ramp spans: a plain beam.
          const mid = causewayPoint(sp + SPAN / 2);
          s.box('stone_tan', { x: mid.x, y: (uA + uB) / 2 - 0.6, z: mid.z, sx: SPAN, sy: 1.2, sz: W - 0.2, yaw, roll: Math.atan2(uB - uA, SPAN) });
        }
      }
      // Lantern posts on alternating sides at every pier.
      const lat = (k % 2 === 0 ? 1 : -1) * (W / 2 - 0.9);
      const lp = causewayPoint(sp, lat);
      lanternPost(d, { x: lp.x, y: lp.y, z: lp.z, yaw: yaw + (lat > 0 ? Math.PI / 2 : -Math.PI / 2), h: 3.6 });
    }

    // --- Toll towers at mid-span (gateway over the road) and the mainland gate.
    this.tollGate(s, d, c.len * 0.5, yaw, true);
    this.tollGate(s, d, 9, yaw, false);
  }

  private rampCollider(b: ContentBuilder, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, slopeRise: number): void {
    b.collider({ shape: 'box', x, y, z, hx, hy, hz, yaw, slopeRise: slopeRise > 0.01 ? slopeRise : undefined, walkable: true, solid: true, surface: 'stone' });
  }

  /** Twin towers flanking the deck joined by a roofed gate beam (road passes beneath). */
  private tollGate(s: ContentBuilder, d: ContentBuilder, sAlong: number, yaw: number, big: boolean): void {
    const W = CAUSEWAY.width;
    const p = causewayPoint(sAlong);
    const tw = big ? 6 : 3.2;
    const th = big ? 15 : 9;
    const off = W / 2 + tw / 2 + (big ? 0.4 : 0.2);
    for (const side of [-1, 1]) {
      const t = local(p.x, p.z, yaw, 0, side * off);
      const base = big ? -18 : p.y - 3;
      s.block(basaltMat(), { x: t.x, y: base, z: t.z, sx: tw + 1, sy: p.y - base + 0.8, sz: tw + 1, yaw }, { collide: true, walkable: true });
      s.block(crimsonMat(), { x: t.x, y: p.y + 0.8, z: t.z, sx: tw, sy: th, sz: tw, yaw }, { collide: true, walkable: false });
      s.box(goldMat(), { x: t.x, y: p.y + th * 0.6, z: t.z, sx: tw + 0.12, sy: 0.16, sz: tw + 0.12, yaw }, { castShadow: false });
      s.box('black_lacquer', { x: t.x, y: p.y + 0.8 + th - 0.5, z: t.z, sx: tw + 0.2, sy: 1.0, sz: tw + 0.2, yaw });
      roof(s, { x: t.x, y: p.y + 0.8 + th, z: t.z, w: tw, d: tw, h: big ? 3.2 : 1.8, style: 'pyramid', yaw, mat: 'roof_dark', overhang: big ? 1.4 : 0.8, curve: 0.9, tips: big ? 1 : 0.6, finial: big ? 2.2 : 1.2 });
      if (big) {
        for (const f of [-1, 1]) {
          const bp = local(t.x, t.z, yaw, f * (tw / 2 + 0.1), 0);
          wallBanner(d, { x: bp.x, y: p.y + th - 1.5, z: bp.z, yaw: yaw + (f > 0 ? Math.PI / 2 : -Math.PI / 2), w: 2.4, len: 6.5, mat: bannerDarkMat() });
        }
        const br = local(p.x, p.z, yaw, -6, side * (W / 2 - 1.2));
        brazier(d, this.flames, { x: br.x, y: causewayDeckY(sAlong - 6), z: br.z, size: 1.1 });
      }
    }
    // Gate beam with a roof spanning the road (clearance ≥ 7 m).
    const beamY = p.y + (big ? 8.5 : 6.2);
    const span = 2 * off + tw;
    s.box('black_lacquer', { x: p.x, y: beamY, z: p.z, sx: big ? 2.4 : 1.2, sy: 1.4, sz: span, yaw });
    s.box(crimsonMat(), { x: p.x, y: beamY + 1.3, z: p.z, sx: big ? 2 : 1, sy: 1.2, sz: span - 2, yaw });
    roof(s, { x: p.x, y: beamY + 1.9, z: p.z, w: span - 1, d: big ? 4 : 2.2, h: big ? 2.6 : 1.4, yaw: yaw + Math.PI / 2, mat: 'roof_dark', overhang: big ? 1.2 : 0.7, curve: 0.8, horns: big ? 1.4 : 0.8, tips: big ? 0.8 : 0.5, crest: big ? 1.2 : 0 });
    for (const f of [-1, 1]) {
      const cp = local(p.x, p.z, yaw, f * (big ? 1.25 : 0.65), 0);
      crest(s, { x: cp.x, y: beamY + 1.3, z: cp.z, yaw: yaw + (f > 0 ? Math.PI / 2 : -Math.PI / 2), size: big ? 1.6 : 0.9 });
    }
  }
}

/**
 * Spandrel panel of one arch: a slab between two piers (local X along the
 * bridge, centred), from the springing line up to the deck underside, with a
 * semicircular opening of radius R. Extruded across the bridge (local Z).
 */
function archPanel(span: number, R: number, spring: number, uA: number, uB: number, depth: number): THREE.BufferGeometry {
  const h = span / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h, spring - 0.6);
  shape.lineTo(-R, spring - 0.6);
  shape.lineTo(-R, spring);
  // Arch intrados from left to right (over the top).
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    shape.lineTo(Math.cos(a) * R, spring + Math.sin(a) * R);
  }
  shape.lineTo(R, spring - 0.6);
  shape.lineTo(h, spring - 0.6);
  shape.lineTo(h, uB - 0.05);
  shape.lineTo(-h, uA - 0.05);
  shape.lineTo(-h, spring - 0.6);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

addFireSpots({
  bridge_western_causeway: { ...pick(causewayPoint(CAUSEWAY.len * 0.5 + 8)), yaw: Math.atan2(CAUSEWAY.dir.x, CAUSEWAY.dir.z), r: 4, label: 'Western Causeway toll gate', region: 'fire_nation_capital' },
  viewpoint_western_causeway: { ...pick(causewayPoint(CAUSEWAY.len * 0.3)), yaw: Math.atan2(CAUSEWAY.dir.x, CAUSEWAY.dir.z), r: 4, label: 'Western Causeway', region: 'fire_nation_capital' },
});

function pick(p: { x: number; z: number; y: number }): { x: number; z: number; y: number } {
  return { x: p.x, z: p.z, y: p.y };
}
