import * as THREE from 'three';
import { FX_TIME } from '../../vfx/effects/materials';
import { getNoiseTexture } from '../../vfx/effects/noise';

/**
 * Materials of the Elements Sphere, after the series' Sozin's Comet frame: a bubble of whirling air
 * streaked by the wind that circles it, and a broad band of fire racing round the Avatar's waist.
 * They share the effect clock and the tileable noise texture (lookups stay cheap on software
 * WebGL); every factory returns a new material that the caller disposes.
 *
 * The air shell uses shellSphere() (uv.x = latitude 0 bottom .. 1 top, uv.y = longitude 0..1) and
 * samples the noise at whole multiples of the longitude, so it closes without a seam. The fire is
 * not a surface: it is a ring of tongues of flame, each a camera-facing ribbon bent along its own
 * arc of the ring, so it reads as fire from every angle (a whirl from above, a blaze from the side).
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
  // Streaks pinch out right at the poles, where the air turns about the axis (from above: a whirl).
  streak *= 1.0 - smoothstep(0.86, 0.995, abs(lat));
  // A clear body that thickens toward the silhouette (a bubble of moving air), streaks over it:
  // thin bright lines with clear gaps, so the Avatar inside stays readable.
  float body = mix(0.045, 0.32, pow(rim, 1.7));
  float a = body + streak * (0.1 + 0.34 * rim);
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
// Fire band: tongues of flame racing round the Avatar
// ---------------------------------------------------------------------------

const FLAME_VERT = /* glsl */ `
attribute vec4 aOrbit; // base angle (rad), radius (m), height (m), angular speed (rad/s)
attribute vec4 aShape; // arc length (m), width (m), seed (0..1), heat
attribute vec4 aLife;  // cycle (s), phase (0..1), occlusion (0 glow .. 1 covers), alpha
uniform float uClock;
uniform float uSpin;
uniform float uSize;
uniform float uReveal;
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
varying float vSeed;
varying float vOcc;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  // Each tongue burns for one cycle, then is reborn elsewhere on the band (unseen at the switch).
  float cyc = uClock / aLife.x + aLife.y;
  float gen = floor(cyc);
  float ph = cyc - gen;
  float g = mod(gen, 997.0);
  float h1 = hash(g * 12.9898 + aShape.z * 78.233);
  float h2 = hash(g * 39.3468 + aShape.z * 11.1351);
  float dir = sign(aOrbit.w);
  float rad = aOrbit.y * (0.9 + 0.2 * h2);
  // A ribbon bent along the ring: the head leads, the tail trails round behind it (position.x:
  // -1 tail .. 1 head), so from above the band is a whirl of curved streaks and from the side a
  // long horizontal blaze.
  float head = aOrbit.x + h1 * 6.2831853 + uSpin * aOrbit.w;
  float span = min(1.4, aShape.x / rad);
  float s = position.x;
  float ang = head - dir * span * (1.0 - s) * 0.5;
  // Licking up and down along its length as it runs (the band's ragged top and bottom).
  float y = aOrbit.z * (0.6 + 0.8 * h2) + 0.035 * sin(uClock * 2.6 + aShape.z * 37.0) + 0.05 * (1.0 - s) * h2
    + 0.08 * (0.5 + h2) * sin(s * 2.4 + aShape.z * 19.0 + uClock * 3.1);
  vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
  vec3 tangent = vec3(-sin(ang), 0.0, cos(ang)) * dir;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tv = (modelViewMatrix * vec4(tangent, 0.0)).xyz;
  // Widen across the motion as the screen sees it (perspective-correct).
  vec2 sd = tv.xy * (-mv.z) + mv.xy * tv.z;
  float sdl = length(sd);
  vec2 ax = sdl > 1e-6 ? sd / sdl : vec2(1.0, 0.0);
  mv.xy += vec2(-ax.y, ax.x) * position.y * 0.5 * aShape.y * uSize;
  gl_Position = projectionMatrix * mv;
  vUv = vec2(s, position.y);
  // Lit by the ignition racing round from +X; its front burns white-hot.
  float around = fract(head / 6.2831853);
  float lit = 1.0 - smoothstep(uReveal - 0.04, uReveal, around);
  float front = uReveal < 1.0 ? smoothstep(uReveal - 0.16, uReveal - 0.02, around) : 0.0;
  vAlpha = aLife.w * smoothstep(0.0, 0.22, ph) * (1.0 - smoothstep(0.62, 1.0, ph)) * lit;
  vHeat = aShape.w + 0.5 * front;
  vSeed = aShape.z * 7.31 + g * 0.173;
  vOcc = aLife.z;
}`;

