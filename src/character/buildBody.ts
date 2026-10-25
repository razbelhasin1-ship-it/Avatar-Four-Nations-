import * as THREE from 'three';
import { PAL, TAT, blend2, mixSkin, rigid, type P3, type SkinSpec } from './CharMesh';
import { HEAD_CY, headNormalAngles, headPoint, headPointAngles, type FaceParams, type V3 } from './CharShape';
import { BI, XB, loftY, sampleTable, shapeStr, smooth01, wrapA, type BuildCtx, type Ring } from './buildUtil';

/**
 * Body builders: head + face, neck, torso core, arms (with sleeve coverage) and hands.
 * All geometry is appended to ctx.b in model (root-local) bind space.
 */

const SKIN_ROUGH = 0.6;

/** Wrap-safe lateral distance from a line at angle `line` on a tube of radius r (≥ 0, continuous). */
export function lineDist(r: number, th: number, line: number): number {
  return 2 * r * Math.abs(Math.sin((th - line) / 2));
}

// -----------------------------------------------------------------------------
// Face helpers
// -----------------------------------------------------------------------------

export interface FaceSpot {
  yaw: number;
  pitch: number;
  p: P3;
  n: P3;
}

/** Surface point on the face at head-local (x, y), front side. */
export function faceSpot(f: FaceParams, x: number, y: number): FaceSpot {
  let yaw = Math.asin(Math.max(-0.95, Math.min(0.95, x / f.rx)));
  let pitch = Math.asin(Math.max(-0.95, Math.min(0.95, (y - HEAD_CY) / f.ry)));
  const p = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < 8; k++) {
    headPointAngles(f, yaw, pitch, p);
    yaw += ((x - p.x) / (f.rx * Math.max(0.3, Math.cos(pitch)))) * 0.9;
    pitch += ((y - p.y) / f.ry) * 0.9;
  }
  headPointAngles(f, yaw, pitch, p);
  const n = { x: 0, y: 0, z: 0 };
  headNormalAngles(f, yaw, pitch, n);
  return { yaw, pitch, p, n };
}

/** Midline profile arc-length table for head tattoo coordinates. */
function midlineArc(f: FaceParams): { arc: (psi: number) => number; psiAtY: (y: number, front: boolean) => number; psiAtBackZ: (z: number) => number } {
  const N = 256;
  const psis: number[] = [];
  const arcs: number[] = [];
  const pts: P3[] = [];
  let acc = 0;
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i <= N; i++) {
    const psi = -Math.PI + (i / N) * Math.PI * 2;
    headPoint(f, 0, Math.cos(psi), Math.sin(psi), p);
    if (i > 0) acc += Math.hypot(p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    psis.push(psi);
    arcs.push(acc);
    pts.push({ ...p });
  }
  const arc = (psi: number) => {
    const f2 = ((psi + Math.PI) / (Math.PI * 2)) * N;
    const i = Math.max(0, Math.min(N - 1, Math.floor(f2)));
    const t = Math.min(1, Math.max(0, f2 - i));
    return arcs[i] + (arcs[i + 1] - arcs[i]) * t;
  };
  const psiAtY = (y: number, front: boolean) => {
    // front: psi in (0, π); back: psi in (-π, 0). Search where profile y crosses.
    let best = 0, bestD = Infinity;
    for (let i = 0; i <= N; i++) {
      if (front ? psis[i] <= 0 : psis[i] >= 0) continue;
      const d = Math.abs(pts[i].y - y);
      if (d < bestD && (front ? psis[i] < 1.6 : psis[i] > -1.6)) {
        bestD = d;
        best = psis[i];
      }
    }
    return best;
  };
  const psiAtBackZ = (z: number) => {
    for (let i = 0; i <= N / 4; i++) if (pts[i].z <= z) return psis[i];
    return -2.5;
  };
  return { arc, psiAtY, psiAtBackZ };
}

// -----------------------------------------------------------------------------
// Head
// -----------------------------------------------------------------------------

export function buildHead(ctx: BuildCtx): void {
  const { b, face: f } = ctx;
  const H = ctx.J('head');
  const head = BI.head;
  const ml = midlineArc(f);
  // Tattoo landmarks along the head path (t=0 at the lower back, y=1.0).
  const neckBackZ = -0.058 * ctx.rig.dims.neck;
  const psiJ = ml.psiAtBackZ(neckBackZ);
  const pj = { x: 0, y: 0, z: 0 };
  headPoint(f, 0, Math.cos(psiJ), Math.sin(psiJ), pj);
  const tNape = H[1] + pj.y - 1.0;
  const tOf = (psi: number) => tNape + ml.arc(psi) - ml.arc(psiJ);
  const eyeY = HEAD_CY - 0.006;
  const browY = eyeY + f.eyeR * 1.85;
  const psiBrow = ml.psiAtY(browY, true);
  const psiTip = ml.psiAtY(browY + 0.011, true);
  ctx.tat.head = { tNape, tCrown: tOf(0), tBrow: tOf(psiBrow), tTip: tOf(psiTip), tSpineBase: 0 };

  // Skull + face surface.
  b.mat(PAL.SKIN, SKIN_ROUGH);
  b.skin = rigid(head);
  const nu = ctx.seg(48), nv = ctx.seg(36);
  const p = { x: 0, y: 0, z: 0 };
  const headV0 = b.vertexCount;
  b.grid(
    nu,
    nv,
    (_i, _j, u, v, out) => {
      const yaw = -Math.PI + u * Math.PI * 2;
      const pitch = -Math.PI / 2 + v * Math.PI;
      const cp = Math.cos(pitch);
      const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
      headPoint(f, dx, dy, dz, p);
      out.x = H[0] + p.x;
      out.y = H[1] + p.y;
      out.z = H[2] + p.z;
      // Continuous path coordinates; the only seam (psi = ±π) is under the jaw, inside the neck.
      const psi = Math.atan2(dz, dy);
      const lo = psiJ - 0.3, hi = 2.5;
      const t = psi < lo ? tOf(lo) - (lo - psi) * 0.12 : psi > hi ? tOf(hi) + (psi - hi) * 0.12 : tOf(psi);
      b.tattoo(TAT.HEAD, p.x, t);
    },
    { closedU: true },
  );
  // Stylised face shading: blend the front of the head toward a smooth ellipsoid normal with
  // a slight forward bias, so angular jaws/cheeks never read as dark "beard shadow" patches.
  const cy = H[1] + HEAD_CY;
  b.adjustNormals(headV0, b.vertexCount, (q, n) => {
    let ex = (q.x - H[0]) / (f.rx * f.rx), ey = (q.y - cy) / (f.ry * f.ry), ez = (q.z - H[2]) / (f.rz * f.rz);
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const w = 0.78 * smooth01(-0.15, 0.45, ez) * smooth01(-1.02, -0.78, ey);
    n.x = n.x * (1 - w) + ex * w;
    n.y = n.y * (1 - w) + (ey * 0.8 + 0.18) * w;
    n.z = n.z * (1 - w) + (ez + 0.35) * w;
  });
  b.tattoo(TAT.NONE);
  ctx.crownY = H[1] + HEAD_CY + f.ry * (1 + 0.03 * f.cranium);

  buildEyes(ctx, eyeY);
  buildBrows(ctx, eyeY);
  const noseBase = buildNose(ctx, eyeY);
  buildMouth(ctx, noseBase);
  buildEars(ctx);
}

