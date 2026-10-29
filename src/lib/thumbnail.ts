import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export type ThumbExt = "stl" | "3mf" | "obj";

export function thumbExt(fileName: string): ThumbExt | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (fileName.toLowerCase().endsWith(".gcode.3mf")) return null;
  return ext === "stl" || ext === "3mf" || ext === "obj" ? ext : null;
}

let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  return renderer;
}

function parse(bytes: ArrayBuffer, ext: ThumbExt): THREE.Object3D {
  if (ext === "stl") {
    const geometry = new STLLoader().parse(bytes);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry);
  }
  if (ext === "3mf") return new ThreeMFLoader().parse(bytes);
  return new OBJLoader().parse(new TextDecoder().decode(bytes));
}

/** Renders a model to a PNG data URL with an isometric-ish camera that fits the whole part. */
export async function renderThumbnail(bytes: ArrayBuffer, ext: ThumbExt, size = 256): Promise<string> {
  const object = parse(bytes, ext);
  // STL and 3MF are Z-up; three.js is Y-up.
  if (ext !== "obj") object.rotation.x = -Math.PI / 2;

  const material = new THREE.MeshStandardMaterial({ color: 0xb9c2e0, roughness: 0.55, metalness: 0.05 });
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material;
  });

  const scene = new THREE.Scene();
  scene.add(object);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(3, 5, 4);
  scene.add(key);

  object.updateMatrixWorld(true);
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

  object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  material.dispose();
  return url;
}
