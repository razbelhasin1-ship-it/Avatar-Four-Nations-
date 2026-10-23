import * as THREE from 'three';
import { PAL, type P3, type SkinSpec } from './CharMesh';
import { headNormalAngles, headPointAngles, type V3 } from './CharShape';
import { faceSpot } from './buildBody';
import { BI, hashNoise, lerp, sampleTable, smooth01, type BuildCtx } from './buildUtil';

/**
 * Hair (16 styles), facial hair (7) and scars (5). Hair shells follow the
 * head surface function so they fit every face preset; tails, braids and long
 * hair hang from secondary-motion chains.
 */

const HAIR_ROUGH = 0.62;

type Hairline = (yaw: number) => number;

const STD_LINE: number[][] = [
  [0, 0.47],
  [0.45, 0.43],
  [0.8, 0.27],
  [1.1, 0.1],
  [1.3, -0.12],
  [1.42, -0.04],
  [1.6, 0.19],
  [1.8, 0.14],
  [2.2, -0.2],
  [2.7, -0.42],
  [Math.PI, -0.5],
];

const stdLine: Hairline = (yaw) => sampleTable(STD_LINE, Math.abs(yaw), 1);

function headModel(ctx: BuildCtx, yaw: number, pitch: number, off: number, out: P3): P3 {
  const f = ctx.face;
  const H = ctx.J('head');
  const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  headPointAngles(f, yaw, pitch, p);
  headNormalAngles(f, yaw, pitch, n);
  out.x = H[0] + p.x + n.x * off;
  out.y = H[1] + p.y + n.y * off;
  out.z = H[2] + p.z + n.z * off;
  return out;
}

interface CapOpts {
  line?: Hairline;
  /** Thickness at the crown. */
  top: number;
  /** Thickness at the hairline edge (blunt cuts keep it thick). */
  edge?: (yaw: number) => number;
  pal?: number;
  /** Extra outward offset by direction (volume shaping). */
  bulge?: (yaw: number, pitch: number) => number;
  /** Restrict the cap to a yaw range (partial caps). */
  yaw0?: number;
  yaw1?: number;
  rough?: number;
  noise?: number;
}

function hairCap(ctx: BuildCtx, o: CapOpts): void {
  const b = ctx.b;
  const line = o.line ?? stdLine;
  const y0 = o.yaw0 ?? -Math.PI, y1 = o.yaw1 ?? Math.PI;
  const full = Math.abs(y1 - y0 - Math.PI * 2) < 1e-6;
  const nu = ctx.seg(40, 14), nv = ctx.seg(14, 6);
  b.mat(o.pal ?? PAL.HAIR, o.rough ?? HAIR_ROUGH);
  b.skin = [BI.head, 1];
  const p = { x: 0, y: 0, z: 0 };
  b.grid(
    nu,
    nv + 1,
    (i, j, u, _v, out) => {
      const yaw = y0 + (y1 - y0) * u;
      const hl = line(yaw);
      const tuck = j === nv + 1;
      const v = Math.min(1, j / nv);
      const pitch = Math.PI / 2 - v * (Math.PI / 2 - hl) - (tuck ? 0.012 : 0);
      const e = v;
      const edgeT = o.edge ? o.edge(yaw) : 0.0014;
      let th = lerp(o.top, edgeT, Math.pow(e, 2.2));
      if (o.bulge) th += o.bulge(yaw, pitch) * (1 - Math.pow(e, 3));
      if (o.noise && !ctx.lod) th += o.noise * hashNoise(i * 0.7, j * 1.3) * (1 - e) * 0.5;
      // Strand grooves: alternating ridges catch the light like painted hair strands.
      if (!ctx.lod && o.top > 0.004 && !tuck) th += (i % 2 ? 0.0011 : -0.0004) * (1 - Math.pow(e, 4)) * Math.min(1, v * 6);
      headModel(ctx, yaw, pitch, tuck ? -0.002 : th, p);
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
    },
    { closedU: full, flip: true },
  );
}

