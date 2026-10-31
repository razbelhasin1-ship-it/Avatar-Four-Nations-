import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { emblemBanner, roofTiles } from '../../kit/Textures';
import { createWaterMaterial } from '../../Water';
import { attachEnvUniforms } from '../../env/EnvShared';

/**
 * Air Temple specific materials (teal-blue roof tiles, labyrinth paving, straw,
 * foliage, lit windows, banners, temple water). Shared by the air region
 * modules with a reference count: created lazily, disposed when the last
 * region releases them. Kit-cached textures (roofTiles/emblemBanner) are left
 * to the kit's own cache.
 */

export type AirMaterialName =
  | 'roof' // deep blue tiles: tower cones, portals
  | 'roofTrim'
  | 'roofSlate' // blue-grey tiles: tiered hall roofs
  | 'roofTeal' // teal tiles: the garden pavilion
  | 'trimOrange' // warm orange-yellow painted trim
  | 'vine'
  | 'rockSpire' // weathered grey-brown rock of the spires
  | 'labyrinth'
  | 'courtRings' // courtyard paving in concentric rings
  | 'straw'
  | 'strawBand'
  | 'grass'
  | 'foliage'
  | 'window'
  | 'banner'
  | 'bannerYellow'
  | 'water'
  | 'falls'
  | 'shadow'
  | 'rope'
  | 'paintTeal'
  | 'mosaic'
  | 'leaf'
  | 'blossom';

let refs = 0;
const mats = new Map<AirMaterialName, THREE.Material>();
const ownTextures: THREE.Texture[] = [];

export function acquireAirMaterials(): void {
  refs++;
}

export function releaseAirMaterials(): void {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  for (const m of mats.values()) m.dispose();
  mats.clear();
  for (const t of ownTextures) t.dispose();
  ownTextures.length = 0;
}

/** All created materials (for per-frame uniform tweaks such as window glow). */
export function airMaterialIfCreated(name: AirMaterialName): THREE.Material | undefined {
  return mats.get(name);
}

export function airMat(name: AirMaterialName): THREE.Material {
  let m = mats.get(name);
  if (m) return m;
  m = create(name);
  m.name = `air_${name}`;
  mats.set(name, m);
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  ownTextures.push(t);
  return t;
}

function create(name: AirMaterialName): THREE.Material {
  switch (name) {
    case 'roof':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: roofTiles('#2f63a8', 147), roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
    case 'roofTrim':
      return new THREE.MeshStandardMaterial({ color: '#21477a', roughness: 0.5, metalness: 0.1 });
    case 'roofSlate':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: roofTiles('#5f7891', 148), roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    case 'roofTeal':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: roofTiles('#2b9fb6', 149), roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
    case 'trimOrange':
      return new THREE.MeshStandardMaterial({ color: '#e39a35', roughness: 0.6 });
    case 'vine':
      return new THREE.MeshStandardMaterial({ color: '#4a7a36', roughness: 0.9, flatShading: true });
    case 'rockSpire': {
      const t = canvasTex(256, 256, (g) => {
        const r = new Random(919);
        g.fillStyle = '#8a8378';
        g.fillRect(0, 0, 256, 256);
        // vertical weathering streaks and horizontal bedding
        for (let i = 0; i < 70; i++) {
          g.fillStyle = r.pick(['#6f695f', '#9a9284', '#7d766b', '#a59d8e', '#5f5a52']);
          g.globalAlpha = r.range(0.25, 0.6);
          g.fillRect(r.range(0, 256), 0, r.range(2, 9), 256);
        }
        for (let i = 0; i < 14; i++) {
          g.fillStyle = r.pick(['#5c574f', '#b0a898']);
          g.globalAlpha = r.range(0.15, 0.35);
          g.fillRect(0, r.range(0, 256), 256, r.range(1, 4));
        }
        g.globalAlpha = 1;
      });
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: t, roughness: 0.95 });
    }
    case 'paintTeal':
      return new THREE.MeshStandardMaterial({ color: '#2f9fb1', roughness: 0.6 });
    case 'labyrinth':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: labyrinthTexture(), roughness: 0.92 });
    case 'courtRings':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: courtRingsTexture(), roughness: 0.9 });
    case 'mosaic':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: mosaicTexture(), roughness: 0.85 });
    case 'straw':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: strawTexture(), roughness: 1 });
    case 'strawBand':
      return new THREE.MeshStandardMaterial({ color: '#4f7a3c', roughness: 0.9 });
    case 'grass': {
      const t = canvasTex(128, 128, (g) => {
        const r = new Random(808);
        g.fillStyle = '#6f9a4e';
        g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 1400; i++) {
          g.fillStyle = r.pick(['#5d8a40', '#7fae58', '#87b25c', '#4f7a36', '#9cbf6a']);
          g.globalAlpha = r.range(0.3, 0.8);
          g.fillRect(r.range(0, 128), r.range(0, 128), r.range(1, 3), r.range(2, 5));
        }
        g.globalAlpha = 1;
      });
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: t, roughness: 1 });
    }
    case 'foliage':
      return swaying(new THREE.MeshStandardMaterial({ color: '#41723f', roughness: 0.95, flatShading: true }), 'foliage');
    case 'leaf':
      return swaying(new THREE.MeshStandardMaterial({ color: '#6f9f48', roughness: 0.92, flatShading: true }), 'leaf');
    case 'blossom':
      return swaying(new THREE.MeshStandardMaterial({ color: '#f3c2cf', roughness: 0.9, flatShading: true }), 'blossom');
    case 'window':
      return new THREE.MeshStandardMaterial({ color: '#202830', roughness: 0.7, emissive: '#ffb860', emissiveIntensity: 0 });
    case 'banner':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: emblemBanner('#dd7f25', '#fff1d0', 'air', '#f2cf6a'), roughness: 0.95, side: THREE.DoubleSide });
    case 'bannerYellow':
      return new THREE.MeshStandardMaterial({ color: '#ffffff', map: emblemBanner('#efb23a', '#fff6dc', 'air', '#c8642a'), roughness: 0.95, side: THREE.DoubleSide });
    case 'water':
      return createWaterMaterial({ shallow: '#74d3dc', deep: '#1f7c96', absorb: 0.6, opacity: 0.8, foam: 0.4, waveAmp: 0 });
    case 'falls':
      return createWaterMaterial({ shallow: '#c6eef4', deep: '#5fb2c6', absorb: 0.4, opacity: 0.92, flowSpeed: 2.6, foam: 0.9, waveAmp: 0 });
    case 'shadow':
      return new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 1 });
    case 'rope':
      return new THREE.MeshStandardMaterial({ color: '#7a6a52', roughness: 1 });
  }
}

