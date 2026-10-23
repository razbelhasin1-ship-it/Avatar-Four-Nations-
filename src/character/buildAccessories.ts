import * as THREE from 'three';
import { PAL, type P3, type SkinSpec } from './CharMesh';
import { headNormalAngles, headPointAngles, type V3 } from './CharShape';
import { armRadius, furRing, torsoAt, torsoSkin } from './buildBody';
import { flameCrown } from './buildHair';
import { BI, hashNoise, lerp, shapeBool, shapeStr, smooth01, type BuildCtx } from './buildUtil';

/**
 * Headwear, necklaces and carried accessories. Everything is skinned to the
 * bone it rests on so it stays attached while moving.
 */

function headModel(ctx: BuildCtx, yaw: number, pitch: number, off: number): P3 {
  const f = ctx.face;
  const H = ctx.J('head');
  const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  headPointAngles(f, yaw, pitch, p);
  headNormalAngles(f, yaw, pitch, n);
  return { x: H[0] + p.x + n.x * off, y: H[1] + p.y + n.y * off, z: H[2] + p.z + n.z * off };
}

/** Outward offset of the top garment (so things rest on the clothes, and on mantles/shawls). */
function topOff(ctx: BuildCtx): number {
  const top = ctx.items.top;
  const outer = shapeStr(ctx.items.outer, 'style', '');
  const over = outer === 'mantle' || outer === 'shawl' ? 0.026 : outer === 'fur_coat' ? 0.04 : outer === 'vest' ? 0.012 : 0;
  return (shapeBool(top, 'fur') ? 0.02 : shapeBool(top, 'armor') ? 0.03 : 0.0105) + 0.004 + over;
}

// -----------------------------------------------------------------------------
// Emblems (cached extruded shapes, unit size ~1)
// -----------------------------------------------------------------------------

const emblemCache = new Map<string, THREE.BufferGeometry>();

function emblem(kind: string): THREE.BufferGeometry {
  let g = emblemCache.get(kind);
  if (g) return g;
  const s = new THREE.Shape();
  switch (kind) {
    case 'wave': {
      // Water Tribe wave curl.
      s.moveTo(-0.5, -0.35);
      s.bezierCurveTo(-0.45, 0.1, -0.1, 0.45, 0.25, 0.42);
      s.bezierCurveTo(0.5, 0.4, 0.55, 0.1, 0.35, 0.02);
      s.bezierCurveTo(0.2, -0.04, 0.08, 0.06, 0.14, 0.16);
      s.bezierCurveTo(0.02, 0.18, -0.12, 0.05, -0.08, -0.12);
      s.bezierCurveTo(-0.05, -0.25, 0.2, -0.3, 0.5, -0.35);
      s.lineTo(-0.5, -0.35);
      break;
    }
    case 'moon': {
      s.absarc(0, 0, 0.5, 0.3 * Math.PI, 1.7 * Math.PI, false);
      s.absarc(0.22, 0, 0.36, 1.62 * Math.PI, 0.38 * Math.PI, true);
      break;
    }
    case 'flame': {
      s.moveTo(0, -0.5);
      s.bezierCurveTo(0.42, -0.45, 0.45, -0.05, 0.18, 0.18);
      s.bezierCurveTo(0.3, 0.05, 0.28, 0.3, 0.05, 0.52);
      s.bezierCurveTo(0.08, 0.25, -0.12, 0.2, -0.08, 0.05);
      s.bezierCurveTo(-0.25, 0.2, -0.3, 0.35, -0.18, 0.45);
      s.bezierCurveTo(-0.5, 0.25, -0.42, -0.45, 0, -0.5);
      break;
    }
    case 'leaf': {
      s.moveTo(0, -0.5);
      s.bezierCurveTo(0.45, -0.2, 0.35, 0.3, 0, 0.5);
      s.bezierCurveTo(-0.35, 0.3, -0.45, -0.2, 0, -0.5);
      break;
    }
    default: {
      s.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
    }
  }
  g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 6 });
  g.computeBoundingBox();
  emblemCache.set(kind, g);
  return g;
}

// -----------------------------------------------------------------------------
// Headwear
// -----------------------------------------------------------------------------

