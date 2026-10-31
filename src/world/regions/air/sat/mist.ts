import * as THREE from 'three';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from '../../../env/EnvShared';
import { BASE, C } from './layout';

/**
 * The sea of cloud right under the temple: stacked translucent sheets just
 * below the mesa rim, billowing with drifting noise. Each sheet fades out
 * where the terrain rises through it (no cut lines on the cliffs) and near
 * the camera (walking up through them never shows a slicing plane), and is
 * lit by the shared sun and sky colours. The world's own cloud sea lies much
 * lower and is left untouched.
 */

/** Sheet heights (world y) and opacities, low to high. */
const SHEETS: Array<[number, number]> = [
  [BASE - 36, 0.55],
  [BASE - 24, 0.5],
  [BASE - 14, 0.42],
  [BASE - 6, 0.3],
];

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
uniform float uAlpha;
uniform float uSeed;
uniform vec2 uCentre;
varying vec3 vW;
void main() {
  vec2 drift = uWind.xy * uEnvTime * 1.6 + vec2(uSeed * 37.0, uSeed * 11.0);
  float n = envFbm(vW.xz * 0.0055 + drift * 0.004);
  float d = envFbm(vW.xz * 0.021 - drift * 0.009 + 4.0);
  float a = smoothstep(0.32, 0.72, n * 0.75 + d * 0.35) * uAlpha;
  // Terrain rising through the sheet: fade before it touches.
  float th = envTerrainHeight(vW.xz);
  a *= smoothstep(-1.5, -16.0, th - vW.y);
  // Near the camera, and the far rim of the disc.
  float cd = distance(cameraPosition, vW);
  a *= smoothstep(22.0, 95.0, cd);
  float r = distance(vW.xz, uCentre);
  a *= 1.0 - smoothstep(1050.0, 1350.0, r);
  if (a < 0.004) discard;
  float lit = 0.72 + 0.28 * d;
  vec3 col = mix(uSkyHorizon, vec3(1.0), 0.62) * mix(vec3(0.62, 0.68, 0.78), uSunColor, uDaylight * 0.85) * lit;
  col = mix(col * 0.35, col, uDaylight);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

export function buildMist(parent: THREE.Object3D, sheets = SHEETS.length): { meshes: THREE.Mesh[]; materials: THREE.ShaderMaterial[] } {
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const geo = new THREE.RingGeometry(60, 1350, 96, 10);
  geo.rotateX(-Math.PI / 2);
  SHEETS.slice(SHEETS.length - sheets).forEach(([y, alpha], i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAlpha: { value: alpha }, uSeed: { value: i * 1.37 + 0.4 }, uCentre: { value: new THREE.Vector2(C.x, C.z) } }]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.onBeforeCompile = (sh) => attachEnvUniforms(sh);
    // ShaderMaterial uniforms are set up before compile; attach the shared ones directly too.
    attachEnvUniforms(mat as unknown as { uniforms: Record<string, THREE.IUniform> });
    mat.name = `sat_mist_${i}`;
    const mesh = new THREE.Mesh(i === 0 ? geo : geo, mat);
    mesh.position.set(C.x, y, C.z);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.name = `sat_mist_${i}`;
    parent.add(mesh);
    meshes.push(mesh);
    materials.push(mat);
  });
  return { meshes, materials };
}
