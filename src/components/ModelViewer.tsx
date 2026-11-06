import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Loader2, RotateCcw, X } from "lucide-react";
import { errorText, readModel } from "../api";
import { MODEL_COLOR, addLights, disposeModel, parseModel, type ModelExt } from "../lib/thumbnail";

/** A full-window, orbitable view of an item's model file. */
export function ModelViewer({ itemId, ext, name, onClose }: {
  itemId: number;
  ext: ModelExt;
  name: string;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | string>("loading");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = host.current!;
    let alive = true;
    let cleanup = () => {};

    readModel(itemId)
      .then((bytes) => {
        if (!alive) return;
        const material = new THREE.MeshStandardMaterial({ color: MODEL_COLOR, roughness: 0.55, metalness: 0.05 });
        const object = parseModel(bytes, ext, material);
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) throw new Error("This file has no geometry the viewer can draw.");

        // Sit the part on the grid, centred.
        const center = box.getCenter(new THREE.Vector3());
        object.position.set(-center.x, -box.min.y, -center.z);
        const size = box.getSize(new THREE.Vector3());
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;

        const scene = new THREE.Scene();
        scene.add(object);
        addLights(scene);
        const extent = Math.max(size.x, size.z) * 1.6;
        const grid = new THREE.GridHelper(extent, 16, 0x6f7889, 0x333a47);
        scene.add(grid);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        el.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        const target = new THREE.Vector3(0, size.y / 2, 0);
        resetView.current = () => {
          const dir = new THREE.Vector3(1, 0.8, 1.2).normalize();
          const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
          camera.position.copy(target).addScaledVector(dir, distance * 1.1);
          controls.target.copy(target);
          controls.update();
        };
        resetView.current();

        const resize = () => {
          const { clientWidth: w, clientHeight: h } = el;
          renderer.setSize(w, h);
          camera.aspect = w / Math.max(1, h);
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        resize();

        let frame = 0;
        const loop = () => {
          frame = requestAnimationFrame(loop);
          controls.update();
          renderer.render(scene, camera);
        };
        loop();
        setState("ready");

        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          disposeModel(object);
          grid.dispose();
          material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch((e) => alive && setState(errorText(e)));

    return () => {
      alive = false;
      cleanup();
    };
  }, [itemId, ext]);

  return (
    <div className="viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={`3D view of ${name}`}>
        <header className="viewer-head">
          <h2>{name}</h2>
          <span className="hint" style={{ margin: 0 }}>Drag to rotate · right-drag to pan · scroll to zoom</span>
          <button className="icon-btn" onClick={() => resetView.current()} aria-label="Reset view" title="Reset view">
            <RotateCcw size={16} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close 3D view">
            <X size={18} />
          </button>
        </header>
        <div className="viewer-canvas" ref={host}>
          {state === "loading" && <div className="viewer-status"><Loader2 size={22} className="spin" /> Loading model…</div>}
          {state !== "loading" && state !== "ready" && <div className="viewer-status">{state}</div>}
        </div>
      </div>
    </div>
  );
}
