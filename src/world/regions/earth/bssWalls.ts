import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { KitMaterialName } from '../../kit/Materials';
import type { P2 } from '../../WorldLayout';
import { C, DEG, GROUND, INNER, INNER_GATES, OUTER, OUTER_GATES, outerR, polar, qkey, type GateDef } from './bssLayout';
import type { BuildEnv } from './env';
import { bannerPole, hangingBanner, paifang, stoneLantern } from './parts';
import { gatehouse, longStairs, LoopPath, loopWall, sectionsBetween, type WallStyle } from './walls';

/**
 * Ba Sing Se fortifications: the Outer Wall (34 m, walkable top, three
 * monumental gatehouses, wall stairs and watch towers), the Inner Wall (20 m,
 * four gates) and the raised ring terraces (Middle / Upper Ring retaining walls
 * with parapets, walkable tops, stair-gates).
 */

export const OUTER_STYLE: WallStyle = {
  height: OUTER.height,
  thick: OUTER.thick,
  batterOut: 3,
  batterIn: 1.2,
  body: 'stone_tan',
  trim: 'stone_light',
  band: 'stone_light',
  bands: [0.34, 0.68],
  plinthH: 2.6,
  walk: 'paving',
  merlonW: 2.2,
  merlonH: 1.6,
  merlonGap: 1.5,
  parapetH: 1.3,
  innerParapetH: 1.1,
};

export const INNER_STYLE: WallStyle = {
  height: INNER.height,
  thick: INNER.thick,
  batterOut: 1.8,
  batterIn: 0.8,
  body: 'stone_light',
  trim: 'stone_tan',
  band: 'stone_tan',
  bands: [0.5],
  plinthH: 1.8,
  walk: 'paving',
  merlonW: 1.8,
  merlonH: 1.3,
  merlonGap: 1.3,
  parapetH: 1.2,
  innerParapetH: 1.0,
  innerMerlons: true,
};

export const OUTER_GATE = { W: 48, D: 24, passage: 12, spring: 10 };
export const INNER_GATE = { W: 30, D: 16, passage: 10, spring: 7 };

export interface WallRecord {
  outerPath: LoopPath;
  innerPath: LoopPath;
  /** Wall-top stair landings: bottom point, top point (y = wall top). */
  stairs: Array<{ id: string; bottom: P2; top: P2; topY: number; walkTop: P2; landing: P2 }>;
  gates: Array<{ id: string; ring: 'outer' | 'inner'; x: number; z: number; inX: number; inZ: number; outX: number; outZ: number }>;
}

/** Wall chunk for an arc position (both loops share four quadrant chunks per material). */
function arcChunk(env: BuildEnv, path: LoopPath, s: number) {
  const p = path.at(s);
  return env.chunks.named('major', `q:${qkey(p.x, p.z)}`);
}

function gateOut(g: GateDef): P2 {
  return { x: Math.cos(g.theta), z: Math.sin(g.theta) };
}

