import * as THREE from 'three';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from './env/EnvShared';
import { Field, pfbm, worley } from './env/ProcTex';
import { getLakeRuntime, getRiverRuntime, MARSH, type RiverFall } from './Heightfield';
import { ICE_TOP } from './Terrain';
import { SEA_LEVEL } from './WorldLayout';

/**
 * Water surfaces: ocean (camera-centred radial grid), rivers (ribbons along
 * carved channels with rapids and waterfalls), lakes/ponds, the swamp marsh
 * and a steaming hot spring. Frozen water uses an ice slab material. All
 * surfaces read terrain depth from the world height texture for depth colour,
 * soft shorelines and foam. Water *sources* for bending are registered
 * separately by the WaterSourceSystem using the same Heightfield runtime data.
 */

const waterVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
uniform float uWaveAmp;
uniform float uWaveScale;
attribute float rapid;
attribute float fall;
varying vec3 vWorld;
varying vec2 vUv;
varying float vRapid;
varying float vFall;
varying float vLevel;
varying vec3 vWaveN;
varying float vCrest;
// Directional waves: (dir.xy, wavelength, steepness)
vec3 waveSum(vec2 p, float t, float spacing, out vec3 n) {
  vec4 W[4];
  W[0] = vec4(0.83, 0.55, 38.0, 0.45);
  W[1] = vec4(0.32, 0.95, 21.0, 0.35);
  W[2] = vec4(-0.6, 0.8, 13.0, 0.3);
  W[3] = vec4(0.97, -0.25, 8.0, 0.22);
  vec3 o = vec3(0.0);
  vec3 g = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float k = 6.2831 / (W[i].z * uWaveScale);
    float c = sqrt(9.8 / k);
    vec2 d = W[i].xy;
    float f = k * (dot(d, p) - c * t * 0.55);
    // Fade waves the mesh can't resolve (prevents aliasing far from the camera).
    float a = W[i].w / k * smoothstep(2.0 * spacing, 4.0 * spacing, W[i].z * uWaveScale);
    o.xz += d * a * cos(f) * 0.6;
    o.y += a * sin(f);
    g.xz += d * k * a * cos(f);
  }
  n = normalize(vec3(-g.x, 1.0, -g.z));
  return o;
}
void main() {
  vUv = uv;
  vRapid = rapid;
  vFall = fall;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vLevel = wp.y;
  float ground = envTerrainHeight(wp.xz);
  float depth = wp.y - ground;
  float damp = smoothstep(0.0, 4.0, depth) * (1.0 - fall);
  vec3 wn;
  float camD = length(wp.xz - cameraPosition.xz);
  vec3 wv = waveSum(wp.xz, uEnvTime, max(0.5, camD * 0.11), wn) * uWaveAmp * damp;
  wp.xyz += wv;
  vWaveN = normalize(mix(vec3(0.0, 1.0, 0.0), wn, uWaveAmp * damp));
  vCrest = clamp(wv.y / max(uWaveAmp * 0.5, 0.001), 0.0, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const waterFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uAbsorb;
uniform float uOpacity;
uniform float uFlowSpeed;
uniform float uFoam;
uniform float uMarsh;
uniform float uHot;
uniform float uFarOpaque;
uniform sampler2D uWaterTex;
varying vec3 vWorld;
varying vec2 vUv;
varying float vRapid;
varying float vFall;
varying float vLevel;
varying vec3 vWaveN;
varying float vCrest;
void main() {
  vec2 p = vWorld.xz;
  float t = uEnvTime;
  float ground = envTerrainHeight(p);
  float depth = max(0.0, vLevel - ground);
  float camDist = length(cameraPosition - vWorld);
  // Detail normals: two drifting ripple layers from the water texture (+ flow-aligned for rivers).
  vec4 n1 = texture2D(uWaterTex, p * 0.031 + vec2(t * 0.011, t * 0.007));
  vec4 n2 = texture2D(uWaterTex, p * 0.097 - vec2(t * 0.019, -t * 0.015));
  vec2 g = (n1.rg - 0.5) * 1.1 + (n2.rg - 0.5) * 0.7;
  float flowSpd = uFlowSpeed * (1.0 + vRapid * 2.2 + vFall * 4.0);
  vec4 n3 = vec4(0.5);
  if (uFlowSpeed > 0.0) {
    n3 = texture2D(uWaterTex, vec2(vUv.x * 0.45, vUv.y * 0.09 - t * flowSpd * 0.09));
    g += (n3.rg - 0.5) * (1.0 + vRapid * 1.5);
  }
  float detailFade = smoothstep(260.0, 20.0, camDist);
  vec3 n = normalize(vWaveN + vec3(-g.x, 0.0, -g.y) * 0.2 * detailFade);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Depth colour: shallow turquoise -> deep blue (polar seas run colder).
  float polar = max(smoothstep(-1120.0, -1220.0, p.y), smoothstep(1470.0, 1560.0, p.y) * smoothstep(-330.0, -230.0, p.x) * smoothstep(780.0, 680.0, p.x));
  vec3 deep = mix(uDeep, vec3(0.02, 0.09, 0.16), polar * (1.0 - uMarsh));
  vec3 shallow = mix(uShallow, vec3(0.2, 0.42, 0.48), polar * (1.0 - uMarsh));
  float dk = 1.0 - exp(-depth * uAbsorb);
  vec3 body = mix(shallow, deep, dk);
  // Sub-surface glow through wave crests facing the sun.
  float sss = pow(max(dot(-V, uSunDir), 0.0), 3.0) * vCrest * 0.35;
  body += shallow * sss * uDaylight;
  vec3 R = reflect(-V, n);
  vec3 refl = envSkyColor(R) * mix(1.0, 0.55, uMarsh);
  vec3 col = mix(body, refl, fres * mix(0.85, 0.45, uMarsh));
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(n, H), 0.0);
  col += uSunColor * (pow(nh, 500.0) * 0.9 + pow(nh, 60.0) * 0.06) * (1.0 - uMarsh * 0.6);
  // Foam: shoreline band, wave crests, river banks, rapids and falls.
  float fn = n1.b * 0.55 + n2.b * 0.45;
  // Shore foam only where the bed actually rises toward a shore (flat shallow lagoons stay clear).
  float wpx = length(vec2(dFdx(p.x), dFdy(p.x))) + length(vec2(dFdx(p.y), dFdy(p.y)));
  float bedSlope = length(vec2(dFdx(ground), dFdy(ground))) / max(wpx, 1e-4);
  float shoreK = smoothstep(0.004, 0.035, bedSlope);
  float shore = smoothstep(0.9, 0.0, depth) * smoothstep(0.3, 0.7, fn + 0.25 * sin(depth * 7.0 - t * 2.2)) * shoreK;
  // Whitecaps: fewer and finer in sheltered polar water between the ice floes.
  float crest = smoothstep(0.78, 1.0, vCrest) * smoothstep(0.5, 0.8, fn) * 0.55 * (1.0 - 0.75 * polar);
  float riverFoam = 0.0;
  if (uFlowSpeed > 0.0) {
    float streak = n3.b;
    float edge = smoothstep(0.41, 0.5, abs(vUv.x - 0.5));
    riverFoam = smoothstep(0.86, 0.98, streak) * 0.08 * (0.3 + edge) + edge * 0.28 * smoothstep(0.45, 0.85, streak);
    riverFoam += vRapid * smoothstep(0.5, 0.8, n3.a) * 0.7;
    riverFoam += vFall * (0.6 + 0.4 * texture2D(uWaterTex, vec2(vUv.x * 1.6, vUv.y * 0.05 - t * 0.8)).b);
  }
  float foam = clamp((shore + crest) * uFoam + riverFoam, 0.0, 1.0);
  // Marsh: duckweed and floating algae.
  float weed = 0.0;
  if (uMarsh > 0.0) {
    float w1 = texture2D(uWaterTex, p * 0.0071 + vec2(t * 0.0003, 0.0)).a;
    float w2 = n2.a;
    weed = smoothstep(0.56, 0.64, w1) * (0.7 + 0.3 * w2);
    col = mix(col, vec3(0.2, 0.3, 0.07) * (0.6 + 0.5 * w2) * (0.4 + 0.6 * uDaylight), weed * uMarsh);
  }
  vec3 foamCol = vec3(0.92, 0.96, 0.98) * (0.35 + 0.65 * max(uDaylight, 0.12)) + uSunColor * 0.08;
  col = mix(col, foamCol, foam);
  // Hot spring: milky turquoise with drifting steam sheen.
  if (uHot > 0.0) col = mix(col, vec3(0.55, 0.85, 0.82), 0.25 * uHot * n1.a);
  float alpha = uOpacity * smoothstep(0.0, 1.4, depth) + fres * 0.25;
  alpha = max(alpha, foam * 0.9);
  alpha = max(alpha, weed * uMarsh);
  alpha = max(alpha, uFarOpaque * smoothstep(250.0, 700.0, camDist));
  alpha = max(alpha, vFall * 0.85);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

let sharedWaterTex: THREE.DataTexture | null = null;

/**
 * Tileable water detail texture: RG = ripple normal (xz), B = foam/bubble
 * noise, A = slow patch noise (algae, sheen). Generated procedurally once.
 */
export function waterTexture(): THREE.DataTexture {
  if (sharedWaterTex) return sharedWaterTex;
  const S = 256;
  const hf = new Field(S, (u, v) => pfbm(u, v, 6, 4, 4242, 0.55));
  const data = new Uint8Array(S * S * 4);
  const w = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (hf.px(x + 1, y) - hf.px(x - 1, y)) * 9;
      const dz = (hf.px(x, y + 1) - hf.px(x, y - 1)) * 9;
      const l = Math.sqrt(dx * dx + 1 + dz * dz);
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      worley(u, v, 18, 4343, 0.9, w);
      const bubbles = Math.min(1, Math.max(0, 1 - w.f1 / 0.55)) * 0.55 + 0.45 * (0.5 + 0.5 * pfbm(u, v, 12, 3, 4444));
      const o = (y * S + x) * 4;
      data[o] = Math.round((0.5 - 0.5 * (dx / l)) * 255);
      data[o + 1] = Math.round((0.5 - 0.5 * (dz / l)) * 255);
      data[o + 2] = Math.round(Math.min(1, Math.max(0, bubbles)) * 255);
      data[o + 3] = Math.round((0.5 + 0.5 * pfbm(u, v, 4, 4, 4545)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  sharedWaterTex = tex;
  return tex;
}

export interface WaterMaterialOptions {
  shallow: string;
  deep: string;
  /** Light absorption per metre (higher = colour saturates to deep faster). */
  absorb: number;
  opacity: number;
  waveAmp: number;
  waveScale: number;
  flowSpeed: number;
  foam: number;
  marsh: number;
  hot: number;
  farOpaque: number;
}

export function createWaterMaterial(o: Partial<WaterMaterialOptions> = {}): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uShallow: { value: new THREE.Color(o.shallow ?? '#2a9fb3') },
      uDeep: { value: new THREE.Color(o.deep ?? '#0b3f63') },
      uAbsorb: { value: o.absorb ?? 0.22 },
      uOpacity: { value: o.opacity ?? 0.86 },
      uWaveAmp: { value: o.waveAmp ?? 0.0 },
      uWaveScale: { value: o.waveScale ?? 1 },
      uFlowSpeed: { value: o.flowSpeed ?? 0 },
      uFoam: { value: o.foam ?? 0.6 },
      uMarsh: { value: o.marsh ?? 0 },
      uHot: { value: o.hot ?? 0 },
      uFarOpaque: { value: o.farOpaque ?? 0 },
    },
  ]);
  // Shared texture assigned after merge (merge would clone it).
  uniforms.uWaterTex = { value: waterTexture() };
  attachEnvUniforms({ uniforms });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

export function createIceMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d6ecf7'),
    roughness: 0.16,
    metalness: 0.0,
    emissive: new THREE.Color('#163246'),
    emissiveIntensity: 0.22,
  });
  mat.onBeforeCompile = (shader) => {
    attachEnvUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIceW = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vIceW;\n${ENV_PARS_GLSL}\n${ENV_NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vIceW.xz;
  float frost = smoothstep(0.4, 0.75, envFbm(p * 0.12));
  float crack = smoothstep(0.035, 0.0, abs(envNoise(p * 0.35) - 0.5)) * 0.6;
  diffuseColor.rgb = mix(vec3(0.55, 0.78, 0.9), vec3(0.93, 0.97, 1.0), clamp(frost + crack, 0.0, 1.0));
}`,
      );
  };
  mat.customProgramCacheKey = () => 'water-ice-v2';
  return mat;
}

/** Radial ocean grid: fine near the centre, coarse toward the horizon. */
function buildOceanGeometry(rings: number, segments: number, r0: number, rMax: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const k = Math.pow(rMax / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(k, i) - r0 * 0.6;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uvs.push(0.5 + Math.cos(a) * 0.5 * (i / rings), 0.5 + Math.sin(a) * 0.5 * (i / rings));
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments, b0 = 1 + (i + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const n = pos.length / 3;
  geo.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax);
  return geo;
}

export interface WaterfallSite {
  riverId: string;
  /** Lip (top) and base positions. */
  top: THREE.Vector3;
  base: THREE.Vector3;
  width: number;
  drop: number;
  /** Downstream direction (unit XZ). */
  dir: THREE.Vector2;
}

export class WaterRenderer {
  readonly group = new THREE.Group();
  readonly materials: THREE.ShaderMaterial[] = [];
  private ocean: THREE.Mesh;
  private readonly iceMaterial = createIceMaterial();
  private readonly oceanMat: THREE.ShaderMaterial;
  /** Waterfalls (for mist / spray / sound emitters). */
  readonly waterfalls: WaterfallSite[] = [];
  /** Hot spring centres (steam). */
  readonly hotSprings: THREE.Vector3[] = [];

  constructor() {
    this.group.name = 'water';
    this.oceanMat = createWaterMaterial({ shallow: '#3fb7c0', deep: '#0b3d63', absorb: 0.16, opacity: 0.82, waveAmp: 0.85, foam: 1, farOpaque: 1 });
    this.materials.push(this.oceanMat);
    this.ocean = new THREE.Mesh(buildOceanGeometry(72, 96, 3, 3600), this.oceanMat);
    this.ocean.position.y = SEA_LEVEL;
    this.ocean.renderOrder = 1;
    this.ocean.frustumCulled = false;
    this.ocean.name = 'ocean';
    this.group.add(this.ocean);

    this.buildRivers();
    this.buildLakes();
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.oceanMat.uniforms.uWaveAmp.value = q === 'low' ? 0.55 : 0.85;
  }

  private buildRivers(): void {
    const flowMat = createWaterMaterial({ shallow: '#4aa7a6', deep: '#145868', absorb: 0.45, opacity: 0.78, waveAmp: 0, flowSpeed: 1.6, foam: 0.5 });
    this.materials.push(flowMat);
    for (const r of getRiverRuntime()) {
      // Sample at the profile spacing so waterfalls become single steep quads.
      const step = r.spacing;
      const n = Math.max(2, Math.ceil(r.line.length / step) + 1);
      const pos = new Float32Array(n * 2 * 3);
      const uv = new Float32Array(n * 2 * 2);
      const rapid = new Float32Array(n * 2);
      const fall = new Float32Array(n * 2);
      const fallAt = new Set<number>();
      for (const f of r.falls) fallAt.add(Math.round(f.s / step));
      let vacc = 0;
      let prevY = r.surface(0);
      for (let i = 0; i < n; i++) {
        const s = Math.min(r.line.length, i * step);
        const p = r.line.pointAt(s);
        const t = r.line.tangentAt(s);
        const half = r.width(s) * 0.5 + 1.2;
        const y = r.surface(s) + 0.04;
        const nx = -t.z, nz = t.x;
        pos.set([p.x + nx * half, y, p.z + nz * half, p.x - nx * half, y, p.z - nz * half], i * 6);
        // UV v follows the true (3D) path length so falls don't stretch the flow pattern.
        if (i > 0) vacc += Math.hypot(step, prevY - y);
        prevY = y;
        uv.set([0, vacc / 8, 1, vacc / 8], i * 4);
        const g = r.gradient(s);
        const rp = Math.min(1, Math.max(0, (g - 0.02) / 0.06));
        rapid[i * 2] = rapid[i * 2 + 1] = rp;
        const isFall = fallAt.has(i) || fallAt.has(i - 1) ? 1 : 0;
        fall[i * 2] = fall[i * 2 + 1] = isFall;
      }
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('rapid', new THREE.BufferAttribute(rapid, 1));
      geo.setAttribute('fall', new THREE.BufferAttribute(fall, 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, r.frozen ? this.iceMaterial : flowMat);
      mesh.name = `river_${r.id}`;
      mesh.renderOrder = 2;
      if (r.frozen) mesh.position.y = ICE_TOP - 0.04;
      this.group.add(mesh);
      if (!r.frozen) for (const f of r.falls) this.addFall(r.id, r, f);
    }
  }

  private addFall(id: string, r: ReturnType<typeof getRiverRuntime>[number], f: RiverFall): void {
    const p0 = r.line.pointAt(f.s);
    const p1 = r.line.pointAt(f.s + r.spacing);
    const t = r.line.tangentAt(f.s);
    this.waterfalls.push({
      riverId: id,
      top: new THREE.Vector3(p0.x, r.surface(f.s), p0.z),
      base: new THREE.Vector3(p1.x, r.surface(f.s + r.spacing), p1.z),
      width: r.width(f.s),
      drop: f.drop,
      dir: new THREE.Vector2(t.x, t.z),
    });
  }

  private buildLakes(): void {
    const lakeMat = createWaterMaterial({ shallow: '#46aab4', deep: '#0f4f70', absorb: 0.3, opacity: 0.84, waveAmp: 0, foam: 0.35 });
    this.materials.push(lakeMat);
    const hotMat = createWaterMaterial({ shallow: '#7fd8cf', deep: '#2b8f96', absorb: 0.5, opacity: 0.8, waveAmp: 0, foam: 0.2, hot: 1 });
    this.materials.push(hotMat);
    for (const l of getLakeRuntime()) {
      const geo = new THREE.CircleGeometry(l.def.r + 4, 64);
      geo.rotateX(-Math.PI / 2);
      const n = geo.getAttribute('position').count;
      geo.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(n), 1));
      const mat = l.def.frozen ? this.iceMaterial : l.def.kind === 'hotspring' ? hotMat : lakeMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(l.def.x, l.level + (l.def.frozen ? ICE_TOP : 0.02), l.def.z);
      mesh.name = `lake_${l.def.id}`;
      mesh.renderOrder = 2;
      mesh.receiveShadow = !!l.def.frozen;
      this.group.add(mesh);
      if (l.def.kind === 'hotspring') this.hotSprings.push(new THREE.Vector3(l.def.x, l.level, l.def.z));
    }
    const marshMat = createWaterMaterial({ shallow: '#5d6a37', deep: '#1f2a17', absorb: 0.9, opacity: 0.9, waveAmp: 0, foam: 0.15, marsh: 1 });
    this.materials.push(marshMat);
    const mg = new THREE.CircleGeometry(MARSH.r * 0.86, 96);
    mg.rotateX(-Math.PI / 2);
    const mn = mg.getAttribute('position').count;
    mg.setAttribute('rapid', new THREE.BufferAttribute(new Float32Array(mn), 1));
    mg.setAttribute('fall', new THREE.BufferAttribute(new Float32Array(mn), 1));
    const marsh = new THREE.Mesh(mg, marshMat);
    marsh.position.set(MARSH.x, MARSH.level, MARSH.z);
    marsh.name = 'marsh';
    marsh.renderOrder = 2;
    this.group.add(marsh);
  }

  update(_dt: number, camera: THREE.Camera, _sunDir?: THREE.Vector3, _skyColor?: THREE.Color, _sunColor?: THREE.Color): void {
    // Ocean grid follows the camera (snapped to a few metres so the fine rings don't swim).
    const snap = 4;
    this.ocean.position.x = Math.round(camera.position.x / snap) * snap;
    this.ocean.position.z = Math.round(camera.position.z / snap) * snap;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.iceMaterial.dispose();
    sharedWaterTex?.dispose();
    sharedWaterTex = null;
  }
}
