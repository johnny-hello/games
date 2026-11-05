// The 3D view: renderer, isometric camera, lights, the static warehouse built
// from the layout, and forklifts / pallets drawn from simulation or live data.
// Layout (x, y) maps to Three.js (x, 0, y); heading h maps to rotation.y = -h.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  COLORS, CAMERAS, mat, box, cyl, makeForklift, setForkHeight, palletGeometries, makeTruck, makeTree, makeCar,
} from '../assets.js';
import { FORKLIFT as FL, PALLET } from './model.js';

const EL = Math.atan(1 / Math.SQRT2); // true isometric camera elevation (35.26°)
const TAU = Math.PI * 2;

export class WarehouseScene {
  constructor(container, model) {
    this.m = model;
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    scene.fog = new THREE.Fog(COLORS.background, 150, 300);
    scene.add(new THREE.HemisphereLight('#ffffff', '#b7c3d8', 2.2));
    const sun = this.sun = new THREE.DirectionalLight('#fff8ee', 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    scene.add(new THREE.AmbientLight('#dfe7f5', 0.35));

    this.world = new THREE.Group();
    scene.add(this.world);

    // Camera: orthographic, looking down at the isometric angle.
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
    const W = model.W, D = model.D;
    this.view = {
      target: new THREE.Vector3(W / 2, 0, D / 2 + 3), targetT: new THREE.Vector3(W / 2, 0, D / 2 + 3),
      az: Math.PI / 4, azT: Math.PI / 4, zoom: 1, zoomT: 1, size: 46,
    };
    this.home = { target: this.view.target.clone(), az: this.view.az, zoom: 1 };

    this.forklifts = new Map();
    this.selected = null;
    this.showCameras = true;
    this.hint = null;
    this.raycaster = new THREE.Raycaster();

    this.buildStatic();
    this.buildPallets();
    this.buildMarkers();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- camera

  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    const a = w / h;
    // On a narrow phone screen, fit the building's width instead of its height.
    this.view.size = a < 1 ? Math.min(110, 46 / a * 0.8) : 46;
    const s = this.view.size;
    Object.assign(this.cam, { left: -s * a / 2, right: s * a / 2, top: s / 2, bottom: -s / 2 });
    this.cam.updateProjectionMatrix();
  }

  placeCamera(dt) {
    const v = this.view, k = 1 - Math.exp(-dt * 8);
    v.target.lerp(v.targetT, k);
    v.az += (v.azT - v.az) * k;
    v.zoom += (v.zoomT - v.zoom) * k;
    const R = 160, t = v.target;
    this.cam.position.set(t.x + R * Math.cos(EL) * Math.sin(v.az), t.y + R * Math.sin(EL), t.z + R * Math.cos(EL) * Math.cos(v.az));
    this.cam.lookAt(t);
    this.cam.zoom = v.zoom;
    this.cam.updateProjectionMatrix();
    // Shadows follow the part of the warehouse in view.
    const span = Math.min(75, Math.max(22, v.size / v.zoom * 0.95));
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 220 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(t.x - 30, 70, t.z + 40);
    this.sun.target.position.copy(t);
    // Hide the walls between the camera and the inside of the building.
    const cx = Math.sin(v.az), cz = Math.cos(v.az);
    for (const w of this.walls) w.group.visible = w.nx * cx + w.nz * cz < 0.25;
  }

  // Ground units per screen pixel.
  unitsPerPixel() {
    return (this.cam.top - this.cam.bottom) / this.cam.zoom / this.renderer.domElement.clientHeight;
  }
  pan(dxPx, dyPx) {
    const k = this.unitsPerPixel(), az = this.view.az;
    const rx = Math.cos(az), rz = -Math.sin(az);          // screen right on the floor
    const fx = -Math.sin(az), fz = -Math.cos(az);         // screen up on the floor
    const up = 1 / Math.sin(EL);
    const t = this.view.targetT;
    t.x -= (rx * dxPx - fx * dyPx * up) * k;
    t.z -= (rz * dxPx - fz * dyPx * up) * k;
    this.clampTarget();
  }
  zoomBy(f, px, py) {
    const v = this.view, before = this.floorPoint(px, py);
    v.zoomT = Math.min(6, Math.max(0.45, v.zoomT * f));
    if (before && px != null) {
      // Keep the point under the cursor in place.
      const ratio = 1 - 1 / f;
      v.targetT.x += (before.x - v.targetT.x) * ratio;
      v.targetT.z += (before.z - v.targetT.z) * ratio;
      this.clampTarget();
    }
  }
  rotateBy(rad) { this.view.azT += rad; }
  rotateStep(dir) { this.view.azT = Math.round((this.view.azT - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4 + dir * Math.PI / 2; }
  resetView() { const h = this.home; this.view.targetT.copy(h.target); this.view.zoomT = h.zoom; this.view.azT = Math.round((this.view.azT - h.az) / TAU) * TAU + h.az; }
  focus(x, y, zoom) { this.view.targetT.set(x, 0, y); if (zoom) this.view.zoomT = Math.max(this.view.zoomT, zoom); }
  clampTarget() {
    const t = this.view.targetT;
    t.x = Math.min(this.m.W + 25, Math.max(-25, t.x));
    t.z = Math.min(this.m.D + 30, Math.max(-25, t.z));
  }

  ndc(px, py) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
  }
  floorPoint(px, py) {
    if (px == null) return null;
    this.raycaster.setFromCamera(this.ndc(px, py), this.cam);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  // What is under the pointer: { kind: 'forklift'|'pallet', id } or null.
  pick(px, py) {
    this.raycaster.setFromCamera(this.ndc(px, py), this.cam);
    const groups = [...this.forklifts.values()].map(f => f.group);
    const hitF = this.raycaster.intersectObjects(groups, true)[0];
    for (const m of this.palletMeshes) m.computeBoundingSphere();
    const hitP = this.raycaster.intersectObjects(this.palletMeshes, false)[0];
    if (hitF && (!hitP || hitF.distance <= hitP.distance + 0.5)) {
      let o = hitF.object; while (o && !o.userData.fid) o = o.parent;
      if (o) return { kind: 'forklift', id: o.userData.fid };
    }
    if (hitP) {
      const id = hitP.object.userData.ids[hitP.instanceId];
      if (id) return { kind: 'pallet', id };
    }
    return null;
  }

  // ----------------------------------------------------------- static build

  buildStatic() {
    const m = this.m, L = m.layout, W = m.W, D = m.D, C = COLORS, world = this.world;
    const batch = new Batch();

    // Ground, truck yard, road.
    plane(world, 400, 400, C.ground, W / 2, -0.02, D / 2);
    plane(world, W + 30, 22, C.yard, W / 2, -0.01, D + 11);
    plane(world, W + 120, 9, C.road, W / 2, -0.005, D + 26.5);
    for (let x = -50; x < W + 60; x += 6) batch.add('#ffffff', 3, 0.01, 0.18, x, 0.002, D + 26.5, false);
    plane(world, W + 120, 1.4, '#e9edf4', W / 2, 0.0, D + 21.4);
    // Building floor.
    plane(world, W, D, C.floor, W / 2, 0.005, D / 2);

    // Walls (one group per side so the ones facing the camera can be hidden).
    this.walls = [];
    const H = L.building.wallHeight, t = 0.25;
    const doorW = L.docks.doorWidth;
    const wall = (side, nx, nz, segs) => {
      const g = new THREE.Group();
      for (const [x0, z0, x1, z1] of segs) {
        const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
        box(g, alongX ? len : t, H, alongX ? t : len, C.wall, cx, H / 2, cz);
        box(g, alongX ? len : t + 0.06, 0.22, alongX ? t + 0.06 : len, C.wallTrim, cx, H + 0.11, cz);
      }
      world.add(g);
      this.walls.push({ side, nx, nz, group: g });
    };
    wall('north', 0, -1, [[-t, -t / 2, W + t, -t / 2]]);
    wall('west', -1, 0, [[-t / 2, 0, -t / 2, D]]);
    wall('east', 1, 0, [[W + t / 2, 0, W + t / 2, D]]);
    const doors = m.docks.map(d => d.x).sort((a, b) => a - b);
    const southSegs = []; let x = -t;
    for (const dx of doors) { southSegs.push([x, D + t / 2, dx - doorW / 2 - 0.2, D + t / 2]); x = dx + doorW / 2 + 0.2; }
    southSegs.push([x, D + t / 2, W + t, D + t / 2]);
    wall('south', 0, 1, southSegs);

    // Dock doors, frames, levelers and trucks.
    m.docks.forEach((d, i) => {
      const g = new THREE.Group(); g.position.set(d.x, 0, D + t / 2); world.add(g);
      box(g, 0.35, 3.9, 0.5, C.dockFrame, -doorW / 2 - 0.18, 1.95, 0);
      box(g, 0.35, 3.9, 0.5, C.dockFrame, doorW / 2 + 0.18, 1.95, 0);
      box(g, doorW + 0.7, 0.5, 0.55, C.dockFrame, 0, 3.85, 0);
      const door = box(g, doorW, 0.9, 0.12, C.dockDoor, 0, 3.15, -0.05);
      for (let k = 0; k < 3; k++) box(g, doorW, 0.02, 0.13, '#aeb8c8', 0, 2.8 + k * 0.25, -0.05, false);
      void door;
      box(g, doorW - 0.2, 0.08, 1.8, '#b9c3d2', 0, 0.04, 1.1);               // leveler outside
      for (const s of [-1, 1]) box(g, 0.25, 0.35, 0.18, '#2f3a4c', s * (doorW / 2 - 0.35), 1.1, 0.35); // bumpers
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: d.kind === 'inbound' ? '#3ccf7d' : '#f2a72b', emissive: d.kind === 'inbound' ? '#2ab36a' : '#e08d12', emissiveIntensity: 0.6 }));
      lamp.position.set(doorW / 2 + 0.55, 2.6, -0.3); g.add(lamp);
      // Painted lane, labels.
      const lane = d.lane;
      outline(batch, C.floorLine, lane.cx, lane.cy, lane.hx + 0.1, lane.hy + 0.1, 0.07);
      floorText(world, d.id, d.x, D - 1.5, 2.2, 1.1, { color: '#8d9bb3' });
      floorText(world, d.kind === 'inbound' ? 'IN' : 'OUT', d.x, D - 7.0, 1.6, 0.8, { color: d.kind === 'inbound' ? '#2fa36b' : '#d98b1a' });
      // Trucks at most doors (static for now).
      if (i % 3 !== 2) {
        const tr = makeTruck(i < 3 ? COLORS.truckStripe : '#5b7cf0');
        tr.position.set(d.x, 0, D + 0.6 + 6.35);
        tr.rotation.y = -Math.PI / 2;
        world.add(tr);
      }
      // Truck bay lines on the yard.
      batch.add(C.floorLine, 0.12, 0.01, 13, d.x - 1.9, 0.004, D + 7, false);
      batch.add(C.floorLine, 0.12, 0.01, 13, d.x + 1.9, 0.004, D + 7, false);
    });

    // Rack rows.
    for (const r of m.racks) this.buildRack(batch, r);
    // Aisle edge lines and labels.
    for (const z of m.aisles) {
      const b = z.box, alongX = b.hx > b.hy;
      if (alongX) {
        batch.add(C.floorLine, b.hx * 2, 0.01, 0.08, b.cx, 0.012, b.cy - b.hy + 0.2, false);
        batch.add(C.floorLine, b.hx * 2, 0.01, 0.08, b.cx, 0.012, b.cy + b.hy - 0.2, false);
        floorText(world, z.id, b.cx - b.hx - 2.4, b.cy, 2.6, 1.1, { rot: 0 });
        floorText(world, z.id, b.cx + b.hx + 2.4, b.cy, 2.6, 1.1, { rot: 0 });
      } else {
        batch.add(C.floorLine, 0.08, 0.01, b.hy * 2, b.cx - b.hx + 0.2, 0.012, b.cy, false);
        batch.add(C.floorLine, 0.08, 0.01, b.hy * 2, b.cx + b.hx - 0.2, 0.012, b.cy, false);
        floorText(world, z.id, b.cx, b.cy - b.hy - 2.4, 2.6, 1.1, { rot: Math.PI / 2 });
      }
    }

    // Chargers.
    if (m.chargers.length) {
      const ys = m.chargers.map(c => c.y), xs = m.chargers.map(c => c.x);
      const x0 = Math.min(...xs) - 0.4, x1 = Math.max(...xs) + 4.6, y0 = Math.min(...ys) - 1.6, y1 = Math.max(...ys) + 1.6;
      outline(batch, C.chargeZone, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0.09);
      floorText(world, 'CHARGING', (x0 + x1) / 2 + 0.5, y0 - 1.0, 3.6, 0.8, { color: '#2fa36b' });
    }
    for (const c of m.chargers) {
      const g = new THREE.Group(); g.position.set(c.x, 0, c.y); g.rotation.y = -(c.heading || 0) * Math.PI / 180; world.add(g);
      box(g, 0.6, 1.3, 0.9, C.charger, 0, 0.65, 0);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: '#4be39a', emissive: '#2bd27f', emissiveIntensity: 0.8 }));
      led.position.set(0.31, 1.0, 0); g.add(led);
    }

    // Offices and other blocks.
    for (const o of m.obstacles) {
      const g = new THREE.Group(); g.position.set(o.x + o.w / 2, 0, o.y + o.h / 2); world.add(g);
      const h = 3.2;
      box(g, o.w, h, o.h, C.office, 0, h / 2, 0);
      box(g, o.w + 0.1, 0.2, o.h + 0.1, C.wallTrim, 0, h + 0.1, 0);
      const glass = mat(C.officeGlass, { emissive: '#9fc0f2', emissiveIntensity: 0.15 });
      for (let k = 0; k < Math.floor(o.w / 1.6); k++) {
        box(g, 1.1, 1.2, 0.05, glass, -o.w / 2 + 0.9 + k * 1.6, 1.9, -o.h / 2 - 0.02, false);
        box(g, 1.1, 1.2, 0.05, glass, -o.w / 2 + 0.9 + k * 1.6, 1.9, o.h / 2 + 0.02, false);
      }
      for (let k = 0; k < Math.floor(o.h / 1.6); k++) box(g, 0.05, 1.2, 1.1, glass, -o.w / 2 - 0.02, 1.9, -o.h / 2 + 0.9 + k * 1.6, false);
      floorText(world, (o.kind || o.id).toUpperCase(), o.x + o.w / 2, o.y - 0.9, 3.2, 0.8);
    }

    // Trees and parked cars around the site.
    const rnd = mulberry(5);
    const treeAt = (x, z, s) => { const tr = makeTree(s); tr.position.set(x, 0, z); world.add(tr); };
    for (let x = -6; x < W + 8; x += 7 + rnd() * 4) treeAt(x, -6 - rnd() * 3, 0.9 + rnd() * 0.4);
    for (let z = 2; z < D + 20; z += 6 + rnd() * 4) treeAt(-9 - rnd() * 3, z, 0.9 + rnd() * 0.4);
    for (let z = -2; z < D + 18; z += 7 + rnd() * 4) treeAt(W + 8 + rnd() * 3, z, 0.9 + rnd() * 0.4);
    for (let x = -10; x < W + 12; x += 8 + rnd() * 5) treeAt(x, D + 33 + rnd() * 2, 0.9 + rnd() * 0.4);
    const carColors = ['#f26d5b', '#5b7cf0', '#9b7cf0', '#ffffff', '#2cc3b5', '#f2c230'];
    plane(world, 12, 20, C.yard, -20, -0.005, D - 6);
    for (let k = 0; k < 7; k++) {
      const c = makeCar(carColors[k % carColors.length]);
      c.position.set(-23 + (k % 2) * 6, 0, D - 15 + Math.floor(k / 2) * 3.2 + (k % 2) * 1.2);
      c.rotation.y = k % 2 ? Math.PI : 0;
      if (rnd() < 0.85) world.add(c);
      batch.add('#ffffff', 0.1, 0.01, 2.6, -23 + (k % 2) * 6 - 2.2 + 4.4 * (k % 2), 0.002, D - 15 + Math.floor(k / 2) * 3.2 + 1.6, false);
    }
    // Lamp posts along the yard.
    for (let x = 4; x < W; x += 14) {
      const g = new THREE.Group(); g.position.set(x, 0, D + 20.4); world.add(g);
      cyl(g, 0.07, 5, '#9aa6b8', 0, 2.5, 0, 'y', 8);
      box(g, 0.9, 0.12, 0.25, '#9aa6b8', -0.4, 5, 0);
    }

    batch.build(world);
  }

  buildRack(batch, r) {
    const C = COLORS, levels = r.levels, lh = r.levelHeight;
    const topH = (levels - 1) * lh + 1.55;
    const alongX = r.dir !== 'y';
    // Helper: place a box given along / across (from the row's start) / height.
    const put = (color, aLen, h, cLen, a, c, y, shadow = true) => {
      if (alongX) batch.add(color, aLen, h, cLen, r.x0 + a, y, r.y0 + c, shadow);
      else batch.add(color, cLen, h, aLen, r.x0 + c, y, r.y0 + a, shadow);
    };
    const front = 0.05, back = r.depth - 0.05;
    for (let k = 0; k <= r.bays; k++) {
      const a = k * r.bayWidth;
      for (const c of [front, back]) {
        put(C.rackUpright, 0.09, topH, 0.09, a, c, topH / 2);
        put('#2f3a4c', 0.2, 0.03, 0.2, a, c, 0.015, false);
      }
      // Cross ties between the front and back uprights.
      for (const y of [0.6, 2.0, 3.4]) if (y < topH) put(C.rackUpright, 0.05, 0.05, r.depth - 0.1, a, r.depth / 2, y, false);
    }
    for (let b = 0; b < r.bays; b++) {
      const a = (b + 0.5) * r.bayWidth;
      for (let l = 1; l < levels; l++) {
        const y = l * lh - 0.07;
        put(C.rackBeam, r.bayWidth - 0.09, 0.13, 0.07, a, front, y);
        put(C.rackBeam, r.bayWidth - 0.09, 0.13, 0.07, a, back, y);
      }
      put(C.rackBeam, r.bayWidth - 0.09, 0.1, 0.06, a, front, topH - 0.06, false);
      put(C.rackBeam, r.bayWidth - 0.09, 0.1, 0.06, a, back, topH - 0.06, false);
    }
  }

  // --------------------------------------------------------------- pallets

  buildPallets() {
    const geo = palletGeometries();
    const n = this.m.slots.length + 64;
    const mk = (g, color) => {
      const im = new THREE.InstancedMesh(g, mat(color), n);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      im.userData.ids = [];
      this.world.add(im);
      return im;
    };
    this.palletBase = mk(geo.base, COLORS.palletWood);
    this.palletTape = mk(geo.tape, COLORS.tape);
    this.palletTape.castShadow = false;
    this.palletLoads = new Map(this.m.skus.map(s => [s.id, mk(geo.load, s.color)]));
    this.palletMeshes = [this.palletBase, ...this.palletLoads.values()];
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  // Where a pallet is drawn: { x, y (layout), z (height), heading }.
  palletPose(p, fleetById) {
    if (p.slot) {
      const s = this.m.slotById.get(p.slot);
      return s && { x: s.x, y: s.y, z: s.z, heading: s.heading };
    }
    if (p.forklift) {
      const f = fleetById.get(p.forklift);
      if (!f) return null;
      return { x: f.x + Math.cos(f.heading) * FL.forkCenter, y: f.y + Math.sin(f.heading) * FL.forkCenter, z: Math.max(0, f.fork - 0.04), heading: f.heading };
    }
    if (p.floor) return { x: p.floor.x, y: p.floor.y, z: 0, heading: p.floor.heading || 0 };
    return null;
  }

  updatePallets(pallets, fleetById) {
    const counts = new Map();
    const base = this.palletBase, tape = this.palletTape;
    base.userData.ids.length = 0;
    let n = 0;
    const m4 = this._m4, q = this._q, pos = this._p, sc = this._s, e = this._e;
    for (const lm of this.palletLoads.values()) { lm.count = 0; lm.userData.ids.length = 0; }
    this.palletPoses = new Map();
    for (const p of pallets.values()) {
      const ps = this.palletPose(p, fleetById);
      if (!ps) continue;
      this.palletPoses.set(p.id, ps);
      const sku = this.m.skuById.get(p.sku) || this.m.skus[0];
      q.setFromEuler(e.set(0, -ps.heading, 0));
      sc.set(1, 1, 1);
      m4.compose(pos.set(ps.x, ps.z, ps.y), q, sc);
      base.setMatrixAt(n, m4);
      base.userData.ids[n] = p.id;
      m4.compose(pos.set(ps.x, ps.z + PALLET.base + sku.h + 0.006, ps.y), q, sc);
      tape.setMatrixAt(n, m4);
      n++;
      const lm = this.palletLoads.get(sku.id);
      if (lm) {
        sc.set(1, sku.h, 1);
        m4.compose(pos.set(ps.x, ps.z + PALLET.base, ps.y), q, sc);
        lm.setMatrixAt(lm.count, m4);
        lm.userData.ids[lm.count] = p.id;
        lm.count++;
      }
      counts.set(sku.id, (counts.get(sku.id) || 0) + 1);
    }
    base.count = n; tape.count = n;
    base.instanceMatrix.needsUpdate = true; tape.instanceMatrix.needsUpdate = true;
    for (const lm of this.palletLoads.values()) lm.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------- markers & forklifts

  buildMarkers() {
    const C = COLORS;
    // Selected pallet: outline plus a bobbing pin.
    this.palOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1, 1.1)), new THREE.LineBasicMaterial({ color: C.select }));
    this.palOutline.visible = false;
    this.pin = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: C.select, emissive: C.select, emissiveIntensity: 0.25 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 18), pinMat); cone.rotation.x = Math.PI; cone.position.y = 0.35;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), pinMat); ball.position.y = 0.85;
    this.pin.add(cone, ball); this.pin.visible = false;
    // Slot hint while driving: where Space would pick or drop.
    this.slotHint = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1.2, 1.1)), new THREE.LineBasicMaterial({ color: '#22b573' }));
    this.slotHint.visible = false;
    for (const o of [this.palOutline, this.slotHint]) { o.material.depthTest = false; o.renderOrder = 8; }
    this.pin.traverse(o => { if (o.isMesh) { o.material.depthTest = false; o.material.transparent = true; o.renderOrder = 9; } });
    this.world.add(this.palOutline, this.pin, this.slotHint);
  }

  forkliftView(f) {
    let v = this.forklifts.get(f.id);
    if (v) return v;
    const C = COLORS;
    const group = makeForklift();
    group.userData.fid = f.id;
    this.world.add(group);
    // Selection ring.
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.15, 48), new THREE.MeshBasicMaterial({ color: C.select, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
    // Safety zone in front of the forklift (amber = slowing, red = stopped).
    const zoneMat = new THREE.MeshBasicMaterial({ color: C.safeSlow, transparent: true, opacity: 0.32, depthWrite: false });
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), zoneMat);
    zone.rotation.x = -Math.PI / 2; zone.position.y = 0.025; zone.visible = false;
    // The four safety cameras' views (front, back, left, right).
    const fov = new THREE.Group(); fov.visible = false;
    const fovMat = new THREE.MeshBasicMaterial({ color: C.cameraView, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
    const edgeMat = new THREE.LineBasicMaterial({ color: C.cameraView, transparent: true, opacity: 0.6 });
    for (const c of CAMERAS) {
      const span = c.fov * Math.PI / 180;
      const g = new THREE.CircleGeometry(c.range, 24, -span / 2, span);
      const w = new THREE.Mesh(g, fovMat);
      w.rotation.x = -Math.PI / 2;
      // angle is clockwise seen from above (90 = right), like layout headings.
      const holder = new THREE.Group(); holder.rotation.y = -c.angle * Math.PI / 180; holder.position.set(c.x, 0.02, c.z);
      holder.add(w);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat); edge.rotation.x = -Math.PI / 2; holder.add(edge);
      // Little camera body on the forklift.
      const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), mat('#1b2638'));
      camBox.position.set(0.05, 2.25 - 0.02, 0); holder.add(camBox);
      fov.add(holder);
    }
    group.add(fov);
    // X-ray silhouette: drawn only where something (a rack) hides the forklift.
    const ghost = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({ color: '#1b2638', transparent: true, opacity: 0.38, depthWrite: false, depthFunc: THREE.GreaterDepth });
    for (const [x0, x1, y0, y1, hw] of [[FL.back, 0.32, 0, 1.0, 0.6], [-1.05, 0.28, 1.0, 2.27, 0.56], [0.3, 0.56, 0, 2.35, 0.4]]) {
      const gm = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.06, y1 - y0 + 0.06, hw * 2 + 0.06), ghostMat);
      gm.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      gm.renderOrder = 5;
      ghost.add(gm);
    }
    const forkGhost = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.12, 0.8), ghostMat);
    forkGhost.position.set(1.05, 0.05, 0); forkGhost.renderOrder = 5;
    group.userData.carriage.add(forkGhost);
    group.add(ghost);
    // Name tag.
    const label = textSprite(f.id, '#1b2638', '#ffffff');
    label.position.set(0, 3.0, 0);
    group.add(label);
    this.world.add(ring, zone);
    v = { group, ring, zone, zoneMat, fov, label, ghostMat, labelText: f.id, phase: Math.random() * 10 };
    this.forklifts.set(f.id, v);
    return v;
  }

  updateForklifts(fleet, t) {
    const seen = new Set();
    for (const f of fleet) {
      seen.add(f.id);
      const v = this.forkliftView(f);
      const g = v.group;
      g.visible = true;
      g.position.set(f.x, 0, f.y);
      g.rotation.y = -f.heading;
      setForkHeight(g, f.fork);
      g.userData.beacon.emissiveIntensity = f.moving ? (Math.sin(t * 10 + v.phase) > 0 ? 1.4 : 0.15) : 0.15;
      // Live forklifts that stopped reporting fade to grey.
      const stale = f.mode === 'live' && f.stale;
      if (v.stale !== stale) {
        v.stale = stale;
        g.userData.body.traverse(o => {
          if (!o.isMesh) return;
          o.userData.orig = o.userData.orig || o.material;
          o.material = stale ? greyOf(o.userData.orig) : o.userData.orig;
        });
      }
      const sel = !!(this.selected && this.selected.kind === 'forklift' && this.selected.id === f.id);
      v.ring.visible = sel;
      if (sel) {
        v.ring.position.set(f.x, 0.03, f.y);
        const s = 1 + Math.sin(t * 4) * 0.04; v.ring.scale.set(s, s, s);
      }
      v.fov.visible = sel && this.showCameras;
      v.ghostMat.color.set(sel ? COLORS.select : '#1b2638');
      v.ghostMat.opacity = sel ? 0.6 : 0.34;
      // Safety zone.
      if (f.zone && f.zone !== 'clear') {
        const dir = f.speed < -0.05 ? -1 : 1;
        const len = f.zone === 'stop' ? 1.2 : 2.6;
        const reach = dir > 0 ? FL.front : -FL.back;
        const cx = f.x + Math.cos(f.heading) * dir * (reach + len / 2), cy = f.y + Math.sin(f.heading) * dir * (reach + len / 2);
        v.zone.visible = true;
        v.zone.position.set(cx, 0.025, cy);
        v.zone.rotation.set(-Math.PI / 2, 0, f.heading);
        v.zone.scale.set(len, 1.5, 1);
        v.zoneMat.color.set(f.zone === 'stop' ? COLORS.safeStop : COLORS.safeSlow);
      } else v.zone.visible = false;
    }
    for (const [id, v] of this.forklifts) if (!seen.has(id)) { v.group.visible = false; v.ring.visible = false; v.zone.visible = false; }
  }

  updateMarkers(t, model, hint) {
    const sel = this.selected;
    let pose = null, sku = null;
    if (sel && sel.kind === 'pallet' && this.palletPoses) {
      pose = this.palletPoses.get(sel.id);
      sku = sel.sku && this.m.skuById.get(sel.sku);
    }
    this.palOutline.visible = this.pin.visible = !!pose;
    if (pose) {
      const h = (sku ? sku.h : 1) + PALLET.base;
      this.palOutline.position.set(pose.x, pose.z + h / 2, pose.y);
      this.palOutline.scale.set(1, h + 0.08, 1);
      this.palOutline.rotation.y = -pose.heading;
      this.pin.position.set(pose.x, pose.z + h + 0.5 + Math.abs(Math.sin(t * 3)) * 0.4, pose.y);
    }
    this.slotHint.visible = !!hint;
    if (hint) {
      const s = this.m.slotById.get(hint.slot);
      this.slotHint.position.set(s.x, s.z + 0.62, s.y);
      this.slotHint.rotation.y = -s.heading;
      this.slotHint.material.color.set(hint.action === 'pick' ? '#22b573' : '#2f5be0');
    }
  }

  render(dt, t) {
    this.placeCamera(dt);
    // Keep labels a steady size on screen whatever the zoom.
    const k = 1 / this.view.zoom;
    for (const v of this.forklifts.values()) v.label.scale.set(2.2 * k * v.label.userData.aspect * 0.42, 2.2 * k * 0.42, 1);
    this.renderer.render(this.scene, this.cam);
  }
}

