import * as THREE from 'three';
import { EXTRA_ACC } from '../../earth/bssFigures';

/**
 * Crowd look for Wolf Cove (the instanced figures of earth/bssFigures.ts): hooded parkas in the
 * tribe's blues, white fur at the collar, down the front and round the hem, dark trousers and
 * boots, brown skin, dark hair. The renderer tints the coat (robe), trousers (pants) and skin per
 * person; everything else is one vertex-coloured accessory per person (ids 50+, clear of the Fire
 * Nation's 32–40 and Kyoshi Island's 41–45), so a whole crowd's hoods, hair and gear are a handful
 * of draws.
 *
 * Accessories carry their coat colour (the hood is part of the coat), so each look comes with the
 * coat tint it is drawn with (SWT_LOOK.coats).
 */

export const SAcc = {
  /** Men: hood down on the shoulders, wolf tail, fur collar and trim. Mid blue / navy. */
  man: 50,
  manNavy: 51,
  /** Women: hood down, hair loops and a long braid, a choker. Mid blue / violet-blue. */
  woman: 52,
  womanViolet: 53,
  /** Hood up, the fur ring framing the face, a spear across the back (hunters, fishers outside). */
  hunter: 54,
  /** Warriors: wolf tail, black-and-white war paint, fur mantle, a club at the hip. */
  warrior: 55,
  /** Elders: grey hair in a bun, a heavy fur mantle. */
  elder: 56,
  /** Children: a small hood up with a fur ring. */
  kid: 57,
  /** Waterbenders and healers: hair loops, a water skin at the hip, a blue sash. */
  bender: 58,
  /** Warriors with a round hide shield on the back instead of the boomerang. */
  warriorShield: 59,
} as const;

/** Coat colour for each accessory (the hood is part of the coat). */
export const SWT_LOOK = {
  coats: {
    [SAcc.man]: 0x2d5b97,
    [SAcc.manNavy]: 0x1d3767,
    [SAcc.woman]: 0x3767a6,
    [SAcc.womanViolet]: 0x48488a,
    [SAcc.hunter]: 0x264c7e,
    [SAcc.warrior]: 0x213f72,
    [SAcc.elder]: 0x33517c,
    [SAcc.kid]: 0x4676b4,
    [SAcc.bender]: 0x30629f,
    [SAcc.warriorShield]: 0x213f72,
  } as Record<number, number>,
  /** Trousers and boots: dark blue-greys and browns. */
  pants: [0x1e2a3a, 0x233246, 0x2a2622, 0x1b2230, 0x3a2f27],
  /** Skin. */
  skin: [0x8a5a3c, 0x9a6646, 0xa8744f, 0x7c5034, 0xb07c58, 0x93603f],
} as const;

export type Part = { g: THREE.BufferGeometry; c: string };

