import * as THREE from 'three';
import { CreatureModel, dampN, type AnimInput } from './CreatureModel';
import { bezier, cachedTemplate, cnoise, ellipsoid, mix, ModelBuilder, PAT, smooth, tube, xf, type ModelTemplate } from './ModelKit';
import { drape, fieldNormal, furLock, lumps, occlusionOf, sculpt, sdEllipsoid, sdRoundCone, smax, smin, surfaceHit, SurfacePath } from './Sculpt';

/**
 * Sky bison (Appa): ~8.5 m from nose to tail. The head, neck ruff, body and
 * beaver tail are sculpted as ONE seamless furry surface; six stumpy legs with
 * dark pads, short ivory horns, a broad dark nose, big gentle eyes and fluffy
 * cheek tufts. The brown arrow is a layer draped over the fur: its head on the
 * forehead pointing at the nose, its shaft running over the crown, down the
 * back and along the tail paddle.
 *
 * Bones: body (root) · head · jaw · tail0 · tail1 · thigh{F,M,B}{L,R} · shin{F,M,B}{L,R}
 * Everything is authored in body-local space (body bone at y = 2.05).
 */

const LEGS: Array<{ id: string; z: number }> = [
  { id: 'F', z: 1.45 },
  { id: 'M', z: 0.0 },
  { id: 'B', z: -1.45 },
];
const LEG_PHASE: Record<string, number> = { FL: 0, ML: (2 * Math.PI) / 3, BL: (4 * Math.PI) / 3, FR: Math.PI, MR: Math.PI + (2 * Math.PI) / 3, BR: Math.PI + (4 * Math.PI) / 3 };
const BODY_Y = 2.05;

export const BISON_VARIANTS = [
  { fur: '#f6f3ec', shade: '#d6d0c6', arrow: '#7c4e2c' },
  { fur: '#f7f0e2', shade: '#d9ccb6', arrow: '#6e4426' },
  { fur: '#f0f2f4', shade: '#cdd3da', arrow: '#865834' },
];

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** Body + head + tail, body-local. */
function bisonField(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  // Torso: a broad loaf with high shoulders, a round rump, soft belly and chest.
  let d = sdEllipsoid(x, y, z, 0, 0.08, -0.15, 1.86, 1.24, 2.3);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.32, 0.9, 1.74, 1.06, 1.45), 0.5);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.12, -1.5, 1.72, 1.1, 1.2), 0.5);
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.42, 0.0, 1.56, 0.86, 1.9), 0.6);
  d = smin(d, sdEllipsoid(x, y, z, 0, -0.28, 1.62, 1.3, 0.92, 0.92), 0.5);
  // Haunches over the legs.
  for (const l of LEGS) d = smin(d, sdEllipsoid(ax, y, z, 1.2, -0.62, l.z, 0.6, 0.55, 0.62), 0.35);
  // Head: cranium, wide cheeks, broad muzzle, soft brows, nose pad.
  const hy = y - 0.12;
  let hd = sdEllipsoid(x, hy, z, 0, 0.5, 2.62, 1.02, 0.7, 0.92);
  hd = smin(hd, sdEllipsoid(x, hy, z, 0, 0.0, 2.9, 1.28, 0.74, 0.82), 0.35);
  hd = smin(hd, sdEllipsoid(x, hy, z, 0, -0.18, 3.38, 1.0, 0.5, 0.5), 0.3);
  hd = smin(hd, sdEllipsoid(ax, hy, z, 0.5, 0.6, 3.2, 0.34, 0.14, 0.28), 0.16);
  hd = smin(hd, sdEllipsoid(x, hy, z, 0, -0.14, 3.76, 0.62, 0.26, 0.2), 0.14);
  d = smin(d, hd, 0.55);
  // Tail: thick furry root, then a broad flat beaver paddle with an upturned tip.
  let tl = sdRoundCone(x, y, z, 0, 0.02, -2.0, 0, 0.06, -2.95, 0.88, 0.5);
  const back = Math.max(0, -(z + 3.3));
  tl = smin(tl, sdEllipsoid(x, y - 0.1 - 0.1 * back * back, z, 0, 0, -3.72, 1.36, 0.2, 1.02), 0.32);
  d = smin(d, tl, 0.45);
  // Fur: soft lumps, calmer on the face so its features read cleanly.
  if (d > -0.3 && d < 0.3) {
    const face = smooth(2.9, 3.3, z) * smooth(-0.65, -0.35, y);
    d -= (0.04 - 0.028 * face) * lumps(x, y, z, 0.95, 3);
  }
  return d;
}

