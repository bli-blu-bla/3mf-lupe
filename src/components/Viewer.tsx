import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mat12, Project } from '../lib/types';
import { mulMat } from '../lib/project';

function toMatrix4(m: Mat12) {
  return new THREE.Matrix4().set(m[0], m[3], m[6], m[9], m[1], m[4], m[7], m[10], m[2], m[5], m[8], m[11], 0, 0, 0, 1);
}

function peiTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b68a4c';
  g.fillRect(0, 0, size, size);
  // powder-coat speckle
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const l = Math.random();
    g.fillStyle = l > 0.5 ? `rgba(255,236,196,${0.08 + l * 0.12})` : `rgba(70,46,18,${0.06 + l * 0.14})`;
    g.fillRect(x, y, 1.4, 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Lift near-black filaments so shading stays readable on screen. */
function displayColor(hex: string) {
  const c = new THREE.Color(hex);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l < 0.04 ? '#3d4341' : hex;
}

const HELPER_COLORS: Record<string, string> = {
  modifier: '#e8c547', negative: '#7d8590', support_blocker: '#d64545', support_enforcer: '#3aa675', other: '#9aa19d',
};

export type PaintMode = 'none' | 'supports' | 'colors';

export const SUPPORT_PAINT = { enforcer: '#2fa36b', blocker: '#d64545' };

/** Non-indexed copy of a triangle range with one color per triangle (optionally only painted ones). */
function paintedGeometry(positions: Float32Array, indices: Uint32Array, start: number, end: number, states: Uint8Array, colorOf: (state: number) => THREE.Color, onlyPainted = false) {
  const tris: number[] = [];
  for (let t = start; t < end; t++) if (!onlyPainted || states[t]) tris.push(t);
  const n = tris.length;
  const pos = new Float32Array(n * 9), col = new Float32Array(n * 9);
  for (let k = 0; k < n; k++) {
    const t = tris[k];
    const c = colorOf(states[t] ?? 0);
    for (let v = 0; v < 3; v++) {
      const i = indices[t * 3 + v] * 3, o = k * 9 + v * 3;
      pos[o] = positions[i]; pos[o + 1] = positions[i + 1]; pos[o + 2] = positions[i + 2];
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export interface ViewerProps {
  project: Project;
  plate: number | 'all';
  selected: string | null;
  onSelect: (uid: string | null) => void;
  colors: string[];
  showHelpers: boolean;
  paintMode: PaintMode;
  dark: boolean;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  render: () => void;
  attrs: Map<string, THREE.BufferAttribute>;
}

export default function Viewer({ project, plate, selected, onSelect, colors, showHelpers, paintMode, dark }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<SceneState | null>(null);
  const meshesByUid = useRef(new Map<string, THREE.Mesh[]>());
  const framed = useRef<{ project: Project | null; plate: number | 'all' | null }>({ project: null, plate: null });
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // one-time renderer setup
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x5a4a32, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-0.6, -1, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(1, 0.6, 0.4);
    scene.add(fill);
    const root = new THREE.Group();
    scene.add(root);

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); });
    };
    controls.addEventListener('change', render);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(el);

    // click-to-select (ignore drags)
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(root.children, true).find((h) => h.object.userData.uid);
      selectRef.current(hit ? (hit.object.userData.uid as string) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    st.current = { renderer, scene, camera, controls, root, render, attrs: new Map() };
    // fresh camera: force the next content build to frame the plate again
    framed.current = { project: null, plate: null };
    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = null;
    };
  }, []);

  // (re)build scene content
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    const { root } = s;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m: THREE.Material & { map?: THREE.Texture | null }) => { m.map?.dispose(); m.dispose(); });
      }
    });
    root.clear();
    meshesByUid.current.clear();

    const plates = plate === 'all' ? project.plates : project.plates.filter((p) => p.index === plate);
    const { bed } = project;
    const tex = peiTexture();

    for (const p of plates) {
      if (!bed.width) continue;
      const shape = new THREE.Shape(bed.shape.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ShapeGeometry(shape);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 60, uv.getY(i) / 60);
      const plateMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.15 }));
      plateMesh.position.set(p.offset[0], p.offset[1], -0.02);
      root.add(plateMesh);
      // 10 mm grid, every 50 mm stronger
      const pts: number[] = [], strong: number[] = [];
      const xs = bed.shape.map((v) => v[0]), ys = bed.shape.map((v) => v[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) (x % 50 === 0 ? strong : pts).push(x, y0, 0, x, y1, 0);
      for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) (y % 50 === 0 ? strong : pts).push(x0, y, 0, x1, y, 0);
      for (const [arr, op] of [[pts, 0.16], [strong, 0.32]] as const) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3b2a12, transparent: true, opacity: op }));
        lines.position.set(p.offset[0], p.offset[1], 0.01);
        root.add(lines);
      }
    }

    const uids = new Set(plates.flatMap((p) => p.objectUids));
    const box = new THREE.Box3();
    for (const o of project.objects) {
      if (plate !== 'all' && !uids.has(o.uid) && project.plates.length > 1) continue;
      const list: THREE.Mesh[] = [];
      for (const part of o.parts) {
        const helper = part.kind !== 'model';
        if (helper && !showHelpers) continue;
        const raw = project.meshes.get(part.meshKey);
        if (!raw) continue;
        const ext = part.extruder ?? o.extruder;
        const color = helper ? HELPER_COLORS[part.kind] : displayColor(colors[ext - 1] ?? colors[0] ?? '#9aa19d');
        const states = helper ? undefined : paintMode === 'supports' ? raw.paintSupports : paintMode === 'colors' ? raw.paintColors : undefined;
        // supports are mostly painted on hidden undersides: show the body as x-ray and draw paint on top
        const xray = paintMode === 'supports' && !helper;
        let g: THREE.BufferGeometry;
        if (states && paintMode === 'colors') {
          const base = new THREE.Color(color);
          const fil = colors.map((c) => new THREE.Color(displayColor(c)));
          g = paintedGeometry(raw.positions, raw.indices, part.triStart, part.triEnd, states, (st) => (st ? fil[st - 1] ?? base : base));
        } else {
          let attr = s.attrs.get(part.meshKey);
          if (!attr) { attr = new THREE.BufferAttribute(raw.positions, 3); s.attrs.set(part.meshKey, attr); }
          g = new THREE.BufferGeometry();
          g.setAttribute('position', attr);
          g.setIndex(new THREE.BufferAttribute(raw.indices.subarray(part.triStart * 3, part.triEnd * 3), 1));
        }
        if (states && paintMode === 'supports') {
          const enf = new THREE.Color(SUPPORT_PAINT.enforcer), blk = new THREE.Color(SUPPORT_PAINT.blocker);
          const og = paintedGeometry(raw.positions, raw.indices, part.triStart, part.triEnd, states, (st) => (st === 2 ? blk : enf), true);
          const overlay = new THREE.Mesh(og, new THREE.MeshStandardMaterial({
            color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.5, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95,
          }));
          overlay.renderOrder = 10;
          overlay.matrixAutoUpdate = false;
          overlay.matrix.copy(toMatrix4(mulMat(part.matrix, o.transform)));
          overlay.userData.uid = o.uid;
          overlay.userData.helper = true;
          root.add(overlay);
          overlay.updateMatrixWorld(true);
          list.push(overlay);
        }
        const mat = new THREE.MeshStandardMaterial({
          color: states && paintMode === 'colors' ? 0xffffff : new THREE.Color(color), vertexColors: !!states && paintMode === 'colors', flatShading: true, roughness: 0.62, metalness: 0.02,
          transparent: helper || xray, opacity: helper ? 0.35 : xray ? 0.4 : 1, depthWrite: !helper && !xray,
          side: helper ? THREE.DoubleSide : THREE.FrontSide,
        });
        const mesh = new THREE.Mesh(g, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(toMatrix4(mulMat(part.matrix, o.transform)));
        mesh.userData.uid = o.uid;
        mesh.userData.helper = helper || xray;
        root.add(mesh);
        mesh.updateMatrixWorld(true);
        g.computeBoundingBox();
        if (!helper) box.union(g.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        list.push(mesh);
      }
      meshesByUid.current.set(o.uid, list);
    }

    // only reframe when the file or the plate changes, not when toggling display options
    if (framed.current.project !== project || framed.current.plate !== plate) {
      framed.current = { project, plate };
      // frame: whole plate(s) if known, otherwise the objects
      const frameBox = new THREE.Box3();
      if (bed.width) for (const p of plates) {
        const xs = bed.shape.map((v) => v[0]), ys = bed.shape.map((v) => v[1]);
        frameBox.expandByPoint(new THREE.Vector3(Math.min(...xs) + p.offset[0], Math.min(...ys) + p.offset[1], 0));
        frameBox.expandByPoint(new THREE.Vector3(Math.max(...xs) + p.offset[0], Math.max(...ys) + p.offset[1], 0));
      }
      if (!box.isEmpty()) frameBox.union(box);
      if (frameBox.isEmpty()) frameBox.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50));
      const center = frameBox.getCenter(new THREE.Vector3());
      const size = frameBox.getSize(new THREE.Vector3()).length();
      s.camera.position.set(center.x - size * 0.05, center.y - size * 1.05, center.z + size * 0.78);
      s.camera.near = size / 500; s.camera.far = size * 20;
      s.camera.updateProjectionMatrix();
      s.controls.target.copy(center);
      s.controls.update();
    }
    s.render();
  }, [project, plate, colors, showHelpers, paintMode]);

  // selection highlight
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    for (const [uid, list] of meshesByUid.current) {
      for (const m of list) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (selected && uid === selected) {
          mat.emissive.set(dark ? '#4f6bff' : '#2747d8');
          mat.emissiveIntensity = 0.12;
        } else {
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }
        if (!m.userData.helper) {
          const dim = !!selected && uid !== selected;
          mat.transparent = dim;
          mat.opacity = dim ? 0.45 : 1;
        }
        mat.needsUpdate = true;
      }
    }
    const old = s.scene.getObjectByName('selection-box');
    if (old) { s.scene.remove(old); (old as THREE.Box3Helper).geometry.dispose(); }
    const list = selected ? meshesByUid.current.get(selected) : undefined;
    if (list?.length) {
      const b = new THREE.Box3();
      for (const m of list) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
      const helper = new THREE.Box3Helper(b, new THREE.Color(dark ? '#6f86ff' : '#2747d8'));
      helper.name = 'selection-box';
      s.scene.add(helper);
    }
    s.render();
  }, [selected, project, plate, colors, showHelpers, paintMode, dark]);

  return <div ref={host} className="viewer-canvas" role="img" aria-label="3D-Ansicht der Druckplatte" />;
}
