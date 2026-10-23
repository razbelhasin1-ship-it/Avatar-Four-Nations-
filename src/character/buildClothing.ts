import { PAL, TAT, blend2, mixSkin, type P3, type SkinSpec } from './CharMesh';
import type { V3 } from './CharShape';
import { armRadius, furRing, lineDist, sleeveInfo, torsoAt, torsoSkin } from './buildBody';
import { BI, atlasUV, hashNoise, lerp, loftY, sampleTable, shapeBool, shapeNum, shapeStr, smooth01, wrapA, type BuildCtx, type Ring } from './buildUtil';

/**
 * Clothing builders driven by src/data/cosmetics.ts `shape` parameters.
 * Garments are shells around the body sharing its skin weights, so they move
 * without poking through; long robes and skirts are weighted toward the thighs.
 */

const CLOTH_ROUGH = 0.88;
const SE = 2 / 2.3; // torso superellipse exponent

function seSin(th: number): number {
  const s = Math.sin(th);
  return Math.sign(s) * Math.pow(Math.abs(s), SE);
}
function seCos(th: number): number {
  const c = Math.cos(th);
  return Math.sign(c) * Math.pow(Math.abs(c), SE);
}

/** Point on a torso-hugging shell at height y, angle th, outward offset `off`. Below the hips the skirt flares. */
function shellPoint(ctx: BuildCtx, y: number, th: number, off: number, flare: number, out: P3): { hw: number; hd: number } {
  const yy = Math.max(0.9, y);
  const t = torsoAt(ctx, yy);
  let hw = t.hw + off;
  let hd = t.hd + off;
  let z0 = t.z;
  if (y < 0.98) {
    // Clear the thighs: hips are at least hip-joint + thigh radius wide.
    const k = smooth01(0.98, 0.86, y);
    hw = Math.max(hw, lerp(hw, ctx.rig.dims.hip + 0.098 * ctx.rig.dims.limb + off, k));
    hd = Math.max(hd, lerp(hd, 0.112 * ctx.rig.dims.limb + off, k));
  }
  if (y < 0.9) {
    const d = 0.9 - y;
    hw *= 1 + flare * d * 0.85;
    hd *= 1 + flare * d * 1.25;
    z0 += d * 0.02;
  }
  out.x = hw * seSin(th);
  out.y = y;
  out.z = z0 + hd * seCos(th);
  return { hw, hd };
}

/** Skin weights for skirt/robe vertices: hips blending into the thighs below the crotch. */
export function skirtSkin(y: number, th: number, hw: number): SkinSpec {
  if (y >= 0.94) return torsoSkin(y, th, hw);
  const k = smooth01(0.94, 0.5, y) * 0.78;
  const side = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(th) * 1.5));
  return mixSkin([
    [[BI.hips, 1], 1 - k],
    [[BI.thighL, 1], k * side],
    [[BI.thighR, 1], k * (1 - side)],
  ]);
}

// -----------------------------------------------------------------------------
// Top garment shell
// -----------------------------------------------------------------------------

const HEM_Y: Record<string, number> = { waist: 1.0, hip: 0.86, thigh: 0.68, knee: 0.47, ankle: 0.13 };

