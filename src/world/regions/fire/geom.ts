import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry generators for Fire Nation architecture and props. Everything is
 * built procedurally with modest triangle counts (city-scale repetition) and
 * returned as plain BufferGeometry (position/normal/uv) ready for the kit's
 * ContentBuilder.mesh()/instance().
 *
 * Conventions: Y up, local +Z = front. Unless stated, geometry is centred on
 * the origin in XZ with its base at y = 0.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface RoofOptions {
  /** 'hip' (four slopes), 'gable' (two slopes + gable ends), 'pyramid' (square hip, single apex). */
  style?: 'hip' | 'gable' | 'pyramid';
  /** Upturn of the eave corners (m). */
  curve?: number;
  /** Concavity exponent of the slope profile (1 = straight). */
  sag?: number;
  /** Tile layer thickness (m) — soffit offset & fascia band height. */
  thickness?: number;
  segU?: number;
  segT?: number;
}

export interface RoofGeo {
  /** Tiled top + soffit (use a roof material, UVs in metres/2). */
  tiles: THREE.BufferGeometry;
  /** Eave fascia band around the perimeter (gold / lacquer trim). */
  fascia: THREE.BufferGeometry;
}

/**
 * Curved East-Asian roof. Footprint w (X) × d (Z) INCLUDING overhang, eaves at
 * y = 0, ridge at y = h. Corners sweep up by `curve`.
 */