/** Ellipsoid lobes along a path → stylised braid. */
function braid(ctx: BuildCtx, path: P3[], width: number, lobes: number, skinAt: (t: number) => SkinSpec, pal: number = PAL.HAIR): void {
  const b = ctx.b;
  const n = path.length;
  const cum: number[] = [0];
  for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y, path[k].z - path[k - 1].z));
  const L = cum[n - 1] || 1;
  const at = (s: number): { p: THREE.Vector3; t: THREE.Vector3 } => {
    const d = s * L;
    let k = 1;
    while (k < n - 1 && cum[k] < d) k++;
    const f = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    const a = path[k - 1], c = path[k];
    return { p: new THREE.Vector3(lerp(a.x, c.x, f), lerp(a.y, c.y, f), lerp(a.z, c.z, f)), t: new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z).normalize() };
  };
  const nl = ctx.lod ? Math.max(3, Math.round(lobes * 0.5)) : lobes;
  b.mat(pal, HAIR_ROUGH);
  for (let k = 0; k < nl; k++) {
    const s = (k + 0.5) / nl;
    const { p, t } = at(s);
    const taper = 1 - s * 0.35;
    const fwd = new THREE.Vector3(0, 0, 1);
    let side = new THREE.Vector3().crossVectors(t, fwd);
    if (side.lengthSq() < 1e-4) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    const off = (k % 2 ? 1 : -1) * width * 0.22 * taper;
    const pos = p.clone().addScaledVector(side, off);
    const m = new THREE.Matrix4().makeBasis(side, t, nrm).setPosition(pos);
    const tilt = new THREE.Matrix4().makeRotationZ((k % 2 ? 1 : -1) * 0.45);
    b.skin = skinAt(s);
    b.pushMatrix(m.multiply(tilt));
    b.ellipsoid(0, 0, 0, width * 0.5 * taper, (L / nl) * 0.78, width * 0.42 * taper, ctx.seg(10, 6), ctx.seg(6, 4));
    b.popMatrix();
  }
}

/** Tapered strand tube along a path (ponytails, tails, loose locks). */
function strand(ctx: BuildCtx, path: P3[], r0: number, r1: number, skinAt: (t: number) => SkinSpec, flat = 1, pal: number = PAL.HAIR): void {
  const b = ctx.b;
  const n = path.length - 1;
  b.mat(pal, HAIR_ROUGH);
  b.tube(path, (k) => lerp(r0, r1, Math.pow(k / n, 0.9)), ctx.seg(10, 6), {
    rz: (k) => lerp(r0, r1, Math.pow(k / n, 0.9)) * flat,
    capStart: true,
    capEnd: true,
    perPoint: (k) => {
      b.skin = skinAt(k / n);
    },
  });
}

/** Sample a quadratic Bezier into n+1 points. */
function bez(a: V3, c: V3, d: V3, n: number): P3[] {
  const out: P3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    out.push({ x: u * u * a[0] + 2 * u * t * c[0] + t * t * d[0], y: u * u * a[1] + 2 * u * t * c[1] + t * t * d[1], z: u * u * a[2] + 2 * u * t * c[2] + t * t * d[2] });
  }
  return out;
}

function hairChain(ctx: BuildCtx, name: string, joints: V3[], parent: number, plane?: { n: V3; d: number }): number[] {
  return ctx.addChain(
    {
      name,
      joints,
      stiffness: 0.42,
      damping: 0.85,
      gravity: 9.8,
      drag: 0.5,
      maxAngle: 1.0,
      plane: plane ? { bone: BI.chest, n: plane.n, d: plane.d } : undefined,
    },
    parent,
  );
}

function pv(p: P3): V3 {
  return [p.x, p.y, p.z];
}

// -----------------------------------------------------------------------------

