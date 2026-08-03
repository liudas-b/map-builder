// 3D viewport: scene, camera, board rendering, picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { texUrl } from './api.js';
import { state } from './state.js';

// ------------------------------------------------------------ texture cache
const loader = new THREE.TextureLoader();
const texCache = new Map();

export function getTexture(path) {
  if (!texCache.has(path)) {
    const t = loader.load(texUrl(path));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(path, t);
  }
  return texCache.get(path);
}

// Average color of the pixels near the image border -> token side color.
const sideColorCache = new Map();
export function sideColor(path) {
  if (sideColorCache.has(path)) return sideColorCache.get(path);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 48;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, n = 0;
        const inset = Math.round(S * 0.08), band = Math.round(S * 0.10);
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const dx = Math.min(x, S - 1 - x), dy = Math.min(y, S - 1 - y);
            const dist = Math.min(dx, dy);
            if (dist < inset || dist > inset + band) continue;
            const i = (y * S + x) * 4;
            if (d[i + 3] < 200) continue;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
        }
        if (!n) return resolve(new THREE.Color(0x888888));
        resolve(new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear());
      } catch { resolve(new THREE.Color(0x888888)); }
    };
    img.onerror = () => resolve(new THREE.Color(0x888888));
    img.src = texUrl(path);
  });
  sideColorCache.set(path, p);
  return p;
}

// Trace the opaque silhouette of a texture as a polygon (image space, 0..1).
// Radial scan from the opaque-pixel centroid: right shape for coins, hearts,
// stars…; a fully opaque image yields a square (i.e. the old box look).
const silhouetteCache = new Map();
export function silhouette(path) {
  if (silhouetteCache.has(path)) return silhouetteCache.get(path);
  const p = new Promise((resolve) => {
    const fallback = () => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(0.5, 0.5); s.lineTo(-0.5, 0.5);
      resolve(s);
    };
    const img = new Image();
    img.onload = () => {
      try {
        const S = 96;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const a = ctx.getImageData(0, 0, S, S).data;
        const solid = (x, y) => {
          if (x < 0 || y < 0 || x >= S || y >= S) return false;
          return a[(y * S + x) * 4 + 3] > 60;
        };
        // centroid of opaque pixels
        let cx = 0, cy = 0, n = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (solid(x, y)) { cx += x; cy += y; n++; }
        }
        if (n < 20) return fallback();
        cx /= n; cy /= n;
        // radial silhouette: outermost opaque sample per angle
        const M = 90, pts = [];
        for (let i = 0; i < M; i++) {
          const ang = (i / M) * Math.PI * 2;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          let r = Math.hypot(S, S);
          for (; r > 0.5; r -= 0.75) {
            if (solid(Math.round(cx + dx * r), Math.round(cy + dy * r))) break;
          }
          pts.push({ ang, r: Math.max(r + 0.6, 1) });
        }
        // light smoothing to remove pixel stair-stepping
        const sm = pts.map((p0, i) => {
          const prev = pts[(i + M - 1) % M].r, next = pts[(i + 1) % M].r;
          return { ang: p0.ang, r: (prev + p0.r * 2 + next) / 4 };
        });
        const shape = new THREE.Shape();
        sm.forEach((pt, i) => {
          // image y is down; shape y is up; shift so image center is the origin
          const x = (cx + Math.cos(pt.ang) * pt.r) / S - 0.5;
          const y = 1 - (cy + Math.sin(pt.ang) * pt.r) / S - 0.5;
          if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        });
        shape.closePath();
        resolve(shape);
      } catch { fallback(); }
    };
    img.onerror = fallback;
    img.src = texUrl(path);
  });
  silhouetteCache.set(path, p);
  return p;
}

// ------------------------------------------------------------ helpers
export function tileCenter(grid, row, col) {
  const W = grid.cols * grid.cell, D = grid.rows * grid.cell;
  return {
    x: (col + 0.5) * grid.cell - W / 2,
    z: (row + 0.5) * grid.cell - D / 2,
  };
}

