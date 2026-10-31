import * as THREE from 'three';
import { Acc, EXTRA_ACC } from '../../earth/bssFigures';

/**
 * Fire Nation people for the capital's crowds: accessory pieces (registered with the shared
 * instanced figure renderer, vertex-coloured so a helmet, its face plate and a spear are one draw)
 * and the clothing palettes by class — civilians in reds and whites with topknots, workers in
 * browns and greys, nobles in deep red, black and gold with the two-pronged flame crown, the
 * Domestic Forces in red, black and yellow with spears and shields, firebending troops in
 * skull-faced helmets, the Royal Procession in bell-shaped three-spired helmets, Fire Sages in
 * red-and-gold robes and tall headpieces.
 */

export const FAcc = {
  topknot: 32,
  flameCrown: 33,
  guard: 34,
  skull: 35,
  bell: 36,
  sage: 37,
  foodCart: 38,
  skullBare: 39,
  speaker: 40,
} as const;

type Part = { g: THREE.BufferGeometry; c: string };

/** Merge coloured parts into one non-indexed geometry with a vertex colour attribute. */
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
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8) => at(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z);

const HAIR = '#16110d';
const GOLD = '#d4a32a';
const RED = '#a3221a';
const DARK_RED = '#5e1410';
const BLACK = '#1b1716';
const STEEL = '#4a4a50';
const BONE = '#d9d2c2';
const WOOD = '#5a3a22';
const BLADE = '#c3c6cc';

function topknot(): Part[] {
  return [
    { g: at(new THREE.SphereGeometry(0.055, 7, 5), 0, 1.765, -0.015), c: HAIR },
    { g: cyl(0.042, 0.046, 0.03, 0, 1.738, -0.015), c: RED },
  ];
}

function spear(x: number, top = 2.35): Part[] {
  return [
    { g: cyl(0.018, 0.018, top - 0.05, x, (top + 0.05) / 2, 0.06, 5), c: WOOD },
    { g: at(new THREE.ConeGeometry(0.04, 0.24, 5), x, top + 0.12, 0.06), c: BLADE },
  ];
}

/** The two-pronged flame crown worn in a topknot by nobles (and the royal family). */
function flameCrown(): Part[] {
  const parts: Part[] = [{ g: at(new THREE.SphereGeometry(0.06, 7, 5), 0, 1.77, -0.01), c: HAIR }, { g: cyl(0.05, 0.055, 0.04, 0, 1.79, -0.01), c: GOLD }];
  for (const s of [-1, 1]) {
    const prong = new THREE.ConeGeometry(0.022, 0.13, 5);
    prong.rotateZ(-s * 0.32);
    parts.push({ g: at(prong, s * 0.026, 1.865, -0.01), c: GOLD });
  }
  return parts;
}

/** Domestic Forces: flared red helmet with a black brim and yellow knob, spear and round shield. */
function guard(): Part[] {
  const shield = new THREE.CylinderGeometry(0.27, 0.27, 0.04, 14);
  shield.rotateX(Math.PI / 2);
  const boss = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10);
  boss.rotateX(Math.PI / 2);
  return [
    { g: cyl(0.115, 0.16, 0.13, 0, 1.705, 0, 10), c: DARK_RED },
    { g: cyl(0.2, 0.2, 0.025, 0, 1.645, 0, 12), c: BLACK },
    { g: at(new THREE.SphereGeometry(0.035, 6, 4), 0, 1.79, 0), c: '#d6b23a' },
    { g: box(0.3, 0.07, 0.24, 0, 1.47, 0), c: '#c8a038' },
    ...spear(-0.3),
    { g: at(shield, 0.33, 1.02, 0.1), c: RED },
    { g: at(boss, 0.33, 1.02, 0.13), c: '#d6b23a' },
  ];
}

