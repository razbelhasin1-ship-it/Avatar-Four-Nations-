/** The hero painting: one full-screen pass (GLSL ES 3.00). */
export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uScroll;
uniform sampler2D uRidges;
uniform vec4 uWeights;

uniform vec3 uSkyTop, uSkyMid, uSkyHorizon;
uniform vec2 uSunPos;
uniform float uSunSize, uSunGlow, uMoon;
uniform vec3 uSunColor;
uniform float uStars, uAurora, uClouds, uRays, uCloudSea, uWater, uGlitter;
uniform vec3 uCloudLit, uCloudShade, uWaterDeep;
uniform vec3 uMtnNear, uMtnFar, uFog, uRim;
uniform float uMist, uSnow, uLava, uRimStrength;
uniform vec3 uPColor;
uniform vec2 uPVel;
uniform float uPSize, uPStretch, uPGlow, uPDensity, uPFlicker, uPSwirl;
uniform float uLanterns, uExposure, uIntro;
uniform vec4 uRipples[8];

out vec4 outColor;

float aspect;
float yH;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * noise(p);
    p = p * 2.03 + vec2(17.13, 3.71);
    a *= 0.5;
  }
  return s;
}

// --------------------------------------------------------------------------------------------
// Sky: gradient, sun or moon, stars, aurora, clouds, rays.
// --------------------------------------------------------------------------------------------
vec3 sky(vec2 uv, bool cheap) {
  float h = clamp((uv.y - yH) / (1.0 - yH), 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.42, h));
  c = mix(c, uSkyTop, smoothstep(0.32, 1.0, h));

  vec2 d = (uv - uSunPos) * vec2(aspect, 1.0);
  float r = length(d);
  // Glow around the disk and along the horizon beneath it.
  c += uSunColor * uSunGlow * (0.55 * exp(-r * 3.2) + 0.5 * exp(-r * 11.0));
  c += uSunColor * uSunGlow * 0.32 * exp(-abs(uv.y - yH) * 9.0) * exp(-abs(d.x) * 1.4);

  // Stars (two depths), only in the upper sky.
  if (uStars > 0.01) {
    float starMask = smoothstep(yH + 0.06, yH + 0.5, uv.y) * uStars;
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 120.0 : 260.0;
      vec2 sp = uv * vec2(aspect, 1.0) * sc;
      vec2 id = floor(sp);
      vec2 f = fract(sp) - 0.5;
      float rnd = hash12(id + float(k) * 31.0);
      if (rnd > (k == 0 ? 0.975 : 0.94)) {
        vec2 o = vec2(hash12(id + 7.0), hash12(id + 3.0)) - 0.5;
        float s = smoothstep(k == 0 ? 0.16 : 0.1, 0.0, length(f - o * 0.6));
        s *= 0.55 + 0.45 * sin(uTime * (0.8 + rnd * 2.5) + rnd * 60.0);
        c += vec3(0.85, 0.92, 1.0) * s * starMask * (k == 0 ? 1.1 : 0.55);
      }
    }
  }

  // Aurora curtains (the polar night).
  if (uAurora > 0.01 && !cheap) {
    float x = uv.x * aspect;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float y0 = 0.6 + fi * 0.07 + 0.05 * sin(x * (1.1 + fi * 0.3) + uTime * 0.05 * (1.0 + fi) + fi * 2.3);
      y0 += 0.05 * (noise(vec2(x * 1.6 + fi * 9.0, uTime * 0.06)) - 0.5);
      float dy = uv.y - y0;
      float curtain = smoothstep(-0.012, 0.004, dy) * exp(-max(dy, 0.0) * (7.0 + fi * 2.0));
      float streak = 0.55 + 0.45 * noise(vec2(x * 38.0 + fi * 13.0, uTime * 0.35));
      float fade = smoothstep(0.0, 0.3, noise(vec2(x * 0.9 - uTime * 0.03, fi * 4.0)));
      vec3 col = mix(vec3(0.18, 1.0, 0.62), vec3(0.42, 0.42, 1.0), clamp(dy * 6.0, 0.0, 1.0));
      acc += col * curtain * streak * fade * (0.5 - fi * 0.1);
    }
    c += acc * uAurora * smoothstep(yH + 0.05, yH + 0.3, uv.y);
  }

  // The disk itself.
  float disk = smoothstep(uSunSize, uSunSize * 0.965, r);
  if (disk > 0.0) {
    vec2 m = d / uSunSize;
    float craters = fbm(m * 2.6 + 3.0, 4);
    vec3 moonCol = uSunColor * (0.82 + 0.3 * craters) - vec3(0.06) * smoothstep(0.55, 0.75, fbm(m * 5.0, 3));
    vec3 sunCol = mix(uSunColor * 1.35, vec3(1.0, 0.98, 0.9), 0.35 * (1.0 - length(m)));
    c = mix(c, mix(sunCol, moonCol, uMoon), disk);
  }

  // Sun rays through the haze.
  if (uRays > 0.01 && !cheap) {
    float ang = atan(d.y, d.x);
    float ray = noise(vec2(ang * 9.0, uTime * 0.04)) * noise(vec2(ang * 23.0 + 4.0, uTime * 0.07));
    c += uSunColor * pow(ray, 2.0) * exp(-r * 2.2) * uRays * 0.9 * smoothstep(uSunSize, uSunSize * 2.5, r);
  }

  // Drifting cloud banks, lit from the sun's side.
  if (uClouds > 0.01) {
    vec2 cp = vec2(uv.x * aspect * 1.7 + uTime * 0.006, uv.y * 7.0);
    float n = fbm(cp, cheap ? 2 : 4);
    float band = smoothstep(yH + 0.03, yH + 0.22, uv.y) * smoothstep(0.98, 0.6, uv.y);
    float cl = smoothstep(0.52, 0.8, n) * band * uClouds;
    float lit = clamp(0.5 + 0.8 * (fbm(cp + vec2(-0.15, 0.08), 2) - n) + 0.5 * exp(-r * 2.5), 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    c = mix(c, cc, cl * 0.85);
  }
  return c;
}

