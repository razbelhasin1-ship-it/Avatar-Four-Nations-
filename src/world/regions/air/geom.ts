import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry generators for Air Nomad architecture and props (Southern Air
 * Temple). Plain BufferGeometry (position/normal/uv, indexed) ready for the
 * kit's ContentBuilder.mesh()/instance().
 *
 * Conventions: Y up, local +Z = front. Unless stated, geometry is centred on
 * the origin in XZ with its base at y = 0. Angles follow the world map
 * convention used by the layout code: a point at angle `a` around a centre is
 * (cx + cos a · r, cz + sin a · r).
 */

/** Merge geometries (all must be indexed or all non-indexed) and dispose the parts. */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = parts.map((g) => {
    let geo = g.index ? g : g.toNonIndexed();
    if (!geo.index) {
      const n = geo.getAttribute('position').count;
      const idx: number[] = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(idx);
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    geo.morphAttributes = {};
    if (geo !== g) g.dispose();
    return geo;
  });
  const out = mergeGeometries(norm, false)!;
  for (const g of norm) g.dispose();
  return out;
}

/**
 * Surface of revolution with world-scaled UVs (u around the axis, v along the
 * profile, both in units of `tile` metres) so roof tiles keep their size.
 * profile: [radius, y] pairs from bottom to top.
 */