export function buildHair(ctx: BuildCtx): void {
  const style = ctx.a.hair.style;
  const hooded = ctx.hooded;
  const tmp = { x: 0, y: 0, z: 0 };
  const head = BI.head;
  const rigidHead: SkinSpec = [head, 1];
  if (hooded) {
    // Only a fringe peeks out of a hood.
    if (style !== 'bald') hairCap(ctx, { top: 0.004, line: (y) => (Math.abs(y) < 1.0 ? stdLine(y) : 0.9), yaw0: -1.1, yaw1: 1.1 });
    return;
  }
  switch (style) {
    case 'bald':
      return;
    case 'short_crop':
      hairCap(ctx, { top: 0.0075, line: (y) => stdLine(y) + 0.03 });
      return;
    case 'messy_short': {
      hairCap(ctx, { top: 0.013, noise: 0.006 });
      // Tufts.
      const n = ctx.lod ? 8 : 20;
      for (let k = 0; k < n; k++) {
        const yaw = -Math.PI + ((k * 2.399) % (Math.PI * 2));
        const pitch = 0.35 + ((k * 0.618) % 1) * 1.0;
        if (Math.abs(yaw) < 0.6 && pitch < 0.75) continue;
        const base = headModel(ctx, yaw, pitch, 0.008, { x: 0, y: 0, z: 0 });
        const tip = headModel(ctx, yaw + 0.25 * Math.sin(k * 3.1), pitch + 0.2, 0.034 + 0.012 * Math.sin(k * 1.7), { x: 0, y: 0, z: 0 });
        strand(ctx, [base, tip], 0.012, 0.002, () => rigidHead, 0.7);
      }
      // Fringe pieces over the forehead.
      for (let k = -2; k <= 2; k++) {
        const yaw = k * 0.22;
        const base = headModel(ctx, yaw, 0.62, 0.012, { x: 0, y: 0, z: 0 });
        const tip = headModel(ctx, yaw + k * 0.06, 0.36 + Math.abs(k) * 0.03, 0.016, { x: 0, y: 0, z: 0 });
        strand(ctx, [base, tip], 0.011, 0.0025, () => rigidHead, 0.6);
      }
      return;
    }
    case 'topknot':
    case 'topknot_crown': {
      hairCap(ctx, { top: 0.006 });
      const c = headModel(ctx, Math.PI, 1.18, 0.022, tmp);
      ctx.b.mat(PAL.HAIR, HAIR_ROUGH);
      ctx.b.skin = rigidHead;
      ctx.b.ellipsoid(c.x, c.y + 0.012, c.z, 0.026, 0.024, 0.03, ctx.seg(12, 6), ctx.seg(8, 5));
      ctx.b.ellipsoid(c.x, c.y + 0.032, c.z + 0.002, 0.016, 0.014, 0.019, ctx.seg(10, 6), ctx.seg(6, 4));
      if (style === 'topknot_crown' && ctx.items.headwear?.shape.style !== 'crown') flameCrown(ctx, [c.x, c.y + 0.012, c.z], true);
      return;
    }
    case 'wolf_tail': {
      // Shaved sides/back (stubble), strip on top gathered into a short tail.
      hairCap(ctx, { top: 0.0012, pal: PAL.STUBBLE, rough: 0.9, line: (y) => stdLine(y) + 0.02 });
      hairCap(ctx, {
        top: 0.009,
        line: (y) => (Math.abs(y) < 0.55 ? stdLine(y) : Math.abs(y) > 2.5 ? 0.62 : lerp(0.95, 0.62, smooth01(0.55, 2.5, Math.abs(y)))),
        bulge: (yaw) => (Math.abs(yaw) > 2.3 ? 0.006 : 0),
      });
      const base = headModel(ctx, Math.PI, 0.72, 0.01, { x: 0, y: 0, z: 0 });
      const joints: V3[] = [pv(base), [base.x, base.y + 0.028, base.z - 0.045], [base.x, base.y + 0.004, base.z - 0.085]];
      const bones = hairChain(ctx, 'tail', joints, head);
      const path = bez(joints[0], [base.x, base.y + 0.045, base.z - 0.03], joints[2], 6);
      strand(ctx, path, 0.016, 0.004, (t) => ctx.chainSkin(bones, head, t), 0.8);
      ctx.b.mat(PAL.LEATHER_DARK, 0.7);
      ctx.b.skin = rigidHead;
      ctx.b.ellipsoid(base.x, base.y + 0.004, base.z - 0.006, 0.012, 0.012, 0.01, 8, 5);
      return;
    }
    case 'hair_loops': {
      hairCap(ctx, { top: 0.009, bulge: (yaw) => (Math.abs(yaw) > 2.4 ? 0.004 : 0) });
      // Braid down the back.
      const nape = headModel(ctx, Math.PI, -0.3, 0.012, { x: 0, y: 0, z: 0 });
      const joints: V3[] = [pv(nape), [nape.x, nape.y - 0.16, nape.z - 0.04], [nape.x, nape.y - 0.32, nape.z - 0.05], [nape.x, nape.y - 0.44, nape.z - 0.045]];
      const bones = hairChain(ctx, 'braid', joints, head, { n: [0, 0, -1], d: 0.1 });
      const path = bez(joints[0], [nape.x, nape.y - 0.22, nape.z - 0.06], joints[3], 8);
      braid(ctx, path, 0.042, 11, (t) => ctx.chainSkin(bones, head, t));
      // Tie.
      ctx.b.mat(PAL.ACCENT, 0.8);
      ctx.b.skin = [bones[bones.length - 1], 1];
      ctx.b.ellipsoid(path[8].x, path[8].y + 0.012, path[8].z, 0.012, 0.008, 0.012, 8, 5);
      // Two hair loops framing the face (with beads).
      for (const side of [1, -1]) {
        const top = headModel(ctx, side * 1.05, 0.28, 0.006, { x: 0, y: 0, z: 0 });
        const bottom: V3 = [top.x + side * 0.012, top.y - 0.085, top.z + 0.014];
        const loopPts: P3[] = [];
        const n = ctx.lod ? 6 : 12;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI * 2;
          const r = 0.018;
          loopPts.push({ x: lerp(top.x, bottom[0], 0.5) + side * Math.sin(a) * r * 0.6, y: lerp(top.y, bottom[1], 0.5 - 0.5 * Math.cos(a)), z: lerp(top.z, bottom[2], 0.5) + Math.sin(a) * r });
        }
        strand(ctx, loopPts, 0.0065, 0.0055, () => rigidHead, 0.9);
        ctx.b.mat(PAL.STONE2, 0.35);
        ctx.b.skin = rigidHead;
        ctx.b.ellipsoid(top.x + side * 0.004, top.y - 0.008, top.z + 0.004, 0.0068, 0.008, 0.0068, 8, 5);
      }
      return;
    }
    case 'long_braid': {
      hairCap(ctx, { top: 0.008 });
      const nape = headModel(ctx, Math.PI, -0.28, 0.012, { x: 0, y: 0, z: 0 });
      const joints: V3[] = [pv(nape), [nape.x, nape.y - 0.17, nape.z - 0.05], [nape.x, nape.y - 0.36, nape.z - 0.06], [nape.x, nape.y - 0.52, nape.z - 0.05]];
      const bones = hairChain(ctx, 'braid', joints, head, { n: [0, 0, -1], d: 0.1 });
      const path = bez(joints[0], [nape.x, nape.y - 0.25, nape.z - 0.075], joints[3], 10);
      braid(ctx, path, 0.044, 13, (t) => ctx.chainSkin(bones, head, t));
      ctx.b.mat(PAL.LEATHER_DARK, 0.7);
      ctx.b.skin = [bones[bones.length - 1], 1];
      ctx.b.ellipsoid(path[10].x, path[10].y + 0.016, path[10].z, 0.011, 0.008, 0.011, 8, 5);
      strand(ctx, [path[10], { x: path[10].x, y: path[10].y - 0.05, z: path[10].z + 0.004 }], 0.009, 0.002, () => [bones[bones.length - 1], 1]);
      return;
    }
    case 'twin_braids': {
      hairCap(ctx, { top: 0.008, line: (y) => stdLine(y) - (Math.abs(y) > 1.3 && Math.abs(y) < 2.0 ? 0.22 : 0) });
      for (const side of [1, -1]) {
        const root = headModel(ctx, side * 2.0, -0.2, 0.012, { x: 0, y: 0, z: 0 });
        const joints: V3[] = [pv(root), [root.x + side * 0.035, root.y - 0.14, root.z + 0.04], [root.x + side * 0.05, root.y - 0.3, root.z + 0.085]];
        const bones = hairChain(ctx, side > 0 ? 'braidL' : 'braidR', joints, head, { n: [0, 0, 1], d: -0.25 });
        const path = bez(joints[0], [root.x + side * 0.06, root.y - 0.1, root.z + 0.02], joints[2], 8);
        braid(ctx, path, 0.034, 9, (t) => ctx.chainSkin(bones, head, t));
        ctx.b.mat(PAL.ACCENT, 0.8);
        ctx.b.skin = [bones[bones.length - 1], 1];
        ctx.b.ellipsoid(path[8].x, path[8].y + 0.012, path[8].z, 0.0095, 0.007, 0.0095, 8, 5);
      }
      return;
    }
    case 'high_ponytail': {
      hairCap(ctx, { top: 0.007 });
      const base = headModel(ctx, Math.PI, 0.78, 0.012, { x: 0, y: 0, z: 0 });
      const joints: V3[] = [pv(base), [base.x, base.y - 0.1, base.z - 0.09], [base.x, base.y - 0.25, base.z - 0.1], [base.x, base.y - 0.38, base.z - 0.08]];
      const bones = hairChain(ctx, 'ponytail', joints, head, { n: [0, 0, -1], d: 0.1 });
      const path = bez(joints[0], [base.x, base.y + 0.02, base.z - 0.12], joints[3], 10);
      strand(ctx, path, 0.036, 0.006, (t) => ctx.chainSkin(bones, head, t), 0.85);
      ctx.b.mat(PAL.ACCENT, 0.8);
      ctx.b.skin = rigidHead;
      ctx.b.ellipsoid(base.x, base.y, base.z - 0.012, 0.016, 0.016, 0.012, 8, 5);
      return;
    }
    case 'bun': {
      hairCap(ctx, { top: 0.007 });
      const c = headModel(ctx, Math.PI, 0.32, 0.03, { x: 0, y: 0, z: 0 });
      ctx.b.mat(PAL.HAIR, HAIR_ROUGH);
      ctx.b.skin = rigidHead;
      ctx.b.ellipsoid(c.x, c.y, c.z, 0.037, 0.034, 0.03, ctx.seg(14, 8), ctx.seg(10, 6), (q, nx, ny) => {
        q.x += Math.sin(ny * 9 + nx * 3) * 0.0012;
      });
      // Hairpin.
      ctx.b.mat(PAL.WOOD, 0.6);
      strand(ctx, [{ x: c.x - 0.06, y: c.y + 0.018, z: c.z - 0.004 }, { x: c.x + 0.065, y: c.y - 0.014, z: c.z - 0.006 }], 0.0035, 0.0028, () => rigidHead, 1, PAL.WOOD);
      return;
    }
    case 'double_buns': {
      hairCap(ctx, { top: 0.007 });
      for (const side of [1, -1]) {
        const c = headModel(ctx, side * 2.25, 0.82, 0.026, { x: 0, y: 0, z: 0 });
        ctx.b.mat(PAL.HAIR, HAIR_ROUGH);
        ctx.b.skin = rigidHead;
        ctx.b.ellipsoid(c.x, c.y, c.z, 0.03, 0.03, 0.03, ctx.seg(12, 8), ctx.seg(8, 5), (q, nx, ny) => {
          q.y += Math.sin(nx * 8 + ny * 5) * 0.0012;
        });
        ctx.b.mat(PAL.ACCENT, 0.7);
        ctx.b.ellipsoid(c.x * 0.98, c.y - 0.02, c.z * 0.98, 0.024, 0.006, 0.024, 10, 4);
      }
      return;
    }
    case 'long_loose': {
      hairCap(ctx, { top: 0.011, bulge: (yaw) => (Math.abs(yaw) > 1.8 ? 0.006 : 0) });
      // Curtain of hair down the back to the shoulder blades.
      const b = ctx.b;
      const joints: V3[] = [[0, 1.6, -0.1], [0, 1.43, -0.15], [0, 1.27, -0.16]];
      const bones = hairChain(ctx, 'hair', joints, head, { n: [0, 0, -1], d: 0.09 });
      const cols = ctx.seg(18, 8), rows = ctx.seg(10, 5);
      const p = { x: 0, y: 0, z: 0 };
      b.mat(PAL.HAIR, HAIR_ROUGH);
      b.grid(
        cols,
        rows,
        (i, j, u, _v, out) => {
          const yaw = lerp(-1.95, 1.95, u);
          const ay = yaw < 0 ? -Math.PI - yaw : Math.PI - yaw; // through the back
          const t = j / rows;
          headModel(ctx, ay, 0.15, 0.013, p);
          const endY = 1.27 + 0.05 * Math.abs(u - 0.5) * 2 + (ctx.lod ? 0 : 0.012 * hashNoise(i));
          const spread = 1 + 0.25 * t;
          out.x = p.x * spread;
          out.y = lerp(p.y, endY, t);
          out.z = lerp(p.z, Math.min(p.z, -0.12) - 0.035 * t, Math.pow(t, 0.6));
          b.skin = t < 0.15 ? [head, 1] : ctx.chainSkin(bones, head, (t - 0.1) / 0.9);
        },
        { flip: false, double: true },
      );
      // Face-framing locks.
      for (const side of [1, -1]) {
        const top = headModel(ctx, side * 1.15, 0.3, 0.008, { x: 0, y: 0, z: 0 });
        const path = bez(pv(top), [top.x + side * 0.022, top.y - 0.08, top.z - 0.005], [top.x + side * 0.03, top.y - 0.2, top.z + 0.01], 6);
        strand(ctx, path, 0.016, 0.005, (t) => (t < 0.3 ? [head, 1] : [head, 0.6, BI.neck, 0.4]), 0.45);
      }
      return;
    }
    case 'bob': {
      const line: Hairline = (y) => (Math.abs(y) < 0.95 ? 0.2 : Math.abs(y) < 1.25 ? lerp(0.2, -0.38, smooth01(0.95, 1.25, Math.abs(y))) : -0.42);
      hairCap(ctx, { top: 0.012, line, edge: (y) => (Math.abs(y) < 0.95 ? 0.011 : 0.016), bulge: (yaw, pitch) => (pitch < 0 ? 0.01 : 0.004) + (Math.abs(yaw) > 1.2 ? 0.004 : 0) });
      return;
    }
    case 'spiky': {
      hairCap(ctx, { top: 0.012 });
      const n = ctx.lod ? 8 : 16;
      for (let k = 0; k < n; k++) {
        const yaw = -Math.PI + ((k * 2.399 + 0.3) % (Math.PI * 2));
        const pitch = 0.3 + ((k * 0.381) % 1) * 1.1;
        const base = headModel(ctx, yaw, pitch, 0.006, { x: 0, y: 0, z: 0 });
        const len = 0.055 + 0.03 * ((k * 0.73) % 1);
        const tip = headModel(ctx, yaw * 0.85 + (yaw > 0 ? 0.25 : -0.25) * (Math.abs(yaw) > 0.3 ? 1 : 0), Math.min(1.45, pitch + 0.35), len, { x: 0, y: 0, z: 0 });
        strand(ctx, [base, { x: lerp(base.x, tip.x, 0.5), y: lerp(base.y, tip.y, 0.5) + 0.006, z: lerp(base.z, tip.z, 0.5) }, tip], 0.02, 0.0015, () => rigidHead, 0.75);
      }
      return;
    }
    case 'side_shave': {
      // Right side shaved; long top swept over to the left.
      hairCap(ctx, { top: 0.0012, pal: PAL.STUBBLE, rough: 0.9, yaw0: -Math.PI, yaw1: 0.2 });
      hairCap(ctx, {
        top: 0.016,
        line: (y) => (y < -0.25 ? lerp(0.95, 0.6, smooth01(-0.25, -2.6, y)) : stdLine(y) - (y > 1.0 && y < 2.2 ? 0.25 : 0)),
        bulge: (yaw) => (yaw > 0.4 && yaw < 2.0 ? 0.008 : 0.0),
      });
      // Swept lock falling over the left side.
      const top = headModel(ctx, 0.25, 0.95, 0.014, { x: 0, y: 0, z: 0 });
      const path = bez(pv(top), [top.x + 0.07, top.y + 0.01, top.z + 0.03], [top.x + 0.11, top.y - 0.1, top.z + 0.02], 7);
      strand(ctx, path, 0.026, 0.006, () => rigidHead, 0.5);
      return;
    }
    default:
      hairCap(ctx, { top: 0.008 });
  }
}

