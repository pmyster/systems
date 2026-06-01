/**
 * SkyDome — large inverted sphere with a procedural gradient shader,
 * standing in for a proper HDR skybox. Cheap (one draw call, no cubemap
 * texture upload), self-contained, and gives the map an immediate sense
 * of "outdoors" instead of the flat charcoal background.
 *
 * Gradient anatomy:
 *   - topColor:     bright clear blue overhead (zenith)
 *   - horizonColor: hazy light blue at the horizon ring (atmospheric
 *                   perspective)
 *   - groundColor:  light gray-blue below the horizon (rarely visible
 *                   because the terrain mesh covers most of it, but
 *                   prevents an ugly halo where the sphere passes
 *                   under the terrain plane)
 *
 * Render order:
 *   side=BackSide so we see the INSIDE of the sphere (we're inside
 *   looking out). depthWrite=false so opaque scene geometry depth-tests
 *   normally and the sky is overdrawn first. The default 1500m radius
 *   sits well inside the camera's 5000m far plane.
 */

import * as THREE from "three";

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(radius = 1500) {
    this.geometry = new THREE.SphereGeometry(radius, 32, 16);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      // Opt out of fog — the sky IS the distance, applying fog to it
      // washes out the gradient.
      fog: false,
      uniforms: {
        // Clear bright daylight sky — bright blue zenith fading to hazy
        // light blue at the horizon. Matches the BattlefieldPreview's
        // daylight mood so the map editor is comfortable for sustained
        // authoring sessions instead of looking like dusk/dawn.
        topColor: { value: new THREE.Color(0x4f8fcf) },
        horizonColor: { value: new THREE.Color(0xc8e6ff) },
        groundColor: { value: new THREE.Color(0x8aa0b5) },
        // Zero offset — the haze band sits right at the geometric
        // horizon, matching real atmospheric perspective.
        offset: { value: 0.0 },
        // Smooth, gentle exponent — the gradient breathes from haze to
        // blue over a wide swath of the upper hemisphere instead of
        // banding sharply.
        exponent: { value: 0.45 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          if (h > 0.0) {
            float t = pow(max(h - offset, 0.0), exponent);
            gl_FragColor = vec4(mix(horizonColor, topColor, clamp(t, 0.0, 1.0)), 1.0);
          } else {
            float t = pow(max(-h - offset, 0.0), exponent);
            gl_FragColor = vec4(mix(horizonColor, groundColor, clamp(t, 0.0, 1.0)), 1.0);
          }
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "SkyDome";
    // The sky should never participate in raycasts (Place, Select tools
    // would otherwise potentially hit it through the terrain edge).
    this.mesh.raycast = () => undefined;
    // Render before everything else so opaque geometry overdraws it.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /**
   * Update the procedural-sky shader uniforms in place. Called by
   * MapSceneManager when the store's `atmosphere` reference changes (New
   * Map biome switch, project load). All three colors are 0..1 RGB tuples
   * matching the BiomeAtmosphere convention.
   */
  setColors(
    skyTop: readonly [number, number, number],
    skyHorizon: readonly [number, number, number],
    skyGround: readonly [number, number, number],
  ): void {
    const top = this.material.uniforms.topColor.value as THREE.Color;
    top.setRGB(skyTop[0], skyTop[1], skyTop[2]);
    const horizon = this.material.uniforms.horizonColor.value as THREE.Color;
    horizon.setRGB(skyHorizon[0], skyHorizon[1], skyHorizon[2]);
    const ground = this.material.uniforms.groundColor.value as THREE.Color;
    ground.setRGB(skyGround[0], skyGround[1], skyGround[2]);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
