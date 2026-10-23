import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { emblemBanner, flagstones, iceTexture, planks, stoneBlocks } from '../../kit/Textures';
import { createWaterMaterial } from '../../Water';

/**
 * Materials for the Water Tribe regions (Northern / Southern Water Tribe,
 * Meditation Isle).
 *
 * Textured materials use world-space TRIPLANAR mapping (like the shared kit,
 * but with an extra "snow on top" term so every upward face of carved ice
 * gets a dusting of snow). They are cached singletons shared by the three
 * regions and reference-counted: acquireWaterMaterials() on build,
 * releaseWaterMaterials() on dispose; the last release frees GPU resources.
 *
 * Animated materials (canal/pond water, waterfalls, spirit glow) are driven
 * from absolute game time in animateWaterMaterials(), so several regions may
 * call it in the same frame safely.
 */

export type WTMaterialName =
  | 'ice_wall' // carved ice blocks (buildings)
  | 'ice_massive' // big-block ice (city walls, cliffs)
  | 'ice_trim' // deeper blue ice (bands, pillars, canal coping)
  | 'ice_clear' // glassy translucent-looking ice (crystals, ice patches)
  | 'paving' // snow-dusted ice flagstones (streets, plazas)
  | 'snow' // soft snow (caps, drifts)
  | 'dark' // deep blue recesses (doors, windows, arches)
  | 'window' // warm lit window glass
  | 'canal_bed' // dark canal floor under the water surface
  | 'hide' // tanned hide (tents, kayaks)
  | 'hide_dark'
  | 'fur' // white-grey fur trims
  | 'bone' // whalebone / ivory
  | 'wood' // weathered driftwood
  | 'rope'
  | 'grass' // Spirit Oasis / Meditation Isle grass
  | 'moss'
  | 'rock' // grey granite boulders
  | 'rock_dark'
  | 'earth' // packed earth / dirt (bendable earth patch)
  | 'sand'
  | 'stone_floor' // Meditation Isle training circle
  | 'lacquer' // dark red pavilion wood
  | 'roof_slate'
  | 'banner_water'
  | 'banner_moon'
  | 'spirit' // glowing spirit lantern
  | 'lantern_blue'
  | 'fire'
  | 'koi_white'
  | 'koi_black'
  | 'fish' // drying fish
  | 'leaf';

interface Def {
  kind: 'tri' | 'uv' | 'plain' | 'emissive';
  color: string;
  tex?: () => THREE.Texture;
  /** Own texture (disposed with the material). */
  ownTex?: boolean;
  tile?: number;
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  snow?: number;
  side?: THREE.Side;
  transparent?: number;
}

const ownTextures: THREE.Texture[] = [];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  ownTextures.push(t);
  return t;
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/** Large carved ice blocks with soft bevels (city walls). */
function massiveIceTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(77);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#dcecf7');
  grd.addColorStop(1, '#c4dcee');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const rows = 4;
  const rh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    const cols = 2;
    const cw = 256 / cols;
    const off = (y % 2) * (cw / 2);
    for (let x = -1; x <= cols; x++) {
      const bx = x * cw + off;
      g.fillStyle = shade('#d6e9f6', r.range(0.93, 1.06));
      g.fillRect(bx + 2, y * rh + 2, cw - 4, rh - 4);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(bx + 2, y * rh + 2, cw - 4, 3);
      g.fillStyle = 'rgba(40,80,120,0.16)';
      g.fillRect(bx + 2, y * rh + rh - 6, cw - 4, 4);
    }
  }
  g.strokeStyle = 'rgba(70,110,150,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y <= rows; y++) {
    g.beginPath();
    g.moveTo(0, y * rh);
    g.lineTo(256, y * rh);
    g.stroke();
  }
  // faint frost cracks
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = r.range(0, 256), y = r.range(0, 256);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += r.range(-22, 22);
      y += r.range(-22, 22);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