// --------------------------------------------------------------------------------------------
// Mountains: four layers from the ridge texture, ink-wash shading, mist, snow, lava, rim light.
// --------------------------------------------------------------------------------------------
const float BASE[4] = float[4](0.0, -0.02, -0.06, -0.11);
const float AMP[4] = float[4](0.34, 0.3, 0.24, 0.2);
const float PAR[4] = float[4](0.008, 0.018, 0.034, 0.06);
const float FOGL[4] = float[4](0.74, 0.52, 0.3, 0.1);
const float SCL[4] = float[4](1.0, 0.95, 0.9, 0.85);
const float SCR[4] = float[4](0.04, 0.08, 0.14, 0.24);

vec3 landscape(vec2 uv, vec3 c, bool cheap, out float solid) {
  solid = 0.0;
  float zoom = clamp(1.0 / aspect, 1.0, 1.9);
  float sx = (uv.x - 0.5) * aspect * zoom;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float u = 0.5 + sx * SCL[i] * 0.5 + uMouse.x * PAR[i];
    float hv = dot(texture(uRidges, vec2(u, (fi + 0.5) / 4.0)), uWeights);
    float base = yH + BASE[i] - uScroll * SCR[i];
    float top = base + hv * AMP[i] + uMouse.y * PAR[i] * 0.5;
    // A little brush texture along the ridge line.
    if (!cheap) top += (noise(vec2(u * (260.0 + fi * 120.0), fi * 7.0)) - 0.5) * 0.004 * (1.0 + fi);
    float aa = 1.5 / uRes.y;
    float inside = smoothstep(top + aa, top - aa, uv.y);
    // The three far layers stand behind the sea and end at the horizon; the near headlands come
    // down in front of it to the bottom of the frame.
    if (i < 3) inside *= smoothstep(yH - aa, yH + aa, uv.y);
    // Where a layer has no height there is no land (the sea or clouds show through).
    inside *= smoothstep(0.012, 0.03, hv);
    if (inside <= 0.0) continue;

    float below = top - uv.y;
    vec3 col = mix(uMtnNear, uMtnFar, FOGL[i]);
    // Ink-wash: a darker stroke along the ridge, then a wash that fades into the mist below.
    col *= 1.0 - 0.32 * exp(-below * 70.0) * (1.0 - FOGL[i] * 0.6);
    float wash = noise(vec2(u * 16.0 + fi * 3.0, uv.y * 24.0 + fi));
    col *= 0.92 + 0.12 * wash;
    // Snow on the high peaks.
    float snow = uSnow * smoothstep(0.5, 0.85, hv) * smoothstep(AMP[i] * 0.2 * hv, 0.0, below + (wash - 0.5) * 0.02);
    col = mix(col, mix(vec3(0.92, 0.96, 1.0), uFog, FOGL[i] * 0.7), snow * 0.85);
    // Light catching the ridges toward the sun.
    float toward = exp(-abs(uv.x - uSunPos.x) * 2.2);
    col += uRim * uRimStrength * exp(-below * 160.0) * (0.35 + 0.65 * toward) * (1.0 - FOGL[i] * 0.5);
    // Lava: glowing crater rims and seams on the volcanoes (the fire mood).
    if (uLava > 0.01 && i == 1) {
      float crater = smoothstep(0.86, 0.98, hv) * exp(-below * 26.0);
      float seams = smoothstep(0.93, 1.0, noise(vec2(u * 420.0, uv.y * 14.0))) * smoothstep(0.55, 0.9, hv) * smoothstep(0.0, 0.08, below);
      col += vec3(1.0, 0.36, 0.08) * uLava * (crater * 1.6 + seams * 0.8);
    }
    // Mist rising from each layer's base.
    float mist = smoothstep(top - AMP[i] * 0.15, base - 0.03, uv.y);
    col = mix(col, uFog, clamp(mist * uMist + FOGL[i] * 0.55, 0.0, 1.0));
    c = mix(c, col, inside);
    solid = max(solid, inside);

    // Mist drifting between the layers.
    if (!cheap) {
      float m = fbm(vec2(uv.x * aspect * 2.2 + uTime * 0.012 * (1.0 + fi), uv.y * 16.0 - uTime * 0.01), 3);
      float band = exp(-pow((uv.y - (base + 0.025)) * 22.0, 2.0));
      c = mix(c, uFog, band * smoothstep(0.35, 0.8, m) * uMist * 0.75);
    }
  }
  return c;
}