const FLAME_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uClock;
uniform float uOpacity;
uniform float uIntensity;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
varying float vSeed;
varying float vOcc;
void main() {
  float x = vUv.x;
  float y = vUv.y;
  // A tongue of flame: full and round at its head (+x), drawn out thin toward the tail.
  float w = mix(0.25, 1.0, smoothstep(-1.0, 0.35, x));
  float hx = max(0.0, x - 0.55) / 0.45;
  float shape = 1.0 - (y * y) / (w * w) - hx * hx;
  shape *= smoothstep(-1.0, -0.25, x);
  if (shape <= 0.0) discard;
  // Turbulence streaming back from the head along the tongue.
  vec2 q = vec2(x * 0.35 - uClock * 0.8 + vSeed, y * 0.3 + vSeed * 1.7);
  vec2 warp = texture2D(uNoise, q * 0.5 + 0.13).gb - 0.5;
  float n = texture2D(uNoise, q + warp * 0.35).r * 0.7 + texture2D(uNoise, q * vec2(2.3, 2.8) + 0.37).a * 0.3;
  float f = shape * 1.35 - (1.0 - n) * (0.45 + 0.65 * (1.0 - shape));
  float a = smoothstep(0.0, 0.45, f) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  // Red at the ragged edges, orange and yellow inside, white-hot through the core.
  float t = vHeat * (0.25 + 1.0 * clamp(f, 0.0, 1.0)) + 0.12 * smoothstep(0.1, 0.8, x);
  vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.3, t));
  col = mix(col, uC2, smoothstep(0.25, 0.55, t));
  col = mix(col, uC3, smoothstep(0.55, 0.85, t));
  col = mix(col, uC4, smoothstep(0.9, 1.25, t));
  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Premultiplied: adds its light and covers what is behind by vOcc (0 = pure glow), so overlapping
  // tongues build a blazing core without the order of drawing showing.
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * vOcc * smoothstep(0.15, 0.7, f));
}`;

/** Flame material for flameRingGeometry(); uClock / uSpin / uSize / uReveal / uOpacity / uIntensity are driven per frame. */
export function flameRingMaterial(intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'elements_sphere_flames',
    uniforms: {
      uNoise: NOISE,
      uClock: { value: 0 },
      uSpin: { value: 0 },
      uSize: { value: 1 },
      uReveal: { value: 0 },
      uOpacity: { value: 0 },
      uIntensity: { value: intensity },
      uC0: { value: new THREE.Color('#7a1a06') },
      uC1: { value: new THREE.Color('#e0400e') },
      uC2: { value: new THREE.Color('#ff8c1a') },
      uC3: { value: new THREE.Color('#ffc93a') },
      uC4: { value: new THREE.Color('#fff2c0') },
    },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
}

/** One layer of the fire band: tongues of flame orbiting the vertical axis in a ring. */
export interface FlameRingSpec {
  count: number;
  /** Radii (m) the tongues span; densest through the middle. */
  inner: number;
  outer: number;
  /** Vertical scatter (m) at the middle radius (thinner toward the band's edges). */
  spread: number;
  /** Arc length (m) each tongue trails round the ring. */
  length: readonly [number, number];
  width: readonly [number, number];
  /** Colour heat: ~0.5 orange, ~1 yellow, past 1 white-hot. */
  heat: readonly [number, number];
  alpha: readonly [number, number];
  /** 0 = pure glow (adds light) .. 1 = covers what is behind. */
  occlusion: number;
  /** Angular speed at 1 m (rad/s); slower further out. */
  speed: number;
  /** Seconds each tongue burns before it is reborn elsewhere. */
  cycle: readonly [number, number];
  seed: number;
}

/** Instanced camera-facing ribbons (one per tongue) for flameRingMaterial(): deterministic per spec. */
export function flameRingGeometry(s: FlameRingSpec): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  // A strip along the tongue (x: -1 tail .. 1 head), bent along the ring in the vertex shader.
  const SEG = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) pos.push((i / SEG) * 2 - 1, -1, 0, (i / SEG) * 2 - 1, 1, 0);
  for (let i = 0; i < SEG; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const orbit = new Float32Array(s.count * 4);
  const shape = new Float32Array(s.count * 4);
  const life = new Float32Array(s.count * 4);
  let state = (Math.floor(s.seed * 7919) % 2147483646) + 1;
  const rnd = (): number => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const range = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rnd();
  for (let i = 0; i < s.count; i++) {
    const u = rnd() * 0.6 + (rnd() + rnd()) * 0.2;
    const r = s.inner + (s.outer - s.inner) * u;
    const mid = 1 - Math.abs(u * 2 - 1);
    const gauss = (rnd() + rnd() + rnd() - 1.5) / 1.5;
    orbit[i * 4] = ((i + rnd()) / s.count) * Math.PI * 2;
    orbit[i * 4 + 1] = r;
    orbit[i * 4 + 2] = gauss * s.spread * (0.45 + 0.55 * mid);
    orbit[i * 4 + 3] = (s.speed / Math.sqrt(r)) * (0.85 + 0.3 * rnd());
    shape[i * 4] = range(s.length) * (0.8 + 0.3 * (r / s.outer));
    shape[i * 4 + 1] = range(s.width) * (0.8 + 0.2 * mid);
    shape[i * 4 + 2] = rnd();
    shape[i * 4 + 3] = range(s.heat) * (0.7 + 0.3 * mid);
    life[i * 4] = range(s.cycle);
    life[i * 4 + 1] = rnd();
    life[i * 4 + 2] = s.occlusion;
    life[i * 4 + 3] = range(s.alpha) * (0.75 + 0.25 * mid);
  }
  g.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
  g.setAttribute('aLife', new THREE.InstancedBufferAttribute(life, 4));
  g.instanceCount = s.count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), s.outer * 1.1 + s.width[1]);
  return g;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

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
