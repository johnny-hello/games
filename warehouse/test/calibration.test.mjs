import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapToLayout, layoutToMap, fitCalibration } from '../src/calibration.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('map -> layout -> map round trip', () => {
  const cal = { flipY: true, rotationDeg: 23, scale: 1.02, tx: 4, ty: 38 };
  for (const [x, y, yaw] of [[0, 0, 0], [12.5, -3, 1.2], [-7, 20, -2.5]]) {
    const l = mapToLayout(cal, x, y, yaw);
    const m = layoutToMap(cal, l.x, l.y, l.heading);
    close(m.x, x); close(m.y, y); close(Math.cos(m.yaw), Math.cos(yaw)); close(Math.sin(m.yaw), Math.sin(yaw));
  }
});

test('default calibration: map origin at the south-west corner, y north', () => {
  const cal = { flipY: true, rotationDeg: 0, scale: 1, tx: 0, ty: 40 };
  const p = mapToLayout(cal, 10, 5, Math.PI / 2); // 10 m east, 5 m north, facing north
  close(p.x, 10); close(p.y, 35); close(Math.sin(p.heading), -1); // layout: north is -y
});

test('fit a calibration from measured spots', () => {
  const truth = { flipY: true, rotationDeg: -31, scale: 0.98, tx: 12, ty: 41 };
  const spots = [[2.6, 25], [15, 35.5], [45, 35.5], [50, 3]];
  const pairs = spots.map(([lx, ly]) => { const m = layoutToMap(truth, lx, ly); return { map: [m.x + 0.01, m.y - 0.01], layout: [lx, ly] }; });
  const { calibration: c, error } = fitCalibration(pairs);
  close(c.rotationDeg, -31, 0.1); close(c.scale, 0.98, 0.002); close(c.tx, 12, 0.1); close(c.ty, 41, 0.1);
  assert.ok(error < 0.05);
});