/** Courtyard paving in concentric rings of cream and warm stone, an air swirl medallion at the centre. */
function courtRingsTexture(): THREE.Texture {
  const S = 1024;
  return canvasTex(S, S, (g) => {
    const r = new Random(2024);
    const c = S / 2;
    g.fillStyle = '#d9c9a3';
    g.fillRect(0, 0, S, S);
    const rings = 9;
    for (let i = rings; i >= 1; i--) {
      const R = (c * i) / rings;
      g.beginPath();
      g.arc(c, c, R, 0, Math.PI * 2);
      g.fillStyle = i % 2 ? '#e8dcbf' : '#c9b083';
      g.fill();
      // slabs: radial joints
      const n = 8 + i * 6;
      g.strokeStyle = 'rgba(80,60,35,0.35)';
      g.lineWidth = 2;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + r.range(-0.02, 0.02);
        const r0 = (c * (i - 1)) / rings;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
        g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
        g.stroke();
      }
      g.beginPath();
      g.arc(c, c, R, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(70,50,30,0.6)';
      g.lineWidth = 4;
      g.stroke();
    }
    // Centre medallion: the air nomad swirl in warm orange on cream.
    g.beginPath();
    g.arc(c, c, c / rings - 6, 0, Math.PI * 2);
    g.fillStyle = '#f2e7cc';
    g.fill();
    g.strokeStyle = '#d88a2e';
    g.lineWidth = 10;
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2;
      g.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const a = a0 + t * Math.PI * 1.6, rr = 6 + t * (c / rings - 22);
        const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Round labyrinth paving: concentric circuits with turns, an ornamental border and an air emblem at the centre. */
function labyrinthTexture(): THREE.Texture {
  const S = 1024;
  return canvasTex(S, S, (g) => {
    const r = new Random(4711);
    const cx = S / 2, cy = S / 2;
    const R = S / 2;
    // Stone base with subtle slab variation.
    g.fillStyle = '#d6c49c';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r.pick(['#cdb98e', '#ddcca6', '#e3d4b0', '#c9b588']);
      g.globalAlpha = r.range(0.25, 0.6);
      const s = r.range(2, 9);
      g.fillRect(r.range(0, S), r.range(0, S), s, s);
    }
    g.globalAlpha = 1;
    // Path bands (alternating subtle tones) between circuit walls.
    const N = 9;
    const rIn = R * 0.17, rOut = R * 0.9;
    const radii: number[] = [];
    for (let i = 0; i <= N; i++) radii.push(rIn + ((rOut - rIn) * i) / N);
    for (let i = N - 1; i >= 0; i--) {
      g.beginPath();
      g.arc(cx, cy, radii[i + 1], 0, Math.PI * 2);
      g.fillStyle = i % 2 ? '#dccba4' : '#e6d8b6';
      g.fill();
    }
    // Circuit walls (grooves) with gaps, plus radial turning walls.
    g.strokeStyle = '#5f4a2e';
    g.lineCap = 'round';
    g.lineWidth = 12;
    const gapsFor: number[] = [];
    for (let i = 0; i <= N; i++) {
      const gap = r.range(0, Math.PI * 2);
      gapsFor.push(gap);
      const half = i === N ? 0.07 : 0.11;
      g.beginPath();
      g.arc(cx, cy, radii[i], gap + half, gap + Math.PI * 2 - half);
      g.stroke();
    }
    for (let i = 0; i < N; i++) {
      const turns = 2 + (i % 2);
      for (let k = 0; k < turns; k++) {
        const a = gapsFor[i] + Math.PI * (0.35 + (k * 1.3) / turns) + r.range(-0.2, 0.2);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * radii[i], cy + Math.sin(a) * radii[i]);
        g.lineTo(cx + Math.cos(a) * radii[i + 1], cy + Math.sin(a) * radii[i + 1]);
        g.stroke();
      }
    }
    // Ornamental border: thick ring with lunations.
    g.lineWidth = 12;
    g.strokeStyle = '#7d6644';
    g.beginPath();
    g.arc(cx, cy, R * 0.955, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      g.beginPath();
      g.arc(cx + Math.cos(a) * R * 0.927, cy + Math.sin(a) * R * 0.927, R * 0.022, 0, Math.PI * 2);
      g.stroke();
    }
    // Centre medallion with the air emblem.
    g.beginPath();
    g.arc(cx, cy, rIn * 0.92, 0, Math.PI * 2);
    g.fillStyle = '#2f9db2';
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#e9d9a8';
    g.stroke();
    g.strokeStyle = '#f4ead0';
    g.lineWidth = 12;
    const s = rIn * 0.32;
    for (const [ox, oy, rot] of [[0, -0.85, 0], [-0.75, 0.45, 2.1], [0.75, 0.45, 4.2]] as Array<[number, number, number]>) {
      g.beginPath();
      g.arc(cx + ox * s, cy + oy * s, s * 0.55, rot, rot + Math.PI * 1.6);
      g.stroke();
    }
  });
}

/** Teal & cream tile mosaic for pool floors and medallions. */
function mosaicTexture(): THREE.Texture {
  return canvasTex(256, 256, (g) => {
    const r = new Random(99);
    g.fillStyle = '#e9e0c8';
    g.fillRect(0, 0, 256, 256);
    const n = 16;
    const c = 256 / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5);
        const ring = Math.floor(d) % 3;
        g.fillStyle = ring === 0 ? r.pick(['#2f9fb3', '#3aaabc', '#2a8ea3']) : ring === 1 ? r.pick(['#e8dcc0', '#efe6cf']) : r.pick(['#d9b45c', '#cfa54c']);
        g.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
      }
    }
  });
}