/** Merge parts into one vertex-coloured geometry (disposes the parts). */
export function coloured(parts: Part[]): THREE.BufferGeometry {
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

const FUR = '#eef0f0';
const FUR_SHADE = '#d2d6d8';
const HAIR = '#1a120d';
const GREY = '#b9b6b0';
const BONE = '#e6dcc4';
const WOOD = '#6b4a30';
const BLUE_BEAD = '#2f6fb8';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** White fur: the collar round the neck, a band down the front, the hem (body proportions of bssFigures). */
function furTrim(): Part[] {
  const collar = new THREE.TorusGeometry(0.15, 0.05, 6, 14);
  collar.rotateX(Math.PI / 2);
  collar.scale(1.05, 1, 0.86);
  const hem = new THREE.TorusGeometry(0.29, 0.035, 5, 16);
  hem.rotateX(Math.PI / 2);
  hem.scale(1, 1, 0.8);
  // The front band: down the chest, then out along the flare of the coat's skirt.
  const chest = box(0.07, 0.42, 0.03, 0, 1.25, 0.148);
  const skirt = box(0.075, 0.64, 0.03, 0, 0.74, 0.19);
  skirt.rotateX(-0.1);
  skirt.translate(0, 0.07, 0.0);
  return [
    { g: at(collar, 0, 1.47, 0.0), c: FUR },
    { g: at(hem, 0, 0.44, 0), c: FUR_SHADE },
    { g: chest, c: FUR },
    { g: skirt, c: FUR },
  ];
}

/** Hood down, gathered on the back of the shoulders, fur-lined. */
function hoodDown(coat: string): Part[] {
  const hood = new THREE.SphereGeometry(0.17, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
  hood.rotateX(-1.9);
  hood.scale(1.15, 0.8, 0.9);
  const lining = new THREE.TorusGeometry(0.14, 0.035, 5, 12, Math.PI * 1.2);
  lining.rotateZ(-Math.PI * 0.1);
  lining.rotateX(0.3);
  return [
    { g: at(hood, 0, 1.47, -0.17), c: coat },
    { g: at(lining, 0, 1.5, -0.2), c: FUR },
  ];
}

/** Hood up: a fur ring framing the face and the hood over the head. */
function hoodUp(coat: string): Part[] {
  const hood = new THREE.SphereGeometry(0.165, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hood.scale(1, 1.08, 1.05);
  const ring = new THREE.TorusGeometry(0.12, 0.045, 6, 14);
  ring.scale(1, 1.15, 1);
  return [
    { g: at(hood, 0, 1.6, -0.035), c: coat },
    { g: at(ring, 0, 1.6, 0.1), c: FUR },
  ];
}

/** The wolf tail: hair pulled back into a short tail at the crown (sides cropped close). */
function wolfTail(): Part[] {
  const tail = new THREE.CylinderGeometry(0.03, 0.018, 0.14, 6);
  tail.rotateX(-0.9);
  return [
    { g: at(new THREE.SphereGeometry(0.04, 6, 4), 0, 1.71, -0.06), c: HAIR },
    { g: at(tail, 0, 1.71, -0.13), c: HAIR },
  ];
}

/** Hair loops either side of the face and a long braid down the back (and a choker). */
function loopsAndBraid(choker: boolean): Part[] {
  const parts: Part[] = [];
  for (const s of [-1, 1]) {
    const loop = new THREE.TorusGeometry(0.035, 0.012, 4, 8);
    loop.rotateY(Math.PI / 2);
    parts.push({ g: at(loop, s * 0.115, 1.56, 0.05), c: HAIR });
  }
  const braid = new THREE.CylinderGeometry(0.03, 0.02, 0.42, 6);
  braid.rotateX(0.12);
  parts.push({ g: at(braid, 0, 1.4, -0.16), c: HAIR });
  parts.push({ g: at(new THREE.SphereGeometry(0.022, 5, 4), 0, 1.18, -0.135), c: BLUE_BEAD });
  if (choker) {
    const band = new THREE.TorusGeometry(0.062, 0.012, 4, 12);
    band.rotateX(Math.PI / 2);
    parts.push({ g: at(band, 0, 1.505, 0.01), c: BLUE_BEAD });
    parts.push({ g: at(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 8).rotateX(Math.PI / 2), 0, 1.49, 0.075), c: '#7fc0e8' });
  }
  return parts;
}

/** Black-and-white war paint (in front of the face) and a club at the hip. */
function warPaint(): Part[] {
  return [
    { g: box(0.2, 0.05, 0.012, 0, 1.612, 0.124), c: '#141414' },
    { g: box(0.035, 0.12, 0.012, 0, 1.61, 0.129), c: '#f2f2ee' },
    { g: box(0.03, 0.03, 0.012, 0.06, 1.66, 0.12), c: '#f2f2ee' },
    { g: box(0.03, 0.03, 0.012, -0.06, 1.66, 0.12), c: '#f2f2ee' },
  ];
}

/** A bladed boomerang slung across the back. */
function boomerang(): Part[] {
  const arm = new THREE.TorusGeometry(0.2, 0.03, 4, 10, Math.PI * 0.62);
  arm.scale(1, 1, 0.35);
  arm.rotateZ(0.35);
  return [{ g: at(arm, 0.02, 1.12, -0.2), c: '#d9cdb0' }];
}

/** A round hide shield on the back, painted with a wave. */
function shield(): Part[] {
  const disc = new THREE.CylinderGeometry(0.27, 0.27, 0.04, 14);
  disc.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.27, 0.022, 4, 16);
  const wave = new THREE.TorusGeometry(0.11, 0.02, 4, 10, Math.PI);
  return [
    { g: at(disc, 0, 1.15, -0.22), c: '#b8956a' },
    { g: at(rim, 0, 1.15, -0.22), c: '#5a3d25' },
    { g: at(wave, 0, 1.12, -0.245), c: '#2f5c97' },
  ];
}

/** A whale-tooth machete at the hip. */
function machete(): Part[] {
  const blade = new THREE.ConeGeometry(0.035, 0.32, 4);
  blade.scale(1, 1, 0.35);
  blade.rotateZ(Math.PI + 0.15);
  return [
    { g: at(blade, 0.24, 0.84, 0.05), c: '#efe6d2' },
    { g: at(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 5), 0.25, 1.02, 0.05), c: WOOD },
  ];
}