/** Firebending troops: dark helmet with a bone-white skull face plate, pauldrons (optionally a spear). */
function skull(withSpear: boolean): Part[] {
  const dome = new THREE.SphereGeometry(0.142, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const parts: Part[] = [
    { g: at(dome, 0, 1.62, -0.005), c: STEEL },
    { g: cyl(0.15, 0.17, 0.05, 0, 1.6, -0.01, 10), c: BLACK },
    { g: box(0.17, 0.15, 0.035, 0, 1.585, 0.122), c: BONE },
    { g: box(0.05, 0.03, 0.012, 0.04, 1.615, 0.142), c: '#111111' },
    { g: box(0.05, 0.03, 0.012, -0.04, 1.615, 0.142), c: '#111111' },
    { g: box(0.09, 0.022, 0.012, 0, 1.545, 0.142), c: '#2a2422' },
    { g: at(new THREE.ConeGeometry(0.03, 0.12, 5), 0, 1.79, -0.02), c: RED },
  ];
  for (const s of [-1, 1]) parts.push({ g: box(0.16, 0.06, 0.2, s * 0.25, 1.46, 0), c: STEEL });
  if (withSpear) parts.push(...spear(-0.3, 2.2));
  return parts;
}

/** Royal Procession: bell-shaped helmet with three spires, a long halberd. */
function bell(): Part[] {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    prof.push(new THREE.Vector2(0.06 + 0.15 * Math.pow(1 - k, 1.6) + 0.03 * (1 - k), 1.6 + k * 0.26));
  }
  const parts: Part[] = [
    { g: new THREE.LatheGeometry(prof, 12), c: DARK_RED },
    { g: cyl(0.215, 0.215, 0.03, 0, 1.605, 0, 14), c: GOLD },
    { g: at(new THREE.ConeGeometry(0.035, 0.3, 6), 0, 2.0, 0), c: GOLD },
  ];
  for (const s of [-1, 1]) {
    const c = new THREE.ConeGeometry(0.028, 0.2, 6);
    c.rotateZ(-s * 0.35);
    parts.push({ g: at(c, s * 0.08, 1.9, 0), c: GOLD });
  }
  parts.push({ g: box(0.34, 0.08, 0.26, 0, 1.47, 0), c: GOLD });
  parts.push({ g: cyl(0.018, 0.018, 2.5, -0.3, 1.25, 0.06, 5), c: BLACK });
  const blade = new THREE.ConeGeometry(0.07, 0.36, 4);
  blade.scale(1, 1, 0.25);
  parts.push({ g: at(blade, -0.3, 2.66, 0.06), c: BLADE });
  return parts;
}

/** Fire Sage: tall red headpiece with a gold flame, pointed shoulder mantle. */
function sage(): Part[] {
  const hat = new THREE.CylinderGeometry(0.05, 0.13, 0.44, 4);
  hat.rotateY(Math.PI / 4);
  hat.scale(1, 1, 0.8);
  const flame = new THREE.ConeGeometry(0.06, 0.22, 5);
  flame.scale(1, 1, 0.3);
  const parts: Part[] = [
    { g: at(hat, 0, 1.93, -0.01), c: RED },
    { g: at(flame, 0, 1.92, 0.085), c: GOLD },
    { g: cyl(0.13, 0.13, 0.04, 0, 1.72, -0.01, 10), c: GOLD },
  ];
  for (const s of [-1, 1]) {
    const sh = new THREE.ConeGeometry(0.13, 0.36, 4);
    sh.rotateZ(s * (Math.PI / 2 - 0.35));
    sh.scale(1, 0.5, 0.9);
    parts.push({ g: at(sh, s * 0.3, 1.48, 0), c: RED });
    parts.push({ g: box(0.06, 0.03, 0.2, s * 0.42, 1.52, 0), c: GOLD });
  }
  return parts;
}

/** Food cart with a red canopy and a steaming pot. */
function foodCart(): Part[] {
  const w1 = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 10);
  w1.rotateZ(Math.PI / 2);
  const w2 = w1.clone();
  return [
    { g: box(0.95, 0.5, 1.25, 0, 0.78, 1.0), c: '#6a4428' },
    { g: at(w1, 0.52, 0.32, 1.0), c: '#3a2a1c' },
    { g: at(w2, -0.52, 0.32, 1.0), c: '#3a2a1c' },
    { g: box(0.05, 0.05, 0.9, 0.32, 0.86, 0.25), c: WOOD },
    { g: box(0.05, 0.05, 0.9, -0.32, 0.86, 0.25), c: WOOD },
    { g: box(0.04, 1.0, 0.04, 0.42, 1.5, 1.55), c: WOOD },
    { g: box(0.04, 1.0, 0.04, -0.42, 1.5, 1.55), c: WOOD },
    { g: box(1.15, 0.06, 0.9, 0, 2.02, 1.3), c: RED },
    { g: cyl(0.2, 0.17, 0.24, 0.12, 1.15, 0.95, 8), c: '#2a2a2a' },
  ];
}