function toModel(H: V3, p: P3): P3 {
  return { x: H[0] + p.x, y: H[1] + p.y, z: H[2] + p.z };
}

function buildEyes(ctx: BuildCtx, eyeY: number): void {
  const { b, face: f } = ctx;
  const H = ctx.J('head');
  const re = f.eyeR;
  const irisA = f.irisA;
  const pupA = irisA * 0.44;
  const limb = irisA - 0.07;
  for (const side of [1, -1]) {
    const spot = faceSpot(f, side * f.eyeX, eyeY);
    // Socket floor is ~0.62 re below the undented surface; the eyeball sits in it, front ~0.5 re proud.
    const E: V3 = [H[0] + spot.p.x - spot.n.x * re * 0.3, H[1] + spot.p.y - spot.n.y * re * 0.3, H[2] + spot.p.z - spot.n.z * re * 0.28];
    if (side > 0) ctx.eyeL = E;
    else ctx.eyeR = E;
    const lidBone = side > 0 ? XB.lidL : XB.lidR;
    ctx.extraBone(lidBone, side > 0 ? 'lidL' : 'lidR', BI.head, E);

    // Eyeball: rings by polar angle from the gaze axis (+Z).
    const rings: Array<[number, number]> = [
      [0, PAL.PUPIL],
      [pupA * 0.6, PAL.PUPIL],
      [pupA, PAL.PUPIL],
      [pupA, PAL.IRIS],
      [(pupA + limb) * 0.5, PAL.IRIS],
      [limb, PAL.IRIS],
      [limb, PAL.LASH],
      [irisA, PAL.LASH],
      [irisA, PAL.EYE_WHITE],
      [irisA + 0.18, PAL.EYE_WHITE],
      [0.95, PAL.EYE_WHITE],
      [1.35, PAL.EYE_WHITE],
      [1.9, PAL.EYE_WHITE],
      [2.6, PAL.EYE_WHITE],
      [Math.PI, PAL.EYE_WHITE],
    ];
    const useRings = ctx.lod ? rings.filter((_, k) => k !== 1 && k !== 4 && k !== 9 && k !== 12) : rings;
    b.skin = rigid(BI.head);
    b.mat(PAL.EYE_WHITE, 0.12, 0, 1);
    b.grid(
      ctx.seg(20, 8),
      useRings.length - 1,
      (_i, j, u, _v, out) => {
        const [al, pal] = useRings[j];
        const be = u * Math.PI * 2;
        b.pal = pal;
        out.x = E[0] + re * Math.sin(al) * Math.cos(be);
        out.y = E[1] + re * Math.sin(al) * Math.sin(be);
        out.z = E[2] + re * Math.cos(al);
      },
      { closedU: true, flip: true },
    );
    // Catch light.
    if (!ctx.lod) {
      const al = irisA * 0.5, be = side > 0 ? 2.25 : 2.25;
      const cx = E[0] + re * 1.004 * Math.sin(al) * Math.cos(be);
      const cy = E[1] + re * 1.004 * Math.sin(al) * Math.sin(be);
      const cz = E[2] + re * 1.004 * Math.cos(al);
      b.mat(PAL.EYE_WHITE, 0.05, 0, 1);
      b.ellipsoid(cx, cy, cz, re * 0.13, re * 0.13, re * 0.05, 6, 4);
    }

    // Eyelids (upper on the lid bone so it can blink).
    const U = f.eyeU;
    const tiltSide = side * f.eyeTilt;
    const rnd = 0.35 + 0.5 * (1 - f.eyeRound);
    const vTop = (u: number) => {
      const w = Math.max(-1, Math.min(1, u / U));
      return f.eyeOpen * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(w), 2.2)), rnd) + tiltSide * w;
    };
    const vBot = (u: number) => {
      const w = Math.max(-1, Math.min(1, u / U));
      return -f.eyeOpen * 0.62 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(w), 2.4)), rnd) + tiltSide * w * 0.55;
    };
    const lidPt = (u: number, v: number, r: number, out: P3) => {
      out.x = E[0] + r * re * Math.sin(u) * Math.cos(v);
      out.y = E[1] + r * re * Math.sin(v);
      out.z = E[2] + r * re * Math.cos(u) * Math.cos(v);
    };
    const uMin = -U - 0.75, uMax = U + 0.75;
    const nuL = ctx.seg(16, 8);
    // Upper lid rows: [dv from edge or absolute, radius factor, palette]
    const upRows: Array<[number, number, number, boolean]> = [
      [-0.02, 0.985, PAL.LASH, false],
      [0.0, 1.085, PAL.LASH, false],
      [0.12, 1.095, PAL.LASH, false],
      [0.15, 1.07, PAL.SKIN, false],
      [0.4, 1.04, PAL.SKIN, false],
      [0.8, 1.03, PAL.SKIN, false],
      [1.4, 1.025, PAL.SKIN, true],
    ];
    b.skin = rigid(lidBone);
    b.mat(PAL.SKIN, SKIN_ROUGH);
    b.grid(
      nuL,
      upRows.length - 1,
      (_i, j, uu, _v, out) => {
        const u = uMin + (uMax - uMin) * uu;
        const [dv, r, pal, abs] = upRows[j];
        const v = abs ? dv : Math.min(1.25, vTop(u) + dv);
        b.pal = pal;
        b.rough = pal === PAL.LASH ? 0.5 : SKIN_ROUGH;
        lidPt(u, v, r, out);
      },
      {},
    );
    // Lower lid (static, on the head).
    const loRows: Array<[number, number, number, boolean]> = [
      [0.02, 0.985, PAL.SKIN_SHADE, false],
      [0.0, 1.045, PAL.SKIN, false],
      [-0.08, 1.04, PAL.SKIN, false],
      [-0.35, 1.03, PAL.SKIN, false],
      [-1.3, 1.025, PAL.SKIN, true],
    ];
    b.skin = rigid(BI.head);
    b.grid(
      nuL,
      loRows.length - 1,
      (_i, j, uu, _v, out) => {
        const u = uMin + (uMax - uMin) * uu;
        const [dv, r, pal, abs] = loRows[j];
        const v = abs ? dv : Math.max(-1.1, vBot(u) + dv);
        b.pal = pal;
        b.rough = SKIN_ROUGH;
        lidPt(u, v, r, out);
      },
      { flip: true },
    );
    // Outer lash flick for almond / youthful eyes.
    if (!ctx.lod && f.eyeTilt > 0.12) {
      b.skin = rigid(lidBone);
      b.mat(PAL.LASH, 0.5);
      const u0 = side * (U * 0.82);
      const pA = { x: 0, y: 0, z: 0 }, pB = { x: 0, y: 0, z: 0 }, pC = { x: 0, y: 0, z: 0 };
      lidPt(u0, vTop(u0) + 0.02, 1.09, pA);
      lidPt(side * (U + 0.28), vTop(side * U) + 0.12, 1.1, pB);
      lidPt(u0 * 0.75, vTop(u0 * 0.75) + 0.07, 1.1, pC);
      b.begin();
      const ia = b.v3(pA.x, pA.y, pA.z), ib = b.v3(pB.x, pB.y, pB.z), ic = b.v3(pC.x, pC.y, pC.z);
      if (side > 0) b.tri(ia, ib, ic);
      else b.tri(ia, ic, ib);
      b.end(false);
    }
  }
  b.mat(PAL.SKIN, SKIN_ROUGH);
  b.skin = rigid(BI.head);
}