vec3 above(vec2 uv, bool cheap) {
  vec3 c = sky(uv, cheap);
  float solid;
  c = landscape(uv, c, cheap, solid);
  return c;
}

// --------------------------------------------------------------------------------------------
// Water (reflective sea with glitter and cursor ripples) and the sea of clouds.
// --------------------------------------------------------------------------------------------
vec2 rippleField(vec2 uv, out float crest) {
  vec2 disp = vec2(0.0);
  crest = 0.0;
  for (int k = 0; k < 8; k++) {
    vec4 R = uRipples[k];
    if (R.w <= 0.0) continue;
    float age = uTime - R.z;
    if (age < 0.0 || age > 7.0) continue;
    vec2 dd = (uv - R.xy) * vec2(aspect, 3.0);
    float dist = length(dd);
    float rr = age * 0.11;
    float env = exp(-pow((dist - rr) * 26.0, 2.0)) * exp(-age * 0.75) * R.w;
    float wave = sin((dist - rr) * 150.0);
    disp += (dist > 1e-4 ? dd / dist : vec2(0.0)) * env * wave * 0.012;
    crest += env * max(wave, 0.0);
  }
  return disp;
}

vec3 water(vec2 uv) {
  float depth = yH - uv.y;
  float z = 1.0 / (depth + 0.025);
  float wx = (uv.x - 0.5) * aspect * z * 0.35;
  float n1 = noise(vec2(wx * 5.0 + uTime * 0.1, z * 1.1 - uTime * 0.35));
  float n2 = noise(vec2(wx * 9.0 - uTime * 0.15, z * 2.3 + uTime * 0.2));
  float crest;
  vec2 rip = rippleField(uv, crest);
  vec2 ruv = vec2(uv.x + (n1 - 0.5) * 0.012 * (0.4 + depth) + rip.x, yH + depth + (n2 - 0.5) * 0.028 * (depth + 0.02) + rip.y);
  vec3 refl = above(ruv, true);
  float fres = mix(0.4, 0.97, pow(1.0 - clamp(depth / max(yH, 0.01), 0.0, 1.0), 2.4));
  vec3 c = mix(uWaterDeep, refl * 0.86, fres);

  // A path of light beneath the sun or moon.
  float gx = (uv.x - uSunPos.x) * aspect;
  float w = 0.025 + depth * 0.55;
  float path = exp(-gx * gx / (w * w));
  float sp = noise(vec2(wx * 38.0, z * 9.0 - uTime * 1.3)) * noise(vec2(wx * 61.0 + 3.0, z * 14.0 + uTime * 0.9));
  c += uSunColor * path * (0.12 + pow(sp, 3.0) * 14.0) * uGlitter * smoothstep(0.0, 0.02, depth);
  c += mix(uSkyHorizon, vec3(1.0), 0.5) * crest * 0.22;
  // Darker toward the viewer.
  c *= 1.0 - 0.35 * smoothstep(0.0, yH, depth);
  return c;
}

