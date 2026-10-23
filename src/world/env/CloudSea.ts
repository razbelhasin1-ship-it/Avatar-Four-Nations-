import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { LANDFORMS } from '../Heightfield';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_DITHER_GLSL, ENV_PARS_GLSL, envUniforms } from './EnvShared';

/**
 * The sea of clouds around the Air Temple massif.
 *
 * One transparent disc, ray-marched in the fragment shader: the deck is a
 * height field of billowy cumulus domes over a flat stratus floor (so it reads
 * as a continuous sea with real parallax and self-occlusion, not stacked
 * sheets). Domes are lit with wrap lighting from their gradient normal, shadow
 * each other toward the sun, get a silver lining when looking sunward and turn
 * cool blue-grey in the hollows. Peaks and needle spires pierce it: the march
 * stops where the world height texture rises above the ray (the terrain then
 * shows through), and the deck thins into mist where it touches rock.
 *
 * Seen from below (bison meadow, the lower trail) the disc becomes the deck's
 * flat grey underside; inside the band it hides and the weather fog thickens
 * instead (`mist`), so walking up the trail you climb through the clouds.
 * March steps scale with settings.graphics.effectsQuality.
 */

const BASE_Y = 146;
const DECK_H = 40;
const TOP_Y = BASE_Y + DECK_H;
const RADIUS = 1250;
/** The far sheet continues the sea to the horizon when seen from the massif. */
const FAR_R = 3400;
const STEPS: Record<string, number> = { low: 6, medium: 10, high: 14 };

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uPlaneY;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  wp.y = uPlaneY;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${ENV_PARS_GLSL}
${ENV_DITHER_GLSL}
uniform sampler2D uNoise;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uBaseY;
uniform float uDeckH;
uniform vec2 uDrift;
uniform float uCover;
uniform float uFade;
uniform float uBelow;
uniform float uFarSheet;
uniform float uFarR;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

// Sun-lit tops stay just under the bloom threshold (a white-out otherwise).
#define DECK_GAIN 0.78
float rimK( vec2 p ) {
  return 1.0 - smoothstep( uRadius * 0.5, uRadius * 0.97, length( p - uCenter ) );
}
float terrainY( vec2 p ) {
  return texture2D( uHeightTex, ( p - uHeightTexInfo.xy ) * uHeightTexInfo.z ).r;
}
// Cloud-top height above the base: rounded cumulus domes on a flat stratus
// floor. Toward the rim the domes flatten; when the far sheet continues the sea
// to the horizon the floor stays, otherwise it sinks out of sight.
float deckTop( vec2 p, float rim, bool fine ) {
  float swell = texture2D( uNoise, p * 0.0008 + uDrift ).r;
  float cells = texture2D( uNoise, p * 0.0036 - uDrift * 1.4 + 0.37 ).g;
  float d = swell * 0.5 + cells * 0.62;
  if ( fine ) d += ( texture2D( uNoise, p * 0.016 + uDrift * 2.2 ).b - 0.5 ) * 0.14;
  float thr = 0.4 - uCover * 0.1;
  float dome = sqrt( clamp( ( d - thr ) / ( 1.08 - thr ), 0.0, 1.0 ) );
  return 3.0 + dome * ( uDeckH - 3.0 ) * rim - ( 1.0 - rim ) * 19.0 * ( 1.0 - uFarSheet );
}
// Clouds bank up against rock that rises into the deck (the massif and the
// spires emerge from the sea instead of standing in holes).
float cloudTop( vec2 p, float rim, bool fine, out float g ) {
  g = terrainY( p );
  float h = uBaseY + deckTop( p, rim, fine );
  float bank = min( g + 5.0, uBaseY + uDeckH - 6.0 + 8.0 * texture2D( uNoise, p * 0.011 + uDrift * 2.0 ).g );
  return max( h, mix( h, bank, smoothstep( uBaseY - 30.0, uBaseY - 4.0, g ) ) );
}
vec3 deckFog( vec3 col, float dist ) {
  #ifdef USE_FOG
    // The deck is a landmark seen from high above: aerial perspective over
    // kilometres, softened by the haze rather than erased at the draw distance.
    #ifdef FOG_EXP2
      float f = 1.0 - exp( - fogDensity * fogDensity * dist * dist * 0.3 );
    #else
      float f = smoothstep( min( fogNear, 300.0 ), max( fogFar * 1.6, 2600.0 ), dist );
    #endif
    col = mix( col, fogColor, f * 0.75 );
  #endif
  return col;
}