/** One leg in its thigh's local space (left side, +X outward); the sole sits on the ground. */
function legField(x: number, y: number, z: number): number {
  let d = sdRoundCone(x, y, z, 0, 0.18, 0, 0.03, -0.62, 0.03, 0.6, 0.5);
  d = smin(d, sdRoundCone(x, y, z, 0.03, -0.62, 0.03, 0.05, -1.0, 0.08, 0.5, 0.48), 0.2);
  d = smin(d, sdEllipsoid(x, y, z, 0.05, -1.1, 0.16, 0.56, 0.26, 0.62), 0.24);
  for (let t = 0; t < 4; t++) d = smin(d, sdEllipsoid(x, y, z, 0.05 + (t - 1.5) * 0.25, -1.17, 0.68, 0.15, 0.13, 0.15), 0.07);
  d = smax(d, -(y + 1.3), 0.06);
  // The hip is buried in the body's haunch: no surface needed above it.
  d = smax(d, y + 0.05, 0.08);
  if (d > -0.25 && d < 0.25) d -= 0.035 * lumps(x, y, z, 2.2, 11) * smooth(-1.12, -0.95, y);
  return d;
}

interface Landmarks {
  /** Arrow path: face → crown → back → tail tip. */
  path: SurfacePath;
  /** Arc length of the arrow tip (forehead, between the eyes). */
  sTip: number;
  /** Arc length where the tail paddle begins. */
  sPaddle: number;
  horns: THREE.Vector3[];
  hornNormals: THREE.Vector3[];
  eyes: Array<{ p: THREE.Vector3; n: THREE.Vector3 }>;
  /** Back height at the saddle. */
  saddleTop: number;
}

let landmarkCache: Landmarks | null = null;

function landmarks(): Landmarks {
  if (landmarkCache) return landmarkCache;
  const f = bisonField;
  const down = new THREE.Vector3(0, -1, 0);
  const pts: THREE.Vector3[] = [];
  // Face and crown: rays aimed at the head centre, from the nose up over the top.
  const hc = new THREE.Vector3(0, 0.27, 2.75);
  for (let deg = 100; deg >= 20; deg -= 2.5) {
    const a = (deg * Math.PI) / 180;
    const dir = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const hit = surfaceHit(f, hc.clone().addScaledVector(dir, 3), dir.clone().negate(), 4);
    if (hit) pts.push(hit);
  }
  // Back and tail: straight down.
  const lastZ = pts[pts.length - 1].z;
  for (let z = lastZ - 0.08; z > -5; z -= 0.08) {
    const hit = surfaceHit(f, new THREE.Vector3(0, 3.5, z), down, 6);
    if (!hit || hit.y < -0.6) break;
    pts.push(hit);
  }
  const path = new SurfacePath(pts);
  // Tip of the arrow: the forehead point level with the top of the eyes.
  let sTip = 0;
  for (let i = 0; i < path.pts.length; i++) {
    if (path.pts[i].y >= 0.58) {
      sTip = path.s[i];
      break;
    }
  }
  let sPaddle = path.length;
  for (let i = 0; i < path.pts.length; i++) {
    if (path.pts[i].z <= -2.95) {
      sPaddle = path.s[i];
      break;
    }
  }
  const horns: THREE.Vector3[] = [], hornNormals: THREE.Vector3[] = [];
  const eyes: Array<{ p: THREE.Vector3; n: THREE.Vector3 }> = [];
  for (const sx of [1, -1]) {
    const h = surfaceHit(f, new THREE.Vector3(0.74 * sx, 3, 2.45), down, 4)!;
    horns.push(h);
    hornNormals.push(fieldNormal(f, h));
    const e = surfaceHit(f, new THREE.Vector3(0.56 * sx, 0.5, 6), new THREE.Vector3(0, 0, -1), 4)!;
    eyes.push({ p: e, n: fieldNormal(f, e) });
  }
  const top = surfaceHit(f, new THREE.Vector3(0, 4, 0.3), down, 6)!;
  landmarkCache = { path, sTip, sPaddle, horns, hornNormals, eyes, saddleTop: top.y };
  return landmarkCache;
}

/** Outward direction for rays aimed at the arrow path. */
const pathOutward = (p: THREE.Vector3) => new THREE.Vector3(0, p.y, p.z > 2.75 ? p.z - 2.75 : 0);