export function roofGeo(w: number, d: number, h: number, o: RoofOptions = {}): RoofGeo {
  const style = o.style ?? 'hip';
  const curve = o.curve ?? 0.6;
  const sag = o.sag ?? 1.5;
  const th = o.thickness ?? 0.3;
  const segU = o.segU ?? 6;
  const segT = o.segT ?? 4;
  const hw = w / 2, hd = d / 2;
  const ridgeHalf = style === 'gable' ? hw : style === 'pyramid' ? 0 : Math.max(0, hw - hd);
  const lift = (t: number, c: number) => h * Math.pow(t, sag) + curve * (1 - t) * (1 - t) * c;
  const cornerness = (u: number) => Math.pow(Math.abs(u - 0.5) * 2, 5);

  const tp: number[] = [], tu: number[] = [], ti: number[] = [];
  const fp: number[] = [], fu: number[] = [], fi: number[] = [];

  const face = (P: (u: number, t: number) => [number, number, number], uLen: number, vLen: number, outward: THREE.Vector3) => {
    // Top (outward) and soffit (inward) grids.
    for (const layer of [0, 1]) {
      const base = tp.length / 3;
      for (let j = 0; j <= segT; j++) {
        for (let i = 0; i <= segU; i++) {
          const u = i / segU, t = j / segT;
          const p = P(u, t);
          tp.push(p[0], p[1] - layer * th, p[2]);
          tu.push((u * uLen) / 2, (t * vLen) / 2);
        }
      }
      // Determine winding from the first quad.
      const a = new THREE.Vector3(tp[base * 3], tp[base * 3 + 1], tp[base * 3 + 2]);
      const bI = base + 1, cI = base + segU + 1;
      const b = new THREE.Vector3(tp[bI * 3], tp[bI * 3 + 1], tp[bI * 3 + 2]);
      const c = new THREE.Vector3(tp[cI * 3], tp[cI * 3 + 1], tp[cI * 3 + 2]);
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      let flip = n.dot(outward) < 0;
      if (layer === 1) flip = !flip;
      for (let j = 0; j < segT; j++) {
        for (let i = 0; i < segU; i++) {
          const q0 = base + j * (segU + 1) + i;
          const q1 = q0 + 1, q2 = q0 + segU + 1, q3 = q2 + 1;
          if (!flip) ti.push(q0, q1, q2, q1, q3, q2);
          else ti.push(q0, q2, q1, q1, q2, q3);
        }
      }
    }
    // Fascia band along the eave (t = 0) edge.
    const fb = fp.length / 3;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const p = P(u, 0);
      fp.push(p[0], p[1] + 0.02, p[2], p[0], p[1] - th - 0.05, p[2]);
      fu.push((u * uLen) / 2, 0, (u * uLen) / 2, 0.3);
    }
    const a = new THREE.Vector3(fp[fb * 3], fp[fb * 3 + 1], fp[fb * 3 + 2]);
    const b = new THREE.Vector3(fp[(fb + 2) * 3], fp[(fb + 2) * 3 + 1], fp[(fb + 2) * 3 + 2]);
    const c = new THREE.Vector3(fp[(fb + 1) * 3], fp[(fb + 1) * 3 + 1], fp[(fb + 1) * 3 + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const out2 = new THREE.Vector3(outward.x, 0, outward.z);
    const flip = n.dot(out2) < 0;
    for (let i = 0; i < segU; i++) {
      const q0 = fb + i * 2, q1 = q0 + 1, q2 = q0 + 2, q3 = q0 + 3;
      if (!flip) fi.push(q0, q2, q1, q1, q2, q3);
      else fi.push(q0, q1, q2, q1, q3, q2);
    }
  };

  for (const side of [1, -1]) {
    face(
      (u, t) => {
        const xe = -hw + u * w;
        const xr = Math.max(-ridgeHalf, Math.min(ridgeHalf, xe));
        return [xe + (xr - xe) * t, lift(t, cornerness(u)), side * hd * (1 - t)];
      },
      w,
      Math.hypot(hd, h),
      new THREE.Vector3(0, 0.6, side),
    );
  }
  if (style !== 'gable') {
    for (const side of [1, -1]) {
      face(
        (u, t) => {
          const ze = -hd + u * d;
          return [side * (hw + (ridgeHalf - hw) * t), lift(t, cornerness(u)), ze * (1 - t)];
        },
        d,
        Math.hypot(hw - ridgeHalf, h),
        new THREE.Vector3(side, 0.6, 0),
      );
    }
  } else {
    // Gable end triangles, slightly inset under the roof.
    for (const side of [1, -1]) {
      const base = tp.length / 3;
      const x = side * hw * 0.97;
      tp.push(x, -th, -hd * 0.92, x, -th, hd * 0.92, x, h * 0.96 - th, 0);
      tu.push(0, 0, d / 2, 0, d / 4, h / 2);
      if (side > 0) ti.push(base, base + 2, base + 1);
      else ti.push(base, base + 1, base + 2);
    }
  }
  const tiles = new THREE.BufferGeometry();
  tiles.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tiles.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  tiles.setIndex(ti);
  tiles.computeVertexNormals();
  const fascia = new THREE.BufferGeometry();
  fascia.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fascia.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
  fascia.setIndex(fi);
  fascia.computeVertexNormals();
  return { tiles, fascia };
}

/** Corner positions of the eaves (for placing upturned gold tips). */
export function roofCorners(w: number, d: number, curve: number): Array<[number, number, number]> {
  const hw = w / 2, hd = d / 2;
  return [
    [hw, curve * 0.8, hd],
    [-hw, curve * 0.8, hd],
    [hw, curve * 0.8, -hd],
    [-hw, curve * 0.8, -hd],
  ];
}

// ---------------------------------------------------------------------------
// Tubes & ornaments
// ---------------------------------------------------------------------------

/** Tube along a smooth curve with radius tapering from r0 to r1 (end capped). */
export function taperTube(points: THREE.Vector3[], r0: number, r1: number, radial = 6, tubular = 14): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a), sx = Math.sin(a);
      pos.push(p.x + r * (cx * N.x + sx * B.x), p.y + r * (cx * N.y + sx * B.y), p.z + r * (cx * N.z + sx * B.z));
      uv.push(j / radial, t * 2);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // End cap (point).
  curve.getPointAt(1, p);
  const tip = pos.length / 3;
  pos.push(p.x, p.y, p.z);
  uv.push(0.5, 2);
  const last = tubular * (radial + 1);
  for (let j = 0; j < radial; j++) idx.push(last + j, tip, last + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Curled ridge horn (Fire Nation ridge-end ornament). Starts at the origin and
 * sweeps outward along +X, rises and curls back over itself. Height ≈ 1.
 */
export function hornGeo(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(-0.15, 0, 0),
    new THREE.Vector3(0.18, 0.1, 0),
    new THREE.Vector3(0.38, 0.42, 0),
    new THREE.Vector3(0.34, 0.8, 0),
    new THREE.Vector3(0.12, 1.0, 0),
    new THREE.Vector3(-0.1, 0.92, 0),
    new THREE.Vector3(-0.14, 0.74, 0),
  ];
  return taperTube(pts, 0.16, 0.035, 6, 16);
}