export function lathe(profile: Array<[number, number]>, segments = 24, tile = 2, phase = 0): THREE.BufferGeometry {
  const rows = profile.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let acc = 0;
  const vAt: number[] = [0];
  for (let j = 1; j < rows; j++) {
    acc += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    vAt.push(acc);
  }
  const rMax = Math.max(...profile.map((p) => p[0]));
  const circ = Math.max(1, Math.round((2 * Math.PI * rMax) / tile));
  for (let j = 0; j < rows; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2 + phase;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push((i / segments) * circ, vAt[j] / tile);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      // Outward-facing winding.
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat horizontal ring (annulus) at y, facing down (`down`) or up. */
export function ring(rIn: number, rOut: number, y: number, segments = 24, down = true): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(Math.max(0.001, rIn), rOut, segments, 1);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/**
 * Air Nomad conical roof: concave cone with a flared, slightly upturned lip and
 * a soffit ring underneath. Eave (wall top) at y = 0, apex at y = h.
 * `r` is the wall radius the roof sits on; the eave overhangs by `overhang`.
 */
export function coneRoof(r: number, h: number, o: { overhang?: number; segments?: number; flare?: number; tile?: number } = {}): THREE.BufferGeometry {
  const ov = o.overhang ?? Math.max(0.35, r * 0.28);
  const R = r + ov;
  const f = o.flare ?? 1;
  const prof: Array<[number, number]> = [
    [R * 1.02, h * 0.035 * f],
    [R * 0.93, h * 0.0],
    [R * 0.8, h * 0.07],
    [R * 0.64, h * 0.19],
    [R * 0.48, h * 0.35],
    [R * 0.34, h * 0.53],
    [R * 0.21, h * 0.72],
    [R * 0.1, h * 0.89],
    [R * 0.015, h],
  ];
  const seg = o.segments ?? 24;
  const shell = lathe(prof, seg, o.tile ?? 1.6);
  // Underside: from the lip back to the wall.
  const soffit = ring(r * 0.98, R * 1.02, h * 0.035 * f - 0.02, seg, true);
  return mergeAll([shell, soffit]);
}

/** A flared skirt roof ring around a tower (between tiers). Bottom outer edge at y = 0. */
export function skirtRoof(rWall: number, out: number, h: number, segments = 24): THREE.BufferGeometry {
  const R = rWall + out;
  const prof: Array<[number, number]> = [
    [R * 1.01, h * 0.12],
    [R * 0.97, 0],
    [rWall + out * 0.62, h * 0.32],
    [rWall + out * 0.3, h * 0.68],
    [rWall - 0.02, h],
  ];
  const shell = lathe(prof, segments, 1.4);
  const soffit = ring(rWall * 0.98, R * 1.01, h * 0.12 - 0.02, segments, true);
  return mergeAll([shell, soffit]);
}

/** Pyramidal (n-sided) roof with concave slopes and a flared eave; eave at y=0. */
export function polyRoof(r: number, h: number, sides = 8, overhang = 0.9, phase = Math.PI / 8): THREE.BufferGeometry {
  const R = (r + overhang) / Math.cos(Math.PI / sides);
  const prof: Array<[number, number]> = [
    [R * 1.04, h * 0.06],
    [R * 0.95, 0],
    [R * 0.78, h * 0.1],
    [R * 0.58, h * 0.26],
    [R * 0.4, h * 0.46],
    [R * 0.24, h * 0.68],
    [R * 0.1, h * 0.88],
    [R * 0.02, h],
  ];
  const g = lathe(prof, sides, 1.6, phase);
  const soffit = new THREE.RingGeometry(r * 0.9, R * 1.04, sides, 1, phase);
  soffit.rotateX(Math.PI / 2);
  soffit.translate(0, h * 0.06 - 0.02, 0);
  // The lathe uses flat facets per side; recompute normals as flat-ish by
  // splitting is not needed — slight smoothing reads as tiled curvature.
  return mergeAll([g, soffit]);
}

/**
 * Annular sector prism (curved stair step, curved wall piece): radii rIn..rOut,
 * angles a0..a1 (world convention, see file header), from y0 to y1.
 */
export function annulusSector(rIn: number, rOut: number, a0: number, a1: number, y0: number, y1: number, segs = 4): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];
  const quad = (p: number[][]) => {
    const b = pos.length / 3;
    for (const v of p) pos.push(v[0], v[1], v[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const P = (r: number, a: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    // Ensure outward winding regardless of sweep direction.
    const [s0, s1] = a1 >= a0 ? [t0, t1] : [t1, t0];
    // top
    quad([P(rIn, s0, y1), P(rIn, s1, y1), P(rOut, s1, y1), P(rOut, s0, y1)]);
    // bottom
    quad([P(rIn, s1, y0), P(rIn, s0, y0), P(rOut, s0, y0), P(rOut, s1, y0)]);
    // outer wall
    quad([P(rOut, s0, y0), P(rOut, s0, y1), P(rOut, s1, y1), P(rOut, s1, y0)]);
    // inner wall
    if (rIn > 0.01) quad([P(rIn, s1, y0), P(rIn, s1, y1), P(rIn, s0, y1), P(rIn, s0, y0)]);
  }
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  // end caps
  quad([P(rIn, lo, y0), P(rIn, lo, y1), P(rOut, lo, y1), P(rOut, lo, y0)]);
  quad([P(rOut, hi, y0), P(rOut, hi, y1), P(rIn, hi, y1), P(rIn, hi, y0)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Arch spandrel: the masonry above a round arch between two piers. The arch
 * springs at y = spring (semicircle of radius span/2), the block tops out at
 * `top`. Centred at x = 0, extruded along Z (depth), z centred.
 */
export function archSpandrel(span: number, spring: number, top: number, depth: number, curveSegs = 10): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const r = span / 2;
  s.moveTo(-r, spring);
  s.absarc(0, spring, r, Math.PI, 0, true);
  s.lineTo(r, top);
  s.lineTo(-r, top);
  s.lineTo(-r, spring);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: curveSegs });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Wall with a circular "moon gate" opening whose bottom is cut by the floor.
 * Wall spans x ∈ [-w/2, w/2], y ∈ [0, h], depth along Z (centred). The circle
 * is centred at (0, cy) with radius r (cy < r so it meets the floor).
 */
export function moonGateWall(w: number, h: number, depth: number, cy: number, r: number, curveSegs = 28): THREE.BufferGeometry {
  const x0 = Math.sqrt(Math.max(0.01, r * r - cy * cy));
  const a0 = Math.atan2(-cy, -x0);
  const a1 = Math.atan2(-cy, x0);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-x0, 0);
  // Over the top of the opening (clockwise, from lower-left to lower-right).
  s.absarc(0, cy, r, a0 < 0 ? a0 + Math.PI * 2 : a0, a1, true);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: curveSegs });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Circular moulding ring around the moon gate (decorative torus segment). */
export function moonGateRing(cy: number, r: number, tube: number): THREE.BufferGeometry {
  // The visible arc runs from the right floor point, over the top, to the left one.
  const beta = Math.asin(Math.min(1, cy / r));
  const g = new THREE.TorusGeometry(r, tube, 6, 40, Math.PI + 2 * beta);
  // Torus arcs start at +X and sweep counter-clockwise; start just at the floor.
  g.rotateZ(-beta);
  g.translate(0, cy, 0);
  return g;
}

/** Bent bonsai-pine trunk (merged tapered cylinders). Variant 0..2. Base at y=0. */
export function pineTrunk(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pts = PINE_SHAPES[variant % PINE_SHAPES.length].trunk;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]);
    const b = new THREE.Vector3(...pts[i + 1]);
    const len = a.distanceTo(b);
    const r0 = 0.32 * (1 - i / pts.length) + 0.08;
    const r1 = 0.32 * (1 - (i + 1) / pts.length) + 0.06;
    const c = new THREE.CylinderGeometry(r1, r0, len * 1.04, 7, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    c.applyQuaternion(q);
    const m = a.clone().add(b).multiplyScalar(0.5);
    c.translate(m.x, m.y, m.z);
    parts.push(c);
  }
  // Branches to the pads.
  for (const p of PINE_SHAPES[variant % PINE_SHAPES.length].pads) {
    const from = new THREE.Vector3(...pts[Math.min(pts.length - 1, p[4])]);
    const to = new THREE.Vector3(p[0], p[1] - 0.1, p[2]);
    const len = from.distanceTo(to);
    const c = new THREE.CylinderGeometry(0.05, 0.11, len, 5, 1);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    const m = from.clone().add(to).multiplyScalar(0.5);
    c.translate(m.x, m.y, m.z);
    parts.push(c);
  }
  return mergeAll(parts);
}