function browPath(ctx: BuildCtx, side: number, eyeY: number): { pts: P3[]; h: number[] } {
  const f = ctx.face;
  const H = ctx.J('head');
  const st = Math.round(ctx.a.brows.style) % 6;
  const re = f.eyeR;
  const T = (0.0036 + ctx.a.brows.thickness * 0.004) * (st === 3 ? 1.6 : st === 4 ? 0.62 : 1);
  const n = ctx.lod ? 5 : 9;
  const pts: P3[] = [];
  const h: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const x = side * (f.eyeX - re * 0.95 + k * re * 2.55);
    let arch: number;
    switch (st) {
      case 1:
        arch = 0.0075 * Math.sin(Math.PI * Math.pow(k, 0.72));
        break;
      case 2:
        arch = -0.0022 + 0.0068 * k - 0.0022 * k * k;
        break;
      case 4:
        arch = 0.0062 * Math.sin(Math.PI * Math.pow(k, 0.8));
        break;
      case 5:
        arch = 0.0052 * Math.sin(Math.PI * k) + 0.0022 * (1 - k);
        break;
      default:
        arch = 0.0046 * Math.sin(Math.PI * Math.pow(k, 0.85)) - 0.0008 * k;
    }
    const y = eyeY + re * 1.5 + arch + f.brow * 0.0012;
    const s = faceSpot(f, x, y);
    pts.push({ x: H[0] + s.p.x + s.n.x * 0.0022, y: H[1] + s.p.y + s.n.y * 0.0022, z: H[2] + s.p.z + s.n.z * 0.0022 });
    const taper = st === 2 ? 1.05 - 0.5 * k : 1.0 - 0.5 * k + 0.25 * Math.sin(Math.PI * Math.min(1, k * 2));
    h.push(Math.max(0.0012, T * taper));
  }
  return { pts, h };
}