/** Small upturned eave-corner tip (points along +X and up). Length ≈ 1. */
export function eaveTipGeo(): THREE.BufferGeometry {
  const pts = [new THREE.Vector3(-0.3, -0.05, 0), new THREE.Vector3(0.25, 0.02, 0), new THREE.Vector3(0.6, 0.25, 0), new THREE.Vector3(0.72, 0.55, 0)];
  return taperTube(pts, 0.09, 0.02, 5, 8);
}

/** Fire Nation flame emblem outline (unit height ≈ 1.1, base at y=0). */
export function flameShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.3, 0, 0.47, 0.12, 0.47, 0.32);
  s.bezierCurveTo(0.47, 0.5, 0.38, 0.62, 0.3, 0.78);
  s.bezierCurveTo(0.26, 0.66, 0.22, 0.58, 0.16, 0.52);
  s.bezierCurveTo(0.2, 0.74, 0.14, 0.95, 0.04, 1.14);
  s.bezierCurveTo(-0.04, 0.95, -0.16, 0.8, -0.17, 0.55);
  s.bezierCurveTo(-0.22, 0.6, -0.27, 0.66, -0.32, 0.74);
  s.bezierCurveTo(-0.42, 0.6, -0.47, 0.48, -0.47, 0.32);
  s.bezierCurveTo(-0.47, 0.12, -0.3, 0, 0, 0);
  // Inner tongue cut-out so the crest reads as an emblem, not a blob.
  const hole = new THREE.Path();
  hole.moveTo(0, 0.12);
  hole.bezierCurveTo(0.16, 0.12, 0.24, 0.22, 0.22, 0.34);
  hole.bezierCurveTo(0.2, 0.46, 0.08, 0.52, 0.02, 0.72);
  hole.bezierCurveTo(-0.06, 0.52, -0.2, 0.46, -0.22, 0.34);
  hole.bezierCurveTo(-0.24, 0.22, -0.16, 0.12, 0, 0.12);
  s.holes.push(hole);
  return s;
}

/** Extruded flame emblem facing +Z (depth along Z, centred). */
export function flameEmblemGeo(depth = 0.12): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(flameShape(), { depth, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Flame finial in the round: two crossed emblems (for rooftops / tower crowns). */
export function flameFinialGeo(): THREE.BufferGeometry {
  const a = flameEmblemGeo(0.14);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b], false)!;
  a.dispose();
  b.dispose();
  return g;
}

/** Ring band (flat annulus extruded along Z) — crest frames, sun discs. */
export function ringGeo(rOuter: number, rInner: number, depth: number, seg = 32): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, rInner, 0, Math.PI * 2, true);
  s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Sun disc with triangular rays (Sun Warriors), facing +Z. */
export function sunDiscGeo(r: number, rays = 16, depth = 0.4): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const n = rays * 2;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i % 2 === 0 ? r * 1.32 : r * 1.02;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Brazier bowl (open lathe) — rim radius ≈ 1, height ≈ 0.6, base at y=0. */
export function brazierBowlGeo(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0),
    new THREE.Vector2(0.35, 0.02),
    new THREE.Vector2(0.45, 0.12),
    new THREE.Vector2(0.78, 0.38),
    new THREE.Vector2(1.0, 0.58),
    new THREE.Vector2(1.06, 0.66),
    new THREE.Vector2(0.96, 0.64),
    new THREE.Vector2(0.75, 0.46),
  ];
  return new THREE.LatheGeometry(pts, 14);
}

