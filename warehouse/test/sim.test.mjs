// Run with: node --test warehouse/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import layout from '../layout.js';
import { buildModel, FORKLIFT } from '../src/model.js';
import { Sim } from '../src/sim.js';
import { overlaps } from '../src/geometry.js';

function run(seconds, setup) {
  const model = buildModel(layout);
  const sim = new Sim(model);
  if (setup) setup(sim);
  let minGap = Infinity, staticHits = 0;
  const stuck = new Map(sim.forklifts.map(f => [f.id, { t: 0, x: f.x, y: f.y }]));
  let worstStuck = 0;
  for (let t = 0; t < seconds; t += 1 / 30) {
    sim.step(1 / 30);
    minGap = Math.min(minGap, sim.minGap());
    for (const f of sim.forklifts) {
      for (const b of model.staticBoxes) if (overlaps(sim.bodyBox(f.x, f.y, f.heading), b)) staticHits++;
      const s = stuck.get(f.id);
      const moved = Math.hypot(f.x - s.x, f.y - s.y) > 0.3;
      if (moved || (!f.steps.length && f.mode === 'auto')) { s.t = 0; s.x = f.x; s.y = f.y; }
      else { s.t += 1 / 30; worstStuck = Math.max(worstStuck, s.t); }
    }
  }
  return { sim, minGap, staticHits, worstStuck };
}

test('layout builds slots, docks and a usable route grid', () => {
  const m = buildModel(layout);
  const perRow = layout.rackRows.map(r => { const k = { ...layout.rackDefaults, ...r }; return k.bays * k.perBay * k.levels; });
  assert.equal(m.slots.filter(s => s.kind === 'rack').length, perRow.reduce((a, b) => a + b, 0));
  assert.equal(m.docks.length, layout.docks.doors.length);
  assert.ok(m.aisles.length > 0, 'found the aisles between rack rows');
  for (const h of m.homes.values()) assert.ok(m.grid.clear[m.grid.idx(...m.grid.cellOf(h.x, h.y))] > 0, 'home pose is on the floor');
  for (const s of m.slots) {
    const [i, j] = m.grid.cellOf(s.pre[0], s.pre[1]);
    assert.ok(m.grid.clear[m.grid.idx(i, j)] >= 1.7, `room to turn in front of ${s.id}`);
  }
});

test('autopilot forklifts never overlap and keep working (20 simulated minutes)', () => {
  const { sim, minGap, staticHits, worstStuck } = run(20 * 60);
  const s = sim.stats;
  console.log('stats', s, 'min gap', minGap.toFixed(3), 'longest stall', worstStuck.toFixed(1) + 's');
  assert.ok(minGap >= 2 * FORKLIFT.margin - 0.01, `forklifts came within ${minGap} m`);
  assert.equal(staticHits, 0, 'a forklift body went into a wall or rack');
  assert.ok(s.putaways > 15, `only ${s.putaways} putaways`);
  assert.ok(s.picks > 15, `only ${s.picks} picks`);
  // Waiting in line for a busy aisle is normal; being stuck for minutes is not.
  assert.ok(worstStuck < 90, `a forklift was stuck for ${worstStuck}s`);
});

test('a manually driven forklift blocks traffic but nobody overlaps it', () => {
  const { sim, minGap } = run(6 * 60, sim => {
    // Park FL-01 in the middle of the main aisle between the racks and the
    // dock lanes, in front of the busiest docks.
    const f = sim.forklift('FL-01');
    sim.takeControl('FL-01');
    const lane = sim.m.docks[2].lane, racksSouth = Math.max(...sim.m.racks.map(r => r.y0 + r.h));
    f.x = lane.cx; f.y = (racksSouth + lane.cy - lane.hy) / 2; f.heading = 0;
  });
  assert.ok(minGap >= 2 * FORKLIFT.margin - 0.01, `forklifts came within ${minGap} m`);
  assert.ok(sim.stats.putaways + sim.stats.picks > 6);
});

test('manual pick and drop', () => {
  const m = buildModel(layout);
  const sim = new Sim(m);
  const f = sim.forklift('FL-04');
  sim.takeControl(f.id);
  const slot = m.slots.find(s => s.kind === 'rack' && s.pallet && s.level === 1 && s.rack === m.racks[m.racks.length - 1].id);
  // Put the forklift a little off the engage pose, facing the rack.
  f.x = slot.engage[0] - 0.2 * Math.cos(slot.heading); f.y = slot.engage[1] - 0.2 * Math.sin(slot.heading);
  f.heading = slot.heading + 0.1;
  f.fork = slot.z;
  assert.equal(sim.slotInFront(f)?.id, slot.id);
  const pid = slot.pallet;
  sim.action(f.id);
  for (let i = 0; i < 200; i++) sim.step(1 / 30);
  assert.equal(f.carrying, pid);
  assert.equal(slot.pallet, null);
  sim.action(f.id);
  for (let i = 0; i < 200; i++) sim.step(1 / 30);
  assert.equal(f.carrying, null);
  assert.equal(slot.pallet, pid);
});
