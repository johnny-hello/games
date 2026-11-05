// 3D models for the warehouse, built from simple shapes (boxes, cylinders).
// Edit colors and sizes here to restyle the scene.
//
// To use a real model instead (for example one made in Blender), put a .glb
// file in warehouse/models/ and set its path in GLTF below. The forklift's
// forks are still drawn here so they can lift.

import * as THREE from 'three';

export const COLORS = {
  background: '#e6e9f5',
  ground: '#e3e9f2',
  yard: '#d9e0ea',
  floor: '#f6f8fc',
  road: '#cfd8e6',
  roadLine: '#ffffff',
  wall: '#dfe5ee',
  wallTrim: '#3a63e0',
  rackUpright: '#3557d6',
  rackBeam: '#f39a2b',
  floorLine: '#f2c230',
  floorText: '#8d9bb3',
  chargeZone: '#2fb37a',
  forkliftBody: '#f6c026',
  forkliftDark: '#e0a414',
  forkliftFrame: '#2f3a4c',
  mast: '#6b778a',
  tire: '#262d3a',
  hub: '#c8d0dc',
  vest: '#ff7a2f',
  skin: '#f0c39b',
  hardHat: '#ffd23f',
  beacon: '#ffb020',
  palletWood: '#c99a60',
  tape: '#f4e6c4',
  dockFrame: '#3a63e0',
  dockDoor: '#c9d1de',
  trailer: '#f7f9fc',
  truckStripe: '#2cc3b5',
  truckCab: '#ffffff',
  truckDark: '#3b4658',
  glass: '#2a3950',
  office: '#ffffff',
  officeGlass: '#bcd3f5',
  charger: '#2f3a4c',
  tree: '#6fdba6',
  treeDark: '#4fc58c',
  trunk: '#a77b52',
  select: '#2f5be0',
  safeSlow: '#f2a72b',
  safeStop: '#e5484d',
  cameraView: '#3a8ef6',
};

// The forklift's safety cameras (shown as blue view cones when a forklift is
// selected). x = meters forward from the forklift's middle, z = meters to the
// right, angle = degrees from straight ahead (90 = right), fov = degrees,
// range = meters. Change these to match the real camera mounting.
export const CAMERAS = [
  { name: 'front', x: 0.4, z: 0, angle: 0, fov: 100, range: 7 },
  { name: 'rear', x: -1.5, z: 0, angle: 180, fov: 100, range: 7 },
  { name: 'left', x: -0.6, z: -0.6, angle: -90, fov: 100, range: 6 },
  { name: 'right', x: -0.6, z: 0.6, angle: 90, fov: 100, range: 6 },
];

// Optional .glb models, e.g. { forklift: 'models/forklift.glb' }.
export const GLTF = {
  forklift: null,  // replaces the body; the forks stay
  truck: null,
};

// ------------------------------------------------------------ helpers