// -----------------------------------------------------------------------------
// Flame crown (Fire Nation topknot ornament)
// -----------------------------------------------------------------------------

export function flameCrown(ctx: BuildCtx, c: V3, gold: boolean, prongs = 5): void {
  const b = ctx.b;
  b.mat(gold ? PAL.GOLD : PAL.METAL_DARK, 0.3, gold ? 0.7 : 0.4);
  b.skin = [BI.head, 1];
  // Band.
  b.grid(
    ctx.seg(16, 8),
    1,
    (_i, j, u, _v, out) => {
      const a = u * Math.PI * 2;
      out.x = c[0] + Math.sin(a) * 0.022;
      out.y = c[1] + j * 0.014 - 0.004;
      out.z = c[2] + Math.cos(a) * 0.025;
    },
    { closedU: true, double: true },
  );
  // Flame prongs (front-facing).
  const np = gold ? prongs : 3;
  for (let k = 0; k < np; k++) {
    const t = np === 1 ? 0 : (k / (np - 1)) * 2 - 1;
    const h = (gold ? 0.05 : 0.038) * (1 - Math.abs(t) * 0.45);
    const base = { x: c[0] + t * 0.017, y: c[1] + 0.008, z: c[2] + 0.02 - Math.abs(t) * 0.006 };
    const tip = { x: base.x + t * 0.008, y: base.y + h, z: base.z - 0.006 };
    const mid = { x: lerp(base.x, tip.x, 0.5) - t * 0.004, y: lerp(base.y, tip.y, 0.55), z: base.z + 0.002 };
    b.tube([base, mid, tip], (i) => (i === 0 ? 0.0065 : i === 1 ? 0.0048 : 0.0005), 6, { rz: (i) => (i === 0 ? 0.0028 : i === 1 ? 0.0022 : 0.0004), capStart: true, up: { x: 0, y: 0, z: 1 } });
  }
}

