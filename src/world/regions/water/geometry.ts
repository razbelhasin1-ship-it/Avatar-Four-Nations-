import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../../core/Random';

/**
 * Geometry helpers for Water Tribe architecture and props. All functions
 * return new BufferGeometries in local space; callers own (and dispose) them.
 * Conventions: base at y = 0 unless noted, front = local +Z.
 */

/** Strip everything but position/normal/uv and make indexed (so parts merge). */
export function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = g;
  if (geo.index === null) {
    const n = geo.getAttribute('position').count;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(idx);
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  geo.morphAttributes = {};
  return geo;
}

/** Merge parts (disposes the inputs). */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const cleaned = parts.map((p) => clean(p));
  const merged = mergeGeometries(cleaned, false);
  for (const p of cleaned) p.dispose();
  if (!merged) return new THREE.BufferGeometry();
  merged.computeBoundingSphere();
  return merged;
}

/** Apply a transform to a geometry in place (returns it). */
export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}

/** Box with its BOTTOM at y. */
export function boxAt(w: number, h: number, d: number, x = 0, y = 0, z = 0, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  return place(g, x, y + h / 2, z, yaw);
}

/** Arch outline (rectangle with a semicircular head). Base centre at (cx, cy). */
export function archPath<T extends THREE.Path>(p: T, w: number, h: number, cx = 0, cy = 0, segs = 8, reverse = false): T {
  const r = w / 2;
  const springY = cy + Math.max(0, h - r);
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(cx - r, cy));
  pts.push(new THREE.Vector2(cx + r, cy));
  pts.push(new THREE.Vector2(cx + r, springY));
  for (let i = 1; i < segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, springY + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(cx - r, springY));
  if (reverse) pts.reverse();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  p.closePath();
  return p;
}

/** Solid arch-shaped slab (door/window recess, glowing pane). Front face at z = depth/2. */
export function archSlab(w: number, h: number, depth: number, segs = 8): THREE.BufferGeometry {
  const s = archPath(new THREE.Shape(), w, h, 0, 0, segs);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

export interface Opening {
  /** Centre x of the opening (panel local, panel spans -w/2..w/2). */
  x: number;
  /** Bottom y of the opening. */
  y: number;
  w: number;
  h: number;
}

/** Rectangular wall panel (w × h × depth) with arched openings cut through. Base at y = 0, centred in x/z. */
export function panelWithArches(w: number, h: number, depth: number, openings: Opening[], segs = 8): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  for (const o of openings) {
    if (o.y <= 0.001) {
      // Openings touching the base: notch the outline instead of a hole (keeps the shape valid).
      continue;
    }
    s.holes.push(archPath(new THREE.Path(), o.w, o.h, o.x, o.y, segs, true));
  }
  const ground = openings.filter((o) => o.y <= 0.001);
  let geo: THREE.BufferGeometry;
  if (ground.length) {
    // Rebuild the outline with ground-level arches as notches.
    const out = new THREE.Shape();
    const sorted = [...ground].sort((a, b) => a.x - b.x);
    out.moveTo(-w / 2, 0);
    for (const o of sorted) {
      const r = o.w / 2;
      const springY = Math.max(0, o.h - r);
      out.lineTo(o.x - r, 0);
      out.lineTo(o.x - r, springY);
      for (let i = 1; i < segs; i++) {
        const a = Math.PI - (i / segs) * Math.PI;
        out.lineTo(o.x + Math.cos(a) * r, springY + Math.sin(a) * r);
      }
      out.lineTo(o.x + r, springY);
      out.lineTo(o.x + r, 0);
    }
    out.lineTo(w / 2, 0);
    out.lineTo(w / 2, h);
    out.lineTo(-w / 2, h);
    out.closePath();
    out.holes = s.holes;
    geo = new THREE.ExtrudeGeometry(out, { depth, bevelEnabled: false, curveSegments: segs });
  } else {
    geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: segs });
  }
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Hemisphere-ish dome (radius r, height r*hScale) with its base at y = 0. */
export function dome(r: number, hScale = 1, wSeg = 16, hSeg = 7): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, hScale, 1);
  return g;
}

/** Onion / bulb dome with a pointed tip (lathe). Base at y = 0. */
export function bulbDome(r: number, h: number, segs = 14): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // bulge then taper to a point
    const rr = r * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.62 + 0.25) * (1 - Math.pow(t, 3) * 0.98);
    pts.push(new THREE.Vector2(Math.max(0.001, rr), t * h));
  }
  return new THREE.LatheGeometry(pts, segs);
}

