import * as THREE from 'three';
import * as P from '../parts';
import type { Kit } from '../parts';
import { floorY } from './rock';
import { BASE, C, DEG, ROAD, ROAD_W, SHELVES, TERRACES, floorAt, inArc, polar, rOutAt, rockTop, roadSamples, summitRAt, thetaOf, type RoadSample } from './layout';

/**
 * The white switchback road: flat runs are a paving inlay on the terraces (a
 * polygon-offset decal, never z-fighting the floor), climbs are stair flights
 * whose steps stand on solid masonry down to the rock, with a stepped parapet
 * on every side that drops away and a walkable ramp collider per few steps.
 * Terrace edges get balustrades with openings where the road, the stairs and
 * the shelves meet them.
 */

/** Paving inlay of the road (drawn over the terrace floors). */
export function roadInlayMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#f1ebdf', roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.name = 'sat_road_inlay';
  return m;
}

export function buildRoad(k: Kit, inlay: THREE.Material): void {
  const pts = roadSamples(1);
  // Flat runs: one ribbon per run.
  let run: RoadSample[] = [];
  const flush = () => {
    if (run.length > 1) k.main.mesh(inlay, ribbon(run, ROAD_W, floorY(run[0].y)), { x: 0, y: 0, z: 0 }, { castShadow: false });
    run = [];
  };
  for (const s of pts) {
    if (s.climb) flush();
    else run.push(s);
  }
  flush();
  // Flat stretches off the terraces (between a flight's top and a terrace edge): solid causeways.
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.climb || b.climb || a.y !== b.y) continue;
    const mth = (a.th + b.th) / 2, mr = (a.r + b.r) / 2;
    if (floorAt(mth, mr) === a.y) continue;
    const top = floorY(a.y), m = polar(mth, mr);
    const dx = b.x - a.x, dz = b.z - a.z, run = Math.hypot(dx, dz);
    const ground = BASE + Math.min(rockTop(mth, mr) - 0.6, a.y - 0.8);
    k.main.box('stone_white', { x: m.x, y: (top + ground) / 2, z: m.z, sx: ROAD_W, sy: top - ground, sz: run + 0.1, yaw: Math.atan2(dx, dz) }, { collide: true, walkable: true });
  }
  // Climbs.
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [t0, r0, y0] = ROAD[i];
    const [t1, r1, y1] = ROAD[i + 1];
    if (y1 === y0) continue;
    flightAlong(k, t0, r0, y0, t1, r1, y1);
  }
}