// -----------------------------------------------------------------------------
// Facial hair
// -----------------------------------------------------------------------------

export function buildFacialHair(ctx: BuildCtx): void {
  const fh = ctx.a.facialHair;
  if (!fh || fh === 'none') return;
  const b = ctx.b;
  const f = ctx.face;
  const H = ctx.J('head');
  const head = BI.head;
  const rigidHead: SkinSpec = [head, 1];
  const p = { x: 0, y: 0, z: 0 };
  // Beard region shell over the jaw: yaw range and pitch range per style.
  const beardShell = (pal: number, thick: number, pitchTop: (yaw: number) => number, yawMax: number, volume = 0) => {
    const nu = ctx.seg(24, 10), nv = ctx.seg(8, 4);
    b.mat(pal, pal === PAL.STUBBLE ? 0.95 : HAIR_ROUGH);
    b.skin = rigidHead;
    b.grid(
      nu,
      nv,
      (_i, j, u, v, out) => {
        const yaw = lerp(-yawMax, yawMax, u);
        const top = pitchTop(yaw);
        const pitch = lerp(top, -1.15, v);
        const e = Math.min(1, Math.min(v * 4, 1) * Math.min((1 - Math.abs(u * 2 - 1)) * 5, 1));
        const vol = volume * Math.sin(Math.PI * Math.min(1, v * 1.2)) * (1 - Math.abs(yaw) / yawMax) * 0.5;
        headModel(ctx, yaw, pitch, thick * (0.25 + 0.75 * e) + vol, p);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        void j;
      },
      { flip: false },
    );
  };
  // Mouth height (approx) for mustaches.
  const mouthPitch = -0.52;
  const mustache = (droop: number, len: number) => {
    for (const side of [1, -1]) {
      const a = faceSpot(f, side * 0.004, HEAD_Y_MOUTH(ctx) + 0.008);
      const c = faceSpot(f, side * 0.022, HEAD_Y_MOUTH(ctx) + 0.004);
      const pts: P3[] = [
        { x: H[0] + a.p.x, y: H[1] + a.p.y, z: H[2] + a.p.z + 0.004 },
        { x: H[0] + c.p.x + side * 0.004, y: H[1] + c.p.y - 0.004, z: H[2] + c.p.z + 0.004 },
      ];
      if (len > 0) pts.push({ x: H[0] + c.p.x + side * 0.012, y: H[1] + c.p.y - len, z: H[2] + c.p.z - 0.002 + droop * 0.0 });
      strand(ctx, pts, 0.0045, len > 0 ? 0.0012 : 0.003, () => rigidHead, 0.7);
    }
  };
  void mouthPitch;
  switch (fh) {
    case 'stubble':
      beardShell(PAL.STUBBLE, 0.0012, (yaw) => lerp(-0.18, -0.42, Math.min(1, Math.abs(yaw) / 0.35)) + (Math.abs(yaw) < 0.3 ? -0.0 : 0), 1.45);
      break;
    case 'goatee': {
      const c = faceSpot(f, 0, HEAD_Y_MOUTH(ctx) - 0.022);
      b.mat(PAL.HAIR, HAIR_ROUGH);
      b.skin = rigidHead;
      b.ellipsoid(H[0] + c.p.x, H[1] + c.p.y - 0.004, H[2] + c.p.z + 0.002, 0.013, 0.016, 0.009, 10, 6);
      strand(ctx, [{ x: H[0], y: H[1] + c.p.y - 0.008, z: H[2] + c.p.z + 0.004 }, { x: H[0], y: H[1] + c.p.y - 0.045, z: H[2] + c.p.z + 0.008 }], 0.01, 0.002, () => rigidHead, 0.8);
      mustache(0, 0);
      break;
    }
    case 'mustache':
      mustache(1, 0.05);
      break;
    case 'beard_short':
      beardShell(PAL.HAIR, 0.007, (yaw) => (Math.abs(yaw) < 0.42 ? -0.6 : lerp(-0.15, -0.3, smooth01(0.42, 1.4, Math.abs(yaw)))), 1.45, 0.006);
      mustache(0, 0);
      break;
    case 'beard_long': {
      beardShell(PAL.HAIR, 0.008, (yaw) => (Math.abs(yaw) < 0.42 ? -0.6 : lerp(-0.15, -0.3, smooth01(0.42, 1.4, Math.abs(yaw)))), 1.45, 0.008);
      mustache(1, 0.03);
      const chin = faceSpot(f, 0, HEAD_Y_MOUTH(ctx) - 0.03);
      const start: V3 = [H[0], H[1] + chin.p.y, H[2] + chin.p.z - 0.008];
      const joints: V3[] = [start, [start[0], start[1] - 0.09, start[2] + 0.012], [start[0], start[1] - 0.19, start[2] + 0.01]];
      const bones = ctx.addChain({ name: 'beard', joints, stiffness: 0.55, damping: 0.85, gravity: 9.8, drag: 0.3, maxAngle: 0.7, plane: { bone: BI.chest, n: [0, 0, 1], d: -0.13 } }, head);
      const path = bez(joints[0], [start[0], start[1] - 0.08, start[2] + 0.025], joints[2], 6);
      strand(ctx, path, 0.032, 0.004, (t) => (t < 0.12 ? [head, 1] : ctx.chainSkin(bones, head, t)), 0.55);
      break;
    }
    case 'sideburns':
      for (const side of [1, -1]) {
        b.mat(PAL.HAIR, HAIR_ROUGH);
        b.skin = rigidHead;
        b.grid(
          4,
          ctx.seg(6, 3),
          (_i, _j, u, v, out) => {
            const yaw = side * lerp(1.28, 1.42, u);
            const pitch = lerp(0.05, -0.42, v);
            headModel(ctx, yaw, pitch, 0.003 * (1 - v * 0.5), p);
            out.x = p.x;
            out.y = p.y;
            out.z = p.z;
          },
          { flip: side < 0 },
        );
      }
      break;
  }
}

