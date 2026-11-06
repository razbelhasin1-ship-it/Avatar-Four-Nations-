import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/MathUtil';
import type { RenderPipeline } from '../render/Renderer';
import { CLOUD_FIELD, envUniforms } from './env/EnvShared';
import { pfbm, worley } from './env/ProcTex';

/**
 * Sky dome with an atmospheric gradient, sun and moon discs with glow, stars with a milky-way band,
 * and the clouds: a cumulus layer in world space (1150–2450 m) ray-marched per pixel — domed clouds
 * with flat bases, lit through their own bulk toward the sun or the moon, silver-lined when backlit,
 * painted from below by the afterglow at dusk, sinking into the haze with distance — under wind-combed
 * cirrus. The same cloud field casts drifting shadows on the ground (EnvShared envCloudSun) and dims
 * the sun around the camera when a cloud passes over it. Time-of-day lighting drives the global
 * sun/hemisphere lights, the fog colour and the shared environment uniforms; region "mood" (weather:
 * cloud cover, tint, fog) blends smoothly.
 */

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uMoonPhase;
uniform float uTime;
uniform float uCloudCover;
uniform float uOvercast;
uniform float uNight;
uniform vec3 uCloudTint;
uniform vec2 uCloudOffset;
uniform float uHaze;
uniform sampler2D uNoiseTex;
uniform float uCloudSearch;
uniform float uCloudFine;
uniform float uCloudLight;
varying vec3 vDir;

// The cumulus layer, in world metres: flat bases at the condensation level, towers up to the top.
const float CL_BASE = ${CLOUD_FIELD.base.toFixed(1)};
const float CL_TOP = ${CLOUD_FIELD.top.toFixed(1)};
const float CL_INV = 1.0 / (CL_TOP - CL_BASE);
const float CL_SCALE = 1.0 / ${CLOUD_FIELD.scale.toFixed(1)}; // one tile of the cumulus field
const float CL_DETAIL = 1.0 / 1250.0; // the billows on their surface
const float CL_FAR = 46000.0; // beyond this the haze has them

float sHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

// Height of the cloud over a point (0..1 of the layer). The field is made of domed cells, so the top
// rises gently from a cloud's edge to its crown: every cloud is a dome whose cross-section shrinks as
// it climbs (never an extruded wall), and its rim thins out to nothing (k² / (k + c) is flat at the
// rim) so edges feather instead of ending in a hard, aliased step. More cover: more clouds, taller.
float clTop(vec2 xz) {
  float c = textureLod(uNoiseTex, xz * CL_SCALE + uCloudOffset * ${CLOUD_FIELD.drift.toFixed(3)}, 0.0).a;
  float thr = ${CLOUD_FIELD.thr0.toFixed(3)} - uCloudCover * ${CLOUD_FIELD.thrK.toFixed(3)};
  float k = clamp((c - thr) / (1.0 - thr), 0.0, 1.0);
  return k * k / (k + 0.08) * (0.33 + 0.46 * uCloudCover);
}

// Density at p: a flat soft base, a rounded top, billows eating into the surface (more toward the top).
// env = how far under its dome top p lies (layer fraction; negative above it).
float clDensity(vec3 p, float lod, out float hN, out float env) {
  hN = (p.y - CL_BASE) * CL_INV;
  float top = clTop(p.xz);
  env = top - hN;
  float body = smoothstep(0.0, 0.05, hN) * smoothstep(0.0, 0.06, env);
  if (body < 0.002) return 0.0;
  // The billows lean as they climb, so they read as heaped lobes rather than straight columns.
  float det = textureLod(uNoiseTex, p.xz * CL_DETAIL + uCloudOffset * 2.9 + vec2(hN * 0.23, -hN * 0.17), lod).g;
  return clamp(body - (1.0 - det) * (0.13 + 0.36 * hN), 0.0, 1.0);
}

// Is p inside a dome? (A hair of margin skips grazing slivers too thin to show, the same in every pixel.)
bool clInside(vec3 p) {
  float hN = (p.y - CL_BASE) * CL_INV;
  return hN > 0.006 && hN < 1.0 && clTop(p.xz) > hN + 0.01;
}

