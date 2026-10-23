import * as THREE from 'three';
import { kitMaterialTinted } from '../../kit/Materials';
import { emblemBanner } from '../../kit/Textures';

/**
 * Fire Nation specific materials (shared by every Fire region module).
 *
 * Like the kit materials these are cached singletons: regions never dispose
 * them (other regions and future rebuilds reuse them). Kit materials are
 * referenced by name in builder calls; these are passed as Material objects.
 *
 * Note: the scene has no environment map, so metals use moderate metalness and
 * a faint emissive so gilding reads as gold rather than dark bronze.
 */

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = `fire_${key}`;
    cache.set(key, m);
  }
  return m;
}

/** Bright gilding for roof ornaments, trims, emblems, finials. */
export function goldMat(): THREE.MeshStandardMaterial {
  return cached('gold', () => new THREE.MeshStandardMaterial({ color: '#e0ad3e', metalness: 0.42, roughness: 0.3, emissive: '#4a2c04', emissiveIntensity: 0.55 }));
}

/** Deep red lacquer for columns, railings, gates. */
export function lacquerRedMat(): THREE.MeshStandardMaterial {
  return cached('lacquer_red', () => new THREE.MeshStandardMaterial({ color: '#9a1c14', metalness: 0.05, roughness: 0.38 }));
}

/** Crimson plaster (slightly deeper than the kit plaster_red). */
export function crimsonMat(): THREE.Material {
  return kitMaterialTinted('plaster_red', '#d8b2a8');
}

/** Ivory / cream plaster with a warm tint (palace walls). */
export function ivoryMat(): THREE.Material {
  return kitMaterialTinted('plaster_cream', '#fff4e6');
}

/** Dark volcanic basalt (bases, quay walls, the ruins). */
export function basaltMat(): THREE.Material {
  return kitMaterialTinted('stone_dark', '#a8a2a0');
}

/** Weathered ancient stone (Sun Warrior ruins). */
export function ancientStoneMat(): THREE.Material {
  return kitMaterialTinted('stone_tan', '#c8b49a');
}

/** Moss / overgrowth tint of the ancient stone. */
export function mossStoneMat(): THREE.Material {
  return kitMaterialTinted('stone_green', '#a6b48c');
}

/** Fire Nation banner: gold flame emblem on red cloth. */
export function bannerMat(): THREE.MeshStandardMaterial {
  return cached('banner', () => {
    const m = new THREE.MeshStandardMaterial({ map: emblemBanner('#a01d16', '#f2c34e', 'fire', '#d6b25e'), roughness: 0.92, side: THREE.DoubleSide });
    return m;
  });
}

/** Black banner with a red emblem (palace gate hangings). */
export function bannerDarkMat(): THREE.MeshStandardMaterial {
  return cached('banner_dark', () => new THREE.MeshStandardMaterial({ map: emblemBanner('#1e1514', '#c8321e', 'fire', '#c89a3a'), roughness: 0.92, side: THREE.DoubleSide }));
}

export function pineMat(): THREE.MeshStandardMaterial {
  return cached('pine', () => new THREE.MeshStandardMaterial({ color: '#2c4a2c', roughness: 0.95, flatShading: true }));
}

export function willowMat(): THREE.MeshStandardMaterial {
  return cached('willow', () => new THREE.MeshStandardMaterial({ color: '#6f9a46', roughness: 0.9, flatShading: true, side: THREE.DoubleSide }));
}

export function palmMat(): THREE.MeshStandardMaterial {
  return cached('palm', () => new THREE.MeshStandardMaterial({ color: '#4f8a34', roughness: 0.85, side: THREE.DoubleSide, flatShading: true }));
}

/** Autumn-red ornamental tree (maple) foliage. */
export function mapleMat(): THREE.MeshStandardMaterial {
  return cached('maple', () => new THREE.MeshStandardMaterial({ color: '#b8402a', roughness: 0.9, flatShading: true }));
}