/** Rounded slab ("pillow"): soft snow caps and cushions. Base at y = 0, centred. */
export function pillow(w: number, d: number, h: number, round = 0.35, segs = 2): THREE.BufferGeometry {
  const b = Math.min(round, w / 2 - 0.01, d / 2 - 0.01, h / 2 - 0.01);
  const iw = w - 2 * b, id = d - 2 * b;
  const s = new THREE.Shape();
  s.moveTo(-iw / 2, -id / 2);
  s.lineTo(iw / 2, -id / 2);
  s.lineTo(iw / 2, id / 2);
  s.lineTo(-iw / 2, id / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: segs, curveSegments: 4 });
  // Extrusion runs along +Z; lay it flat so it rises along +Y.
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return g;
}

/** Thick wave stroke (centre line y = a*sin) as a shape, extruded. Spans x in [-len/2, len/2]. */
function waveShape(len: number, amp: number, thick: number, cycles: number, y0: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = 24;
  const top: THREE.Vector2[] = [];
  const bot: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -len / 2 + t * len;
    const y = y0 + Math.sin(t * Math.PI * 2 * cycles) * amp;
    // taper ends
    const k = Math.min(1, Math.min(t, 1 - t) * 6) * 0.5 + 0.5;
    top.push(new THREE.Vector2(x, y + (thick / 2) * k));
    bot.push(new THREE.Vector2(x, y - (thick / 2) * k));
  }
  s.moveTo(bot[0].x, bot[0].y);
  for (let i = 1; i <= n; i++) s.lineTo(bot[i].x, bot[i].y);
  for (let i = n; i >= 0; i--) s.lineTo(top[i].x, top[i].y);
  s.closePath();
  return s;
}

/**
 * The Water Tribe emblem in relief: a ring enclosing three waves (and a
 * crescent moon above them when `moon`). Faces +Z, centred at the origin, depth along Z.
 */
export function emblem(r: number, depth: number, moon = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.Shape();
  ring.absarc(0, 0, r, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.84, 0, Math.PI * 2, true);
  ring.holes.push(hole);
  parts.push(new THREE.ExtrudeGeometry(ring, { depth, bevelEnabled: false, curveSegments: 28 }));
  const waves = [
    { y: r * 0.22, len: r * 1.25 },
    { y: -r * 0.1, len: r * 1.45 },
    { y: -r * 0.42, len: r * 1.2 },
  ];
  for (const w of waves) parts.push(new THREE.ExtrudeGeometry(waveShape(w.len, r * 0.075, r * 0.11, 1.5, w.y), { depth, bevelEnabled: false, curveSegments: 4 }));
  if (moon) {
    const c = new THREE.Shape();
    c.absarc(0, r * 0.55, r * 0.2, Math.PI * 0.15, Math.PI * 1.85, false);
    c.absarc(r * 0.08, r * 0.6, r * 0.16, Math.PI * 1.75, Math.PI * 0.25, true);
    parts.push(new THREE.ExtrudeGeometry(c, { depth, bevelEnabled: false, curveSegments: 10 }));
  }
  const g = mergeParts(parts);
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Disc backing for an emblem medallion (faces +Z). */
export function disc(r: number, depth: number, segs = 28): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, segs);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Canoe / canal boat hull, length along local Z (bow at +Z), keel at y = 0,
 * gunwale at y = depth. Open top; inner floor provided separately.
 */