// Cloud between p and the light (metres of cloud). With more than one sample the first reads the
// billows themselves, so each lobe shades the one behind it (the cauliflower look); the rest read the
// domes in growing steps, so towers shade their neighbours and thick clouds keep dark bases.
float clOptical(vec3 p, vec3 L, float lod) {
  float hq, eq;
  if (uCloudLight < 1.5) {
    vec3 q = p + L * 130.0;
    hq = (q.y - CL_BASE) * CL_INV;
    return smoothstep(0.0, 0.11, clTop(q.xz) - hq) * smoothstep(-0.02, 0.05, hq) * 130.0;
  }
  float od = clDensity(p + L * 80.0, lod, hq, eq) * 240.0;
  for (int k = 2; k <= 3; k++) {
    if (float(k) > uCloudLight) break;
    vec3 q = p + L * (130.0 * float(k * k));
    hq = (q.y - CL_BASE) * CL_INV;
    if (hq > 1.0 || hq < -0.05) break;
    od += smoothstep(0.0, 0.11, clTop(q.xz) - hq) * smoothstep(-0.02, 0.05, hq) * 130.0 * float(2 * k - 1);
  }
  return od;
}

// Henyey-Greenstein, scaled so isotropic scattering is 1.
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = max(h, 0.0);
  // Atmospheric gradient with a bright hazy band at the horizon.
  vec3 col = mix(uHorizon, uZenith, pow(hh, 0.42));
  col = mix(col, uGround, exp(-hh * 22.0) * 0.75);
  float sd = max(dot(d, uSunDir), 0.0);
  float day = 1.0 - uNight;
  col += uSunColor * (pow(sd, 5.0) * 0.16 + pow(sd, 42.0) * 0.35) * day * (1.0 - uOvercast * 0.7);
  // Sun disc.
  float disc = smoothstep(0.99955, 0.99978, sd);
  col += uSunColor * disc * 7.0 * day * (1.0 - uOvercast * 0.95);
  // Moon disc with halo, lit by its phase ([additive: sub-elements] uMoonPhase 0 new .. 0.5 full .. 1).
  float md = max(dot(d, uMoonDir), 0.0);
  float moon = smoothstep(0.99935, 0.9996, md);
  vec3 mRight = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec2 mq = vec2(dot(d, mRight), dot(d, cross(mRight, uMoonDir))) / 0.0322;
  float mPh = uMoonPhase * 6.2831853;
  float mLit = smoothstep(-0.08, 0.12, dot(vec3(mq, sqrt(max(0.0, 1.0 - dot(mq, mq)))), vec3(sin(mPh), 0.0, -cos(mPh))));
  float mIllum = 0.5 - 0.5 * cos(mPh);
  col += vec3(0.85, 0.9, 1.0) * (moon * 1.6 * mix(0.05, 1.0, mLit) + pow(md, 300.0) * 0.25 * (0.3 + 0.7 * mIllum) + pow(md, 1400.0) * 0.5 * step(0.999, mIllum)) * uNight * (1.0 - uOvercast * 0.8);
  // Stars & milky way.
  if (uNight > 0.01 && h > -0.02) {
    float th = atan(d.z, d.x);
    float ph = asin(clamp(d.y, -1.0, 1.0));
    vec2 g = vec2(th * 140.0, ph * 140.0);
    vec2 cell = floor(g);
    float r = sHash(cell);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 4.0) + r * 40.0);
    float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * tw;
    vec3 bandN = normalize(vec3(0.35, 0.55, -0.76));
    float band = exp(-pow(dot(d, bandN) * 5.0, 2.0));
    float mw = band * (0.5 + 0.5 * texture2D(uNoiseTex, vec2(th * 0.6, ph * 1.4)).r);
    col += (vec3(star) * 1.3 + vec3(0.32, 0.36, 0.5) * mw * 0.35) * uNight * smoothstep(0.0, 0.25, h) * (1.0 - uOvercast);
  }
  // Clouds: high cirrus behind a ray-marched cumulus layer, lit by the sun (or the moon).
  if (h > -0.02) {
    vec3 ro = cameraPosition;
    float nightL = smoothstep(0.3, 0.9, uNight);
    vec3 L = normalize(mix(uSunDir, uMoonDir, nightL));
    float cosT = dot(d, L);
    // Strong forward scattering (silver linings toward the light), softened for multiple scattering.
    float phase = mix(1.0, 0.72 * hg(cosT, 0.62) + 0.28 * hg(cosT, -0.22), 0.4);
    vec3 sunCol = uSunColor * (1.0 - uOvercast * 0.82) * (1.0 - nightL);
    vec3 moonCol = vec3(0.52, 0.6, 0.8) * (0.08 + 0.3 * mIllum) * nightL * (1.0 - uOvercast * 0.6);
    vec3 Lcol = (sunCol + moonCol) * uCloudTint;
    vec3 ambTop = (mix(uZenith, uHorizon, 0.4) * 0.95 + vec3(0.025) * day) * uCloudTint;
    vec3 ambBot = mix(uHorizon, uGround, 0.55) * 0.46 * uCloudTint;
    // Dusk: a sun under the horizon still paints the cloud bases from below, brightest toward it.
    float glow = smoothstep(-0.34, -0.05, uSunDir.y) * smoothstep(0.12, -0.02, uSunDir.y);
    float towardSun = max(dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), 0.0);
    vec3 glowCol = uHorizon * 1.3 * glow * (0.45 + 0.55 * towardSun);

    // Cirrus at 8 km: long soft bands combed into fine fibres along the wind, thinning as the sky
    // fills with lower cloud.
    if (d.y > 0.0) {
      float tc = (8200.0 - ro.y) / max(d.y, 0.02);
      vec2 cq = (ro.xz + d.xz * tc) / 30000.0 + uCloudOffset * 0.42;
      // (Low quality skips the warp: two lookups on every sky pixel.)
      vec2 warp = uCloudLight < 1.5 ? vec2(0.0) : (vec2(textureLod(uNoiseTex, cq * 0.6, 0.0).r, textureLod(uNoiseTex, cq * 0.6 + 0.43, 0.0).b) - 0.5) * 0.35;
      float band = textureLod(uNoiseTex, cq * vec2(0.9, 0.22) + warp, 0.0).r;
      float fib = textureLod(uNoiseTex, cq * vec2(5.0, 0.6) + warp * 1.6, 0.0).b;
      float cir = smoothstep(0.56, 0.8, band) * (0.45 + 0.55 * smoothstep(0.35, 0.75, fib));
      cir *= smoothstep(0.0, 0.1, d.y) * exp(-tc / 90000.0) * (0.25 + 0.5 * (1.0 - uOvercast)) * (0.45 + 0.55 * (1.0 - uCloudCover));
      vec3 cirCol = sunCol * (0.65 + 0.9 * pow(max(cosT, 0.0), 6.0)) + ambTop * 0.9 + glowCol * 0.8 + moonCol * 0.8;
      col = mix(col, cirCol * uCloudTint, cir * 0.55);
    }

    // Cumulus: march the layer from where the ray enters it.
    float t0 = -1.0, t1 = -1.0;
    if (ro.y < CL_BASE) {
      if (d.y > 0.0) { t0 = (CL_BASE - ro.y) / d.y; t1 = (CL_TOP - ro.y) / d.y; }
    } else if (ro.y < CL_TOP) {
      t0 = 0.0;
      t1 = d.y > 0.0 ? (CL_TOP - ro.y) / d.y : (d.y < 0.0 ? (CL_BASE - ro.y) / d.y : 9000.0);
    } else if (d.y < 0.0) {
      t0 = (CL_TOP - ro.y) / d.y;
      t1 = (CL_BASE - ro.y) / d.y;
    }
    if (t0 >= 0.0 && t0 < CL_FAR) {
      t1 = min(t1, t0 + 9000.0);
      // Search the layer in even steps on the dome tops alone (one lookup each). On finding a cloud,
      // halve back to its edge and march into it in fine steps that lengthen as they go, then search
      // on past it. Every pixel enters at the cloud's true surface, so silhouettes stay clean (no
      // dither fringe from an evenly stepped march) and the steps are spent inside the clouds.
      float dtC = (t1 - t0) / uCloudSearch;
      float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 acc = vec3(0.0);
      float tr = 1.0, tHit = 0.0;
      float t = t0, dtF = 0.0, lod = 0.0, nS = 0.0, nF = 0.0, outside = 0.0;
      bool inCloud = false;
      // Low quality: fewer halvings to the edge, and fine steps that lengthen faster.
      bool cheap = uCloudLight < 1.5;
      int nHalve = cheap ? 4 : 5;
      float grow = cheap ? 1.09 : 1.07;
      float envPrev = -1.0; // how far under a dome top the last search sample was
      // From below, a ray enters through the flat bases: look just above the entry first. Toward a
      // cloud's rim the base is too thin for the even search to land in, which cut a hard outline.
      if (ro.y < CL_BASE && clInside(ro + d * (t0 + 0.009 * (CL_TOP - CL_BASE) / max(d.y, 1e-3)))) {
        dtF = clamp(t0 * 0.004, 28.0, 140.0);
        lod = clamp(log2(max(t0, 1.0) * 0.0011), 0.0, 4.0);
        t = t0 + dtF * jit;
        inCloud = true;
      }
      for (int i = 0; i < 64; i++) {
        if (tr < 0.02 || t >= t1) break;
        if (!inCloud) {
          if (nS > uCloudSearch) break;
          // The first step is dithered per pixel: a sliver of cloud thinner than a step is then found
          // in some pixels and not their neighbours (soft fuzz), not in whole rows (horizontal combs
          // along distant clouds).
          float tn = min(t + dtC * (nS < 0.5 ? max(jit, 0.05) : 1.0), t1);
          nS += 1.0;
          vec3 pn = ro + d * tn;
          float hn = (pn.y - CL_BASE) * CL_INV;
          float en = clTop(pn.xz) - hn;
          bool hit = hn > 0.006 && hn < 1.0 && en > 0.01;
          // A near miss (the ray skims just over a dome): look between the steps as well, so a thin
          // sliver of cloud is found in every pixel alike, not in some (speckle along the tops).
          if (!hit && max(en, envPrev) > -0.06 && hn > -0.02 && hn < 1.02) {
            for (int q = 1; q <= 3; q++) {
              float tq = t + (tn - t) * float(q) * 0.25;
              if (clInside(ro + d * tq)) { tn = tq; hit = true; break; }
            }
          }
          envPrev = en;
          if (hit) {
            float a = t, b = tn;
            for (int k = 0; k < 5; k++) {
              if (k >= nHalve) break;
              float m = 0.5 * (a + b);
              if (clInside(ro + d * m)) b = m; else a = m;
            }
            dtF = clamp(a * 0.004, 28.0, 140.0);
            lod = clamp(log2(max(a, 1.0) * 0.0011), 0.0, 4.0);
            // Dither the first fine step over a whole step: the fine steps are short enough that this
            // reads as faint grain, where a fixed offset draws contour rings through thin cloud.
            t = a + dtF * jit;
            inCloud = true;
            outside = 0.0;
          } else {
            t = tn;
          }
        } else {
          if (nF >= uCloudFine) break;
          nF += 1.0;
          vec3 p = ro + d * t;
          float hN, env;
          float den = clDensity(p, lod, hN, env);
          if (den > 0.003) {
            if (tHit == 0.0) tHit = t;
            float sT = exp(-clOptical(p, L, lod) * 0.0042);
            // Skylight reaches deep inside less (under a tall crown, in a thick base).
            float occ = 0.62 + 0.38 * exp(-max(env, 0.0) * 3.5);
            vec3 S = Lcol * sT * phase + mix(ambBot, ambTop, smoothstep(0.0, 0.7, hN)) * occ + glowCol * (1.0 - hN) * 0.9;
            float a = 1.0 - exp(-den * 0.006 * dtF);
            acc += tr * a * S;
            tr *= 1.0 - a;
          }
          // Out of the dome for two steps: back to searching.
          outside = (env < 0.0 || hN < 0.0 || hN > 1.0) ? outside + 1.0 : 0.0;
          if (outside >= 2.0) {
            inCloud = false;
            envPrev = env;
          }
          t += dtF;
          dtF *= grow;
        }
      }
      if (tHit > 0.0) {
        // Aerial perspective: distant clouds sink into the sky behind them.
        float fade = exp(-tHit / 26000.0) * smoothstep(CL_FAR, CL_FAR * 0.55, tHit) * smoothstep(-0.005, 0.06, d.y);
        acc = mix(col * (1.0 - tr), acc, fade);
        col = col * tr + acc;
      }
    }
  }
  // Weather haze (fog banks, sandstorms, blizzards): the sky melts toward the fog colour, most near the horizon.
  col = mix(col, uGround, uHaze * (1.0 - 0.4 * smoothstep(0.0, 0.9, hh)));
  // Below the horizon blend into the fog colour so distant terrain melts into the sky.
  col = mix(col, uGround, smoothstep(0.03, -0.035, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface SkyKey {
  t: number; // hour
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

const KEYS: SkyKey[] = [
  { t: 0, zenith: '#050a1a', horizon: '#18233f', sun: '#9fb4ec', sunI: 0.95, hemiSky: '#5b6fa6', hemiGround: '#2c3048', hemiI: 1.45 },
  { t: 4.6, zenith: '#0b1430', horizon: '#363a62', sun: '#9fb0e0', sunI: 0.7, hemiSky: '#5a6698', hemiGround: '#2c2a36', hemiI: 1.3 },
  { t: 5.6, zenith: '#26386c', horizon: '#ef9e78', sun: '#ffa268', sunI: 0.75, hemiSky: '#9a8fb5', hemiGround: '#5a463c', hemiI: 1.15 },
  { t: 6.6, zenith: '#4b78c0', horizon: '#ffc797', sun: '#ffc288', sunI: 1.8, hemiSky: '#b9c4e0', hemiGround: '#7a6450', hemiI: 1.45 },
  { t: 8.2, zenith: '#4885d6', horizon: '#d2e2f1', sun: '#ffe6c4', sunI: 2.45, hemiSky: '#c8dcf5', hemiGround: '#7a6650', hemiI: 1.3 },
  { t: 12, zenith: '#3f7fd6', horizon: '#c6dcf0', sun: '#fff3e0', sunI: 2.85, hemiSky: '#cfe2fa', hemiGround: '#776450', hemiI: 1.38 },
  { t: 16, zenith: '#4580d0', horizon: '#d9e0e6', sun: '#ffe0b4', sunI: 2.55, hemiSky: '#c9d6ea', hemiGround: '#7c644a', hemiI: 1.3 },
  { t: 18, zenith: '#4a6db2', horizon: '#ffc183', sun: '#ffb068', sunI: 2.0, hemiSky: '#c0b8c8', hemiGround: '#7a5a40', hemiI: 1.38 },
  { t: 19.2, zenith: '#2b386e', horizon: '#ff8d58', sun: '#ff8648', sunI: 1.0, hemiSky: '#8d7898', hemiGround: '#543c32', hemiI: 1.15 },
  { t: 20.4, zenith: '#0f1838', horizon: '#47395f', sun: '#9aa8d8', sunI: 0.75, hemiSky: '#56679c', hemiGround: '#2c2c3c', hemiI: 1.35 },
  { t: 24, zenith: '#050a1a', horizon: '#18233f', sun: '#9fb4ec', sunI: 0.95, hemiSky: '#5b6fa6', hemiGround: '#2c3048', hemiI: 1.45 },
];

/**
 * Graphics effects quality → the cloud march: search steps through the layer, fine steps inside a
 * cloud, and light samples toward the sun (from 2 on, the first one reads the billows).
 */
export type CloudQuality = 'low' | 'medium' | 'high';
const CLOUD_QUALITY: Record<CloudQuality, { search: number; fine: number; light: number }> = {
  low: { search: 10, fine: 8, light: 1 },
  medium: { search: 22, fine: 16, light: 2 },
  high: { search: 30, fine: 24, light: 3 },
};

export interface SkyMood {
  /** Multiplies horizon/fog colour. */
  tint: THREE.Color;
  /** 0..1 */
  cloudCover: number;
  /** Fog density multiplier (1 = settings draw distance). */
  fogScale: number;
  cloudTint: THREE.Color;
  /** 0..1 grey overcast (dims sun, flattens light). */
  overcast: number;
}

/**
 * Tileable cloud noise, shared by the sky and the cloud sea: R = fbm, G = billowy cells, B = fine
 * fbm, A = the cumulus field (rounded billow cells gathered by a broad fbm into fields of cloud and
 * patches of clear sky, normalised to 0..1 so cover thresholds behave the same everywhere).
 */
export function createCloudNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const cum = new Float32Array(size * size);
  const w = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const dome = (f1: number) => {
    const t = Math.min(1, f1);
    return 1 - t * t;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const f = 0.5 + 0.5 * pfbm(u, v, 4, 5, 501);
      worley(u, v, 6, 777, 0.9, w);
      const cell = 1 - Math.min(1, w.f1 / 0.75);
      worley(u, v, 13, 778, 0.9, w);
      const cell2 = 1 - Math.min(1, w.f1 / 0.75);
      const billow = Math.min(1, Math.max(0, cell * 0.6 + cell2 * 0.3 + 0.25 * pfbm(u, v, 8, 3, 502)));
      // Cumulus: domed cells at three sizes (a cloud is a heap of rounded towers), weighted by a broad fbm.
      worley(u, v, 5, 611, 0.85, w);
      const c1 = dome(w.f1);
      worley(u, v, 11, 612, 0.85, w);
      const c2 = dome(w.f1 * 1.05);
      worley(u, v, 23, 613, 0.85, w);
      const c3 = dome(w.f1 * 1.1);
      const field = 0.5 + 0.5 * pfbm(u, v, 3, 4, 601);
      cum[y * size + x] = (c1 * 0.5 + c2 * 0.33 + c3 * 0.17) * (0.35 + 0.65 * field) + 0.3 * field;
      const o = (y * size + x) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, f)) * 255);
      data[o + 1] = Math.round(billow * 255);
      data[o + 2] = Math.round((0.5 + 0.5 * pfbm(u, v, 16, 3, 503)) * 255);
    }
  }
  // Normalise the cumulus field between its 2nd and 99.5th percentiles.
  const sorted = Float32Array.from(cum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.995)];
  for (let i = 0; i < cum.length; i++) data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (cum[i] - lo) / (hi - lo))) * 255);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class SkySystem {
  readonly dome: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  readonly noiseTexture: THREE.DataTexture;
  /** Hours [0, 24). */
  timeOfDay = 9.5;
  /** Real seconds per in-game hour (0 = frozen). */
  secondsPerHour = 90;
  readonly sunColor = new THREE.Color();
  readonly horizonColor = new THREE.Color();
  readonly zenithColor = new THREE.Color();
  readonly moonDir = new THREE.Vector3(-0.3, 0.75, -0.4).normalize();
  /** [additive: sub-elements] Lunar phase shown on the disc: 0 new, 0.5 full (set by the moon system). */
  moonPhase = 0.5;
  /** 0 night .. 1 full day. */
  daylight = 1;
  /** Elevation of the sun (sin of angle above horizon, may be negative). */
  sunElevation = 0.5;
  readonly mood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff'), overcast: 0 };
  private readonly targetMood: SkyMood = { tint: new THREE.Color(1, 1, 1), cloudCover: 0.45, fogScale: 1, cloudTint: new THREE.Color('#ffffff'), overcast: 0 };
  /** Cloud drift (UV offset), advanced by wind. */
  readonly cloudOffset = new THREE.Vector2();
  /** Eased sun multiplier from the cloud over the camera (cloud shadows). */
  private localSun = 1;
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly pipeline: RenderPipeline) {
    this.noiseTexture = createCloudNoiseTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color('#5d6b78') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uMoonDir: { value: this.moonDir },
        uMoonPhase: { value: 0.5 },
        uTime: { value: 0 },
        uCloudCover: { value: 0.45 },
        uOvercast: { value: 0 },
        uNight: { value: 0 },
        uCloudTint: { value: new THREE.Color('#ffffff') },
        uCloudOffset: { value: this.cloudOffset },
        uNoiseTex: { value: this.noiseTexture },
        uHaze: { value: 0 },
        uCloudSearch: { value: CLOUD_QUALITY.medium.search },
        uCloudFine: { value: CLOUD_QUALITY.medium.fine },
        uCloudLight: { value: CLOUD_QUALITY.medium.light },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), this.mat);
    this.dome.name = 'sky';
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    pipeline.scene.add(this.dome);
  }

  setMood(m: Partial<{ tint: THREE.ColorRepresentation; cloudCover: number; fogScale: number; cloudTint: THREE.ColorRepresentation; overcast: number }>): void {
    if (m.tint !== undefined) this.targetMood.tint.set(m.tint);
    if (m.cloudCover !== undefined) this.targetMood.cloudCover = m.cloudCover;
    if (m.fogScale !== undefined) this.targetMood.fogScale = m.fogScale;
    if (m.cloudTint !== undefined) this.targetMood.cloudTint.set(m.cloudTint);
    if (m.overcast !== undefined) this.targetMood.overcast = m.overcast;
  }

  /** Jump the current mood to the target (teleports, loading screens). */
  snapMood(): void {
    this.mood.tint.copy(this.targetMood.tint);
    this.mood.cloudTint.copy(this.targetMood.cloudTint);
    this.mood.cloudCover = this.targetMood.cloudCover;
    this.mood.fogScale = this.targetMood.fogScale;
    this.mood.overcast = this.targetMood.overcast;
  }

  private sample(hour: number, key: 'zenith' | 'horizon' | 'sun' | 'hemiSky' | 'hemiGround', out: THREE.Color): THREE.Color {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i], b = KEYS[i + 1];
      if (hour >= a.t && hour <= b.t) {
        const t = (hour - a.t) / (b.t - a.t);
        return out.set(a[key]).lerp(this.c2.set(b[key]), t);
      }
    }
    return out.set(KEYS[0][key]);
  }

  private sampleNum(hour: number, key: 'sunI' | 'hemiI'): number {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i], b = KEYS[i + 1];
      if (hour >= a.t && hour <= b.t) return lerp(a[key], b[key], (hour - a.t) / (b.t - a.t));
    }
    return KEYS[0][key];
  }

  /** Is it night (for NPC routines, ambience)? */
  get isNight(): boolean {
    return this.timeOfDay < 5.5 || this.timeOfDay > 20.5;
  }

  update(dt: number, camera: THREE.Camera, drawDistance: number, quality: CloudQuality = 'medium'): void {
    const q = CLOUD_QUALITY[quality] ?? CLOUD_QUALITY.medium;
    this.mat.uniforms.uCloudSearch.value = q.search;
    this.mat.uniforms.uCloudFine.value = q.fine;
    this.mat.uniforms.uCloudLight.value = q.light;
    if (this.secondsPerHour > 0) {
      this.timeOfDay = (this.timeOfDay + dt / this.secondsPerHour) % 24;
    }
    const k = 1 - Math.exp(-dt * 0.5);
    this.mood.tint.lerp(this.targetMood.tint, k);
    this.mood.cloudTint.lerp(this.targetMood.cloudTint, k);
    this.mood.cloudCover = lerp(this.mood.cloudCover, this.targetMood.cloudCover, k);
    this.mood.fogScale = lerp(this.mood.fogScale, this.targetMood.fogScale, k);
    this.mood.overcast = lerp(this.mood.overcast, this.targetMood.overcast, k);

    const hour = this.timeOfDay;
    // Sun path: rises in the east (+X), sets in the west, tilted south.
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunElevation = elev;
    const sunDir = this.pipeline.sunDir;
    const trueSun = new THREE.Vector3(Math.cos(ang), elev, 0.35).normalize();
    this.moonDir.set(-trueSun.x * 0.8 + 0.1, Math.max(0.25, -elev * 0.8 + 0.2), -0.45).normalize();
    if (elev > -0.05) {
      sunDir.set(Math.cos(ang), Math.max(0.06, elev), 0.35).normalize();
    } else {
      // Moonlight at night.
      sunDir.copy(this.moonDir);
    }
    const overcast = this.mood.overcast;
    this.sample(hour, 'zenith', this.zenithColor);
    this.sample(hour, 'horizon', this.horizonColor).multiply(this.mood.tint);
    this.sample(hour, 'sun', this.sunColor);
    // Overcast skies turn grey and flat.
    const grey = this.c1.set('#9aa3ad').multiplyScalar(lerp(1, 0.18, clamp01(smoothstep(0.1, -0.15, elev))));
    this.zenithColor.lerp(grey, overcast * 0.75);
    this.horizonColor.lerp(grey.multiply(this.mood.tint), overcast * 0.6);
    const night = clamp01(smoothstep(0.1, -0.15, elev));
    this.daylight = clamp01(smoothstep(-0.12, 0.35, elev));

    const u = this.mat.uniforms;
    u.uZenith.value.copy(this.zenithColor);
    u.uHorizon.value.copy(this.horizonColor);
    u.uSunDir.value.copy(trueSun);
    u.uSunColor.value.copy(this.sunColor).multiplyScalar(elev > -0.08 ? 1 : 0.0);
    u.uTime.value += dt;
    u.uCloudCover.value = this.mood.cloudCover;
    u.uOvercast.value = overcast;
    u.uNight.value = night;
    u.uMoonPhase.value = this.moonPhase;
    u.uCloudTint.value.copy(this.mood.cloudTint);

    // Cloud shadows: the ground shades itself per pixel (envCloudSun); a cloud between the camera and
    // the sun dims the sun for everything around it, eased so a passing shadow sweeps over gently.
    const shadow = 0.55 * this.daylight * (1 - overcast) * (elev > 0.02 ? 1 : 0);
    const cam = camera.position;
    const here = this.cloudSunAt(cam.x, cam.y, cam.z, sunDir, this.mood.cloudCover, shadow);
    this.localSun += (here - this.localSun) * (1 - Math.exp(-dt * 1.6));
    const e = envUniforms;
    e.uCloudTex.value = this.noiseTexture;
    e.uCloudShade.value.set(this.cloudOffset.x * CLOUD_FIELD.drift, this.cloudOffset.y * CLOUD_FIELD.drift, this.mood.cloudCover, shadow);
    e.uCloudSunScale.value = this.localSun;

    const p = this.pipeline;
    p.daylight = this.daylight;
    p.sun.color.copy(this.sunColor);
    p.sun.intensity = this.sampleNum(hour, 'sunI') * (1 - this.mood.cloudCover * 0.1) * (1 - overcast * 0.72) * this.localSun;
    this.sample(hour, 'hemiSky', p.hemi.color);
    this.sample(hour, 'hemiGround', p.hemi.groundColor);
    p.hemi.color.lerp(this.c1.set('#b4bcc6').multiplyScalar(lerp(1, 0.3, night)), overcast * 0.5);
    p.hemi.intensity = this.sampleNum(hour, 'hemiI') * (1 + overcast * 0.25);

    // Fog: the horizon colour, warmed toward the sun when looking that way.
    const fog = p.scene.fog as THREE.Fog;
    camera.getWorldDirection(this.camDir);
    const towardSun = Math.max(0, this.camDir.x * trueSun.x + this.camDir.z * trueSun.z) * (1 - night);
    fog.color.copy(this.horizonColor).lerp(this.zenithColor, 0.06).lerp(this.c2.copy(this.sunColor).multiply(this.horizonColor).multiplyScalar(1.4), towardSun * 0.18 * (1 - overcast));
    u.uGround.value.copy(fog.color);
    u.uHaze.value = clamp01((this.mood.fogScale - 1.2) / 4.5) * 0.92;
    fog.far = drawDistance / Math.max(0.3, this.mood.fogScale);
    fog.near = Math.min(fog.far * 0.25, 220 / this.mood.fogScale);

    // Shared environment uniforms.
    e.uSunDir.value.copy(sunDir);
    e.uSunColor.value.copy(this.sunColor).multiplyScalar((elev > -0.05 ? 1 : 0.35) * (1 - overcast * 0.6) * this.localSun);
    e.uSkyZenith.value.copy(this.zenithColor);
    e.uSkyHorizon.value.copy(this.horizonColor);
    e.uDaylight.value = this.daylight;
    const golden = clamp01(1 - Math.abs(elev - 0.12) / 0.3);
    e.envFogSun.value.set(this.sunColor.r * 1.05, this.sunColor.g * 0.97, this.sunColor.b * 0.88, (0.14 + 0.22 * golden) * (1 - night) * (1 - overcast * 0.8));
    e.envFogSunDir.value.copy(trueSun);

    this.dome.position.copy(camera.position);
  }

  /** The cumulus field (texture alpha, 0..1) at world (x, z), bilinear like the GPU's lookup. */
  private cumulusAt(x: number, z: number): number {
    const img = this.noiseTexture.image as { data: Uint8Array; width: number };
    const n = img.width;
    const fx = (x / CLOUD_FIELD.scale + this.cloudOffset.x * CLOUD_FIELD.drift) * n - 0.5;
    const fz = (z / CLOUD_FIELD.scale + this.cloudOffset.y * CLOUD_FIELD.drift) * n - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const at = (i: number, j: number) => img.data[((((j % n) + n) % n) * n + (((i % n) + n) % n)) * 4 + 3] / 255;
    const a = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx;
    const b = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx;
    return a * (1 - tz) + b * tz;
  }

  /** Direct sun reaching (x, y, z) through the cumulus layer: the CPU twin of EnvShared's envCloudSun. */
  cloudSunAt(x: number, y: number, z: number, sun: THREE.Vector3, cover: number, strength: number): number {
    if (strength <= 0) return 1;
    const t = (CLOUD_FIELD.mid - y) / Math.max(sun.y, 0.25);
    const c = this.cumulusAt(x + sun.x * t, z + sun.z * t);
    const thr = CLOUD_FIELD.thr0 - cover * CLOUD_FIELD.thrK;
    const k = clamp01((c - thr) / (1 - thr));
    return 1 - smoothstep(0.04, 0.3, k) * strength;
  }

  /** Sun dimming around the camera from the cloud over it (1 = in the sun). */
  get cloudSun(): number {
    return this.localSun;
  }

  /** Advance cloud drift (called by the weather/wind system). */
  drift(dx: number, dz: number): void {
    this.cloudOffset.x = (this.cloudOffset.x + dx) % 1000;
    this.cloudOffset.y = (this.cloudOffset.y + dz) % 1000;
  }

  dispose(): void {
    this.pipeline.scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.mat.dispose();
    this.noiseTexture.dispose();
  }
}
