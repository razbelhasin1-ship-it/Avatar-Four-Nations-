import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { getRoadRuntime, heightAt } from '../../Heightfield';
import type { AmbientSite, LayerOptions } from './FireRegion';
import type { FlameField } from './flames';
import { mulberry } from './geom';
import { CAPITAL } from './layout';
import { basaltMat, bannerDarkMat, crimsonMat, crustMat, goldMat, lavaMat } from './materials';
import { brazier, crest, groundWall, lanternPost, local, rock, roof, wallBanner, yawTo } from './parts';

const C = CAPITAL;

/** Rim gate geometry (shared with spots/tests). */
export const RIM_GATE = (() => {
  const g = C.rimGate;
  // Road direction through the pass (outside → inside the caldera).
  const fx = -1170 - -1050, fz = 1100 - 1050;
  const yaw = Math.atan2(fx, fz);
  return { x: g.x, z: g.z, yaw, passage: 13, towerW: 11, depth: 16, h: 21, passH: 10.5 };
})();

/** Lava vents on the volcano's outer flanks (positions shared with the e2e test). */
export const LAVA_VENTS: Array<{ x: number; z: number; r: number }> = [
  { x: -1028, z: 1112, r: 3.2 },
  { x: -1062, z: 1004, r: 2.6 },
  { x: -1024, z: 1244, r: 3.6 },
  { x: -985, z: 1052, r: 2.2 },
];

/**
 * Rim gatehouse on the pass of the causeway road (the only break in the
 * caldera rim), with flanking walls that climb the rim slopes, the lantern
 * line along the causeway road and glowing lava vents with smoke on the
 * volcano's outer flanks.
 */
