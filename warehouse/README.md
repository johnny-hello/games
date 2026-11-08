# Warehouse Twin

A 3D warehouse you can watch and play with in the browser: racks, pallets,
dock doors, trucks and forklifts in a clean isometric style. Today the
forklifts are simulated, and you can take over any one of them and drive it.
Later the same scene can show the **real** forklifts, using positions from
their VSLAM cameras.

## Run it

Open `index.html` (the games menu, or `warehouse/index.html`) straight from
disk and click **Warehouse Twin**. No server is needed: opened from disk, the
page runs `twin.bundle.js`, one file holding the whole app and Three.js, so it
also works without internet.

After changing `layout.js`, `assets.js` or anything in `src/`, rebuild that
file, or the page opened from disk keeps showing the old version:

```bash
cd warehouse && npm install && npm run build
```

(`npm test` fails if the bundle is out of date.)

For live mode, or to see edits without rebuilding, use the local server. From
the repository folder:

```bash
node warehouse/tools/dev-server.mjs
```

Then open http://localhost:8080. Served over http(s), including GitHub Pages,
the page loads the source files directly, so edits show up on reload.

The server also sends a **fake VSLAM feed**. Open
http://localhost:8080/?mode=live to see live mode working before real
forklifts are connected. Live mode needs the server (or a real feed URL);
it cannot connect from a page opened from disk.

## Controls

| | |
|---|---|
| Move around | drag |
| Zoom | scroll wheel, or pinch |
| Turn the view | `Q` / `E`, or drag with the right mouse button |
| Whole warehouse | `H` |
| Select | click a forklift or pallet, or search (top right, or press `/`) |
| Drive the selected forklift | `W` `A` `S` `D` or the arrow keys (the camera follows; `C` toggles that) |
| Forks up / down | `R` / `F` |
| Pick up / drop | `Space` when the forks line up with a pallet or an empty slot (a green or blue box shows which) |
| Next forklift | `Tab` |
| Hand back to the autopilot | `Esc`, or select something else |
| Show the forklift's camera views | `V` |

On a phone or tablet, selecting a forklift shows a joystick and
Up / Down / Pick buttons.

To pick from a higher rack level, raise the forks to about that level first
(levels are 1.5 m apart). After a pick or drop, the forks lower
automatically once you back out.

## Forklifts never overlap

Every forklift, whether on autopilot or driven by you, has a footprint that
includes its forks and any pallet it carries. It also keeps an extra 12 cm
of space on every side. A move is only made if the new position does not
touch another forklift's footprint, or put the forklift's body into a wall,
rack or pallet on the floor. That check runs on every step, so overlapping
is impossible, not just unlikely.

On top of that, the autopilot drives politely:

- **Look-ahead zones.** A forklift slows down when another one is within
  about 3 m ahead (amber zone on the floor) and stops when it is within 1 m
  (red zone).
- **Aisle locks.** Two forklifts in a narrow rack aisle can neither pass nor
  turn around, so only one autopilot forklift works in an aisle at a time.
  Others wait well back from the entrance.
- **Taking turns.** If two forklifts block each other, the one with lower
  priority moves to a nearby free spot and lets the other pass. Priority
  goes, highest first: you driving, a forklift working a slot, a forklift in
  an aisle, then one carrying a pallet.

The tests in `test/` run 20 simulated minutes and check that no two
forklifts ever come closer than 24 cm. In some heavy jams a forklift can
still wait close to a minute before the traffic clears.

## Change the layout

Everything is built from **`layout.js`**, in meters. Coordinates work like a
floor plan: x to the east, y to the south, with (0, 0) at the north-west
corner.

The layout is **HL Uriman's space at 33201 Dowe Ave, Union City**, traced
from the site plan in the building's CBRE sale flyer. The space is about
259 m × 51 m (168 ft deep, 611.5 ft of dock wall), with a curved west end
along the rail spur. The outline, the 19 dock doors, 4 grade-level doors,
9 rail doors and the two-story office come from that plan. **The rack rows,
chargers and exact column positions are guesses** until the floor is
measured or scanned.

- `building.outline` is the inside of the outer walls, corner by corner
  (a curve is a run of short straight pieces). For a plain rectangle use
  `building: { width, depth }` instead. `wallHeight` sets the wall height.
- `rackRows` are rack rows. Each has its start (x, y), whether it runs east
  (`dir: 'x'`) or south (`'y'`), and the side forklifts work from
  (`access`). Bays, bay width, depth, levels and level height default from
  `rackDefaults`. In this file the rows are generated from a few numbers
  (`pairCenters` and `blocks`) at the top.
- `docks` are the dock doors on the south wall, each with a staging lane
  (`inbound` or `outbound`).
- `doors` are other doors (grade-level and rail). They are drawn on the
  nearest wall and are not used by the simulation.
- `columns` is the building's column grid. Columns in or right next to a
  rack, office, charger or dock lane are left out.
- `chargers` are where idle forklifts park.
- `stacks` are floor-stacked pallets, from an iPhone scan (see below).
- `obstacles` are offices or anything else to drive around (`floors: 2`
  for a two-story office).
- `site` is what is drawn around the building: truck court, the other
  tenant's part of the building, the rail spur, Dowe Ave and parking.
- `forklifts`, `skus` and `initialFill` set up the simulation.

Aisles, routes, slot names (like `B2-07-2a` = row B, block 2, bay 7,
level 2, position a) and floor markings all follow from this file.

> The outline comes from a public sale flyer. Keep anything that is not
> public (the real rack layout, live forklift data, VSLAM feed addresses)
> out of a public repository: move this folder to a private repo first.