/** Called before hair: flags hood / hat so hair builders adapt. */
export function prepareHeadwear(ctx: BuildCtx): void {
  const hw = ctx.items.headwear;
  const st = shapeStr(hw, 'style', 'none');
  ctx.hooded = st === 'hood';
  ctx.hatted = st === 'hat_straw' || st === 'monk_hat';
}

export function buildHeadwear(ctx: BuildCtx): void {
  const hw = ctx.items.headwear;
  if (!hw) return;
  const b = ctx.b;
  const st = shapeStr(hw, 'style', 'none');
  const head = BI.head;
  const rigidHead: SkinSpec = [head, 1];
  const H = ctx.J('head');
  const f = ctx.face;
  b.skin = rigidHead;
  switch (st) {
    case 'crown': {
      const hs = ctx.a.hair.style;
      const onBun = hs === 'topknot' || hs === 'topknot_crown';
      const c = onBun ? headModel(ctx, Math.PI, 1.18, 0.034) : headModel(ctx, Math.PI, 1.35, 0.012);
      flameCrown(ctx, [c.x, c.y, c.z], hw.shape.gold === true, hw.shape.gold === true ? 5 : 3);
      break;
    }
    case 'hat_straw': {
      const top = H[1] + f.ry + 0.105 + 0.03;
      const brimY = H[1] + 0.105 + f.ry * 0.62;
      const R = 0.27;
      b.mat(PAL.STRAW, 0.95);
      b.grid(
        ctx.seg(36, 14),
        ctx.seg(8, 4),
        (i, j, u, v, out) => {
          const a = u * Math.PI * 2;
          const r = v * R;
          const ridge = ctx.lod ? 0 : (i % 2) * 0.0015;
          out.x = H[0] + Math.sin(a) * r;
          out.y = lerp(top, brimY, Math.pow(v, 0.95)) + ridge - (v > 0.95 ? 0.004 : 0);
          out.z = H[2] - 0.01 + Math.cos(a) * r;
          void j;
        },
        { closedU: true, flip: true, double: { pal: PAL.STRAW } },
      );
      b.mat(PAL.LEATHER, 0.8);
      for (const side of [1, -1]) {
        const ear = headModel(ctx, side * 1.55, 0.25, 0.01);
        const chin = headModel(ctx, side * 0.5, -0.95, 0.006);
        b.tube([{ x: ear.x, y: brimY + 0.02, z: ear.z }, ear, chin], () => 0.0018, 4);
      }
      break;
    }
    case 'headband': {
      const nu = ctx.seg(36, 14);
      b.mat(PAL.SECONDARY, 0.9);
      b.grid(
        nu,
        1,
        (_i, j, u, _v, out) => {
          const yaw = -Math.PI + u * Math.PI * 2;
          const pitch = lerp(0.62, 0.42, smooth01(0.0, 1.0, Math.cos(yaw) * 0.5 + 0.5)) - j * 0.11;
          const p = headModel(ctx, yaw, pitch, 0.0035 + (ctx.a.hair.style === 'bald' ? 0 : 0.008 * smooth01(0.3, -0.6, Math.cos(yaw))));
          out.x = p.x;
          out.y = p.y;
          out.z = p.z;
        },
        { closedU: true, flip: true },
      );
      // Knot + tails at the back.
      const kp = headModel(ctx, Math.PI, 0.38, 0.016);
      b.ellipsoid(kp.x, kp.y, kp.z, 0.016, 0.014, 0.01, 8, 5);
      for (const dx of [-0.012, 0.014]) {
        const joints: V3[] = [[kp.x + dx, kp.y - 0.006, kp.z - 0.006], [kp.x + dx * 2.5, kp.y - 0.06, kp.z - 0.03], [kp.x + dx * 3.5, kp.y - 0.12, kp.z - 0.045]];
        const bones = ctx.addChain({ name: 'bandtail', joints, stiffness: 0.3, damping: 0.85, gravity: 9.8, drag: 0.9, maxAngle: 1.2 }, head);
        b.tube(
          joints.map((j) => ({ x: j[0], y: j[1], z: j[2] })),
          () => 0.011,
          6,
          { rz: () => 0.0025, up: { x: 0, y: 0, z: 1 }, capEnd: true, perPoint: (k) => (b.skin = ctx.chainSkin(bones, head, k / 2)) },
        );
      }
      break;
    }
    case 'hairpin': {
      b.mat(PAL.STONE2, 0.3, 0.1);
      const hs = ctx.a.hair.style;
      const c = hs === 'bun' ? headModel(ctx, Math.PI, 0.32, 0.03) : hs === 'double_buns' ? headModel(ctx, 2.25, 0.82, 0.03) : headModel(ctx, Math.PI, 0.75, 0.02);
      for (const [dx, dy] of [[0.06, 0.03], [0.055, -0.035]]) {
        b.tube([{ x: c.x - dx, y: c.y - dy * 0.4, z: c.z - 0.004 }, { x: c.x + dx, y: c.y + dy, z: c.z - 0.004 }], () => 0.003, 6, { capStart: true, capEnd: true });
        b.ellipsoid(c.x + dx, c.y + dy, c.z - 0.004, 0.009, 0.009, 0.006, 8, 5);
      }
      b.mat(PAL.GOLD, 0.3, 0.6);
      b.ellipsoid(c.x + 0.062, c.y + 0.036, c.z - 0.004, 0.004, 0.012, 0.004, 6, 4);
      break;
    }
    case 'hood': {
      // Parka hood up, with a fur ruff framing the face.
      b.mat(PAL.PRIMARY, 0.9);
      const nu = ctx.seg(30, 12), nv = ctx.seg(14, 6);
      b.grid(
        nu,
        nv,
        (_i, _j, u, v, out) => {
          // Open toward the front: yaw in [0.9, 2π-0.9] through the back.
          const yaw = 0.95 + u * (Math.PI * 2 - 1.9);
          const pitch = Math.PI / 2 - v * (Math.PI / 2 + 0.75);
          const p = headModel(ctx, yaw, Math.min(1.45, pitch), 0.03 + 0.012 * Math.sin(v * Math.PI));
          out.x = p.x * (1 + 0.1 * smooth01(0.6, 1, v));
          out.y = p.y - (v > 0.85 ? 0.02 : 0);
          out.z = p.z;
          b.skin = v > 0.8 ? [head, 0.5, BI.neck, 0.5] : rigidHead;
        },
        { flip: true, double: { pal: PAL.FUR_DARK } },
      );
      // Fur ruff around the face opening.
      b.mat(PAL.FUR, 1);
      b.skin = rigidHead;
      const nr = ctx.seg(22, 10);
      const ruff: P3[] = [];
      for (let k = 0; k <= nr; k++) {
        const a = (k / nr) * Math.PI * 2;
        const yaw = 0.95 * Math.cos(a) * 1.05;
        const pitch = 0.12 + Math.sin(a) * 0.95;
        const p = headModel(ctx, Math.sign(yaw) * Math.min(Math.abs(yaw), 1.5), pitch, 0.04);
        ruff.push(p);
      }
      b.tube(ruff, (k) => 0.019 + (ctx.lod ? 0 : 0.006 * Math.max(0, hashNoise(k))), 8, {});
      break;
    }
    case 'beads': {
      b.mat(PAL.STONE2, 0.3, 0.05);
      const spots: Array<[number, number]> = [[1.2, 0.05], [-1.2, 0.05], [2.9, -0.2]];
      for (const [yaw, pitch] of spots) {
        const p = headModel(ctx, yaw, pitch, 0.016);
        for (let k = 0; k < 3; k++) b.ellipsoid(p.x, p.y - k * 0.017, p.z, 0.0075, 0.0085, 0.0075, 8, 5);
        b.mat(PAL.HAIR, 0.6);
        b.tube([p, { x: p.x, y: p.y - 0.045, z: p.z }], () => 0.0025, 5, {});
        b.mat(PAL.STONE2, 0.3, 0.05);
      }
      break;
    }
    case 'monk_hat': {
      const baseY = H[1] + 0.105 + f.ry * 0.55;
      const tipY = baseY + 0.24;
      b.mat(PAL.PRIMARY, 0.9);
      b.grid(
        ctx.seg(28, 12),
        ctx.seg(10, 5),
        (_i, _j, u, v, out) => {
          const a = u * Math.PI * 2;
          const r = (f.rx + 0.018) * Math.pow(1 - v, 0.85) * (1 + 0.06 * Math.cos(a));
          out.x = H[0] + Math.sin(a) * r;
          out.y = lerp(baseY, tipY, v);
          out.z = H[2] - 0.012 + Math.cos(a) * r * 1.08 - v * v * 0.05;
        },
        { closedU: true },
      );
      b.mat(PAL.ACCENT, 0.85);
      b.grid(
        ctx.seg(28, 12),
        1,
        (_i, j, u, _v, out) => {
          const a = u * Math.PI * 2;
          const r = (f.rx + 0.022) * (1 + 0.06 * Math.cos(a));
          out.x = H[0] + Math.sin(a) * r;
          out.y = baseY + j * 0.03 - 0.004;
          out.z = H[2] - 0.012 + Math.cos(a) * r * 1.08;
        },
        { closedU: true, double: true },
      );
      break;
    }
  }
}

