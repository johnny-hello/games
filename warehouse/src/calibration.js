// Lining up the VSLAM map with the warehouse layout.
//
// VSLAM reports poses in its own map frame (where the map's origin happened to
// be, usually with y pointing "up"/north). The layout uses x east, y south.
// A calibration is: optionally flip the map's y axis, rotate, scale, shift.
//
//   cal = { flipY: true, rotationDeg: 0, scale: 1, tx: 0, ty: 40 }

const DEG = Math.PI / 180;

export function mapToLayout(cal, mx, my, yaw = 0) {
  const fy = cal.flipY ? -1 : 1;
  const r = (cal.rotationDeg || 0) * DEG, s = cal.scale ?? 1;
  const x = mx, y = fy * my;
  return {
    x: s * (Math.cos(r) * x - Math.sin(r) * y) + (cal.tx || 0),
    y: s * (Math.sin(r) * x + Math.cos(r) * y) + (cal.ty || 0),
    heading: fy * yaw + r,
  };
}

export function layoutToMap(cal, lx, ly, heading = 0) {
  const fy = cal.flipY ? -1 : 1;
  const r = (cal.rotationDeg || 0) * DEG, s = cal.scale ?? 1;
  const x = (lx - (cal.tx || 0)) / s, y = (ly - (cal.ty || 0)) / s;
  const ux = Math.cos(r) * x + Math.sin(r) * y, uy = -Math.sin(r) * x + Math.cos(r) * y;
  return { x: ux, y: fy * uy, yaw: fy * (heading - r) };
}

// Work out a calibration from two or more spots measured both ways:
// park a forklift on a known spot (a charger, a dock door, a floor mark),
// note its VSLAM x/y, and pair it with that spot's layout x/y.
//   pairs = [{ map: [mx, my], layout: [lx, ly] }, ...]
// Returns the calibration and the average leftover error in meters.
export function fitCalibration(pairs, flipY = true) {
  if (pairs.length < 2) throw new Error('Need at least two measured spots');
  const fy = flipY ? -1 : 1;
  const P = pairs.map(p => [p.map[0], fy * p.map[1]]), Q = pairs.map(p => p.layout);
  const n = P.length;
  const cp = [P.reduce((a, p) => a + p[0], 0) / n, P.reduce((a, p) => a + p[1], 0) / n];
  const cq = [Q.reduce((a, q) => a + q[0], 0) / n, Q.reduce((a, q) => a + q[1], 0) / n];
  let a = 0, b = 0, pp = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i][0] - cp[0], py = P[i][1] - cp[1], qx = Q[i][0] - cq[0], qy = Q[i][1] - cq[1];
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    pp += px * px + py * py;
  }
  const r = Math.atan2(b, a), s = Math.hypot(a, b) / pp;
  const tx = cq[0] - s * (Math.cos(r) * cp[0] - Math.sin(r) * cp[1]);
  const ty = cq[1] - s * (Math.sin(r) * cp[0] + Math.cos(r) * cp[1]);
  const cal = { flipY, rotationDeg: +(r / DEG).toFixed(4), scale: +s.toFixed(6), tx: +tx.toFixed(4), ty: +ty.toFixed(4) };
  let err = 0;
  for (const p of pairs) {
    const m = mapToLayout(cal, p.map[0], p.map[1]);
    err += Math.hypot(m.x - p.layout[0], m.y - p.layout[1]);
  }
  return { calibration: cal, error: err / n };
}
