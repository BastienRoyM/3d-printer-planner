import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export type ModelExt = "stl" | "3mf" | "obj";

/** The model format three.js can draw for this file, or null (STEP, G-code, sliced 3MF…). */
export function modelExt(fileName: string): ModelExt | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (fileName.toLowerCase().endsWith(".gcode.3mf")) return null;
  return ext === "stl" || ext === "3mf" || ext === "obj" ? ext : null;
}

export const MODEL_COLOR = 0xb9c2e0;

let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  return renderer;
}

/** Parses a model into a Y-up object that uses `material` for every mesh. */
export function parseModel(bytes: ArrayBuffer, ext: ModelExt, material: THREE.Material): THREE.Object3D {
  let object: THREE.Object3D;
  if (ext === "stl") {
    const geometry = new STLLoader().parse(bytes);
    geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry);
  } else if (ext === "3mf") {
    object = new ThreeMFLoader().parse(bytes);
  } else {
    object = new OBJLoader().parse(new TextDecoder().decode(bytes));
  }
  // STL and 3MF are Z-up; three.js is Y-up.
  if (ext !== "obj") object.rotation.x = -Math.PI / 2;
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material;
  });
  object.updateMatrixWorld(true);
  return object;
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(3, 5, 4);
  scene.add(key);
}

export function disposeModel(object: THREE.Object3D) {
  object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

/** Renders a model to a PNG data URL with an isometric-ish camera that fits the whole part. */
export async function renderThumbnail(bytes: ArrayBuffer, ext: ModelExt, size = 256): Promise<string> {
  const material = new THREE.MeshStandardMaterial({ color: MODEL_COLOR, roughness: 0.55, metalness: 0.05 });
  const object = parseModel(bytes, ext, material);

  const scene = new THREE.Scene();
  scene.add(object);
  addLights(scene);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;

  const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 100);
  const dir = new THREE.Vector3(1, 0.8, 1.2).normalize();
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(center).addScaledVector(dir, distance * 1.02);
  camera.lookAt(center);

  const r = getRenderer(size);
  r.render(scene, camera);
  const url = r.domElement.toDataURL("image/png");

  disposeModel(object);
  material.dispose();
  return url;
}