// -----------------------------------------------------------------------------
// Necklaces
// -----------------------------------------------------------------------------

/** Front chest surface z (on top of the clothes) at height y. */
function chestFront(ctx: BuildCtx, y: number): number {
  const t = torsoAt(ctx, y);
  return t.z + t.hd + topOff(ctx);
}

function cordLoop(ctx: BuildCtx, dropY: number, r: number, pal: number, extraOut = 0): P3 {
  const b = ctx.b;
  const n = ctx.seg(28, 12);
  const pts: P3[] = [];
  let bottom: P3 = { x: 0, y: 0, z: 0 };
  const neckR = 0.05 * ctx.rig.dims.neck + topOff(ctx) * 0.6 + 0.004 + extraOut;
  for (let k = 0; k <= n; k++) {
    const th = -Math.PI + (k / n) * Math.PI * 2;
    const front = Math.max(0, Math.cos(th));
    const y = lerp(1.478, dropY, Math.pow(front, 2.2));
    const t = torsoAt(ctx, Math.max(1.0, Math.min(1.47, y)));
    const surfR = y < 1.45 ? t.hd + topOff(ctx) + 0.004 : neckR;
    const zc = y < 1.45 ? t.z : -0.004;
    const rx = y < 1.45 ? Math.min(t.hw, 0.13) : neckR;
    const p = { x: Math.sin(th) * Math.max(rx * 0.92, neckR), y, z: zc + Math.cos(th) * Math.max(surfR, neckR) + extraOut * front };
    pts.push(p);
    if (k === Math.round(n / 2)) bottom = p;
  }
  b.mat(pal, 0.7);
  b.tube(pts, () => r, 5, {
    perPoint: (k) => {
      const y = pts[k].y;
      b.skin = y > 1.44 ? [BI.neck, 0.5, BI.chest, 0.5] : [BI.chest, 1];
    },
  });
  return bottom;
}