export function buildRimGate(_ctx: GameContext, layer: (name: string, o?: LayerOptions) => ContentBuilder, flames: FlameField, ambient: (s: AmbientSite) => void): void {
  const s = layer('rim_gate', { far: true });
  const d = layer('rim_gate_detail');
  const G = RIM_GATE;
  const L = (lx: number, lz: number) => local(G.x, G.z, G.yaw, lx, lz);
  // Road height at the pass (lowest of the passage footprint keeps the floor flush).
  let roadY = Infinity;
  for (const lz of [-G.depth / 2, 0, G.depth / 2]) for (const lx of [-3, 0, 3]) {
    const p = L(lx, lz);
    roadY = Math.min(roadY, heightAt(p.x, p.z));
  }
  const Y = roadY;
  const towerX = G.passage / 2 + G.towerW / 2;

  // --- Towers ---
  for (const side of [-1, 1]) {
    const c = L(side * towerX, 0);
    s.block(basaltMat(), { x: c.x, y: Y - 8, z: c.z, sx: G.towerW + 1.4, sy: 9.6, sz: G.depth + 1.4, yaw: G.yaw }, { collide: true, walkable: true });
    s.block(crimsonMat(), { x: c.x, y: Y + 1.6, z: c.z, sx: G.towerW, sy: G.h - 1.6, sz: G.depth, yaw: G.yaw }, { collide: true, walkable: true });
    // Gold bands and black frieze.
    for (const by of [6.5, 13]) s.box(goldMat(), { x: c.x, y: Y + by, z: c.z, sx: G.towerW + 0.12, sy: 0.16, sz: G.depth + 0.12, yaw: G.yaw }, { castShadow: false });
    s.box('black_lacquer', { x: c.x, y: Y + G.h - 0.7, z: c.z, sx: G.towerW + 0.2, sy: 1.4, sz: G.depth + 0.2, yaw: G.yaw });
    // Arrow-slit windows on both faces.
    for (const fz of [-1, 1]) for (const lx of [-3, 0, 3]) {
      const p = local(c.x, c.z, G.yaw, lx, fz * (G.depth / 2 + 0.04));
      d.box('black_lacquer', { x: p.x, y: Y + 15.5, z: p.z, sx: 0.5, sy: 2.4, sz: 0.08, yaw: G.yaw }, { castShadow: false });
    }
    // Tower roofs (pyramid) and banners on both faces.
    roof(s, { x: c.x, y: Y + G.h, z: c.z, w: G.towerW, d: G.depth, h: 3.6, style: 'pyramid', mat: 'roof_dark', overhang: 1.6, curve: 1.0, tips: 1.1, finial: 2.6 });
    for (const fz of [-1, 1]) {
      const p = local(c.x, c.z, G.yaw, 0, fz * (G.depth / 2 + 0.12));
      wallBanner(d, { x: p.x, y: Y + 12.2, z: p.z, yaw: G.yaw + (fz < 0 ? Math.PI : 0), w: 3.4, len: 9, mat: bannerDarkMat() });
    }
  }
  // --- Bridge storey over the passage ---
  const bc = L(0, 0);
  s.block(crimsonMat(), { x: bc.x, y: Y + G.passH, z: bc.z, sx: G.passage + 0.2, sy: G.h - G.passH, sz: G.depth - 1.2, yaw: G.yaw }, { collide: true, walkable: true });
  s.box('black_lacquer', { x: bc.x, y: Y + G.passH + 0.35, z: bc.z, sx: G.passage + 0.4, sy: 0.7, sz: G.depth - 0.8, yaw: G.yaw });
  for (const fz of [-1, 1]) {
    const p = L(0, fz * ((G.depth - 1.2) / 2 + 0.14));
    crest(s, { x: p.x, y: Y + G.passH + (G.h - G.passH) / 2 + 0.6, z: p.z, yaw: G.yaw + (fz < 0 ? Math.PI : 0), size: 3.2 });
  }
  roof(s, { x: bc.x, y: Y + G.h + 1.2, z: bc.z, w: G.passage + G.towerW * 2 - 8, d: G.depth + 2, h: 6, yaw: G.yaw, mat: 'roof_dark', overhang: 2.4, curve: 1.4, horns: 2.8, tips: 1.5, crest: 2.2 });
  s.block(crimsonMat(), { x: bc.x, y: Y + G.h - 0.2, z: bc.z, sx: G.passage + G.towerW * 2 - 9, sy: 1.5, sz: G.depth - 2, yaw: G.yaw });
  // Open gate leaves against the passage walls (the road itself is the paved terrain road).
  for (const side of [-1, 1]) {
    const p = L(side * (G.passage / 2 - 0.35), G.depth / 2 - 3.6);
    d.box('wood_red', { x: p.x, y: Y + G.passH / 2 - 0.2, z: p.z, sx: 0.4, sy: G.passH - 0.8, sz: 6.6, yaw: G.yaw });
    for (let k = 0; k < 5; k++) d.box(goldMat(), { x: p.x - Math.cos(G.yaw) * side * 0.22, y: Y + 1.3 + k * 1.8, z: p.z + Math.sin(G.yaw) * side * 0.22, sx: 0.06, sy: 0.14, sz: 6.4, yaw: G.yaw }, { castShadow: false });
  }
  // Braziers at both faces, banners poles.
  for (const fz of [-1, 1]) for (const side of [-1, 1]) {
    const p = L(side * (G.passage / 2 + 1.6), fz * (G.depth / 2 + 3));
    brazier(d, flames, { x: p.x, y: heightAt(p.x, p.z), z: p.z, size: 1.4 });
    if (fz < 0) ambient({ x: p.x, y: heightAt(p.x, p.z) + 3, z: p.z, preset: 'embers', rate: 3, range: 45 });
  }

  // --- Rim walls climbing the slopes on both sides ---
  for (const side of [-1, 1]) {
    const pts: Array<{ x: number; z: number }> = [];
    for (let k = 0; k <= 14; k++) {
      const lx = side * (G.passage / 2 + G.towerW - 1 + k * 6);
      const p = L(lx, 0);
      pts.push(p);
      if (heightAt(p.x, p.z) > Y + 16) break;
    }
    groundWall(s, pts, { ground: heightAt, h: 8, thick: 3.2, mat: basaltMat(), cap: crimsonMat(), merlons: true, seg: 6 });
  }

  // --- Lantern line along the causeway road (outside the caldera) ---
  const road = getRoadRuntime().find((r) => r.id === 'fire_causeway_road');
  if (road) {
    let side = 1;
    for (let sAlong = 10; sAlong < road.line.length - 70; sAlong += 24) {
      const p = road.line.pointAt(sAlong);
      const q = road.line.pointAt(Math.min(road.line.length, sAlong + 1));
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const off = road.half + 1.1;
      const lx = p.x + nx * off * side, lz = p.z + nz * off * side;
      // Skip the gatehouse footprint.
      if (Math.hypot(lx - G.x, lz - G.z) < 16) {
        side = -side;
        continue;
      }
      lanternPost(d, { x: lx, y: heightAt(lx, lz), z: lz, yaw: yawTo(lx, lz, p.x, p.z), h: 3.4 });
      side = -side;
    }
  }

  // --- Lava vents and smoke on the outer flanks ---
  const v = layer('lava_vents', { far: true, shadows: false });
  const r = mulberry(99);
  for (const vent of LAVA_VENTS) {
    const y = heightAt(vent.x, vent.z);
    v.cylinder(lavaMat(), { x: vent.x, y: y - 0.3, z: vent.z, r: vent.r, rTop: vent.r * 0.92, h: 0.5, segments: 14 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + r() * 0.4;
      const rr = vent.r + 0.6 + r() * 0.8;
      const x = vent.x + Math.cos(a) * rr, z = vent.z + Math.sin(a) * rr;
      rock(v, { x, y: heightAt(x, z) - 0.3, z, s: 1.1 + r() * 1.2, sy: 0.7 + r() * 0.6, yaw: r() * 6, variant: k, mat: crustMat(), collide: true });
    }
    // Glowing seams running downhill.
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2;
      const len = 6 + r() * 6;
      const cx = vent.x + Math.cos(a) * (vent.r + len / 2), cz = vent.z + Math.sin(a) * (vent.r + len / 2);
      v.box(lavaMat(), { x: cx, y: heightAt(cx, cz) + 0.02, z: cz, sx: len, sy: 0.12, sz: 0.35 + r() * 0.3, yaw: -a }, { castShadow: false });
    }
    ambient({ x: vent.x, y: y + 1.2, z: vent.z, preset: 'smoke', rate: 2.2, range: 160, essential: true, size: 2.2, speed: 1.2, dir: new THREE.Vector3(0.15, 1, 0) });
    ambient({ x: vent.x, y: y + 0.6, z: vent.z, preset: 'embers', rate: 2, range: 70 });
  }
}