function buildBrows(ctx: BuildCtx, eyeY: number): void {
  const b = ctx.b;
  b.mat(PAL.BROW, 0.9);
  b.skin = rigid(BI.head);
  const split = ctx.a.scars.includes('brow_l');
  for (const side of [1, -1]) {
    const { pts, h } = browPath(ctx, side, eyeY);
    if (split && side > 0) {
      // Split brow: a gap a third of the way along.
      const n = pts.length;
      const cut = Math.round(n * 0.42);
      const a = pts.slice(0, cut), ha = h.slice(0, cut);
      const c = pts.slice(cut + 1), hc = h.slice(cut + 1);
      if (a.length >= 2) b.tube(a, (k) => 0.0016, 6, { rz: (k) => ha[k] * 0.5, up: { x: 0, y: 0, z: 1 }, capStart: true, capEnd: true });
      if (c.length >= 2) b.tube(c, (k) => 0.0016, 6, { rz: (k) => hc[k] * 0.5, up: { x: 0, y: 0, z: 1 }, capStart: true, capEnd: true });
    } else {
      b.tube(pts, () => 0.0018, ctx.lod ? 4 : 6, { rz: (k) => h[k] * 0.5, up: { x: 0, y: 0, z: 1 }, capStart: true, capEnd: true });
    }
  }
}

/** Returns nose base (head-local y, z) for mouth placement. */
function buildNose(ctx: BuildCtx, eyeY: number): { y: number; z: number } {
  const { b, face: f } = ctx;
  const H = ctx.J('head');
  b.mat(PAL.SKIN, SKIN_ROUGH);
  b.skin = rigid(BI.head);
  const len = 0.041 * f.noseLen;
  const yTop = eyeY + 0.004;
  const turn = Math.max(0, -f.noseBridge);
  const yTip = yTop - len + turn * 0.0025;
  const n = ctx.lod ? 4 : 7;
  const path: P3[] = [];
  const rad: number[] = [];
  let tipZ = 0;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const y = yTop + (yTip - yTop) * k;
    const s = faceSpot(f, 0, y);
    const proj = -0.0008 + f.noseProj * 0.0165 * Math.pow(k, 1.25) + f.noseBridge * 0.0035 * Math.sin(Math.PI * k) * (f.noseBridge > 0 ? 1 : 0.6);
    const z = s.p.z + proj - 0.0035;
    path.push({ x: H[0], y: H[1] + y, z: H[2] + z });
    rad.push((0.0016 + 0.0052 * Math.pow(k, 0.8)) * f.noseW);
    if (i === n - 1) tipZ = z;
  }
  b.tube(path, (k) => rad[k], ctx.lod ? 6 : 10, { rz: (k) => rad[k] * 0.9 + 0.0015, capStart: true, capEnd: true, up: { x: 0, y: 0, z: 1 } });
  // Tip bulb, alae and nostrils.
  const tipC = toModel(H, { x: 0, y: yTip - 0.0018, z: tipZ - 0.0028 });
  b.ellipsoid(tipC.x, tipC.y, tipC.z, 0.0068 * f.noseW * f.noseTip, 0.006 * f.noseTip, 0.0058 * f.noseTip, ctx.seg(12, 6), ctx.seg(8, 4));
  for (const side of [1, -1]) {
    const a = toModel(H, { x: side * 0.0084 * f.noseW, y: yTip - 0.0038, z: tipZ - 0.0112 });
    b.ellipsoid(a.x, a.y, a.z, 0.005 * f.noseW, 0.0044, 0.0056, ctx.seg(10, 5), ctx.seg(6, 4));
    b.mat(PAL.SKIN_SHADE, 0.8);
    const nn = toModel(H, { x: side * 0.0052 * f.noseW, y: yTip - 0.0072 + turn * 0.0012, z: tipZ - 0.0066 });
    b.ellipsoid(nn.x, nn.y, nn.z, 0.0031, 0.0011, 0.0024, 6, 4);
    b.mat(PAL.SKIN, SKIN_ROUGH);
  }
  return { y: yTip - 0.0075, z: tipZ - 0.008 };
}

function buildMouth(ctx: BuildCtx, noseBase: { y: number; z: number }): void {
  const { b, face: f } = ctx;
  const H = ctx.J('head');
  b.skin = rigid(BI.head);
  const yM = noseBase.y - 0.0135 - (f.faceLen - 1) * 0.01;
  const W = 0.0235 * f.mouthW;
  const n = ctx.lod ? 5 : 9;
  const line: P3[] = [];
  const upper: P3[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1) * 2 - 1;
    const x = k * W;
    const y = yM + 0.0016 * k * k;
    const s = faceSpot(f, x, y);
    line.push({ x: H[0] + s.p.x + s.n.x * 0.0009, y: H[1] + s.p.y, z: H[2] + s.p.z + s.n.z * 0.0009 });
    if (Math.abs(k) < 0.92) {
      const s2 = faceSpot(f, x * 0.92, y + 0.0026);
      upper.push({ x: H[0] + s2.p.x + s2.n.x * 0.0006, y: H[1] + s2.p.y, z: H[2] + s2.p.z + s2.n.z * 0.0006 });
    }
  }
  b.mat(PAL.MOUTH, 0.55);
  b.tube(line, (k) => 0.001, 5, { rz: (k) => 0.0013 * (1 - 0.45 * Math.abs((k / (n - 1)) * 2 - 1)), capStart: true, capEnd: true, up: { x: 0, y: 0, z: 1 } });
  if (!ctx.lod && upper.length >= 2 && f.lipFull > 0.6) {
    b.mat(PAL.LIP, 0.5);
    const m = upper.length;
    b.tube(upper, () => 0.0007, 5, { rz: (k) => 0.0011 * (f.lipFull - 0.3) * Math.sin(Math.PI * (k + 0.5) / m), capStart: true, capEnd: true, up: { x: 0, y: 0, z: 1 } });
  }
  b.mat(PAL.LIP, 0.5);
  const lc = faceSpot(f, 0, yM - 0.0042);
  const c = toModel(H, { x: lc.p.x, y: lc.p.y, z: lc.p.z - 0.0026 });
  b.ellipsoid(c.x, c.y, c.z, W * 0.58, 0.003 * (0.7 + f.lipFull * 0.6), 0.0042, ctx.seg(12, 6), ctx.seg(6, 4));
  b.mat(PAL.SKIN, SKIN_ROUGH);
}

