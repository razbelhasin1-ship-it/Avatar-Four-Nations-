import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { getTrailRuntime, heightAt, TRAILS, waterAt } from '../../Heightfield';
import { defineSpots } from '../../Spots';
import { matrixFor } from '../../kit/Builder';
import { AIR_DEBUG_EXTRAS, AirRegion } from './AirRegion';
import * as G from './geom';
import * as P from './parts';
import { am, type Kit, type P2 } from './parts';
import { TRAILHEAD } from './layout';

/**
 * The pilgrims' way up to the Southern Air Temple:
 *  - the trailhead gate at the end of the eastern road (landmark air_trailhead)
 *  - a stepped stone bridge on arches that descends across the gorge to the
 *    foot of the switchbacks
 *  - stone stairs following the 'air_temple_switchbacks' trail (Heightfield
 *    TRAILS) all the way to the summit gate, with parapets on the drop side,
 *    paved turns and a resting landing with a small shrine at every switchback
 *  - herders' shelter, hay and a bison marker at the Sky Bison Meadow
 *
 * The trail surface itself is the carved terrain; the stairs add a walkable
 * ramp collider a few centimetres above it so feet meet the treads.
 */

const TRAIL_ID = 'air_temple_switchbacks';
const STAIR_W = 5.0;
const RISE = 0.25;
/** Half-length of the flat landing at each switchback (along each flight). */
const TURN_W = 3.2;

const TRAIL_DEF = TRAILS.find((t) => t.id === TRAIL_ID)!;

/** Outward bisector at each interior trail vertex (the outside of the bend). */
function cornerInfo(i: number): { p: P2; out: P2 } {
  const pts = TRAIL_DEF.points;
  const a = pts[i - 1], p = pts[i], b = pts[i + 1];
  const d0 = norm(p.x - a.x, p.z - a.z), d1 = norm(b.x - p.x, b.z - p.z);
  const o = norm(d0.x - d1.x, d0.z - d1.z);
  return { p, out: o };
}

function norm(x: number, z: number): P2 {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/**
 * Trail centreline with the carved terrain height (`height`) and the built
 * stair profile (`profile`): flat landings of half-length TURN_W at every
 * switchback, flights in between that never dip below the carved trail.
 */
interface TrailLine {
  points: P2[];
  cum: number[];
  length: number;
  height: (s: number) => number;
  profile: (s: number) => number;
  cornerY: number[];
}

/** A resting landing: platform centre, the trail point it opens onto, platform height. */
interface Landing {
  x: number;
  z: number;
  y: number;
  anchor: P2;
  /** Arc length of the anchor on the trail and the side (+1 left / -1 right) it sits on. */
  s: number;
  side: number;
}

/**
 * Choose a resting landing for every switchback: outside the bend if the
 * ground there falls away, otherwise beside the stairs just before/after the
 * turn on the downhill side (never over water, never buried in the slope).
 */
function computeLandings(line: TrailLine): Landing[] {
  const out: Landing[] = [];
  const pt = (s: number) => {
    let i = 0;
    while (i < line.points.length - 2 && s > line.cum[i + 1]) i++;
    const a = line.points[i], b = line.points[i + 1];
    const L = line.cum[i + 1] - line.cum[i];
    const t = Math.max(0, Math.min(1, (s - line.cum[i]) / L));
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: -uz, nz: ux };
  };
  for (let i = 1; i < line.points.length - 1; i++) {
    const { p, out: o } = cornerInfo(i);
    const cands: Landing[] = [{ x: p.x + o.x * 7.4, z: p.z + o.z * 7.4, y: line.cornerY[i], anchor: p, s: line.cum[i], side: 0 }];
    for (const ds of [-9, 9]) {
      const s = line.cum[i] + ds;
      const q = pt(s);
      for (const side of [-1, 1]) {
        cands.push({ x: q.x + q.nx * side * 8.2, z: q.z + q.nz * side * 8.2, y: line.profile(s), anchor: { x: q.x + q.nx * side * 2.6, z: q.z + q.nz * side * 2.6 }, s, side });
      }
    }
    let best: Landing | null = null;
    let bestDrop = Infinity;
    let fallback: Landing = cands[0];
    let fallbackDrop = -Infinity;
    for (const c of cands) {
      const g = heightAt(c.x, c.z);
      const drop = c.y - g;
      const wet = waterAt(c.x, c.z, g) !== null;
      if (!wet && drop > fallbackDrop) {
        fallbackDrop = drop;
        fallback = c;
      }
      if (wet || drop < 0.4) continue;
      if (drop < bestDrop) {
        bestDrop = drop;
        best = c;
      }
    }
    out.push(best ?? fallback);
  }
  return out;
}

