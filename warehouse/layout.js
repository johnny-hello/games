// Warehouse layout, in meters. Edit this file to match the real factory.
//
// This is HL Uriman's space at 33201 Dowe Ave, Union City (the north part of
// the 33201-33215 building), traced from the site plan in the CBRE flyer:
// 168 ft deep, 611.5 ft of dock wall on the truck court, a curved west end
// along the rail spur, and a two-story office at the east end. The outline,
// doors and office come from that plan. The rack rows, chargers and column
// positions are guesses until the floor is measured or scanned.
//
// Coordinate system (like a floor plan drawing):
//   x = meters to the east (right), y = meters to the south (down).
//   (0, 0) is the north-west corner of the outline's bounding box.
//   Headings are in degrees: 0 = east, 90 = south, 180 = west, 270 = north.
//
// Everything in the 3D scene, the forklift routes and the collision checks is
// built from this file, so moving a rack row here moves it everywhere.

const FT = 0.3048;

// Rack rows run east-west in back-to-back pairs, 4 m aisles between pairs.
// Pairs at 40, 80 and 120 ft from the north wall sit on the column lines.
const pairCenters = [40 * FT, 60 * FT, 80 * FT, 100 * FT, 120 * FT];
const blocks = [            // blocks of racks with cross aisles between them
  { n: 1, x: 52, bays: 20 },
  { n: 2, x: 114, bays: 20 },
  { n: 3, x: 176, bays: 18 },
];
const rackRows = [];
pairCenters.forEach((c, i) => {
  const north = 'ABCDEFGHIJ'[i * 2], south = 'ABCDEFGHIJ'[i * 2 + 1];
  for (const b of blocks) {
    rackRows.push({ id: north + b.n, x: b.x, y: c - 1.05, bays: b.bays, dir: 'x', access: 'north' });
    rackRows.push({ id: south + b.n, x: b.x, y: c + 0.05, bays: b.bays, dir: 'x', access: 'south' });
  }
});