function buildEars(ctx: BuildCtx): void {
  const { b, face: f } = ctx;
  const H = ctx.J('head');
  b.skin = rigid(BI.head);
  const s = f.earSize;
  for (const side of [1, -1]) {
    const p = { x: 0, y: 0, z: 0 };
    headPointAngles(f, side * (Math.PI / 2 + 0.1), -0.08, p);
    const c = toModel(H, { x: p.x + side * 0.004, y: p.y - 0.002, z: p.z - 0.004 });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(c.x, c.y, c.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, side * 0.42, side * 0.06)),
      new THREE.Vector3(1, 1, 1),
    );
    b.pushMatrix(m);
    b.mat(PAL.SKIN, SKIN_ROUGH);
    b.ellipsoid(0, 0, 0, 0.0085, 0.0265 * s, 0.0165 * s, ctx.seg(12, 6), ctx.seg(10, 5), (q, nx, ny) => {
      // Flatter back, rim curl at the top.
      if (q.x * side < 0) q.x *= 0.45;
      q.z += Math.max(0, ny) * 0.003 * s;
      void nx;
    });
    if (!ctx.lod) {
      b.mat(PAL.SKIN_SHADE, 0.8);
      b.ellipsoid(side * 0.0042, -0.001, 0.002, 0.003, 0.016 * s, 0.009 * s, 8, 6);
    }
    b.popMatrix();
  }
  b.mat(PAL.SKIN, SKIN_ROUGH);
}

// -----------------------------------------------------------------------------
// Neck & torso core
// -----------------------------------------------------------------------------

export function buildNeck(ctx: BuildCtx): void {
  const b = ctx.b;
  const k = ctx.rig.dims.neck * (0.96 + ctx.a.build * 0.08);
  const H = ctx.J('head');
  const rows: Array<[number, number, number, SkinSpec]> = [
    [1.4, 0.06, -0.006, [BI.chest, 1]],
    [1.45, 0.058, -0.006, [BI.chest, 0.55, BI.neck, 0.45]],
    [1.5, 0.0545, -0.004, [BI.neck, 1]],
    [1.535, 0.0535, -0.002, [BI.neck, 0.65, BI.head, 0.35]],
    [H[1] + 0.02, 0.052, 0.0, [BI.head, 1]],
    [H[1] + 0.06, 0.045, 0.002, [BI.head, 1]],
  ];
  const rings: Ring[] = rows.map(([y, r, z, sk]) => ({ c: [0, y, z] as V3, rx: r * k * 0.98, rz: r * k * 1.04, skin: sk, pal: PAL.SKIN }));
  b.mat(PAL.SKIN, SKIN_ROUGH);
  loftY(ctx, rings, ctx.seg(20, 8), {
    each: (j, th) => {
      const r = rings[j];
      b.tattoo(TAT.HEAD, lineDist(r.rx, th, Math.PI), r.c[1] - 1.0);
    },
  });
  b.tattoo(TAT.NONE);
}

/** Torso ring table: y, half-width, half-depth, z offset. */
export const TORSO_ROWS: number[][] = [
  [0.83, 0.07, 0.06, -0.005],
  [0.86, 0.128, 0.086, -0.01],
  [0.9, 0.151, 0.1, -0.013],
  [0.96, 0.157, 0.104, -0.013],
  [1.02, 0.146, 0.096, -0.005],
  [1.08, 0.131, 0.089, 0.003],
  [1.15, 0.137, 0.093, 0.009],
  [1.22, 0.15, 0.102, 0.014],
  [1.29, 0.159, 0.108, 0.017],
  [1.35, 0.164, 0.104, 0.012],
  [1.395, 0.172, 0.093, 0.002],
  [1.425, 0.16, 0.08, -0.006],
  [1.452, 0.112, 0.068, -0.008],
  [1.47, 0.062, 0.054, -0.006],
  [1.485, 0.05, 0.05, -0.004],
];

/** Body torso dimensions at height y (frame/build applied). */
export function torsoAt(ctx: BuildCtx, y: number): { hw: number; hd: number; z: number } {
  const d = ctx.rig.dims;
  const m = ctx.muscle;
  let hw = sampleTable(TORSO_ROWS, y, 1);
  let hd = sampleTable(TORSO_ROWS, y, 2);
  const z = sampleTable(TORSO_ROWS, y, 3);
  const chestK = smooth01(1.12, 1.3, y) * (1 - smooth01(1.43, 1.47, y));
  const waistK = smooth01(0.98, 1.06, y) * (1 - smooth01(1.12, 1.22, y));
  const hipK = 1 - smooth01(0.98, 1.06, y);
  const wK = 1 + (d.chestW - 1) * chestK + (d.waistW - 1) * waistK + (d.hipW - 1) * hipK;
  hw *= wK * (1 + (m - 1) * 0.5 * chestK);
  hd *= d.depth * (1 + (m - 1) * 0.6 * chestK) * (1 + (d.waistW - 1) * 0.6 * waistK);
  if (ctx.a.body === 'female') {
    // A modest bust: deeper and a little forward across the chest (clothing follows this shape).
    const bust = smooth01(1.16, 1.25, y) * (1 - smooth01(1.3, 1.38, y));
    hd *= 1 + 0.17 * bust;
    hw *= 1 + 0.03 * bust;
    return { hw, hd, z: z + 0.015 * bust };
  }
  return { hw, hd, z };
}

