import type { InstrumentId } from './instruments';
import { SCALES, type StyleSpec } from './theory';

/**
 * Region music themes. Each is a small "composition kit": key, mode, metre,
 * tempo, rhythm vocabulary, harmony per phrase, an instrument line-up and a
 * percussion grid (one char per 16th; 12 steps for 3/4 themes).
 *
 *  Water — ethereal bells + dizi over open-fifth drones, D minor pentatonic, slow 4/4.
 *  Earth — guzheng plucks + taiko, G major pentatonic, steady 4/4.
 *  Fire  — bowed erhu over pulsing bass and big drums, E in-sen (tense), driving 4/4.
 *  Air   — light flute + chimes + open-fifth pads in 3/4, C suspended pentatonic.
 *  Desert (hijaz oud + frame drum), Swamp (xiao + water drum, hirajoshi), Spirit
 *  (bells, choir, lydian 3/4), Menu (the heroic leitmotif), Wild (travel), Battle.
 */

export interface PercMap {
  [ch: string]: [InstrumentId, number];
}

export interface Part {
  inst: InstrumentId;
  /** Octave offset relative to the theme root. */
  oct: number;
  vel: number;
}

export interface AccompPart extends Part {
  pattern: 'arp8' | 'arp16' | 'sparse' | 'chord2' | 'strum' | 'pulse8' | 'root1' | 'root2';
}

export interface ThemeDef {
  id: string;
  /** MIDI root of the lead register. */
  root: number;
  scale: readonly number[];
  bpm: number;
  beatsPerBar: 3 | 4;
  style: StyleSpec;
  form: readonly string[];
  harmony: { A: readonly number[]; A2: readonly number[]; B: readonly number[]; B2: readonly number[] };
  signature?: readonly number[];
  lead: Part;
  /** Answers the lead (canon a beat later, a third lower) in B sections. */
  counter?: Part;
  accomp?: AccompPart;
  bass?: AccompPart;
  /** Sustained bed: intervals above (root - 24). */
  drone?: { inst: 'drone' | 'pad' | 'choir'; intervals: readonly number[]; vel: number; rest?: boolean };
  /** Random high notes per beat. */
  sparkle?: { inst: InstrumentId; prob: number; oct: number; vel: number };
  perc?: { pattern: string; map: PercMap; minDyn?: number };
  /** Seconds of quiet between pieces [min, max]. */
  rest: readonly [number, number];
  /** Hall reverb send. */
  reverb: number;
  /** Output level. */
  level: number;
  combat: { pattern: string; map: PercMap; ostinato: InstrumentId };
}

