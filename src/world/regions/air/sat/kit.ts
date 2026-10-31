import * as THREE from 'three';
import * as G from '../geom';
import * as P from '../parts';
import { am, archedWindowGeo, faceYaw, repeatProp, type Kit, type Mat } from '../parts';
import type { P2 } from '../../../WorldLayout';

/**
 * Air Nomad building kit for the Southern Air Temple: pagoda halls (cream
 * walls on a white plinth, rounded corner drums, orange-yellow trim, exposed
 * rafters, arched and round openings, balconies, two or three tiers of
 * upturned blue roofs, a gold finial), the arched loggia of the bison
 * terrace, stable caves, gates, arched bridges, orchard trees and the small
 * pieces that dress terraces. Frames: local +Z is the front (yaw = rotation.y).
 */

/**
 * Wall with a round-topped passage: w wide, h tall, `depth` thick (along Z, centred), the opening
 * openW wide with straight jambs up to `spring` and a semicircle above.
 */
export function archWall(w: number, h: number, depth: number, openW: number, spring: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-openW / 2, 0);
  s.lineTo(-openW / 2, spring);
  s.absarc(0, spring, openW / 2, Math.PI, 0, true);
  s.lineTo(openW / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Point at local (u, v) from (x, z) with the frame's yaw (u right, v forward). */
export function lp(x: number, z: number, yaw: number, u: number, v: number): P2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: x + c * u + s * v, z: z - s * u + c * v };
}

export interface HallOpts {
  x: number;
  z: number;
  /** Floor (walking) height in front of the hall. */
  y: number;
  yaw: number;
  w: number;
  d: number;
  /** Storeys (1-3); the upper ones step in. */
  storeys?: number;
  /** Blue (temple) or blue-grey (halls) tiles. */
  roof?: 'blue' | 'slate' | 'teal';
  balcony?: boolean;
  /** Door on the front face (default true). */
  door?: boolean;
  /** Flight of steps up the plinth's front (default true). */
  steps?: boolean;
  wall?: Mat;
}

