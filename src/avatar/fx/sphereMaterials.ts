import * as THREE from 'three';
import { FX_TIME } from '../../vfx/effects/materials';
import { getNoiseTexture } from '../../vfx/effects/noise';

/**
 * Materials of the Elements Sphere, after the series' Sozin's Comet frame: a bubble of whirling air
 * streaked by the wind that circles it, and a broad band of fire racing round the Avatar's waist.
 * They share the effect clock and the tileable noise texture (lookups stay cheap on software
 * WebGL); every factory returns a new material that the caller disposes.
 *
 * Geometry UVs: the air shell uses shellSphere() (uv.x = latitude 0 bottom .. 1 top, uv.y =
 * longitude 0..1); fire slices use uv.x = across the band (0..1) and uv.y = around the ring (0..1).
 * Noise is sampled at whole multiples of the around coordinate, so both close without a seam.
 */

const NOISE = { value: getNoiseTexture() as THREE.Texture };

// ---------------------------------------------------------------------------
// Air shell
// ---------------------------------------------------------------------------

const AIR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const AIR_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSpin;
uniform float uOpacity;
uniform float uInner;
uniform float uWarm;
uniform float uBandY;
uniform float uGust;
uniform vec3 uTint;
uniform vec3 uWarmCol;
varying vec2 vUv;
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
void main() {
  float around = vUv.y;
  float lat = normalize(vP).y;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float rim = 1.0 - facing;
  // The wind circles the Avatar: streaks drawn out along the latitude circles, rippling as they go.
  float wave = 0.06 * sin(around * 12.5663706 + uTime * 0.9) + 0.035 * sin(around * 31.4159265 - uTime * 1.9);
  vec2 q1 = vec2(around * 2.0 - uSpin, (lat + wave) * 3.1 + uInner * 0.37);
  vec2 q2 = vec2(around * 3.0 - uSpin * 1.45 + 0.31, (lat - wave * 0.6) * 5.6 + 0.61);
  vec2 q3 = vec2(around * 5.0 - uSpin * 2.1 + 0.13, lat * 9.0 + 0.23);
  float s1 = texture2D(uNoise, q1).b;
  float s2 = texture2D(uNoise, q2).r;
  float s3 = texture2D(uNoise, q3).a;
  float streak = smoothstep(0.48, 0.86, s1) * 0.85 + smoothstep(0.6, 0.9, s2) * 0.55 + smoothstep(0.66, 0.93, s3) * 0.3 * uGust;
  // Streaks pinch out at the poles, where the air turns about the axis.
  streak *= 1.0 - smoothstep(0.76, 0.97, abs(lat));
  // A clear body that thickens toward the silhouette (a bubble of moving air), streaks over it:
  // thin bright lines with clear gaps, so the Avatar inside stays readable.
  float body = mix(0.012, 0.3, pow(rim, 1.9));
  float a = body + streak * (0.035 + 0.37 * rim);
  vec3 col = mix(uTint, vec3(1.0), clamp(streak * 0.85 + rim * 0.3, 0.0, 1.0));
  // Greyer toward the bottom, brighter where the sky lights the top.
  col *= mix(0.8, 1.04, smoothstep(-0.85, 0.5, lat));
  // Lit warm by the band of fire at the waist.
  float band = exp(-pow((lat - uBandY) * 3.0, 2.0));
  col += uWarmCol * uWarm * band * (0.3 + 0.7 * rim);
  a *= mix(1.0, 0.55, uInner);
  a = clamp(a, 0.0, 0.8) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface AirShellOptions {
  /** The inner (far-side) layer, drawn from the inside: fainter, with its own streak phase. */
  inner?: boolean;
  tint?: THREE.ColorRepresentation;
}

/** Translucent, wind-streaked air shell for shellSphere(); uniforms uSpin / uOpacity / uWarm / uBandY / uGust are driven per frame. */
export function airShellMaterial(o: AirShellOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'elements_sphere_air',
    uniforms: {
      uTime: FX_TIME,
      uNoise: NOISE,
      uSpin: { value: 0 },
      uOpacity: { value: 0 },
      uInner: { value: o.inner ? 1 : 0 },
      uWarm: { value: 0 },
      uBandY: { value: -0.15 },
      uGust: { value: 1 },
      uTint: { value: new THREE.Color(o.tint ?? '#c9d9e6') },
      uWarmCol: { value: new THREE.Color('#ff9a3c') },
    },
    vertexShader: AIR_VERT,
    fragmentShader: AIR_FRAG,
    transparent: true,
    depthWrite: false,
    side: o.inner ? THREE.BackSide : THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------
// Fire band
// ---------------------------------------------------------------------------

const FIRE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const FIRE_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uFlow;
uniform float uOpacity;
uniform float uIntensity;
uniform float uSeed;
uniform float uReveal;
uniform float uRepeat;
uniform float uAcross;
uniform float uGraze;
uniform float uHeat;
uniform float uDensity;
uniform float uFlat;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vFacing;
void main() {
  float around = vUv.y;
  float across = vUv.x;
  // Ignition: the flame races once round the band (uReveal 0 -> past 1).
  float lit = 1.0 - smoothstep(uReveal - 0.05, uReveal, around);
  if (lit <= 0.0) discard;
  // Fire streaming round the ring: a slow warp field curls the fast detail into tongues.
  vec2 w = texture2D(uNoise, vec2(around * uRepeat * 0.5 - uFlow * 0.45, across * uAcross * 0.6 + uSeed + uTime * 0.12)).rg - 0.5;
  vec2 q = vec2(around * uRepeat - uFlow, across * uAcross + uSeed) + w * vec2(0.5, 0.35);
  float n = texture2D(uNoise, q).r * 0.62 + texture2D(uNoise, q * vec2(2.0, 2.2) + 0.5).g * 0.38;
  float prof = 1.0 - abs(across * 2.0 - 1.0);
  // Sheets are flat-topped (a solid ring of flame from above), walls peak along their middle.
  prof = mix(prof, smoothstep(0.0, 0.4, prof), uFlat);
  float f = prof * 1.75 - (1.0 - n) * (0.3 + (1.0 - prof) * 0.85);
  // Slices seen edge-on fade instead of collapsing into one bright line.
  f *= mix(1.0 - uGraze, 1.0, smoothstep(0.0, 0.45, vFacing));
  float a = smoothstep(0.03, 0.3, f) * uDensity * uOpacity * lit;
  if (a < 0.003) discard;
  float flick = 0.92 + 0.08 * sin(uTime * 23.0 + uSeed * 5.0 + n * 7.0);
  float temp = f * 1.05 + uHeat;
  vec3 col = mix(uEdge * 0.5, uEdge, smoothstep(0.02, 0.22, temp));
  col = mix(col, uMid, smoothstep(0.22, 0.6, temp));
  col = mix(col, uCore, smoothstep(0.75, 1.25, temp));
  // The ignition front burns white-hot as it runs.
  float head = smoothstep(uReveal - 0.07, uReveal - 0.005, around) * step(around, uReveal) * (1.0 - step(1.0, uReveal));
  col += uCore * head * 1.2;
  gl_FragColor = vec4(col * uIntensity * flick, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface FireBandOptions {
  seed?: number;
  /** Whole number of noise periods round the ring (even, so the warp closes too). */
  repeat?: number;
  /** Noise periods across the slice (walls ~1; wide sheets more, so tongues stream along the ring). */
  across?: number;
  /** How much the slice fades when seen edge-on (0..1; flat sheets ~1). */
  graze?: number;
  intensity?: number;
  /**
   * 'normal' (default): the flame body: the nearest slice shows, so the band stays saturated
   * orange and yellow with ragged red edges. 'add': the hot core glowing through it.
   */
  blend?: 'normal' | 'add';
  /** Shifts the colour ramp hotter (core slices). */
  heat?: number;
  /** Alpha scale. */
  density?: number;
  /** Flat-topped profile across the slice (sheets: 1). */
  flat?: number;
}

/** Flame for one slice of the fire band (wall or sheet); uFlow / uOpacity / uReveal are driven per frame. */
export function fireBandMaterial(o: FireBandOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'elements_sphere_fire',
    uniforms: {
      uTime: FX_TIME,
      uNoise: NOISE,
      uFlow: { value: 0 },
      uOpacity: { value: 0 },
      uIntensity: { value: o.intensity ?? 0.5 },
      uSeed: { value: o.seed ?? Math.random() * 10 },
      uReveal: { value: 0 },
      uRepeat: { value: o.repeat ?? 8 },
      uAcross: { value: o.across ?? 0.95 },
      uGraze: { value: o.graze ?? 0.45 },
      uHeat: { value: o.heat ?? 0 },
      uDensity: { value: o.density ?? 0.9 },
      uFlat: { value: o.flat ?? 0 },
      uCore: { value: new THREE.Color('#ffe066') },
      uMid: { value: new THREE.Color('#ff9a1c') },
      uEdge: { value: new THREE.Color('#d0300a') },
    },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: o.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Vertical cylindrical slice of the fire band, centred on y = 0: uv.x = up (across), uv.y = around. */
export function bandWall(radius: number, height: number, seg: number, rows = 2): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = u * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      pos.push(c * radius, (v - 0.5) * height, s * radius);
      nrm.push(c, 0, s);
      uv.push(v, u);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Horizontal sheet of the fire band (annulus in the XZ plane): uv.x = inner -> outer (across), uv.y = around. */
export function bandSheet(inner: number, outer: number, seg: number, rows = 3): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = u * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const r = inner + (outer - inner) * v;
      pos.push(c * r, 0, s * r);
      nrm.push(0, 1, 0);
      uv.push(v, u);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Closed tube on a circle of `radius` in the XZ plane (the water ring): uv.x = around the tube, uv.y = metres along. */
export function ringTube(radius: number, tube: number, segs: number, radial: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 48;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, tube, radial, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const len = curve.getLength();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, v, u * len);
  }
  g.computeBoundingSphere();
  return g;
}