export function hull(len: number, beam: number, depth: number, segL = 14, segR = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const width = (u: number) => (beam / 2) * Math.pow(Math.sin(Math.PI * u), 0.55);
  const sheer = (u: number) => depth * (1 + 0.35 * Math.pow(Math.abs(u - 0.5) * 2, 3));
  for (let i = 0; i <= segL; i++) {
    const u = i / segL;
    const z = (u - 0.5) * len;
    const w = width(u);
    const top = sheer(u);
    for (let j = 0; j <= segR; j++) {
      const a = (j / segR) * Math.PI; // 0 = starboard gunwale, PI = port gunwale
      const x = Math.cos(a) * w;
      const y = top - Math.sin(a) * top * 0.95;
      pos.push(x, y, z);
    }
  }
  const row = segR + 1;
  for (let i = 0; i < segL; i++) {
    for (let j = 0; j < segR; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Double-sided by duplicating with flipped winding (inside of the hull is visible).
  const inner = g.clone();
  const ii = inner.getIndex()!;
  for (let k = 0; k < ii.count; k += 3) {
    const t = ii.getX(k + 1);
    ii.setX(k + 1, ii.getX(k + 2));
    ii.setX(k + 2, t);
  }
  inner.computeVertexNormals();
  return mergeParts([g, inner]);
}

/** Hexagonal ice crystal (prism with pointed tip). Base at y = 0. */
export function crystal(r: number, h: number, tipFrac = 0.28): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(r, r * 1.08, h * (1 - tipFrac), 6, 1);
  body.translate(0, (h * (1 - tipFrac)) / 2, 0);
  const tip = new THREE.ConeGeometry(r, h * tipFrac, 6, 1);
  tip.translate(0, h * (1 - tipFrac) + (h * tipFrac) / 2, 0);
  return mergeParts([body, tip]);
}

/** Cluster of crystals (seeded), base at y = 0. */
export function crystalCluster(seed: number, size: number, count = 5): THREE.BufferGeometry {
  const r = new Random(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const h = size * r.range(0.45, 1.0) * (i === 0 ? 1.25 : 1);
    const c = crystal(size * r.range(0.08, 0.14), h);
    const a = r.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : size * r.range(0.12, 0.3);
    place(c, Math.cos(a) * d, -0.05, Math.sin(a) * d, r.range(0, Math.PI), 1, 1, 1, r.range(-0.35, 0.35) * (i === 0 ? 0.3 : 1), r.range(-0.35, 0.35) * (i === 0 ? 0.3 : 1));
    parts.push(c);
  }
  return mergeParts(parts);
}

/** Low-poly boulder (deformed icosahedron), base roughly at y = 0. */
export function boulder(seed: number, rx: number, ry: number, rz: number, detail = 1): THREE.BufferGeometry {
  const r = new Random(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // Non-indexed: displace consistently per unique vertex position.
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const disp = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (!disp.has(k)) disp.set(k, r.range(0.78, 1.15));
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = disp.get(key(x, y, z))!;
    const yy = y < -0.3 ? -0.3 - (y + 0.3) * 0.25 : y; // flatten the underside
    p.setXYZ(i, x * f * rx, (yy * f + 0.3) * ry, z * f * rz);
  }
  g.computeVertexNormals();
  return g;
}

/** Conical hide tent (SWT): cone with a door flap notch; base at y = 0. */
export function tentCone(r: number, h: number, segs = 10): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segs, 3, true);
  g.translate(0, h / 2, 0);
  // Slight sag between poles.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const sag = 1 - 0.06 * Math.abs(Math.sin(a * segs * 0.5)) * (1 - y / h);
    p.setXYZ(i, x * sag, y, z * sag);
  }
  g.computeVertexNormals();
  // Double sided via flipped copy (open cone).
  const inner = g.clone();
  const idx = inner.getIndex()!;
  for (let k = 0; k < idx.count; k += 3) {
    const t = idx.getX(k + 1);
    idx.setX(k + 1, idx.getX(k + 2));
    idx.setX(k + 2, t);
  }
  inner.computeVertexNormals();
  return mergeParts([g, inner]);
}

/** Snow-brick igloo dome with an entrance tunnel facing +Z; base at y = 0. */
export function igloo(r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [dome(r, 0.82, 16, 7)];
  const tunnel = new THREE.CylinderGeometry(r * 0.38, r * 0.38, r * 0.7, 10, 1, false, 0, Math.PI);
  tunnel.rotateZ(Math.PI / 2);
  tunnel.rotateY(Math.PI / 2);
  tunnel.translate(0, 0, r * 0.95);
  parts.push(tunnel);
  return mergeParts(parts);
}

/** Simple conifer (stacked cones) for the isle and the Spirit Oasis; base at y = 0. Returns [trunk, foliage]. */
export function conifer(seed: number, h: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const r = new Random(seed);
  const trunk = new THREE.CylinderGeometry(h * 0.025, h * 0.04, h * 0.35, 6);
  trunk.translate(0, h * 0.175, 0);
  const fol: THREE.BufferGeometry[] = [];
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const cr = h * (0.3 - t * 0.2) * r.range(0.9, 1.1);
    const ch = h * 0.34;
    const c = new THREE.ConeGeometry(cr, ch, 7, 1);
    c.translate(0, h * 0.25 + t * h * 0.22 + ch / 2, 0);
    c.rotateY(r.range(0, Math.PI));
    fol.push(c);
  }
  return [trunk, mergeParts(fol)];
}