const mats = new Map();
export function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts }));
  return mats.get(key);
}
const geos = new Map();
function boxGeo(w, h, d) {
  const k = `b${w}|${h}|${d}`;
  if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d));
  return geos.get(k);
}
function cylGeo(rt, rb, h, seg = 16) {
  const k = `c${rt}|${rb}|${h}|${seg}`;
  if (!geos.has(k)) geos.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geos.get(k);
}
// Box of size w (x, forward) × h (y, up) × d (z, sideways), centered at (x, y, z).
export function box(parent, w, h, d, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), typeof color === 'string' ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function cyl(parent, r, h, color, x, y, z, axis = 'y', seg = 16) {
  const m = new THREE.Mesh(cylGeo(r, r, h, seg), typeof color === 'string' ? mat(color) : color);
  m.position.set(x, y, z);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------ forklift
// Local axes: +x = forward (forks), +y = up, z = sideways. The origin is the
// middle of the forklift's footprint (see FORKLIFT in src/model.js).

export function makeForklift() {
  const C = COLORS;
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  // Chassis, counterweight, engine cover.
  box(body, 1.25, 0.55, 1.12, C.forkliftBody, -0.35, 0.58, 0);
  box(body, 0.55, 0.95, 1.14, C.forkliftDark, -1.2, 0.68, 0);
  box(body, 0.5, 0.18, 1.0, C.forkliftDark, -0.75, 0.95, 0);
  box(body, 0.06, 0.12, 1.16, C.forkliftFrame, -1.48, 0.3, 0);
  // Seat and driver.
  box(body, 0.42, 0.14, 0.52, C.forkliftFrame, -0.62, 0.95, 0);
  box(body, 0.1, 0.5, 0.52, C.forkliftFrame, -0.86, 1.22, 0);
  cyl(body, 0.19, 0.52, C.vest, -0.55, 1.3, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat(C.skin));
  head.position.set(-0.52, 1.72, 0); head.castShadow = true; body.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.hardHat));
  hat.position.set(-0.52, 1.76, 0); hat.castShadow = true; body.add(hat);
  // Steering column and wheel.
  box(body, 0.06, 0.35, 0.06, C.forkliftFrame, -0.12, 1.02, 0);
  cyl(body, 0.13, 0.04, C.forkliftFrame, -0.17, 1.2, 0, 'y', 14);
  // Overhead guard.
  for (const x of [-1.0, 0.2]) for (const z of [-0.5, 0.5]) box(body, 0.07, 1.3, 0.07, C.forkliftFrame, x, 1.5, z);
  box(body, 1.3, 0.06, 1.08, C.forkliftFrame, -0.4, 2.17, 0);
  for (const x of [-0.65, -0.4, -0.15]) box(body, 0.05, 0.05, 1.0, C.forkliftFrame, x, 2.12, 0, false);
  // Beacon light (blinks while moving).
  const beaconMat = new THREE.MeshStandardMaterial({ color: C.beacon, emissive: '#ff9a00', emissiveIntensity: 0.2 });
  const beacon = new THREE.Mesh(boxGeo(0.16, 0.12, 0.16), beaconMat);
  beacon.position.set(-0.9, 2.26, 0); body.add(beacon);
  // Wheels.
  for (const [x, r] of [[0.12, 0.3], [-1.05, 0.26]]) {
    for (const z of [-0.5, 0.5]) {
      cyl(body, r, 0.24, C.tire, x, r, z, 'z', 18);
      cyl(body, r * 0.45, 0.26, C.hub, x, r, z, 'z', 12);
    }
  }
  // Mast (outer stays, inner slides up when the forks go high).
  const mast = new THREE.Group();
  g.add(mast);
  for (const z of [-0.32, 0.32]) box(mast, 0.1, 2.25, 0.1, C.mast, 0.37, 1.18, z);
  box(mast, 0.1, 0.1, 0.74, C.mast, 0.37, 2.28, 0);
  box(mast, 0.1, 0.12, 0.74, C.mast, 0.37, 0.2, 0);
  const inner = new THREE.Group();
  g.add(inner);
  for (const z of [-0.22, 0.22]) box(inner, 0.08, 2.1, 0.08, C.mast, 0.45, 1.15, z);
  box(inner, 0.08, 0.08, 0.52, C.mast, 0.45, 2.2, 0);
  // Carriage and forks (move up and down with the fork height).
  const carriage = new THREE.Group();
  g.add(carriage);
  box(carriage, 0.06, 0.75, 0.86, C.forkliftFrame, 0.5, 0.42, 0);
  for (const y of [0.25, 0.5, 0.75]) box(carriage, 0.04, 0.04, 0.86, C.forkliftFrame, 0.53, y, 0, false);
  for (const z of [-0.28, 0.28]) {
    box(carriage, 1.1, 0.05, 0.12, '#3d4757', 1.05, 0.025, z);
    box(carriage, 0.06, 0.4, 0.12, '#3d4757', 0.52, 0.2, z);
  }

  g.userData = { body, carriage, inner, beacon: beaconMat, wheelPhase: 0 };
  if (GLTF.forklift) loadInto(body, GLTF.forklift, true);
  return g;
}