const R4: Record<string, ReadonlyArray<readonly number[]>> = {
  flowing: [[2, 2], [3, 1], [1.5, 0.5, 2], [1, 1, 2], [2, 1, 1], [1, 0.5, 0.5, 2]],
  steady: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 2], [2, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 1]],
  driving: [[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.75, 0.25, 1, 2], [1.5, 0.5, 1, 1], [0.5, 1, 0.5, 2]],
  desert: [[1, 0.5, 0.5, 2], [0.5, 0.5, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [0.75, 0.25, 1, 2]],
  slow: [[3, 1], [2, 2], [4], [1, 3], [2, 1, 1]],
  heroic: [[1, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [1, 1, 2], [2, 1, 1], [1, 1, 1, 0.5, 0.5]],
  battle: [[0.5, 0.5, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1], [0.75, 0.25, 0.5, 0.5, 2], [0.5, 0.5, 1, 2]],
};
const R3: ReadonlyArray<readonly number[]> = [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [1, 2], [0.5, 0.5, 1, 1], [3]];

const style = (rhythms: ReadonlyArray<readonly number[]>, o: Partial<StyleSpec> = {}): StyleSpec => ({
  rhythms,
  stepBias: 0.72,
  leapMax: 3,
  range: [-2, 8],
  restProb: 0.08,
  ornament: 0.18,
  ornaments: ['bend', 'grace'],
  ...o,
});

const TAIKO: PercMap = { X: ['taiko', 1], x: ['taiko', 0.6], r: ['rim', 0.6], g: ['gong', 0.7] };
const FIRE_DRUMS: PercMap = { X: ['taiko', 1], x: ['taiko', 0.55], r: ['rim', 0.7], g: ['gong', 0.9] };
const FRAME: PercMap = { D: ['framedrum', 1], d: ['framedrum', 0.6], t: ['tek', 0.8], s: ['shaker', 0.6] };
const HAND: PercMap = { X: ['handdrum', 0.9], x: ['handdrum', 0.55], c: ['chime', 0.3] };
const WATERDRUM: PercMap = { o: ['waterdrum', 0.8], O: ['waterdrum', 1], X: ['taiko', 0.7] };

export const THEMES: Record<string, ThemeDef> = {
  water: {
    id: 'water',
    root: 62,
    scale: SCALES.minorPenta,
    bpm: 66,
    beatsPerBar: 4,
    style: style(R4.flowing, { ornament: 0.25, ornaments: ['slide', 'grace'], range: [-1, 8] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 8, 7], A2: [0, 5, 7, 0], B: [3, 10, 8, 7], B2: [3, 5, 10, 7] },
    signature: [0, 2, 3, 2],
    lead: { inst: 'dizi', oct: 1, vel: 0.75 },
    counter: { inst: 'bell', oct: 0, vel: 0.5 },
    accomp: { inst: 'bell', oct: 0, vel: 0.45, pattern: 'sparse' },
    drone: { inst: 'drone', intervals: [0, 7, 12], vel: 0.8, rest: true },
    sparkle: { inst: 'chime', prob: 0.1, oct: 2, vel: 0.35 },
    rest: [12, 26],
    reverb: 0.6,
    level: 0.9,
    combat: { pattern: 'X...x...X...x.x.', map: TAIKO, ostinato: 'lowstrings' },
  },
  earth: {
    id: 'earth',
    root: 55,
    scale: SCALES.majorPenta,
    bpm: 84,
    beatsPerBar: 4,
    style: style(R4.steady, { ornament: 0.22, ornaments: ['bend', 'grace', 'trill'] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 5, 7], A2: [0, 5, 7, 0], B: [9, 5, 0, 7], B2: [9, 5, 2, 7] },
    signature: [0, 1, 2, 4],
    lead: { inst: 'guzheng', oct: 1, vel: 0.85 },
    counter: { inst: 'dizi', oct: 1, vel: 0.5 },
    accomp: { inst: 'guzheng', oct: 0, vel: 0.42, pattern: 'arp8' },
    bass: { inst: 'bass', oct: -1, vel: 0.65, pattern: 'root2' },
    perc: { pattern: 'X.......x...r...', map: TAIKO },
    rest: [10, 22],
    reverb: 0.32,
    level: 0.85,
    combat: { pattern: 'X..xX..xX..xX.xx', map: TAIKO, ostinato: 'lowstrings' },
  },
  fire: {
    id: 'fire',
    root: 52,
    scale: SCALES.insen,
    bpm: 96,
    beatsPerBar: 4,
    style: style(R4.driving, { stepBias: 0.66, leapMax: 4, ornament: 0.2, ornaments: ['slide', 'grace', 'trill'], range: [-1, 8] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 1, 7], A2: [0, 5, 1, 0], B: [5, 1, 0, 7], B2: [10, 8, 1, 7] },
    signature: [0, 3, 2, 1],
    lead: { inst: 'erhu', oct: 1, vel: 0.85 },
    bass: { inst: 'bass', oct: -1, vel: 0.7, pattern: 'pulse8' },
    drone: { inst: 'drone', intervals: [0, 7], vel: 0.7 },
    perc: { pattern: 'X..x..x.X...x.x.', map: FIRE_DRUMS },
    rest: [8, 18],
    reverb: 0.36,
    level: 0.85,
    combat: { pattern: 'X.xxX.x.X.xxX.xX', map: FIRE_DRUMS, ostinato: 'lowstrings' },
  },
  air: {
    id: 'air',
    root: 60,
    scale: SCALES.egyptian,
    bpm: 76,
    beatsPerBar: 3,
    style: style(R3, { ornament: 0.25, ornaments: ['grace', 'slide'], range: [0, 9] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 5, 7], A2: [0, 10, 5, 0], B: [5, 10, 0, 7], B2: [5, 2, 10, 7] },
    signature: [0, 2, 4, 3],
    lead: { inst: 'dizi', oct: 1, vel: 0.7 },
    counter: { inst: 'chime', oct: 1, vel: 0.45 },
    accomp: { inst: 'pad', oct: -1, vel: 0.6, pattern: 'chord2' },
    sparkle: { inst: 'chime', prob: 0.16, oct: 2, vel: 0.3 },
    perc: { pattern: 'X.....x.....', map: HAND, minDyn: 0.7 },
    rest: [12, 24],
    reverb: 0.55,
    level: 0.85,
    combat: { pattern: 'X.xX.xX.xX.x', map: HAND, ostinato: 'lowstrings' },
  },
  desert: {
    id: 'desert',
    root: 62,
    scale: SCALES.hijaz,
    bpm: 88,
    beatsPerBar: 4,
    style: style(R4.desert, { range: [-3, 10], ornament: 0.3, ornaments: ['grace', 'bend', 'trill'] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 1, 7], A2: [0, 1, 10, 0], B: [5, 1, 0, 7], B2: [8, 5, 1, 7] },
    lead: { inst: 'oud', oct: 0, vel: 0.85 },
    accomp: { inst: 'oud', oct: -1, vel: 0.4, pattern: 'strum' },
    drone: { inst: 'drone', intervals: [0, 7], vel: 0.6 },
    perc: { pattern: 'D..t..D.D..t.ts.', map: FRAME },
    rest: [10, 22],
    reverb: 0.28,
    level: 0.85,
    combat: { pattern: 'D.tDt.D.D.tDttts', map: FRAME, ostinato: 'lowstrings' },
  },
  swamp: {
    id: 'swamp',
    root: 57,
    scale: SCALES.hirajoshi,
    bpm: 60,
    beatsPerBar: 4,
    style: style(R4.slow, { stepBias: 0.8, ornament: 0.3, ornaments: ['slide'], range: [-2, 7] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 8, 7], A2: [0, 8, 3, 0], B: [8, 3, 0, 7], B2: [8, 7, 3, 7] },
    lead: { inst: 'xiao', oct: 0, vel: 0.75 },
    drone: { inst: 'drone', intervals: [0, 1, 7], vel: 0.65, rest: true },
    perc: { pattern: 'o.....o...o.....', map: WATERDRUM },
    sparkle: { inst: 'pipa', prob: 0.05, oct: 0, vel: 0.3 },
    rest: [14, 30],
    reverb: 0.5,
    level: 0.85,
    combat: { pattern: 'O..oX..oO..oX.oo', map: WATERDRUM, ostinato: 'lowstrings' },
  },
  spirit: {
    id: 'spirit',
    root: 65,
    scale: SCALES.lydian,
    bpm: 54,
    beatsPerBar: 3,
    style: style(R3, { range: [-2, 9], ornament: 0.1, ornaments: ['grace'] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 2, 0, 7], A2: [0, 2, 9, 0], B: [4, 2, 9, 7], B2: [9, 2, 4, 7] },
    lead: { inst: 'bell', oct: 0, vel: 0.7 },
    accomp: { inst: 'pad', oct: -1, vel: 0.65, pattern: 'chord2' },
    drone: { inst: 'choir', intervals: [12, 19], vel: 0.6, rest: true },
    sparkle: { inst: 'chime', prob: 0.2, oct: 2, vel: 0.28 },
    rest: [10, 20],
    reverb: 0.75,
    level: 0.9,
    combat: { pattern: 'X.....x.x...', map: TAIKO, ostinato: 'lowstrings' },
  },
  menu: {
    id: 'menu',
    root: 62,
    scale: SCALES.majorPenta,
    bpm: 72,
    beatsPerBar: 4,
    style: style(R4.heroic, { ornament: 0.22, ornaments: ['slide', 'grace'], range: [-1, 8] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 5, 7], A2: [0, 9, 7, 0], B: [9, 5, 0, 7], B2: [9, 5, 2, 7] },
    // The leitmotif: rising pentatonic call answered by a step down.
    signature: [0, 1, 2, 4],
    lead: { inst: 'dizi', oct: 1, vel: 0.8 },
    counter: { inst: 'guzheng', oct: 1, vel: 0.5 },
    accomp: { inst: 'guzheng', oct: 0, vel: 0.4, pattern: 'arp8' },
    bass: { inst: 'bass', oct: -1, vel: 0.6, pattern: 'root1' },
    drone: { inst: 'drone', intervals: [0, 7], vel: 0.5 },
    sparkle: { inst: 'bell', prob: 0.05, oct: 1, vel: 0.3 },
    perc: { pattern: 'X...........x.x.', map: TAIKO, minDyn: 0.7 },
    rest: [6, 12],
    reverb: 0.5,
    level: 0.9,
    combat: { pattern: 'X..xX..xX..xX.xx', map: TAIKO, ostinato: 'lowstrings' },
  },
  wild: {
    id: 'wild',
    root: 57,
    scale: SCALES.majorPenta,
    bpm: 80,
    beatsPerBar: 4,
    style: style(R4.flowing, { ornament: 0.2, ornaments: ['slide', 'grace'] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 5, 7], A2: [0, 5, 7, 0], B: [9, 5, 0, 7], B2: [9, 2, 5, 7] },
    lead: { inst: 'dizi', oct: 1, vel: 0.7 },
    counter: { inst: 'pipa', oct: 0, vel: 0.45 },
    accomp: { inst: 'guzheng', oct: 0, vel: 0.36, pattern: 'arp8' },
    bass: { inst: 'bass', oct: -1, vel: 0.5, pattern: 'root1' },
    rest: [14, 30],
    reverb: 0.4,
    level: 0.8,
    combat: { pattern: 'X..xX..xX..xX.xx', map: TAIKO, ostinato: 'lowstrings' },
  },
  battle: {
    id: 'battle',
    root: 52,
    scale: SCALES.minorPenta,
    bpm: 120,
    beatsPerBar: 4,
    style: style(R4.battle, { leapMax: 4, ornament: 0.15, ornaments: ['slide', 'trill'] }),
    form: ['A', 'B', 'A'],
    harmony: { A: [0, 0, 8, 7], A2: [0, 5, 7, 0], B: [3, 10, 8, 7], B2: [3, 5, 10, 7] },
    lead: { inst: 'erhu', oct: 1, vel: 0.9 },
    accomp: { inst: 'lowstrings', oct: -1, vel: 0.7, pattern: 'arp16' },
    bass: { inst: 'bass', oct: -1, vel: 0.7, pattern: 'pulse8' },
    perc: { pattern: 'X.x.X.x.X.xxX.x.', map: FIRE_DRUMS },
    rest: [2, 4],
    reverb: 0.3,
    level: 0.85,
    combat: { pattern: 'X.xxX.x.X.xxX.xX', map: FIRE_DRUMS, ostinato: 'lowstrings' },
  },
};

/** Theme for an id (unknown → wild). */
export function themeFor(id: string): ThemeDef {
  return THEMES[id] ?? THEMES.wild;
}