/** Round-crowned broadleaf tree (oasis); returns [trunk, foliage]. */
export function roundTree(seed: number, h: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const r = new Random(seed);
  const trunk = new THREE.CylinderGeometry(h * 0.035, h * 0.06, h * 0.55, 7);
  trunk.translate(0, h * 0.275, 0);
  const fol: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.IcosahedronGeometry(h * r.range(0.16, 0.24), 1);
    s.translate(r.range(-0.18, 0.18) * h, h * r.range(0.58, 0.85), r.range(-0.18, 0.18) * h);
    fol.push(s);
  }
  return [trunk, mergeParts(fol)];
}

/**
 * Vertical waterfall sheet: `width` across local X, falls `height` along -Y
 * from y = 0, bulging out along +Z at the lip. UVs in metres (x across, y down).
 */
export function waterfallSheet(width: number, height: number, lip = 0.6, segX = 4, segY = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segY; j++) {
    const t = j / segY;
    const y = -t * height;
    // lip arc: out quickly then straight down
    const z = lip * Math.sqrt(Math.min(1, t * 3.5));
    for (let i = 0; i <= segX; i++) {
      const s = i / segX;
      pos.push((s - 0.5) * width, y, z);
      uv.push(s * width, t * height);
    }
  }
  const row = segX + 1;
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Half-disc foam patch in front of a fall: flat on y = 0, extends along +Z. uv.y 0 at fall line → 1 at rim. */
export function foamPatch(width: number, reach: number, segs = 10): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0.5, 0];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pos.push(Math.cos(a) * width * 0.5 * 1.2, 0, Math.sin(a) * reach);
    uv.push(i / segs, 1);
  }
  for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
  // A strip along the fall line too.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat horizontal quad (water surfaces, beds), centred, y = 0, optional yaw. */
export function flatQuad(w: number, d: number, segW = 1, segD = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d, segW, segD);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Flat horizontal disc, y = 0. */
export function flatDisc(r: number, segs = 32): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, segs);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Flat ring (annulus), y = 0. */
export function flatRing(r0: number, r1: number, segs = 40): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, segs, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Koi fish body (length along +Z, nose at +Z), lying at y = 0. */
export function koi(len: number): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(len * 0.5, 10, 6);
  body.scale(0.32, 0.22, 1);
  const tail = new THREE.ConeGeometry(len * 0.18, len * 0.35, 6, 1);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.25, 1);
  tail.translate(0, 0, -len * 0.55);
  const finL = new THREE.ConeGeometry(len * 0.08, len * 0.2, 4, 1);
  finL.rotateZ(Math.PI / 2);
  finL.scale(1, 0.2, 1);
  finL.translate(len * 0.17, 0, len * 0.12);
  const finR = finL.clone();
  finR.scale(-1, 1, 1);
  return mergeParts([body, tail, finL, finR]);
}

/** Drying rack fish (flat diamond), hanging along -Y from y = 0. */
export function fishShape(len: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(len * 0.18, -len * 0.4, 0, -len * 0.8);
  s.lineTo(len * 0.12, -len);
  s.lineTo(-len * 0.12, -len);
  s.lineTo(0, -len * 0.8);
  s.quadraticCurveTo(-len * 0.18, -len * 0.4, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.015);
  return g;
}

/** Brazier bowl on three legs; base at y = 0, bowl rim at y = h. */
export function brazier(r: number, h: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pts = [new THREE.Vector2(0.01, 0), new THREE.Vector2(r * 0.55, 0.02), new THREE.Vector2(r, r * 0.55), new THREE.Vector2(r * 1.05, r * 0.6), new THREE.Vector2(r * 0.95, r * 0.62)];
  const bowl = new THREE.LatheGeometry(pts, 12);
  bowl.translate(0, h - r * 0.6, 0);
  parts.push(bowl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.04, 0.05, h - r * 0.5, 5);
    leg.translate(Math.cos(a) * r * 0.5, (h - r * 0.5) / 2, Math.sin(a) * r * 0.5);
    parts.push(leg);
  }
  return mergeParts(parts);
}
