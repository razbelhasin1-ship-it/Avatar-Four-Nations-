import * as THREE from 'three';
import { cloth, flagstones, iceTexture, planks, plaster, roofTiles, stoneBlocks } from './Textures';

/**
 * Shared architecture materials.
 *
 * Most use world-space TRIPLANAR mapping (no UVs needed, perfect for merged
 * geometry and arbitrary building sizes): the texture repeats every
 * `tileMetres` metres in world space, with large-scale variation to hide tiling.
 * Roof/plank/cloth materials use the geometry's UVs (builders generate them).
 *
 * Materials are cached singletons — never dispose them per region; call
 * disposeKitMaterials() only on full shutdown.
 */

export type KitMaterialName =
  | 'stone_light'
  | 'stone_tan'
  | 'stone_grey'
  | 'stone_dark'
  | 'stone_red'
  | 'stone_white'
  | 'stone_green'
  | 'paving'
  | 'paving_dark'
  | 'plaster_white'
  | 'plaster_cream'
  | 'plaster_red'
  | 'plaster_green'
  | 'plaster_tan'
  | 'wood'
  | 'wood_dark'
  | 'wood_red'
  | 'roof_green'
  | 'roof_red'
  | 'roof_blue'
  | 'roof_teal'
  | 'roof_dark'
  | 'roof_gold'
  | 'gold'
  | 'bronze'
  | 'iron'
  | 'ice'
  | 'ice_deep'
  | 'snow'
  | 'cloth_red'
  | 'cloth_green'
  | 'cloth_blue'
  | 'cloth_yellow'
  | 'cloth_orange'
  | 'cloth_white'
  | 'lantern_red'
  | 'lantern_warm'
  | 'lantern_blue'
  | 'glow_fire'
  | 'jade'
  | 'black_lacquer';

interface Def {
  kind: 'tri' | 'uv' | 'plain' | 'emissive';
  color: string;
  tex?: () => THREE.Texture;
  tile?: number;
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: number;
  side?: THREE.Side;
}

const DEFS: Record<KitMaterialName, Def> = {
  stone_light: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#d8cdb4', '#00000040', 6, 4, 11), tile: 3, rough: 0.9 },
  stone_tan: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#c2a77e', '#00000045', 5, 3, 12), tile: 3.2, rough: 0.92 },
  stone_grey: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#9a968e', '#00000050', 6, 4, 13), tile: 3, rough: 0.92 },
  stone_dark: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#5d5853', '#00000060', 6, 4, 14), tile: 3, rough: 0.9 },
  stone_red: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#8a3b2c', '#00000055', 6, 4, 15), tile: 3, rough: 0.88 },
  stone_white: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#ece6da', '#00000030', 6, 3, 16), tile: 3.5, rough: 0.85 },
  stone_green: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#7d8a6a', '#00000045', 6, 4, 17), tile: 3, rough: 0.9 },
  paving: { kind: 'tri', color: '#ffffff', tex: () => flagstones('#b9ab90', 18), tile: 4, rough: 0.9 },
  paving_dark: { kind: 'tri', color: '#ffffff', tex: () => flagstones('#6e665e', 19), tile: 4, rough: 0.9 },
  plaster_white: { kind: 'tri', color: '#ffffff', tex: () => plaster('#eee7d8', 21), tile: 4, rough: 0.95 },
  plaster_cream: { kind: 'tri', color: '#ffffff', tex: () => plaster('#e3d3ad', 22), tile: 4, rough: 0.95 },
  plaster_red: { kind: 'tri', color: '#ffffff', tex: () => plaster('#a3322a', 23), tile: 4, rough: 0.9 },
  plaster_green: { kind: 'tri', color: '#ffffff', tex: () => plaster('#8a9a6e', 24), tile: 4, rough: 0.95 },
  plaster_tan: { kind: 'tri', color: '#ffffff', tex: () => plaster('#cdb48a', 25), tile: 4, rough: 0.95 },
  wood: { kind: 'uv', color: '#ffffff', tex: () => planks('#8a6440', 31), rough: 0.85 },
  wood_dark: { kind: 'uv', color: '#ffffff', tex: () => planks('#4e3626', 32), rough: 0.85 },
  wood_red: { kind: 'uv', color: '#ffffff', tex: () => planks('#8e2a20', 33), rough: 0.8 },
  roof_green: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#3f7a4a', 41), rough: 0.75 },
  roof_red: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#9c2b22', 42), rough: 0.7 },
  roof_blue: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#3a6aa8', 43), rough: 0.7 },
  roof_teal: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#2f8a8a', 44), rough: 0.7 },
  roof_dark: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#3a3438', 45), rough: 0.75 },
  roof_gold: { kind: 'uv', color: '#ffffff', tex: () => roofTiles('#c8962e', 46), rough: 0.45, metal: 0.3 },
  gold: { kind: 'plain', color: '#d4a43a', rough: 0.35, metal: 0.8 },
  bronze: { kind: 'plain', color: '#9a6a3a', rough: 0.45, metal: 0.7 },
  iron: { kind: 'plain', color: '#4a4a4e', rough: 0.55, metal: 0.6 },
  ice: { kind: 'tri', color: '#ffffff', tex: () => iceTexture('#d4ecf8', 51), tile: 5, rough: 0.2, emissive: '#1a3346', emissiveIntensity: 0.25 },
  ice_deep: { kind: 'tri', color: '#ffffff', tex: () => iceTexture('#9ccbe6', 52), tile: 5, rough: 0.18, emissive: '#10283a', emissiveIntensity: 0.3 },
  snow: { kind: 'plain', color: '#f2f6fa', rough: 0.95 },
  cloth_red: { kind: 'uv', color: '#ffffff', tex: () => cloth('#a8241c', 61), rough: 0.95, side: THREE.DoubleSide },
  cloth_green: { kind: 'uv', color: '#ffffff', tex: () => cloth('#3f7a3a', 62), rough: 0.95, side: THREE.DoubleSide },
  cloth_blue: { kind: 'uv', color: '#ffffff', tex: () => cloth('#2f5f9e', 63), rough: 0.95, side: THREE.DoubleSide },
  cloth_yellow: { kind: 'uv', color: '#ffffff', tex: () => cloth('#e8b04a', 64), rough: 0.95, side: THREE.DoubleSide },
  cloth_orange: { kind: 'uv', color: '#ffffff', tex: () => cloth('#d8742a', 65), rough: 0.95, side: THREE.DoubleSide },
  cloth_white: { kind: 'uv', color: '#ffffff', tex: () => cloth('#ece6da', 66), rough: 0.95, side: THREE.DoubleSide },
  lantern_red: { kind: 'emissive', color: '#d8402a', emissive: '#ff5a2a', emissiveIntensity: 1.6, rough: 0.8 },
  lantern_warm: { kind: 'emissive', color: '#f0c070', emissive: '#ffb050', emissiveIntensity: 1.6, rough: 0.8 },
  lantern_blue: { kind: 'emissive', color: '#a8d8f0', emissive: '#7fc8ff', emissiveIntensity: 1.4, rough: 0.6 },
  glow_fire: { kind: 'emissive', color: '#ff9040', emissive: '#ff7020', emissiveIntensity: 3, rough: 1 },
  jade: { kind: 'plain', color: '#3f9f6a', rough: 0.3, metal: 0.1 },
  black_lacquer: { kind: 'plain', color: '#1c1616', rough: 0.35, metal: 0.1 },
};