/** Octagonal column with base and capital, height 1 (scale Y), radius 1 (scale XZ). */
export function columnGeo(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.88, 0.94, 0.86, 8, 1, true);
  shaft.translate(0, 0.5, 0);
  const base = new THREE.CylinderGeometry(1.15, 1.25, 0.07, 8);
  base.translate(0, 0.035, 0);
  const cap = new THREE.CylinderGeometry(1.2, 1.0, 0.07, 8);
  cap.translate(0, 0.965, 0);
  return mergeGeometries([ni(shaft), ni(base), ni(cap)], false)!;
}

/** Stylised Japanese-black-pine: trunk geometry (tapered, leaning) for a tree ~1 tall. */
export function pineTrunkGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const lean = r() * 0.25 + 0.05;
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.3, 0.3, 0.05), new THREE.Vector3(lean, 0.62, -0.05), new THREE.Vector3(lean * 0.6, 0.95, 0)];
  return taperTube(pts, 0.06, 0.02, 5, 6);
}

/** Pine foliage pads: flattened lumpy discs at several heights (tree ~1 tall). */
export function pineCanopyGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  const pads = 4 + Math.floor(r() * 2);
  for (let i = 0; i < pads; i++) {
    const t = i / (pads - 1);
    const y = 0.42 + t * 0.55;
    const rad = 0.42 - t * 0.22 + r() * 0.08;
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitter(g, 0.18, seed + i * 7);
    g.scale(rad, rad * 0.32, rad * (0.8 + r() * 0.3));
    const a = r() * Math.PI * 2;
    const off = (1 - t) * 0.22;
    g.translate(Math.cos(a) * off + 0.08, y, Math.sin(a) * off);
    parts.push(ni(g));
  }
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeVertexNormals();
  return out;
}

/** Round broadleaf canopy (maple / garden tree), ~1 tall total with trunk handled separately. */
export function roundCanopyGeo(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = mulberry(seed);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    jitter(g, 0.15, seed * 3 + i);
    const s = 0.3 + r() * 0.12;
    g.scale(s, s * 0.85, s);
    g.translate((r() - 0.5) * 0.3, 0.7 + r() * 0.15, (r() - 0.5) * 0.3);
    parts.push(ni(g));
  }
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeVertexNormals();
  return out;
}

/** Simple straight trunk (tapered cylinder) of height 1. */
export function trunkGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.035, 0.06, 1, 6);
  g.translate(0, 0.5, 0);
  return g;
}

/** Weeping willow canopy: a dome with hanging curtain strips (double-sided material). */
export function willowCanopyGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  const dome = new THREE.IcosahedronGeometry(1, 1);
  jitter(dome, 0.12, seed);
  dome.scale(0.42, 0.22, 0.42);
  dome.translate(0, 0.86, 0);
  parts.push(ni(dome));
  const strips = 14;
  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * Math.PI * 2 + r() * 0.2;
    const len = 0.5 + r() * 0.2;
    const p = new THREE.PlaneGeometry(0.16, len, 1, 2);
    p.translate(0, -len / 2, 0);
    // Slight outward splay at the bottom.
    const pos = p.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setZ(k, pos.getZ(k) + (-y / len) * 0.08);
    }
    p.rotateY(-a + Math.PI / 2);
    p.translate(Math.cos(a) * 0.38, 0.9, Math.sin(a) * 0.38);
    parts.push(ni(p));
  }
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeVertexNormals();
  return out;
}

/** Palm: curved trunk (height ~1). */
export function palmTrunkGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const bend = 0.12 + r() * 0.12;
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend * 0.2, 0.35, 0), new THREE.Vector3(bend * 0.7, 0.7, 0), new THREE.Vector3(bend, 1, 0)];
  return taperTube(pts, 0.045, 0.028, 6, 8);
}