/** Bridge from the trailhead ledge down to the foot of the switchbacks. */
const BRIDGE_DIR = norm(TRAIL_DEF.points[0].x - TRAILHEAD.x, TRAIL_DEF.points[0].z - TRAILHEAD.z);
const BRIDGE_TOP: P2 = { x: TRAILHEAD.x + BRIDGE_DIR.x * 7.6, z: TRAILHEAD.z + BRIDGE_DIR.z * 7.6 };

defineSpots({
  viewpoint_air_trailhead: { x: BRIDGE_TOP.x, z: BRIDGE_TOP.z, r: 3, label: 'Trailhead gate', region: 'southern_air_temple' },
  bridge_air_gorge: { x: (BRIDGE_TOP.x + TRAIL_DEF.points[0].x) / 2, z: (BRIDGE_TOP.z + TRAIL_DEF.points[0].z) / 2, r: 6, label: 'Gorge stair-bridge', region: 'southern_air_temple' },
  // Clear trees from under the low end of the bridge (spots with r are vegetation clearings).
  ...Object.fromEntries(
    [0.68, 0.8, 0.92].map((t, i) => [
      `bridge_air_gorge_${i + 2}`,
      { x: BRIDGE_TOP.x + (TRAIL_DEF.points[0].x - BRIDGE_TOP.x) * t, z: BRIDGE_TOP.z + (TRAIL_DEF.points[0].z - BRIDGE_TOP.z) * t, r: 6, label: 'Gorge stair-bridge', region: 'southern_air_temple' },
    ]),
  ),
  shrine_bison_meadow: { x: 1352, z: 1066, r: 3, label: 'Bison marker stone', region: 'southern_air_temple' },
});

export class AirTempleTrail extends AirRegion {
  readonly id = 'air_temple_trail';
  readonly center = { x: 1300, z: 1110 };
  readonly loadRadius = 340;

  private line: TrailLine | null = null;
  private landings: Landing[] = [];

  protected parts(_ctx: GameContext): Array<[string, () => void]> {
    return [
      ['line', () => this.initLine()],
      ['stairs', () => this.line && this.buildStairs()],
      ['landings', () => this.line && this.buildLandings()],
      ['trailhead', () => this.line && this.buildTrailhead()],
      ['meadow', () => this.buildMeadow()],
    ];
  }