/** Cloud-like foliage pads of a bonsai pine (flattened low-poly blobs). */
export function pinePads(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const p of PINE_SHAPES[variant % PINE_SHAPES.length].pads) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(p[3], p[3] * 0.38, p[3] * 0.85);
    g.translate(p[0], p[1], p[2]);
    parts.push(g);
  }
  return mergeAll(parts);
}

/** [x, y, z, radius, trunkIndex] pads and trunk polylines for bonsai pines. */
const PINE_SHAPES: Array<{ trunk: Array<[number, number, number]>; pads: Array<[number, number, number, number, number]> }> = [
  {
    trunk: [[0, 0, 0], [0.25, 1.1, 0.1], [-0.15, 2.2, 0.2], [0.35, 3.3, -0.1], [0.1, 4.1, 0]],
    pads: [
      [1.5, 2.3, 0.6, 1.35, 2],
      [-1.4, 3.0, -0.4, 1.2, 3],
      [0.9, 3.7, -0.9, 1.0, 3],
      [0.1, 4.4, 0.1, 1.15, 4],
      [-0.9, 2.0, 1.0, 0.85, 1],
    ],
  },
  {
    trunk: [[0, 0, 0], [-0.3, 0.9, 0], [0.2, 1.8, 0.25], [0.7, 2.6, 0.1], [0.5, 3.2, -0.2]],
    pads: [
      [2.0, 2.4, 0.3, 1.25, 3],
      [-1.1, 2.0, -0.6, 1.1, 2],
      [0.6, 3.4, -0.3, 1.05, 4],
      [1.2, 1.6, 1.2, 0.8, 2],
    ],
  },
  {
    trunk: [[0, 0, 0], [0.1, 1.4, 0], [0.0, 2.8, 0.15], [-0.1, 4.2, 0.0], [0.05, 5.2, 0]],
    pads: [
      [1.3, 3.0, 0.2, 1.1, 2],
      [-1.2, 3.6, 0.3, 1.0, 3],
      [0.3, 4.6, -1.0, 0.95, 3],
      [0.0, 5.4, 0.2, 1.05, 4],
      [-0.4, 2.3, -1.1, 0.8, 1],
    ],
  },
];

/** Straw bale lying along X (radius 0.55, length 1.3), base at y=0. */
export function hayBale(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.55, 0);
  return g;
}

/** Two binding bands around a hay bale. */
export function hayBands(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.35, 0.35]) {
    const t = new THREE.TorusGeometry(0.565, 0.035, 4, 16);
    t.rotateY(Math.PI / 2);
    t.translate(x, 0.55, 0);
    parts.push(t);
  }
  return mergeAll(parts);
}

/** Rectangular stack bale (block of straw), base at y=0. */
export function hayBlock(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1.5, 0.75, 0.9);
  g.translate(0, 0.375, 0);
  return g;
}