/** Palm fronds radiating from (bend, 1, 0) — matches palmTrunkGeo(seed). */
export function palmFrondsGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const bend = 0.12 + r() * 0.12;
  const parts: THREE.BufferGeometry[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3;
    const len = 0.42 + r() * 0.12;
    // Frond: a strip that arcs down.
    const segs = 4;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const x = t * len;
      const y = 0.1 * t - 0.32 * t * t;
      const w = 0.09 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05));
      pos.push(x, y, -w, x, y, w);
      if (k < segs) {
        const b = k * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.rotateY(a);
    g.translate(bend, 1, 0);
    const ng = ni(g);
    ng.computeVertexNormals();
    parts.push(ng);
  }
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return out;
}

/** Fern / jungle bush clump (~1 across). */
export function bushGeo(seed: number): THREE.BufferGeometry {
  const r = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    jitter(g, 0.2, seed + i);
    const s = 0.28 + r() * 0.15;
    g.scale(s, s * 0.7, s);
    g.translate((r() - 0.5) * 0.5, s * 0.5, (r() - 0.5) * 0.5);
    parts.push(ni(g));
  }
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeVertexNormals();
  return out;
}

/** Irregular rock (unit size). */
export function rockGeo(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  jitter(g, 0.28, seed);
  const ng = ni(g);
  ng.computeVertexNormals();
  return ng;
}

/**
 * Coiled dragon statue (stone or gold), on its own (no pedestal), height ≈ 1,
 * facing +Z. The body spirals up a column of air and the head rears forward.
 */
export function dragonGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const turns = 1.4;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2 + Math.PI;
    const rad = 0.24 * (1 - t * 0.45);
    pts.push(new THREE.Vector3(Math.sin(a) * rad, 0.06 + t * 0.62, Math.cos(a) * rad));
  }
  // Neck rearing forward.
  pts.push(new THREE.Vector3(0.02, 0.78, 0.12));
  pts.push(new THREE.Vector3(0, 0.86, 0.26));
  const body = taperTube(pts, 0.085, 0.05, 7, 40);
  const head = new THREE.BoxGeometry(0.13, 0.11, 0.24);
  head.translate(0, 0.9, 0.36);
  const jaw = new THREE.BoxGeometry(0.1, 0.04, 0.18);
  jaw.rotateX(0.35);
  jaw.translate(0, 0.83, 0.38);
  const hornL = taperTube([new THREE.Vector3(0.04, 0.94, 0.3), new THREE.Vector3(0.08, 1.02, 0.2), new THREE.Vector3(0.1, 1.06, 0.1)], 0.02, 0.006, 4, 5);
  const hornR = hornL.clone().scale(-1, 1, 1);
  const tail = taperTube([new THREE.Vector3(0, 0.06, -0.24), new THREE.Vector3(-0.18, 0.03, -0.3), new THREE.Vector3(-0.32, 0.05, -0.2), new THREE.Vector3(-0.38, 0.12, -0.05)], 0.06, 0.01, 6, 8);
  const parts = [ni(body), ni(head), ni(jaw), ni(hornL), flipWinding(hornR), ni(tail)];
  const out = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  out.computeVertexNormals();
  return out;
}

