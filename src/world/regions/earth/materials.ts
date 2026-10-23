import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { emblemBanner, flagstones } from '../../kit/Textures';

/**
 * Earth-region materials that the shared kit does not provide: planar ground
 * paving (with polygon offset so it never z-fights the terrain), foliage,
 * crop fields, the Earth Kingdom banner/plaque and a few accents.
 *
 * Reference counted across the three Earth regions; kit textures used here are
 * cached by the kit and are NOT disposed by us.
 */

export interface EarthMaterials {
  groundLower: THREE.MeshStandardMaterial;
  groundMiddle: THREE.MeshStandardMaterial;
  groundUpper: THREE.MeshStandardMaterial;
  groundDirt: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  leafDark: THREE.MeshStandardMaterial;
  leafLight: THREE.MeshStandardMaterial;
  blossom: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  hedge: THREE.MeshStandardMaterial;
  reed: THREE.MeshStandardMaterial;
  hay: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  plaque: THREE.MeshStandardMaterial;
  rope: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  trainBody: THREE.MeshStandardMaterial;
  trainWindow: THREE.MeshStandardMaterial;
  crops: THREE.MeshStandardMaterial[];
  paddy: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  all: THREE.Material[];
  textures: THREE.Texture[];
}

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D, r: Random) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  paint(g, new Random(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function cropTexture(kind: 'cabbage' | 'wheat' | 'tea' | 'fallow' | 'millet', seed: number): THREE.CanvasTexture {
  return canvasTex(128, 128, (g, r) => {
    const soil = kind === 'fallow' ? '#7a5c3a' : '#6a5034';
    g.fillStyle = soil;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = r.chance(0.5) ? '#5a422a' : '#86683f';
      g.globalAlpha = 0.4;
      g.fillRect(r.range(0, 128), r.range(0, 128), 2, 2);
    }
    g.globalAlpha = 1;
    if (kind === 'fallow') {
      for (let y = 0; y < 128; y += 8) {
        g.fillStyle = 'rgba(40,25,10,0.35)';
        g.fillRect(0, y, 128, 2);
      }
      return;
    }
    const rows = kind === 'wheat' || kind === 'millet' ? 16 : 8;
    const rh = 128 / rows;
    for (let y = 0; y < rows; y++) {
      if (kind === 'cabbage') {
        for (let x = 4; x < 128; x += 16) {
          const cx = x + r.range(-1, 1), cy = y * rh + rh / 2;
          g.fillStyle = r.pick(['#6fa04a', '#7cb050', '#8abc5c']);
          g.beginPath();
          g.arc(cx, cy, r.range(5, 6.5), 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(220,240,180,0.35)';
          g.beginPath();
          g.arc(cx - 1.5, cy - 1.5, 2.5, 0, Math.PI * 2);
          g.fill();
        }
      } else if (kind === 'tea') {
        g.fillStyle = '#3f6a32';
        g.fillRect(0, y * rh + 1, 128, rh - 4);
        for (let x = 0; x < 128; x += 3) {
          g.fillStyle = r.pick(['#4a7a3a', '#365c2c', '#5a8a44']);
          g.fillRect(x, y * rh + 1 + r.range(0, rh - 6), 3, 3);
        }
      } else {
        const base = kind === 'wheat' ? '#d4b45a' : '#b8a44a';
        g.fillStyle = base;
        g.fillRect(0, y * rh, 128, rh - 2);
        for (let x = 0; x < 128; x += 2) {
          g.fillStyle = r.pick(['#e6c86a', '#c4a248', '#d8bc5e', '#a88a3a']);
          g.fillRect(x, y * rh + r.range(0, rh - 3), 1, r.range(2, 4));
        }
      }
    }
  }, seed);
}

let shared: EarthMaterials | null = null;
let refs = 0;

function ground(tex: THREE.Texture, tint: string, offset = -2): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.92, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = offset;
  m.polygonOffsetUnits = offset * 2;
  return m;
}

function create(): EarthMaterials {
  const textures: THREE.Texture[] = [];
  const own = (t: THREE.CanvasTexture) => {
    textures.push(t);
    return t;
  };
  const crops = (['cabbage', 'wheat', 'tea', 'fallow', 'millet'] as const).map((k, i) => {
    const m = ground(own(cropTexture(k, 300 + i)), '#ffffff', -3);
    m.name = `earth_crop_${k}`;
    return m;
  });
  const paddyTex = own(
    canvasTex(64, 64, (g, r) => {
      g.fillStyle = '#4f7a6a';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r.pick(['#7aa860', '#8ab868', '#6a9a50']);
        g.fillRect(Math.floor(r.range(0, 16)) * 4 + 1, Math.floor(r.range(0, 16)) * 4 + 1, 2, 2);
      }
    }, 410),
  );
  const paddy = new THREE.MeshStandardMaterial({ map: paddyTex, color: '#cfe0d8', roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.92 });
  paddy.polygonOffset = true;
  paddy.polygonOffsetFactor = -3;
  paddy.polygonOffsetUnits = -6;
  const bannerTex = emblemBanner('#2f6a3a', '#e8c35a', 'earth', '#d6b25e');
  const plaqueTex = own(
    canvasTex(128, 128, (g) => {
      g.fillStyle = '#2f5a36';
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d8b04a';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(64, 64, 56, 0, Math.PI * 2);
      g.stroke();
      // Earth Kingdom emblem: square within a circle, with base bars.
      g.lineWidth = 7;
      g.strokeRect(40, 40, 48, 48);
      g.beginPath();
      g.arc(64, 64, 14, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(36, 100);
      g.lineTo(92, 100);
      g.stroke();
    }, 1),
  );
  const m: Omit<EarthMaterials, 'all' | 'textures'> = {
    groundLower: ground(flagstones('#8f8370', 71), '#ffffff'),
    groundMiddle: ground(flagstones('#b5a88c', 72), '#ffffff'),
    groundUpper: ground(flagstones('#cfc4ac', 73), '#ffffff'),
    groundDirt: ground(flagstones('#8a7458', 74), '#e8dcc8'),
    road: ground(flagstones('#a0937a', 75), '#ffffff', -4),
    leaf: new THREE.MeshStandardMaterial({ color: '#4f7f3a', roughness: 0.85, flatShading: true }),
    leafDark: new THREE.MeshStandardMaterial({ color: '#33592c', roughness: 0.85, flatShading: true }),
    leafLight: new THREE.MeshStandardMaterial({ color: '#7a9e48', roughness: 0.85, flatShading: true }),
    blossom: new THREE.MeshStandardMaterial({ color: '#e8a8b8', roughness: 0.8, flatShading: true }),
    bark: new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.95 }),
    hedge: new THREE.MeshStandardMaterial({ color: '#3f6a34', roughness: 0.9, flatShading: true }),
    reed: new THREE.MeshStandardMaterial({ color: '#8a9a5a', roughness: 0.9, side: THREE.DoubleSide }),
    hay: new THREE.MeshStandardMaterial({ color: '#c8a85a', roughness: 1, flatShading: true }),
    banner: new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.95, side: THREE.DoubleSide }),
    plaque: new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.5, metalness: 0.3 }),
    rope: new THREE.MeshStandardMaterial({ color: '#3a2c20', roughness: 1 }),
    rail: new THREE.MeshStandardMaterial({ color: '#3c3f44', roughness: 0.5, metalness: 0.6 }),
    trainBody: new THREE.MeshStandardMaterial({ color: '#3f6e4a', roughness: 0.55, metalness: 0.2 }),
    trainWindow: new THREE.MeshStandardMaterial({ color: '#2a2a22', emissive: '#ffc070', emissiveIntensity: 0.3, roughness: 0.3 }),
    crops,
    paddy,
    sand: ground(flagstones('#c8b48a', 76), '#efe4cc'),
    water: new THREE.MeshStandardMaterial({ color: '#3f8fa8', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }),
  };
  const all: THREE.Material[] = [];
  for (const v of Object.values(m)) {
    if (Array.isArray(v)) all.push(...v);
    else all.push(v as THREE.Material);
  }
  return { ...m, all, textures };
}

export function acquireEarthMaterials(): EarthMaterials {
  if (!shared) shared = create();
  refs++;
  return shared;
}

export function releaseEarthMaterials(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    for (const m of shared.all) m.dispose();
    for (const t of shared.textures) t.dispose();
    shared = null;
  }
}
