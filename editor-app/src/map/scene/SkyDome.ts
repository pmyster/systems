/**
 * SkyDome — large inverted sphere with a procedural gradient shader,
 * standing in for a proper HDR skybox. Cheap (one draw call, no cubemap
 * texture upload), self-contained, and gives the map an immediate sense
 * of "outdoors" instead of the flat charcoal background.
 *
 * Gradient anatomy:
 *   - topColor:     dusty blue overhead
 *   - horizonColor: warm sunset amber at the horizon ring
 *   - groundColor:  dark earth haze below the horizon (rarely visible
 *                   because the terrain mesh covers most of it, but
 *                   prevents an ugly cyan halo where the sphere passes
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
        topColor: { value: new THREE.Color(0x3a4a78) },
        horizonColor: { value: new THREE.Color(0xc97a4a) },
        groundColor: { value: new THREE.Color(0x2a1a18) },
        offset: { value: 0.05 },
        exponent: { value: 0.7 },
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

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