  private initLine(): void {
    const tr = getTrailRuntime().find((t) => t.id === TRAIL_ID);
    if (!tr) return;
    const pts = tr.line.points;
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const L = cum[cum.length - 1];
    const n = pts.length - 1;
    const H = tr.height;
    // Landing heights: level with the carved trail where the next flight leaves the landing.
    const cornerY: number[] = [];
    for (let i = 1; i < n; i++) cornerY[i] = H(cum[i] + TURN_W);
    const profile = (s: number): number => {
      s = Math.max(0, Math.min(L, s));
      for (let i = 1; i < n; i++) if (Math.abs(s - cum[i]) <= TURN_W) return cornerY[i];
      let i = 0;
      while (i < n - 1 && s > cum[i + 1]) i++;
      const sa = i === 0 ? 0 : cum[i] + TURN_W;
      const sb = i === n - 1 ? L : cum[i + 1] - TURN_W;
      const ya = i === 0 ? H(0) : cornerY[i];
      const yb = i === n - 1 ? H(L) : cornerY[i + 1];
      return ya + ((yb - ya) * (s - sa)) / Math.max(1e-6, sb - sa);
    };
    this.line = { points: pts, cum, length: L, height: H, profile, cornerY };
    const line = this.line;
    AIR_DEBUG_EXTRAS.trail = {
      length: line.length,
      cum: [...cum],
      /** Point on the trail centreline at arc length s (y = carved trail height). */
      at: (s: number) => {
        let i = 0;
        while (i < line.points.length - 2 && s > line.cum[i + 1]) i++;
        const a = line.points[i], b = line.points[i + 1];
        const t = Math.max(0, Math.min(1, (s - line.cum[i]) / (line.cum[i + 1] - line.cum[i])));
        // y: walking surface on the stairs; carve: the carved terrain under them.
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: line.profile(s) + RISE / 2, carve: line.height(s) };
      },
      bridgeTop: { ...BRIDGE_TOP },
      landings: [] as Landing[],
    };
    this.landings = computeLandings(line);
    (AIR_DEBUG_EXTRAS.trail as any).landings = this.landings.map((l) => ({ x: l.x, z: l.z, y: l.y }));
    defineSpots(
      Object.fromEntries(
        this.landings.flatMap((l, i) => [
          [`viewpoint_air_trail_${i + 1}`, { x: l.x, z: l.z, y: l.y, r: 4, label: `Switchback landing ${i + 1}`, region: 'southern_air_temple' }],
          [`shrine_air_trail_${i + 1}`, { x: l.x, z: l.z, y: l.y, r: 2, label: `Wayside shrine ${i + 1}`, region: 'southern_air_temple' }],
        ]),
      ),
    );
  }

  // ---------------------------------------------------------------------------

  private segFrame(i: number): { a: P2; b: P2; ux: number; uz: number; nx: number; nz: number; s0: number; s1: number } {
    const a = this.line!.points[i], b = this.line!.points[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    return { a, b, ux, uz, nx: -uz, nz: ux, s0: this.line!.cum[i], s1: this.line!.cum[i + 1] };
  }

  /** Flights between switchback landings, the landings themselves, parapets on the drop side, lanterns. */
  private buildStairs(): void {
    const line = this.line!;
    const n = line.points.length - 1;
    const H = line.height;
    const Pf = line.profile;
    for (let i = 0; i < n; i++) {
      const f = this.segFrame(i);
      const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
      const k = this.zone(`run${i}`, mid, (f.s1 - f.s0) / 2 + 12, { district: i < 2 ? 'lower' : 'upper' });
      const sA = i === 0 ? f.s0 : f.s0 + TURN_W;
      const sB = i === n - 1 ? f.s1 - 1.5 : f.s1 - TURN_W;
      const yaw = P.alongYaw(f.ux, f.uz);
      const grade = (Pf(sB) - Pf(sA)) / Math.max(1, sB - sA);
      const steps = Math.max(1, Math.round((sB - sA) / (RISE / Math.max(0.05, grade))));
      const tread = (sB - sA) / steps;
      const at = (s: number, lat = 0) => ({ x: f.a.x + f.ux * (s - f.s0) + f.nx * lat, z: f.a.z + f.uz * (s - f.s0) + f.nz * lat });
      const white = new P.BoxBatch(), light = new P.BoxBatch();
      for (let j = 0; j < steps; j++) {
        const s = sA + j * tread;
        const top = Pf(s + tread);
        const c = at(s + tread / 2);
        // Blocks reach down to the carved trail (or lower ground, e.g. the tarn shore).
        const bot = Math.min(H(s), heightAt(c.x, c.z)) - 0.4;
        (j % 9 === 4 ? light : white).add({ x: c.x, y: (top + bot) / 2, z: c.z, sx: tread + 0.03, sy: top - bot, sz: STAIR_W, yaw });
      }
      white.flush(k.main, 'stone_white');
      light.flush(k.main, 'stone_light');
      // Walkable ramp through the tread midpoints, in short thin pieces (nothing solid hangs far below).
      for (let s = sA; s < sB - 0.01; s += 1.5) {
        const s2 = Math.min(sB, s + 1.5);
        const y0 = Pf(s) + RISE / 2, y1 = Pf(s2) + RISE / 2;
        const base = y0 - 0.5;
        const hy = (y1 - base) / 2;
        const c = at((s + s2) / 2);
        k.main.collider({ shape: 'box', x: c.x, y: base + hy, z: c.z, hx: (s2 - s) / 2 + 0.02, hy, hz: STAIR_W / 2, yaw, slopeRise: y1 - y0, walkable: true, solid: true, surface: 'stone' });
      }
      // Parapet on the drop side, low curb on the hill side (decided per 4 m piece).
      for (let s = sA; s < sB - 0.5; s += 4) {
        const s2 = Math.min(sB, s + 4);
        if (s2 - s < 1) continue;
        const ya = Pf(s), yb = Pf(s2);
        for (const side of [-1, 1]) {
          if (this.landings.some((l) => l.side === side && Math.abs(l.s - (s + s2) / 2) < 4.2)) continue;
          const off = STAIR_W / 2 + 0.25;
          const probe = (sx: number) => {
            const p = at(sx, side * 9);
            return heightAt(p.x, p.z) - Pf(sx);
          };
          const drop = Math.min(probe(s), probe(s2));
          const pa = at(s, side * off), pb = at(s2, side * off);
          const base = Math.min(ya, yb, H(s), H(s2)) - 1.2;
          if (drop < -1.2) P.slopedWall(k, { a: pa, b: pb, y0: ya, y1: yb, base, h: 0.95, t: 0.5, material: 'stone_white' });
          else P.slopedWall(k, { a: pa, b: pb, y0: ya, y1: yb, base, h: 0.3, t: 0.5, material: 'stone_light', collide: false });
        }
      }
      // Stone lanterns every ~22 m on alternating sides.
      for (let m = 11; m < sB - sA - 4; m += 22) {
        // On the hill side (never floating over a drop).
        const pl = at(sA + m, STAIR_W / 2 + 1.0), pr = at(sA + m, -(STAIR_W / 2 + 1.0));
        const hl = heightAt(pl.x, pl.z), hr = heightAt(pr.x, pr.z);
        const p = hl >= hr ? pl : pr;
        const g = Math.max(hl, hr);
        const yS = Pf(sA + m);
        if (g < yS - 1.0) continue;
        P.stoneLantern(k, p.x, Math.max(g, yS - 0.6), p.z);
      }
      // Prayer flags strung across the stairs.
      for (let m = 18; m < sB - sA - 8; m += 30) {
        // Poles stand on the parapet/curb line, so they never dangle over a drop.
        const off = STAIR_W / 2 + 0.25;
        const y0 = Pf(sA + m);
        const y = y0 + 4.3;
        const a = at(sA + m, off), b = at(sA + m, -off);
        const pa = new THREE.Vector3(a.x, y, a.z), pb = new THREE.Vector3(b.x, y, b.z);
        for (const p of [pa, pb]) k.main.cylinder('wood_red', { x: p.x, z: p.z, y: y0 - 0.5, r: 0.11, h: 4.95, segments: 6 }, { collide: true, walkable: false });
        P.prayerFlags(k, pa, pb, 0.6);
      }
    }
    // Flat stone landing at every switchback, railed on the outside of the turn.
    for (let i = 1; i < n; i++) {
      const v = line.points[i];
      const y = line.cornerY[i];
      const k = this.zone(`turn${i}`, v, 10, { district: i < 2 ? 'lower' : 'upper' });
      let low = Infinity;
      for (let a = 0; a < 8; a++) low = Math.min(low, heightAt(v.x + Math.cos((a * Math.PI) / 4) * TURN_W, v.z + Math.sin((a * Math.PI) / 4) * TURN_W));
      low = Math.min(low, heightAt(v.x, v.z));
      k.main.cylinder('stone_white', { x: v.x, z: v.z, y: low - 1.5, r: TURN_W + 0.35, rTop: TURN_W + 0.15, h: y - 0.4 - (low - 1.5), segments: 28 });
      k.main.cylinder('paving', { x: v.x, z: v.z, y: y - 0.4, r: TURN_W + 0.05, h: 0.4, segments: 28 }, { collide: true, walkable: true });
      k.main.cylinder('stone_light', { x: v.x, z: v.z, y: y - 0.7, r: TURN_W + 0.5, h: 0.35, segments: 28 });
      // Open toward both flights (and a resting landing beside the turn); balustrade round the rest.
      const fIn = this.segFrame(i - 1), fOut = this.segFrame(i);
      const half = Math.asin(Math.min(1, (STAIR_W / 2 + 0.3) / (TURN_W - 0.15)));
      const open: Array<[number, number]> = [
        [Math.atan2(-fIn.uz, -fIn.ux), half],
        [Math.atan2(fOut.uz, fOut.ux), half],
      ];
      const rest = this.landings[i - 1];
      if (rest && rest.side === 0) open.push([Math.atan2(rest.z - v.z, rest.x - v.x), 0.8]);
      for (const [a0, a1] of complementArcs(open)) P.arcRail(k, v.x, v.z, TURN_W - 0.15, a0, a1, y, { seg: 2.0 });
    }
  }

  /** Resting landings with a wayside shrine outside each switchback. */
  private buildLandings(): void {
    this.landings.forEach((l, j) => {
      const i = j + 1;
      const corner = l.anchor;
      const y = l.y;
      const k = this.zone(`landing${i}`, l, 10, { district: i < 2 ? 'lower' : 'upper' });
      const out = norm(l.x - corner.x, l.z - corner.z);
      const R = 4.6;
      // Platform (flat at the corner height) on a masonry drum down into the slope.
      const ground = Math.min(heightAt(l.x, l.z), y) - 6;
      k.main.cylinder('stone_white', { x: l.x, z: l.z, y: ground, r: R + 0.3, rTop: R + 0.1, h: y - ground - 0.35, segments: 28 });
      k.main.cylinder('paving', { x: l.x, z: l.z, y: y - 0.4, r: R, h: 0.4, segments: 28 }, { collide: true, walkable: true });
      k.main.cylinder('stone_light', { x: l.x, z: l.z, y: y - 0.75, r: R + 0.45, h: 0.4, segments: 28 });
      // Balustrade round the outer side; the side facing the corner stays open.
      const toward = Math.atan2(corner.z - l.z, corner.x - l.x);
      P.arcRail(k, l.x, l.z, R - 0.3, toward + 0.95, toward + Math.PI * 2 - 0.95, y, { seg: 2.2 });
      // Wayside shrine: a little stone house with a teal roof, an offering bowl.
      const sx = l.x + out.x * (R - 1.5), sz = l.z + out.z * (R - 1.5);
      const yaw = P.faceYaw(-out.x, -out.z);
      k.main.box('stone_white', { x: sx, y: y + 0.45, z: sz, sx: 1.6, sy: 0.9, sz: 1.2, yaw }, { collide: true, walkable: false });
      k.main.box('plaster_cream', { x: sx, y: y + 1.45, z: sz, sx: 1.2, sy: 1.1, sz: 0.9, yaw });
      k.main.box(am('shadow'), { x: sx + Math.sin(yaw) * 0.42, y: y + 1.4, z: sz + Math.cos(yaw) * 0.42, sx: 0.6, sy: 0.75, sz: 0.1, yaw });
      k.main.roof(am('roof'), { x: sx, y: y + 2.0, z: sz, w: 1.9, d: 1.6, height: 0.9, yaw, style: 'hip', overhang: 0.25, curve: 0.4, ridge: am('roofTrim') });
      const fin = G.finialGeometry(0.28);
      k.main.mesh('gold', fin, { x: sx, y: y + 2.86, z: sz });
      fin.dispose();
      k.props.cylinder('bronze', { x: sx + Math.sin(yaw) * 0.85, z: sz + Math.cos(yaw) * 0.85, y: y + 0.0, r: 0.22, rTop: 0.3, h: 0.35, segments: 10 });
      // Lantern and prayer flags from the shrine to the rail.
      P.stoneLantern(k, l.x - Math.sin(yaw + 1.2) * 2.6, y, l.z - Math.cos(yaw + 1.2) * 2.6);
      const top = new THREE.Vector3(sx, y + 2.9, sz);
      const r1 = new THREE.Vector3(l.x + Math.cos(toward + 1.3) * (R - 0.3), y + 1.1, l.z + Math.sin(toward + 1.3) * (R - 0.3));
      const r2 = new THREE.Vector3(l.x + Math.cos(toward - 1.3) * (R - 0.3), y + 1.1, l.z + Math.sin(toward - 1.3) * (R - 0.3));
      P.prayerFlags(k, top, r1, 0.25, 0.5);
      P.prayerFlags(k, top, r2, 0.25, 0.5);
    });
  }

  /** Trailhead gate on the ledge and the stepped stone bridge across the gorge. */
  private buildTrailhead(): void {
    const H = this.line!.height;
    const foot = this.line!.points[0];
    const yFoot = H(0) + 0.02;
    const dir = BRIDGE_DIR;
    const top = BRIDGE_TOP;
    // Bridge top height: level with the ledge where the landing meets the ground.
    const far = { x: top.x - dir.x * 5, z: top.z - dir.z * 5 };
    const nx = -dir.z, nz = dir.x;
    let yTop = -Infinity;
    for (const s of [-3, 0, 3]) yTop = Math.max(yTop, heightAt(far.x + nx * s, far.z + nz * s));
    yTop = Math.min(yTop, heightAt(TRAILHEAD.x, TRAILHEAD.z));
    const k = this.zone('trailhead', { x: (top.x + foot.x) / 2, z: (top.z + foot.z) / 2 }, 50);
    // Landing on the ledge.
    const lc = { x: top.x - dir.x * 2.6, z: top.z - dir.z * 2.6 };
    const yaw = P.alongYaw(dir.x, dir.z);
    k.main.box('paving', { x: lc.x, y: yTop - 0.3, z: lc.z, sx: 5.6, sy: 0.6, sz: 7.4, yaw }, { collide: true, walkable: true });
    // Battered bastion under the landing, down into the gorge side.
    let gMin = Infinity;
    for (const [du, dv] of [[0, 0], [2.8, 3.7], [2.8, -3.7], [-2.8, 3.7], [-2.8, -3.7]] as Array<[number, number]>) {
      gMin = Math.min(gMin, heightAt(lc.x + dir.x * du + nx * dv, lc.z + dir.z * du + nz * dv));
    }
    const bTop = yTop - 0.55, bBot = gMin - 2.5;
    if (bTop - bBot > 0.5) {
      const bastion = new THREE.CylinderGeometry(5.3, 5.3 + (bTop - bBot) * 0.08, bTop - bBot, 4, 1);
      k.main.mesh('stone_white', bastion, { x: lc.x, y: (bTop + bBot) / 2, z: lc.z, yaw: yaw + Math.PI / 4 });
      bastion.dispose();
      k.main.collider({ shape: 'box', x: lc.x, y: (bTop + bBot) / 2, z: lc.z, hx: 3.7, hy: (bTop - bBot) / 2, hz: 3.7, yaw, walkable: false, solid: true });
      // Cornice under the landing, string courses and tall blind arches on the bastion faces.
      k.main.box('stone_light', { x: lc.x, y: bTop - 0.35, z: lc.z, sx: 8.0, sy: 0.7, sz: 8.0, yaw });
      for (let yy = bTop - 7; yy > bBot + 4; yy -= 7) {
        const half = 3.75 + (bTop - yy) * 0.057;
        k.main.box('stone_light', { x: lc.x, y: yy, z: lc.z, sx: half * 2 + 0.3, sy: 0.35, sz: half * 2 + 0.3, yaw });
      }
      for (const [fx, fz] of [[dir.x, dir.z], [nx, nz], [-nx, -nz]] as Array<[number, number]>) {
        const half = 3.75 + 3.6 * 0.057;
        const w = { x: lc.x + fx * (half + 0.02), z: lc.z + fz * (half + 0.02) };
        k.main.instance('bastion_arch', () => P.archedWindowGeo(), am('shadow'), matrixFor({ x: w.x, y: bTop - 3.6, z: w.z, yaw: P.faceYaw(fx, fz), sx: 1.4, sy: 2.4, sz: 0.4 }), false);
      }
    }
    // Gate (two pillars, lintel, teal roof) at the head of the bridge.
    const gYaw = P.faceYaw(-dir.x, -dir.z);
    for (const s of [-1, 1]) {
      const p = { x: top.x + nx * 2.9 * s, z: top.z + nz * 2.9 * s };
      k.main.cylinder('plaster_white', { x: p.x, z: p.z, y: yTop, r: 0.42, h: 5.6, segments: 12 }, { collide: true, walkable: false });
      k.main.cylinder('stone_light', { x: p.x, z: p.z, y: yTop, r: 0.62, h: 0.6, segments: 12 });
      P.banner(k, p.x - dir.x * 0.5, yTop + 4.6, p.z - dir.z * 0.5, gYaw, 0.9, 2.8, s > 0 ? 'banner' : 'bannerYellow');
    }
    k.main.box('wood_red', { x: top.x, y: yTop + 5.2, z: top.z, sx: 7.6, sy: 0.4, sz: 0.5, yaw: yaw + Math.PI / 2 });
    k.main.box(am('paintTeal'), { x: top.x, y: yTop + 4.6, z: top.z, sx: 6.2, sy: 0.3, sz: 0.36, yaw: yaw + Math.PI / 2 });
    k.main.roof(am('roof'), { x: top.x, y: yTop + 5.4, z: top.z, w: 8.6, d: 2.4, height: 1.4, yaw: yaw + Math.PI / 2, style: 'hip', overhang: 0.4, curve: 0.45, ridge: am('roofTrim') });
    const fin = G.finialGeometry(0.4);
    k.main.mesh('gold', fin, { x: top.x, y: yTop + 6.7, z: top.z });
    fin.dispose();
    P.hangingLantern(k, top.x, yTop + 4.0, top.z, 'warm');
    // Stepped bridge from the gate down to the foot of the switchbacks.
    viaduct(k, { top: { x: top.x, z: top.z, y: yTop }, bottom: { x: foot.x, z: foot.z, y: yFoot }, width: 4.4 });
    // Updraft wisps rising out of the switchback gorge.
    this.ambient({ x: 1300, y: 181, z: 1135, preset: 'mist', rate: 4, range: 160, dir: new THREE.Vector3(0, 1, 0), speed: 4, radius: 5, swirl: 0.8, size: 1.4 });
    // Prayer flags from the gate down the first stretch.
    P.prayerFlags(k, new THREE.Vector3(top.x + nx * 2.9, yTop + 5.0, top.z + nz * 2.9), new THREE.Vector3(top.x - dir.x * 6 + nx * 3, yTop + 2.4, top.z - dir.z * 6 + nz * 3), 0.4);
  }

  /** Herders' shelter, hay and a carved bison marker at the Sky Bison Meadow. */
  private buildMeadow(): void {
    const c = { x: 1352, z: 1068 };
    const k = this.zone('meadow', c, 22);
    const gy = (x: number, z: number) => heightAt(x, z);
    // Marker stone with a bison relief (statue) and prayer flags.
    const m = { x: 1352, z: 1066 };
    const my = gy(m.x, m.z);
    P.steppedDisc(k, { x: m.x, z: m.z, y: my - 0.3, r: 2.6, steps: 2, stepH: 0.35 });
    P.bisonStatue(k, m.x, my + 0.4, m.z, 0.6, 0.55);
    // Shelter: open-front stone hut with a teal roof.
    const s = { x: 1328, z: 1058 };
    const sy = gy(s.x, s.z);
    const yaw = P.faceYaw(1340 - s.x, 1080 - s.z);
    const F = { x: s.x, z: s.z, yaw };
    k.main.box('paving', { x: s.x, y: sy - 0.5, z: s.z, sx: 9, sy: 1.2, sz: 7, yaw }, { collide: true, walkable: true });
    const back = P.fp(F, 0, -3.2);
    k.main.box('stone_white', { x: back.x, y: sy + 1.9, z: back.z, sx: 9, sy: 3.8, sz: 0.6, yaw }, { collide: true, walkable: false });
    for (const u of [-4.2, 4.2]) {
      const p = P.fp(F, u, -0.2);
      k.main.box('stone_white', { x: p.x, y: sy + 1.9, z: p.z, sx: 0.6, sy: 3.8, sz: 6.4, yaw }, { collide: true, walkable: false });
    }
    k.main.roof(am('roof'), { x: s.x, y: sy + 3.8, z: s.z, w: 10.4, d: 8, height: 2.6, yaw, style: 'hip', overhang: 0.5, curve: 0.35, ridge: am('roofTrim') });
    k.main.collider({ shape: 'box', x: s.x, y: sy + 4.6, z: s.z, hx: 5, hy: 0.8, hz: 3.8, yaw, walkable: true, solid: true });
    for (const [u, v] of [[-2.4, -1.6], [0.2, -1.8], [2.5, -1.5]] as Array<[number, number]>) {
      const p = P.fp(F, u, v);
      P.hayBale(k, p.x, sy + 0.1, p.z, yaw + u * 0.3);
    }
    for (const [x, z, r] of [[1362, 1050, 0.3], [1318, 1074, 1.2]] as Array<[number, number, number]>) {
      P.hayStack(k, x, gy(x, z) - 0.1, z, r, 2);
    }
    const top = new THREE.Vector3(m.x, my + 3.6, m.z);
    for (const a of [0.4, 2.5, 4.4]) {
      const p = { x: m.x + Math.cos(a) * 9, z: m.z + Math.sin(a) * 9 };
      const py = gy(p.x, p.z);
      k.main.cylinder('wood_red', { x: p.x, z: p.z, y: py - 0.3, r: 0.1, h: 3.4, segments: 6 }, { collide: true, walkable: false });
      P.prayerFlags(k, top, new THREE.Vector3(p.x, py + 3.0, p.z), 0.6, 0.55);
    }
    k.main.cylinder('wood_red', { x: m.x + 2.4, z: m.z, y: my, r: 0.12, h: 3.8, segments: 6 }, { collide: true, walkable: false });
  }
}