/** Skin weights for the body surface: head and neck, body, tail root and paddle. */
function bodyBlend(p: THREE.Vector3): Array<[string, number]> {
  const zh = p.z - Math.max(0, -0.2 - p.y) * 0.8;
  const wh = smooth(1.8, 2.6, zh);
  if (wh > 0) return [['body', 1 - wh], ['head', wh]];
  const w0 = smooth(-1.95, -2.45, p.z), w1 = smooth(-2.55, -3.05, p.z);
  if (w0 > 0) return [['body', 1 - w0], ['tail0', w0 * (1 - w1)], ['tail1', w0 * w1]];
  return [['body', 1]];
}

interface Tuft {
  base: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  r: number;
  droop: number;
  /** 'neck' = skinned like the body surface under it. */
  bone: 'head' | 'neck' | 'jaw';
}

/** Expensive, variant-independent geometry: built once per quality level. */
interface Parts {
  body: THREE.BufferGeometry;
  bodyAO: Float32Array;
  arrow: THREE.BufferGeometry;
  arrowAO: Float32Array;
  leg: THREE.BufferGeometry;
  legAO: Float32Array;
  tufts: Tuft[];
  ankleTufts: number;
  radial: number;
}

const partsCache = new Map<string, Parts>();

function parts(detail: number): Parts {
  const q = detail < 0.7 ? 'low' : detail < 0.9 ? 'mid' : 'high';
  const hit = partsCache.get(q);
  if (hit) return hit;
  const L = landmarks();
  const low = q === 'low';
  const cell = low ? 0.19 : q === 'mid' ? 0.155 : 0.135;
  const body = sculpt(bisonField, {
    min: [-2.2, -1.6, -5.0],
    max: [2.2, 1.8, 4.4],
    cell,
    uv: (p) => (p.z < -2.6 ? [p.x, p.z] : [Math.atan2(p.x, p.y - 0.1) * 1.7, p.z]),
  });

  // The arrow: head on the forehead, shaft down the back, broadening over the tail paddle.
  const rows: number[] = [], widths: number[] = [];
  const headLen = 0.9, headW = 0.66, shaftW = 0.28;
  const end = L.path.length - 0.12;
  const step = low ? 0.14 : q === 'mid' ? 0.11 : 0.09;
  for (let s = L.sTip; s < L.sTip + headLen; s += step * 0.6) {
    rows.push(s);
    widths.push((headW * (s - L.sTip)) / headLen);
  }
  rows.push(L.sTip + headLen, L.sTip + headLen);
  widths.push(headW, shaftW);
  for (let s = L.sTip + headLen + step; s < end; s += step) {
    rows.push(s);
    const broad = smooth(L.sPaddle - 0.2, L.sPaddle + 0.5, s) * 0.12;
    const tipK = Math.max(0, 1 - (end - s) / 0.42);
    widths.push((shaftW + broad) * Math.sqrt(Math.max(0, 1 - tipK * tipK)));
  }
  rows.push(end);
  widths.push(0);
  const arrow = drape(bisonField, L.path, { rows, halfWidth: (_s, r) => widths[r], cols: low ? 5 : 7, lift: 0.014, outward: pathOutward });

  const legCell = low ? 0.19 : q === 'mid' ? 0.16 : 0.14;
  const leg = sculpt(legField, { min: [-0.8, -1.36, -0.8], max: [0.9, 0.2, 1.0], cell: legCell, uv: (p) => [Math.atan2(p.x, p.z) * 0.5, p.y] });

  // Fur tufts on the surface: cheeks, neck ruff, belly fringe, tail root, chin.
  const tufts: Tuft[] = [];
  const hitFrom = (from: THREE.Vector3, to: THREE.Vector3) => {
    const h = surfaceHit(bisonField, from, to.clone().sub(from).normalize(), 6);
    return h ? { p: h, n: fieldNormal(bisonField, h) } : null;
  };
  const add = (from: THREE.Vector3, to: THREE.Vector3, flow: THREE.Vector3, len: number, r: number, bone: Tuft['bone'], droop = 0.3) => {
    const h = hitFrom(from, to);
    if (!h) return;
    tufts.push({ base: h.p.clone().addScaledVector(h.n, -r * 0.55), dir: h.n.clone().multiplyScalar(0.45).add(flow), len, r, droop, bone });
  };
  for (const sx of [1, -1]) {
    const cheeks: Array<[number, number, number]> = [[0.36, 2.92, 0.3], [0.18, 2.98, 0.34], [0.0, 3.0, 0.36], [-0.18, 2.96, 0.36], [-0.36, 2.88, 0.34], [-0.52, 2.76, 0.3]];
    for (const [y, z, len] of low ? cheeks.filter((_, k) => k % 2 === 0) : cheeks) add(new THREE.Vector3(3 * sx, y + 0.12, z), new THREE.Vector3(0, y + 0.12, z), new THREE.Vector3(0.3 * sx, -0.5, -0.7), len, 0.24, 'head', 0.4);
    if (!low) {
      for (const a of [35, 60, 85, 110, 135]) {
        const r = (a * Math.PI) / 180;
        const c = new THREE.Vector3(0, 0.1, 2.25);
        add(c.clone().add(new THREE.Vector3(Math.sin(r) * 3 * sx, Math.cos(r) * 3, 0)), c, new THREE.Vector3(0, -0.2, -0.9), 0.42, 0.2, 'neck');
      }
    }
    for (const z of low ? [-1.4, 0, 1.4] : [-2.1, -0.72, 0.72, 2.0]) add(new THREE.Vector3(3 * sx, -0.85, z), new THREE.Vector3(0, -0.85, z), new THREE.Vector3(0, -0.95, -0.25), 0.44, 0.2, 'neck', 0.2);
    for (const [y, z] of (low ? [[0.25, -2.55], [-0.1, -2.7]] : [[0.25, -2.55], [-0.1, -2.6], [0.05, -2.85]]) as Array<[number, number]>) {
      add(new THREE.Vector3(3 * sx, y, z), new THREE.Vector3(0, y, z), new THREE.Vector3(0, -0.1, -0.9), 0.36, 0.16, 'neck', 0.15);
    }
  }
  for (const x of low ? [-0.3, 0, 0.3] : [-0.36, -0.12, 0.12, 0.36]) tufts.push({ base: new THREE.Vector3(x, -0.28, 0.4), dir: new THREE.Vector3(x * 0.5, -1, -0.45), len: 0.36, r: 0.13, droop: 0.1, bone: 'jaw' });

  const out: Parts = {
    body,
    bodyAO: occlusionOf(body, bisonField, 0.32),
    arrow,
    arrowAO: occlusionOf(arrow, bisonField, 0.32),
    leg,
    legAO: occlusionOf(leg, legField, 0.2),
    tufts,
    ankleTufts: low ? 5 : q === 'mid' ? 6 : 8,
    radial: low ? 5 : 6,
  };
  partsCache.set(q, out);
  return out;
}

