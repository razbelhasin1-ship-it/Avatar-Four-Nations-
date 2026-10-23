import * as THREE from 'three';
import { getLakeRuntime, getRiverRuntime, MARSH } from './Heightfield';
import { SEA_LEVEL } from './WorldLayout';

/**
 * Water surfaces: ocean (camera-following tessellated plane), rivers (ribbons
 * along carved channels, flowing), lakes/ponds (discs), marsh. Frozen water uses
 * an ice material. Water *sources* for bending are registered separately by the
 * WaterSourceSystem using the same Heightfield runtime data.
 */

const waterVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform float uWaveAmp;
varying vec3 vWorld;
varying vec2 vUv;
varying float vFlow;
attribute float flow;
void main() {
  vUv = uv;
  vFlow = flow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = sin(wp.x * 0.05 + uTime * 0.9) * 0.6 + sin(wp.z * 0.07 + uTime * 0.7) * 0.4 + sin((wp.x + wp.z) * 0.13 + uTime * 1.6) * 0.25;
  wp.y += w * uWaveAmp;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const waterFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uOpacity;
uniform float uFlowSpeed;
uniform float uFoam;
varying vec3 vWorld;
varying vec2 vUv;
varying float vFlow;
float wHash(vec2 p){ p = fract(p*vec2(234.34, 435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
float wNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), u.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), u.x), u.y); }
vec2 wGrad(vec2 p){ float e=0.15; return vec2(wNoise(p+vec2(e,0))-wNoise(p-vec2(e,0)), wNoise(p+vec2(0,e))-wNoise(p-vec2(0,e)))/(2.0*e); }
void main() {
  vec2 p = vWorld.xz;
  vec2 flowOff = vec2(0.0, uTime * uFlowSpeed);
  vec2 g = wGrad(p * 0.35 + vec2(uTime * 0.05, uTime * 0.03)) * 0.6 + wGrad(p * 1.1 - vec2(uTime * 0.11, -uTime * 0.07)) * 0.3;
  if (uFlowSpeed > 0.0) g += wGrad(vec2(vUv.x * 3.0, vUv.y * 0.6 - uTime * uFlowSpeed * 0.6)) * 0.5;
  vec3 n = normalize(vec3(-g.x * 0.35, 1.0, -g.y * 0.35));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 col = mix(uDeep, uShallow, 0.35 + 0.25 * wNoise(p * 0.05));
  col = mix(col, uSky, clamp(fres * 0.85 + 0.08, 0.0, 1.0));
  vec3 h = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 180.0) * 2.2 + pow(max(dot(n, h), 0.0), 24.0) * 0.12;
  col += uSunColor * spec;
  // Flowing foam streaks on rivers.
  if (uFoam > 0.0) {
    float streak = wNoise(vec2(vUv.x * 9.0, vUv.y * 0.8 - uTime * uFlowSpeed * 0.9));
    float edge = smoothstep(0.38, 0.5, abs(vUv.x - 0.5));
    col += vec3(0.9) * uFoam * (smoothstep(0.72, 0.95, streak) * 0.5 + edge * 0.35 * streak);
  }
  float alpha = clamp(uOpacity + fres * 0.25, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface WaterMaterialOptions {
  shallow: string;
  deep: string;
  opacity: number;
  waveAmp: number;
  flowSpeed: number;
  foam: number;
}

export function createWaterMaterial(o: Partial<WaterMaterialOptions> = {}): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(o.shallow ?? '#2a8fb3') },
      uDeep: { value: new THREE.Color(o.deep ?? '#0b3f63') },
      uSky: { value: new THREE.Color('#a9cbe8') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uOpacity: { value: o.opacity ?? 0.82 },
      uWaveAmp: { value: o.waveAmp ?? 0.25 },
      uFlowSpeed: { value: o.flowSpeed ?? 0 },
      uFoam: { value: o.foam ?? 0 },
    },
  ]);
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
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cfe8f5'),
    roughness: 0.18,
    metalness: 0.0,
    emissive: new THREE.Color('#1a3346'),
    emissiveIntensity: 0.25,
  });
}

export class WaterRenderer {
  readonly group = new THREE.Group();
  readonly materials: THREE.ShaderMaterial[] = [];
  private ocean: THREE.Mesh;
  private readonly iceMaterial = createIceMaterial();