/** Skin weights for torso-hugging geometry at height y and angle th. */
export function torsoSkin(y: number, th: number, hw: number): SkinSpec {
  const sp = smooth01(0.98, 1.1, y);
  const ch = smooth01(1.2, 1.31, y);
  const nk = smooth01(1.45, 1.49, y) * 0.45;
  let base: SkinSpec;
  if (sp < 1) base = blend2(BI.hips, BI.spine, sp);
  else base = blend2(BI.spine, BI.chest, ch);
  if (nk > 0) base = mixSkin([[base, 1 - nk], [[BI.neck, 1], nk]]);
  // Shoulder corners follow the shoulder bones a little.
  const x = Math.sin(th) * hw;
  const sh = smooth01(1.33, 1.41, y) * (1 - smooth01(1.44, 1.47, y)) * smooth01(0.08, 0.15, Math.abs(x)) * 0.5;
  if (sh > 0) base = mixSkin([[base, 1 - sh], [[x > 0 ? BI.shoulderL : BI.shoulderR, 1], sh]]);
  return base;
}

export function buildTorsoCore(ctx: BuildCtx): void {
  const b = ctx.b;
  const ys = ctx.lod ? [0.83, 0.86, 0.92, 1.0, 1.06, 1.06, 1.15, 1.25, 1.35, 1.395, 1.425, 1.45, 1.47, 1.485] : [0.83, 0.86, 0.9, 0.96, 1.02, 1.06, 1.06, 1.1, 1.15, 1.22, 1.29, 1.35, 1.395, 1.425, 1.45, 1.47, 1.485];
  const rings: Ring[] = [];
  let seenWaist = false;
  for (const y of ys) {
    const t = torsoAt(ctx, y);
    let pal: number = PAL.SKIN;
    if (y < 1.06 || (y === 1.06 && !seenWaist)) pal = PAL.SECONDARY;
    if (y === 1.06) seenWaist = true;
    rings.push({ c: [0, y, t.z], rx: t.hw, rz: t.hd, skin: (th) => torsoSkin(y, th, t.hw), pal });
  }
  b.mat(PAL.SKIN, SKIN_ROUGH);
  loftY(ctx, rings, ctx.seg(28, 12), {
    pow: 2.3,
    each: (j, th) => {
      const r = rings[j];
      b.tattoo(TAT.HEAD, r.pal === PAL.SKIN ? lineDist(r.rx, th, Math.PI) : 0.5, r.c[1] - 1.0);
    },
  });
  b.tattoo(TAT.NONE);
}

// -----------------------------------------------------------------------------
// Arms & hands
// -----------------------------------------------------------------------------

/** Arm profile: depth below the shoulder joint (ascending), rx, rz. */
const ARM_ROWS: number[][] = [
  [-0.028, 0.012, 0.014],
  [-0.019, 0.031, 0.034],
  [-0.006, 0.041, 0.044],
  [0.014, 0.0455, 0.047],
  [0.06, 0.0445, 0.045],
  [0.14, 0.0425, 0.043],
  [0.215, 0.038, 0.038],
  [0.275, 0.0345, 0.035],
  [0.33, 0.038, 0.0355],
  [0.4, 0.034, 0.031],
  [0.47, 0.0275, 0.0245],
  [0.505, 0.0255, 0.0225],
  [0.53, 0.024, 0.021],
];

export interface SleeveInfo {
  /** dy where cloth ends (above → cloth). */
  end: number;
  kind: string;
  /** Uses the atlas sleeve region. */
  atlas: boolean;
  loose: number;
}

export function sleeveInfo(ctx: BuildCtx): SleeveInfo {
  const top = ctx.items.top;
  const sl = shapeStr(top, 'sleeves', top ? 'long' : 'none');
  const end = sl === 'none' ? 1 : sl === 'short' ? -0.125 : sl === 'elbow' ? -0.3 : -0.478;
  const pattern = shapeStr(top, 'pattern', 'none');
  const fur = top?.shape.fur === true;
  return { end, kind: sl, atlas: !!top && (pattern !== 'none' || fur || sl === 'wide'), loose: sl === 'wide' ? 1.22 : fur ? 1.2 : 1.1 };
}

export function armRadius(ctx: BuildCtx, dy: number): { rx: number; rz: number } {
  const k = ctx.rig.dims.limb * (0.92 + ctx.a.build * 0.16);
  return { rx: sampleTable(ARM_ROWS, -dy, 1) * k, rz: sampleTable(ARM_ROWS, -dy, 2) * k };
}

function armSkin(side: number, dy: number): SkinSpec {
  const sh = side > 0 ? BI.shoulderL : BI.shoulderR;
  const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
  const fa = side > 0 ? BI.foreArmL : BI.foreArmR;
  const hd = side > 0 ? BI.handL : BI.handR;
  if (dy > 0.012) return [sh, 0.45, ua, 0.55];
  if (dy > -0.03) return blend2(sh, ua, 0.55 + (0.012 - dy) * 10);
  if (dy > -0.235) return [ua, 1];
  if (dy > -0.315) return blend2(ua, fa, (-0.235 - dy) / 0.08);
  if (dy > -0.475) return [fa, 1];
  return blend2(fa, hd, (-0.475 - dy) / 0.05);
}