/** Build the shared bison geometry ahead of time (loading screen), so the first spawn does not hitch. */
export function prewarmSkyBison(detail: number): void {
  parts(detail);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function buildBison(variant: number, detail: number): ModelTemplate {
  const v = BISON_VARIANTS[variant % BISON_VARIANTS.length];
  const L = landmarks();
  const P = parts(detail);
  const B = new ModelBuilder();
  B.pad = 2.5;
  B.bone('body', null, 0, BODY_Y, 0);
  B.bone('head', 'body', 0, 0.08, 2.05);
  B.bone('jaw', 'head', 0, -0.4, 1.0);
  B.bone('tail0', 'body', 0, -0.02, -2.12);
  B.bone('tail1', 'tail0', 0, 0, -0.62);
  for (const l of LEGS) {
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      B.bone(`thigh${l.id}${side}`, 'body', 1.22 * sx, -0.75, l.z);
      B.bone(`shin${l.id}${side}`, `thigh${l.id}${side}`, 0, -0.62, 0);
    }
  }
  B.anchor('seat', 'body', 0, L.saddleTop + 0.3, 0.35); // pelvis rests on the saddle platform top
  B.anchor('mouth', 'head', 0, -0.62, 1.9);
  B.anchor('head', 'head', 0, 0.4, 0.8);
  B.anchor('back', 'body', 0, L.saddleTop, -0.5);

  const fur = new THREE.Color(v.fur), shade = new THREE.Color(v.shade);
  const furCol = (p: THREE.Vector3, n: THREE.Vector3, ao: number) => {
    const under = smooth(0.2, -0.85, n.y) * 0.8;
    const c = fur.clone().lerp(shade, Math.min(1, under + (cnoise(p.x, p.y, p.z, 1.8) - 0.5) * 0.22));
    return c.multiplyScalar(0.7 + 0.3 * ao);
  };
  const FUR = { pat: PAT.fur, patScale: [1.15, 3.4] as [number, number] };
  const headOnly = (): Array<[string, number]> => [['head', 1]];

  // ---- Body, head and tail: one sculpted surface ----
  const nose = new THREE.Color('#6b5a54'), nostril = new THREE.Color('#2b211e'), mouth = new THREE.Color('#4a3530');
  B.add('body', P.body.clone(), {
    color: (p, n, i) => {
      const c = furCol(p, n, P.bodyAO[i]);
      if (p.z > 3.3) {
        // Broad dark nose with two big nostrils, a wide smile under it.
        const front = smooth(0.05, 0.35, n.z);
        const e = (p.x / 0.62) ** 2 + ((p.y + 0.02) / 0.26) ** 2;
        c.lerp(nose, smooth(1.12, 0.92, e) * front);
        const ns = Math.min(((Math.abs(p.x) - 0.25) / 0.09) ** 2 + ((p.y + 0.07) / 0.055) ** 2, 9);
        c.lerp(nostril, smooth(1.2, 0.7, ns) * front);
        const smile = -0.42 + 0.14 * (p.x / 0.8) ** 2;
        c.lerp(mouth, smooth(0.045, 0.02, Math.abs(p.y - smile)) * smooth(0.88, 0.76, Math.abs(p.x)) * front);
      }
      return c;
    },
    ...FUR,
    blend: bodyBlend,
  });
  const arrow = new THREE.Color(v.arrow);
  B.add('body', P.arrow.clone(), {
    color: (p, _n, i) => arrow.clone().offsetHSL(0, 0, (cnoise(p.x, p.y, p.z, 2.4) - 0.5) * 0.07).multiplyScalar(0.72 + 0.28 * P.arrowAO[i]),
    ...FUR,
    blend: bodyBlend,
  });

  // ---- Face: eyes, lids, horns, mouth ----
  const iris = new THREE.Color('#3a2414'), pupil = new THREE.Color('#0d0806'), white = new THREE.Color('#efe9dd');
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const { p, n } = L.eyes[i];
    // Eye frame: z out of the face, x across (toward the bison's left), y up.
    const ex = new THREE.Vector3(0, 1, 0).cross(n).normalize(), ey = n.clone().cross(ex);
    const frame = (g: THREE.BufferGeometry, x: number, y: number, z: number, roll = 0) => {
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(roll).setPosition(x, y, z));
      return g.applyMatrix4(new THREE.Matrix4().makeBasis(ex, ey, n).setPosition(p));
    };
    const c = p.clone().addScaledVector(n, -0.085);
    B.add('body', frame(ellipsoid(0.2, 0.19, 0.15, 18, 12), 0, 0, -0.085), {
      color: (pp) => {
        const l = pp.clone().sub(c);
        const along = l.dot(n);
        const r = l.addScaledVector(n, -along).length() / 0.195;
        if (along < 0) return white;
        return r < 0.46 ? pupil : r < 0.82 ? iris : white.clone().lerp(iris, 0.6);
      },
      blend: headOnly,
    });
    // Catchlights.
    B.add('body', frame(ellipsoid(0.042, 0.042, 0.02, 6, 4), 0.06 * sx, 0.07, 0.06), { color: '#ffffff', pat: PAT.glow, blend: headOnly });
    B.add('body', frame(ellipsoid(0.02, 0.02, 0.012, 5, 4), -0.05 * sx, -0.06, 0.06), { color: '#d8d0c4', pat: PAT.glow, blend: headOnly });
    // Soft fur lid hooding the top of the eyeball, outer corner a little lower: gentle, not grumpy.
    B.add('body', frame(ellipsoid(0.215, 0.17, 0.16, 16, 10), 0, 0.115, -0.09, -0.1 * sx), { color: (pp, nn) => furCol(pp, nn, 1), ...FUR, blend: headOnly });
  }
  // Horns: short, thick, curving out then up; ivory with ridges and a ruff of fur at the root.
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const b0 = L.horns[i].clone().addScaledVector(L.hornNormals[i], -0.1);
    const pts = bezier(b0, b0.clone().add(new THREE.Vector3(0.56 * sx, 0.16, 0.06)), b0.clone().add(new THREE.Vector3(0.64 * sx, 0.8, -0.1)), 10);
    B.add('body', tube(pts, (t) => (0.2 * (1 - t) + 0.05) * (1 + 0.05 * Math.sin(t * Math.PI * 9) * (1 - t)), { radial: 9, caps: true }), {
      color: (p) => mix('#f2e8d0', '#b39a72', smooth(0.3, 0.75, p.distanceTo(b0))),
      blend: headOnly,
    });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a) * 0.9 + 0.5 * sx, -0.25, Math.sin(a) * 0.9);
      B.add('body', furLock(b0.clone().add(new THREE.Vector3(0.05 * sx, 0.08, 0)), dir, 0.22, 0.1, 0.3, P.radial, 4, 0.5), { color: (pp, nn) => furCol(pp, nn, 0.9), ...FUR, blend: headOnly });
    }
  }
  // Mouth interior (shows when the jaw opens).
  B.add('body', xf(ellipsoid(0.6, 0.13, 0.4, 14, 8), { pos: [0, -0.5, 3.42] }), { color: '#3c1f1d', blend: headOnly });
  // Chin and lower lip on the jaw.
  B.add('jaw', xf(ellipsoid(0.62, 0.24, 0.4, 20, 12, { amp: 0.05, freq: 4, seed: 51 }), { pos: [0, -0.17, 0.32] }), {
    // The lip/tongue colour only on the top, which stays inside the head until the jaw opens.
    color: (p, n) => (n.y > 0.6 && p.y > -0.06 && p.z < 0.55 ? new THREE.Color('#6b4440') : furCol(new THREE.Vector3(p.x, p.y - 0.32, p.z + 3.05), n, 0.85)),
    pat: PAT.fur,
    patScale: [8, 5],
  });

  // ---- Fur tufts ----
  for (const tf of P.tufts) {
    const g = furLock(tf.base, tf.dir, tf.len, tf.r, tf.droop, P.radial, 4, 0.5);
    const col = (p: THREE.Vector3, n: THREE.Vector3) => furCol(p, n, 0.72 + 0.28 * smooth(0, tf.len * 0.8, p.distanceTo(tf.base)));
    if (tf.bone === 'jaw') B.add('jaw', g, { color: col, ...FUR });
    else B.add('body', g, { color: col, ...FUR, blend: tf.bone === 'head' ? headOnly : bodyBlend });
  }

  // ---- Legs: one sculpted leg reused for all six, with an ankle fringe ----
  const pad = new THREE.Color('#4a3e3b'), dusty = new THREE.Color('#d2c9bc');
  const legCol = (p: THREE.Vector3, n: THREE.Vector3, ao: number) => {
    const c = furCol(p, n, ao).lerp(dusty, smooth(-0.85, -1.15, p.y) * 0.45);
    const sole = smooth(-1.18, -1.26, p.y) * smooth(-0.2, -0.55, n.y);
    const toe = smooth(-1.08, -1.2, p.y) * smooth(0.5, 0.7, p.z);
    return c.lerp(pad, Math.max(sole, toe * 0.9));
  };
  const legR = mirrorKeep(P.leg);
  for (const l of LEGS) {
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const thigh = `thigh${l.id}${side}`, shin = `shin${l.id}${side}`;
      B.add(thigh, sx > 0 ? P.leg.clone() : legR.clone(), {
        color: (p, n, i) => legCol(new THREE.Vector3(p.x * sx, p.y, p.z), new THREE.Vector3(n.x * sx, n.y, n.z), P.legAO[i]),
        ...FUR,
        blend: (p) => {
          const w = smooth(-0.45, -0.8, p.y);
          return [[thigh, 1 - w], [shin, w]];
        },
      });
      // Ankle fringe over the top of the foot (authored thigh-local, added shin-local).
      for (let k = 0; k < P.ankleTufts; k++) {
        const a = (k / P.ankleTufts) * Math.PI * 2 + 0.3;
        const base = new THREE.Vector3((0.05 + Math.cos(a) * 0.4) * sx, -0.82, 0.08 + Math.sin(a) * 0.4);
        const dir = new THREE.Vector3(Math.cos(a) * 0.55 * sx, -1, Math.sin(a) * 0.55);
        B.add(shin, xf(furLock(base, dir, 0.26, 0.15, 0.05, P.radial, 4, 0.5), { pos: [0, 0.62, 0] }), { color: (p, n) => furCol(p, n, 0.85), ...FUR });
      }
    }
  }
  legR.dispose();
  return B.build();
}