/** Approximate head-local mouth height (mirrors buildMouth placement). */
function HEAD_Y_MOUTH(ctx: BuildCtx): number {
  const f = ctx.face;
  const eyeY = 0.105 - 0.006;
  const yTip = eyeY + 0.004 - 0.041 * f.noseLen + Math.max(0, -f.noseBridge) * 0.0025;
  return yTip - 0.0075 - 0.0135 - (f.faceLen - 1) * 0.01;
}

// -----------------------------------------------------------------------------
// Scars
// -----------------------------------------------------------------------------

export function buildScars(ctx: BuildCtx): void {
  const b = ctx.b;
  const f = ctx.face;
  const H = ctx.J('head');
  const rigidHead: SkinSpec = [BI.head, 1];
  const p = { x: 0, y: 0, z: 0 };
  for (const s of ctx.a.scars) {
    switch (s) {
      case 'eye_burn_l': {
        // Irregular burn patch around the left eye spreading toward the ear.
        b.mat(PAL.BURN, 0.75);
        b.skin = rigidHead;
        const eyeYaw = Math.asin(Math.min(0.9, f.eyeX / f.rx)) * 1.05;
        b.grid(
          ctx.seg(16, 8),
          ctx.seg(12, 6),
          (i, j, u, v, out) => {
            const ang = u * Math.PI * 2;
            const rad = v * (0.32 + 0.06 * Math.sin(ang * 3 + 1) + (ctx.lod ? 0 : 0.035 * hashNoise(i, 7)));
            const yaw = eyeYaw + Math.cos(ang) * rad * (Math.cos(ang) > 0 ? 1.35 : 0.8);
            const pitch = -0.02 + Math.sin(ang) * rad * 0.9;
            headModel(ctx, yaw, pitch, 0.0011 + 0.0006 * (1 - v), p);
            out.x = p.x;
            out.y = p.y;
            out.z = p.z;
            void j;
          },
          { closedU: true, flip: true },
        );
        break;
      }
      case 'cheek_r': {
        b.mat(PAL.SCAR, 0.7);
        b.skin = rigidHead;
        const a = faceSpot(f, -0.052, 0.07), c = faceSpot(f, -0.04, 0.045);
        strand(ctx, [
          { x: H[0] + a.p.x + a.n.x * 0.001, y: H[1] + a.p.y, z: H[2] + a.p.z + a.n.z * 0.001 },
          { x: H[0] + c.p.x + c.n.x * 0.001, y: H[1] + c.p.y, z: H[2] + c.p.z + c.n.z * 0.001 },
        ], 0.0016, 0.001, () => rigidHead, 0.5, PAL.SCAR);
        break;
      }
      case 'brow_l': {
        const a = faceSpot(f, f.eyeX + 0.002, 0.138), c = faceSpot(f, f.eyeX - 0.002, 0.118);
        strand(ctx, [
          { x: H[0] + a.p.x + a.n.x * 0.0012, y: H[1] + a.p.y, z: H[2] + a.p.z + a.n.z * 0.0012 },
          { x: H[0] + c.p.x + c.n.x * 0.0012, y: H[1] + c.p.y, z: H[2] + c.p.z + c.n.z * 0.0012 },
        ], 0.0014, 0.0009, () => rigidHead, 0.5, PAL.SCAR);
        break;
      }
      case 'chin': {
        const a = faceSpot(f, 0.008, HEAD_Y_MOUTH(ctx) - 0.02), c = faceSpot(f, 0.016, HEAD_Y_MOUTH(ctx) - 0.032);
        strand(ctx, [
          { x: H[0] + a.p.x + a.n.x * 0.0012, y: H[1] + a.p.y, z: H[2] + a.p.z + a.n.z * 0.0012 },
          { x: H[0] + c.p.x + c.n.x * 0.0012, y: H[1] + c.p.y, z: H[2] + c.p.z + c.n.z * 0.0012 },
        ], 0.0015, 0.001, () => rigidHead, 0.5, PAL.SCAR);
        break;
      }
      case 'lightning_back': {
        // Branching starburst on the upper back; one branch climbs the nape.
        b.mat(PAL.SCAR, 0.7);
        const center: V3 = [0.02, 1.33, 0];
        const branches = [
          [0, 0.17, 0.0],
          [0.6, 0.12, 0.3],
          [-0.7, 0.13, -0.2],
          [2.4, 0.1, 0.4],
          [-2.5, 0.11, 0],
          [3.1, 0.08, 0],
        ];
        for (const [ang, len, kink] of branches) {
          const pts: P3[] = [];
          for (let k = 0; k <= 4; k++) {
            const t = k / 4;
            const y = center[1] + Math.cos(ang) * len * t + Math.sin(t * 9 + kink) * 0.006;
            const x = center[0] + Math.sin(ang) * len * t + Math.cos(t * 7 + kink) * 0.006;
            const back = surfaceBack(ctx, x, y);
            pts.push({ x, y, z: back + (y > 1.44 ? -0.004 : -0.0015) });
          }
          b.skin = [BI.chest, 1];
          b.tube(pts, (k) => 0.0028 * (1 - k / 5), 5, { capEnd: true });
        }
        break;
      }
    }
  }
}

/** z of the back surface (torso core or neck) at (x, y). */
function surfaceBack(ctx: BuildCtx, x: number, y: number): number {
  if (y > 1.47) {
    const r = 0.05 * ctx.rig.dims.neck;
    return -Math.sqrt(Math.max(0, r * r - x * x)) - 0.002;
  }
  // Torso superellipse back.
  const rows: number[][] = [
    [1.15, 0.137, 0.093, 0.009],
    [1.29, 0.159, 0.108, 0.017],
    [1.395, 0.168, 0.092, 0.002],
    [1.45, 0.105, 0.066, -0.008],
  ];
  const hw = sampleTable(rows, y, 1) * ctx.rig.dims.chestW;
  const hd = sampleTable(rows, y, 2) * ctx.rig.dims.depth;
  const z0 = sampleTable(rows, y, 3);
  const s = Math.min(0.999, Math.abs(x) / hw);
  const c = Math.pow(1 - Math.pow(s, 2.3), 1 / 2.3);
  return z0 - hd * c;
}