/** Robed monk statue (stone), standing on a plinth; total height ~3.6 m. Base at y=0. */
export function monkStatue(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const plinth = new THREE.BoxGeometry(1.5, 0.6, 1.5);
  plinth.translate(0, 0.3, 0);
  parts.push(plinth);
  const plinth2 = new THREE.BoxGeometry(1.25, 0.25, 1.25);
  plinth2.translate(0, 0.725, 0);
  parts.push(plinth2);
  // Robed figure: hem flaring onto the plinth, waist, broad shoulders under the mantle.
  const robe = lathe(
    [
      [0.64, 0.85],
      [0.6, 1.05],
      [0.5, 1.5],
      [0.41, 1.95],
      [0.43, 2.25],
      [0.5, 2.48],
      [0.46, 2.64],
      [0.26, 2.78],
      [0.12, 2.86],
    ],
    16,
    1,
  );
  robe.scale(1, 1, 0.82);
  parts.push(robe);
  // Mantle draped over one shoulder.
  const mantle = new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  mantle.scale(1.35, 0.55, 1.0);
  mantle.rotateZ(0.35);
  mantle.translate(-0.08, 2.5, 0.02);
  parts.push(mantle);
  // Sleeves folded in front, hands together.
  const sleeves = new THREE.CylinderGeometry(0.15, 0.15, 0.84, 8);
  sleeves.rotateZ(Math.PI / 2);
  sleeves.translate(0, 2.12, 0.3);
  parts.push(sleeves);
  for (const s of [-1, 1]) {
    const cuff = new THREE.SphereGeometry(0.16, 8, 6);
    cuff.translate(s * 0.42, 2.12, 0.3);
    parts.push(cuff);
  }
  const hands = new THREE.SphereGeometry(0.11, 8, 6);
  hands.scale(1.2, 1, 0.9);
  hands.translate(0, 2.13, 0.44);
  parts.push(hands);
  const neck = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8);
  neck.translate(0, 2.92, 0);
  parts.push(neck);
  const head = new THREE.SphereGeometry(0.25, 14, 10);
  head.scale(0.95, 1.1, 1);
  head.translate(0, 3.2, 0.02);
  parts.push(head);
  return mergeAll(parts);
}

/** Six-legged sky bison sculpture (stone), ~6 m long, base at y=0, facing +Z. */
export function bisonStatue(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(1, 16, 12);
  body.scale(1.55, 1.25, 2.7);
  body.translate(0, 2.25, 0);
  parts.push(body);
  const head = new THREE.SphereGeometry(1, 14, 10);
  head.scale(1.05, 0.95, 0.95);
  head.translate(0, 2.35, 2.75);
  parts.push(head);
  const snout = new THREE.SphereGeometry(0.55, 10, 8);
  snout.scale(1.3, 0.8, 0.9);
  snout.translate(0, 2.0, 3.55);
  parts.push(snout);
  for (const side of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.16, 0.9, 7);
    horn.rotateZ(-side * 1.1);
    horn.translate(side * 0.95, 3.05, 2.55);
    parts.push(horn);
    for (const zz of [-1.6, 0, 1.6]) {
      const leg = new THREE.CylinderGeometry(0.34, 0.4, 1.4, 8);
      leg.translate(side * 1.0, 0.7, zz);
      parts.push(leg);
    }
  }
  const tail = new THREE.SphereGeometry(1, 10, 6);
  tail.scale(1.25, 0.18, 0.9);
  tail.translate(0, 2.0, -3.0);
  parts.push(tail);
  // Plinth
  const plinth = new THREE.BoxGeometry(3.6, 0.4, 7.2);
  plinth.translate(0, -0.2, 0.2);
  parts.push(plinth);
  return mergeAll(parts);
}

/** Prayer wheel drum on a short spindle; base at y=0. */
export function prayerWheel(): THREE.BufferGeometry {
  const drum = new THREE.CylinderGeometry(0.28, 0.28, 0.75, 12);
  drum.translate(0, 1.05, 0);
  const cap = new THREE.ConeGeometry(0.3, 0.22, 12);
  cap.translate(0, 1.54, 0);
  const spindle = new THREE.CylinderGeometry(0.04, 0.04, 1.7, 5);
  spindle.translate(0, 0.85, 0);
  return mergeAll([drum, cap, spindle]);
}

/** Meditation cushion (flattened round pillow), base at y=0. */
export function cushion(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.42, 0.45, 0.16, 12);
  g.translate(0, 0.08, 0);
  return g;
}