/** Jungle / overgrowth leaves (ruins). */
export function jungleMat(): THREE.MeshStandardMaterial {
  return cached('jungle', () => new THREE.MeshStandardMaterial({ color: '#3d6b2a', roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
}

export function barkMat(): THREE.MeshStandardMaterial {
  return cached('bark', () => new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.95 }));
}

/** Clipped lawn / garden moss. */
export function lawnMat(): THREE.Material {
  return kitMaterialTinted('plaster_green', '#93b07a');
}

/** Garden pond & canal water (slightly green, glossy, translucent). */
export function pondWaterMat(): THREE.MeshStandardMaterial {
  return cached('pond_water', () => new THREE.MeshStandardMaterial({ color: '#2f6d6a', roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.84, depthWrite: false }));
}

/** Harbour / sea-side water accents (unused for the ocean itself, which the world renders). */
export function canalWaterMat(): THREE.MeshStandardMaterial {
  return cached('canal_water', () => new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.86, depthWrite: false }));
}

/** Dark pond bed. */
export function pondBedMat(): THREE.MeshStandardMaterial {
  return cached('pond_bed', () => new THREE.MeshStandardMaterial({ color: '#1d2a26', roughness: 1 }));
}

/** Glowing lava (vents, the eternal flame's bed). Shared and animated by FireFX. */
export function lavaMat(): THREE.MeshStandardMaterial {
  return cached('lava', () => new THREE.MeshStandardMaterial({ color: '#4a1206', emissive: '#ff4a0c', emissiveIntensity: 2.2, roughness: 0.8 }));
}

/** Dark cooled lava crust around vents. */
export function crustMat(): THREE.MeshStandardMaterial {
  return cached('crust', () => new THREE.MeshStandardMaterial({ color: '#221a18', roughness: 0.95, flatShading: true }));
}

/** Fire Navy hull steel. */
export function steelMat(): THREE.MeshStandardMaterial {
  return cached('steel', () => new THREE.MeshStandardMaterial({ color: '#4c4f57', metalness: 0.35, roughness: 0.55 }));
}

/** Dark hull plating / smokestack soot. */
export function steelDarkMat(): THREE.MeshStandardMaterial {
  return cached('steel_dark', () => new THREE.MeshStandardMaterial({ color: '#2a2b30', metalness: 0.3, roughness: 0.6 }));
}

/** Sandy beach paths / theatre floor. */
export function sandStoneMat(): THREE.Material {
  return kitMaterialTinted('stone_light', '#f2e6cc');
}

/** Paper screens / lit windows at night look (warm, slightly emissive). */
export function paperMat(): THREE.MeshStandardMaterial {
  return cached('paper', () => new THREE.MeshStandardMaterial({ color: '#f2dcb0', emissive: '#ff9a40', emissiveIntensity: 0.35, roughness: 0.9 }));
}

/** Red lantern glow (stronger than the kit lantern for night shots). */
export function emberGlowMat(): THREE.MeshStandardMaterial {
  return cached('ember_glow', () => new THREE.MeshStandardMaterial({ color: '#ff8a3a', emissive: '#ff5a14', emissiveIntensity: 2.4, roughness: 1 }));
}

/** Sun disc of the Sun Warriors: weathered gold with an inner glow. */
export function sunDiscMat(): THREE.MeshStandardMaterial {
  return cached('sun_disc', () => new THREE.MeshStandardMaterial({ color: '#d79a32', metalness: 0.35, roughness: 0.45, emissive: '#6a3006', emissiveIntensity: 0.6 }));
}

/** Theatre / awning cloth stripes (Ember Island). */
export function awningMat(): THREE.MeshStandardMaterial {
  return cached('awning', () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f3e7d0' : '#b8281e';
      g.fillRect(i * 8, 0, 8, 64);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide });
  });
}

export function disposeFireMaterials(): void {
  for (const m of cache.values()) {
    const mm = m as THREE.MeshStandardMaterial;
    if (mm.map && mm.name === 'fire_awning') mm.map.dispose();
    m.dispose();
  }
  cache.clear();
}