/** Pagoda hall; returns the height of its finial tip. */
export function pagodaHall(k: Kit, o: HallOpts): number {
  const storeys = o.storeys ?? 2;
  const roofMat = am(o.roof === 'blue' ? 'roof' : o.roof === 'teal' ? 'roofTeal' : 'roofSlate');
  const wall = o.wall ?? 'plaster_cream';
  const b = k.main;
  const yaw = o.yaw;
  const at = (u: number, v: number) => lp(o.x, o.z, yaw, u, v);
  // Plinth with a front flight of steps.
  const plinth = 0.9;
  b.box('stone_white', { x: o.x, y: o.y + plinth / 2 - 0.3, z: o.z, sx: o.w + 1.6, sy: plinth + 0.6, sz: o.d + 1.6, yaw }, { collide: true, walkable: true });
  b.box('stone_light', { x: o.x, y: o.y + plinth - 0.03, z: o.z, sx: o.w + 1.8, sy: 0.12, sz: o.d + 1.8, yaw });
  if (o.steps !== false) P.flight(k, { a: at(0, o.d / 2 + 2.9), b: at(0, o.d / 2 + 0.8), y0: o.y, y1: o.y + plinth, width: Math.min(5, o.w * 0.4), base: o.y - 0.3 });
  let y = o.y + plinth;
  let w = o.w, d = o.d;
  const fh = 4.2;
  for (let s = 0; s < storeys; s++) {
    // Walls with rounded corner drums.
    b.box(wall, { x: o.x, y: y + fh / 2, z: o.z, sx: w - 1.0, sy: fh, sz: d, yaw });
    b.box(wall, { x: o.x, y: y + fh / 2, z: o.z, sx: w, sy: fh, sz: d - 1.0, yaw });
    for (const cu of [-1, 1]) for (const cv of [-1, 1]) {
      const c = at(cu * (w / 2 - 0.5), cv * (d / 2 - 0.5));
      b.cylinder('plaster_white', { x: c.x, y, z: c.z, r: 0.62, h: fh, segments: 12 });
      b.cylinder('stone_light', { x: c.x, y, z: c.z, r: 0.7, h: 0.35, segments: 12 });
    }
    // Trim: a warm band under the eaves, a wooden lintel course and exposed rafter ends.
    b.box(am('trimOrange'), { x: o.x, y: y + fh - 0.32, z: o.z, sx: w + 0.12, sy: 0.22, sz: d + 0.12, yaw });
    b.box('wood_dark', { x: o.x, y: y + fh - 0.08, z: o.z, sx: w + 0.3, sy: 0.24, sz: d + 0.3, yaw });
    const raf = Math.max(3, Math.round(w / 1.1));
    for (let i = 0; i <= raf; i++) {
      for (const side of [-1, 1]) {
        const q = at(-w / 2 + (i * w) / raf, side * (d / 2 + 0.5));
        repeatProp(k.props, 'sat_rafter', () => new THREE.BoxGeometry(0.16, 0.16, 1.1), 'wood_dark', { x: q.x, y: y + fh + 0.12, z: q.z, yaw }, false);
      }
    }
    // Openings: door and round window on the front, arched windows along the sides.
    if (s === 0 && o.door !== false) {
      const dp = at(0, d / 2 + 0.02);
      P.portal(k, dp.x, y, dp.z, yaw, Math.min(2.6, w * 0.22), 3.2);
    } else {
      const rw = at(0, d / 2 + 0.03);
      b.mesh(am('shadow'), new THREE.CircleGeometry(0.85, 18), { x: rw.x, y: y + fh * 0.55, z: rw.z, yaw });
      const ring = G.moonGateRing(0, 0.92, 0.12);
      b.mesh('stone_light', ring, { x: rw.x, y: y + fh * 0.55, z: rw.z, yaw });
      ring.dispose();
    }
    const nw = Math.max(1, Math.floor((w - 3) / 2.6));
    for (const side of [-1, 1]) {
      for (let i = 0; i < nw; i++) {
        const u = -w / 2 + 1.6 + ((i + 0.5) * (w - 3.2)) / nw;
        if (s === 0 && Math.abs(u) < 1.8 && side > 0) continue;
        const q = at(u, side * (d / 2 + 0.06));
        repeatProp(k.props, 'sat_arch_win', () => archedWindowGeo(), am('window'), { x: q.x, y: y + 1.5, z: q.z, yaw: side > 0 ? yaw : yaw + Math.PI }, false);
      }
      const nd = Math.max(1, Math.floor((d - 3) / 2.8));
      for (let i = 0; i < nd; i++) {
        const v = -d / 2 + 1.6 + ((i + 0.5) * (d - 3.2)) / nd;
        const q = at(side * (w / 2 + 0.06), v);
        repeatProp(k.props, 'sat_arch_win', () => archedWindowGeo(), am('window'), { x: q.x, y: y + 1.5, z: q.z, yaw: yaw + (side * Math.PI) / 2 }, false);
      }
    }
    // Roof tier (upturned hip) over this storey.
    const top = y + fh;
    const last = s === storeys - 1;
    const rh = last ? Math.min(w, d) * 0.42 : 1.5;
    b.roof(roofMat, { x: o.x, y: top + 0.2, z: o.z, w: w + 0.6, d: d + 0.6, height: rh, yaw, overhang: last ? 1.6 : 1.9, curve: 0.95, style: 'hip', ridge: am('roofTrim') });
    if (o.balcony && !last) {
      // Gallery railing round the next storey, standing on the lower roof's ridge line.
      const gy = top + 1.5;
      const gw = w * 0.76 + 1.2, gd = d * 0.78 + 1.2;
      const c = [at(-gw / 2, -gd / 2), at(gw / 2, -gd / 2), at(gw / 2, gd / 2), at(-gw / 2, gd / 2)];
      b.box('wood_dark', { x: o.x, y: gy - 0.06, z: o.z, sx: gw, sy: 0.12, sz: gd, yaw });
      P.balustrade(k, c, { y: gy, h: 0.9, closed: true, material: 'wood_red', collide: false });
    }
    y = top + (last ? rh : 1.5);
    w *= 0.76;
    d *= 0.78;
  }
  const f = G.finialGeometry(Math.max(0.8, o.w * 0.06));
  b.mesh('gold', f, { x: o.x, y: y - 0.1, z: o.z });
  f.dispose();
  b.collider({ shape: 'box', x: o.x, y: (o.y + plinth + y) / 2, z: o.z, hx: o.w / 2 + 0.2, hy: (y - o.y - plinth) / 2, hz: o.d / 2 + 0.2, yaw, walkable: false, solid: true });
  return y + 2;
}

