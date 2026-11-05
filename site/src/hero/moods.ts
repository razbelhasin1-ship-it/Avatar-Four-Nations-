/**
 * The four moods of the hero painting, one per element, in the order Water, Earth, Fire, Air.
 * Every value blends smoothly when the mood changes (colours in sRGB 0..1).
 */
export type RGB = [number, number, number];

export interface Mood {
  skyTop: RGB;
  skyMid: RGB;
  skyHorizon: RGB;
  /** Sun or moon: position in screen space (0..1, y up), radius (fraction of height), colour and glow. */
  sunPos: [number, number];
  sunSize: number;
  sunColor: RGB;
  sunGlow: number;
  /** 1 = a cratered moon disk, 0 = a burning sun. */
  moon: number;
  stars: number;
  aurora: number;
  clouds: number;
  cloudLit: RGB;
  cloudShade: RGB;
  rays: number;
  cloudSea: number;
  water: number;
  waterDeep: RGB;
  glitter: number;
  mtnNear: RGB;
  mtnFar: RGB;
  fog: RGB;
  mist: number;
  snow: number;
  lava: number;
  rim: RGB;
  rimStrength: number;
  pColor: RGB;
  pVel: [number, number];
  pSize: number;
  pStretch: number;
  pGlow: number;
  pDensity: number;
  pFlicker: number;
  pSwirl: number;
  lanterns: number;
  exposure: number;
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Water: a moonlit polar night over the ice, with an aurora and falling snow. */
const WATER: Mood = {
  skyTop: hex('#03060f'),
  skyMid: hex('#0a1a38'),
  skyHorizon: hex('#2c5379'),
  sunPos: [0.83, 0.78],
  sunSize: 0.06,
  sunColor: hex('#e4eeff'),
  sunGlow: 0.62,
  moon: 1,
  stars: 1,
  aurora: 0.9,
  clouds: 0.22,
  cloudLit: hex('#6d86ad'),
  cloudShade: hex('#1a2a48'),
  rays: 0,
  cloudSea: 0,
  water: 1,
  waterDeep: hex('#030b18'),
  glitter: 0.9,
  mtnNear: hex('#0f1d33'),
  mtnFar: hex('#4b6789'),
  fog: hex('#2a4a70'),
  mist: 0.35,
  snow: 1,
  lava: 0,
  rim: hex('#a9c8ff'),
  rimStrength: 0.35,
  pColor: hex('#e8f1ff'),
  pVel: [0.008, -0.03],
  pSize: 0.055,
  pStretch: 0,
  pGlow: 0.2,
  pDensity: 0.24,
  pFlicker: 0,
  pSwirl: 0.7,
  lanterns: 0,
  exposure: 1.05,
};

/** Earth: a golden afternoon over karst towers and a still lake, seeds drifting on the wind. */
const EARTH: Mood = {
  skyTop: hex('#325681'),
  skyMid: hex('#86aac4'),
  skyHorizon: hex('#f0d6a0'),
  sunPos: [0.2, 0.56],
  sunSize: 0.05,
  sunColor: hex('#fff0c6'),
  sunGlow: 0.85,
  moon: 0,
  stars: 0,
  aurora: 0,
  clouds: 0.6,
  cloudLit: hex('#fff3d8'),
  cloudShade: hex('#9fb0c0'),
  rays: 0.45,
  cloudSea: 0,
  water: 1,
  waterDeep: hex('#15302d'),
  glitter: 0.55,
  mtnNear: hex('#22402b'),
  mtnFar: hex('#94ad9e'),
  fog: hex('#cbd3bd'),
  mist: 0.55,
  snow: 0,
  lava: 0,
  rim: hex('#ffe3a0'),
  rimStrength: 0.4,
  pColor: hex('#eef6c0'),
  pVel: [0.022, 0.006],
  pSize: 0.05,
  pStretch: 0.6,
  pGlow: 0.25,
  pDensity: 0.11,
  pFlicker: 0.3,
  pSwirl: 1,
  lanterns: 0,
  exposure: 1,
};

/** Fire: dusk over the volcanic islands, a great red sun, embers and lanterns rising. */
const FIRE: Mood = {
  skyTop: hex('#0e0306'),
  skyMid: hex('#480c0e'),
  skyHorizon: hex('#e55f28'),
  sunPos: [0.7, 0.45],
  sunSize: 0.105,
  sunColor: hex('#ff7d33'),
  sunGlow: 1,
  moon: 0,
  stars: 0.25,
  aurora: 0,
  clouds: 0.45,
  cloudLit: hex('#ff9a55'),
  cloudShade: hex('#2a0a0c'),
  rays: 0.25,
  cloudSea: 0,
  water: 1,
  waterDeep: hex('#0d0407'),
  glitter: 1,
  mtnNear: hex('#120406'),
  mtnFar: hex('#5a1a16'),
  fog: hex('#7a2a1a'),
  mist: 0.3,
  snow: 0,
  lava: 1,
  rim: hex('#ff9a4a'),
  rimStrength: 0.55,
  pColor: hex('#ffad66'),
  pVel: [0.006, 0.05],
  pSize: 0.05,
  pStretch: 0.7,
  pGlow: 0.95,
  pDensity: 0.18,
  pFlicker: 1,
  pSwirl: 0.8,
  lanterns: 0.9,
  exposure: 1.05,
};

/** Air: sunrise above a sea of clouds, the temple on its pinnacle, wind streaks. */
const AIR: Mood = {
  skyTop: hex('#4a7fc0'),
  skyMid: hex('#a6c6e4'),
  skyHorizon: hex('#ffe0ab'),
  sunPos: [0.6, 0.47],
  sunSize: 0.058,
  sunColor: hex('#fff2d2'),
  sunGlow: 1,
  moon: 0,
  stars: 0,
  aurora: 0,
  clouds: 0.5,
  cloudLit: hex('#fff6e6'),
  cloudShade: hex('#a9b7d0'),
  rays: 0.6,
  cloudSea: 1,
  water: 0,
  waterDeep: hex('#3a4a66'),
  glitter: 0,
  mtnNear: hex('#3d4762'),
  mtnFar: hex('#b4c2d8'),
  fog: hex('#f0e3cf'),
  mist: 0.45,
  snow: 0.15,
  lava: 0,
  rim: hex('#ffd98a'),
  rimStrength: 0.7,
  pColor: hex('#fffaf0'),
  pVel: [0.07, 0.004],
  pSize: 0.045,
  pStretch: 5,
  pGlow: 0.1,
  pDensity: 0.1,
  pFlicker: 0,
  pSwirl: 0.35,
  lanterns: 0,
  exposure: 1,
};

export const MOODS: Mood[] = [WATER, EARTH, FIRE, AIR];

/** Weighted blend of the four moods (weights sum to 1). */
export function blendMoods(w: readonly number[], out: Mood = structuredClone(WATER)): Mood {
  const o = out as unknown as Record<string, number | number[]>;
  for (const key of Object.keys(WATER) as (keyof Mood)[]) {
    const a = WATER[key];
    if (Array.isArray(a)) {
      const arr = o[key] as number[];
      for (let i = 0; i < a.length; i++) {
        let v = 0;
        for (let m = 0; m < 4; m++) v += ((MOODS[m][key] as number[])[i] ?? 0) * w[m];
        arr[i] = v;
      }
    } else {
      let v = 0;
      for (let m = 0; m < 4; m++) v += (MOODS[m][key] as number) * w[m];
      o[key] = v;
    }
  }
  return out;
}
