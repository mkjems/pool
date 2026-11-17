// Renderer, lights, reflections and the camera that fits the table to any screen.

import * as THREE from "three";
import { R, TABLE_L, TABLE_W } from "../sim/constants";
import { CUSHION_W, LAMPS, RAIL_W } from "./table";

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The room's reflection map. */
  env: THREE.Texture;
  camera: THREE.PerspectiveCamera;
  /** Table turned to stand upright on the screen (portrait). */
  portrait: boolean;
  resize(): void;
  /** Screen point (CSS px) to table coordinates on the plane of the ball centres. */
  toTable(px: number, py: number): THREE.Vector2 | null;
  /** Table coordinates to screen point (CSS px). */
  toScreen(x: number, y: number, z?: number): THREE.Vector2;
  /** Pixels per metre on the cloth, at the current size. */
  scale(): number;
  /** Rendering resolution as a fraction of the screen's (lowered when frames are slow). */
  quality: number;
}

/** Table coordinates (z up) to world (y up). */
export function toWorld(x: number, y: number, z: number, out = new THREE.Vector3()) {
  return out.set(x, z, -y);
}

function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  // A dark room with three bright lamp panels over the table: what the balls' lacquer reflects.
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x050506);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(12, 5, 9),
    new THREE.MeshBasicMaterial({ color: 0x0b0a09, side: THREE.BackSide }),
  );
  room.position.y = 2;
  env.add(room);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.93, 0.8).multiplyScalar(40) });
  for (const l of LAMPS) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), lampMat);
    panel.position.copy(toWorld(l.x, l.y, l.z));
    panel.rotation.x = Math.PI / 2;
    env.add(panel);
  }
  // Faint warm glow from far walls, so dark balls still show their shape.
  const wallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.17, 0.1) });
  for (const x of [-5.9, 5.9]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), wallMat);
    w.position.set(x, 1.4, 0);
    w.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    env.add(w);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.015).texture;
  pm.dispose();
  return tex;
}

export function makeView(canvas: HTMLCanvasElement): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060607);
  // Reflections only where they belong: each material says how much (userData.env), see applyEnvironment.
  const env = environment(renderer);

  // One cheap light from above. The lamps' pools of light are painted in the table's shader (lampPool) and their
  // reflections on the balls come from the environment map, so no per-pixel area lights are needed.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
  sun.position.copy(toWorld(0, 0.25, 3));
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a8f99, 0x1a120c, 0.12));

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
  const view: View = {
    renderer, scene, camera, portrait: false, env, quality: 1,
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * view.quality);
      renderer.setSize(w, h, false);
      const portrait = h > w * 1.05;
      view.portrait = portrait;
      // How much beyond the cushion noses must show: the whole table on big screens; on phones the pockets whole
      // and most of the rail.
      const small = Math.min(w, h) < 560;
      // On big screens: the whole table with air around it (room to move the mouse behind any ball).
      const m = small ? CUSHION_W + RAIL_W * 0.8 : CUSHION_W + RAIL_W + 0.11;
      // Room for the controls: the power bar at the side, the buttons and score along the top (kept symmetric
      // at the bottom so the table stays centred).
      const sidePx = small ? 0 : 72, topPx = small ? 0 : 52;
      const along = TABLE_L / 2 + m, across = TABLE_W / 2 + m;
      const sw = portrait ? w - topPx * 2 : w - sidePx * 2, sh = portrait ? h - sidePx * 2 : h - topPx * 2;
      const ex = portrait ? across : along, ey = portrait ? along : across;
      const aspect = w / h;
      camera.aspect = aspect;
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // Visible half-extents at distance D: (D tan aspect, D tan); the table's extents must fit the usable part.
      const D = Math.max((ey * h) / sh / tan, (ex * w) / sw / (tan * aspect));
      camera.position.set(0, D + R, 0);
      camera.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    },
    toTable(px, py) {
      const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -R), hit)) return null;
      return new THREE.Vector2(hit.x, -hit.z);
    },
    toScreen(x, y, z = R) {
      const v = toWorld(x, y, z).project(camera);
      return new THREE.Vector2(((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight);
    },
    scale() {
      const a = view.toScreen(0, 0, 0), b = view.toScreen(0.1, 0, 0);
      return a.distanceTo(b) * 10;
    },
  };
  view.resize();
  return view;
}

/** Give every material that asks for it (userData.env = intensity) the room reflection. */
export function applyEnvironment(view: View) {
  view.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || m.userData?.env == null || m.envMap) return;
    m.envMap = view.env;
    m.envMapIntensity = m.userData.env;
    m.needsUpdate = true;
  });
}
