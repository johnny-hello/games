// Warehouse Twin: wires the layout, simulation / live data, 3D scene and controls.

import layout from '../layout.js';
import { buildModel } from './model.js';
import { Sim } from './sim.js';
import { LiveSource } from './live.js';
import { WarehouseScene } from './scene.js';
import { setupControls } from './controls.js';
import { setupUI } from './ui.js';
import { fitCalibration, mapToLayout, layoutToMap } from './calibration.js';

const params = new URLSearchParams(location.search);
const model = buildModel(layout);
const sim = new Sim(model);
const live = new LiveSource(model, sim.pallets);

let scene;
try {
  scene = new WarehouseScene(document.getElementById('stage'), model);
} catch (e) {
  document.getElementById('loading').textContent = 'This browser could not start 3D graphics.';
  throw e;
}
document.getElementById('loading').remove();

const app = {
  model, sim, live, scene,
  mode: params.get('mode') === 'live' ? 'live' : 'sim',
  pallets: sim.pallets,
  selected: null,
  follow: false,

  fleet() { return this.mode === 'live' ? live.forklifts : sim.forklifts; },
  forklift(id) { return this.fleet().find(f => f.id === id); },
  driving() {
    const s = this.selected;
    if (this.mode !== 'sim' || !s || s.kind !== 'forklift') return null;
    const f = sim.forklift(s.id);
    return f && f.mode === 'manual' ? f : null;
  },

  select(sel, focus) {
    const prev = this.selected;
    // Leaving a forklift you were driving hands it back to the autopilot.
    if (prev && prev.kind === 'forklift' && (!sel || sel.id !== prev.id) && this.mode === 'sim') sim.releaseControl(prev.id);
    if (!sel || !prev || sel.id !== prev.id) this.follow = false;
    if (sel && sel.kind === 'pallet') sel.sku = this.pallets.get(sel.id)?.sku;
    this.selected = sel;
    scene.selected = sel;
    if (sel && focus) {
      const p = sel.kind === 'forklift' ? this.forklift(sel.id) : scene.palletPoses?.get(sel.id);
      if (p) scene.focus(p.x, p.y, 1.8);
    }
  },
  cycle(dir) {
    const list = this.fleet();
    if (!list.length) return;
    const i = this.selected && this.selected.kind === 'forklift' ? list.findIndex(f => f.id === this.selected.id) : -1;
    const next = list[(i + dir + list.length) % list.length];
    this.select({ kind: 'forklift', id: next.id }, true);
  },
  takeControl() {
    const s = this.selected;
    if (this.mode !== 'sim' || !s || s.kind !== 'forklift') return;
    const f = sim.forklift(s.id);
    if (f && f.mode !== 'manual') {
      sim.takeControl(s.id);
      // Follow the forklift you are driving (press C to stop following).
      this.follow = true;
      scene.view.zoomT = Math.max(scene.view.zoomT, 2);
    }
  },
  releaseControl() {
    const s = this.selected;
    if (s && s.kind === 'forklift') sim.releaseControl(s.id);
  },
  action() {
    const f = this.driving();
    if (f) sim.action(f.id);
  },
  toggleFollow() {
    if (!this.selected || this.selected.kind !== 'forklift') return;
    this.follow = !this.follow;
    if (this.follow) scene.view.zoomT = Math.max(scene.view.zoomT, 2);
  },
  toggleCameras() { scene.showCameras = !scene.showCameras; },
  setMode(mode) {
    if (mode === this.mode) return;
    params.set('mode', mode);
    location.search = params.toString();
  },
};

if (app.mode === 'live') {
  // Start empty: the live feed (or its snapshot) says where pallets are.
  for (const s of model.slots) s.pallet = null;
  sim.pallets.clear();
  const url = params.get('live') || layout.live?.url || '/vslam';
  live.connect(url);
}

const controls = setupControls(app);
const ui = setupUI(app);

let last = performance.now(), t = 0, uiT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; t += dt;

  const f = app.driving();
  if (f) sim.setInput(f.id, controls.input());
  if (app.mode === 'sim') sim.update(dt);
  else live.update(dt);

  const fleet = app.fleet();
  const byId = new Map(fleet.map(x => [x.id, x]));
  if (app.follow && app.selected?.kind === 'forklift') {
    const g = byId.get(app.selected.id);
    if (g) scene.view.targetT.set(g.x, 0, g.y);
  }
  scene.updateForklifts(fleet, t);
  scene.updatePallets(app.pallets, byId);
  scene.updateMarkers(t, model, f && !f.steps.length ? f.hint : null);
  scene.render(dt, t);

  uiT -= dt;
  if (uiT <= 0) { uiT = 0.1; ui.update(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy from the browser console, e.g. for calibrating VSLAM:
//   twin.fitCalibration([{ map: [x, y], layout: [x, y] }, ...])
window.twin = { app, model, sim, live, scene, fitCalibration, mapToLayout, layoutToMap };