export function buildTop(ctx: BuildCtx): void {
  const top = ctx.items.top;
  if (!top) return;
  const b = ctx.b;
  const collar = shapeStr(top, 'collar', 'round');
  const length = shapeStr(top, 'length', 'hip');
  const fur = shapeBool(top, 'fur');
  const pattern = shapeStr(top, 'pattern', 'none');
  const layered = shapeNum(top, 'layers', 1) >= 2;
  const armor = shapeBool(top, 'armor');
  const sleeves = shapeStr(top, 'sleeves', 'long');
  const thick = fur ? 0.02 : armor ? 0.014 : 0.0105;
  let hemY = HEM_Y[length] ?? 0.86;
  const innerHem = layered ? (length === 'ankle' ? 0.12 : length === 'knee' ? 0.4 : hemY - 0.14) : hemY;
  if (layered) hemY = length === 'ankle' ? 0.38 : length === 'knee' ? 0.6 : hemY;
  const flare = length === 'ankle' ? 0.62 : length === 'knee' ? 0.58 : length === 'thigh' ? 0.5 : 0.35;
  const open = collar === 'v' && (length === 'knee' || length === 'ankle');
  const neckTop = 1.468;
  const dipFor = (c: string) => (c === 'v' ? 0.2 : c === 'wrap' ? 0.15 : c === 'round' ? 0.014 : 0.005);
  const yTopFn = (c: string, scale = 1) => (th: number) => {
    const dip = dipFor(c) * scale;
    if (c === 'v' || c === 'wrap') {
      const center = c === 'wrap' ? 0.12 : 0;
      const W = c === 'wrap' ? (th > center ? 0.95 : 0.7) : 0.85;
      const k = Math.max(0, 1 - Math.abs(th - center) / W);
      return neckTop - dip * Math.pow(k, 1.25);
    }
    return neckTop - dip * Math.pow(Math.max(0, Math.cos(th)), 2.2);
  };
  const circ = 2 * Math.PI * 0.14;
  ctx.atlas.top = {
    pattern,
    collar,
    lengthM: neckTop - hemY,
    circM: circ,
    waistV: (neckTop - 1.04) / (neckTop - hemY),
    layered,
    fur,
    open,
  };

  const shell = (yTop: (th: number) => number, hem: number, off: number, region: 'top' | 'layer', pal: number) => {
    const rows = Math.max(6, Math.round(((neckTop - hem) / 0.028) * (ctx.lod ? 0.5 : 1)));
    const segs = ctx.seg(34, 14);
    const p = { x: 0, y: 0, z: 0 };
    const uv = { u: 0, v: 0 };
    b.mat(pal, CLOTH_ROUGH);
    b.grid(
      segs,
      rows,
      (_i, j, u, _v, out) => {
        const th = -Math.PI + u * Math.PI * 2;
        const s = j / rows;
        const y0 = yTop(th);
        const y = y0 + (hem - y0) * s;
        const extra = off + 0.004 * smooth01(1.0, 0.9, y);
        const r = shellPoint(ctx, y, th, extra, flare, p);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        b.skin = skirtSkin(y, th, r.hw);
        atlasUV(region, u, s, uv);
        b.u = uv.u;
        b.v = uv.v;
      },
      { closedU: true, flip: true, double: hem < 0.9 },
    );
  };
  // Inner layer first (visible in the V and below the outer hem).
  if (layered) shell(yTopFn(collar === 'high' ? 'round' : collar, 0.55), innerHem, thick - 0.005, 'layer', PAL.ATLAS);
  shell(yTopFn(collar), hemY, thick, 'top', PAL.ATLAS);
  if (layered) ctx.atlas.layer = { pattern: pattern === 'none' ? 'trim' : pattern, lengthM: neckTop - innerHem, circM: circ };

  // Collars.
  const neckR = 0.05 * ctx.rig.dims.neck;
  if (collar === 'high') {
    const rings: Ring[] = [
      { c: [0, 1.452, -0.004], rx: neckR + 0.022, rz: neckR + 0.024, skin: [BI.chest, 0.6, BI.neck, 0.4] },
      { c: [0, 1.49, -0.002], rx: neckR + 0.016, rz: neckR + 0.018, skin: [BI.neck, 1] },
      { c: [0, 1.525, -0.002], rx: neckR + 0.018, rz: neckR + 0.02, skin: [BI.neck, 1] },
    ];
    b.mat(fur ? PAL.FUR : PAL.TRIM, fur ? 1 : 0.8);
    if (fur) furRing(ctx, [0, 1.47, -0.003], neckR + 0.03, neckR + 0.032, 0.02, [BI.chest, 0.5, BI.neck, 0.5]);
    else loftY(ctx, rings, ctx.seg(24, 10), { double: true });
  } else if (collar === 'hood') {
    // Folded-down hood resting on the upper back.
    b.mat(PAL.PRIMARY, CLOTH_ROUGH);
    b.skin = [BI.chest, 0.7, BI.neck, 0.3];
    b.ellipsoid(0, 1.43, -0.105, 0.12, 0.07, 0.06, ctx.seg(16, 8), ctx.seg(10, 6), (q) => {
      if (q.z > -0.08) q.z = -0.08 + (q.z + 0.08) * 0.4;
    });
    if (fur) {
      b.mat(PAL.FUR, 1);
      furRing(ctx, [0, 1.47, -0.01], neckR + 0.04, neckR + 0.055, 0.018, [BI.chest, 0.5, BI.neck, 0.5]);
    }
  } else if (fur) {
    b.mat(PAL.FUR, 1);
    furRing(ctx, [0, 1.462, -0.004], neckR + 0.028, neckR + 0.03, 0.016, [BI.chest, 0.5, BI.neck, 0.5]);
  }

  // Fur trims at hem and cuffs.
  if (fur) {
    b.mat(PAL.FUR, 1);
    const hp = { x: 0, y: 0, z: 0 };
    const r = shellPoint(ctx, hemY, 0, thick, flare, hp);
    furRing(ctx, [0, hemY + 0.006, hp.z - r.hd], r.hw * 1.02, r.hd * 1.02, 0.017, (th) => skirtSkin(hemY, th, r.hw));
    const sl = sleeveInfo(ctx);
    if (sl.end < 0.04) {
      for (const side of [1, -1]) {
        const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
        const ar = armRadius(ctx, sl.end);
        const fa = side > 0 ? BI.foreArmL : BI.foreArmR;
        const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
        furRing(ctx, [A[0], A[1] + sl.end + 0.008, A[2]], ar.rx * sl.loose + 0.012, ar.rz * sl.loose + 0.012, 0.012, sl.end < -0.3 ? [fa, 1] : [ua, 1]);
      }
    }
  }

  if (armor) buildArmor(ctx, thick);
  if (sleeves === 'wide') buildBellSleeves(ctx, fur);
}

function buildArmor(ctx: BuildCtx, thick: number): void {
  const b = ctx.b;
  b.mat(PAL.SECONDARY, 0.45, 0.25);
  // Lamellar chest rows (front and sides).
  const rows = ctx.lod ? 3 : 5;
  for (let r = 0; r < rows; r++) {
    const yA = 1.37 - r * 0.062;
    const yB = yA - 0.058;
    const off = thick + 0.008 + r * 0.0015;
    const p = { x: 0, y: 0, z: 0 };
    b.grid(
      ctx.seg(22, 10),
      2,
      (_i, j, u, _v, out) => {
        const th = -1.75 + u * 3.5;
        const y = j === 0 ? yA : j === 1 ? (yA + yB) / 2 : yB;
        const o = off + (j === 2 ? 0.006 : j === 1 ? 0.003 : 0);
        const rr = shellPoint(ctx, y, th, o, 0, p);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        b.skin = torsoSkin(y, th, rr.hw);
      },
      { flip: true, double: true },
    );
  }
  // Gold edge band on the top row.
  b.mat(PAL.ACCENT, 0.4, 0.5);
  {
    const p = { x: 0, y: 0, z: 0 };
    b.grid(ctx.seg(22, 10), 1, (_i, j, u, _v, out) => {
      const th = -1.75 + u * 3.5;
      const y = 1.375 - j * 0.012;
      const rr = shellPoint(ctx, y, th, thick + 0.011, 0, p);
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
      b.skin = torsoSkin(y, th, rr.hw);
    }, { flip: true });
  }
  // Tassets (hip plates).
  b.mat(PAL.SECONDARY, 0.45, 0.25);
  for (let r = 0; r < 2; r++) {
    const yA = 1.0 - r * 0.075;
    const yB = yA - 0.11;
    const p = { x: 0, y: 0, z: 0 };
    b.grid(
      ctx.seg(26, 12),
      1,
      (_i, j, u, _v, out) => {
        const th = -Math.PI + u * Math.PI * 2;
        const y = j === 0 ? yA : yB;
        const rr = shellPoint(ctx, y, th, thick + 0.016 + r * 0.004 + (j ? 0.018 : 0), 0.4, p);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        b.skin = skirtSkin(y, th, rr.hw);
      },
      { closedU: true, flip: true, double: true },
    );
  }
  buildPauldrons(ctx, false, PAL.SECONDARY);
}