const cache = new Map<KitMaterialName, THREE.MeshStandardMaterial>();

function triplanar(mat: THREE.MeshStandardMaterial, tileMetres: number): void {
  const uniforms = { kitScale: { value: 1 / tileMetres } };
  mat.userData.kitTriplanar = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.kitScale = uniforms.kitScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitWP;\nvarying vec3 vKitWN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 kwp = vec4(transformed, 1.0);
  vec3 kwn = objectNormal;
  #ifdef USE_INSTANCING
    kwp = instanceMatrix * kwp;
    kwn = mat3(instanceMatrix) * kwn;
  #endif
  kwp = modelMatrix * kwp;
  vKitWP = kwp.xyz;
  vKitWN = normalize(mat3(modelMatrix) * kwn);
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float kitScale;
varying vec3 vKitWP;
varying vec3 vKitWN;
float kitHash(vec2 p){ p = fract(p*vec2(127.1, 311.7)); p += dot(p, p+19.19); return fract(p.x*p.y); }
float kitNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(kitHash(i), kitHash(i+vec2(1,0)), u.x), mix(kitHash(i+vec2(0,1)), kitHash(i+vec2(1,1)), u.x), u.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
{
  vec3 kn = abs(normalize(vKitWN));
  kn = pow(kn, vec3(4.0));
  kn /= (kn.x + kn.y + kn.z + 1e-5);
  vec4 tx = texture2D(map, vKitWP.zy * kitScale);
  vec4 ty = texture2D(map, vKitWP.xz * kitScale);
  vec4 tz = texture2D(map, vKitWP.xy * kitScale);
  vec4 sampledDiffuseColor = tx * kn.x + ty * kn.y + tz * kn.z;
  float var = 0.86 + 0.28 * kitNoise(vKitWP.xz * 0.07 + vKitWP.y * 0.03);
  diffuseColor *= sampledDiffuseColor * vec4(vec3(var), 1.0);
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'kit-triplanar';
}

export function kitMaterial(name: KitMaterialName): THREE.MeshStandardMaterial {
  let m = cache.get(name);
  if (m) return m;
  const d = DEFS[name];
  m = new THREE.MeshStandardMaterial({
    color: d.color,
    roughness: d.rough ?? 0.9,
    metalness: d.metal ?? 0,
    side: d.side ?? THREE.FrontSide,
  });
  if (d.tex) m.map = d.tex();
  if (d.emissive) {
    m.emissive.set(d.emissive);
    m.emissiveIntensity = d.emissiveIntensity ?? 1;
  }
  if (d.kind === 'tri') triplanar(m, d.tile ?? 3);
  m.name = `kit_${name}`;
  cache.set(name, m);
  return m;
}

/** A tinted copy of a kit material (cached by name+tint). */
const tinted = new Map<string, THREE.MeshStandardMaterial>();
export function kitMaterialTinted(name: KitMaterialName, tint: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const key = `${name}:${new THREE.Color(tint).getHexString()}`;
  let m = tinted.get(key);
  if (m) return m;
  const base = kitMaterial(name);
  m = base.clone();
  m.color.set(tint);
  if (base.userData.kitTriplanar) triplanar(m, DEFS[name].tile ?? 3);
  tinted.set(key, m);
  return m;
}

export function disposeKitMaterials(): void {
  for (const m of cache.values()) m.dispose();
  for (const m of tinted.values()) m.dispose();
  cache.clear();
  tinted.clear();
}