/** Mirror a geometry to the other side, keeping its (field) normals. */
function mirrorKeep(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    nrm.setX(i, -nrm.getX(i));
  }
  const idx = g.index!.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return g;
}

function buildBisonSaddle(): ModelTemplate {
  const L = landmarks();
  const B = new ModelBuilder();
  // Must mirror the main skeleton layout (names & positions).
  B.bone('body', null, 0, BODY_Y, 0);
  B.bone('head', 'body', 0, 0.08, 2.05);
  const top = L.saddleTop;
  const f = bisonField;
  const down = new THREE.Vector3(0, -1, 0);
  // Blanket draped over the back: red cloth, gold band, dark hem.
  const R = 9, A = 44, cz = 0.3, rx = 1.6, rz = 1.9;
  const P: number[] = [], N: number[] = [], I: number[] = [], UV: number[] = [];
  for (let k = 0; k <= R; k++) {
    for (let a = 0; a <= A; a++) {
      const r = k / R, th = (a / A) * Math.PI * 2;
      const x = Math.cos(th) * rx * r, z = cz + Math.sin(th) * rz * r;
      const h = surfaceHit(f, new THREE.Vector3(x, 4, z), down, 6) ?? new THREE.Vector3(x, top, z);
      const n = fieldNormal(f, h);
      h.addScaledVector(n, 0.05 + 0.03 * (1 - r));
      P.push(h.x, h.y, h.z);
      N.push(n.x, n.y, n.z);
      UV.push(r, a / A);
      if (k > 0 && a > 0) {
        const i0 = (k - 1) * (A + 1) + a - 1, i1 = i0 + 1, j0 = k * (A + 1) + a - 1, j1 = j0 + 1;
        I.push(i0, i1, j0, i1, j1, j0);
      }
    }
  }
  const blanket = new THREE.BufferGeometry();
  blanket.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  blanket.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  blanket.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  blanket.setIndex(I);
  ensureFacing(blanket);
  B.add('body', blanket, {
    color: (p) => {
      const r = Math.hypot(p.x / rx, (p.z - cz) / rz);
      return r > 0.93 ? '#5c1712' : r > 0.8 ? '#d8a636' : r > 0.74 ? '#8e1d17' : '#b5302a';
    },
  });
  // Leather platform with a raised wooden rim.
  B.add('body', xf(ellipsoid(1.12, 0.15, 1.32, 28, 8), { pos: [0, top + 0.17, cz] }), { color: '#7d4b27' });
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    rim.push(new THREE.Vector3(Math.cos(a) * 1.1, top + 0.3, cz + Math.sin(a) * 1.3));
  }
  B.add('body', tube(rim, 0.075, { radial: 6 }), { color: '#553218' });
  // Girth straps around the belly, between the leg pairs.
  for (const zs of [0.72, -0.72]) {
    const ring: THREE.Vector3[] = [];
    const c = new THREE.Vector3(0, 0.1, zs);
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const from = c.clone().add(new THREE.Vector3(Math.sin(a) * 3, Math.cos(a) * 3, 0));
      const h = surfaceHit(f, from, c.clone().sub(from).normalize(), 6) ?? from;
      ring.push(h.addScaledVector(fieldNormal(f, h), Math.cos(a) > 0.45 ? 0.12 : 0.05));
    }
    B.add('body', tube(ring, 0.05, { radial: 5 }), { color: '#4a2c14' });
  }
  // Reins from the saddle front to the horns (blend body → head).
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? 1 : -1;
    const end = L.horns[i].clone().add(new THREE.Vector3(0.12 * sx, 0.12, 0));
    const pts = bezier(new THREE.Vector3(0.42 * sx, top + 0.32, 1.45), new THREE.Vector3(0.6 * sx, top + 0.42, 2.1), end, 12);
    B.add('body', tube(pts, 0.035, { radial: 5 }), {
      color: '#3e2412',
      blend: (p) => {
        const t = smooth(1.7, 2.4, p.z);
        return [['body', 1 - t], ['head', t]];
      },
    });
  }
  return B.build();
}

