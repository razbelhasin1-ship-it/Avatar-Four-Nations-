import type { TattooStyle } from './Appearance';
import type { TattooLandmarks } from './buildUtil';

/**
 * Air Nomad tattoo layouts → per-path shader parameters (pure, unit-tested).
 *
 * Paths (CharMesh TAT ids − 1): 0 head/spine, 1 left arm, 2 right arm, 3 left leg, 4 right leg.
 * Each path has a coordinate t (metres along the path) and s (metres across it):
 *   head: lower back → up the spine → over the crown → down to the forehead
 *   arms: top of the shoulder → down the outer arm → back of the hand
 *   legs: hip → down the outer leg → over the ankle → top of the foot
 * Arrowheads sit at the far end (forehead, hands, feet) pointing along +t.
 *
 * A = [shaft t0, tip t1, half width, enabled]
 * B = [arrowhead length, arrowhead half width, band1 centre, band1 half width]
 * C = [band2 centre, band2 half width, spirit-dots flag, dots t]
 */

export interface TattooUniforms {
  A: number[][];
  B: number[][];
  C: number[][];
}

const HEAD_W = 0.0105;
const LIMB_W = 0.0088;

export function tattooUniforms(style: TattooStyle, L: TattooLandmarks): TattooUniforms {
  const A = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
  const B = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
  const C = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
  const head = (t0: number, headLen = 0.05) => {
    A[0] = [t0, L.head.tTip, HEAD_W, 1];
    B[0] = [headLen, 0.027, 0, 0];
  };
  const arms = (t0: number) => {
    for (const i of [1, 2]) {
      A[i] = [t0, L.arm.tTip, LIMB_W, 1];
      B[i] = [0.042, 0.022, 0, 0];
    }
  };
  const legs = (t0: number) => {
    for (const i of [3, 4]) {
      A[i] = [t0, L.leg.tTip, LIMB_W, 1];
      B[i] = [0.045, 0.022, 0, 0];
    }
  };
  switch (style) {
    case 'arrows':
      head(L.head.tSpineBase + 0.06);
      arms(0.0);
      legs(0.02);
      break;
    case 'arrows_head':
      head(L.head.tNape - 0.07);
      break;
    case 'arrows_limbs':
      arms(0.0);
      legs(0.02);
      break;
    case 'arrow_partial':
      // Initiate: a shorter arrow from the crown, and short arrows on the hands.
      head(L.head.tCrown - 0.04, 0.042);
      arms(L.arm.tWrist - 0.035);
      for (const i of [1, 2]) B[i] = [0.036, 0.019, 0, 0];
      break;
    case 'wind_bands':
      for (const i of [1, 2]) {
        B[i] = [0, 0, L.arm.tElbow + 0.085, 0.0065];
        C[i] = [L.arm.tElbow + 0.118, 0.003, 0, 0];
      }
      break;
    case 'spirit_marks':
      C[0] = [0, 0, 1, L.head.tBrow - 0.016];
      break;
    case 'none':
    default:
      break;
  }
  return { A, B, C };
}

/** True when the style draws anything visible on the head. */
export function tattooOnHead(style: TattooStyle): boolean {
  return style === 'arrows' || style === 'arrows_head' || style === 'arrow_partial' || style === 'spirit_marks';
}
