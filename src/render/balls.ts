// The balls: one sphere each, its pattern (colour, stripe, number, cue-ball dots) computed in the shader from
// the sphere's own surface direction. No texture to blur or stretch: edges stay sharp at any size.

import * as THREE from "three";
import { R } from "../sim/constants";

/**
 * Colours picked for telling balls apart on a screen: 3 (red) and 7 (maroon) are far apart, 4 is a
 * lighter violet that can't pass for the 8. Stripes 9-15 share 1-7's colours.
 */
export const BALL_COLORS: Record<number, string> = {
  0: "#f4f1e8",
  1: "#f5b90f", 2: "#1d4fd8", 3: "#e0241b", 4: "#7b3fc4", 5: "#f2690f", 6: "#0e8c4a", 7: "#7d2a12",
  8: "#141414",
};
export function ballColor(id: number): string {
  return BALL_COLORS[id > 8 ? id - 8 : id];
}
export const isStripe = (id: number) => id > 8;

/** Half-height of the stripe band as a fraction of R. Real balls ~0.55; ours narrower so white caps show. */
export const STRIPE_BAND = 0.42;
/** The number spot's angular radius: cos and sin. */
const SPOT_COS = 0.885, SPOT_SIN = Math.sqrt(1 - SPOT_COS * SPOT_COS);

function glyphAtlas(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let n = 1; n <= 15; n++) {
    const cx = ((n - 1) % 4) * 128 + 64, cy = Math.floor((n - 1) / 4) * 128 + 64;
    const s = n > 9 ? 70 : 84;
    g.font = `800 ${s}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(String(n), cx, cy + 4);
    if (n === 6 || n === 9) g.fillRect(cx - 18, cy + 40, 36, 7); // tell 6 from 9
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let atlas: THREE.Texture | null = null;

function material(id: number): THREE.MeshPhysicalMaterial {
  atlas ??= glyphAtlas();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 0.35,
  });
  m.userData.env = 0.75;
  const color = new THREE.Color(ballColor(id));
  const kind = id === 0 ? 0 : isStripe(id) ? 2 : 1;
  const cell = id === 0 ? 0 : id - 1;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uColor = { value: color };
    sh.uniforms.uKind = { value: kind };
    sh.uniforms.uCell = { value: new THREE.Vector2(cell % 4, Math.floor(cell / 4)) };
    sh.uniforms.uAtlas = { value: atlas };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjN;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjN = objectNormal;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vObjN;
uniform vec3 uColor; uniform int uKind; uniform vec2 uCell; uniform sampler2D uAtlas;
float edge(float v, float e) { float w = fwidth(v) * 0.75; return smoothstep(e - w, e + w, v); }`,
      )
      .replace(
        "#include <map_fragment>",
        `{
  vec3 n = normalize(vObjN);
  vec3 white = vec3(0.93, 0.91, 0.86);
  vec3 col = white;
  if (uKind == 0) {
    // Cue ball: six small red dots, so its spin can be seen.
    float d = max(max(abs(n.x), abs(n.y)), abs(n.z));
    col = mix(white, vec3(0.75, 0.08, 0.07), edge(d, 0.985));
  } else {
    float body = uKind == 1 ? 1.0 : 1.0 - edge(abs(n.y), ${STRIPE_BAND.toFixed(3)});
    col = mix(white, uColor, body);
    // Number spots on the two sides, on the stripe for stripes.
    float s = abs(n.z);
    float spot = edge(s, ${SPOT_COS.toFixed(4)});
    vec2 uv = vec2(n.x * sign(n.z), n.y) / ${SPOT_SIN.toFixed(4)} * 0.5 + 0.5;
    vec2 auv = (uCell + vec2(uv.x, 1.0 - uv.y)) / 4.0;
    float ink = texture2D(uAtlas, auv).a * spot;
    col = mix(col, white, spot);
    col = mix(col, vec3(0.02), ink);
  }
  diffuseColor.rgb *= col;
}`,
      );
  };
  m.customProgramCacheKey = () => "pool-ball";
  return m;
}

export interface BallView {
  id: number;
  mesh: THREE.Mesh;
  /** Pocket animation: time since it dropped, or -1. */
  drop: number;
  dropFrom: THREE.Vector3;
  dropTo: THREE.Vector3;
}

export function makeBalls(parent: THREE.Object3D): BallView[] {
  const geo = new THREE.SphereGeometry(R, 56, 40);
  const views: BallView[] = [];
  for (let id = 0; id <= 15; id++) {
    const mesh = new THREE.Mesh(geo, material(id));
    // Racked balls face every which way (looks only, so Math.random is fine here).
    mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    parent.add(mesh);
    views.push({ id, mesh, drop: -1, dropFrom: new THREE.Vector3(), dropTo: new THREE.Vector3() });
  }
  return views;
}

const q = new THREE.Quaternion();
const axis = new THREE.Vector3();
/** Turn a ball by its angular velocity over dt (table-local axes, z up). */
export function spin(mesh: THREE.Mesh, wx: number, wy: number, wz: number, dt: number) {
  const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (w < 1e-6) return;
  axis.set(wx / w, wy / w, wz / w);
  q.setFromAxisAngle(axis, w * dt);
  mesh.quaternion.premultiply(q);
}