/** Flip a drape-style layer's faces so their fronts follow its normals. */
function ensureFacing(g: THREE.BufferGeometry): void {
  const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute;
  const I = g.index!.array as Uint16Array | Uint32Array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let facing = 0;
  for (let t = 0; t < I.length; t += 3) {
    a.fromBufferAttribute(P, I[t]);
    b.fromBufferAttribute(P, I[t + 1]).sub(a);
    c.fromBufferAttribute(P, I[t + 2]).sub(a);
    facing += b.cross(c).dot(n.fromBufferAttribute(N, I[t]));
  }
  if (facing < 0) {
    for (let t = 0; t < I.length; t += 3) {
      const s = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = s;
    }
  }
}

export class SkyBisonModel extends CreatureModel {
  private tailPhase = 0;
  private flyBlend = 0;
  private restBlend = 0;
  private grazeBlend = 0;
  private roarT = 0;

  constructor(variant = 0, detail = 1, scale = 1) {
    const key = `bison:${variant}:${detail.toFixed(2)}`;
    super(
      cachedTemplate(key, () => buildBison(variant, detail)),
      cachedTemplate('bison:saddle', () => buildBisonSaddle()),
      scale,
    );
  }

  update(a: AnimInput): void {
    const dt = a.dt;
    const t = a.time + this.seed;
    this.flyBlend = dampN(this.flyBlend, a.flying ? 1 : 0, 3, dt);
    const resting = a.action === 'rest' || a.action === 'sleep' || a.action === 'injured';
    this.restBlend = dampN(this.restBlend, resting && !a.flying ? 1 : 0, 2.2, dt);
    this.grazeBlend = dampN(this.grazeBlend, (a.action === 'graze' || a.action === 'eat') && !a.flying ? 1 : 0, 3, dt);
    const fb = this.flyBlend, rb = this.restBlend, gb = this.grazeBlend;
    const ground = 1 - fb;

    // Gait: six legs in a wave gait, stride grows with speed.
    const run = Math.min(1, Math.max(0, (a.speed - 2.4) / 2.5));
    const stride = 2.4 + run * 1.6;
    const ph = this.advance(a, stride);
    const moving = Math.min(1, a.speed / 1.2) * ground * (1 - rb);
    const amp = 0.32 + run * 0.22;
    for (const l of LEGS) {
      for (const side of ['L', 'R'] as const) {
        const id = `${l.id}${side}`;
        const p = ph + LEG_PHASE[id];
        const swing = -Math.sin(p) * amp * moving; // forward while lifted
        const lift = Math.max(0, Math.cos(p)) * 0.55 * moving;
        // Flying: slow paddling as if swimming through air.
        const paddle = Math.sin(t * 1.5 + LEG_PHASE[id] * 0.5) * 0.35;
        const sx = side === 'L' ? 1 : -1;
        // Resting: legs fold out to the sides under the body.
        const restX = l.id === 'F' ? -1.05 : l.id === 'B' ? 1.0 : 0.15;
        const thighX = swing * ground * (1 - rb) + paddle * fb + restX * rb + fb * (l.id === 'F' ? -0.25 : l.id === 'B' ? 0.35 : 0);
        const thighZ = (0.55 * rb + 0.12 * fb) * sx * (l.id === 'M' ? 1.6 : 1);
        this.rot(`thigh${id}`, thighX, 0, thighZ);
        this.rot(`shin${id}`, lift * ground + (0.5 + 0.25 * Math.sin(t * 1.5 + LEG_PHASE[id])) * fb + 1.25 * rb, 0, 0);
      }
    }
    if (moving > 0.3) this.footfalls(ph, true);

    // Body: bob, breathing, lowered when resting; pitch with tail strokes in flight.
    this.tailPhase += dt * (0.9 + (a.boost ? 0.9 : 0) + Math.max(0, a.vy) * 0.08) * Math.PI * 2 * (0.4 + 0.6 * fb);
    const stroke = Math.sin(this.tailPhase);
    const breath = Math.sin(t * (rb > 0.5 ? 0.9 : 1.3)) * (0.012 + 0.01 * rb);
    const bob = -Math.abs(Math.sin(ph)) * 0.06 * moving + Math.sin(this.tailPhase + 0.6) * 0.12 * fb;
    this.off('body', 0, bob - 1.1 * rb + 0.08 * gb, 0);
    this.scaleBone('body', 1 + breath, 1 + breath * 1.3, 1 + breath * 0.5);
    this.rot('body', stroke * 0.04 * fb - 0.03 * gb + 0.02 * rb, 0, Math.sin(ph * 0.5) * 0.025 * moving);

    // Tail: gentle sway on the ground, powerful up/down strokes in flight.
    const tailUp = a.flying ? -Math.max(-0.4, Math.min(0.4, a.vy * 0.04)) : 0;
    this.rot('tail0', (stroke * 0.32 + tailUp) * fb + (0.1 + Math.sin(t * 0.8) * 0.06) * ground + 0.25 * rb, Math.sin(t * 0.7) * 0.12 * ground, 0);
    this.rot('tail1', Math.sin(this.tailPhase - 0.9) * 0.38 * fb + Math.sin(t * 0.8 - 0.6) * 0.08 * ground, 0, 0);

    // Head: look-at, grazing, rest; slight lift in flight.
    const [ly, lp] = this.track(a, 0.7, 0.45, new THREE.Vector3(0, 2.4, 2.9));
    const graze = gb * 0.75;
    const rest = rb * 0.25;
    let headX = lp * (1 - gb) + graze + rest - 0.08 * fb + Math.sin(t * 0.6) * 0.03;
    if (a.action === 'roar' || a.action === 'alert') {
      this.roarT += dt;
      headX -= 0.25 * Math.min(1, this.roarT * 3);
    } else this.roarT = 0;
    this.rot('head', headX, ly * (1 - gb) + Math.sin(t * 0.4) * 0.05 * gb, Math.sin(t * 0.5) * 0.02);
    // Jaw: chewing when grazing/eating, open when calling.
    const chew = (gb > 0.3 ? Math.max(0, Math.sin(t * 7)) * 0.16 : 0) + (a.action === 'roar' ? 0.4 * Math.min(1, this.roarT * 4) : 0);
    this.rot('jaw', chew, 0, 0);
  }
}