export function buildArms(ctx: BuildCtx): void {
  const b = ctx.b;
  const sl = sleeveInfo(ctx);
  const tatLine = ctx.tat;
  // dy values (positive up) of the rings; the sleeve boundary is inserted twice (hard edge).
  let list = ctx.lod ? [0.028, 0.019, 0.0, -0.08, -0.2, -0.275, -0.35, -0.47, -0.53] : ARM_ROWS.map((r) => -r[0]);
  if (sl.end < 0.04) {
    list = list.filter((d) => Math.abs(d - sl.end) > 0.012);
    list.push(sl.end, sl.end);
    list.sort((a, c) => c - a);
  }
  const armT = (dy: number) => 0.04 - dy;
  tatLine.arm = { tElbow: armT(-0.275), tWrist: armT(-0.495), tTip: armT(-0.495) + 0.072 };
  for (const side of [1, -1]) {
    const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
    const rings: Ring[] = [];
    let passed = false;
    for (let i = 0; i < list.length; i++) {
      const dy = list[i];
      const isBoundary = sl.end < 0.04 && Math.abs(dy - sl.end) < 1e-9;
      let cloth = dy > sl.end || (isBoundary && !passed);
      if (isBoundary) passed = true;
      const r = armRadius(ctx, dy);
      const domeK = smooth01(0.0, -0.06, dy);
      const loose = cloth ? 1 + (sl.loose - 1) * domeK + (sl.kind === 'wide' ? 0.12 * smooth01(-0.1, -0.45, dy) : 0) : 1;
      const add = cloth ? 0.002 + 0.002 * domeK : 0;
      rings.push({
        c: [A[0], A[1] + dy, A[2]],
        rx: r.rx * loose + add,
        rz: r.rz * loose + add,
        skin: armSkin(side, dy),
        pal: cloth ? (sl.atlas ? PAL.ATLAS : PAL.PRIMARY) : PAL.SKIN,
        v: Math.min(1, Math.max(0, (0.04 - dy) / (0.04 - sl.end))),
      });
      void cloth;
    }
    b.mat(PAL.SKIN, SKIN_ROUGH);
    loftY(ctx, rings, ctx.seg(18, 8), {
      region: 'sleeve',
      each: (j, th) => {
        const r = rings[j];
        // Line runs down the back of the upper arm and the outer forearm (back of the hand faces out).
        const dy = r.c[1] - A[1];
        const lineTh = side * (Math.PI / 2 + 0.45 * (1 - smooth01(-0.22, -0.4, dy)));
        b.tattoo(side > 0 ? TAT.ARM_L : TAT.ARM_R, r.pal === PAL.SKIN ? lineDist((r.rx + r.rz) / 2, th, lineTh) : 0.5, armT(dy));
        b.rough = r.pal === PAL.SKIN ? SKIN_ROUGH : 0.86;
      },
    });
    b.tattoo(TAT.NONE);
  }
}

