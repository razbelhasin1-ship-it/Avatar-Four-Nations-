import * as THREE from 'three';
import { kitMaterialTinted } from '../../kit/Materials';
import { emblemBanner } from '../../kit/Textures';

/**
 * Custom materials shared by the wilds sites (foliage, bark, sand, crops, sign
 * atlas, crystals...). Created lazily, reference-counted by the sites that are
 * built and disposed when the last site is disposed. Kit materials (stone,
 * wood, roofs...) are shared app-wide and never disposed here.
 */

let refs = 0;
const cache = new Map<string, THREE.Material>();
const textures: THREE.Texture[] = [];

export function acquireWildsMaterials(): void {
  refs++;
}

export function releaseWildsMaterials(): void {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  for (const m of cache.values()) m.dispose();
  cache.clear();
  for (const t of textures) t.dispose();
  textures.length = 0;
}

function get<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = `wilds_${key}`;
    cache.set(key, m);
  }
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  textures.push(t);
  return t;
}

function hash(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export type WildsMat =
  | 'foliage'
  | 'foliage_dark'
  | 'swamp_leaf'
  | 'bark'
  | 'moss'
  | 'sand'
  | 'adobe'
  | 'thatch'
  | 'straw'
  | 'crops'
  | 'crops_gold'
  | 'sign'
  | 'crystal'
  | 'mushroom'
  | 'murky'
  | 'shaft'
  | 'owl_glow'
  | 'fur'
  | 'rock'
  | 'rock_snow'
  | 'hull'
  | 'sail'
  | 'palm_leaf'
  | 'palm_trunk'
  | 'vine'
  | 'dark'
  | 'banner_earth'
  | 'banner_fire'
  | 'banner_water'
  | 'banner_dai_li'
  | 'banner_pirate';

export function wildsMaterial(name: WildsMat): THREE.Material {
  switch (name) {
    case 'foliage':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#4f7d3a', roughness: 0.9, flatShading: true }));
    case 'foliage_dark':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#2f5a32', roughness: 0.92, flatShading: true }));
    case 'swamp_leaf':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#3d5e2c', roughness: 0.95, flatShading: true }));
    case 'moss':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#5d7a3a', roughness: 1, flatShading: true }));
    case 'vine':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#4a6a30', roughness: 1 }));
    case 'bark':
      return get(name, () => {
        const tex = canvasTex(128, 256, (g) => {
          g.fillStyle = '#5a4634';
          g.fillRect(0, 0, 128, 256);
          for (let i = 0; i < 70; i++) {
            const x = hash(i) * 128, w = 2 + hash(i + 9) * 6;
            g.fillStyle = `rgba(${30 + hash(i + 3) * 30},${22 + hash(i + 4) * 20},${14 + hash(i + 5) * 10},${0.35 + hash(i + 6) * 0.4})`;
            g.fillRect(x, 0, w, 256);
          }
          for (let i = 0; i < 40; i++) {
            g.fillStyle = `rgba(110,130,70,${0.12 + hash(i + 70) * 0.2})`;
            g.fillRect(hash(i + 80) * 128, hash(i + 90) * 256, 8 + hash(i) * 20, 4 + hash(i + 1) * 10);
          }
        });
        tex.repeat.set(3, 2);
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      });
    case 'sand':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#d8bf8a', roughness: 1, flatShading: true }));
    // Tinted kit materials are cached (and disposed) by the kit itself.
    case 'adobe':
      return kitMaterialTinted('plaster_tan', '#f3e2c6');
    case 'thatch':
      return kitMaterialTinted('roof_dark', '#d0aa60');
    case 'straw':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#c8a85a', roughness: 1, flatShading: true }));
    case 'fur':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 1, flatShading: true }));
    case 'rock':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#7d746a', roughness: 0.95, flatShading: true }));
    case 'rock_snow':
      return get(name, () => {
        const m = new THREE.MeshStandardMaterial({ color: '#8a8c92', roughness: 0.95, flatShading: true });
        // Snow caps: whiten upward-facing surfaces (world normal).
        m.onBeforeCompile = (s) => {
          s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
{
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wn = mat3(instanceMatrix) * wn;
  #endif
  vUpN = normalize(mat3(modelMatrix) * wn).y;
}`,
          );
          s.fragmentShader = s.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vUpN;')
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), smoothstep(0.45, 0.75, vUpN));');
        };
        m.customProgramCacheKey = () => 'wilds-rock-snow';
        return m;
      });
    case 'crops':
    case 'crops_gold':
      return get(name, () => {
        const gold = name === 'crops_gold';
        const tex = canvasTex(64, 64, (g) => {
          g.fillStyle = '#6a5034';
          g.fillRect(0, 0, 64, 64);
          for (let r = 0; r < 4; r++) {
            g.fillStyle = gold ? '#c9a640' : '#5f9a3c';
            g.fillRect(0, r * 16 + 3, 64, 10);
            g.fillStyle = gold ? '#e0c060' : '#7cb850';
            for (let i = 0; i < 16; i++) g.fillRect(i * 4 + hash(r * 16 + i) * 2, r * 16 + 4 + hash(i + r) * 3, 2, 5);
          }
        });
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
      });
    case 'sign':
      return get(name, () => {
        const tex = canvasTex(512, 512, (g) => {
          g.fillStyle = '#8a6440';
          g.fillRect(0, 0, 512, 512);
          const rows = SIGN_NAMES.length + 1;
          const rh = 512 / rows;
          g.font = `bold ${Math.floor(rh * 0.5)}px serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          SIGN_NAMES.forEach((n, i) => {
            const y = (i + 1) * rh;
            g.fillStyle = '#d9c39a';
            g.fillRect(6, y + 3, 500, rh - 6);
            g.fillStyle = '#3a2614';
            g.fillText(n, 256, y + rh / 2 + 1);
          });
        }, false);
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      });
    case 'crystal':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#7fe8d8', emissive: '#2fd8c0', emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1, flatShading: true }));
    case 'mushroom':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#b8f080', emissive: '#7fd84a', emissiveIntensity: 1.2, roughness: 0.6 }));
    case 'murky':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#3d4a2a', roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.88 }));
    case 'shaft':
      return get(name, () => new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    case 'owl_glow':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#e8c060', emissive: '#ffb030', emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.5 }));
    case 'hull':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#6e4a2c', roughness: 0.85, side: THREE.DoubleSide }));
    case 'sail':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 0.95, side: THREE.DoubleSide }));
    case 'palm_leaf':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#5c8f38', roughness: 0.9, side: THREE.DoubleSide, flatShading: true }));
    case 'palm_trunk':
      return get(name, () => new THREE.MeshStandardMaterial({ color: '#8a7050', roughness: 1, flatShading: true }));
    case 'dark':
      return get(name, () => new THREE.MeshBasicMaterial({ color: '#07060a' }));
    // Banner textures are cached by the kit; only the materials are ours.
    case 'banner_earth':
      return get(name, () => new THREE.MeshStandardMaterial({ map: emblemBanner('#3f7a3a', '#e8d9a0', 'earth'), roughness: 0.95, side: THREE.DoubleSide }));
    case 'banner_fire':
      return get(name, () => new THREE.MeshStandardMaterial({ map: emblemBanner('#9c2218', '#f0c040', 'fire'), roughness: 0.95, side: THREE.DoubleSide }));
    case 'banner_water':
      return get(name, () => new THREE.MeshStandardMaterial({ map: emblemBanner('#24508a', '#e8f2ff', 'water'), roughness: 0.95, side: THREE.DoubleSide }));
    case 'banner_dai_li':
      return get(name, () => new THREE.MeshStandardMaterial({ map: emblemBanner('#1f3a28', '#c8b060', 'earth', '#8a7a40'), roughness: 0.95, side: THREE.DoubleSide }));
    case 'banner_pirate':
      return get(name, () => new THREE.MeshStandardMaterial({ map: emblemBanner('#1c1a1a', '#d8d0c0', 'water', '#8a2a20'), roughness: 0.95, side: THREE.DoubleSide }));
  }
}

/** Destination names on the signpost atlas (row index = position in this list). */
export const SIGN_NAMES = [
  'OMASHU',
  'BA SING SE',
  'NORTHERN WATER TRIBE',
  'FOGGY SWAMP',
  'FIRE NATION',
  'GAOLING',
  'RIVERBEND',
  'MISTY PALMS',
  'SOUTHERN WATER TRIBE',
  'TUNDRA WATCHTOWER',
  'KYOSHI ISLAND',
  'AIR TEMPLE',
] as const;
export type SignName = (typeof SIGN_NAMES)[number];