/** Layered shoulder plates (optionally spiked). */
export function buildPauldrons(ctx: BuildCtx, spikes: boolean, pal: number): void {
  const b = ctx.b;
  for (const side of [1, -1]) {
    const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
    const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
    const sh = side > 0 ? BI.shoulderL : BI.shoulderR;
    for (let k = 0; k < 3; k++) {
      const r = 0.078 - k * 0.006;
      const cy = A[1] + 0.035 - k * 0.042;
      b.mat(k === 0 ? pal : pal, 0.42, 0.3);
      b.grid(
        ctx.seg(14, 8),
        ctx.seg(6, 3),
        (_i, j, u, v, out) => {
          // Spherical cap over the shoulder, tilted outward.
          const az = -1.5 + u * 3.0; // around front-side-back
          const pol = 0.25 + v * 0.95;
          const sx = Math.sin(pol) * Math.cos(az), sy = Math.cos(pol), sz = Math.sin(pol) * Math.sin(az);
          out.x = A[0] + side * (0.012 + sx * r);
          out.y = cy + sy * r * 0.62 - 0.01;
          out.z = A[2] + sz * r * 0.95;
          b.skin = k === 0 ? [sh, 0.4, ua, 0.6] : [ua, 1];
          void j;
        },
        { flip: side < 0, double: true },
      );
    }
    if (spikes) {
      b.mat(PAL.GOLD, 0.35, 0.6);
      b.skin = [sh, 0.4, ua, 0.6];
      const base = { x: A[0] + side * 0.06, y: A[1] + 0.055, z: A[2] };
      b.tube([base, { x: base.x + side * 0.035, y: base.y + 0.06, z: base.z }], (k) => (k === 0 ? 0.014 : 0.0005), 8, { capStart: true });
    }
  }
}

function buildBellSleeves(ctx: BuildCtx, fur: boolean): void {
  const b = ctx.b;
  for (const side of [1, -1]) {
    const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
    const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
    const fa = side > 0 ? BI.foreArmL : BI.foreArmR;
    const dys = [-0.22, -0.3, -0.38, -0.46, -0.54, -0.585];
    const rings: Ring[] = dys.map((dy, i) => {
      const r = armRadius(ctx, dy);
      const k = i / (dys.length - 1);
      const flareR = lerp(r.rx * 1.35 + 0.006, 0.098, Math.pow(k, 0.85));
      return {
        c: [A[0] + side * 0.004 * k, A[1] + dy, A[2] - 0.012 * k] as V3,
        rx: flareR * 0.92,
        rz: flareR * 1.08,
        skin: i === 0 ? blend2(ua, fa, 0.6) : [fa, 1],
        v: 0.5 + 0.5 * k,
        dy: (th: number) => -Math.max(0, -Math.cos(th)) * 0.035 * k,
      };
    });
    b.mat(PAL.ATLAS, CLOTH_ROUGH);
    loftY(ctx, rings, ctx.seg(20, 10), { region: 'sleeve', double: true });
    if (fur) {
      b.mat(PAL.FUR, 1);
      furRing(ctx, [A[0] + side * 0.004, A[1] - 0.58, A[2] - 0.012], 0.092, 0.104, 0.012, [fa, 1]);
    }
  }
  ctx.atlas.sleeve = { pattern: shapeStr(ctx.items.top, 'pattern', 'trim'), wide: true, lengthM: 0.62, circM: 0.5 };
}

// -----------------------------------------------------------------------------
// Legs & bottoms
// -----------------------------------------------------------------------------

/** Leg profile: depth below the hip joint (ascending), rx, rz, z offset. */
const LEG_ROWS: number[][] = [
  [-0.07, 0.07, 0.07, -0.004],
  [0.0, 0.083, 0.086, -0.006],
  [0.1, 0.08, 0.08, -0.004],
  [0.22, 0.072, 0.072, 0.0],
  [0.34, 0.061, 0.061, 0.002],
  [0.425, 0.053, 0.055, 0.006],
  [0.5, 0.055, 0.058, -0.006],
  [0.6, 0.053, 0.056, -0.008],
  [0.72, 0.041, 0.041, -0.004],
  [0.8, 0.034, 0.035, 0.0],
  [0.84, 0.033, 0.034, 0.002],
];

export function legRadius(ctx: BuildCtx, dy: number): { rx: number; rz: number; z: number } {
  const k = ctx.rig.dims.limb * (0.93 + ctx.a.build * 0.14);
  const d = -dy;
  return { rx: sampleTable(LEG_ROWS, d, 1) * k, rz: sampleTable(LEG_ROWS, d, 2) * k, z: sampleTable(LEG_ROWS, d, 3) };
}

function legSkin(side: number, dy: number): SkinSpec {
  const th = side > 0 ? BI.thighL : BI.thighR;
  const sh = side > 0 ? BI.shinL : BI.shinR;
  const ft = side > 0 ? BI.footL : BI.footR;
  if (dy > 0.03) return [BI.hips, 0.55, th, 0.45];
  if (dy > -0.04) return blend2(BI.hips, th, 0.45 + (0.03 - dy) * 7.5);
  if (dy > -0.375) return [th, 1];
  if (dy > -0.475) return blend2(th, sh, (-0.375 - dy) / 0.1);
  if (dy > -0.79) return [sh, 1];
  return blend2(sh, ft, (-0.79 - dy) / 0.06);
}

export interface LegInfo {
  style: string;
  wide: boolean;
  /** dy where the trouser ends (below = skin). */
  hem: number;
  barefoot: boolean;
}

export function legInfo(ctx: BuildCtx): LegInfo {
  const bot = ctx.items.bottom;
  const style = shapeStr(bot, 'style', 'trousers');
  const wide = shapeBool(bot, 'wide');
  const fw = shapeStr(ctx.items.footwear, 'style', 'boots');
  const barefoot = fw === 'sandals' || fw === 'wraps';
  return { style, wide, hem: barefoot ? (wide ? -0.74 : -0.73) : -0.82, barefoot };
}