## Add the real floor from an iPhone scan

Record a walk through the floor with **Stray Scanner** (free, iPhone with
LiDAR), then turn it into floor stacks for `layout.js`:

1. Unzip the recording somewhere outside the repository.
2. Write an anchors file like `tools/scan/530e90bcfd.json`: where the start,
   the corner and the end of your walk are on the layout (meters), and the
   areas to leave alone (office, dock lanes, chargers).
3. Run (needs Python with numpy and Pillow):

```bash
python3 warehouse/tools/scan/scan_to_stacks.py path/to/recording warehouse/tools/scan/RECORDING.json .
```

It prints a `stacks` list to paste into `layout.js`, and writes `map.png` to
check the result. Then rebuild the bundle (`npm run build`).

It is rough on purpose: the phone only sees the side of a stack it walks
past, so each stack is drawn about one pallet deep. Starting and ending at a
spot that is easy to find on the plan (office corner, dock door, column)
makes the alignment better. Keep the recordings themselves out of the
repository.

## Change the 3D models

**`assets.js`** builds every model from simple boxes and cylinders. Each
part is one line with a size, color and position, so changing a model means
editing numbers:

- `COLORS` holds the whole color scheme (racks, forklifts, floor lines,
  trucks…).
- `CAMERAS` sets where the forklift's 4 safety cameras are mounted, which
  way they point, their field of view and their range. They are drawn as
  blue view cones on the selected forklift.
- `GLTF` swaps in a real model: put a `.glb` file (for example exported
  from Blender) in `warehouse/models/` and set
  `GLTF.forklift = 'models/forklift.glb'`. The forks stay animated.

## Live mode: real forklifts from VSLAM

In live mode the app takes forklift poses (and optionally pallet moves) as
JSON messages. It accepts Server-Sent Events (an `http(s)://` URL) or a
WebSocket (a `ws(s)://` URL). The URL comes from `layout.live.url`, or from
`?mode=live&live=wss://your-server/stream`.

A pose, in the VSLAM map frame:

```json
{ "type": "pose", "forklift": "FL-01", "x": 12.31, "y": 4.52, "yaw": 1.571,
  "fork": 0.2, "carrying": "PAL-1042", "tracking": "ok", "confidence": 0.93 }
```

- `x`, `y` are in meters and `yaw` in radians, counter-clockwise from the
  map's x axis, as VSLAM / ROS usually report them. Add `"frame": "layout"`
  to send layout coordinates (x, y, `heading`) directly.
- `tracking: "lost"` (with no x / y) keeps the last position and marks the
  forklift as lost. If no pose arrives for `live.staleAfter` seconds, the
  forklift turns grey.
- `fork` (fork height in m), `carrying` and `confidence` are optional.

A pallet move:

```json
{ "type": "pallet", "id": "PAL-1042", "sku": "BOX-L", "at": { "slot": "B-07-2a" } }
```

`at` can be `{ "slot": … }`, `{ "forklift": … }`, `{ "x": …, "y": … }` (a spot
on the floor) or `null` (the pallet has left). A
`{ "type": "snapshot", "pallets": [ { "id", "sku", "at" }, … ] }` message
replaces all pallets at once, for example when a client connects.
Messages can also be sent as an array.

In live mode the app shows where the real forklifts are. It does not drive
them. When two live forklifts come within about 1.8 m of each other, both
show an amber zone. Within 0.6 m it turns red, and their cards say how
close they are.

**Connecting Pluma AI's VSLAM:** write a small bridge that reads each
forklift's VSLAM pose (for example a ROS pose topic or the vendor SDK) and
sends the `pose` message above to the browser over a WebSocket.
`tools/dev-server.mjs` shows the server side: replace its fake feed with the
real poses.

### Calibrating VSLAM

VSLAM measures positions from wherever its map started, so they have to be
lined up with the layout. `layout.live.calibration` does that: optionally
flip the map's y axis, then rotate, scale and shift it.

To measure it:

1. Park a forklift on 3 or more spots you can find in the layout, such as
   a charger, the middle of a dock door or a floor mark. Spread them across
   the building.
2. For each spot, write down the VSLAM x, y and the layout x, y.
3. In the browser console on the twin page, run:

```js
twin.fitCalibration([
  { map: [1.2, 15.0], layout: [2.65, 25] },
  { map: [13.6, 4.5], layout: [15, 35.5] },
  { map: [43.5, 4.6], layout: [45, 35.5] },
])
```

It returns a `calibration` to paste into `layout.js`, and the average error
in meters.

## Files

```
warehouse/
  index.html            page, styles and panels
  twin.bundle.js        the whole app in one file, for opening from disk (built)
  layout.js             the warehouse layout (edit me)
  assets.js             3D models, colors, cameras (edit me)
  src/main.js           wires everything together
  src/scene.js          3D scene, camera, lights, drawing forklifts and pallets
  src/model.js          turns the layout into slots, aisles and a route grid
  src/sim.js            simulated forklifts: driving, autopilot, traffic rules
  src/geometry.js       collision boxes and route finding
  src/live.js           live mode: VSLAM poses and pallet moves
  src/calibration.js    VSLAM map <-> layout
  src/controls.js       mouse, touch, keyboard
  src/ui.js             selection card, search, hints
  tools/dev-server.mjs  local server + fake VSLAM feed
  tools/build.mjs       builds twin.bundle.js (npm run build)
  test/                 node --test warehouse/test/*.test.mjs
```

The 3D library is [Three.js](https://threejs.org) 0.170. The served version
loads it from a CDN; `twin.bundle.js` has its own copy, so the page opened from
disk works offline.