/**
 * Arched loggia (the bison terrace hall of image 4): three big round arches on thick carved
 * piers with turquoise bands at their bases, open to the view, a flat roof terrace behind a
 * stone parapet, against the cliff.
 */
export function archedLoggia(k: Kit, o: { x: number; z: number; y: number; yaw: number; w: number; d: number; h: number }): void {
  const b = k.main;
  const at = (u: number, v: number) => lp(o.x, o.z, o.yaw, u, v);
  const front = at(0, o.d / 2);
  const span = o.w / 3;
  // Piers (thick, carved: plinth, banded base, shaft, capital).
  for (let i = 0; i <= 3; i++) {
    const u = -o.w / 2 + i * span;
    for (const v of [o.d / 2 - 0.9, -o.d / 2 + 1.2]) {
      const p = at(u, v);
      b.box('stone_white', { x: p.x, y: o.y + o.h / 2, z: p.z, sx: 2.0, sy: o.h, sz: 2.0, yaw: o.yaw }, { collide: true, walkable: false });
      b.box('stone_light', { x: p.x, y: o.y + 0.5, z: p.z, sx: 2.5, sy: 1.0, sz: 2.5, yaw: o.yaw });
      b.box(am('paintTeal'), { x: p.x, y: o.y + 1.25, z: p.z, sx: 2.22, sy: 0.4, sz: 2.22, yaw: o.yaw });
      b.box(am('paintTeal'), { x: p.x, y: o.y + 1.85, z: p.z, sx: 2.12, sy: 0.16, sz: 2.12, yaw: o.yaw });
      b.box('stone_light', { x: p.x, y: o.y + o.h - 0.35, z: p.z, sx: 2.4, sy: 0.7, sz: 2.4, yaw: o.yaw });
      // Carved spiral boss on the pier face.
      const boss = at(u, v + 1.02);
      b.mesh('stone_light', new THREE.TorusGeometry(0.42, 0.08, 6, 18), { x: boss.x, y: o.y + o.h * 0.55, z: boss.z, yaw: o.yaw });
    }
  }
  // Round arches between the front piers (spandrels up to the entablature), and at the back.
  for (const v of [o.d / 2 - 0.9, -o.d / 2 + 1.2]) {
    for (let i = 0; i < 3; i++) {
      const c = at(-o.w / 2 + (i + 0.5) * span, v);
      const g = G.archSpandrel(span - 2.0, o.h - (span - 2.0) / 2 - 0.9, o.h, 1.8, 12);
      b.mesh('stone_white', g, { x: c.x, y: o.y, z: c.z, yaw: o.yaw });
      g.dispose();
    }
  }
  // Entablature, roof slab with a parapet (the roof is a terrace).
  b.box('stone_white', { x: o.x, y: o.y + o.h + 0.6, z: o.z, sx: o.w + 2.4, sy: 1.2, sz: o.d + 1.0, yaw: o.yaw }, { collide: true, walkable: true });
  b.box(am('trimOrange'), { x: front.x, y: o.y + o.h + 0.05, z: front.z, sx: o.w + 2.4, sy: 0.18, sz: 0.3, yaw: o.yaw });
  // Side walls and the back wall against the rock.
  for (const side of [-1, 1]) {
    const p = at(side * (o.w / 2 + 1.0), 0);
    b.box('stone_white', { x: p.x, y: o.y + o.h / 2, z: p.z, sx: 0.9, sy: o.h, sz: o.d - 0.4, yaw: o.yaw }, { collide: true, walkable: false });
  }
  const back = at(0, -o.d / 2 - 0.2);
  b.box('plaster_cream', { x: back.x, y: o.y + o.h / 2, z: back.z, sx: o.w + 2, sy: o.h, sz: 0.6, yaw: o.yaw }, { collide: true, walkable: false });
  // Slab paving inside.
  b.box('paving', { x: o.x, y: o.y + 0.04, z: o.z, sx: o.w + 1.6, sy: 0.1, sz: o.d, yaw: o.yaw });
}