/** Snow-dusted ice flagstones for streets and plazas. */
function pavingTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(91);
  g.fillStyle = '#eef5fb';
  g.fillRect(0, 0, 256, 256);
  const cell = 64;
  for (let y = 0; y < 256; y += cell) {
    const off = ((y / cell) % 2) * 32;
    for (let x = -64; x < 256; x += cell) {
      const inset = 3;
      g.fillStyle = shade('#d2e4f1', r.range(0.94, 1.05));
      g.beginPath();
      g.roundRect(x + off + inset, y + inset, cell - inset * 2, cell - inset * 2, 6);
      g.fill();
      // snow drift in one corner of some slabs
      if (r.chance(0.5)) {
        const grd = g.createRadialGradient(x + off + r.range(10, 54), y + r.range(10, 54), 0, x + off + 32, y + 32, 40);
        grd.addColorStop(0, 'rgba(255,255,255,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x + off, y, cell, cell);
      }
    }
  }
  // sparkle
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,255,${r.range(0.2, 0.7)})`;
    g.fillRect(r.range(0, 256), r.range(0, 256), 1.2, 1.2);
  }
  return toTexture(c);
}

/** Soft snow with subtle wind ripples and sparkle. */
function snowTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(13);
  g.fillStyle = '#f4f8fc';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const y = r.range(0, 256);
    const grd = g.createLinearGradient(0, y - 6, 0, y + 6);
    grd.addColorStop(0, 'rgba(200,220,240,0)');
    grd.addColorStop(0.5, `rgba(200,220,240,${r.range(0.08, 0.2)})`);
    grd.addColorStop(1, 'rgba(200,220,240,0)');
    g.fillStyle = grd;
    g.fillRect(0, y - 6, 256, 12);
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(255,255,255,${r.range(0.3, 0.9)})`;
    g.fillRect(r.range(0, 256), r.range(0, 256), 1, 1);
  }
  return toTexture(c);
}

/** Tanned hide with seams and stitches (UV mapped). */
function hideTexture(base: string, seed: number): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = shade(base, r.range(0.85, 1.12));
    g.globalAlpha = 0.35;
    g.beginPath();
    g.ellipse(r.range(0, 256), r.range(0, 256), r.range(3, 14), r.range(2, 8), r.range(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // panel seams with stitches
  g.strokeStyle = 'rgba(40,24,10,0.55)';
  g.lineWidth = 2;
  for (const x of [64, 160, 230]) {
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) g.lineTo(x + r.range(-3, 3), y);
    g.stroke();
    g.strokeStyle = 'rgba(230,210,170,0.7)';
    g.lineWidth = 1.2;
    for (let y = 4; y < 256; y += 9) {
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x + 4, y + 3);
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,24,10,0.55)';
    g.lineWidth = 2;
  }
  return toTexture(c);
}

function furTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = new Random(5);
  g.fillStyle = '#d9d4cb';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    const x = r.range(0, 128), y = r.range(0, 128);
    g.strokeStyle = r.chance(0.5) ? 'rgba(255,255,255,0.5)' : 'rgba(120,110,100,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + r.range(-2, 2), y + r.range(3, 7));
    g.stroke();
  }
  return toTexture(c);
}

function grassTexture(base: string, seed: number): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 30; i++) {
    const x = r.range(0, 256), y = r.range(0, 256), rad = r.range(20, 70);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${r.chance(0.5) ? '120,160,60' : '40,80,30'},0.25)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 2600; i++) {
    const x = r.range(0, 256), y = r.range(0, 256);
    g.strokeStyle = r.chance(0.5) ? shade(base, r.range(1.1, 1.45)) : shade(base, r.range(0.6, 0.85));
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + r.range(-1.5, 1.5), y - r.range(2, 5));
    g.stroke();
  }
  return toTexture(c);
}

function rockTexture(base: string, seed: number): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = shade(base, r.range(0.75, 1.2));
    g.globalAlpha = 0.4;
    g.beginPath();
    const x = r.range(0, 256), y = r.range(0, 256);
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) g.lineTo(x + r.range(-18, 18), y + r.range(-18, 18));
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 18; i++) {
    let x = r.range(0, 256), y = r.range(0, 256);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += r.range(-25, 25);
      y += r.range(-25, 25);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

function sandTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = new Random(31);
  g.fillStyle = '#d9c79a';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(255,245,220,0.5)' : 'rgba(150,120,80,0.35)';
    g.fillRect(r.range(0, 128), r.range(0, 128), 1, 1);
  }
  for (let i = 0; i < 12; i++) {
    const y = r.range(0, 128);
    g.strokeStyle = 'rgba(160,130,90,0.25)';
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x * 0.1 + i) * 3);
    g.stroke();
  }
  return toTexture(c);
}

function earthTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const r = new Random(41);
  g.fillStyle = '#7a5a3c';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = r.chance(0.5) ? 'rgba(160,120,80,0.45)' : 'rgba(50,34,20,0.45)';
    const s = r.range(1, 3);
    g.fillRect(r.range(0, 128), r.range(0, 128), s, s);
  }
  return toTexture(c);
}

function koiTexture(base: string, spots: string): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const r = new Random(base.length * 17);
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = spots;
    g.beginPath();
    g.ellipse(r.range(8, 56), r.range(8, 56), r.range(4, 10), r.range(3, 7), r.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

function moonBanner(): THREE.Texture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#1d3f73';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#e9f2fb';
  g.fillRect(0, 0, 128, 8);
  g.fillRect(0, 248, 128, 8);
  // crescent moon over waves
  g.beginPath();
  g.arc(64, 96, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d3f73';
  g.beginPath();
  g.arc(78, 86, 30, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e9f2fb';
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const y = 160 + k * 18;
    g.beginPath();
    g.moveTo(24, y);
    g.bezierCurveTo(40, y - 12, 52, y + 12, 64, y);
    g.bezierCurveTo(76, y - 12, 88, y + 12, 104, y);
    g.stroke();
  }
  // tassel points
  g.fillStyle = '#e9f2fb';
  g.beginPath();
  g.moveTo(0, 248);
  g.lineTo(64, 256);
  g.lineTo(128, 248);
  g.fill();
  return toTexture(c);
}

const DEFS: Record<WTMaterialName, Def> = {
  ice_wall: { kind: 'tri', color: '#ffffff', tex: () => iceTexture('#d8ebf7', 151), tile: 4.5, rough: 0.35, emissive: '#16324a', emissiveIntensity: 0.22, snow: 0.85 },
  ice_massive: { kind: 'tri', color: '#ffffff', tex: massiveIceTexture, ownTex: true, tile: 9, rough: 0.4, emissive: '#122c44', emissiveIntensity: 0.2, snow: 0.9 },
  ice_trim: { kind: 'tri', color: '#ffffff', tex: () => iceTexture('#a9d0ea', 152), tile: 3.5, rough: 0.25, emissive: '#10304c', emissiveIntensity: 0.28, snow: 0.5 },
  ice_clear: { kind: 'tri', color: '#cfeeff', tex: () => iceTexture('#bfe4f8', 153), tile: 3, rough: 0.08, metal: 0.05, emissive: '#2a6c96', emissiveIntensity: 0.35, snow: 0.15 },
  paving: { kind: 'tri', color: '#ffffff', tex: pavingTexture, ownTex: true, tile: 6, rough: 0.6, emissive: '#0e2236', emissiveIntensity: 0.12, snow: 0.0 },
  snow: { kind: 'tri', color: '#ffffff', tex: snowTexture, ownTex: true, tile: 7, rough: 0.92, emissive: '#1a2c3c', emissiveIntensity: 0.1, snow: 0 },
  dark: { kind: 'plain', color: '#1b3654', rough: 0.55, emissive: '#06121e', emissiveIntensity: 0.4 },
  window: { kind: 'emissive', color: '#ffd9a0', emissive: '#ffb45a', emissiveIntensity: 0.9, rough: 0.6 },
  canal_bed: { kind: 'plain', color: '#0b2738', rough: 1 },
  hide: { kind: 'uv', color: '#ffffff', tex: () => hideTexture('#b89468', 61), ownTex: true, rough: 0.95, side: THREE.DoubleSide },
  hide_dark: { kind: 'uv', color: '#ffffff', tex: () => hideTexture('#7d5c3e', 62), ownTex: true, rough: 0.95, side: THREE.DoubleSide },
  fur: { kind: 'uv', color: '#ffffff', tex: furTexture, ownTex: true, rough: 1 },
  bone: { kind: 'plain', color: '#e7dcc2', rough: 0.6 },
  wood: { kind: 'uv', color: '#ffffff', tex: () => planks('#7a6450', 171), rough: 0.9 },
  rope: { kind: 'plain', color: '#a8916a', rough: 1 },
  grass: { kind: 'tri', color: '#ffffff', tex: () => grassTexture('#5e9a3e', 7), ownTex: true, tile: 5, rough: 0.95, snow: 0 },
  moss: { kind: 'tri', color: '#ffffff', tex: () => grassTexture('#4c7a3a', 8), ownTex: true, tile: 3, rough: 1, snow: 0 },
  rock: { kind: 'tri', color: '#ffffff', tex: () => rockTexture('#8a8f96', 21), ownTex: true, tile: 4, rough: 0.92, snow: 0.0 },
  rock_dark: { kind: 'tri', color: '#ffffff', tex: () => rockTexture('#5a5f66', 22), ownTex: true, tile: 4, rough: 0.92, snow: 0.0 },
  earth: { kind: 'tri', color: '#ffffff', tex: earthTexture, ownTex: true, tile: 2.5, rough: 1, snow: 0 },
  sand: { kind: 'tri', color: '#ffffff', tex: sandTexture, ownTex: true, tile: 3, rough: 1, snow: 0 },
  stone_floor: { kind: 'tri', color: '#ffffff', tex: () => flagstones('#a7a39a', 181), tile: 4, rough: 0.9, snow: 0 },
  lacquer: { kind: 'uv', color: '#ffffff', tex: () => planks('#7a2a20', 182), rough: 0.55 },
  roof_slate: { kind: 'tri', color: '#ffffff', tex: () => stoneBlocks('#3e4a52', '#00000060', 10, 6, 183), tile: 2.5, rough: 0.7, snow: 0 },
  banner_water: { kind: 'uv', color: '#ffffff', tex: () => emblemBanner('#1e4a86', '#eaf3fc', 'water', '#cfe4f5'), rough: 0.95, side: THREE.DoubleSide },
  banner_moon: { kind: 'uv', color: '#ffffff', tex: moonBanner, ownTex: true, rough: 0.95, side: THREE.DoubleSide },
  spirit: { kind: 'emissive', color: '#d8f4ff', emissive: '#8fe0ff', emissiveIntensity: 2.2, rough: 0.4 },
  lantern_blue: { kind: 'emissive', color: '#bfe6ff', emissive: '#7fcfff', emissiveIntensity: 1.5, rough: 0.5 },
  fire: { kind: 'emissive', color: '#ffb060', emissive: '#ff7a24', emissiveIntensity: 3, rough: 1 },
  koi_white: { kind: 'uv', color: '#ffffff', tex: () => koiTexture('#f4f1ea', '#e8e2d8'), ownTex: true, rough: 0.4 },
  koi_black: { kind: 'uv', color: '#ffffff', tex: () => koiTexture('#1c1c22', '#2a2a32'), ownTex: true, rough: 0.4 },
  fish: { kind: 'plain', color: '#8a8f98', rough: 0.5, metal: 0.2 },
  leaf: { kind: 'plain', color: '#4f8a3a', rough: 0.9, side: THREE.DoubleSide },
};

const cache = new Map<WTMaterialName, THREE.MeshStandardMaterial>();
const tinted = new Map<string, THREE.MeshStandardMaterial>();
let refs = 0;

/** World-space triplanar mapping + snow on upward faces (own program key). */
export function wtTriplanar(mat: THREE.MeshStandardMaterial, tileMetres: number, snow: number): void {
  const uniforms = { wtScale: { value: 1 / tileMetres }, wtSnow: { value: snow }, wtSnowColor: { value: new THREE.Color('#f3f8fc') } };
  mat.userData.wtTriplanar = { tile: tileMetres, snow };
  mat.userData.wtUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.wtScale = uniforms.wtScale;
    shader.uniforms.wtSnow = uniforms.wtSnow;
    shader.uniforms.wtSnowColor = uniforms.wtSnowColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWtWP;\nvarying vec3 vWtWN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 wwp = vec4(transformed, 1.0);
  vec3 wwn = objectNormal;
  #ifdef USE_INSTANCING
    wwp = instanceMatrix * wwp;
    wwn = mat3(instanceMatrix) * wwn;
  #endif
  wwp = modelMatrix * wwp;
  vWtWP = wwp.xyz;
  vWtWN = normalize(mat3(modelMatrix) * wwn);
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float wtScale;
uniform float wtSnow;
uniform vec3 wtSnowColor;
varying vec3 vWtWP;
varying vec3 vWtWN;
float wtHash(vec2 p){ p = fract(p*vec2(127.1, 311.7)); p += dot(p, p+19.19); return fract(p.x*p.y); }
float wtNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(wtHash(i), wtHash(i+vec2(1,0)), u.x), mix(wtHash(i+vec2(0,1)), wtHash(i+vec2(1,1)), u.x), u.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
{
  vec3 kn = abs(normalize(vWtWN));
  kn = pow(kn, vec3(4.0));
  kn /= (kn.x + kn.y + kn.z + 1e-5);
  vec4 tx = texture2D(map, vWtWP.zy * wtScale);
  vec4 ty = texture2D(map, vWtWP.xz * wtScale);
  vec4 tz = texture2D(map, vWtWP.xy * wtScale);
  vec4 sampledDiffuseColor = tx * kn.x + ty * kn.y + tz * kn.z;
  float var = 0.9 + 0.2 * wtNoise(vWtWP.xz * 0.06 + vWtWP.y * 0.04);
  diffuseColor *= sampledDiffuseColor * vec4(vec3(var), 1.0);
}
#endif
{
  float up = smoothstep(0.5, 0.85, normalize(vWtWN).y);
  float n = wtNoise(vWtWP.xz * 0.9) * 0.5 + wtNoise(vWtWP.xz * 3.1) * 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb, wtSnowColor, clamp(up * wtSnow * (0.75 + 0.35 * n), 0.0, 1.0));
}`,
      );
  };
  mat.customProgramCacheKey = () => 'wt-triplanar';
}

function make(name: WTMaterialName): THREE.MeshStandardMaterial {
  const d = DEFS[name];
  const m = new THREE.MeshStandardMaterial({
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
  if (d.kind === 'tri') wtTriplanar(m, d.tile ?? 4, d.snow ?? 0);
  m.name = `wt_${name}`;
  return m;
}

/** Shared Water Tribe material (cached). */
export function wtMat(name: WTMaterialName): THREE.MeshStandardMaterial {
  let m = cache.get(name);
  if (!m) {
    m = make(name);
    cache.set(name, m);
  }
  return m;
}

/** Tinted variant of a Water Tribe material (cached by name + tint). */
export function wtMatTinted(name: WTMaterialName, tint: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const key = `${name}:${new THREE.Color(tint).getHexString()}`;
  let m = tinted.get(key);
  if (m) return m;
  const base = wtMat(name);
  m = base.clone();
  m.color.set(tint);
  const tri = base.userData.wtTriplanar as { tile: number; snow: number } | undefined;
  if (tri) wtTriplanar(m, tri.tile, tri.snow);
  m.name = `wt_${name}_${new THREE.Color(tint).getHexString()}`;
  tinted.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// Animated materials
// ---------------------------------------------------------------------------

const waterMats = new Map<string, THREE.ShaderMaterial>();
let waterfallMat: THREE.ShaderMaterial | null = null;
let foamMat: THREE.ShaderMaterial | null = null;

/** Canal / pond water (animated, shared with the world's water look). */
export function wtWater(kind: 'canal' | 'pond' | 'pool' | 'spirit' = 'canal'): THREE.ShaderMaterial {
  let m = waterMats.get(kind);
  if (m) return m;
  const o =
    kind === 'canal'
      ? { shallow: '#3f8fb2', deep: '#0c3550', opacity: 0.9, waveAmp: 0.025 }
      : kind === 'pool'
        ? { shallow: '#5cb6d4', deep: '#1a5a7c', opacity: 0.84, waveAmp: 0.012 }
        : kind === 'spirit'
          ? { shallow: '#4fa6a8', deep: '#123e46', opacity: 0.88, waveAmp: 0.008 }
          : { shallow: '#4aa0c0', deep: '#11486a', opacity: 0.86, waveAmp: 0.015 };
  m = createWaterMaterial(o);
  m.name = `wt_water_${kind}`;
  waterMats.set(kind, m);
  return m;
}

const fallVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // gentle ripple across the sheet
  wp.xz += normal.xz * sin(uv.y * 9.0 - uTime * 6.0 + uv.x * 5.0) * 0.06;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fallFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vWorld;
float fHash(vec2 p){ p = fract(p*vec2(234.34, 435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
float fNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(fHash(i), fHash(i+vec2(1,0)), u.x), mix(fHash(i+vec2(0,1)), fHash(i+vec2(1,1)), u.x), u.y); }
void main() {
  // uv.x across the sheet (0..width metres), uv.y down the sheet (0 top .. height metres)
  float t = uTime * uSpeed;
  float s1 = fNoise(vec2(vUv.x * 2.2, vUv.y * 0.35 - t));
  float s2 = fNoise(vec2(vUv.x * 6.0 + 3.1, vUv.y * 0.9 - t * 1.6));
  float streak = smoothstep(0.35, 0.95, s1 * 0.6 + s2 * 0.55);
  vec3 col = mix(uDeep, uColor, 0.45 + 0.55 * streak);
  float a = 0.62 + 0.38 * streak;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Animated falling-water sheet (uv: x across in metres, y down in metres). */
export function wtWaterfall(): THREE.ShaderMaterial {
  if (waterfallMat) return waterfallMat;
  waterfallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#f2fbff') },
        uDeep: { value: new THREE.Color('#5fa8cf') },
        uSpeed: { value: 2.2 },
      },
    ]),
    vertexShader: fallVertex,
    fragmentShader: fallFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  waterfallMat.name = 'wt_waterfall';
  return waterfallMat;
}

const foamFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
float fHash(vec2 p){ p = fract(p*vec2(234.34, 435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
float fNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(fHash(i), fHash(i+vec2(1,0)), u.x), mix(fHash(i+vec2(0,1)), fHash(i+vec2(1,1)), u.x), u.y); }
void main() {
  vec2 p = vWorld.xz;
  float n = fNoise(p * 1.7 + vec2(uTime * 0.8, -uTime * 0.6)) * 0.6 + fNoise(p * 4.3 - vec2(uTime * 1.3, uTime)) * 0.4;
  // uv.y: 0 at the impact line .. 1 at the outer edge
  float fade = 1.0 - smoothstep(0.15, 1.0, vUv.y);
  float a = clamp(fade * (0.35 + 0.75 * n), 0.0, 0.95);
  gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Foam patch where falling water hits a pool (uv.y = 0 at the fall line, 1 at the rim). */
export function wtFoam(): THREE.ShaderMaterial {
  if (foamMat) return foamMat;
  foamMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: fallVertex,
    fragmentShader: foamFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  foamMat.name = 'wt_foam';
  return foamMat;
}

let lastAnimFrame = -1;

/**
 * Advance animated materials (idempotent per frame). Also scales window /
 * lantern glow with daylight so cities glow at dusk and night.
 */
export function animateWaterMaterials(ctx: GameContext): void {
  if (ctx.time.frame === lastAnimFrame) return;
  lastAnimFrame = ctx.time.frame;
  const t = ctx.time.elapsed;
  const sky = ctx.world.sky;
  const sun = ctx.render.sunDir;
  for (const m of waterMats.values()) {
    m.uniforms.uTime.value = t;
    m.uniforms.uSunDir.value.copy(sun);
    m.uniforms.uSky.value.copy(sky.horizonColor);
    m.uniforms.uSunColor.value.copy(sky.sunColor);
  }
  if (waterfallMat) waterfallMat.uniforms.uTime.value = t;
  if (foamMat) foamMat.uniforms.uTime.value = t;
  const night = 1 - Math.max(0, Math.min(1, sky.daylight ?? 1));
  const win = cache.get('window');
  if (win) win.emissiveIntensity = 0.55 + 1.6 * night;
  const lb = cache.get('lantern_blue');
  if (lb) lb.emissiveIntensity = 1.1 + 1.4 * night;
  const sp = cache.get('spirit');
  if (sp) sp.emissiveIntensity = 1.6 + 1.6 * night + 0.25 * Math.sin(t * 1.7);
}

/** Take a reference on the shared Water Tribe materials (call once per region build). */
export function acquireWaterMaterials(): void {
  refs++;
}

/** Drop a reference; the last release disposes every material and own texture. */
export function releaseWaterMaterials(): void {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  for (const m of cache.values()) m.dispose();
  for (const m of tinted.values()) m.dispose();
  for (const m of waterMats.values()) m.dispose();
  waterfallMat?.dispose();
  foamMat?.dispose();
  for (const t of ownTextures) t.dispose();
  cache.clear();
  tinted.clear();
  waterMats.clear();
  waterfallMat = null;
  foamMat = null;
  ownTextures.length = 0;
}
