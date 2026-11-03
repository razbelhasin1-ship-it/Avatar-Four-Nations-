import * as THREE from 'three';
import type { ContentBuilder } from '../../../kit/Builder';
import { mergeParts } from '../geometry';
import { wtMat } from '../materials';

/**
 * Igloo geometry for Wolf Cove: the solid igloo (instanced: stacked-block dome, low arched tunnel
 * entrance, dark doorway) and the enterable hollow dome (shell inside and out, a tunnel with a
 * vestibule, the doorway cut through, colliders round the wall) used by the Great Igloo, the
 * healer's igloo, the workshop and the family homes.
 */

/** Flip a geometry's winding (inner surfaces seen from inside). */
export function flipped(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.clone() : g.clone();
  if (f.index) {
    const idx = f.index;
    for (let k = 0; k < idx.count; k += 3) {
      const t = idx.getX(k + 1);
      idx.setX(k + 1, idx.getX(k + 2));
      idx.setX(k + 2, t);
    }
  }
  const n = f.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return f;
}

/** Height of the tunnel's straight side walls under its vault (unit igloo): the doorway is an arch. */
const TUNNEL_WALL = 0.2;

/**
 * Unit solid igloo (radius 1, base y = 0, entrance toward +Z). The dome bulges a little past
 * upright before it meets the snow, so it sits on the ground (about 1.07 radii tall) instead of
 * looking sunk; the entrance tunnel is a vault on short straight walls with an arched doorway.
 */
export function iglooUnit(): THREE.BufferGeometry {
  const t = Math.PI * 0.58;
  const d = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, t);
  d.translate(0, -Math.cos(t), 0);
  d.scale(1, 0.86, 1);
  const w = TUNNEL_WALL;
  const tunnel = new THREE.CylinderGeometry(0.4, 0.4, 0.75, 10, 1, false, 0, Math.PI);
  tunnel.rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, w, 0.98);
  const sides = [-1, 1].map((sd) => new THREE.BoxGeometry(0.07, w, 0.75).translate(sd * 0.365, w / 2, 0.98));
  const cap = new THREE.CircleGeometry(0.4, 10, 0, Math.PI).translate(0, w, 1.355);
  const capLow = new THREE.PlaneGeometry(0.8, w).translate(0, w / 2, 1.355);
  return mergeParts([d, tunnel, ...sides, cap, capLow]);
}

/** Unit dark doorway at the tunnel mouth (radius-1 igloo): an arch down to the snow. */
export function iglooDoorUnit(): THREE.BufferGeometry {
  const w = TUNNEL_WALL;
  return mergeParts([new THREE.CircleGeometry(0.29, 10, 0, Math.PI).translate(0, w, 1.362), new THREE.PlaneGeometry(0.58, w).translate(0, w / 2, 1.362)]);
}

/** Unit annex dome (no tunnel), standing on the snow like the igloo (about one radius tall). */
export function annexUnit(): THREE.BufferGeometry {
  const t = Math.PI * 0.56;
  const d = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, t);
  d.translate(0, -Math.cos(t), 0);
  d.scale(1, 0.84, 1);
  return d;
}

/** Wind-packed drift (unit): leans against the north side. */
export function driftUnit(): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  s.scale(1.25, 0.42, 0.6);
  return s;
}

export interface HollowDome {
  x: number;
  y: number;
  z: number;
  /** Dome radius and height (m). */
  r: number;
  h: number;
  /** Entrance direction (yaw: local +Z points out of the doorway). */
  yaw: number;
  /** Tunnel: length beyond the dome wall, inner width and height. */
  tunnel: number;
  tw: number;
  th: number;
  /** A porch dome over the tunnel's middle (open where the tunnel runs through it). */
  vestibule?: boolean;
}

/**
 * Enterable hollow igloo: outer shell, inner shell, the tunnel (outer and inner vault, side walls)
 * and colliders: a ring of wall boxes with a gap for the doorway, the tunnel's side walls.
 */
