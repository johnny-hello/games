// Pure 2D geometry on the floor plan (x east, y south, meters). No Three.js here,
// so the simulation can be tested in Node.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Oriented box: center, half sizes along its own axes, angle of its x axis.
export function obb(cx, cy, hx, hy, ang = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { cx, cy, hx, hy, ux: c, uy: s, vx: -s, vy: c };
}

// Box from a forklift pose: the box spans [back, front] along the heading
// and +/- half width across it.
export function poseBox(x, y, heading, back, front, halfWidth, grow = 0) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const mid = (back + front) / 2;
  return obb(x + c * mid, y + s * mid, (front - back) / 2 + grow, halfWidth + grow, heading);
}

// Separating-axis test. Touching edges do not count as overlap.
export function overlaps(a, b, eps = 1e-3) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const axes = [[a.ux, a.uy], [a.vx, a.vy], [b.ux, b.uy], [b.vx, b.vy]];
  for (const [x, y] of axes) {
    const ra = a.hx * Math.abs(a.ux * x + a.uy * y) + a.hy * Math.abs(a.vx * x + a.vy * y);
    const rb = b.hx * Math.abs(b.ux * x + b.uy * y) + b.hy * Math.abs(b.vx * x + b.vy * y);
    if (Math.abs(dx * x + dy * y) >= ra + rb - eps) return false;
  }
  return true;
}

// Closest gap between two boxes (0 when they overlap), from their corners.
export function boxGap(a, b) {
  if (overlaps(a, b, 0)) return 0;
  const ca = corners(a), cb = corners(b);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      best = Math.min(best,
        segPointDist(ca[i], ca[(i + 1) % 4], cb[j]),
        segPointDist(cb[i], cb[(i + 1) % 4], ca[j]));
    }
  }
  return best;
}
export function corners(b) {
  const out = [];
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    out.push([b.cx + b.ux * b.hx * sx + b.vx * b.hy * sy, b.cy + b.uy * b.hx * sx + b.vy * b.hy * sy]);
  }
  return out;
}
function segPointDist(p, q, r) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const L = dx * dx + dy * dy || 1;
  const t = clamp(((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / L, 0, 1);
  return Math.hypot(p[0] + dx * t - r[0], p[1] + dy * t - r[1]);
}

// ---------------------------------------------------------------- grid + A*

// Occupancy grid over the floor with a "clearance" value per cell: the
// distance in meters to the nearest blocked cell. Routes prefer cells with
// plenty of clearance, so forklifts drive down the middle of aisles and have
// room to turn.
export class Grid {
  constructor(width, depth, cell = 0.5) {
    this.cell = cell;
    this.w = Math.ceil(width / cell);
    this.h = Math.ceil(depth / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    this.clear = new Float32Array(this.w * this.h);
  }
  idx(i, j) { return j * this.w + i; }
  cellOf(x, y) { return [clamp(Math.floor(x / this.cell), 0, this.w - 1), clamp(Math.floor(y / this.cell), 0, this.h - 1)]; }
  center(i, j) { return [(i + 0.5) * this.cell, (j + 0.5) * this.cell]; }

  // Block every cell whose center is inside the box grown by `grow`.
  blockBox(box, grow = 0) {
    const g = { ...box, hx: box.hx + grow, hy: box.hy + grow };
    const r = Math.hypot(g.hx, g.hy);
    const [i0, j0] = this.cellOf(g.cx - r, g.cy - r);
    const [i1, j1] = this.cellOf(g.cx + r, g.cy + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [x, y] = this.center(i, j);
        const dx = x - g.cx, dy = y - g.cy;
        if (Math.abs(dx * g.ux + dy * g.uy) <= g.hx && Math.abs(dx * g.vx + dy * g.vy) <= g.hy) {
          this.blocked[this.idx(i, j)] = 1;
        }
      }
    }
  }
  blockEdges() {
    for (let i = 0; i < this.w; i++) { this.blocked[this.idx(i, 0)] = 1; this.blocked[this.idx(i, this.h - 1)] = 1; }
    for (let j = 0; j < this.h; j++) { this.blocked[this.idx(0, j)] = 1; this.blocked[this.idx(this.w - 1, j)] = 1; }
  }

  // Two-pass chamfer distance transform -> clearance in meters.
  computeClearance() {
    const { w, h, cell } = this;
    const d = this.clear, INF = 1e9, D = 1, DD = Math.SQRT2;
    for (let k = 0; k < w * h; k++) d[k] = this.blocked[k] ? 0 : INF;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = this.idx(i, j); if (!d[k]) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + D);
      if (j > 0) v = Math.min(v, d[k - w] + D);
      if (i > 0 && j > 0) v = Math.min(v, d[k - w - 1] + DD);
      if (i < w - 1 && j > 0) v = Math.min(v, d[k - w + 1] + DD);
      d[k] = v;
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const k = this.idx(i, j); if (!d[k]) continue;
      let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + D);
      if (j < h - 1) v = Math.min(v, d[k + w] + D);
      if (i < w - 1 && j < h - 1) v = Math.min(v, d[k + w + 1] + DD);
      if (i > 0 && j < h - 1) v = Math.min(v, d[k + w - 1] + DD);
      d[k] = v;
    }
    for (let k = 0; k < w * h; k++) d[k] = d[k] * cell;
  }

  clone() {
    const g = Object.create(Grid.prototype);
    Object.assign(g, this, { blocked: this.blocked.slice(), clear: this.clear.slice() });
    return g;
  }
}