/** Mitten-style hands with thumbs; fingers and thumbs on their own bones (fist curl). */
export function buildHands(ctx: BuildCtx): void {
  const b = ctx.b;
  const gl = ctx.items.gloves;
  const style = shapeStr(gl, 'style', 'none');
  const k = 1.1 + ctx.a.build * 0.08 + (ctx.rig.dims.limb - 1) * 0.4;
  const mitt = style === 'mittens';
  const bulk = mitt ? 1.28 : 1;
  const tWrist = ctx.tat.arm.tWrist;
  for (const side of [1, -1]) {
    const W = ctx.J(side > 0 ? 'handL' : 'handR');
    const hand = side > 0 ? BI.handL : BI.handR;
    const fingers = side > 0 ? XB.fingersL : XB.fingersR;
    const thumb = side > 0 ? XB.thumbL : XB.thumbR;
    const fa = side > 0 ? BI.foreArmL : BI.foreArmR;
    const tatPath = side > 0 ? TAT.ARM_L : TAT.ARM_R;
    const knuckleY = W[1] - 0.084 * k;
    ctx.extraBone(fingers, side > 0 ? 'fingersL' : 'fingersR', hand, [W[0] + side * 0.002, knuckleY, W[2]]);
    const thumbBase: V3 = [W[0] - side * 0.004, W[1] - 0.028 * k, W[2] + 0.026 * k];
    ctx.extraBone(thumb, side > 0 ? 'thumbL' : 'thumbR', hand, thumbBase);
    const palmPal = mitt ? PAL.FUR : style === 'fingerless' ? PAL.LEATHER : style === 'wraps' ? PAL.WRAP : PAL.SKIN;
    const fingerPal = mitt ? PAL.FUR : PAL.SKIN;
    const rough = mitt ? 0.95 : style === 'fingerless' ? 0.65 : SKIN_ROUGH;
    // Palm: rings along -Y (cross-section: x = thickness, z = width).
    const palmRows: Array<[number, number, number, number]> = [
      [0.004, 0.0145, 0.022, 0],
      [-0.012, 0.0165, 0.031, 0.001],
      [-0.035, 0.0172, 0.0375, 0.002],
      [-0.062, 0.0165, 0.039, 0.002],
      [-0.08, 0.0145, 0.0375, 0.002],
      [-0.088, 0.012, 0.035, 0.002],
    ];
    const palmRings: Ring[] = palmRows.map(([dy, rx, rz, dz], i) => ({
      c: [W[0] + side * 0.002, W[1] + dy * k, W[2] + dz] as V3,
      rx: rx * k * bulk,
      rz: rz * k * bulk,
      skin: i === 0 ? [fa, 0.3, hand, 0.7] : i === palmRows.length - 1 ? [hand, 0.6, fingers, 0.4] : [hand, 1],
      pal: palmPal,
    }));
    b.mat(palmPal, rough);
    loftY(ctx, palmRings, ctx.seg(16, 8), {
      pow: 2.6,
      each: (j, th) => {
        const r = palmRings[j];
        const back = Math.sin(th) * side;
        b.tattoo(tatPath, palmPal === PAL.SKIN ? (back > 0 ? r.rz * Math.cos(th) : 0.02 + 0.03 * -back) : 0.5, tWrist + (W[1] - r.c[1]) + 0.004);
      },
    });
    b.tattoo(TAT.NONE);
    if (style === 'wraps') {
      // Knuckle wrap band + wrist band.
      b.mat(PAL.WRAP, 0.9);
      for (const [y0, y1] of [[-0.06, -0.09], [0.0, -0.018]]) {
        const rr: Ring[] = [y0, y1].map((dy) => ({ c: [W[0] + side * 0.002, W[1] + dy * k, W[2] + 0.002] as V3, rx: 0.0185 * k, rz: 0.04 * k, skin: [hand, 1] as SkinSpec }));
        loftY(ctx, rr, ctx.seg(14, 8), { pow: 2.6 });
      }
    }
    // Fingers (mitten block).
    const fRows: Array<[number, number, number]> = [
      [-0.078, 0.0135, 0.036],
      [-0.1, 0.0125, 0.0365],
      [-0.13, 0.0112, 0.035],
      [-0.152, 0.0095, 0.031],
      [-0.165, 0.0062, 0.022],
      [-0.171, 0.0015, 0.008],
    ];
    const fRings: Ring[] = fRows.map(([dy, rx, rz], i) => ({
      c: [W[0] + side * 0.002, W[1] + dy * k * (mitt ? 1.02 : 1), W[2] + 0.002] as V3,
      rx: rx * k * bulk,
      rz: rz * k * bulk,
      skin: i === 0 ? [hand, 0.5, fingers, 0.5] : [fingers, 1],
      pal: fingerPal,
    }));
    b.mat(fingerPal, mitt ? 0.95 : SKIN_ROUGH);
    loftY(ctx, fRings, ctx.seg(16, 8), {
      pow: 2.4,
      each: (j, th) => {
        const r = fRings[j];
        const back = Math.sin(th) * side;
        b.tattoo(tatPath, fingerPal === PAL.SKIN ? (back > 0 ? r.rz * Math.cos(th) : 0.02 + 0.03 * -back) : 0.5, tWrist + (W[1] - r.c[1]) + 0.004);
      },
    });
    b.tattoo(TAT.NONE);
    // Thumb.
    const tip: V3 = [thumbBase[0] - side * 0.012 * k, thumbBase[1] - 0.046 * k, thumbBase[2] + 0.02 * k];
    const mid: V3 = [(thumbBase[0] + tip[0]) / 2 - side * 0.002, (thumbBase[1] + tip[1]) / 2, (thumbBase[2] + tip[2]) / 2 + 0.004];
    b.mat(mitt ? PAL.FUR : PAL.SKIN, mitt ? 0.95 : SKIN_ROUGH);
    b.skin = [thumb, 1];
    const tp = [thumbBase, mid, tip].map((q) => ({ x: q[0], y: q[1], z: q[2] }));
    b.tube(tp, (i) => (i === 0 ? 0.0118 : i === 1 ? 0.0108 : 0.0094) * k * bulk, ctx.seg(10, 6), {
      capEnd: true,
      perPoint: (i) => {
        b.skin = i === 0 ? [hand, 0.55, thumb, 0.45] : [thumb, 1];
      },
    });
    if (mitt) {
      // Fur cuff.
      b.mat(PAL.FUR, 1);
      b.skin = [fa, 0.5, hand, 0.5];
      const cy = W[1] + 0.006;
      furRing(ctx, [W[0] + side * 0.002, cy, W[2]], 0.026, 0.034, 0.011, b.skin);
    }
    if (style === 'bracers') {
      const rr: Ring[] = [-0.31, -0.33, -0.44, -0.47].map((dy, i) => {
        const r = armRadius(ctx, dy);
        const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
        const g = i === 0 || i === 3 ? 1.12 : 1.22;
        return { c: [A[0], A[1] + dy, A[2]] as V3, rx: r.rx * g + 0.004, rz: r.rz * g + 0.004, skin: [fa, 1] as SkinSpec, pal: PAL.LEATHER_DARK };
      });
      b.mat(PAL.LEATHER_DARK, 0.55);
      loftY(ctx, rr, ctx.seg(16, 8), { pow: 2.2 });
      // Gold studs on the outer side.
      b.mat(PAL.GOLD, 0.35, 0.6);
      const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
      for (const dy of [-0.36, -0.41]) {
        const r = armRadius(ctx, dy);
        b.skin = [fa, 1];
        b.ellipsoid(A[0] + side * (r.rx * 1.22 + 0.006), A[1] + dy, A[2], 0.004, 0.006, 0.006, 6, 4);
      }
    }
  }
}

/** Bumpy fur torus ring helper (horizontal ring around a vertical axis). */
export function furRing(ctx: BuildCtx, c: V3, rx: number, rz: number, thick: number, skin: SkinSpec | ((th: number) => SkinSpec), tilt = 0): void {
  const b = ctx.b;
  const nu = ctx.seg(28, 12), nv = ctx.seg(8, 5);
  b.grid(
    nu,
    nv,
    (i, j, u, v, out) => {
      const th = -Math.PI + u * Math.PI * 2;
      const ph = v * Math.PI * 2;
      const tuft = ctx.lod ? 1 : 1 + 0.32 * Math.max(0, Math.sin(i * 2.3 + j * 1.7)) * Math.sin(ph * 0.5 + 0.3);
      const rr = thick * tuft;
      const cx = Math.sin(th) * (rx + Math.cos(ph) * rr);
      const cz = Math.cos(th) * (rz + Math.cos(ph) * rr);
      out.x = c[0] + cx;
      out.y = c[1] + Math.sin(ph) * rr * 1.1 + Math.cos(th) * tilt;
      out.z = c[2] + cz;
      b.skin = typeof skin === 'function' ? skin(th) : skin;
    },
    { closedU: true },
  );
}
