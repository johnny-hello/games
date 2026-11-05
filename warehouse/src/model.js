// Turns layout.js into everything the simulation and the 3D scene need:
// pallet slots, rack boxes, solid obstacles and the route grid.
// Pure JavaScript (no Three.js), so it also runs in Node tests.

import { Grid, obb, DEG, clamp } from './geometry.js';

// Forklift footprint, measured from the forklift's reference point (meters).
// The box runs from `back` (counterweight) to `front` (fork tips / pallet).
export const FORKLIFT = {
  back: -1.5,
  bodyFront: 0.4,    // front of the mast; forks stick out past it
  front: 1.55,       // tip of forks or of a carried pallet
  halfWidth: 0.6,
  forkCenter: 0.95,  // where a carried pallet's center sits
  margin: 0.12,      // each forklift keeps this much extra space (gap >= 2x)
  carryHeight: 0.2,
  maxLift: 3.3,
};

export const PALLET = { length: 1.2, width: 1.0, base: 0.14 };

const ACCESS = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
};

export function buildModel(layout) {
  const W = layout.building.width, D = layout.building.depth;
  const model = {
    layout, W, D,
    slots: [], slotById: new Map(),
    racks: [], docks: [], chargers: [], obstacles: [],
    walls: [], staticBoxes: [], homes: new Map(),
    skus: layout.skus, skuById: new Map(layout.skus.map(s => [s.id, s])),
  };

  // Walls, as thin boxes just outside the floor.
  const t = 0.25;
  model.walls = [
    { side: 'north', box: obb(W / 2, -t / 2, W / 2 + t, t / 2) },
    { side: 'south', box: obb(W / 2, D + t / 2, W / 2 + t, t / 2) },
    { side: 'west', box: obb(-t / 2, D / 2, t / 2, D / 2 + t) },
    { side: 'east', box: obb(W + t / 2, D / 2, t / 2, D / 2 + t) },
  ];
  model.staticBoxes.push(...model.walls.map(w => w.box));

  // Rack rows and their slots.
  for (const row of layout.rackRows) {
    const r = { ...layout.rackDefaults, ...row };
    const len = r.bays * r.bayWidth;
    const alongX = r.dir !== 'y';
    const [w, h] = alongX ? [len, r.depth] : [r.depth, len];
    const box = obb(r.x + w / 2, r.y + h / 2, w / 2, h / 2);
    const access = ACCESS[r.access];
    const into = [-access[0], -access[1]]; // direction from aisle into the rack
    const rack = { ...r, len, box, into, x0: r.x, y0: r.y, w, h };
    model.racks.push(rack);
    model.staticBoxes.push(box);
    for (let b = 0; b < r.bays; b++) {
      for (let p = 0; p < r.perBay; p++) {
        const along = b * r.bayWidth + (p + 0.5) * r.bayWidth / r.perBay;
        const x = alongX ? r.x + along : r.x + r.depth / 2;
        const y = alongX ? r.y + r.depth / 2 : r.y + along;
        for (let l = 0; l < r.levels; l++) {
          addSlot(model, {
            id: `${r.id}-${String(b + 1).padStart(2, '0')}-${l + 1}${'abcdefgh'[p]}`,
            kind: 'rack', rack: r.id, bay: b, level: l, x, y, z: l * r.levelHeight, into,
          });
        }
      }
    }
  }

  // Dock doors and their staging lanes (floor slots just inside each door).
  const dk = layout.docks;
  for (const door of dk.doors) {
    const dock = { ...door, slots: [] };
    const n = dk.laneSlots, gap = PALLET.width + 0.2;
    const y = D - dk.laneOffset;
    dock.y = D;
    for (let k = 0; k < n; k++) {
      const x = door.x + (k - (n - 1) / 2) * gap;
      const s = addSlot(model, { id: `${door.id}-${k + 1}`, kind: 'stage', dock: door.id, dockKind: door.kind, level: 0, x, y, z: 0, into: [0, 1] });
      dock.slots.push(s);
    }
    dock.lane = obb(door.x, y, (n * gap) / 2, PALLET.length / 2 + 0.1);
    model.docks.push(dock);
  }

  // Chargers and the home pose of each forklift.
  for (const c of layout.chargers) {
    const hd = (c.heading || 0) * DEG;
    const box = obb(c.x, c.y, 0.35, 0.5, hd);
    model.chargers.push({ ...c, box });
    model.staticBoxes.push(box);
  }
  for (const f of layout.forklifts) {
    const c = model.chargers.find(c => c.id === f.charger) || model.chargers[0];
    const hd = (c.heading || 0) * DEG;
    const off = 0.35 + 0.15 - FORKLIFT.back + 0.05; // charger half + gap + rear overhang
    model.homes.set(f.id, { x: c.x + Math.cos(hd) * off, y: c.y + Math.sin(hd) * off, heading: hd });
  }

  for (const o of layout.obstacles || []) {
    const box = obb(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2);
    model.obstacles.push({ ...o, box });
    model.staticBoxes.push(box);
  }

  // Aisles between rack rows. Only one autopilot forklift works inside an
  // aisle at a time (others wait at the entrance), because two forklifts in a
  // narrow aisle cannot turn around or pass each other.
  model.aisles = [];
  const solid = model.staticBoxes;
  const inside = (x, y) => x < 0 || y < 0 || x > W || y > D || solid.some(b => pointIn(b, x, y));
  for (const r of model.racks) {
    const a = ACCESS[r.access], alongX = r.dir !== 'y';
    const faceC = alongX ? (a[1] > 0 ? r.y0 + r.h : r.y0) : (a[0] > 0 ? r.x0 + r.w : r.x0);
    let depth = 6;
    for (const k of [0.1, 0.5, 0.9]) {
      const u = alongX ? r.x0 + r.w * k : r.y0 + r.h * k;
      for (let d = 0.1; d < depth; d += 0.1) {
        const [x, y] = alongX ? [u, faceC + a[1] * d] : [faceC + a[0] * d, u];
        if (inside(x, y)) { depth = d; break; }
      }
    }
    if (depth >= 6) continue; // open floor, not an aisle
    const lo = Math.min(faceC, faceC + (alongX ? a[1] : a[0]) * depth), hi = Math.max(faceC, faceC + (alongX ? a[1] : a[0]) * depth);
    const box = alongX ? obb(r.x0 + r.w / 2, (lo + hi) / 2, r.w / 2, (hi - lo) / 2) : obb((lo + hi) / 2, r.y0 + r.h / 2, (hi - lo) / 2, r.h / 2);
    const same = model.aisles.find(z => Math.abs(z.box.cx - box.cx) < 0.3 && Math.abs(z.box.cy - box.cy) < 0.3);
    if (same) same.id += '/' + r.id;
    else model.aisles.push({ id: r.id, box, holder: null });
  }

  // Route grid: solid things plus staging lanes (forklifts only enter a lane
  // to pick or drop, never to drive through).
  const grid = new Grid(W, D, 0.5);
  grid.blockEdges();
  for (const b of model.staticBoxes) grid.blockBox(b);
  for (const d of model.docks) grid.blockBox(d.lane);
  grid.computeClearance();
  model.grid = grid;

  // Where a forklift waits in the aisle before entering a slot: walk out from
  // the slot's face into the aisle and stop where there is the most room.
  for (const s of model.slots) {
    const faceX = s.x - s.into[0] * PALLET.length / 2, faceY = s.y - s.into[1] * PALLET.length / 2;
    let best = 2.2, bestC = -1;
    for (let d = 1.8; d <= 2.6 + 1e-6; d += 0.1) {
      const [i, j] = grid.cellOf(faceX - s.into[0] * d, faceY - s.into[1] * d);
      const c = grid.clear[grid.idx(i, j)];
      if (c > bestC + 0.01) { bestC = c; best = d; }
    }
    s.pre = [faceX - s.into[0] * best, faceY - s.into[1] * best];
    const e = PALLET.length / 2 + FORKLIFT.bodyFront + 0.01;
    s.engage = [s.x - s.into[0] * e, s.y - s.into[1] * e];
  }
  return model;
}

function addSlot(model, s) {
  s.heading = Math.atan2(s.into[1], s.into[0]);
  s.pallet = null;  // pallet id in this slot
  s.claim = null;   // forklift that is going to fill or empty this slot
  model.slots.push(s);
  model.slotById.set(s.id, s);
  return s;
}

export function clampLift(z) { return clamp(z, 0, FORKLIFT.maxLift); }

function pointIn(b, x, y) {
  const dx = x - b.cx, dy = y - b.cy;
  return Math.abs(dx * b.ux + dy * b.uy) <= b.hx && Math.abs(dx * b.vx + dy * b.vy) <= b.hy;
}