function decalMesh(texPath, w, h, rotDeg, y, rank) {
  const mat = new THREE.MeshBasicMaterial({
    map: getTexture(texPath), transparent: true, alphaTest: 0.01,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = -THREE.MathUtils.degToRad(rotDeg || 0);
  mesh.position.y = y;
  mesh.renderOrder = 2 + rank;
  return mesh;
}

// Build a THREE.Group for one sub-board's data.
// index: Map "kind:key" -> mesh (filled if provided)
export function buildSubGroup(data, index = null) {
  const g = new THREE.Group();
  const grid = data.grid;
  const W = grid.cols * grid.cell, D = grid.rows * grid.cell;

  // base plate (also the pick surface for the whole sub-board)
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(W + 1.2, 0.8, D + 1.2),
    new THREE.MeshLambertMaterial({ color: 0x262b36 }),
  );
  plate.position.y = -0.45;
  plate.userData = { kind: 'plate' };
  g.add(plate);

  // tiles
  const tileGeo = new THREE.PlaneGeometry(1, 1);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = data.tiles[`${r},${c}`];
      const mat = t?.tex
        ? new THREE.MeshBasicMaterial({ map: getTexture(t.tex) })
        : new THREE.MeshBasicMaterial({ color: 0x39404f });
      const m = new THREE.Mesh(tileGeo, mat);
      m.scale.set(grid.cell, grid.cell, 1);
      m.rotation.order = 'YXZ';
      m.rotation.x = -Math.PI / 2;
      m.rotation.y = -THREE.MathUtils.degToRad(t?.rot || 0);
      const { x, z } = tileCenter(grid, r, c);
      m.position.set(x, 0, z);
      m.userData = { kind: 'tile', row: r, col: c };
      m.renderOrder = 1;
      g.add(m);
      index?.set(`tile:${r},${c}`, m);
    }
  }

  // grid lines
  {
    const pts = [];
    for (let c = 0; c <= grid.cols; c++) {
      pts.push(c * grid.cell - W / 2, 0.02, -D / 2, c * grid.cell - W / 2, 0.02, D / 2);
    }
    for (let r = 0; r <= grid.rows; r++) {
      pts.push(-W / 2, 0.02, r * grid.cell - D / 2, W / 2, 0.02, r * grid.cell - D / 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ color: 0x0a0c11, transparent: true, opacity: 0.4 }));
    lines.renderOrder = 1000;
    lines.raycast = () => {};
    g.add(lines);
  }

  // overlays (gameplay / customization / labels), stacked by order
  const sorted = [...data.overlays].sort((a, b) => a.order - b.order);
  sorted.forEach((o, rank) => {
    let x, z, w, h;
    if (o.type === 'custom') {
      x = o.x; z = o.z; w = o.w; h = o.h;
    } else {
      const p = tileCenter(grid, o.row, o.col);
      x = p.x; z = p.z; w = grid.cell; h = grid.cell;
    }
    const m = decalMesh(o.tex, w, h, o.rot, 0.06 + rank * 0.02, rank);
    m.position.x = x; m.position.z = z;
    m.userData = { kind: 'overlay', id: o.id };
    g.add(m);
    index?.set(`overlay:${o.id}`, m);
  });

  // cubes
  for (const cube of data.cubes) {
    const p = cube.preset || {};
    const h = p.height || 5;
    const face = (tp) => tp
      ? new THREE.MeshLambertMaterial({ map: getTexture(tp) })
      : new THREE.MeshLambertMaterial({ color: 0x9aa2b5 });
    const mats = [face(p.right), face(p.left), face(p.top), face(p.bottom), face(p.front), face(p.back)];
    const m = new THREE.Mesh(new THREE.BoxGeometry(grid.cell, h, grid.cell), mats);
    const { x, z } = tileCenter(grid, cube.row, cube.col);
    m.position.set(x, h / 2 + 0.02, z);
    m.rotation.y = -THREE.MathUtils.degToRad(cube.rot || 0);
    m.userData = { kind: 'cube', id: cube.id };
    g.add(m);
    index?.set(`cube:${cube.id}`, m);
  }

  // tokens: silhouette-shaped pieces (side walls follow the texture outline)
  for (const tk of data.tokens) {
    const grp = new THREE.Group();
    grp.position.set(tk.x, 0.03, tk.z);
    grp.rotation.y = -THREE.MathUtils.degToRad(tk.rot || 0);
    grp.scale.set(tk.w, tk.h, tk.l);
    grp.userData = { kind: 'token', id: tk.id };
    g.add(grp);
    index?.set(`token:${tk.id}`, grp);

    const sideMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    if (tk.top) sideColor(tk.top).then(cl => { sideMat.color.copy(cl); });

    silhouette(tk.top || '').then((shape) => {
      if (!grp.parent) return; // board was rebuilt meanwhile
      const tag = (m) => { m.userData = { kind: 'token', id: tk.id }; return m; };
      // side wall (extruded straight up; caps get covered by the face meshes)
      const wall = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }), sideMat);
      wall.rotation.x = -Math.PI / 2;
      grp.add(tag(wall));
      const capGeo = new THREE.ShapeGeometry(shape);
      // ShapeGeometry UVs are the raw shape coords; shift back to 0..1
      const uv = capGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + 0.5, uv.getY(i) + 0.5);
      const capMat = (tp) => tp
        ? new THREE.MeshLambertMaterial({ map: getTexture(tp), transparent: true, alphaTest: 0.01 })
        : sideMat;
      const top = new THREE.Mesh(capGeo, capMat(tk.top));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 1.001;
      grp.add(tag(top));
      const bottom = new THREE.Mesh(capGeo.clone(), capMat(tk.bottom));
      bottom.rotation.x = Math.PI / 2;
      bottom.position.y = -0.001;
      grp.add(tag(bottom));
    });
  }

  return g;
}