// Put the forks at a height (meters) and slide the inner mast if needed.
export function setForkHeight(fl, h) {
  const u = fl.userData;
  u.carriage.position.y = h;
  u.inner.position.y = Math.max(0, h - 1.4);
}

// ------------------------------------------------------------ pallet parts
// Pallets are drawn with instancing (one draw call per part), so the parts
// are plain geometries. Size: 1.2 m along the forks, 1.0 m across.

export function palletGeometries() {
  return {
    base: new THREE.BoxGeometry(1.2, 0.14, 1.0).translate(0, 0.07, 0),
    load: new THREE.BoxGeometry(1.1, 1, 0.94).translate(0, 0.5, 0), // scaled in y per product
    tape: new THREE.BoxGeometry(1.12, 0.012, 0.18).translate(0, 0, 0),
  };
}

// ------------------------------------------------------------ truck

export function makeTruck(stripe = COLORS.truckStripe) {
  const C = COLORS;
  const g = new THREE.Group();
  // Trailer along local +x, cab at +x end.
  box(g, 9.5, 2.8, 2.5, C.trailer, -1.6, 2.5, 0);
  box(g, 9.52, 0.36, 2.52, stripe, -1.6, 1.25, 0);
  box(g, 3.2, 0.45, 2.54, stripe, 1.4, 3.55, 0, false);    // side band near the front (below the roof)
  box(g, 11.6, 0.34, 1.4, C.truckDark, -0.5, 0.8, 0);
  box(g, 2.3, 2.35, 2.44, C.truckCab, 4.45, 2.0, 0);
  box(g, 1.7, 0.6, 2.36, stripe, 4.2, 3.45, 0);
  box(g, 2.32, 0.3, 2.46, stripe, 4.45, 1.3, 0);
  box(g, 0.08, 0.9, 2.1, C.glass, 5.6, 2.5, 0);
  for (const z of [-1.22, 1.22]) box(g, 0.9, 0.7, 0.05, C.glass, 4.7, 2.5, z);
  box(g, 0.3, 0.32, 2.48, C.truckDark, 5.62, 0.9, 0);
  for (const z of [-0.85, 0.85]) box(g, 0.05, 0.18, 0.4, '#ffe7a3', 5.66, 1.15, z, false);
  for (const x of [4.8, 2.6, -4.6, -5.8]) {
    for (const z of [-1.06, 1.06]) {
      cyl(g, 0.5, 0.38, C.tire, x, 0.5, z, 'z', 18);
      cyl(g, 0.22, 0.4, C.hub, x, 0.5, z, 'z', 12);
    }
  }
  if (GLTF.truck) { g.clear(); loadInto(g, GLTF.truck, false); }
  return g;
}

// ------------------------------------------------------------ scenery

export function makeTree(scale = 1) {
  const g = new THREE.Group();
  cyl(g, 0.12 * scale, 1.4 * scale, COLORS.trunk, 0, 0.7 * scale, 0, 'y', 8);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.95 * scale, 18, 14), mat(COLORS.tree));
  crown.position.y = 2.0 * scale; crown.castShadow = true; g.add(crown);
  return g;
}

export function makeCar(color) {
  const g = new THREE.Group();
  box(g, 3.9, 0.7, 1.75, color, 0, 0.6, 0);
  box(g, 2.1, 0.42, 1.6, COLORS.glass, -0.2, 1.16, 0);   // windows
  box(g, 2.0, 0.12, 1.62, color, -0.2, 1.42, 0);         // roof
  for (const x of [1.25, -1.25]) for (const z of [-0.8, 0.8]) cyl(g, 0.32, 0.22, COLORS.tire, x, 0.32, z, 'z', 14);
  return g;
}

// ------------------------------------------------------------ glTF loading

async function loadInto(parent, url, replaceChildren) {
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    if (replaceChildren) parent.clear();
    gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    parent.add(gltf.scene);
  } catch (e) {
    console.warn('Could not load model', url, e);
  }
}