/** A speaker's state robe: tall gold crown piece and wide red mantle (for the tower balcony). */
function speaker(): Part[] {
  const parts = flameCrown();
  for (const s of [-1, 1]) parts.push({ g: box(0.2, 0.05, 0.3, s * 0.27, 1.47, 0), c: GOLD });
  const mantle = new THREE.CylinderGeometry(0.28, 0.4, 0.9, 10, 1, true);
  parts.push({ g: at(mantle, 0, 1.0, -0.02), c: DARK_RED });
  return parts;
}

const DEFS: Record<number, () => Part[]> = {
  [FAcc.topknot]: topknot,
  [FAcc.flameCrown]: flameCrown,
  [FAcc.guard]: guard,
  [FAcc.skull]: () => skull(true),
  [FAcc.skullBare]: () => skull(false),
  [FAcc.bell]: bell,
  [FAcc.sage]: sage,
  [FAcc.foodCart]: foodCart,
  [FAcc.speaker]: speaker,
};

let registered = false;
/** Register the Fire Nation accessories with the figure renderer (idempotent). */
export function registerFireAccessories(): void {
  if (registered) return;
  registered = true;
  for (const [id, f] of Object.entries(DEFS)) EXTRA_ACC.set(Number(id), () => ({ geo: coloured(f()), color: '#ffffff' }));
}

// ---------------------------------------------------------------------------
// Clothing by class (0xRRGGBB)
// ---------------------------------------------------------------------------

export type Klass = 'civilian' | 'worker' | 'noble' | 'guard' | 'trooper' | 'royal' | 'sage' | 'student';

export const PALETTE: Record<Klass, { robes: number[]; pants: number[]; acc: number[] }> = {
  civilian: {
    robes: [0xa8261c, 0x8f1f18, 0xc23a2a, 0xe9e1d0, 0xd8cdb4, 0x7a1a14, 0xb8432e, 0xf0e8d8, 0x9a2a20, 0xe0d4bc],
    pants: [0x2a1a14, 0x3a2620, 0x5a1a14, 0xd8cdb4, 0x1e1614],
    acc: [FAcc.topknot, FAcc.topknot, FAcc.topknot, Acc.parasol, Acc.none],
  },
  worker: {
    robes: [0x6b4f33, 0x5a5048, 0x7a6a5a, 0x4a4440, 0x8a7a68, 0x6a5a4a, 0x5a3a2a],
    pants: [0x3a3026, 0x2e2a26, 0x4a3a2a],
    acc: [FAcc.topknot, FAcc.topknot, Acc.strawHat, Acc.none],
  },
  noble: {
    robes: [0x6a0f0f, 0x8a1a14, 0x1a1414, 0xb8892a, 0x5a1010, 0x2a1a1a, 0x9a1c16],
    pants: [0x1a1414, 0x3a0f0f, 0xc8a038],
    acc: [FAcc.flameCrown, FAcc.flameCrown, FAcc.flameCrown, Acc.parasol],
  },
  guard: { robes: [0x8a1a14, 0x7a1612], pants: [0x1a1414], acc: [FAcc.guard] },
  trooper: { robes: [0x3a1a16, 0x2e1c1a, 0x4a1a14], pants: [0x1a1616], acc: [FAcc.skull] },
  royal: { robes: [0x9a1a14], pants: [0x2a1a14], acc: [FAcc.bell] },
  sage: { robes: [0xa8261c, 0x9a2018], pants: [0xc8a038], acc: [FAcc.sage] },
  student: { robes: [0x8a1a14, 0xa8261c, 0x7a1612], pants: [0x2a1a14, 0x1a1414], acc: [FAcc.topknot] },
};

export const SKIN = [0xf3d2b5, 0xe8c09a, 0xd9a97f, 0xc89670, 0xb07e58, 0xeac4a0];