/** Gold finial: stacked spheres/rings with a tapering spike. Base at y=0. */
export function finialGeometry(scale = 1): THREE.BufferGeometry {
  const s = scale;
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 0.35 * s, 10);
  base.translate(0, 0.175 * s, 0);
  parts.push(base);
  const ball = new THREE.SphereGeometry(0.42 * s, 12, 9);
  ball.translate(0, 0.7 * s, 0);
  parts.push(ball);
  const ring1 = new THREE.TorusGeometry(0.22 * s, 0.06 * s, 5, 12);
  ring1.rotateX(Math.PI / 2);
  ring1.translate(0, 1.18 * s, 0);
  parts.push(ring1);
  const ball2 = new THREE.SphereGeometry(0.22 * s, 10, 8);
  ball2.translate(0, 1.42 * s, 0);
  parts.push(ball2);
  const spike = new THREE.ConeGeometry(0.11 * s, 2.2 * s, 8);
  spike.translate(0, 2.65 * s, 0);
  parts.push(spike);
  return mergeAll(parts);
}

/** Small lantern box (stone lantern head) for path posts. Base at y=0. */
export function stoneLantern(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const foot = new THREE.CylinderGeometry(0.32, 0.4, 0.25, 8);
  foot.translate(0, 0.125, 0);
  parts.push(foot);
  const shaft = new THREE.CylinderGeometry(0.14, 0.18, 1.0, 8);
  shaft.translate(0, 0.75, 0);
  parts.push(shaft);
  const table = new THREE.BoxGeometry(0.6, 0.12, 0.6);
  table.translate(0, 1.31, 0);
  parts.push(table);
  const roof = new THREE.ConeGeometry(0.52, 0.42, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.92, 0);
  parts.push(roof);
  const knob = new THREE.SphereGeometry(0.09, 6, 5);
  knob.translate(0, 2.18, 0);
  parts.push(knob);
  return mergeAll(parts);
}

/** Glowing core of a stone lantern (the lit box between table and roof). */
export function stoneLanternLight(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.36, 0.36, 0.36);
  g.translate(0, 1.55, 0);
  return g;
}

/**
 * Waterfall ribbon: a vertical sheet starting at the lip (origin), flowing out
 * along +Z with initial speed then falling under gravity for `drop` metres.
 * UV v increases downstream (water shaders flow along +v). Attributes `rapid`
 * and `fall` are included for the shared water material.
 */
export function waterfallRibbon(width: number, drop: number, o: { out?: number; rows?: number; spread?: number } = {}): THREE.BufferGeometry {
  const rows = o.rows ?? 14;
  const out = o.out ?? 1.2;
  const spread = o.spread ?? 0.25;
  const pos: number[] = [];
  const uv: number[] = [];
  const fall: number[] = [];
  const rapid: number[] = [];
  const idx: number[] = [];
  let vacc = 0;
  let prev: THREE.Vector3 | null = null;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    // Parabolic trajectory: z grows ~ sqrt(drop) early, flattens as it falls.
    const y = -drop * t;
    const z = out * Math.sqrt(t) * 2.2 + 0.4 * t;
    const half = (width / 2) * (1 + spread * t);
    const c = new THREE.Vector3(0, y, z);
    if (prev) vacc += c.distanceTo(prev);
    prev = c;
    pos.push(-half, y, z, half, y, z);
    uv.push(0, vacc / 6, 1, vacc / 6);
    fall.push(1, 1);
    rapid.push(1, 1);
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('fall', new THREE.Float32BufferAttribute(fall, 1));
  g.setAttribute('rapid', new THREE.Float32BufferAttribute(rapid, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat water disc/plane with the attributes the shared water shader expects. */
export function waterDisc(r: number, segments = 40): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, segments);
  g.rotateX(-Math.PI / 2);
  const n = g.getAttribute('position').count;
  g.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

export function waterRect(w: number, d: number, flow = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d, 2, Math.max(1, Math.round(d / 2)));
  g.rotateX(-Math.PI / 2);
  // v along -Z → flow toward +Z when flow > 0.
  const n = g.getAttribute('position').count;
  const uvA = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) uvA.setXY(i, uvA.getX(i), (1 - uvA.getY(i)) * (d / 6));
  g.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(n).fill(flow), 1));
  g.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

/** Air-ball goal hoop (torus standing vertically in the XY plane), centre at origin. */
export function hoop(r: number, tube: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, 8, 28);
}

/** Single prayer flag (small quad hanging below its string point), in the XY plane. */
export function flagQuad(w = 0.36, h = 0.46): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  g.translate(0, -h / 2 - 0.02, 0);
  return g;
}

/** Hanging banner (cloth strip) in the XY plane, top edge at y=0. */
export function bannerQuad(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 4);
  g.translate(0, -h / 2, 0);
  // Gentle cloth sag.
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setZ(i, Math.sin((-y / h) * Math.PI) * 0.06);
  }
  g.computeVertexNormals();
  return g;
}