/** Flat ribbon (top face only) along samples at height y. */
function ribbon(s: RoadSample[], w: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  let along = 0;
  for (let i = 0; i < s.length; i++) {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    if (i > 0) along += Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
    pos.push(s[i].x + nx * w / 2, y + 0.01, s[i].z + nz * w / 2, s[i].x - nx * w / 2, y + 0.01, s[i].z - nz * w / 2);
    uv.push(0, along / 3, w / 3, along / 3);
    if (i > 0) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Faces must point up whichever way the samples run.
  const n = g.getAttribute('normal');
  if (n.count && n.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** A stair flight along the road from (t0, r0, y0) to (t1, r1, y1) (angles in degrees, y above BASE). */
export function flightAlong(k: Kit, t0: number, r0: number, y0: number, t1: number, r1: number, y1: number, width = ROAD_W): void {
  const rise = y1 - y0;
  const n = Math.max(4, Math.round(rise / 0.22));
  const sh = rise / n;
  const at = (u: number) => {
    const th = t0 + (t1 - t0) * u, r = r0 + (r1 - r0) * u;
    return { th, r, ...polar(th, r) };
  };
  const GROUP = 6;
  for (let i = 0; i < n; i++) {
    const a = at(i / n), b = at((i + 1) / n), m = at((i + 0.5) / n);
    const dx = b.x - a.x, dz = b.z - a.z, run = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const top = floorY(y0 + sh * (i + 1));
    const ground = BASE + Math.min(rockTop(m.th, m.r) - 0.6, top - BASE - 0.8);
    // Step tread on a solid base down to the rock.
    k.main.box('stone_white', { x: m.x, y: (top + ground) / 2, z: m.z, sx: width, sy: top - ground, sz: run + 0.04, yaw });
    k.main.box('stone_light', { x: m.x, y: top - 0.06, z: m.z, sx: width + 0.06, sy: 0.12, sz: run + 0.06, yaw });
    // Parapets where the side drops away.
    for (const side of [-1, 1]) {
      const sx = Math.cos(yaw) * side * (width / 2 + 0.2), sz = -Math.sin(yaw) * side * (width / 2 + 0.2);
      const q = { x: m.x + sx, z: m.z + sz };
      const rq = Math.hypot(q.x - C.x, q.z - C.z);
      const beyond = { th: thetaOf(q.x, q.z), r: rq + (rq - m.r) * 0.6 };
      if (BASE + rockTop(beyond.th, beyond.r) > top - 1.2) continue;
      k.main.box('stone_white', { x: q.x, y: top + 0.42, z: q.z, sx: 0.42, sy: 0.84, sz: run + 0.05, yaw });
      k.main.box('stone_light', { x: q.x, y: top + 0.9, z: q.z, sx: 0.52, sy: 0.12, sz: run + 0.08, yaw });
      k.main.collider({ shape: 'box', x: q.x, y: top + 0.6, z: q.z, hx: 0.25, hy: 0.65, hz: run / 2 + 0.05, yaw, walkable: false, solid: true });
    }
    // Ramp collider per group of steps (local +X rises along the flight).
    if (i % GROUP === 0) {
      const j = Math.min(n, i + GROUP);
      const g0 = at(i / n), g1 = at(j / n);
      const gx = g1.x - g0.x, gz = g1.z - g0.z, gl = Math.hypot(gx, gz);
      const yb = floorY(y0 + sh * i), yt = floorY(y0 + sh * j);
      const bottom = Math.min(yb, BASE + rockTop((g0.th + g1.th) / 2, (g0.r + g1.r) / 2)) - 1;
      k.main.collider({ shape: 'box', x: (g0.x + g1.x) / 2, y: (yt + bottom) / 2, z: (g0.z + g1.z) / 2, hx: gl / 2 + 0.15, hz: width / 2, hy: (yt - bottom) / 2, yaw: Math.atan2(-gz, gx), slopeRise: yt - yb, walkable: true, solid: true, surface: 'stone' });
    }
  }
}

/**
 * Points on top of the terrace-edge balustrades (where they exist: not at openings, not where the
 * rock beyond rises), about `step` metres apart — perches for lemurs.
 */
export function railTops(step = 9): Array<{ x: number; y: number; z: number; th: number }> {
  const road = roadSamples(1.5);
  const out: Array<{ x: number; y: number; z: number; th: number }> = [];
  for (const t of TERRACES) {
    if (t.level === 0) continue;
    const n = Math.max(2, Math.round(((t.a1 - t.a0) * DEG * t.rOut) / step));
    for (let i = 0; i < n; i++) {
      const th = t.a0 + ((t.a1 - t.a0) * (i + 0.5)) / n;
      const r = rOutAt(t, th) - 0.1;
      const p = polar(th, r);
      const nearRoad = road.some((s) => Math.abs(s.y - t.y) < 2.6 && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < 5.5 ** 2);
      const nearShelf = SHELVES.some((s) => Math.abs(s.y - t.y) < 0.5 && Math.abs(((th - s.a + 540) % 360) - 180) < (s.w / 2 + 1) / s.r0 / DEG);
      if (nearRoad || nearShelf || BASE + rockTop(th, r + 1.5) > floorY(t.y) - 1.2) continue;
      out.push({ x: p.x, y: floorY(t.y) + 1.05, z: p.z, th });
    }
  }
  return out;
}

/** Balustrades along terrace edges that drop away, open where the road, stairs and shelves meet them. */
export function buildEdges(k: Kit): void {
  const road = roadSamples(1.5);
  const open = (x: number, z: number, y: number) => road.some((s) => Math.abs(s.y - y) < 2.6 && (s.x - x) ** 2 + (s.z - z) ** 2 < 4.4 ** 2);
  const shelfOpen = (th: number, y: number) =>
    SHELVES.some((s) => Math.abs(s.y - y) < 0.5 && Math.abs(((th - s.a + 540) % 360) - 180) < ((s.w / 2 - 0.6) / s.r0) / DEG);
  for (const t of TERRACES) {
    if (t.level === 0) continue;
    const r = (th: number) => rOutAt(t, th) - 0.1;
    const n = Math.max(2, Math.round(((t.a1 - t.a0) * DEG * t.rOut) / 2.6));
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const th = t.a0 + ((t.a1 - t.a0) * i) / n;
      return polar(th, r(th));
    });
    P.balustrade(k, pts, {
      y: floorY(t.y),
      skip: (i) => {
        const th = t.a0 + ((t.a1 - t.a0) * (i + 0.5)) / n;
        const mid = polar(th, r(th));
        return open(mid.x, mid.z, t.y) || shelfOpen(th, t.y) || BASE + rockTop(th, r(th) + 1.5) > floorY(t.y) - 1.2;
      },
    });
    // Radial ends that drop away.
    for (const [end, dir] of [[t.a0, -1], [t.a1, 1]] as const) {
      const ro = rOutAt(t, end);
      const mid = (t.rIn + ro) / 2;
      if (BASE + rockTop(end + dir * 2, mid) > floorY(t.y) - 1.5) continue;
      const m = Math.max(2, Math.round((ro - t.rIn) / 3));
      const ep = Array.from({ length: m + 1 }, (_, i) => polar(end - dir * 0.15, t.rIn + ((ro - t.rIn) * i) / m));
      P.balustrade(k, ep, {
        y: floorY(t.y),
        skip: (i) => {
          const q = polar(end, t.rIn + ((ro - t.rIn) * (i + 0.5)) / m);
          return open(q.x, q.z, t.y) || !inArc(end - dir * 0.5, t.a0, t.a1);
        },
      });
    }
  }
  // Summit rim.
  const r = (th: number) => summitRAt(th) + 0.25;
  const n = 64;
  const pts = Array.from({ length: n + 1 }, (_, i) => polar((360 * i) / n, r((360 * i) / n)));
  P.balustrade(k, pts, {
    y: floorY(108),
    skip: (i) => {
      const th = (360 * (i + 0.5)) / n;
      const mid = polar(th, r(th));
      return open(mid.x, mid.z, 108) || shelfOpen(th, 108);
    },
  });
}
