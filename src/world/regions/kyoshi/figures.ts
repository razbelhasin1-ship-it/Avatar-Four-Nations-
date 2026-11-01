import * as THREE from 'three';
import { EXTRA_ACC } from '../earth/bssFigures';

/**
 * Crowd look for Kyoshi Island — everyone is a woman in the Kyoshi Warrior outfit (the project
 * owner's direction, after the reference frame of the warriors): green kimono, dark green skirt,
 * dark lacquered armour (shoulder guards and chest plate) with gold studs, a gold headdress, white
 * face paint with red eye make-up and lips, a pair of gold war fans at the sash.
 *
 * The instanced figure renderer draws robe (kimono), pants (skirt below the knee) and skin (the
 * white face paint); everything else is one vertex-coloured accessory per figure (ids 41+), so a
 * headdress, the eye band, the armour and the fans are a single draw for the whole crowd.
 */

export const KAcc = {
  /** Gold crown band with a tall front plate. */
  crown: 41,
  /** Crown with swept side flaps. */
  wings: 42,
  /** The captain: crown with a red tassel crest. */
  captain: 43,
  /** Training: a plain green headband (fans on the rack). */
  band: 44,
  /** A small girl's headband (no armour). */
  girl: 45,
} as const;

type Part = { g: THREE.BufferGeometry; c: string };

function coloured(parts: Part[]): THREE.BufferGeometry {
  const list = parts.map((p) => ({ g: p.g.index ? p.g.toNonIndexed() : p.g, c: new THREE.Color(p.c) }));
  let n = 0;
  for (const p of list) n += p.g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of list) {
    if (!p.g.getAttribute('normal')) p.g.computeVertexNormals();
    const pa = p.g.getAttribute('position'), na = p.g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++, o++) {
      pos[o * 3] = pa.getX(i);
      pos[o * 3 + 1] = pa.getY(i);
      pos[o * 3 + 2] = pa.getZ(i);
      nrm[o * 3] = na.getX(i);
      nrm[o * 3 + 1] = na.getY(i);
      nrm[o * 3 + 2] = na.getZ(i);
      col[o * 3] = p.c.r;
      col[o * 3 + 1] = p.c.g;
      col[o * 3 + 2] = p.c.b;
    }
  }
  for (const p of parts) p.g.dispose();
  for (const p of list) p.g.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const at = <T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number): T => {
  g.translate(x, y, z);
  return g;
};
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => at(new THREE.BoxGeometry(sx, sy, sz), x, y, z);

const GOLD = '#d8a832';
const ARMOR = '#25282a';
const RED = '#c0262a';
const GREEN = '#3c7a46';
const HAIR = '#16110d';

/** Red eye make-up sweeping to the temples (in front of the face) and the hair bun. */
function face(): Part[] {
  return [
    { g: box(0.17, 0.028, 0.012, 0, 1.613, 0.122), c: RED },
    { g: box(0.03, 0.022, 0.03, 0.09, 1.618, 0.1), c: RED },
    { g: box(0.03, 0.022, 0.03, -0.09, 1.618, 0.1), c: RED },
    { g: at(new THREE.SphereGeometry(0.05, 7, 5), 0, 1.69, -0.1), c: HAIR },
  ];
}

/** Dark lacquered shoulder guards and chest plate with gold studs; fans at the sash. */
function armour(fans: boolean): Part[] {
  const parts: Part[] = [];
  for (const s of [-1, 1]) {
    const pad = new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
    pad.scale(1.25, 0.8, 1.1);
    parts.push({ g: at(pad, s * 0.25, 1.43, 0), c: ARMOR });
    parts.push({ g: at(new THREE.SphereGeometry(0.018, 5, 4), s * 0.27, 1.49, 0.07), c: GOLD });
    parts.push({ g: box(0.11, 0.13, 0.12, s * 0.26, 1.02, 0.01), c: ARMOR }); // forearm guard
  }
  parts.push({ g: box(0.3, 0.24, 0.03, 0, 1.3, 0.135), c: ARMOR });
  for (const [x, y] of [[-0.08, 1.36], [0.08, 1.36], [-0.08, 1.24], [0.08, 1.24]] as const) parts.push({ g: at(new THREE.SphereGeometry(0.016, 5, 4), x, y, 0.152), c: GOLD });
  if (fans) {
    for (const s of [-1, 1]) parts.push({ g: box(0.035, 0.26, 0.05, s * 0.12, 1.0, 0.15), c: GOLD });
  }
  return parts;
}

function crown(wings: boolean, tassel: boolean): Part[] {
  const band = new THREE.CylinderGeometry(0.13, 0.135, 0.05, 12, 1, true);
  const parts: Part[] = [
    { g: at(band, 0, 1.675, 0), c: GOLD },
    { g: box(0.1, 0.13, 0.015, 0, 1.75, 0.12), c: GOLD },
    { g: at(new THREE.SphereGeometry(0.022, 6, 4), 0, 1.74, 0.13), c: RED },
  ];
  for (const s of [-1, 1]) {
    if (wings) {
      const w = box(0.03, 0.16, 0.1, s * 0.14, 1.72, 0.02);
      w.rotateZ(s * -0.35);
      parts.push({ g: w, c: GOLD });
    } else {
      parts.push({ g: box(0.025, 0.09, 0.05, s * 0.13, 1.71, 0.06), c: GOLD });
    }
  }
  if (tassel) {
    parts.push({ g: at(new THREE.ConeGeometry(0.035, 0.2, 6), 0, 1.86, 0.03), c: GOLD });
    const t = new THREE.CylinderGeometry(0.035, 0.02, 0.32, 6);
    t.rotateX(0.5);
    parts.push({ g: at(t, 0, 1.78, -0.12), c: RED });
  }
  return parts;
}

const DEFS: Record<number, () => Part[]> = {
  [KAcc.crown]: () => [...crown(false, false), ...face(), ...armour(true)],
  [KAcc.wings]: () => [...crown(true, false), ...face(), ...armour(true)],
  [KAcc.captain]: () => [...crown(true, true), ...face(), ...armour(true)],
  [KAcc.band]: () => [{ g: at(new THREE.CylinderGeometry(0.128, 0.132, 0.04, 12, 1, true), 0, 1.665, 0), c: GREEN }, ...face(), ...armour(false)],
  [KAcc.girl]: () => [{ g: at(new THREE.CylinderGeometry(0.128, 0.132, 0.04, 12, 1, true), 0, 1.665, 0), c: GREEN }, ...face()],
};

let registered = false;
/** Register the Kyoshi outfit pieces with the figure renderer (idempotent). */
export function registerKyoshiAccessories(): void {
  if (registered) return;
  registered = true;
  for (const [id, f] of Object.entries(DEFS)) EXTRA_ACC.set(Number(id), () => ({ geo: coloured(f()), color: '#ffffff' }));
}

/** Kimono greens, skirt greens, white face paint (with a faint warm variation). */
export const KYOSHI_LOOK = {
  robes: [0x3f7f45, 0x3a7442, 0x468a4c, 0x356a3c, 0x4a8650],
  skirts: [0x24402a, 0x2a4a2f, 0x1f3826],
  paint: [0xf4f0e6, 0xefe9dc, 0xf6f2ea],
} as const;