/** Straw: golden streaks along U. */
function strawTexture(): THREE.Texture {
  return canvasTex(128, 128, (g) => {
    const r = new Random(5150);
    g.fillStyle = '#cfa94e';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 520; i++) {
      g.strokeStyle = r.pick(['#e2c56f', '#b88f35', '#d9b85a', '#f0d88a', '#a67f2e']);
      g.globalAlpha = r.range(0.4, 0.9);
      g.lineWidth = r.range(0.6, 1.8);
      const x = r.range(0, 128), y = r.range(0, 128);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + r.range(10, 30), y + r.range(-3, 3));
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/**
 * Trees sway in the wind: instanced pines and orchard trees bend with their height above the
 * trunk's foot, phase-shifted by where they stand (merged geometry, such as the moss on the
 * spires, is left still).
 */
function swaying(m: THREE.MeshStandardMaterial, key: string): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    attachEnvUniforms(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uEnvTime;\nuniform vec4 uWind;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float h = max(0.0, transformed.y - 0.8);
  float gust = 0.7 + 0.3 * sin(uEnvTime * 0.37 + o.x * 0.013);
  float ph = uEnvTime * 1.25 + o.x * 0.21 + o.z * 0.17;
  float k = h * h * 0.012 * gust * (0.8 + 0.4 * clamp(length(uWind.xy), 0.0, 1.0));
  transformed.x += sin(ph) * k;
  transformed.z += cos(ph * 0.83) * k * 0.7;
}
#endif`,
    );
  };
  m.customProgramCacheKey = () => `air_sway_${key}`;
  return m;
}