/** Build one loop wall with gates, stair landings and towers. */
function cityWall(
  env: BuildEnv,
  o: {
    key: string;
    path: LoopPath;
    style: WallStyle;
    gates: GateDef[];
    gate: { W: number; D: number; passage: number; spring: number };
    tower: { w: number; d: number; h: number; tiers: number };
    stairs: Array<{ gate: string; side: 1 | -1; gap: number }>;
    arcs: number;
    rec: WallRecord;
    ring: 'outer' | 'inner';
  },
): void {
  const { path, style } = o;
  const top = GROUND + style.height;
  const total = path.total;
  const gaps: Array<[number, number]> = o.gates.map((g) => {
    const s = path.sOf(g.theta);
    return [s - o.gate.W / 2, s + o.gate.W / 2];
  });
  // Stair runs (straight chords inside the wall) and their landing ranges.
  const tread = 0.42;
  const steps = Math.round(style.height / 0.25);
  const run = steps * tread;
  const inset = style.thick / 2 + style.batterIn + 2.6; // stair centre line distance inside the wall centre line
  const landings: Array<[number, number]> = [];
  const stairDefs: Array<{ id: string; sTop: number; sBot: number }> = [];
  for (const st of o.stairs) {
    const g = o.gates.find((q) => q.id === st.gate);
    if (!g) continue;
    const sg = path.sOf(g.theta);
    const sTop = sg + st.side * (o.gate.W / 2 + st.gap);
    // Find sBot so that the chord length (on the inset curve) equals the run.
    let sBot = sTop + st.side * run;
    for (let k = 0; k < 6; k++) {
      const a = path.offset(sTop, -inset), b = path.offset(sBot, -inset);
      const l = Math.hypot(a.x - b.x, a.z - b.z);
      sBot = sTop + ((sBot - sTop) * run) / Math.max(1, l);
    }
    stairDefs.push({ id: `${o.key}_${st.gate}_${st.side > 0 ? 'a' : 'b'}`, sTop, sBot });
    landings.push([sTop - 7, sTop + 7]);
  }
  loopWall(env.chunks, { path, sections: sectionsBetween(total, gaps), parapetGaps: landings.map(([a, b]) => [path.wrap(a), path.wrap(a) + (b - a)]), baseY: GROUND, style, key: 'walls', arcs: 4, segLen: 15, chunkKey: (a, b) => `q:${qkey((a.x + b.x) / 2, (a.z + b.z) / 2)}` });

  // Gatehouses
  for (const g of o.gates) {
    const b = arcChunk(env, path, path.sOf(g.theta)).builder;
    const out = gateOut(g);
    gatehouse(b, env.mats, {
      x: g.x,
      z: g.z,
      out,
      baseY: GROUND,
      width: o.gate.W,
      depth: o.gate.D,
      height: style.height,
      passageW: o.gate.passage,
      spring: o.gate.spring,
      body: style.body,
      trim: style.trim,
      roof: 'roof_green',
      tower: o.tower,
      banners: true,
      doors: true,
    });
    const inP = { x: g.x - out.x * (o.gate.D / 2 + 3), z: g.z - out.z * (o.gate.D / 2 + 3) };
    const outP = { x: g.x + out.x * (o.gate.D / 2 + 3), z: g.z + out.z * (o.gate.D / 2 + 3) };
    o.rec.gates.push({ id: g.id, ring: o.ring, x: g.x, z: g.z, inX: inP.x, inZ: inP.z, outX: outP.x, outZ: outP.z });
    // Keep the passage, both mouths and the flanks of the approach clear.
    env.excl.seg(g.x - out.x * (o.gate.D / 2 + 30), g.z - out.z * (o.gate.D / 2 + 30), g.x + out.x * (o.gate.D / 2 + 30), g.z + out.z * (o.gate.D / 2 + 30), o.gate.passage / 2 + 4);
    env.excl.box(g.x, g.z, o.gate.W / 2 + 2, o.gate.D / 2 + 2, Math.atan2(out.x, out.z));
    // Guardian lanterns and banner poles at the inner mouth.
    const pb = env.chunks.at('props', inP.x, inP.z).builder;
    const right = { x: Math.cos(Math.atan2(out.x, out.z)), z: -Math.sin(Math.atan2(out.x, out.z)) };
    for (const sd of [-1, 1]) {
      const q = { x: inP.x + right.x * sd * (o.gate.passage / 2 + 3), z: inP.z + right.z * sd * (o.gate.passage / 2 + 3) };
      stoneLantern(pb, q.x, GROUND, q.z, 1.6);
      const bp = { x: inP.x - out.x * 4 + right.x * sd * (o.gate.passage / 2 + 5), z: inP.z - out.z * 4 + right.z * sd * (o.gate.passage / 2 + 5) };
      bannerPole(pb, env.mats, bp.x, GROUND, bp.z, Math.atan2(out.x, out.z) + Math.PI / 2, 9);
    }
  }

  // Wall stairs: straight flight along the inside, with a landing pier bridging to the walkway.
  for (const sd of stairDefs) {
    const bot = path.offset(sd.sBot, -inset), tp = path.offset(sd.sTop, -inset);
    const L = Math.hypot(tp.x - bot.x, tp.z - bot.z);
    const dir = { x: (tp.x - bot.x) / L, z: (tp.z - bot.z) / L };
    const b = arcChunk(env, path, sd.sTop).builder;
    const res = longStairs(b, { x: bot.x, z: bot.z, dir, baseY: GROUND, rise: style.height, width: 4.2, material: style.trim, rail: 2, railMat: style.body });
    // Landing pier: starts exactly where the flight ends (no step to climb) and
    // reaches across to the walkway, full height.
    const wt = path.at(sd.sTop + (sd.sTop > sd.sBot ? 1.5 : -1.5));
    let vx = -dir.z, vz = dir.x;
    if (vx * (wt.x - res.top.x) + vz * (wt.z - res.top.z) < 0) {
      vx = -vx;
      vz = -vz;
    }
    const dv = vx * (wt.x - res.top.x) + vz * (wt.z - res.top.z);
    const PL = 5.4;
    const pc = { x: res.top.x + dir.x * (PL / 2 - 0.05) + vx * (dv / 2), z: res.top.z + dir.z * (PL / 2 - 0.05) + vz * (dv / 2) };
    const yawA = Math.atan2(-dir.z, dir.x);
    b.box(style.body, { x: pc.x, y: GROUND + style.height / 2 - 0.25, z: pc.z, sx: PL, sy: style.height + 0.5, sz: dv + 3, yaw: yawA }, { collide: true, walkable: true, surface: 'stone' });
    b.box('paving', { x: pc.x, y: GROUND + style.height + 0.03, z: pc.z, sx: PL - 0.4, sy: 0.06, sz: dv + 2.6, yaw: yawA }, { castShadow: false });
    env.excl.seg(bot.x, bot.z, tp.x, tp.z, 5);
    env.excl.circle(pc.x, pc.z, 6);
    o.rec.stairs.push({ id: sd.id, bottom: { x: bot.x - dir.x * 2, z: bot.z - dir.z * 2 }, top: res.top, topY: top, walkTop: wt, landing: { x: res.top.x + dir.x * 2, z: res.top.z + dir.z * 2 } });
  }

  // Watch towers on the outer face (big silhouettes), skipping gates and stairs.
  if (o.ring === 'outer') {
    const n = Math.round(total / 150);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (total / n);
      const near = gaps.some(([a, bnd]) => {
        const m = (a + bnd) / 2;
        const d = Math.abs(((s - m + total * 1.5) % total) - total / 2);
        return d < o.gate.W;
      });
      if (near) continue;
      const p = path.offset(s, style.thick / 2 + style.batterOut + 2.5);
      const out = path.outward(p.x, p.z);
      const yaw = Math.atan2(out.x, out.z);
      const b = arcChunk(env, path, s).builder;
      const th = style.height + 7;
      b.block(style.body, { x: p.x, y: GROUND, z: p.z, sx: 11, sy: th, sz: 7, yaw }, { collide: true, walkable: true });
      b.box(style.trim, { x: p.x, y: GROUND + th - 0.3, z: p.z, sx: 11.8, sy: 0.6, sz: 7.8, yaw });
      b.box(style.trim, { x: p.x, y: GROUND + style.height * 0.5, z: p.z, sx: 11.4, sy: 0.6, sz: 7.4, yaw });
      b.block('wood_red', { x: p.x, y: GROUND + th, z: p.z, sx: 7, sy: 3.2, sz: 4.4, yaw });
      b.roof('roof_green', { x: p.x, y: GROUND + th + 3.2, z: p.z, w: 7, d: 4.4, height: 2.6, yaw, overhang: 1.4, style: 'hip', curve: 0.8 });
      hangingBanner(b, env.mats, p.x + out.x * 3.6, GROUND + th - 3, p.z + out.z * 3.6, yaw - Math.PI / 2, 3.2, 12);
    }
  }
}