export function buildLegs(ctx: BuildCtx): void {
  const b = ctx.b;
  const li = legInfo(ctx);
  const legPal = li.style === 'skirt' ? PAL.TRIM : PAL.SECONDARY;
  const gather = li.style === 'wrapped';
  const tl = ctx.tat;
  const legT = (dy: number) => 0.0 - dy;
  tl.leg = { tKnee: legT(-0.425), tAnkle: legT(-0.82), tTip: legT(-0.82) + 0.035 + 0.155 };
  let list = ctx.lod ? [0.07, 0.0, -0.15, -0.34, -0.425, -0.55, -0.72, -0.84] : LEG_ROWS.map((r) => -r[0]);
  list = list.filter((d) => Math.abs(d - li.hem) > 0.012 && d >= -0.84);
  if (li.hem > -0.84) list.push(li.hem, li.hem);
  if (li.wide && !ctx.lod) list.push(-0.66, -0.7);
  list.sort((x, y) => y - x);
  for (const side of [1, -1]) {
    const Hj = ctx.J(side > 0 ? 'thighL' : 'thighR');
    const rings: Ring[] = [];
    let passed = false;
    for (const dy of list) {
      const boundary = Math.abs(dy - li.hem) < 1e-9;
      const cloth = dy > li.hem || (boundary && !passed);
      if (boundary) passed = true;
      const r = legRadius(ctx, dy);
      let loose = 1;
      let add = 0;
      if (cloth) {
        add = 0.006;
        loose = 1.08;
        if (li.wide) {
          const balloon = smooth01(0.0, -0.45, dy) * (gather ? 1 - smooth01(-0.6, -0.7, dy) * 0.75 : 1);
          loose = 1.12 + 0.55 * balloon;
        }
      }
      rings.push({
        c: [Hj[0] + side * (cloth && li.wide ? 0.006 : 0), Hj[1] + dy, Hj[2] + r.z],
        rx: r.rx * loose + add,
        rz: r.rz * loose + add,
        skin: legSkin(side, dy),
        pal: cloth ? legPal : PAL.SKIN,
      });
    }
    b.mat(legPal, CLOTH_ROUGH);
    const lineTh = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    loftY(ctx, rings, ctx.seg(18, 8), {
      each: (j, th) => {
        const r = rings[j];
        if (r.pal === PAL.SKIN) {
          // Line runs down the outer leg and turns to the front toward the foot.
          const dy = r.c[1] - Hj[1];
          const lt = lerp(lineTh, 0, smooth01(-0.6, -0.8, dy));
          b.tattoo(side > 0 ? TAT.LEG_L : TAT.LEG_R, lineDist((r.rx + r.rz) / 2, th, lt), legT(dy));
          b.rough = 0.6;
        } else {
          b.tattoo(side > 0 ? TAT.LEG_L : TAT.LEG_R, 0.5, legT(r.c[1] - Hj[1]));
          b.rough = CLOTH_ROUGH;
        }
      },
    });
    b.tattoo(TAT.NONE);
    // Shin wraps.
    if (gather || li.style === 'wrapped') {
      const wrapTop = li.wide ? -0.62 : -0.52;
      const wrapBot = li.hem > -0.8 ? li.hem + 0.01 : -0.79;
      const n = ctx.lod ? 3 : 6;
      b.mat(li.wide ? PAL.ACCENT : PAL.WRAP, 0.92);
      for (let k = 0; k < n; k++) {
        const y0 = lerp(wrapTop, wrapBot, k / n);
        const y1 = lerp(wrapTop, wrapBot, (k + 0.9) / n);
        const rr: Ring[] = [y0, (y0 + y1) / 2, y1].map((dy, i) => {
          const r = legRadius(ctx, dy);
          const loose = li.wide ? 1.12 + 0.55 * smooth01(0.0, -0.45, dy) * (1 - smooth01(-0.6, -0.7, dy) * 0.75) : 1.08;
          const bump = i === 1 ? 0.004 : 0.0015;
          return { c: [Hj[0], Hj[1] + dy, Hj[2] + r.z] as V3, rx: r.rx * loose + 0.006 + bump, rz: r.rz * loose + 0.006 + bump, skin: legSkin(side, dy), dy: (th: number) => Math.sin(th) * 0.008 * side };
        });
        loftY(ctx, rr, ctx.seg(16, 8));
      }
    }
  }
  // Trouser seat: smooth shell over the pelvis/leg junction (visible under short tops).
  if (li.style === 'trousers' || li.style === 'wrapped') {
    const rows = ctx.seg(8, 4);
    const p = { x: 0, y: 0, z: 0 };
    b.mat(legPal, CLOTH_ROUGH);
    b.grid(
      ctx.seg(30, 12),
      rows,
      (_i, j, u, _v, out) => {
        const th = -Math.PI + u * Math.PI * 2;
        const y = lerp(1.07, 0.8, j / rows);
        const r = shellPoint(ctx, y, th, 0.006 + (li.wide ? 0.012 : 0) * smooth01(1.0, 0.85, y), li.wide ? 0.25 : 0.1, p);
        // Pinch between the legs at the bottom (front/back centre).
        const pinch = smooth01(0.88, 0.8, y) * Math.pow(Math.abs(Math.cos(th)), 6) * 0.35;
        out.x = p.x * (1 - pinch * 0.2);
        out.y = p.y + pinch * 0.05;
        out.z = p.z * (1 - pinch);
        b.skin = skirtSkin(y, th, r.hw);
      },
      { closedU: true, flip: true },
    );
  }
  // Skirt / robe shells.
  if (li.style === 'skirt' || li.style === 'robe') {
    const hem = li.style === 'robe' ? 0.1 : 0.26;
    const fl = li.style === 'robe' ? 0.75 : 0.55;
    const rows = ctx.seg(22, 8);
    const p = { x: 0, y: 0, z: 0 };
    b.mat(PAL.SECONDARY, CLOTH_ROUGH);
    b.grid(
      ctx.seg(32, 14),
      rows,
      (_i, j, u, _v, out) => {
        const th = -Math.PI + u * Math.PI * 2;
        const y = lerp(1.06, hem, j / rows);
        const pleat = li.style === 'robe' && !ctx.lod ? 1 + 0.035 * Math.max(0, Math.cos(th * 9)) * smooth01(0.95, 0.6, y) : 1;
        const r = shellPoint(ctx, y, th, 0.016 + 0.004 * smooth01(1.0, 0.9, y), fl, p);
        out.x = p.x * pleat;
        out.y = p.y;
        out.z = p.z + (p.z - torsoAt(ctx, 0.9).z) * (pleat - 1);
        b.skin = skirtSkin(y, th, r.hw);
      },
      { closedU: true, flip: true, double: { pal: PAL.SECONDARY } },
    );
    b.mat(PAL.TRIM, CLOTH_ROUGH);
    b.grid(
      ctx.seg(32, 14),
      1,
      (_i, j, u, _v, out) => {
        const th = -Math.PI + u * Math.PI * 2;
        const y = hem + 0.022 - j * 0.022;
        const r = shellPoint(ctx, y, th, 0.019 + 0.004 * smooth01(1.0, 0.9, y), fl, p);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
        b.skin = skirtSkin(y, th, r.hw);
      },
      { closedU: true, flip: true, double: true },
    );
  }
}