void main() {
  if ( uFade < 0.004 ) discard;
  vec3 rd = normalize( vWorld - cameraPosition );
  vec3 col;
  float alpha;
  float dayK = mix( 0.2, 1.0, uDaylight );
  vec3 skyAmb = mix( uSkyHorizon, uSkyZenith, 0.45 );
  vec3 sunC = uSunColor * smoothstep( -0.06, 0.1, uSunDir.y );
  float rim0 = rimK( vWorld.xz );
  if ( rim0 < 0.002 || uBelow > 0.5 && length( vWorld.xz - uCenter ) > uRadius ) {
    // Beyond the ray-marched deck: seen from the summit, a flat far sheet carries
    // the sea of clouds out to the horizon under the haze.
    if ( uBelow > 0.5 || uFarSheet < 0.01 ) discard;
    float tp = ( uBaseY + 6.0 - cameraPosition.y ) / min( rd.y, -0.002 );
    vec3 fp = cameraPosition + rd * tp;
    float fd = length( fp.xz - uCenter );
    float fa = uFarSheet * ( 1.0 - smoothstep( uFarR * 0.75, uFarR, fd ) ) * smoothstep( uRadius * 0.8, uRadius, fd );
    if ( fa < 0.004 ) discard;
    float v = texture2D( uNoise, fp.xz * 0.0009 + uDrift ).g;
    vec3 ambient = skyAmb * 0.52 + vec3( 0.06, 0.065, 0.085 );
    col = vec3( 0.97, 0.97, 1.0 ) * ( ambient * mix( vec3( 0.8, 0.84, 0.94 ), vec3( 1.0 ), v ) * dayK + sunC * ( 0.58 + 0.3 * v ) * 0.92 ) * DECK_GAIN;
    col = deckFog( col, tp );
    gl_FragColor = vec4( col, fa * uFade );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  if ( uBelow > 0.5 ) {
    // The flat, grey underside of the deck.
    float h = deckTop( vWorld.xz, rim0, false );
    float thick = clamp( h / uDeckH, 0.0, 1.0 );
    float g = terrainY( vWorld.xz );
    alpha = smoothstep( -3.0, 3.0, h ) * smoothstep( -2.0, 12.0, uBaseY - g ) * mix( 0.72, 0.95, thick );
    vec3 base = skyAmb * 0.55 + vec3( 0.34, 0.36, 0.4 );
    col = base * mix( 1.05, 0.72, thick ) * dayK + uSunColor * 0.12 * ( 1.0 - thick ) * uDaylight;
    col = deckFog( col, length( vWorld - cameraPosition ) );
  } else {
    // Ray-march the dome field from the top plane down to the floor.
    float rdY = min( rd.y, -0.004 );
    float tExit = ( uBaseY - 1.0 - vWorld.y ) / rdY;
    float dt = tExit / float( STEPS );
    float t = dt * envDither( gl_FragCoord.xy );
    float tPrev = 0.0;
    float diffPrev = 1.0;
    float tHit = -1.0;
    bool rock = false;
    for ( int i = 0; i <= STEPS; i++ ) {
      // The last sample sits exactly on the exit so the floor is never missed.
      float ts = i == STEPS ? tExit : t;
      vec3 p = vWorld + rd * ts;
      float g;
      float hc = cloudTop( p.xz, rimK( p.xz ), false, g );
      if ( p.y < max( hc, g ) ) {
        // Whichever surface is higher here was crossed first: rock rising above
        // the cloud tops shows through, rock inside the deck stays wrapped in cloud.
        if ( g > hc ) { rock = true; break; }
        float diff = p.y - hc;
        tHit = tPrev + ( ts - tPrev ) * diffPrev / max( diffPrev - diff, 1e-4 );
        break;
      }
      tPrev = ts;
      diffPrev = p.y - hc;
      t += dt;
    }
    if ( rock || tHit < 0.0 ) discard;
    vec3 hp = vWorld + rd * tHit;
    float rim = rimK( hp.xz );
    // Normals from the dome field alone: clouds banked against rock keep the
    // billowy shading of the sea instead of a smooth, sun-facing wall.
    float e = 7.0;
    float hx = deckTop( hp.xz + vec2( e, 0.0 ), rim, true ) - deckTop( hp.xz - vec2( e, 0.0 ), rim, true );
    float hz = deckTop( hp.xz + vec2( 0.0, e ), rim, true ) - deckTop( hp.xz - vec2( 0.0, e ), rim, true );
    // Relief exaggerated for lighting so the domes read even under a high sun.
    vec3 n = normalize( vec3( -hx * 1.9, 2.0 * e, -hz * 1.9 ) );
    float hk = clamp( ( hp.y - uBaseY ) / uDeckH, 0.0, 1.0 );
    // Domes shadow each other toward a low sun.
    vec2 sd = normalize( uSunDir.xz + 1e-4 );
    float tanE = uSunDir.y / max( length( uSunDir.xz ), 0.05 );
    float o1 = uBaseY + deckTop( hp.xz + sd * 26.0, rim, false ) - ( hp.y + 26.0 * tanE );
    float o2 = uBaseY + deckTop( hp.xz + sd * 70.0, rim, false ) - ( hp.y + 70.0 * tanE );
    float shadow = max( smoothstep( 0.0, 7.0, o1 ), smoothstep( 0.0, 10.0, o2 ) * 0.8 );
    float wrap = clamp( dot( n, uSunDir ) * 0.62 + 0.38, 0.0, 1.0 ) * ( 1.0 - 0.62 * shadow );
    vec3 ambient = skyAmb * 0.52 + vec3( 0.06, 0.065, 0.085 );
    // Cool blue-grey in the hollows, bright sun-lit domes.
    vec3 hollow = mix( vec3( 0.74, 0.79, 0.92 ), vec3( 1.0 ), smoothstep( 0.05, 0.75, hk ) );
    col = vec3( 0.97, 0.97, 1.0 ) * ( ambient * hollow * mix( 0.78, 1.0, n.y ) * dayK + sunC * wrap * 0.92 ) * DECK_GAIN;
    // Silver lining and translucent edges toward the sun.
    float vs = max( dot( rd, uSunDir ), 0.0 );
    col += sunC * pow( vs, 6.0 ) * ( 0.25 + 0.5 * ( 1.0 - n.y ) ) * 0.5;
    // Thin, misty contact where the deck laps against rock.
    float g = terrainY( hp.xz );
    alpha = mix( 0.6, 1.0, smoothstep( 1.0, 9.0, hp.y - g ) ) * mix( smoothstep( 0.0, 0.2, rim ), 1.0, uFarSheet );
    col = deckFog( col, length( hp - cameraPosition ) );
  }
  gl_FragColor = vec4( col, alpha * uFade );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class CloudSeaSystem implements WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly geo: THREE.CircleGeometry;
  private readonly mesh: THREE.Mesh;
  private readonly drift = new THREE.Vector2();
  private readonly center: THREE.Vector2;
  private steps = 0;
  enabled = true;
  /** 0..1 how deep the camera is inside the cloud deck (the weather turns it into mist). */
  mist = 0;
  /** 0..1 camera up on the massif above the deck (the far sheet hides the distant ground). */
  above = 0;
  private readonly bounce = new THREE.Color();
  private readonly tmp = new THREE.Color();

  constructor(ctx: GameContext, noise: THREE.Texture) {
    this.group.name = 'cloud_sea';
    const peak = LANDFORMS.AIR_PEAK;
    this.center = new THREE.Vector2(peak.x, peak.z);
    this.geo = new THREE.CircleGeometry(FAR_R, 128, 0, Math.PI * 2);
    this.geo.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noise },
        uCenter: { value: this.center },
        uRadius: { value: RADIUS },
        uBaseY: { value: BASE_Y },
        uDeckH: { value: DECK_H },
        uPlaneY: { value: TOP_Y },
        uDrift: { value: this.drift },
        uCover: { value: 0.4 },
        uFade: { value: 1 },
        uBelow: { value: 0 },
        uFarSheet: { value: 0 },
        uFarR: { value: FAR_R },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      defines: { STEPS: STEPS.medium },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    attachEnvUniforms(this.material);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.position.set(peak.x, TOP_Y, peak.z);
    this.mesh.updateMatrix();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'cloud_sea_deck';
    this.group.add(this.mesh);
    ctx.scene.add(this.group);
  }

  /** Altitude band of the deck (tests / debug). */
  get band(): [number, number] {
    return [BASE_Y, TOP_Y];
  }

  update(dt: number, ctx: GameContext): void {
    const cam = ctx.camera.position;
    const dist = Math.hypot(cam.x - this.center.x, cam.z - this.center.y);
    const near = 1 - Math.min(1, Math.max(0, (dist - RADIUS * 0.45) / (RADIUS * 0.3)));
    // Inside the band the deck becomes mist (the weather system thickens the fog).
    const inBand = Math.min(1, Math.max(0, Math.min(cam.y - (BASE_Y - 8), TOP_Y + 8 - cam.y) / 10));
    const target = this.enabled ? inBand * near : 0;
    this.mist += (target - this.mist) * Math.min(1, dt * 1.5);
    // Visible from far away (it is a landmark) but not beyond the view distance.
    const g = ctx.settings.data.graphics;
    this.group.visible = this.enabled && dist < g.drawDistance + RADIUS;
    if (!this.group.visible) {
      this.above = 0;
      return;
    }
    const steps = STEPS[g.effectsQuality] ?? STEPS.medium;
    if (steps !== this.steps) {
      this.steps = steps;
      this.material.defines.STEPS = steps;
      this.material.needsUpdate = true;
    }
    const u = this.material.uniforms;
    const below = cam.y < (BASE_Y + TOP_Y) * 0.5;
    u.uBelow.value = below ? 1 : 0;
    u.uPlaneY.value = below ? BASE_Y : TOP_Y;
    // Fade out while the camera passes through the band (the mist takes over).
    u.uFade.value = below ? Math.min(1, Math.max(0, (BASE_Y - 2 - cam.y) / 14)) : Math.min(1, Math.max(0, (cam.y - TOP_Y - 2) / 14));
    // Far sheet only for viewers up on the massif (it would hover over other regions otherwise).
    u.uFarSheet.value = below ? 0 : Math.min(1, Math.max(0, (RADIUS * 0.75 - dist) / (RADIUS * 0.3)));
    this.above = u.uFarSheet.value * Math.min(1, Math.max(0, (cam.y - TOP_Y - 20) / 40));
    // Above the sea the "ground" every downward-facing surface sees is bright cloud:
    // bounce light lifts the shadowed sides of the spires and the temple.
    if (this.above > 0) {
      const e = envUniforms;
      this.bounce.copy(e.uSkyHorizon.value).multiplyScalar(0.42).add(this.tmp.copy(e.uSunColor.value).multiplyScalar(0.34 * e.uDaylight.value));
      ctx.render.hemi.groundColor.lerp(this.bounce, 0.75 * this.above);
    }
    // Drift with the wind (envUniforms.uWind: xy direction, z strength).
    const wv = envUniforms.uWind.value;
    const sp = (0.00025 + wv.z * 0.0007) * dt;
    this.drift.x = (this.drift.x + wv.x * sp) % 1000;
    this.drift.y = (this.drift.y + wv.y * sp) % 1000;
    u.uCover.value = ctx.world.sky.mood.cloudCover;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