export default {
  name: 'HL Uriman · Union City',

  // The inside of the outer walls, corner by corner (clockwise). The curve at
  // the west end follows the rail spur. Use { width, depth } instead for a
  // plain rectangle.
  building: {
    wallHeight: 8.5, // 28 ft clear inside
    outline: [
      [0.0, 51.2], [2.0, 46.9], [4.4, 42.2], [7.3, 37.3], [10.7, 32.3], [14.6, 27.2],
      [19.1, 22.4], [27.1, 14.8], [34.1, 9.0], [39.9, 4.8], [44.2, 2.0], [47.0, 0.5],
      [47.9, 0.0], [259.0, 0.0], [259.0, 16.9], [255.4, 16.9], [255.4, 47.1],
      [240.6, 47.1], [240.6, 51.2],
    ],
  },

  // Rack rows. A row starts at (x, y) and runs east ('x') or south ('y').
  // access = the side forklifts work from: 'north' | 'south' | 'east' | 'west'.
  // Each bay holds `perBay` pallets per level. Level 1 is on the floor.
  rackDefaults: { bays: 20, bayWidth: 2.8, depth: 1.0, levels: 4, levelHeight: 1.5, perBay: 2 },
  rackRows,

  // Dock doors on the south wall (the truck court). Each dock has a staging
  // lane of floor slots just inside the door. kind: 'inbound' or 'outbound'.
  // 19 dock-high doors in three groups, as on the site plan.
  docks: {
    wall: 'south', doorWidth: 2.75, laneSlots: 3, laneOffset: 4.5,
    doors: [
      ...[72.6, 76.7, 80.8, 85.0, 89.1, 93.2].map((x, i) => ({ id: `D${i + 1}`, x, kind: 'inbound' })),
      ...[129.5, 134.3, 139.1, 143.9, 148.7, 153.5].map((x, i) => ({ id: `D${i + 7}`, x, kind: i < 3 ? 'inbound' : 'outbound' })),
      ...[190.0, 194.7, 199.4, 204.1, 208.7, 213.4, 218.1].map((x, i) => ({ id: `D${i + 13}`, x, kind: 'outbound' })),
    ],
  },

  // Other doors, drawn on the nearest wall: grade-level (drive-in) doors on
  // the truck court and rail doors along the rail spur.
  doors: [
    ...[102.8, 122.3, 161.7, 181.2].map((x, i) => ({ id: `G${i + 1}`, kind: 'grade', x, y: 51.2 })),
    ...[[1.3, 48.4], [13.2, 34.2], [25.0, 21.9], [52.9, 0], [82.3, 0], [133.6, 0], [151.9, 0], [194.5, 0], [212.8, 0]]
      .map(([x, y], i) => ({ id: `R${i + 1}`, kind: 'rail', x, y })),
  ],

  // Building columns: 48 ft apart east-west, at 40, 80 and 120 ft from the
  // north wall. The exact offsets are a guess.
  columns: { x0: 3.0, dx: 48 * FT, ys: [40 * FT, 80 * FT, 120 * FT], size: 0.45 },

  // Forklift chargers (a guess: in the open corner by the office, south
  // side). Idle forklifts park here, facing north.
  chargers: [
    { id: 'C1', x: 226.0, y: 50.6, heading: 270 },
    { id: 'C2', x: 229.0, y: 50.6, heading: 270 },
    { id: 'C3', x: 232.0, y: 50.6, heading: 270 },
    { id: 'C4', x: 235.0, y: 50.6, heading: 270 },
  ],

  // Floor-stacked pallets (wheel and tire stacks) found by scanning the floor
  // with tools/scan/scan_to_stacks.py. Rough: the phone only sees the side of
  // a stack facing the walk. Recording 530e90bcfd: around the office corner.
  stacks: [
    { x: 225.9, y: 41.1, w: 2.8, h: 2.0 },
    { x: 230.6, y: 40.7, w: 1.0, h: 1.4 },
    { x: 235.7, y: 17.4, w: 1.4, h: 1.2 },
    { x: 236.5, y: 18.9, w: 1.4, h: 4.0 },
    { x: 237.7, y: 37.4, w: 1.4, h: 4.2 },
    { x: 238.5, y: 29.4, w: 1.4, h: 1.2 },
    { x: 241.5, y: 13.6, w: 1.4, h: 1.8 },
  ],
  stackHeight: 2.0,

  // Solid blocks the forklifts must drive around (offices, ...).
  obstacles: [
    { id: 'Office', x: 241.2, y: 16.5, w: 14.2, h: 30.6, kind: 'office', floors: 2 },
  ],

  // What is drawn around the building (looks only, from the site plan).
  site: {
    court: { x0: 54, x1: 262, depth: 56 },   // truck court south of the dock wall
    // The other tenant's part of the building: flat outlines, so they never
    // hide the warehouse.
    neighbors: [
      { x: -4, y: 51.2, w: 58, h: 56.3 },
      { x: -4, y: 107.5, w: 263, h: 49, label: '33215 DOWE AVE' },
    ],
    rail: [                                   // the spur along the north and west walls
      [262, -5], [47, -4.5], [41.6, -2.3], [37.1, 0.7], [31, 5.1], [23.8, 11.1], [15.6, 18.9],
      [10.8, 24], [6.6, 29.4], [3.1, 34.6], [0, 39.8], [-2.5, 44.7], [-4.5, 49.1], [-9, 62], [-14.6, 80],
    ],
    railMain: { x: -14.6, y0: -120, y1: 230 }, // the main line running north-south
    road: { x: 309, w: 18, label: 'DOWE AVE' }, // street to the east
    parking: { x: 266, y: -6, w: 28, h: 90 },     // along the office
  },

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
    calibration: { flipY: true, rotationDeg: 0, scale: 1, tx: 0, ty: 51.2 },
  },
};
