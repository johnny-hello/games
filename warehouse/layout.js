// Warehouse layout, in meters. Edit this file to match the real factory.
//
// Coordinate system (like a floor plan drawing):
//   x = meters to the east (right), y = meters to the south (down).
//   (0, 0) is the north-west inside corner of the building.
//   Headings are in degrees: 0 = east, 90 = south, 180 = west, 270 = north.
//
// Everything in the 3D scene, the forklift routes and the collision checks is
// built from this file, so moving a rack row here moves it everywhere.

export default {
  name: 'Demo DC',
  building: { width: 60, depth: 40, wallHeight: 4.6 },

  // Rack rows. A row starts at (x, y) and runs east ('x') or south ('y').
  // access = the side forklifts work from: 'north' | 'south' | 'east' | 'west'.
  // Each bay holds `perBay` pallets per level. Level 1 is on the floor.
  rackDefaults: { bays: 14, bayWidth: 2.8, depth: 1.1, levels: 3, levelHeight: 1.5, perBay: 2 },
  rackRows: [
    { id: 'A', x: 10, y: 0.4, dir: 'x', access: 'south' },
    { id: 'B', x: 10, y: 5.5, dir: 'x', access: 'north' },
    { id: 'C', x: 10, y: 6.8, dir: 'x', access: 'south' },
    { id: 'D', x: 10, y: 11.9, dir: 'x', access: 'north' },
    { id: 'E', x: 10, y: 13.2, dir: 'x', access: 'south' },
    { id: 'F', x: 10, y: 18.3, dir: 'x', access: 'north' },
  ],

  // Dock doors on the south wall. Each dock has a staging lane of floor
  // slots just inside the door. kind: 'inbound' (trucks unload) or 'outbound'.
  docks: {
    wall: 'south', doorWidth: 3.2, laneSlots: 4, laneOffset: 4.5,
    doors: [
      { id: 'D1', x: 15, kind: 'inbound' },
      { id: 'D2', x: 21, kind: 'inbound' },
      { id: 'D3', x: 27, kind: 'inbound' },
      { id: 'D4', x: 33, kind: 'outbound' },
      { id: 'D5', x: 39, kind: 'outbound' },
      { id: 'D6', x: 45, kind: 'outbound' },
    ],
  },

  // Forklift chargers. Idle forklifts park here.
  chargers: [
    { id: 'C1', x: 0.6, y: 25, heading: 0 },
    { id: 'C2', x: 0.6, y: 28.5, heading: 0 },
    { id: 'C3', x: 0.6, y: 32, heading: 0 },
    { id: 'C4', x: 0.6, y: 35.5, heading: 0 },
  ],

  // Solid blocks the forklifts must drive around (offices, columns, ...).
  obstacles: [
    { id: 'Office', x: 52, y: 31, w: 7.8, h: 8.8, kind: 'office' },
  ],

  // Forklifts in simulation mode. In live mode, forklifts come from the VSLAM feed.
  forklifts: [
    { id: 'FL-01', charger: 'C1' },
    { id: 'FL-02', charger: 'C2' },
    { id: 'FL-03', charger: 'C3' },
    { id: 'FL-04', charger: 'C4' },
  ],

  // Products. color = the load's color in 3D, h = load height in meters.
  skus: [
    { id: 'BOX-S', name: 'Cartons, small', color: '#e8b874', h: 0.9 },
    { id: 'BOX-L', name: 'Cartons, large', color: '#d9a25e', h: 1.2 },
    { id: 'WRAP', name: 'Shrink-wrapped', color: '#e9eef6', h: 1.1 },
    { id: 'CRATE', name: 'Blue crates', color: '#4f7cf0', h: 0.8 },
    { id: 'DRUM', name: 'Drums', color: '#2fb59a', h: 1.0 },
  ],
  initialFill: 0.55, // share of rack slots that start with a pallet
  seed: 7,           // change for a different random start

  // Live mode: where VSLAM poses come from, and how the VSLAM map frame lines
  // up with this layout. See README.md, "Calibrating VSLAM".
  live: {
    url: '/vslam',     // Server-Sent Events or ws:// / wss:// WebSocket URL
    staleAfter: 3,     // seconds without a pose before a forklift turns grey
    // VSLAM map frame -> layout: flip the map's y axis (map y points north),
    // rotate, scale, then shift. This default matches a map whose origin is the
    // building's south-west corner, with x east and y north.
    calibration: { flipY: true, rotationDeg: 0, scale: 1, tx: 0, ty: 40 },
  },
};