/** Arcs (a0 < a1, radians) covering the circle except the given open sectors [centre, half-width]. */
function complementArcs(open: Array<[number, number]>): Array<[number, number]> {
  const TAU = Math.PI * 2;
  const iv = open
    .map(([c, h]) => {
      const a = ((((c - h) % TAU) + TAU) % TAU);
      return [a, a + 2 * h] as [number, number];
    })
    .sort((p, q) => p[0] - q[0]);
  // Merge overlapping intervals (on the unrolled circle).
  const merged: Array<[number, number]> = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  // Wrap: an interval running past TAU covers the start of the next lap.
  while (merged.length > 1 && merged[0][0] + TAU <= merged[merged.length - 1][1]) {
    const first = merged.shift()!;
    const last = merged[merged.length - 1];
    last[1] = Math.max(last[1], first[1] + TAU);
  }
  const out: Array<[number, number]> = [];
  for (let j = 0; j < merged.length; j++) {
    const end = merged[j][1];
    const next = j + 1 < merged.length ? merged[j + 1][0] : merged[0][0] + TAU;
    if (next - end > 0.05) out.push([end, next]);
  }
  return out;
}

/**
 * Stepped stone bridge on arched piers between two points of different
 * height. Treads + deck slab + raking arches + parapets; walkable ramp
 * colliders in short pieces so nothing invisible hangs under the deck.
 */