/** Arched cave mouth cut into a cliff: stone frame, dark recess, hay on the floor, a saddle rack. */
export function stableCave(k: Kit, o: { x: number; z: number; y: number; yaw: number; w: number; h: number }): void {
  const b = k.main;
  const at = (u: number, v: number) => lp(o.x, o.z, o.yaw, u, v);
  const g = archWall(o.w + 2.4, o.h + 1.6, 1.0, o.w, o.h - o.w / 2);
  b.mesh('stone_light', g, { x: o.x, y: o.y, z: o.z, yaw: o.yaw });
  g.dispose();
  // Recess (the dark of the cave, a shallow block just behind the frame so the cliff never covers
  // it) and the straw on its floor.
  const r = at(0, -0.55);
  b.box(am('shadow'), { x: r.x, y: o.y + (o.h - o.w / 2) / 2, z: r.z, sx: o.w, sy: o.h - o.w / 2, sz: 0.7, yaw: o.yaw });
  const top = new THREE.CylinderGeometry(o.w / 2, o.w / 2, 0.7, 16, 1, false, 0, Math.PI);
  top.rotateZ(Math.PI / 2);
  top.rotateY(Math.PI / 2);
  b.mesh(am('shadow'), top, { x: r.x, y: o.y + o.h - o.w / 2, z: r.z, yaw: o.yaw });
  top.dispose();
  const straw = at(0, -0.2);
  b.box(am('straw'), { x: straw.x, y: o.y + 0.06, z: straw.z, sx: o.w - 0.4, sy: 0.12, sz: 2.6, yaw: o.yaw });
  // Saddle rack beside the mouth.
  const rack = at(o.w / 2 + 2.0, 0.9);
  b.box('wood_dark', { x: rack.x, y: o.y + 0.9, z: rack.z, sx: 0.12, sy: 1.8, sz: 1.6, yaw: o.yaw });
  b.box('wood', { x: rack.x, y: o.y + 1.5, z: rack.z, sx: 1.4, sy: 0.12, sz: 0.12, yaw: o.yaw });
  const saddle = at(o.w / 2 + 2.0, 0.9);
  b.box('cloth_red', { x: saddle.x, y: o.y + 1.62, z: saddle.z, sx: 1.2, sy: 0.22, sz: 0.9, yaw: o.yaw });
  b.box('wood_dark', { x: saddle.x, y: o.y + 1.78, z: saddle.z, sx: 1.3, sy: 0.1, sz: 0.2, yaw: o.yaw });
}

/** Temple gate across a passage: a white arched gateway (passage along local Z) with a blue hip roof. */
export function gateArch(k: Kit, o: { x: number; z: number; y: number; yaw: number; w: number; h: number }): void {
  const b = k.main;
  const g = archWall(o.w + 3.2, o.h + 1.4, 1.6, o.w, o.h - o.w / 2);
  b.mesh('stone_white', g, { x: o.x, y: o.y, z: o.z, yaw: o.yaw });
  g.dispose();
  for (const s of [-1, 1]) {
    const q = lp(o.x, o.z, o.yaw, s * (o.w / 2 + 0.8), 0);
    b.collider({ shape: 'box', x: q.x, y: o.y + (o.h + 1.4) / 2, z: q.z, hx: 0.8, hy: (o.h + 1.4) / 2, hz: 0.8, yaw: o.yaw, walkable: false, solid: true });
  }
  b.box(am('trimOrange'), { x: o.x, y: o.y + o.h + 1.5, z: o.z, sx: o.w + 3.4, sy: 0.2, sz: 1.8, yaw: o.yaw });
  b.roof(am('roof'), { x: o.x, y: o.y + o.h + 1.6, z: o.z, w: o.w + 4.2, d: 2.6, height: 1.6, yaw: o.yaw, overhang: 0.8, curve: 0.9, style: 'hip', ridge: am('roofTrim') });
  const f = G.finialGeometry(0.7);
  b.mesh('gold', f, { x: o.x, y: o.y + o.h + 3.1, z: o.z });
  f.dispose();
}

