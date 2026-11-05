/**
 * Mountain silhouettes for the hero painting: four depth layers (far → near), each with one
 * profile per mood, packed into a W × 4 RGBA float texture (row = layer, channel = mood:
 * water, earth, fire, air). Heights are 0..1; the shader scales them per layer and blends the
 * channels with the mood weights, so one range of mountains morphs into the next.
 * Profiles tile over x ∈ [0, 1); screen centre ≈ x 0.5.
 */
export const RIDGE_WIDTH = 2048;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Periodic smooth value noise on [0, 1) with `period` lattice cells. */
function noise1(seed: number, period: number): (x: number) => number {
  const r = rng(seed);
  const v = new Float32Array(period);
  for (let i = 0; i < period; i++) v[i] = r();
  return (x: number) => {
    const p = x * period;
    const i = Math.floor(p);
    const f = p - i;
    const a = v[((i % period) + period) % period];
    const b = v[(((i + 1) % period) + period) % period];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

function fbm(seed: number, base: number, octaves: number, ridged = false): (x: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => noise1(seed + o * 101, base << o));
  return (x: number) => {
    let s = 0;
    let a = 0.5;
    let norm = 0;
    for (const n of layers) {
      let v = n(x);
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      s += v * a;
      norm += a;
      a *= 0.5;
    }
    return s / norm;
  };
}

/** Wrapped distance on the unit circle. */
const wd = (x: number, c: number) => {
  const d = Math.abs(x - c);
  return Math.min(d, 1 - d);
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** A rounded tower with steep sides (karst peak / stone spire). */
function tower(x: number, c: number, w: number, h: number, sharp = 4): number {
  const t = wd(x, c) / w;
  if (t >= 1) return 0;
  return h * Math.pow(1 - Math.pow(t, sharp), 0.5);
}

/** A cone (volcano) with an optional crater notch. */
function cone(x: number, c: number, w: number, h: number, crater = 0): number {
  const t = wd(x, c) / w;
  if (t >= 1) return 0;
  let v = h * Math.pow(1 - t, 1.25);
  if (crater > 0) v -= crater * h * Math.max(0, 1 - t / 0.12) ** 2;
  return v;
}

type Profile = (x: number) => number;

function waterProfiles(): Profile[] {
  const r0 = fbm(11, 6, 5, true);
  const r1 = fbm(23, 9, 5, true);
  const r2 = fbm(37, 7, 4);
  const r3 = fbm(41, 18, 3);
  return [
    (x) => 0.18 + 0.82 * Math.pow(r0(x), 1.7) + tower(x, 0.2, 0.05, 0.25, 1.4),
    (x) => 0.1 + 0.75 * Math.pow(r1(x), 1.9) + tower(x, 0.82, 0.045, 0.3, 1.3),
    (x) => 0.12 + 0.5 * r2(x),
    // Ice shelves at the screen edges, open water in the middle.
    (x) => (0.15 + 0.45 * r3(x)) * smooth(0.16, 0.36, wd(x, 0.5)),
  ];
}

function earthProfiles(): Profile[] {
  const s0 = fbm(51, 4, 5);
  const b1 = fbm(53, 10, 3);
  const b3 = fbm(59, 6, 4);
  const r = rng(77);
  const towers1 = Array.from({ length: 22 }, () => ({ c: r(), w: 0.012 + r() * 0.03, h: 0.35 + r() * 0.6 }));
  const towers2 = Array.from({ length: 14 }, () => ({ c: r(), w: 0.018 + r() * 0.035, h: 0.3 + r() * 0.65 }));
  return [
    (x) => 0.2 + 0.6 * s0(x),
    (x) => Math.max(0.12 + 0.2 * b1(x), ...towers1.map((t) => tower(x, t.c, t.w, t.h))),
    (x) => Math.max(0.08 + 0.12 * b1((x + 0.37) % 1), ...towers2.map((t) => (wd(t.c, 0.5) < 0.12 ? 0 : tower(x, t.c, t.w, t.h * 0.9)))),
    // Low rolling hills framing the lake, with a small pagoda on the right-hand hill.
    (x) => {
      const hills = (0.12 + 0.5 * b3(x)) * smooth(0.14, 0.34, wd(x, 0.5));
      const pc = 0.73;
      const d = wd(x, pc);
      const pagoda = d < 0.012 ? 0.62 + (d < 0.004 ? 0.22 : d < 0.008 ? 0.12 : 0.04) : 0;
      return Math.max(hills, pagoda);
    },
  ];
}

function fireProfiles(): Profile[] {
  const j0 = fbm(71, 7, 5, true);
  const j2 = fbm(83, 11, 4, true);
  const b3 = fbm(89, 9, 3);
  return [
    // Far ridges dip in the middle so the setting sun shows between the volcanoes.
    (x) => (0.12 + 0.6 * Math.pow(j0(x), 1.6)) * (0.35 + 0.65 * smooth(0.03, 0.16, wd(x, 0.5))),
    // The great volcano left of centre, a smaller cone on the right.
    (x) => Math.max(0.06 + 0.1 * j2(x), cone(x, 0.3, 0.2, 1, 0.16), cone(x, 0.78, 0.12, 0.55, 0.1), cone(x, 0.96, 0.08, 0.35)),
    (x) => (0.1 + 0.45 * Math.pow(j2((x + 0.5) % 1), 1.3)) * smooth(0.1, 0.3, wd(x, 0.5)),
    // Harbour headlands with tiered towers at the edges of the bay.
    (x) => {
      const land = (0.18 + 0.4 * b3(x)) * smooth(0.2, 0.38, wd(x, 0.5));
      let towers = 0;
      for (const c of [0.18, 0.23, 0.8]) {
        const d = wd(x, c);
        if (d < 0.01) towers = Math.max(towers, 0.55 + (d < 0.003 ? 0.25 : d < 0.006 ? 0.14 : 0.05));
      }
      return Math.max(land, towers * (land > 0.05 ? 1 : 0));
    },
  ];
}

function airProfiles(): Profile[] {
  const r = rng(97);
  const far = Array.from({ length: 30 }, () => ({ c: r(), w: 0.004 + r() * 0.01, h: 0.25 + r() * 0.7 }));
  const mid = Array.from({ length: 12 }, () => ({ c: r(), w: 0.008 + r() * 0.012, h: 0.4 + r() * 0.6 }));
  const near = Array.from({ length: 6 }, () => ({ c: r(), w: 0.014 + r() * 0.02, h: 0.5 + r() * 0.5 }));
  const haze = fbm(101, 5, 3);
  // The temple on its mountain, right of centre: a mesa, a great central tower with a pointed roof
  // and lesser towers either side.
  const temple = (x: number) => {
    const c = 0.7;
    const d = wd(x, c);
    let h = 0;
    if (d < 0.085) h = 0.5 * Math.pow(1 - smooth(0.05, 0.085, d), 1.2) + 0.06 * (1 - d / 0.085);
    // A round tower of half-width w rising to `top`, capped by a pointed roof `roof` high whose
    // eaves flare out past the walls.
    const roofed = (cx: number, w: number, top: number, roof: number) => {
      const dd = wd(x, cx);
      if (dd > w * 1.6) return 0;
      const cap = roof * (1 - dd / (w * 1.6));
      return dd < w ? top + cap : top * smooth(w * 1.6, w, dd) + cap;
    };
    h = Math.max(h, roofed(c, 0.0055, 0.78, 0.14), roofed(c - 0.022, 0.004, 0.66, 0.08), roofed(c + 0.024, 0.004, 0.64, 0.08), roofed(c + 0.043, 0.0032, 0.58, 0.06));
    return h;
  };
  return [
    (x) => Math.max(0.05 + 0.1 * haze(x), ...far.map((t) => tower(x, t.c, t.w, t.h, 2.5))),
    (x) => Math.max(temple(x), ...mid.map((t) => (wd(t.c, 0.7) < 0.1 ? 0 : tower(x, t.c, t.w, t.h * 0.85, 2.2)))),
    (x) => Math.max(0, ...near.map((t) => (wd(t.c, 0.5) < 0.1 || wd(t.c, 0.7) < 0.08 ? 0 : tower(x, t.c, t.w, t.h, 2)))),
    (x) => Math.max(0, tower(x, 0.2, 0.03, 0.9, 2), tower(x, 0.8, 0.025, 0.75, 2)),
  ];
}

/** RGBA float data, RIDGE_WIDTH × 4 (row = layer). */
export function buildRidges(): Float32Array {
  const sets = [waterProfiles(), earthProfiles(), fireProfiles(), airProfiles()];
  const data = new Float32Array(RIDGE_WIDTH * 4 * 4);
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < RIDGE_WIDTH; i++) {
      const x = (i + 0.5) / RIDGE_WIDTH;
      const o = (layer * RIDGE_WIDTH + i) * 4;
      for (let m = 0; m < 4; m++) data[o + m] = clamp01(sets[m][layer](x));
    }
  }
  return data;
}
