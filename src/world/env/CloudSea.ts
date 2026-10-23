import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { LANDFORMS } from '../Heightfield';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_PARS_GLSL, envUniforms } from './EnvShared';

/**
 * The sea of clouds around the Air Temple massif: a stack of soft, lit cloud
 * sheets below the summit. Peaks and needle spires pierce it (sheets fade where
 * the terrain reaches their altitude, read from the world height texture), the
 * tops are sun-lit with blue-grey shadowed hollows, it drifts with the wind and
 * thins toward its rim. Walking up the temple trail you climb through it.
 */

const LAYERS = 5;
const BASE_Y = 148;
const STEP_Y = 9;
const RADIUS = 1250;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uLayerY;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  wp.y = uLayerY;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${ENV_PARS_GLSL}
uniform sampler2D uNoise;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uLayerT;   // 0 bottom .. 1 top layer
uniform float uLayerY;
uniform vec2 uDrift;
uniform float uCover;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
float cloudDensity( vec2 p ) {
  float a = texture2D( uNoise, p * 0.0011 + uDrift ).r;
  float b = texture2D( uNoise, p * 0.0037 - uDrift * 1.7 + 0.31 ).g;
  float c = texture2D( uNoise, p * 0.011 + uDrift * 2.9 ).r;
  return a * 0.55 + b * 0.35 + c * 0.18;
}
void main() {
  vec2 p = vWorld.xz;
  float dist = length( p - uCenter );
  float rim = 1.0 - smoothstep( uRadius * 0.5, uRadius, dist );
  float d = cloudDensity( p );
  // Lower sheets are dense, upper ones only keep the tops of billowy domes.
  float thr = mix( 0.4, 0.66, uLayerT ) - uCover * 0.08;
  float dens = smoothstep( thr, thr + 0.14, d ) * rim;
  // Wrap around peaks: fade where the terrain reaches this altitude.
  float ground = texture2D( uHeightTex, ( p - uHeightTexInfo.xy ) * uHeightTexInfo.z ).r;
  dens *= smoothstep( -4.0, 16.0, uLayerY - ground );
  if ( dens < 0.01 ) discard;
  // Lighting: bright sun-lit domes, cool blue-grey hollows and lower sheets.
  vec2 sd = normalize( uSunDir.xz + 1e-4 );
  float dl = cloudDensity( p + sd * 30.0 );
  float lit = clamp( 0.6 + ( d - dl ) * 3.0, 0.0, 1.0 );
  float top = smoothstep( thr, thr + 0.3, d ) * 0.6 + uLayerT * 0.4;
  float skyL = dot( uSkyZenith, vec3( 0.3, 0.5, 0.2 ) );
  vec3 ambient = mix( vec3( skyL ), uSkyZenith, 0.35 ) * 0.55 + vec3( 0.22, 0.24, 0.28 );
  vec3 sunL = uSunColor * clamp( uSunDir.y * 1.6 + 0.25, 0.25, 1.0 );
  vec3 albedo = vec3( 0.96, 0.97, 1.0 );
  vec3 col = albedo * ( ambient * mix( 0.58, 1.0, top ) + sunL * 0.7 * lit * mix( 0.3, 1.0, top ) );
  // Cool blue-grey in the hollows between domes.
  col = mix( col * vec3( 0.86, 0.9, 1.0 ), col, smoothstep( 0.2, 0.8, top ) );
  // Silver lining when looking toward the sun.
  float vdS = max( dot( normalize( vWorld - cameraPosition ), uSunDir ), 0.0 );
  col += uSunColor * pow( vdS, 8.0 ) * 0.3 * ( 1.0 - dens * 0.6 );
  col *= mix( 0.18, 1.0, uDaylight );
  float alpha = dens * mix( 0.9, 0.75, uLayerT );
  // Close to the camera the sheet becomes thin mist instead of a hard plane.
  float camD = abs( cameraPosition.y - uLayerY );
  alpha *= smoothstep( 0.0, 18.0, camD + length( vWorld.xz - cameraPosition.xz ) * 0.15 );
  // Partial fog: the deck is a landmark that should read from afar, softened by haze rather than erased.
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float cFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float cFog = smoothstep( fogNear, fogFar * 1.8, vFogDepth );
    #endif
    col = mix( col, fogColor, cFog * 0.75 );
  #endif
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class CloudSeaSystem implements WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geo: THREE.CircleGeometry;
  private readonly drift = new THREE.Vector2();
  private readonly center: THREE.Vector2;
  enabled = true;
  /** 0..1 how deep the camera is inside the cloud deck (the weather turns it into mist). */
  mist = 0;

  constructor(ctx: GameContext, noise: THREE.Texture) {
    this.group.name = 'cloud_sea';
    const peak = LANDFORMS.AIR_PEAK;
    this.center = new THREE.Vector2(peak.x, peak.z);
    this.geo = new THREE.CircleGeometry(RADIUS, 96, 0, Math.PI * 2);
    this.geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < LAYERS; i++) {
      const t = i / (LAYERS - 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uNoise: { value: noise },
          uCenter: { value: this.center },
          uRadius: { value: RADIUS },
          uLayerT: { value: t },
          uLayerY: { value: BASE_Y + i * STEP_Y },
          uDrift: { value: this.drift },
          uCover: { value: 0.4 },
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      attachEnvUniforms(mat);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.position.set(peak.x, BASE_Y + i * STEP_Y, peak.z);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 3 + i;
      mesh.name = 'cloud_sea_' + i;
      this.group.add(mesh);
    }
    ctx.scene.add(this.group);
  }

  /** Altitude band of the sheets (tests / debug). */
  get band(): [number, number] {
    return [BASE_Y, BASE_Y + (LAYERS - 1) * STEP_Y];
  }

  update(dt: number, ctx: GameContext): void {
    const cam = ctx.camera.position;
    const dist = Math.hypot(cam.x - this.center.x, cam.z - this.center.y);
    // Walking up the temple trail you climb through the deck: thick mist inside the band.
    const top = BASE_Y + (LAYERS - 1) * STEP_Y;
    const inBand = Math.min(1, Math.max(0, Math.min(cam.y - (BASE_Y - 10), top + 8 - cam.y) / 10));
    const target = this.enabled ? inBand * (1 - Math.min(1, Math.max(0, (dist - RADIUS * 0.45) / (RADIUS * 0.3)))) : 0;
    this.mist += (target - this.mist) * Math.min(1, dt * 1.5);
    // Visible from far away (it is a landmark) but not beyond the view distance.
    const g = ctx.settings.data.graphics;
    const far = g.drawDistance + RADIUS;
    this.group.visible = this.enabled && dist < far;
    if (!this.group.visible) return;
    // Low effects quality: three sheets instead of five (each sheet is a full-screen transparent pass).
    const low = g.effectsQuality === 'low';
    this.group.children.forEach((m, i) => {
      m.visible = !low || i % 2 === 0;
    });
    const w = ctx.world.sky.mood;
    // Drift with the wind (envUniforms.uWind: xy direction, z strength).
    const wv = envUniforms.uWind.value;
    const sp = (0.0003 + wv.z * 0.0009) * dt;
    this.drift.x = (this.drift.x + wv.x * sp) % 1000;
    this.drift.y = (this.drift.y + wv.y * sp) % 1000;
    // Upper layers order back-to-front relative to the camera for nicer blending.
    const above = cam.y > BASE_Y + LAYERS * STEP_Y * 0.5;
    this.group.children.forEach((m, i) => {
      (m as THREE.Mesh).renderOrder = above ? 3 + i : 3 + (LAYERS - i);
    });
    for (const m of this.materials) m.uniforms.uCover.value = w.cloudCover;
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