function club(): Part[] {
  const shaft = new THREE.CylinderGeometry(0.022, 0.026, 0.55, 5);
  shaft.rotateZ(0.25);
  return [
    { g: at(shaft, -0.24, 0.92, 0.06), c: WOOD },
    { g: at(new THREE.SphereGeometry(0.06, 6, 5), -0.3, 0.68, 0.06), c: BONE },
  ];
}

/** A spear slung across the back. */
function spearOnBack(): Part[] {
  const shaft = new THREE.CylinderGeometry(0.016, 0.016, 1.7, 5);
  shaft.rotateZ(0.55);
  const tip = new THREE.ConeGeometry(0.035, 0.16, 5);
  tip.rotateZ(0.55);
  return [
    { g: at(shaft, 0, 1.2, -0.21), c: WOOD },
    { g: at(tip, -0.44, 1.92, -0.21), c: BONE },
  ];
}

/** Heavy fur mantle over the shoulders. */
function mantle(c = FUR_SHADE): Part[] {
  const m = new THREE.SphereGeometry(0.28, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42);
  m.scale(1, 0.55, 0.78);
  return [{ g: at(m, 0, 1.36, 0), c }];
}

/** Grey hair drawn back into a bun (elders). */
function greyBun(): Part[] {
  const cap = new THREE.SphereGeometry(0.13, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  return [
    { g: at(cap, 0, 1.62, -0.02), c: GREY },
    { g: at(new THREE.SphereGeometry(0.055, 6, 5), 0, 1.66, -0.12), c: GREY },
    { g: box(0.24, 0.09, 0.1, 0, 1.57, -0.08), c: GREY },
  ];
}

/** Water skin at the hip and a blue sash (benders, healers). */
function waterSkin(): Part[] {
  const skin = new THREE.SphereGeometry(0.08, 7, 5);
  skin.scale(0.8, 1.15, 0.6);
  const sash = new THREE.TorusGeometry(0.215, 0.025, 4, 14);
  sash.rotateX(Math.PI / 2);
  sash.scale(1, 1, 0.76);
  return [
    { g: at(skin, 0.24, 0.92, 0.04), c: '#8a6a48' },
    { g: at(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 4).rotateZ(-0.6), 0.16, 1.06, 0.06), c: '#5b4430' },
    { g: at(sash, 0, 1.04, 0), c: '#7fb4e0' },
  ];
}

const coat = (id: number) => hex(SWT_LOOK.coats[id]);

const DEFS: Record<number, () => Part[]> = {
  [SAcc.man]: () => [...furTrim(), ...hoodDown(coat(SAcc.man)), ...wolfTail()],
  [SAcc.manNavy]: () => [...furTrim(), ...hoodDown(coat(SAcc.manNavy)), ...wolfTail()],
  [SAcc.woman]: () => [...furTrim(), ...hoodDown(coat(SAcc.woman)), ...loopsAndBraid(true)],
  [SAcc.womanViolet]: () => [...furTrim(), ...hoodDown(coat(SAcc.womanViolet)), ...loopsAndBraid(false)],
  [SAcc.hunter]: () => [...furTrim(), ...hoodUp(coat(SAcc.hunter)), ...spearOnBack(), ...machete()],
  [SAcc.warrior]: () => [...furTrim(), ...mantle('#e4e2dc'), ...wolfTail(), ...warPaint(), ...club(), ...boomerang()],
  [SAcc.warriorShield]: () => [...furTrim(), ...mantle('#e4e2dc'), ...wolfTail(), ...warPaint(), ...club(), ...shield()],
  [SAcc.elder]: () => [...furTrim(), ...mantle(), ...greyBun()],
  [SAcc.kid]: () => [...furTrim(), ...hoodUp(coat(SAcc.kid))],
  [SAcc.bender]: () => [...furTrim(), ...hoodDown(coat(SAcc.bender)), ...loopsAndBraid(false), ...waterSkin()],
};

let registered = false;
/** Register Wolf Cove's clothing pieces with the figure renderer (idempotent). */
export function registerSwtAccessories(): void {
  if (registered) return;
  registered = true;
  for (const [id, f] of Object.entries(DEFS)) EXTRA_ACC.set(Number(id), () => ({ geo: coloured(f()), color: '#ffffff' }));
}