// -----------------------------------------------------------------------------
// Feet & footwear
// -----------------------------------------------------------------------------

/** Foot profile along +Z from the heel: z, centre y (rel. ankle), half width, half height. */
const FOOT_ROWS: number[][] = [
  [-0.066, -0.035, 0.016, 0.018],
  [-0.056, -0.028, 0.03, 0.034],
  [-0.03, -0.02, 0.036, 0.045],
  [0.01, -0.025, 0.039, 0.04],
  [0.06, -0.036, 0.043, 0.029],
  [0.11, -0.044, 0.046, 0.021],
  [0.15, -0.049, 0.043, 0.016],
  [0.176, -0.053, 0.033, 0.012],
  [0.19, -0.056, 0.016, 0.007],
  [0.194, -0.057, 0.004, 0.003],
];

interface FootRing {
  z: number;
  cy: number;
  hw: number;
  hh: number;
  pal: number;
}

function footLoft(ctx: BuildCtx, side: number, F: V3, rings: FootRing[], sole: number, opts: { tattoo?: boolean; scale?: number } = {}): void {
  const b = ctx.b;
  const ft = side > 0 ? BI.footL : BI.footR;
  const sh = side > 0 ? BI.shinL : BI.shinR;
  const segs = ctx.seg(16, 8);
  const savedRough = b.rough;
  const tl = ctx.tat.leg;
  b.grid(
    segs,
    rings.length - 1,
    (_i, j, u, _v, out) => {
      const r = rings[j];
      const th = -Math.PI + u * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      const e = 2 / 2.6;
      const x = Math.sign(s) * Math.pow(Math.abs(s), e) * r.hw;
      let y = r.cy + Math.sign(c) * Math.pow(Math.abs(c), e) * r.hh;
      y = Math.max(y, sole);
      out.x = F[0] + x;
      out.y = F[1] + y;
      out.z = F[2] + r.z;
      b.pal = r.pal;
      b.skin = r.z < -0.035 && y > -0.01 ? [sh, 0.35, ft, 0.65] : [ft, 1];
      if (opts.tattoo && r.pal === PAL.SKIN) b.tattoo(side > 0 ? TAT.LEG_L : TAT.LEG_R, c > 0.1 ? x : 0.03 + Math.abs(x) - c * 0.02, tl.tAnkle + 0.035 + Math.max(0, r.z + 0.005));
      else b.tattoo(TAT.NONE);
    },
    { closedU: true, flip: true },
  );
  b.tattoo(TAT.NONE);
  b.rough = savedRough;
}