function placeEmblem(ctx: BuildCtx, kind: string, c: P3, size: number, pal: number, rotZ = 0): void {
  const g = emblem(kind);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotZ)), new THREE.Vector3(size, size, size));
  ctx.b.mat(pal, 0.35, pal === PAL.GOLD ? 0.6 : 0.05);
  ctx.b.addGeometry(g, m, false);
}

export function buildNecklace(ctx: BuildCtx): void {
  const nk = ctx.items.necklace;
  if (!nk) return;
  const b = ctx.b;
  const st = shapeStr(nk, 'style', 'pendant');
  const carving = shapeStr(nk, 'carving', '');
  const chest: SkinSpec = [BI.chest, 1];
  switch (st) {
    case 'choker': {
      // Ribbon around the upper neck + carved stone with the wave emblem.
      const neckR = 0.05 * ctx.rig.dims.neck;
      const collarHigh = shapeStr(ctx.items.top, 'collar', '') === 'high';
      const y = collarHigh ? 1.535 : 1.5;
      const r = neckR * (collarHigh ? 0.93 : 0.98) + 0.003;
      b.mat(PAL.SECONDARY, 0.7);
      b.grid(
        ctx.seg(24, 10),
        1,
        (_i, j, u, _v, out) => {
          const a = u * Math.PI * 2;
          out.x = Math.sin(a) * r;
          out.y = y + 0.006 - j * 0.012;
          out.z = -0.002 + Math.cos(a) * r * 1.04;
          b.skin = collarHigh ? [BI.neck, 0.6, BI.head, 0.4] : [BI.neck, 1];
        },
        { closedU: true, flip: true, double: true },
      );
      const sz = 0.03;
      const cz = r * 1.04 + 0.006 + (collarHigh ? 0.02 : 0);
      b.skin = collarHigh ? [BI.neck, 1] : [BI.neck, 0.7, BI.chest, 0.3];
      b.mat(PAL.STONE, 0.3, 0.05);
      b.pushMatrix(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, y - 0.018, cz - 0.002));
      b.grid(ctx.seg(18, 10), 2, (_i, j, u, _v, out) => {
        const a = u * Math.PI * 2;
        const rr = j === 2 ? 0 : sz * 0.5 * (j === 0 ? 1 : 0.97);
        out.x = Math.sin(a) * rr;
        out.y = j === 0 ? -0.002 : 0.0025;
        out.z = Math.cos(a) * rr * 1.08;
      }, { closedU: true, flip: true });
      b.popMatrix();
      placeEmblem(ctx, 'wave', { x: -0.011, y: y - 0.026, z: cz + 0.0005 }, 0.022, PAL.BONE);
      break;
    }
    case 'pendant':
    case 'medallion': {
      const drop = st === 'medallion' ? 1.31 : 1.33;
      const bottom = cordLoop(ctx, drop, 0.0017, st === 'medallion' ? PAL.LEATHER_DARK : PAL.LEATHER_DARK);
      const zf = chestFront(ctx, bottom.y - 0.02) + 0.008;
      b.skin = chest;
      const c = { x: 0, y: bottom.y - 0.022, z: Math.max(zf, bottom.z + 0.004) };
      if (st === 'medallion') {
        b.mat(PAL.GOLD, 0.3, 0.65);
        b.pushMatrix(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(c.x, c.y, c.z));
        b.grid(ctx.seg(20, 10), 3, (_i, j, u, _v, out) => {
          const a = u * Math.PI * 2;
          const rr = [0.026, 0.026, 0.022, 0][j];
          out.x = Math.sin(a) * rr;
          out.y = [-0.003, 0.003, 0.004, 0.004][j];
          out.z = Math.cos(a) * rr;
          b.pal = j >= 2 ? PAL.STONE : PAL.GOLD;
          b.rough = j >= 2 ? 0.3 : 0.3;
          b.metal = j >= 2 ? 0.05 : 0.65;
        }, { closedU: true, flip: true });
        b.popMatrix();
        if (carving === 'four') {
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
            b.mat(PAL.GOLD, 0.3, 0.6);
            b.ellipsoid(c.x + Math.sin(a) * 0.011, c.y + Math.cos(a) * 0.011, c.z + 0.0045, 0.0042, 0.0042, 0.0018, 8, 4);
          }
        } else placeEmblem(ctx, carving === 'leaf' ? 'leaf' : 'wave', { x: c.x, y: c.y - 0.009, z: c.z + 0.0042 }, 0.022, PAL.GOLD);
      } else {
        // Pendant shapes.
        b.mat(PAL.GOLD, 0.3, 0.6);
        b.ellipsoid(c.x, c.y + 0.016, c.z, 0.004, 0.005, 0.003, 6, 4);
        b.mat(PAL.STONE, 0.18, 0.05);
        if (carving === 'moon') {
          placeEmblem(ctx, 'moon', { x: c.x, y: c.y - 0.002, z: c.z - 0.002 }, 0.034, PAL.STONE, 0.3);
        } else if (carving === 'flame') {
          placeEmblem(ctx, 'flame', { x: c.x, y: c.y - 0.004, z: c.z - 0.002 }, 0.032, PAL.STONE);
        } else if (carving === 'crystal') {
          b.pushMatrix(new THREE.Matrix4().setPosition(c.x, c.y - 0.006, c.z + 0.002));
          b.grid(6, 2, (_i, j, u, _v, out) => {
            const a = u * Math.PI * 2;
            const rr = j === 1 ? 0.0085 : 0.0;
            out.x = Math.sin(a) * rr;
            out.y = j === 0 ? 0.016 : j === 1 ? 0.002 : -0.022;
            out.z = Math.cos(a) * rr * 0.7;
          }, { closedU: true, smooth: false });
          b.popMatrix();
          b.mat(PAL.STEEL, 0.3, 0.7);
          b.ellipsoid(c.x, c.y + 0.012, c.z + 0.002, 0.007, 0.004, 0.005, 8, 4);
        } else {
          // Teardrop (ocean tear) and generic pendants.
          b.grid(ctx.seg(14, 8), ctx.seg(8, 5), (_i, _j, u, v, out) => {
            const a = u * Math.PI * 2;
            const t = v;
            const rr = Math.sin(Math.PI * t) * (0.4 + 0.6 * t) * 0.011;
            out.x = c.x + Math.sin(a) * rr;
            out.y = c.y + 0.012 - t * 0.032;
            out.z = c.z + Math.cos(a) * rr * 0.75;
          }, { closedU: true, flip: true });
        }
      }
      break;
    }
    case 'shell': {
      const bottom = cordLoop(ctx, 1.37, 0.0016, PAL.LEATHER);
      const zf = chestFront(ctx, bottom.y) + 0.006;
      b.mat(PAL.STONE, 0.4);
      for (let k = -2; k <= 2; k++) {
        const x = k * 0.026;
        const y = bottom.y + Math.abs(k) * Math.abs(k) * 0.006 - 0.012;
        const z = Math.max(zf - Math.abs(k) * 0.006, bottom.z);
        b.skin = chest;
        b.pushMatrix(new THREE.Matrix4().makeRotationZ(k * 0.25).setPosition(x, y, z));
        b.grid(ctx.seg(10, 6), ctx.seg(6, 4), (_i, _j, u, v, out) => {
          const a = u * Math.PI * 2;
          const rr = 0.0105 * Math.sin(Math.PI * Math.pow(v, 0.7));
          const ridge = ctx.lod ? 0 : 0.0012 * Math.abs(Math.sin(a * 4));
          out.x = Math.sin(a) * (rr + ridge);
          out.y = 0.006 - v * 0.02;
          out.z = Math.cos(a) * (rr + ridge) * 0.55;
        }, { closedU: true, flip: true });
        b.popMatrix();
      }
      break;
    }
    case 'torc': {
      // Rigid open collar of carved bone.
      const r0 = 0.05 * ctx.rig.dims.neck + topOff(ctx) + 0.012;
      const pts: P3[] = [];
      const n = ctx.seg(20, 10);
      for (let k = 0; k <= n; k++) {
        const th = lerp(0.35, Math.PI * 2 - 0.35, k / n);
        const front = Math.max(0, Math.cos(th));
        pts.push({ x: Math.sin(th) * (r0 + 0.012 * front), y: 1.462 - 0.025 * front, z: -0.004 + Math.cos(th) * (r0 + 0.02 * front) });
      }
      b.mat(PAL.STONE, 0.45);
      b.tube(pts, (k) => 0.0062 - 0.0015 * Math.abs(k / n - 0.5) * 2, 8, { capStart: true, capEnd: true, perPoint: () => (b.skin = [BI.chest, 0.6, BI.neck, 0.4]) });
      for (const side of [1, -1]) {
        const e = pts[side > 0 ? 0 : n];
        b.skin = [BI.chest, 0.6, BI.neck, 0.4];
        b.ellipsoid(e.x, e.y, e.z + 0.002, 0.011, 0.011, 0.008, 8, 5);
      }
      break;
    }
    case 'beads': {
      // Large prayer beads draped over the chest.
      const n = ctx.lod ? 12 : 22;
      const neckR = 0.05 * ctx.rig.dims.neck + topOff(ctx) + 0.012;
      b.mat(PAL.STONE, 0.55);
      for (let k = 0; k < n; k++) {
        const th = -Math.PI + ((k + 0.5) / n) * Math.PI * 2;
        const front = Math.max(0, Math.cos(th));
        const y = lerp(1.47, 1.245, Math.pow(front, 1.8));
        const t = torsoAt(ctx, Math.max(1.0, Math.min(1.46, y)));
        const surfR = y < 1.43 ? t.hd + topOff(ctx) + 0.016 : neckR;
        const rx = y < 1.43 ? Math.max(neckR, Math.min(t.hw * 0.8, 0.13)) : neckR;
        const p = { x: Math.sin(th) * rx, y, z: (y < 1.43 ? t.z : -0.004) + Math.cos(th) * Math.max(surfR, neckR) };
        b.skin = y > 1.44 ? [BI.neck, 0.4, BI.chest, 0.6] : [BI.chest, 1];
        const big = Math.abs(th) < 0.01 + Math.PI / n ? 1.35 : 1;
        b.ellipsoid(p.x, p.y, p.z, 0.0125 * big, 0.0125 * big, 0.0125 * big, ctx.seg(8, 5), ctx.seg(6, 4));
      }
      break;
    }
  }
}