function viaduct(k: Kit, o: { top: { x: number; y: number; z: number }; bottom: { x: number; y: number; z: number }; width: number }): void {
  const dx = o.top.x - o.bottom.x, dz = o.top.z - o.bottom.z;
  const run = Math.hypot(dx, dz);
  const rise = o.top.y - o.bottom.y;
  const ux = dx / run, uz = dz / run, nx = -uz, nz = ux;
  const yaw = P.alongYaw(ux, uz);
  const pitch = Math.atan2(rise, run);
  const line = (m: number) => o.bottom.y + (rise * m) / run;
  const at = (m: number, side = 0) => ({ x: o.bottom.x + ux * m + nx * side, z: o.bottom.z + uz * m + nz * side });
  // Treads.
  const N = Math.max(1, Math.round(rise / 0.2));
  const tread = run / N;
  for (let j = 0; j < N; j++) {
    const m = (j + 0.5) * tread;
    const top = line((j + 1) * tread) + 0.02;
    const p = at(m);
    k.main.box(j % 10 === 0 ? 'stone_light' : 'stone_white', { x: p.x, y: top - 0.25, z: p.z, sx: tread + 0.03, sy: 0.5, sz: o.width, yaw });
  }
  // Deck slab under the treads (pitched).
  const slabLen = Math.hypot(run, rise);
  const mid = at(run / 2);
  k.main.box('stone_white', { x: mid.x, y: line(run / 2) - 0.75, z: mid.z, sx: slabLen, sy: 0.9, sz: o.width + 0.5, yaw, roll: pitch });
  k.main.box('stone_light', { x: mid.x, y: line(run / 2) - 1.15, z: mid.z, sx: slabLen, sy: 0.3, sz: o.width + 0.9, yaw, roll: pitch });
  // Piers and raking arches.
  const bay = 12;
  const nb = Math.max(1, Math.round(run / bay));
  const bl = run / nb;
  for (let b = 0; b <= nb; b++) {
    const m = b * bl;
    const p = at(m);
    const g = Math.min(heightAt(p.x, p.z), heightAt(p.x + nx * 2, p.z + nz * 2), heightAt(p.x - nx * 2, p.z - nz * 2));
    const deck = line(m) - 1.2;
    if (deck - g > 1) {
      k.main.box('stone_white', { x: p.x, y: (deck + g - 3) / 2, z: p.z, sx: 2.2, sy: deck - g + 3, sz: o.width + 0.6, yaw }, { collide: true, walkable: false });
      k.main.box('stone_light', { x: p.x, y: deck - 0.4, z: p.z, sx: 2.6, sy: 0.5, sz: o.width + 0.9, yaw });
    }
    if (b < nb) {
      const mm = m + bl / 2;
      const q = at(mm);
      const span = bl - 2.2;
      const archTop = 2.6 + span / 2;
      const gq = heightAt(q.x, q.z);
      if (line(mm) - 1.2 - gq > archTop * 0.7) {
        const sp = G.archSpandrel(span, 2.6, archTop, o.width);
        const cy = line(mm) - 1.2 - archTop;
        k.main.mesh('stone_white', sp, { x: q.x, y: cy, z: q.z, yaw, roll: pitch });
        sp.dispose();
      }
    }
  }
  // Parapets (solid, colliding) in pieces along both sides.
  const piece = 4;
  for (let m = 0; m < run - 0.01; m += piece) {
    const m2 = Math.min(run, m + piece);
    for (const s of [-1, 1]) {
      const off = o.width / 2 + 0.25;
      P.slopedWall(k, { a: at(m, off * s), b: at(m2, off * s), y0: line(m), y1: line(m2), base: line(m) - 1.25, h: 1.0, t: 0.5, material: 'stone_white' });
    }
    // Ramp collider piece.
    const y0 = line(m) + 0.12, y1 = line(m2) + 0.12;
    const base = y0 - 1.0;
    const hy = (y1 - base) / 2;
    const c = at((m + m2) / 2);
    k.main.collider({ shape: 'box', x: c.x, y: base + hy, z: c.z, hx: (m2 - m) / 2 + 0.02, hy, hz: o.width / 2, yaw, slopeRise: y1 - y0, walkable: true, solid: true, surface: 'stone' });
  }
  // Lanterns on posts every second pier.
  for (let b = 1; b < nb; b += 2) {
    const m = b * bl;
    for (const s of [-1, 1]) {
      const p = at(m, (o.width / 2 + 0.25) * s);
      k.props.lantern(new THREE.Vector3(p.x, line(m) + 1.55, p.z), { color: 'warm' });
    }
  }
}