vec3 cloudSea(vec2 uv, vec3 c) {
  float crest;
  vec2 rip = rippleField(uv, crest);
  vec2 q = uv + rip * 1.5;
  float n = fbm(vec2(q.x * aspect * 3.0 + uTime * 0.01, q.y * 9.0 - uTime * 0.015), 4);
  float top = yH + 0.035 + (n - 0.5) * 0.07;
  float inside = smoothstep(top + 0.012, top - 0.035, q.y);
  float body = clamp((top - q.y) / 0.25, 0.0, 1.0);
  float lit = 0.55 + 0.6 * (fbm(vec2(q.x * aspect * 3.0 + 0.2 + uTime * 0.01, q.y * 9.0 + 0.15), 3) - n);
  lit += 0.4 * exp(-abs(q.x - uSunPos.x) * aspect * 1.5) * (1.0 - body);
  vec3 cc = mix(uCloudShade, uCloudLit * 1.06, clamp(lit - body * 0.45, 0.0, 1.0));
  cc += vec3(1.0) * crest * 0.18;
  // Thin wisps above the sea.
  float wisp = smoothstep(0.55, 0.8, fbm(vec2(q.x * aspect * 5.0 - uTime * 0.02, q.y * 30.0), 3)) * exp(-max(q.y - top, 0.0) * 30.0) * 0.5;
  c = mix(c, cc, clamp(inside + wisp, 0.0, 1.0) * uCloudSea);
  return c;
}

// --------------------------------------------------------------------------------------------
// Particles (snow, seeds, embers, wind) and lanterns.
// --------------------------------------------------------------------------------------------
vec3 particles(vec2 uv) {
  vec3 acc = vec3(0.0);
  vec2 vdir = normalize(uPVel + vec2(1e-4));
  vec2 perp = vec2(-vdir.y, vdir.x);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = 9.0 + fl * 7.0;
    vec2 p = uv * vec2(aspect, 1.0) * scale - uPVel * uTime * scale * (0.7 + fl * 0.35);
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float r = hash12(id + fl * 17.0);
    if (r > uPDensity) continue;
    vec2 o = vec2(hash12(id + 1.3), hash12(id + 7.1)) - 0.5;
    o += 0.22 * uPSwirl * vec2(sin(uTime * (0.6 + r) + r * 20.0), cos(uTime * (0.45 + r) + r * 11.0));
    vec2 d = f - o * 0.7;
    float along = dot(d, vdir) / (1.0 + uPStretch);
    float across = dot(d, perp);
    float dist = length(vec2(along, across));
    float size = uPSize * (0.45 + r * 0.8) * (1.0 - fl * 0.18);
    float a = smoothstep(size, size * 0.2, dist);
    float glow = exp(-dist * dist / (size * size * 8.0)) * uPGlow;
    float flick = mix(1.0, 0.45 + 0.55 * sin(uTime * (5.0 + r * 9.0) + r * 40.0), uPFlicker);
    acc += uPColor * (a + glow) * flick * (0.32 + fl * 0.28);
  }
  return acc;
}

vec3 lanterns(vec2 uv) {
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float scale = 5.0 + fl * 4.0;
    vec2 p = uv * vec2(aspect, 1.0) * scale;
    p.y -= uTime * (0.05 + fl * 0.03) * scale * 0.3;
    p.x += sin(uTime * 0.2 + p.y * 0.5) * 0.15;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float r = hash12(id + 91.0 + fl * 13.0);
    if (r > 0.22) continue;
    vec2 o = (vec2(hash12(id + 5.0), hash12(id + 9.0)) - 0.5) * 0.6;
    vec2 d = (f - o) * vec2(1.0, 0.78);
    float s = 0.05 / (1.0 + fl * 0.6);
    float body = smoothstep(s, s * 0.6, length(d));
    float halo = exp(-dot(d, d) / (s * s * 9.0));
    float flick = 0.85 + 0.15 * sin(uTime * (3.0 + r * 5.0) + r * 30.0);
    acc += vec3(1.0, 0.55, 0.2) * (body * 1.4 + halo * 0.6) * flick * (0.7 - fl * 0.25);
  }
  return acc * uLanterns * smoothstep(yH - 0.05, yH + 0.15, uv.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  aspect = uRes.x / uRes.y;
  yH = 0.34 - uScroll * 0.1 + uMouse.y * 0.006;

  vec3 c;
  if (uv.y >= yH) {
    c = above(uv, false);
  } else {
    // Under the horizon: the sea (water moods) or the sea of clouds (air), plus near headlands.
    vec3 sea = uWater > 0.001 ? water(uv) : uWaterDeep;
    vec3 under = mix(uWaterDeep, sea, uWater);
    float solid;
    under = landscape(uv, under, false, solid);
    c = under;
  }
  if (uCloudSea > 0.001) c = cloudSea(uv, c);
  c += particles(uv);
  if (uLanterns > 0.001) c += lanterns(uv);

  // Painterly finish: exposure, gentle tone curve, vignette, grain, and the intro fade.
  c *= uExposure;
  c = c / (1.0 + 0.18 * c);
  float vig = smoothstep(1.35, 0.35, length((uv - vec2(0.5, 0.55)) * vec2(aspect * 0.85, 1.0)));
  c *= mix(0.68, 1.0, vig);
  c += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * 0.028;
  c *= uIntro;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