// -----------------------------------------------------------------------------
// Accessories
// -----------------------------------------------------------------------------

export function buildAccessory(ctx: BuildCtx): void {
  const acc = ctx.items.accessory;
  if (!acc) return;
  const b = ctx.b;
  const st = shapeStr(acc, 'style', '');
  const back = (y: number) => {
    const t = torsoAt(ctx, y);
    return t.z - t.hd - topOff(ctx);
  };
  switch (st) {
    case 'glider_staff': {
      // Diagonal across the back: low right → high left.
      const a: P3 = { x: -0.16, y: 0.72, z: back(1.0) - 0.035 };
      const c: P3 = { x: 0.2, y: 1.95, z: back(1.38) - 0.04 };
      const dir = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
      const len = dir.length();
      dir.normalize();
      const at = (t: number): P3 => ({ x: a.x + dir.x * len * t, y: a.y + dir.y * len * t, z: a.z + dir.z * len * t });
      b.skin = [BI.chest, 0.7, BI.spine, 0.3];
      b.mat(PAL.WOOD, 0.55);
      b.tube([at(0), at(1)], () => 0.0165, ctx.seg(10, 6), { capStart: true, capEnd: true });
      // Folded wings (red fabric bundle) along the upper part.
      b.mat(PAL.SECONDARY, 0.85);
      b.tube([at(0.42), at(0.6), at(0.92)], (k) => (k === 1 ? 0.03 : 0.024), ctx.seg(10, 6), { rz: (k) => (k === 1 ? 0.018 : 0.014), capStart: true, capEnd: true, up: { x: 0, y: 0, z: 1 } });
      // Brass end caps and grip bands.
      b.mat(PAL.GOLD, 0.35, 0.6);
      for (const t of [0.0, 0.995]) b.ellipsoid(at(t).x, at(t).y, at(t).z, 0.02, 0.02, 0.02, 8, 5);
      b.mat(PAL.LEATHER_DARK, 0.7);
      for (const t of [0.22, 0.3]) b.tube([at(t), at(t + 0.035)], () => 0.0195, 8, {});
      break;
    }
    case 'flask': {
      // Water skin on the right hip.
      const t = torsoAt(ctx, 0.95);
      const x = -(t.hw + topOff(ctx) + 0.03);
      b.skin = [BI.hips, 1];
      b.mat(PAL.LEATHER, 0.65);
      b.ellipsoid(x, 0.9, 0.02, 0.04, 0.07, 0.03, ctx.seg(14, 8), ctx.seg(10, 6), (q, _nx, ny) => {
        if (ny < 0) q.x += 0.006 * ny;
      });
      b.mat(PAL.WOOD, 0.6);
      b.tube([{ x, y: 0.965, z: 0.02 }, { x, y: 0.99, z: 0.02 }], () => 0.011, 8, { capEnd: true });
      b.mat(PAL.LEATHER_DARK, 0.7);
      b.tube([{ x, y: 0.97, z: 0.02 }, { x: x * 0.95, y: 1.04, z: 0.03 }], () => 0.004, 5, {});
      // Water emblem.
      placeEmblem(ctx, 'wave', { x: x - 0.032, y: 0.89, z: 0.006 }, 0.03, PAL.STONE2, 0);
      break;
    }
    case 'fans': {
      for (const [x, rot] of [[0.13, 0.3], [0.165, 0.5]] as const) {
        const t = torsoAt(ctx, 0.98);
        const z = t.z - t.hd * 0.4;
        b.skin = [BI.hips, 1];
        b.pushMatrix(new THREE.Matrix4().makeRotationZ(rot).setPosition(x + topOff(ctx), 0.97, z));
        b.mat(PAL.GOLD, 0.3, 0.7);
        b.grid(2, 1, (_i, j, u, _v, out) => {
          const w = lerp(0.012, 0.034, j);
          out.x = (u - 0.5) * 2 * w * 0.3;
          out.y = j * 0.3 - 0.08;
          out.z = (u - 0.5) * 2 * w;
        }, { double: true, smooth: false });
        b.mat(PAL.TRIM, 0.8);
        b.ellipsoid(0, -0.09, 0, 0.006, 0.012, 0.006, 6, 4);
        b.popMatrix();
      }
      break;
    }
    case 'swords': {
      // Dual dao in one scabbard on the back, handles over the right shoulder.
      const a: P3 = { x: 0.13, y: 0.82, z: back(1.0) - 0.03 };
      const c: P3 = { x: -0.14, y: 1.62, z: back(1.38) - 0.03 };
      b.skin = [BI.chest, 0.7, BI.spine, 0.3];
      b.mat(PAL.LEATHER_DARK, 0.6);
      b.tube([a, { x: lerp(a.x, c.x, 0.82), y: lerp(a.y, c.y, 0.82), z: lerp(a.z, c.z, 0.82) }], (k) => (k === 0 ? 0.03 : 0.036), 8, { rz: () => 0.016, capStart: true, capEnd: true, up: { x: 0, y: 0, z: 1 } });
      b.mat(PAL.GOLD, 0.35, 0.6);
      const g = { x: lerp(a.x, c.x, 0.83), y: lerp(a.y, c.y, 0.83), z: lerp(a.z, c.z, 0.83) };
      b.ellipsoid(g.x, g.y, g.z, 0.03, 0.008, 0.02, 8, 4);
      b.mat(PAL.LEATHER, 0.7);
      for (const dx of [-0.008, 0.008]) b.tube([{ x: g.x + dx, y: g.y, z: g.z }, { x: c.x + dx, y: c.y, z: c.z }], () => 0.009, 6, { capEnd: true });
      break;
    }
    case 'satchel': {
      const t = torsoAt(ctx, 0.95);
      const x = t.hw + topOff(ctx) + 0.03;
      b.skin = [BI.hips, 1];
      b.mat(PAL.LEATHER, 0.7);
      b.box(x, 0.92, 0.0, 0.05, 0.12, 0.16);
      b.mat(PAL.LEATHER_DARK, 0.7);
      b.box(x + 0.004, 0.96, 0.0, 0.052, 0.045, 0.165);
      // Strap across the chest from the right shoulder.
      const pts: P3[] = [];
      const n = ctx.seg(14, 7);
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        const y = lerp(1.44, 0.97, s);
        const xx = lerp(-0.12, x, s);
        const tt = torsoAt(ctx, Math.max(0.95, y));
        const zf = tt.z + Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(0.99, Math.abs(xx) / (tt.hw + 0.02)), 2.3))) * tt.hd + topOff(ctx) + 0.004;
        pts.push({ x: xx, y, z: zf });
      }
      b.tube(pts, () => 0.012, 5, { rz: () => 0.002, up: { x: 0, y: 0, z: 1 }, perPoint: (k) => (b.skin = torsoSkin(pts[k].y, 0, 0.15)) });
      break;
    }
    case 'arm_bands': {
      b.mat(PAL.GOLD, 0.35, 0.65);
      for (const side of [1, -1]) {
        const A = ctx.J(side > 0 ? 'upperArmL' : 'upperArmR');
        const ua = side > 0 ? BI.upperArmL : BI.upperArmR;
        const sl = shapeStr(ctx.items.top, 'sleeves', 'none');
        const loose = sl === 'none' ? 1 : sl === 'short' ? 1 : 1.12;
        for (const dy of [-0.09, -0.115]) {
          const r = armRadius(ctx, dy);
          const rr = [dy + 0.007, dy - 0.007].map((y) => ({ c: [A[0], A[1] + y, A[2]] as V3, rx: r.rx * loose + 0.007, rz: r.rz * loose + 0.007, skin: [ua, 1] as SkinSpec }));
          b.grid(ctx.seg(16, 8), 1, (_i, j, u, _v, out) => {
            const a = u * Math.PI * 2;
            const R = rr[j];
            out.x = R.c[0] + Math.sin(a) * R.rx;
            out.y = R.c[1];
            out.z = R.c[2] + Math.cos(a) * R.rz;
            b.skin = R.skin;
          }, { closedU: true, flip: true, double: true });
        }
      }
      break;
    }
  }
}

export { furRing };