// A* over the grid. Cells closer than `minClear` to an obstacle are not
// allowed; cells closer than `goodClear` cost extra. `extraBlocked(i,j)` can
// block more cells (other forklifts). Returns a list of [x, y] points, already
// shortened to the corners that matter, or null when there is no route.
export function findPath(grid, sx, sy, gx, gy, opts = {}) {
  const minClear = opts.minClear ?? 0.8;
  const goodClear = opts.goodClear ?? 1.9;
  const extra = opts.extraBlocked;
  const { w, h } = grid;
  const ok = (i, j) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    if (extra && extra(i, j)) return false;
    return grid.clear[grid.idx(i, j)] >= minClear;
  };
  let [si, sj] = grid.cellOf(sx, sy);
  let [gi, gj] = grid.cellOf(gx, gy);
  // Start or goal may sit just inside the margin (e.g. at a rack face).
  // Step to the nearest usable cell.
  [si, sj] = nearestOk(grid, si, sj, ok) || [si, sj];
  [gi, gj] = nearestOk(grid, gi, gj, ok) || [gi, gj];
  if (!ok(si, sj) || !ok(gi, gj)) return null;

  const N = w * h;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const start = grid.idx(si, sj), goal = grid.idx(gi, gj);
  const hfn = (i, j) => Math.hypot(i - gi, j - gj);
  g[start] = 0;
  heap.push(start, hfn(si, sj));
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false;
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) { found = true; break; }
    const i = k % w, j = (k - i) / w;
    for (const [di, dj, c] of nb) {
      const ni = i + di, nj = j + dj;
      if (!ok(ni, nj)) continue;
      if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue; // no corner cutting
      const nk = grid.idx(ni, nj);
      if (closed[nk]) continue;
      const cl = grid.clear[nk];
      const cost = c * (1 + 3 * Math.max(0, goodClear - cl) / goodClear);
      const ng = g[k] + cost;
      if (ng < g[nk]) { g[nk] = ng; came[nk] = k; heap.push(nk, ng + hfn(ni, nj)); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map(k => grid.center(k % w, (k - (k % w)) / w));
  return simplify(grid, pts, ok, goodClear);
}

function nearestOk(grid, i, j, ok) {
  if (ok(i, j)) return [i, j];
  for (let r = 1; r <= 6; r++) {
    let best = null, bestC = -1;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (ok(i + di, j + dj)) {
        const c = grid.clear[grid.idx(i + di, j + dj)];
        if (c > bestC) { bestC = c; best = [i + di, j + dj]; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Drop points that can be skipped. A shortcut may not run closer to racks and
// walls than the original route did (ignoring the first and last couple of
// meters, which may start or end in a tight spot like a slot or a charger).
function simplify(grid, pts, ok, goodClear) {
  if (pts.length <= 2) return pts;
  const cl = pts.map(p => { const [i, j] = grid.cellOf(p[0], p[1]); return grid.clear[grid.idx(i, j)]; });
  const start = pts[0], end = pts[pts.length - 1];
  const nearEnds = (x, y) => Math.hypot(x - start[0], y - start[1]) < 2.2 || Math.hypot(x - end[0], y - end[1]) < 2.2;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    for (; b > a + 1; b--) {
      let need = goodClear;
      for (let k = a; k <= b; k++) if (!nearEnds(pts[k][0], pts[k][1])) need = Math.min(need, cl[k]);
      if (lineClear(grid, pts[a], pts[b], ok, need, nearEnds)) break;
    }
    out.push(pts[b]);
    a = b;
  }
  return out;
}
function lineClear(grid, p, q, ok, need, exempt) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(2, Math.ceil(L / (grid.cell * 0.5)));
  for (let s = 0; s <= n; s++) {
    const x = p[0] + (q[0] - p[0]) * s / n, y = p[1] + (q[1] - p[1]) * s / n;
    const [i, j] = grid.cellOf(x, y);
    if (!ok(i, j)) return false;
    if (!exempt(x, y) && grid.clear[grid.idx(i, j)] < need - 1e-6) return false;
  }
  return true;
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const { k, p } = this; let i = k.length; k.push(key); p.push(pri);
    while (i > 0) { const u = (i - 1) >> 1; if (p[u] <= p[i]) break; [k[u], k[i]] = [k[i], k[u]]; [p[u], p[i]] = [p[i], p[u]]; i = u; }
  }
  pop() {
    const { k, p } = this; const top = k[0]; const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]]; i = m;
      }
    }
    return top;
  }
}

// Small seeded random number generator so a layout always starts the same way.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
