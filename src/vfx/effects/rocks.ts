import * as THREE from 'three';
import type { SurfaceType } from '../../core/types';
import { fbm3, noise3, rand01 } from './noise';
import { shared } from './shapes';

/**
 * Pooled procedural rock geometry + shared stone materials for earthbending.
 * Geometries are cached (shared) and must never be disposed by callers; so are
 * the materials returned by stoneMaterial().
 *
 * Stone colour follows the ground it was torn from (earthTint), so a rock ripped
 * out of desert sand reads sandstone, one from a snowfield reads grey granite.
 */

export const ROCK_VARIANTS = 8;

function displaceRock(g: THREE.BufferGeometry, seed: number, rough: number, stretch: THREE.Vector3): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = fbm3(v.x * 1.6 + seed * 3.1, v.y * 1.6 + seed * 1.7, v.z * 1.6 - seed, 3);
    // Facets: quantize a second noise for chiselled planes.
    const f = Math.round(noise3(v.x * 2.4 + seed, v.y * 2.4, v.z * 2.4 - seed) * 3) / 3;
    const r = 1 + n * rough + (f - 0.5) * rough * 0.5;
    pos.setXYZ(i, v.x * r * stretch.x, v.y * r * stretch.y, v.z * r * stretch.z);
    const shade = 0.78 + n * 0.35 + (v.y > 0.55 ? 0.08 : 0) - (v.y < -0.5 ? 0.12 : 0);
    col.push(shade, shade * 0.98, shade * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

/** Unit-radius rock (variant 0..7). detail 0 = 20 faces (debris), 1 = chunky, 2 = smooth-ish. */
export function rockGeometry(variant: number, detail: 0 | 1 | 2 = 1): THREE.BufferGeometry {
  const vi = ((variant % ROCK_VARIANTS) + ROCK_VARIANTS) % ROCK_VARIANTS;
  return shared(`rock:${vi}:${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const s = rand01(vi * 13 + 5);
    const stretch = new THREE.Vector3(0.85 + rand01(vi + 1) * 0.35, 0.7 + rand01(vi + 2) * 0.35, 0.85 + rand01(vi + 3) * 0.3);
    displaceRock(g, vi + s, detail === 0 ? 0.28 : 0.34, stretch);
    return g;
  });
}

/** Rocky column, base at y=0, top at y=height (variant changes the noise). */
export function pillarGeometry(radius: number, height: number, variant = 0, radial = 7): THREE.BufferGeometry {
  const key = `pillar:${radius.toFixed(2)}:${height.toFixed(2)}:${variant % 4}:${radial}`;
  return shared(key, () => {
    const hSeg = Math.max(3, Math.round(height / 0.6));
    const g = new THREE.CylinderGeometry(radius * 0.86, radius * 1.08, height, radial, hSeg, false);
    g.translate(0, height / 2, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col: number[] = [];
    const seed = variant * 5.3 + 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      const top = y > height - 1e-3;
      let ny = y;
      let rr = r;
      if (r > 1e-4) {
        const n = fbm3(Math.cos(a) * 1.3 + seed, y * 0.9, Math.sin(a) * 1.3, 3);
        rr = r * (1 + n * 0.22);
      }
      if (top) ny = y + fbm3(x * 2.2 + seed, 0, z * 2.2, 2) * radius * 0.35 - (r < 1e-4 ? 0 : 0.05);
      pos.setXYZ(i, r > 1e-4 ? (x / r) * rr : x, ny, r > 1e-4 ? (z / r) * rr : z);
      const k = Math.min(1, y / height);
      const strata = 0.06 * Math.sin(y * 7.0 + seed);
      const shade = 0.8 + k * 0.26 + strata + (top ? 0.08 : 0);
      col.push(shade, shade * 0.97, shade * 0.92);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  });
}

/** Slab wall: width along X, height along Y (base at 0), thickness along Z; jagged top & faces. */
export function wallGeometry(width: number, height: number, thick: number, variant = 0): THREE.BufferGeometry {
  const key = `wall:${width.toFixed(2)}:${height.toFixed(2)}:${thick.toFixed(2)}:${variant % 3}`;
  return shared(key, () => {
    const sx = Math.max(4, Math.round(width / 0.45)), sy = Math.max(3, Math.round(height / 0.45));
    const g = new THREE.BoxGeometry(width, height, thick, sx, sy, 2);
    g.translate(0, height / 2, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col: number[] = [];
    const seed = variant * 7.7 + 3;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = fbm3(x * 0.9 + seed, y * 0.9, z * 0.9 - seed, 3);
      const edgeX = Math.abs(x) / (width / 2);
      // Bulge faces outward, round off the vertical edges.
      z *= 1 + n * 0.45;
      if (edgeX > 0.98) x *= 1 + n * 0.08;
      if (y > height - 1e-3) {
        y += fbm3(x * 1.1 + seed, 3, z, 2) * 0.55 - 0.15 - edgeX * edgeX * 0.5;
      }
      pos.setXYZ(i, x, y, z);
      const k = Math.min(1, Math.max(0, y / height));
      const strata = 0.07 * Math.sin(y * 5.5 + x * 0.6 + seed);
      const shade = 0.78 + k * 0.28 + strata + n * 0.1;
      col.push(shade, shade * 0.97, shade * 0.92);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  });
}

/** Stone spike (cone), base at y=0. */
export function spikeGeometry(variant = 0): THREE.BufferGeometry {
  return shared(`spike:${variant % 4}`, () => {
    const g = new THREE.ConeGeometry(1, 1, 6, 4, false);
    g.translate(0, 0.5, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col: number[] = [];
    const seed = variant * 3.9 + 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = fbm3(x * 2 + seed, y * 3, z * 2, 2);
      const lean = rand01(variant + 9) * 0.25 - 0.12;
      pos.setXYZ(i, x * (1 + n * 0.3) + y * lean, y, z * (1 + n * 0.3));
      const shade = 0.76 + y * 0.3 + n * 0.12;
      col.push(shade, shade * 0.97, shade * 0.93);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const materials = new Map<string, THREE.MeshStandardMaterial>();

/** Shared flat-shaded stone material (vertex colours × tint). Never dispose. */
export function stoneMaterial(tint = '#8a7860'): THREE.MeshStandardMaterial {
  let m = materials.get(tint);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.96, metalness: 0, flatShading: true, vertexColors: true });
    m.userData.shared = true;
    materials.set(tint, m);
  }
  return m;
}

const TINTS: Partial<Record<SurfaceType, string>> = {
  grass: '#a08e72',
  tallgrass: '#a08e72',
  dirt: '#9e8264',
  mud: '#6d5a44',
  gravel: '#8a8378',
  sand: '#c4a878',
  rock: '#8b8479',
  stone: '#9a948a',
  cobble: '#928b80',
  plaster: '#a39c90',
  snow: '#9aa0a6',
  packedsnow: '#9aa0a6',
  ice: '#8f98a2',
  wood: '#a08e72',
  ash: '#5a5350',
  lava: '#4a3a34',
  metal: '#8a8580',
};

/** Stone tint for rock torn out of a given ground surface. */
export function earthTint(surface: SurfaceType | undefined): string {
  return (surface && TINTS[surface]) || '#8a7860';
}