/** Turtle-duck: shell + head + tail (~0.5 long, facing +Z, waterline at y=0). */
export function turtleDuckGeo(): { shell: THREE.BufferGeometry; body: THREE.BufferGeometry } {
  const shell = new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(1, 0.75, 1.2);
  const head = new THREE.SphereGeometry(0.08, 6, 5);
  head.translate(0, 0.17, 0.25);
  const neck = new THREE.CylinderGeometry(0.04, 0.05, 0.14, 5);
  neck.rotateX(-0.6);
  neck.translate(0, 0.1, 0.2);
  const beak = new THREE.ConeGeometry(0.035, 0.08, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.16, 0.34);
  const body = mergeGeometries([ni(head), ni(neck), ni(beak)], false)!;
  return { shell, body };
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

/**
 * Fire Navy steam ship hull: lofted cross-sections with a raked bow and a
 * square stern. Length L along +Z (bow at +Z), beam B, hull height H above the
 * keel (deck at y = H). Waterline is chosen by the caller (place the hull so
 * y = draft sits at sea level).
 */
export function hullGeo(L: number, B: number, H: number): THREE.BufferGeometry {
  const stations = 12;
  const ring = 9; // points per half section incl. deck edge
  const pos: number[] = [];
  const idx: number[] = [];
  const sections: number[][] = [];
  for (let s = 0; s <= stations; s++) {
    const t = s / stations; // 0 stern .. 1 bow
    const z = -L / 2 + t * L;
    // Beam narrows toward the bow (and a little at the stern).
    const bow = t > 0.62 ? Math.pow((t - 0.62) / 0.38, 1.6) : 0;
    const half = (B / 2) * (1 - bow * 0.97) * (t < 0.08 ? 0.86 + t * 1.75 : 1);
    // Keel rises at the bow (rake) and stern.
    const keel = t > 0.75 ? Math.pow((t - 0.75) / 0.25, 2) * H * 0.75 : t < 0.06 ? (0.06 - t) * H * 4 : 0;
    const sec: number[] = [];
    for (let k = 0; k <= ring; k++) {
      const a = k / ring; // 0 keel centre .. 1 deck edge
      const ang = a * Math.PI * 0.5;
      const x = half * Math.sin(ang) * (a > 0.85 ? 1.02 : 1);
      const y = keel + (H - keel) * (1 - Math.cos(ang) * (a < 1 ? 1 : 1)) * (a < 0.999 ? 1 : 1);
      sec.push(x, Math.min(H, y), z);
    }
    sections.push(sec);
  }
  // Build both sides.
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (const sec of sections) for (let k = 0; k <= ring; k++) pos.push(sec[k * 3] * side, sec[k * 3 + 1], sec[k * 3 + 2]);
    for (let s = 0; s < stations; s++) {
      for (let k = 0; k < ring; k++) {
        const a = base + s * (ring + 1) + k, b = a + ring + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  // Deck (top) surface.
  const deckBase = pos.length / 3;
  for (const sec of sections) {
    const x = sec[ring * 3], y = H, z = sec[ring * 3 + 2];
    pos.push(-x, y, z, x, y, z);
  }
  for (let s = 0; s < stations; s++) {
    const a = deckBase + s * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // Transom (stern plate).
  const st = sections[0];
  const tb = pos.length / 3;
  for (let k = 0; k <= ring; k++) pos.push(st[k * 3], st[k * 3 + 1], st[k * 3 + 2], -st[k * 3], st[k * 3 + 1], st[k * 3 + 2]);
  for (let k = 0; k < ring; k++) {
    const a = tb + k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = ni(g);
  ng.computeVertexNormals();
  return ng;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

export function mulberry(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radially jitter the vertices of a (unit-ish) geometry. Shared vertices move together. */
export function jitter(g: THREE.BufferGeometry, amount: number, seed: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const r = mulberry(seed);
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 1 + (r() - 0.5) * 2 * amount;
      seen.set(key, k);
    }
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/** Reverse triangle winding (after a mirroring scale). */
export function flipWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
    pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    pos.setXYZ(i + 2, x, y, z);
  }
  const uv = ng.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i += 3) {
      const u = uv.getX(i + 1), v = uv.getY(i + 1);
      uv.setXY(i + 1, uv.getX(i + 2), uv.getY(i + 2));
      uv.setXY(i + 2, u, v);
    }
  }
  if (ng !== g) g.dispose();
  ng.computeVertexNormals();
  return ng;
}

/** Non-indexed copy (or the geometry itself when already non-indexed). Disposes the source when copied. */
export function ni(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) return g;
  const n = g.toNonIndexed();
  g.dispose();
  return n;
}

export function smooth01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