  constructor() {
    this.group.name = 'water';
    // Ocean: tessellated plane that follows the camera (snapped to avoid swimming waves).
    const oceanMat = createWaterMaterial({ shallow: '#2b8fb0', deep: '#0a3a5c', opacity: 0.86, waveAmp: 0.35 });
    this.materials.push(oceanMat);
    const geo = new THREE.PlaneGeometry(3200, 3200, 160, 160);
    geo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(geo, oceanMat);
    this.ocean.position.y = SEA_LEVEL;
    this.ocean.renderOrder = 1;
    this.ocean.frustumCulled = false;
    this.group.add(this.ocean);

    this.buildRivers();
    this.buildLakes();
  }

  private buildRivers(): void {
    const flowMat = createWaterMaterial({ shallow: '#3aa3c4', deep: '#145a7a', opacity: 0.8, waveAmp: 0.04, flowSpeed: 1.6, foam: 0.6 });
    this.materials.push(flowMat);
    for (const r of getRiverRuntime()) {
      const step = 3;
      const n = Math.max(2, Math.ceil(r.line.length / step) + 1);
      const pos = new Float32Array(n * 2 * 3);
      const uv = new Float32Array(n * 2 * 2);
      const flow = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const s = Math.min(r.line.length, i * step);
        const p = r.line.pointAt(s);
        const t = r.line.tangentAt(s);
        const half = r.width(s) * 0.5 + 1.2;
        const y = r.surface(s) + 0.04;
        const nx = -t.z, nz = t.x;
        pos.set([p.x + nx * half, y, p.z + nz * half, p.x - nx * half, y, p.z - nz * half], i * 6);
        uv.set([0, s / 8, 1, s / 8], i * 4);
        flow[i * 2] = 1;
        flow[i * 2 + 1] = 1;
      }
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('flow', new THREE.BufferAttribute(flow, 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, r.frozen ? this.iceMaterial : flowMat);
      mesh.name = `river_${r.id}`;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  private buildLakes(): void {
    const lakeMat = createWaterMaterial({ shallow: '#3b9cbc', deep: '#0f4f70', opacity: 0.84, waveAmp: 0.05 });
    this.materials.push(lakeMat);
    for (const l of getLakeRuntime()) {
      const geo = new THREE.CircleGeometry(l.def.r + 3, 48);
      geo.rotateX(-Math.PI / 2);
      const mat = l.def.frozen ? this.iceMaterial : l.def.kind === 'hotspring' ? createWaterMaterial({ shallow: '#5fc4c0', deep: '#2b7f86', opacity: 0.75, waveAmp: 0.02 }) : lakeMat;
      if (mat instanceof THREE.ShaderMaterial && mat !== lakeMat) this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(l.def.x, l.level + (l.def.frozen ? 0.08 : 0.02), l.def.z);
      mesh.name = `lake_${l.def.id}`;
      mesh.renderOrder = 2;
      mesh.receiveShadow = !!l.def.frozen;
      this.group.add(mesh);
    }
    const marshMat = createWaterMaterial({ shallow: '#4f6b3e', deep: '#243523', opacity: 0.88, waveAmp: 0.02 });
    this.materials.push(marshMat);
    const mg = new THREE.CircleGeometry(MARSH.r * 0.86, 64);
    mg.rotateX(-Math.PI / 2);
    const marsh = new THREE.Mesh(mg, marshMat);
    marsh.position.set(MARSH.x, MARSH.level, MARSH.z);
    marsh.name = 'marsh';
    marsh.renderOrder = 2;
    this.group.add(marsh);
  }

  update(dt: number, camera: THREE.Camera, sunDir: THREE.Vector3, skyColor: THREE.Color, sunColor: THREE.Color): void {
    for (const m of this.materials) {
      m.uniforms.uTime.value += dt;
      m.uniforms.uSunDir.value.copy(sunDir);
      m.uniforms.uSky.value.copy(skyColor);
      m.uniforms.uSunColor.value.copy(sunColor);
    }
    const snap = 40;
    this.ocean.position.x = Math.round(camera.position.x / snap) * snap;
    this.ocean.position.z = Math.round(camera.position.z / snap) * snap;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.iceMaterial.dispose();
  }
}