export function buildFeet(ctx: BuildCtx): void {
  const b = ctx.b;
  const fw = ctx.items.footwear;
  const style = shapeStr(fw, 'style', 'boots');
  const height = shapeNum(fw, 'height', 0.6);
  const nation = fw?.nation ?? 'any';
  const li = legInfo(ctx);
  const sole = -0.064;
  for (const side of [1, -1]) {
    const F = ctx.J(side > 0 ? 'footL' : 'footR');
    const Hj = ctx.J(side > 0 ? 'thighL' : 'thighR');
    const ft = side > 0 ? BI.footL : BI.footR;
    const sh = side > 0 ? BI.shinL : BI.shinR;
    const base = (pal: number, k = 1, toeUp = 0, point = 0): FootRing[] =>
      FOOT_ROWS.map(([z, cy, hw, hh]) => {
        const toe = smooth01(0.12, 0.2, z);
        const L = 1.1;
        return {
          z: (z * (1 + point * 0.12 * toe) + toeUp * toe * 0.01) * L,
          cy: cy + toeUp * toe * toe * 0.045,
          hw: hw * k * (1 - point * 0.35 * toe) * 1.06,
          hh: hh * k + (toeUp ? toe * 0.004 : 0),
          pal,
        };
      });
    if (style === 'sandals' || style === 'wraps') {
      // Bare foot with toes.
      b.mat(PAL.SKIN, 0.6);
      const rings = base(PAL.SKIN, 0.95);
      footLoft(ctx, side, F, rings, sole + (style === 'sandals' ? 0.012 : 0), { tattoo: true });
      if (!ctx.lod) {
        // Toe bumps.
        b.skin = [ft, 1];
        for (let t = 0; t < 4; t++) {
          const x = F[0] + side * (-0.026 + t * 0.016);
          b.ellipsoid(x, F[1] + sole + 0.016 + (style === 'sandals' ? 0.012 : 0), F[2] + 0.178 - Math.abs(t - 1) * 0.008, 0.0078, 0.0075, 0.009, 6, 4);
        }
      }
      if (style === 'sandals') {
        b.mat(PAL.STRAW, 0.95);
        b.skin = [ft, 1];
        b.box(F[0], F[1] + sole + 0.006, F[2] + 0.06, 0.085, 0.012, 0.27);
        b.mat(PAL.LEATHER, 0.7);
        for (const [z, hw] of [[0.04, 0.044], [0.12, 0.047]] as const) {
          const rr: FootRing[] = [z - 0.008, z + 0.008].map((zz) => ({ z: zz, cy: -0.03, hw: hw + 0.003, hh: 0.026, pal: PAL.LEATHER }));
          footLoft(ctx, side, F, rr, sole + 0.012);
        }
      } else {
        b.mat(PAL.WRAP, 0.92);
        for (const zz of [-0.02, 0.05]) {
          const rr: FootRing[] = [zz - 0.016, zz + 0.016].map((z) => ({ z, cy: -0.026, hw: 0.043, hh: 0.044, pal: PAL.WRAP }));
          footLoft(ctx, side, F, rr, sole);
        }
        // Ankle wrap.
        const rr: Ring[] = [-0.74, -0.8].map((dy) => {
          const r = legRadius(ctx, dy);
          return { c: [Hj[0], Hj[1] + dy, Hj[2] + r.z] as V3, rx: r.rx + 0.005, rz: r.rz + 0.005, skin: legSkinPublic(side, dy) };
        });
        loftY(ctx, rr, ctx.seg(14, 8));
      }
      continue;
    }
    // Shoes / boots.
    const earth = nation === 'earth' && style === 'boots';
    const fire = nation === 'fire' && style === 'boots';
    const bootPal = style === 'armored' ? PAL.METAL_DARK : fire ? PAL.LEATHER_DARK : PAL.LEATHER;
    b.mat(bootPal, style === 'armored' ? 0.45 : 0.6, style === 'armored' ? 0.35 : 0);
    const rings = base(bootPal, 1.08, earth ? 1 : 0, fire ? 1 : 0);
    // Darker sole band.
    footLoft(ctx, side, F, rings, sole);
    b.mat(PAL.LEATHER_DARK, 0.7);
    const soleRings: FootRing[] = rings.map((r) => ({ ...r, cy: sole + 0.004, hh: 0.006, hw: r.hw * 1.04, pal: PAL.LEATHER_DARK }));
    footLoft(ctx, side, F, soleRings, sole - 0.002);
    // Shaft.
    const topDy = -0.82 + 0.38 * Math.min(1, Math.max(0.2, height));
    const dys = [-0.86, -0.82, -0.76, lerp(-0.76, topDy, 0.5), topDy];
    const shaft: Ring[] = dys.map((dy, i) => {
      const r = legRadius(ctx, Math.max(dy, -0.84));
      const loose = li.wide ? 1.2 : 1.12;
      const fluff = style === 'fur_boots' ? 1.14 : 1;
      return {
        c: [Hj[0], Hj[1] + dy + (i === 0 ? 0.02 : 0), Hj[2] + r.z + (i === 0 ? 0.0 : 0)] as V3,
        rx: (r.rx * loose + 0.009) * fluff * (i === dys.length - 1 ? 1.06 : 1),
        rz: (r.rz * loose + 0.009) * fluff * (i === dys.length - 1 ? 1.06 : 1),
        skin: i === 0 ? [ft, 0.5, sh, 0.5] : legSkin(side, dy),
        pal: bootPal,
      };
    });
    b.mat(bootPal, 0.6, style === 'armored' ? 0.35 : 0);
    loftY(ctx, shaft, ctx.seg(18, 8), { double: true });
    // Top band / cuff.
    const tr = legRadius(ctx, topDy);
    const loose = li.wide ? 1.2 : 1.12;
    if (style === 'fur_boots') {
      b.mat(PAL.FUR, 1);
      furRing(ctx, [Hj[0], Hj[1] + topDy, Hj[2] + tr.z], (tr.rx * loose + 0.009) * 1.2, (tr.rz * loose + 0.009) * 1.2, 0.016, legSkin(side, topDy));
    } else {
      b.mat(fire ? PAL.PRIMARY : style === 'armored' ? PAL.GOLD : PAL.LEATHER_DARK, 0.5, style === 'armored' ? 0.6 : 0);
      const band: Ring[] = [topDy - 0.025, topDy + 0.002].map((dy) => ({ c: [Hj[0], Hj[1] + dy, Hj[2] + tr.z] as V3, rx: (tr.rx * loose + 0.009) * 1.08, rz: (tr.rz * loose + 0.009) * 1.08, skin: legSkin(side, dy) }));
      loftY(ctx, band, ctx.seg(18, 8), { double: true });
    }
    if (style === 'armored' && !ctx.lod) {
      // Shin plate.
      b.mat(PAL.METAL_DARK, 0.4, 0.4);
      b.skin = [sh, 1];
      const r = legRadius(ctx, -0.62);
      b.box(Hj[0], Hj[1] - 0.64, Hj[2] + r.z + r.rz * 1.2 + 0.012, 0.07, 0.2, 0.012);
    }
  }
}

export function legSkinPublic(side: number, dy: number): SkinSpec {
  return legSkin(side, dy);
}

// -----------------------------------------------------------------------------
// Belts
// -----------------------------------------------------------------------------

