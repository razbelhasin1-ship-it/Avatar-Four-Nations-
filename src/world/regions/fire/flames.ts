import * as THREE from 'three';

/**
 * Instanced, shader-animated flames for braziers, torches, the eternal flame
 * and lava vents. One draw call for every flame in a region: each instance is
 * a camera-facing (Y-axis) quad whose procedural flame flickers with its own
 * phase. Works on every preset (no particles needed); FireAmbience adds a few
 * ember/smoke particles only near the player.
 */

const vertex = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
uniform float uFadeFar;
void main() {
  vUv = uv;
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vSeed = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 toCam = cameraPosition - center.xyz;
  vec3 dir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(dir.z, 0.0, -dir.x);
  // Gentle sway of the tip.
  float sway = sin(uTime * 3.1 + vSeed * 20.0) * 0.08 * uv.y * uv.y;
  vec3 wp = center.xyz + right * (position.x + sway) * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
  // Pull slightly toward the camera so the flame sits in front of the bowl rim.
  wp += dir * 0.15 * sx;
  float dist = length(toCam);
  vFade = 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const fragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
float fh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), u.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float t = uTime * (1.0 + vSeed * 0.4) + vSeed * 17.0;
  vec2 uv = vUv;
  float n1 = fn(vec2(uv.x * 4.0, uv.y * 3.0 - t * 3.2));
  float n2 = fn(vec2(uv.x * 9.0 + 3.1, uv.y * 7.0 - t * 5.5));
  float n = n1 * 0.65 + n2 * 0.35;
  float x = (uv.x - 0.5) * 2.0;
  float y = uv.y;
  // Teardrop silhouette that narrows and breaks up toward the tip.
  float width = (1.0 - pow(y, 1.35)) * (0.55 + 0.45 * sqrt(max(y, 0.0)) ) * 0.95;
  float dx = abs(x + (n1 - 0.5) * 0.5 * y);
  float body = 1.0 - smoothstep(width * 0.55, width + 0.02, dx);
  body *= smoothstep(1.02, 0.35 + n * 0.45, y + (n - 0.5) * 0.25);
  body *= smoothstep(0.0, 0.08, y);
  float core = (1.0 - smoothstep(0.0, width * 0.55, dx)) * (1.0 - smoothstep(0.1, 0.7, y));
  vec3 outer = vec3(1.0, 0.28, 0.04);
  vec3 mid = vec3(1.0, 0.62, 0.16);
  vec3 hot = vec3(1.0, 0.93, 0.62);
  vec3 col = mix(outer, mid, smoothstep(0.15, 0.7, body));
  col = mix(col, hot, core * 0.85);
  float a = body * vFade * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let sharedMaterial: THREE.ShaderMaterial | null = null;
let sharedGeometry: THREE.PlaneGeometry | null = null;
let users = 0;

/** Shared animated flame material (one per app; time advanced by FlameField.tick). */
function flameMaterial(): THREE.ShaderMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.ShaderMaterial({
      name: 'fire_region_flame',
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1.35 }, uFadeFar: { value: 420 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  return sharedMaterial;
}

function flameGeometry(): THREE.PlaneGeometry {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    sharedGeometry.translate(0, 0.5, 0);
  }
  return sharedGeometry;
}

export class FlameField {
  private readonly items: Array<{ x: number; y: number; z: number; w: number; h: number }> = [];
  mesh: THREE.InstancedMesh | null = null;
  private registered = false;

  /** Add a flame whose base is at (x,y,z), w wide and h tall. */
  add(x: number, y: number, z: number, w: number, h: number): void {
    this.items.push({ x, y, z, w, h });
  }

  get count(): number {
    return this.items.length;
  }

  positions(): ReadonlyArray<{ x: number; y: number; z: number; w: number; h: number }> {
    return this.items;
  }

  build(parent: THREE.Object3D): void {
    if (!this.items.length || this.mesh) return;
    const mesh = new THREE.InstancedMesh(flameGeometry(), flameMaterial(), this.items.length);
    const m = new THREE.Matrix4();
    this.items.forEach((f, i) => {
      m.makeScale(f.w, f.h, f.w);
      m.setPosition(f.x, f.y, f.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Billboarding happens in the shader: inflate the bounds a little.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 4;
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 5;
    mesh.name = 'fire_flames';
    parent.add(mesh);
    this.mesh = mesh;
    users++;
    this.registered = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.registered) {
      this.registered = false;
      users--;
      if (users <= 0) {
        users = 0;
        sharedMaterial?.dispose();
        sharedMaterial = null;
        sharedGeometry?.dispose();
        sharedGeometry = null;
      }
    }
    this.items.length = 0;
  }

  /** Advance the shared flame clock (call once per frame from any region). */
  static tick(time: number): void {
    if (sharedMaterial) sharedMaterial.uniforms.uTime.value = time % 1000;
  }

  /** Fade distance: flames beyond this are not drawn (keeps far views clean). */
  static setFadeDistance(d: number): void {
    if (sharedMaterial) sharedMaterial.uniforms.uFadeFar.value = d;
  }
}