/** Arched stone bridge from a to b (walkable deck with parapets, an arch underneath). */
export function archBridge(k: Kit, a: THREE.Vector3, c: THREE.Vector3, width: number): void {
  k.main.bridge({ a, b: c, width, deck: 'stone_white', rail: 'stone_light', support: 'stone_white', arch: 0.18 });
}

/** Orchard tree: a short gnarled trunk and a rounded canopy (peach blossom or fruit green). */
export function orchardTree(k: Kit, x: number, y: number, z: number, s: number, blossom: boolean, yaw: number): void {
  repeatProp(k.props, 'sat_orchard_trunk', () => new THREE.CylinderGeometry(0.16, 0.26, 2.0, 7).translate(0, 1.0, 0), 'wood_dark', { x, y, z, yaw, sx: s, sy: s, sz: s }, false);
  repeatProp(k.props, blossom ? 'sat_canopy_b' : 'sat_canopy_g', () => new THREE.IcosahedronGeometry(1.5, 1).scale(1, 0.75, 1).translate(0, 2.6, 0), am(blossom ? 'blossom' : 'leaf'), { x, y, z, yaw, sx: s, sy: s, sz: s }, false);
}

/** Raised vegetable bed: a timber frame with rows of greens. */
export function vegetableBed(k: Kit, x: number, y: number, z: number, yaw: number, len: number): void {
  k.props.box('wood', { x, y: y + 0.18, z, sx: 1.6, sy: 0.36, sz: len, yaw });
  k.props.box(am('grass'), { x, y: y + 0.37, z, sx: 1.4, sy: 0.04, sz: len - 0.2, yaw });
  const rows = Math.max(2, Math.floor(len / 0.9));
  for (let i = 0; i < rows; i++) {
    const p = lp(x, z, yaw, 0, -len / 2 + 0.45 + (i * (len - 0.9)) / (rows - 1));
    repeatProp(k.props, 'sat_cabbage', () => new THREE.IcosahedronGeometry(0.3, 0).scale(1.6, 0.7, 1).translate(0, 0.5, 0), am('leaf'), { x: p.x, y, z: p.z, yaw: i * 1.3 }, false);
  }
}

/** Small stone shrine: stepped base, a niche with a figure, a blue roof cap. */
export function smallShrine(k: Kit, x: number, y: number, z: number, yaw: number): void {
  k.main.box('stone_white', { x, y: y + 0.4, z, sx: 1.6, sy: 0.8, sz: 1.2, yaw }, { collide: true, walkable: true });
  k.main.box('stone_light', { x, y: y + 1.6, z, sx: 1.2, sy: 1.6, sz: 0.9, yaw });
  const f = lp(x, z, yaw, 0, 0.46);
  k.main.box(am('shadow'), { x: f.x, y: y + 1.6, z: f.z, sx: 0.7, sy: 1.0, sz: 0.04, yaw });
  k.main.roof(am('roof'), { x, y: y + 2.4, z, w: 1.6, d: 1.3, height: 0.7, yaw, overhang: 0.3, curve: 0.8, style: 'hip', ridge: null });
}

/** Low stone bench. */
export function bench(k: Kit, x: number, y: number, z: number, yaw: number): void {
  k.props.box('stone_light', { x, y: y + 0.42, z, sx: 1.9, sy: 0.12, sz: 0.5, yaw });
  for (const s of [-1, 1]) {
    const p = lp(x, z, yaw, s * 0.7, 0);
    k.props.box('stone_white', { x: p.x, y: y + 0.2, z: p.z, sx: 0.25, sy: 0.4, sz: 0.45, yaw });
  }
}

/** Air Nomad swirl motif (a flat spiral inlay) on a floor or a wall. */
export function swirl(k: Kit, x: number, y: number, z: number, r: number, yaw = 0, upright = false): void {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = t * Math.PI * 3.2, rr = r * (0.15 + 0.85 * t);
    pts.push(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, Math.max(0.03, r * 0.07), 4, false);
  if (upright) g.rotateX(Math.PI / 2);
  k.props.mesh(am('paintTeal'), g, { x, y, z, yaw });
  g.dispose();
}

/** Face from a point toward another (yaw). */
export function towardYaw(from: P2, to: P2): number {
  return faceYaw(to.x - from.x, to.z - from.z);
}