// ------------------------------------------------------------ the view
export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161c);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
    this.camera.position.set(28, 42, 46);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.mouseButtons = {
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(40, 80, 30);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-30, 40, -50);
    this.scene.add(dir2);

    this.content = new THREE.Group();
    this.scene.add(this.content);

    this.index = new Map();       // sub mode: "kind:key" -> mesh
    this.sbGroups = new Map();    // board mode: uid -> group
    this.helper = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const resize = () => {
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.helper) this.helper.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  setBackground(hex) {
    this.scene.background = new THREE.Color(hex);
  }

  // ---------------- building
  rebuild() {
    this.content.clear();
    this.index.clear();
    this.sbGroups.clear();
    this.clearHelper();

    if (state.mode === 'sub') {
      this.content.add(buildSubGroup(state.sub.data, this.index));
    } else {
      for (const sb of state.board.data.subboards) {
        const data = state.boardRuntime[sb.saveId];
        if (!data) continue;
        const inner = buildSubGroup(data);
        const wrap = new THREE.Group();
        wrap.add(inner);
        this.applySbTransform(wrap, sb);
        wrap.userData = { kind: 'sb', uid: sb.uid };
        this.content.add(wrap);
        this.sbGroups.set(sb.uid, wrap);
      }
    }
    this.refreshHelper();
  }

  applySbTransform(group, sb) {
    group.position.set(sb.x, 0, sb.z);
    group.rotation.y = -THREE.MathUtils.degToRad(sb.rot || 0);
    group.scale.set(sb.sx || 1, ((sb.sx || 1) + (sb.sz || 1)) / 2, sb.sz || 1);
  }

  updateSbTransform(sb) {
    const g = this.sbGroups.get(sb.uid);
    if (g) this.applySbTransform(g, sb);
  }

  // fast position update without a rebuild (dragging)
  moveMesh(sel, x, z) {
    const key = sel.kind === 'overlay' ? `overlay:${sel.id}`
      : sel.kind === 'token' ? `token:${sel.id}` : null;
    if (!key) return;
    const m = this.index.get(key);
    if (m) { m.position.x = x; m.position.z = z; }
  }

  // ---------------- selection helper
  clearHelper() {
    if (this.helper) { this.scene.remove(this.helper); this.helper = null; }
  }

  meshForSelection(sel) {
    if (!sel) return null;
    if (sel.kind === 'sb') return this.sbGroups.get(sel.uid) || null;
    if (sel.kind === 'tile') return this.index.get(`tile:${sel.row},${sel.col}`) || null;
    return this.index.get(`${sel.kind}:${sel.id}`) || null;
  }

  refreshHelper() {
    this.clearHelper();
    const mesh = this.meshForSelection(state.selection);
    if (!mesh) return;
    this.helper = new THREE.BoxHelper(mesh, 0xffc84f);
    this.helper.raycast = () => {};
    this.scene.add(this.helper);
  }

  // screen-space anchor (top center of the selected object) for the gizmo
  selectionScreenPos(sel) {
    const mesh = this.meshForSelection(sel);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3());
    c.y = box.max.y;
    const v = c.project(this.camera);
    if (v.z > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  // live rotation while dragging the gizmo (no rebuild)
  rotateMesh(sel, deg) {
    const mesh = this.meshForSelection(sel);
    if (mesh) mesh.rotation.y = -THREE.MathUtils.degToRad(deg);
  }

  // ---------------- picking
  setPointer(ev) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  // returns { kind, ... , point } or null
  pick(ev) {
    this.setPointer(ev);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const h of hits) {
      let o = h.object;
      if (state.mode === 'board') {
        while (o && o.userData?.kind !== 'sb') o = o.parent;
        if (o) return { kind: 'sb', uid: o.userData.uid, point: h.point };
        continue;
      }
      let node = h.object;
      const ud = node.userData || {};
      if (ud.kind && ud.kind !== 'plate') {
        return { ...ud, point: h.point };
      }
    }
    return null;
  }

  // pick tiles only (for painting)
  pickTile(ev) {
    this.setPointer(ev);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const h of hits) {
      if (h.object.userData?.kind === 'tile') {
        return { ...h.object.userData, point: h.point };
      }
    }
    return null;
  }

  groundPoint(ev) {
    this.setPointer(ev);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  // ---------------- camera
  frame() {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 20);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + span * 0.55, span * 1.05, center.z + span * 0.95);
  }

  captureThumb() {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    const w = 320, h = Math.round(320 * src.height / src.width);
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.65);
  }
}