export function buildBelt(ctx: BuildCtx): void {
  const belt = ctx.items.belt;
  if (!belt) return;
  const b = ctx.b;
  const style = shapeStr(belt, 'style', 'belt');
  const top = ctx.items.top;
  const fur = shapeBool(top, 'fur');
  const thick = (fur ? 0.02 : shapeBool(top, 'armor') ? 0.014 : 0.0105) + 0.006;
  const yC = 1.035;
  const h = style === 'obi' ? 0.085 : style === 'sash' ? 0.072 : style === 'rope' ? 0.02 : 0.04;
  const pal = style === 'sash' ? PAL.ACCENT : style === 'obi' ? PAL.SECONDARY : style === 'rope' ? PAL.WRAP : PAL.LEATHER;
  const p = { x: 0, y: 0, z: 0 };
  b.mat(pal, style === 'belt' ? 0.6 : 0.9);
  const rows = style === 'rope' ? 4 : 2;
  b.grid(
    ctx.seg(30, 12),
    rows,
    (i, j, u, _v, out) => {
      const th = -Math.PI + u * Math.PI * 2;
      const y = yC + h / 2 - (j / rows) * h;
      const bulge = style === 'rope' ? Math.sin((j / rows) * Math.PI) * 0.006 * (1 + 0.4 * Math.sin(i * 1.9)) : j === 1 && style !== 'belt' ? 0.003 : 0;
      const r = shellPoint(ctx, y, th, thick + bulge, 0, p);
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
      b.skin = torsoSkin(y, th, r.hw);
    },
    { closedU: true, flip: true },
  );
  const front = shellPoint(ctx, yC, 0, thick, 0, p);
  void front;
  const fz = p.z;
  if (style === 'belt') {
    // Buckle (bone clasp for the Water Tribe).
    b.mat(belt.nation === 'water' ? PAL.BONE : PAL.GOLD, 0.35, belt.nation === 'water' ? 0 : 0.6);
    b.skin = [BI.hips, 0.5, BI.spine, 0.5];
    b.box(0, yC, fz + 0.006, 0.05, 0.048, 0.01);
    b.mat(PAL.LEATHER, 0.6);
    b.box(0, yC, fz + 0.012, 0.03, 0.026, 0.004);
    return;
  }
  // Knot + hanging tails (secondary motion).
  const kx = style === 'obi' ? 0.11 : -0.07;
  const kp = { x: 0, y: 0, z: 0 };
  const thK = Math.atan2(kx, 0.11);
  shellPoint(ctx, yC, thK, thick + 0.01, 0, kp);
  b.mat(pal, 0.9);
  b.skin = [BI.hips, 0.6, BI.spine, 0.4];
  b.ellipsoid(kp.x, kp.y, kp.z, 0.026, 0.024, 0.016, ctx.seg(10, 6), ctx.seg(8, 4));
  const tails = style === 'rope' ? [[0.0, 0.2], [0.012, 0.16]] : style === 'obi' ? [[-0.01, 0.15], [0.016, 0.11]] : [[-0.012, 0.26], [0.016, 0.2]];
  for (const [dx, len] of tails) {
    const start: V3 = [kp.x + dx, kp.y - 0.012, kp.z + 0.004];
    const joints: V3[] = [start, [start[0] + dx * 0.4, start[1] - len * 0.5, start[2] + 0.006], [start[0] + dx * 0.8, start[1] - len, start[2] + 0.008]];
    const bones = ctx.addChain({ name: 'sash', joints, stiffness: 0.35, damping: 0.86, gravity: 9.8, drag: 0.6, maxAngle: 1.1, plane: { bone: BI.hips, n: [0, 0, 1], d: 0.1 } }, BI.hips);
    const path: P3[] = [];
    const n = ctx.lod ? 3 : 6;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const seg = Math.min(1, t * 2);
      const a = t < 0.5 ? joints[0] : joints[1];
      const c = t < 0.5 ? joints[1] : joints[2];
      const f = t < 0.5 ? seg : t * 2 - 1;
      path.push({ x: lerp(a[0], c[0], f), y: lerp(a[1], c[1], f), z: lerp(a[2], c[2], f) });
    }
    const w = style === 'rope' ? 0.007 : 0.022;
    const d = style === 'rope' ? 0.007 : 0.004;
    b.mat(pal, 0.9);
    b.tube(path, (k) => w * (1 - (k / n) * 0.15), style === 'rope' ? 6 : 8, {
      rz: () => d,
      up: { x: 0, y: 0, z: 1 },
      capStart: true,
      capEnd: true,
      perPoint: (k) => {
        b.skin = ctx.chainSkin(bones, BI.hips, k / n);
      },
    });
    if (style === 'rope') {
      b.skin = [bones[bones.length - 1], 1];
      b.ellipsoid(path[n].x, path[n].y - 0.006, path[n].z, 0.011, 0.014, 0.011, 6, 4);
    }
  }
}

// -----------------------------------------------------------------------------
// Outer layers
// -----------------------------------------------------------------------------