export function hollowDome(b: ContentBuilder, o: HollowDome): void {
  const hs = o.h / o.r;
  const doorTop = o.th + 0.1;
  const thetaDoor = Math.acos(Math.min(0.995, doorTop / hs / o.r));
  const gapHalf = (o.tw / 2 + 0.12) / o.r;
  const wall = wtMat('ice_wall');
  const shell = (r: number) => {
    const up = new THREE.SphereGeometry(r, 28, 7, 0, Math.PI * 2, 0, thetaDoor);
    // SphereGeometry phi = π/2 points +Z: leave the doorway open there.
    const low = new THREE.SphereGeometry(r, 28, 3, Math.PI / 2 + gapHalf, Math.PI * 2 - gapHalf * 2, thetaDoor, Math.PI / 2 - thetaDoor);
    const g = mergeParts([up, low]);
    g.scale(1, hs, 1);
    return g;
  };
  const t = { x: o.x, y: o.y, z: o.z, yaw: o.yaw };
  b.mesh(wall, shell(o.r), t);
  b.mesh(wall, flipped(shell(o.r - 0.32)), t, { castShadow: false });
  // Tunnel: a half-round vault along +Z from inside the dome wall to the mouth.
  const z0 = o.r * Math.cos(gapHalf) - 0.45, z1 = o.r + o.tunnel;
  const len = z1 - z0;
  const vault = (rad: number) => {
    const c = new THREE.CylinderGeometry(rad, rad, len, 12, 1, true, 0, Math.PI);
    c.rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, o.th - o.tw / 2, z0 + len / 2);
    return c;
  };
  const vr = o.tw / 2;
  b.mesh(wall, vault(vr + 0.3), t);
  b.mesh(wall, flipped(vault(vr)), t, { castShadow: false });
  // Side walls up to the vault's spring line.
  const sideH = o.th - o.tw / 2;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const loc = (lx: number, lz: number) => ({ x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c });
  for (const sd of [-1, 1]) {
    const p = loc(sd * (vr + 0.15), z0 + len / 2);
    b.mesh(wall, new THREE.BoxGeometry(0.3, sideH, len), { x: p.x, y: o.y + sideH / 2, z: p.z, yaw: o.yaw });
    b.collider({ shape: 'box', x: p.x, y: o.y + 1.5, z: p.z, hx: 0.2, hy: 1.5, hz: len / 2, yaw: o.yaw, walkable: false, solid: true });
  }
  // Mouth: an arched rim of trim ice.
  const rim = new THREE.TorusGeometry(vr + 0.15, 0.16, 6, 12, Math.PI);
  const pm = loc(0, z1);
  b.mesh(wtMat('ice_trim'), rim, { x: pm.x, y: o.y + sideH, z: pm.z, yaw: o.yaw });
  if (o.vestibule) {
    // A porch dome straddling the tunnel's middle: taller and wider than the vault, open front and
    // back where the tunnel runs through it (a closed dome here would fill the passage).
    const pr = vr + 1.0, ph = o.th + 0.65;
    const crown = o.th + 0.4; // the vault's outer crown, with a margin
    const tTop = Math.acos(Math.min(0.99, crown / ph));
    const gate = Math.asin(Math.min(0.95, (vr + 0.4) / pr));
    // SphereGeometry phi: π/2 points +Z, 3π/2 points −Z; the sides between are kept.
    const porch = mergeParts([
      new THREE.SphereGeometry(pr, 18, 3, 0, Math.PI * 2, 0, tTop),
      new THREE.SphereGeometry(pr, 9, 5, Math.PI / 2 + gate, Math.PI - gate * 2, tTop, Math.PI / 2 - tTop),
      new THREE.SphereGeometry(pr, 9, 5, Math.PI * 1.5 + gate, Math.PI - gate * 2, tTop, Math.PI / 2 - tTop),
    ]);
    porch.scale(1, ph / pr, 1);
    const pv = loc(0, z0 + len * 0.5);
    b.mesh(wall, porch, { x: pv.x, y: o.y, z: pv.z, yaw: o.yaw });
  }
  // Wall colliders round the dome (a gap where the tunnel joins).
  const n = Math.max(14, Math.round(o.r * 3.2));
  const hy = Math.min(o.h, 6) / 2;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2; // local angle from +X toward +Z
    const lx = Math.cos(a), lz = Math.sin(a);
    // Skip the segments in front of the doorway (local +Z).
    if (Math.abs(Math.atan2(lx, lz)) < gapHalf + Math.PI / n) continue;
    const p = loc(lx * (o.r - 0.16), lz * (o.r - 0.16));
    const segLen = ((Math.PI * 2) / n) * o.r + 0.1;
    b.collider({ shape: 'box', x: p.x, y: o.y + hy, z: p.z, hx: segLen / 2, hy, hz: 0.24, yaw: o.yaw - a - Math.PI / 2, walkable: false, solid: true });
  }
}