export function buildOuterWall(env: BuildEnv, rec: WallRecord): void {
  cityWall(env, {
    key: 'outer',
    path: rec.outerPath,
    style: OUTER_STYLE,
    gates: OUTER_GATES,
    gate: OUTER_GATE,
    tower: { w: 30, d: 11, h: 7, tiers: 2 },
    // West gate: stair south of the gate (the rail spur station sits north of it).
    stairs: [
      { gate: 'west', side: -1, gap: 8 },
      { gate: 'south', side: 1, gap: 8 },
      { gate: 'east', side: -1, gap: 8 },
    ],
    arcs: 8,
    rec,
    ring: 'outer',
  });
}

export function buildInnerWall(env: BuildEnv, rec: WallRecord): void {
  cityWall(env, {
    key: 'inner',
    path: rec.innerPath,
    style: INNER_STYLE,
    gates: INNER_GATES,
    gate: INNER_GATE,
    tower: { w: 18, d: 8, h: 5, tiers: 1 },
    stairs: [{ gate: 'west', side: 1, gap: 6 }], // north of the gate (the square's stalls line the wall to the south)
    arcs: 6,
    rec,
    ring: 'inner',
  });
}

export function makeWallRecord(): WallRecord {
  return {
    outerPath: new LoopPath(C, outerR, 1440),
    innerPath: new LoopPath(C, () => INNER.r, 960),
    stairs: [],
    gates: [],
  };
}

