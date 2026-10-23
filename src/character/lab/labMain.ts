import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import '../clips';
import { cloneAppearance, type Appearance } from '../Appearance';
import { buildCache } from '../CharacterBuild';
import { atlasCache } from '../ClothAtlas';
import { Humanoid } from '../Humanoid';
import { lookSet, setNpcSampler } from '../lookSets';

/**
 * Standalone character lab (dev tool, not part of the game build):
 *   /src/character/lab/index.html   → window.__lab API for screenshots and tests.
 * Renders humanoids in a studio without booting the world, so character work
 * can be verified even while other systems are mid-edit.
 */

interface LabOpts {
  looks?: Array<Appearance | string> | string;
  cols?: number;
  spacing?: number;
  rowSpacing?: number;
  /** Per-row offsets (head-shot grids: rows lower and closer). */
  rowY?: number;
  rowZ?: number;
  cam?: { pos: [number, number, number]; look: [number, number, number]; fov?: number };
  bg?: [string, string];
  yaw?: number;
  style?: string;
  idle?: string;
  lod?: 0 | 1;
  bloom?: boolean;
  shadows?: boolean;
}

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.03, 200);
let humans: Humanoid[] = [];
let disposables: Array<{ dispose(): void }> = [];
let composer: EffectComposer | null = null;

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}
window.addEventListener('resize', resize);

function resolveLooks(looks: LabOpts['looks']): Appearance[] {
  if (!looks) return lookSet('defaults');
  if (typeof looks === 'string') return lookSet(looks);
  return looks.map((l) => (typeof l === 'string' ? lookSet(l)[0] : cloneAppearance(l)));
}

function clear(): void {
  for (const h of humans) h.dispose();
  for (const d of disposables) d.dispose();
  humans = [];
  disposables = [];
  scene = new THREE.Scene();
  composer?.dispose();
  composer = null;
}

function open(o: LabOpts = {}): { count: number; stats: unknown[] } {
  clear();
  const looks = resolveLooks(o.looks);
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x5a5048, 1.2));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
  key.position.set(2.5, 4.5, 3.5);
  key.castShadow = !!o.shadows;
  key.shadow.mapSize.set(1024, 1024);
  (key.shadow.camera as THREE.OrthographicCamera).left = -4;
  (key.shadow.camera as THREE.OrthographicCamera).right = 4;
  (key.shadow.camera as THREE.OrthographicCamera).top = 4;
  (key.shadow.camera as THREE.OrthographicCamera).bottom = -2;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.65);
  fill.position.set(-3, 2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.5);
  rim.position.set(-2, 3, -4);
  scene.add(rim);
  const [top, bottom] = o.bg ?? ['#dfe8ee', '#86929c'];
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP;\nvoid main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top;\nuniform vec3 bottom;\nvarying vec3 vP;\nvoid main(){ float t = clamp(normalize(vP).y*0.9+0.45,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0);\n#include <colorspace_fragment>\n}',
    side: THREE.BackSide,
    depthWrite: false,
  });
  const bgGeo = new THREE.SphereGeometry(90, 32, 16);
  scene.add(new THREE.Mesh(bgGeo, bgMat));
  const gGeo = new THREE.CircleGeometry(40, 48);
  const gMat = new THREE.MeshStandardMaterial({ color: '#b5a88f', roughness: 0.95 });
  const ground = new THREE.Mesh(gGeo, gMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  disposables.push(bgGeo, bgMat, gGeo, gMat);
  const cols = o.cols ?? Math.min(looks.length, 8);
  const sp = o.spacing ?? 0.85;
  const rs = o.rowSpacing ?? sp * 1.6;
  looks.forEach((a, i) => {
    const h = new Humanoid(a, { castShadow: !!o.shadows, lod: o.lod === 1 ? 'low' : 'high' });
    const r = Math.floor(i / cols), c = i % cols;
    const n = Math.min(cols, looks.length - r * cols);
    h.root.position.set((c - (n - 1) / 2) * sp, -r * (o.rowY ?? 0), o.rowZ !== undefined ? r * o.rowZ : -r * rs);
    h.root.rotation.y = o.yaw ?? 0;
    h.animator.loco.style = (o.style as never) ?? 'neutral';
    if (o.idle) h.animator.loco.idleVariant = o.idle as never;
    scene.add(h.root);
    humans.push(h);
  });
  const rows = Math.ceil(looks.length / cols);
  const w = Math.max(1, (cols - 1) * sp + 0.8);
  const dist = Math.max(3.4, w * 1.95) + (rows - 1) * 1.2;
  const cam = o.cam ?? { pos: [0, 1.2, dist] as [number, number, number], look: [0, 0.92, -((rows - 1) * rs) / 2] as [number, number, number] };
  camera.fov = o.cam?.fov ?? 30;
  camera.position.set(...cam.pos);
  camera.lookAt(...cam.look);
  resize();
  if (o.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.6, 0.5, 0.86));
    composer.addPass(new OutputPass());
    resize();
  }
  step(2);
  return { count: humans.length, stats: humans.map((h) => h.stats) };
}

function render(): void {
  scene.updateMatrixWorld(true);
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

function step(n = 1, dt = 1 / 30): void {
  for (let i = 0; i < n; i++) for (const h of humans) h.update(dt);
  render();
}

/** Pose all humanoids at time t of a clip (null = locomotion only). */
function pose(clipId: string | null, t = 0, style?: string): void {
  for (const h of humans) {
    const an = h.animator;
    if (style) an.loco.style = style as never;
    an.stop(undefined, 0);
    for (let k = 0; k < 20; k++) h.update(1 / 30);
    if (clipId) {
      an.play(clipId, { fadeIn: 0, hold: true });
      const steps = Math.max(1, Math.round(t * 120));
      for (let k = 0; k < steps; k++) h.update(t / steps);
    }
  }
  render();
}

const api = {
  open,
  step,
  pose,
  render,
  glow(eyes: number, tattoos: number, color = '#c8ecff') {
    humans.forEach((h) => h.setGlow(eyes, tattoos, color));
    render();
  },
  camera(pos: [number, number, number], look: [number, number, number], fov?: number) {
    camera.position.set(...pos);
    if (fov) camera.fov = fov;
    camera.lookAt(...look);
    camera.updateProjectionMatrix();
    render();
  },
  yaw(y: number) {
    humans.forEach((h) => (h.root.rotation.y = y));
    render();
  },
  each(fn: (h: Humanoid, i: number) => void) {
    humans.forEach(fn);
  },
  loco(patch: Record<string, unknown>) {
    humans.forEach((h) => Object.assign(h.animator.loco, patch));
  },
  humans: () => humans,
  stats: () => ({ humans: humans.map((h) => h.stats), cache: { builds: buildCache.size, atlases: atlasCache.size }, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  lookSet,
  THREE,
  Humanoid,
  errors: [] as string[],
};
window.addEventListener('error', (e) => api.errors.push(String(e.message)));
(window as unknown as { __lab: typeof api }).__lab = api;

// NPC samples need the NPC system; load lazily so the lab survives unrelated breakage.
import('../../npc/NPCSystem')
  .then((m) => setNpcSampler(m.generateAppearance))
  .catch(() => {})
  .finally(() => {
    resize();
    (window as unknown as { __ready: boolean }).__ready = true;
  });