export function buildOuter(ctx: BuildCtx): void {
  const outer = ctx.items.outer;
  if (!outer) return;
  const style = shapeStr(outer, 'style', 'mantle');
  const b = ctx.b;
  const top = ctx.items.top;
  const baseOff = (shapeBool(top, 'fur') ? 0.02 : shapeBool(top, 'armor') ? 0.03 : 0.0105) + 0.012;
  const p = { x: 0, y: 0, z: 0 };
  const uv = { u: 0, v: 0 };
  switch (style) {
    case 'mantle':
    case 'shawl': {
      const shawl = style === 'shawl';
      ctx.atlas.outer = { style, pattern: shawl ? 'waves' : 'trim', wM: 1.1, hM: 0.35 };
      // Drapes over the shoulders: flat over the shoulder tops, then hangs over the upper arms.
      const rows = ctx.seg(12, 6);
      const sh = ctx.rig.dims.shoulder;
      const armOut = armRadius(ctx, -0.1).rx;
      b.mat(PAL.ATLAS, CLOTH_ROUGH);
      b.grid(
        ctx.seg(40, 16),
        rows,
        (_i, j, u, _v, out) => {
          const th = -Math.PI + u * Math.PI * 2;
          const s = j / rows;
          const c = Math.cos(th);
          const side = Math.abs(Math.sin(th));
          const front = Math.max(0, c);
          const back = Math.max(0, -c);
          const drop = shawl ? 0.17 + 0.2 * Math.pow(front, 3) + 0.1 * back : 0.17 + 0.03 * side + 0.09 * back - 0.02 * front;
          const y = 1.484 - drop * Math.pow(s, 1.25);
          const t = torsoAt(ctx, Math.max(1.0, Math.min(1.44, y)));
          const off = baseOff + 0.004 + 0.01 * s;
          const ease = Math.sin((Math.PI / 2) * Math.min(1, s / 0.48));
          const envX = Math.max(t.hw + off, (sh + armOut + 0.014) * (0.55 + 0.45 * Math.pow(side, 0.7)));
          const envZ = t.hd + off + 0.006;
          const rx = lerp(0.072, envX, ease);
          const rz = lerp(0.066, envZ, ease);
          out.x = rx * seSin(th);
          out.y = y;
          out.z = t.z + rz * seCos(th);
          const armSide = Math.sin(th) > 0 ? BI.upperArmL : BI.upperArmR;
          const base = torsoSkin(Math.max(1.3, y), th, rx);
          const k = smooth01(0.55, 1, side) * smooth01(0.35, 1, s) * 0.55;
          b.skin = k > 0 ? mixSkin([[base, 1 - k], [[armSide, 1], k]]) : base;
          atlasUV('outer', u, s, uv);
          b.u = uv.u;
          b.v = uv.v;
        },
        { closedU: true, flip: true, double: true },
      );
      break;
    }
    case 'cape':
    case 'cloak': {
      const cloak = style === 'cloak';
      ctx.atlas.outer = { style, pattern: cloak ? 'trim' : 'swirls', wM: cloak ? 1.0 : 0.6, hM: cloak ? 1.2 : 1.0 };
      const topY = 1.43;
      const len = cloak ? 1.1 : 0.95;
      const joints: V3[] = [
        [0, topY - 0.02, -0.12],
        [0, topY - len * 0.34, -0.17],
        [0, topY - len * 0.67, -0.2],
        [0, topY - len, -0.22],
      ];
      const bones = ctx.addChain({ name: 'cape', joints, stiffness: 0.3, damping: 0.88, gravity: 9.8, drag: 0.9, maxAngle: 1.3, plane: { bone: BI.chest, n: [0, 0, -1], d: 0.1 } }, BI.chest);
      const rows = ctx.seg(14, 6);
      const cols = ctx.seg(cloak ? 24 : 14, 8);
      const wrapA0 = cloak ? 1.9 : 1.1; // angular half-width at the top (around the shoulders)
      b.mat(PAL.ATLAS, CLOTH_ROUGH);
      b.grid(
        cols,
        rows,
        (_i, j, u, _v, out) => {
          const s = j / rows;
          const a = (u - 0.5) * 2; // -1..1 across
          const yy = topY - s * len;
          // Top: wraps around the shoulders; bottom: flat-ish wide sheet behind.
          const half = lerp(wrapA0, cloak ? 1.35 : 0.75, smooth01(0, 0.5, s));
          const th = Math.PI + a * half;
          const t = torsoAt(ctx, Math.max(0.95, Math.min(1.42, yy)));
          const off = baseOff + 0.01 + s * 0.05;
          const hw = (Math.max(t.hw, s < 0.15 ? ctx.rig.dims.shoulder : t.hw) + off) * lerp(1, 1.25, s);
          const hd = t.hd + off + s * 0.06;
          out.x = hw * seSin(th);
          out.y = yy + (cloak ? 0 : -0.02 * Math.abs(a) * s);
          out.z = t.z + hd * seCos(th) - s * 0.03;
          b.skin = s < 0.08 ? torsoSkin(1.4, th, hw) : ctx.chainSkin(bones, BI.chest, s);
          atlasUV('outer', u, s, uv);
          b.u = uv.u;
          b.v = uv.v;
        },
        { flip: true, double: { pal: cloak ? PAL.PRIMARY : PAL.SECONDARY } },
      );
      // Clasp(s).
      b.mat(PAL.GOLD, 0.35, 0.6);
      for (const side of cloak ? [0] : [1, -1]) {
        b.skin = [BI.chest, 1];
        const x = side * 0.12;
        const t = torsoAt(ctx, 1.4);
        b.ellipsoid(x, 1.41, t.z + t.hd * 0.6 + 0.02, 0.014, 0.014, 0.008, 8, 6);
      }
      if (cloak) {
        // Hood folded at the back of the neck.
        b.mat(PAL.ATLAS, CLOTH_ROUGH);
        b.skin = [BI.chest, 0.6, BI.neck, 0.4];
        atlasUV('outer', 0.5, 0.02, uv);
        b.u = uv.u;
        b.v = uv.v;
        b.ellipsoid(0, 1.45, -0.115, 0.115, 0.07, 0.06, ctx.seg(14, 8), ctx.seg(8, 5));
      }
      break;
    }
    case 'fur_coat':
    case 'vest': {
      const vest = style === 'vest';
      const hem = vest ? 0.88 : 0.62;
      const rows = ctx.seg(vest ? 14 : 22, 7);
      const gap = vest ? 0.36 : 0.28;
      ctx.atlas.outer = { style, pattern: vest ? 'trim' : 'none', wM: 1, hM: 1.47 - hem };
      b.mat(vest ? PAL.ATLAS : PAL.FUR, vest ? CLOTH_ROUGH : 1);
      b.grid(
        ctx.seg(32, 14),
        rows,
        (i, j, u, _v, out) => {
          const th = gap + u * (Math.PI * 2 - gap * 2);
          const s = j / rows;
          const y = lerp(1.462, hem, s);
          const off = baseOff + (vest ? 0.004 : 0.03) + (vest ? 0 : 0.008 * hashNoise(i, j));
          const r = shellPoint(ctx, y, th, off + (y < 1.4 ? 0 : 0.01), 0.45, p);
          out.x = p.x;
          out.y = p.y;
          out.z = p.z;
          b.skin = skirtSkin(y, th, r.hw);
          atlasUV('outer', u, s, uv);
          b.u = uv.u;
          b.v = uv.v;
        },
        { flip: true, double: { pal: vest ? PAL.SECONDARY : PAL.FUR_DARK } },
      );
      if (!vest) {
        // Fur collar + short wide sleeves over the upper arms.
        b.mat(PAL.FUR, 1);
        furRing(ctx, [0, 1.462, -0.006], 0.1, 0.095, 0.03, [BI.chest, 0.6, BI.neck, 0.4]);
        for (const side of [1, -1]) {
          const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
          const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
          const rr: Ring[] = [0.03, -0.05, -0.16, -0.2].map((dy, k) => {
            const ar = armRadius(ctx, dy);
            const g = k === 0 ? 1.1 : 1.55;
            return { c: [A[0], A[1] + dy, A[2]] as V3, rx: ar.rx * g + 0.014, rz: ar.rz * g + 0.014, skin: k === 0 ? [side > 0 ? BI.shoulderL : BI.shoulderR, 0.4, ua, 0.6] : [ua, 1] };
          });
          loftY(ctx, rr, ctx.seg(16, 8), { double: { pal: PAL.FUR_DARK } });
        }
      }
      break;
    }
    case 'shoulder_armor': {
      buildPauldrons(ctx, outer.shape.spikes === true || outer.id === 'fire_pauldrons', outer.nation === 'fire' ? PAL.METAL_DARK : PAL.TRIM);
      break;
    }
  }
}