// ---------------------------------------------------------------------------
// Ring terraces (Middle / Upper Ring)
// ---------------------------------------------------------------------------

export interface TerraceGateDef {
  id: string;
  /** Point on the outer face. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
}

export interface TerraceOpts {
  key: string;
  c: P2;
  /** Wall centre-line radius. */
  r: number;
  thick: number;
  base: number;
  level: number;
  body: KitMaterialName;
  trim: KitMaterialName;
  ground: THREE.Material;
  parapetH: number;
  gates: TerraceGateDef[];
  arcs: number;
}

export interface TerraceRecord {
  stairs: Array<{ id: string; bottom: P2; top: P2; topY: number; baseY: number }>;
}

/** Raised terrace: retaining wall ring + walkable top + parapet + stair gates. */
export function buildTerrace(env: BuildEnv, o: TerraceOpts): TerraceRecord {
  const rec: TerraceRecord = { stairs: [] };
  const H = o.level - o.base;
  const outer = o.r + o.thick / 2;
  const segs = Math.max(24, Math.ceil((2 * Math.PI * o.r) / 12));
  const gateArc = o.gates.map((g) => ({ g, th: Math.atan2(g.z - o.c.z, g.x - o.c.x), half: (g.width / 2 + 1.2) / outer }));
  const inGate = (t: number): boolean =>
    gateArc.some(({ th, half }) => {
      let d = Math.abs(t - th) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d < half;
    });
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2, t1 = ((i + 1) / segs) * Math.PI * 2, tm = (t0 + t1) / 2;
    const a = polar(t0, o.r, o.c), c2 = polar(t1, o.r, o.c);
    const len = Math.hypot(c2.x - a.x, c2.z - a.z) + 0.25;
    const mx = (a.x + c2.x) / 2, mz = (a.z + c2.z) / 2;
    const yaw = Math.atan2(-(c2.z - a.z), c2.x - a.x);
    const ox = Math.cos(tm), oz = Math.sin(tm);
    const b = env.chunks.named('major', `q:${qkey(mx, mz)}`).builder;
    // Retaining wall body (walkable top = terrace level), plinth and coping.
    b.box(o.body, { x: mx, y: o.base - 0.5 + (H + 0.5) / 2 - 0.25, z: mz, sx: len, sy: H, sz: o.thick, yaw });
    b.box(o.trim, { x: mx + ox * 0.15, y: o.base + 0.5, z: mz + oz * 0.15, sx: len, sy: 1.2, sz: o.thick + 0.5, yaw });
    b.box(o.trim, { x: mx, y: o.level - 0.25, z: mz, sx: len, sy: 0.5, sz: o.thick + 0.5, yaw });
    b.collider({ shape: 'box', x: mx, y: (o.base - 0.5 + o.level) / 2, z: mz, hx: len / 2, hz: o.thick / 2 + 0.25, hy: (o.level - o.base + 0.5) / 2, yaw, walkable: true, solid: true, surface: 'stone' });
    if (!inGate(tm)) {
      // Outer parapet with merlons and a green tile cap.
      const px = mx + ox * (o.thick / 2 - 0.35), pz = mz + oz * (o.thick / 2 - 0.35);
      b.box(o.body, { x: px, y: o.level + o.parapetH / 2, z: pz, sx: len, sy: o.parapetH, sz: 0.7, yaw });
      b.box('roof_green', { x: px, y: o.level + o.parapetH + 0.12, z: pz, sx: len, sy: 0.24, sz: 1.1, yaw });
      b.collider({ shape: 'box', x: px, y: o.level + 0.75, z: pz, hx: len / 2, hz: 0.35, hy: 0.75, yaw, walkable: false, solid: true });
    }
  }
  // Terrace top: walkable cylinder + visual disc.
  const cyl = env.chunks.named('major', 'ground').builder;
  cyl.collider({ shape: 'cylinder', x: o.c.x, y: (o.base - 0.5 + o.level) / 2, z: o.c.z, r: o.r - o.thick / 2 + 0.1, hy: (o.level - o.base + 0.5) / 2, walkable: true, solid: true, surface: 'stone' });
  const disc = new THREE.CircleGeometry(o.r - o.thick / 2 + 0.2, 96);
  disc.rotateX(-Math.PI / 2);
  const uv = disc.getAttribute('uv') as THREE.BufferAttribute;
  const pos = disc.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + o.c.x) / 6, -(pos.getZ(i) + o.c.z) / 6);
  cyl.mesh(o.ground, disc, { x: o.c.x, y: o.level + 0.01, z: o.c.z }, { castShadow: false });
  disc.dispose();

  // Stair gates.
  for (const g of o.gates) {
    const b = env.chunks.named('major', `q:${qkey(g.x, g.z)}`).builder;
    const steps = Math.round(H / 0.25);
    const run = steps * 0.42;
    const bx = g.x + g.nx * (run + 0.3), bz = g.z + g.nz * (run + 0.3);
    longStairs(b, { x: bx, z: bz, dir: { x: -g.nx, z: -g.nz }, baseY: o.base, rise: H, width: g.width, material: 'stone_light', rail: 2, railMat: o.trim });
    // Gateway on the terrace edge.
    const tx = -g.nz, tz = g.nx;
    const yaw = Math.atan2(-tz, tx);
    const pg = { x: g.x - g.nx * 1.6, z: g.z - g.nz * 1.6 };
    paifang(b, pg.x, o.level, pg.z, yaw, g.width + 2.4, 8.5, { posts: 4, roof: 'roof_green' });
    // Banners on the wall either side of the stairs.
    for (const sd of [-1, 1]) {
      const q = { x: g.x + tx * sd * (g.width / 2 + 3) + g.nx * 0.1, z: g.z + tz * sd * (g.width / 2 + 3) + g.nz * 0.1 };
      hangingBanner(b, env.mats, q.x + g.nx * 0.05, o.level + o.parapetH, q.z + g.nz * 0.05, Math.atan2(g.nx, g.nz) - Math.PI / 2, 2.2, Math.min(5.5, H + 0.5));
    }
    env.excl.seg(bx + g.nx * 14, bz + g.nz * 14, g.x - g.nx * 14, g.z - g.nz * 14, g.width / 2 + 3);
    rec.stairs.push({ id: `${o.key}_${g.id}`, bottom: { x: bx + g.nx * 1.5, z: bz + g.nz * 1.5 }, top: { x: g.x - g.nx * 3, z: g.z - g.nz * 3 }, topY: o.level, baseY: o.base });
  }
  return rec;
}

/** Degrees helper for builders. */
export const deg = (d: number): number => d * DEG;

/** Unit vector helper. */
export function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}