// ------------------------------------------------------------------ helpers

// Collects many small static boxes and merges them into one mesh per color.
class Batch {
  constructor() { this.parts = new Map(); }
  add(color, w, h, d, x, y, z, shadow = true) {
    const key = color + (shadow ? '' : '|ns');
    if (!this.parts.has(key)) this.parts.set(key, { color, shadow, geos: [] });
    this.parts.get(key).geos.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  }
  build(parent) {
    for (const { color, shadow, geos } of this.parts.values()) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat(color));
      m.castShadow = shadow; m.receiveShadow = true;
      parent.add(m);
      geos.forEach(g => g.dispose());
    }
  }
}

function plane(parent, w, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true;
  parent.add(m);
  return m;
}

function outline(batch, color, cx, cy, hx, hy, w) {
  batch.add(color, hx * 2 + w, 0.01, w, cx, 0.013, cy - hy, false);
  batch.add(color, hx * 2 + w, 0.01, w, cx, 0.013, cy + hy, false);
  batch.add(color, w, 0.01, hy * 2 + w, cx - hx, 0.013, cy, false);
  batch.add(color, w, 0.01, hy * 2 + w, cx + hx, 0.013, cy, false);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function floorText(parent, text, x, z, w, h, opts = {}) {
  const tex = canvasTexture(Math.round(128 * w / h), 128, (g, W, H) => {
    g.fillStyle = opts.color || COLORS.floorText;
    g.font = `800 ${opts.size || 92}px Figtree, "Segoe UI", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 4);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  if (opts.rot) m.rotation.z = opts.rot;
  m.position.set(x, 0.02, z);
  parent.add(m);
  return m;
}

function textSprite(text, bg, fg) {
  const pad = 22, fs = 54;
  const tmp = document.createElement('canvas').getContext('2d');
  tmp.font = `700 ${fs}px Figtree, system-ui, sans-serif`;
  const w = Math.ceil(tmp.measureText(text).width) + pad * 2, h = fs + pad * 1.2;
  const tex = canvasTexture(w, h, (g) => {
    g.fillStyle = bg; g.globalAlpha = 0.86;
    const r = h / 2;
    g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, h); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); g.fill();
    g.globalAlpha = 1; g.fillStyle = fg; g.font = `700 ${fs}px Figtree, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 3);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 10;
  sp.userData.aspect = w / h;
  return sp;
}

const greyCache = new Map();
function greyOf(material) {
  if (!greyCache.has(material)) {
    const g = material.clone();
    const c = material.color; const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    g.color.setRGB(l * 0.7 + 0.25, l * 0.7 + 0.25, l * 0.7 + 0.28);
    if (g.emissive) g.emissiveIntensity = 0;
    greyCache.set(material, g);
  }
  return greyCache.get(material);
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
