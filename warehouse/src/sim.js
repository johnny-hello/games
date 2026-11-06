// Warehouse simulation: forklifts (autopilot or driven by you) and pallets.
//
// Safety rule: a forklift only moves if its new position keeps a gap to every
// other forklift (FORKLIFT.margin on each side) and its body stays clear of
// walls, racks and pallets on the floor. That check runs on every step for
// every forklift, so forklifts can never overlap, whoever is driving.
// On top of that, autopilot forklifts look ahead: they slow down when another
// forklift is near, stop when it is close, and take turns or reroute when two
// of them are waiting on each other.

import { FORKLIFT as FL, PALLET } from './model.js';
import { poseBox, obb, overlaps, boxGap, findPath, wrapAngle, clamp, dist, rng } from './geometry.js';

const V_MAX = 2.0, V_MANUAL = 2.8, V_REVERSE = 1.4, ACC = 1.6, DEC = 3.5;
const TURN = 1.1, FORK_SPEED = 0.6;
const STOP_LOOK = 1.0, SLOW_LOOK = 3.2;

export class Sim {
  constructor(model) {
    this.m = model;
    this.t = 0;
    this.rand = rng(model.layout.seed || 1);
    this.forklifts = [];
    this.pallets = new Map();
    this.listeners = [];
    this.palSeq = 1000;
    this.nextInbound = 3;
    this.stats = { putaways: 0, picks: 0, received: 0, shipped: 0 };

    const L = model.layout;
    for (const s of model.slots) {
      if (s.kind === 'rack' && this.rand() < (L.initialFill ?? 0.5)) this.newPallet(s, null);
    }
    for (const f of L.forklifts) {
      const h = model.homes.get(f.id);
      this.forklifts.push({
        id: f.id, x: h.x, y: h.y, heading: h.heading, speed: 0, omega: 0,
        fork: FL.carryHeight, carrying: null, mode: 'auto', status: 'Idle',
        steps: [], task: null, blockedBy: null, blockedFor: 0, zone: 'clear',
        input: { throttle: 0, steer: 0, fork: 0 }, hint: null, service: null,
        stepT: 0, taskT: 0, idleT: -2.5 * this.forklifts.length, moving: false, autoLower: null, msg: '',
      });
    }
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  forklift(id) { return this.forklifts.find(f => f.id === id); }

  // --------------------------------------------------------------- pallets

  newPallet(slot, msg) {
    const sku = this.m.skus[Math.floor(this.rand() * this.m.skus.length)];
    const id = 'PAL-' + (++this.palSeq);
    const p = { id, sku: sku.id, slot: slot.id, forklift: null, since: this.t, history: [] };
    slot.pallet = id;
    this.pallets.set(id, p);
    this.log(p, msg || `Stored in ${slot.id}`);
    return p;
  }
  log(p, msg) {
    p.history.push({ t: this.t, msg });
    if (p.history.length > 12) p.history.shift();
    this.emit({ type: 'pallet', id: p.id, msg });
  }

  // ------------------------------------------------------------ main update

  update(dt) {
    // Fixed small steps keep motion and collision checks stable.
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 30);
      this.step(h);
      left -= h;
    }
  }

  step(dt) {
    this.t += dt;
    for (const f of this.forklifts) {
      f.blockedNow = null;
      f.zone = 'clear';
      if (f.mode === 'manual') this.updateManual(f, dt);
      else this.updateAuto(f, dt);
      if (f.blockedNow) {
        f.blockedFor = f.blockedBy === f.blockedNow ? f.blockedFor + dt : dt;
        f.blockedBy = f.blockedNow;
      } else { f.blockedFor = 0; f.blockedBy = null; }
    }
    this.updateAisles();
    for (const f of this.forklifts) if (f.mode === 'auto') this.resolveTraffic(f);
    this.updateDocks(dt);
  }

  // --------------------------------------------------------------- collisions

  fullBox(x, y, h, grow = FL.margin) { return poseBox(x, y, h, FL.back, FL.front, FL.halfWidth, grow); }
  bodyBox(x, y, h) { return poseBox(x, y, h, FL.back, FL.bodyFront, FL.halfWidth, 0); }

  // What would the forklift hit at this pose? null = free.
  hits(f, x, y, h) {
    const mine = this.fullBox(x, y, h);
    for (const o of this.forklifts) {
      if (o === f) continue;
      if (overlaps(mine, this.fullBox(o.x, o.y, o.heading))) return o.id;
    }
    const body = this.bodyBox(x, y, h);
    for (const b of this.m.staticBoxes) if (overlaps(body, b)) return 'static';
    for (const d of this.m.docks) {
      for (const s of d.slots) {
        if (s.pallet && overlaps(body, obb(s.x, s.y, PALLET.width / 2, PALLET.length / 2))) return 'static';
      }
    }
    return null;
  }

  // Try to move to a pose; returns true if the forklift moved.
  tryPose(f, x, y, h) {
    const hit = this.hits(f, x, y, h);
    if (hit) { f.blockedNow = hit; return false; }
    f.x = x; f.y = y; f.heading = wrapAngle(h);
    return true;
  }

  // Another forklift inside the look-ahead area in the driving direction?
  lookAhead(f, dir, left = Infinity) {
    let stop = null, slow = false;
    const reach = dir > 0 ? FL.front : -FL.back;
    const zs = this.zone(f, dir, reach, Math.min(STOP_LOOK, left + 0.25));
    const zl = this.zone(f, dir, reach, Math.min(SLOW_LOOK, left + 0.5));
    for (const o of this.forklifts) {
      if (o === f) continue;
      const ob = this.fullBox(o.x, o.y, o.heading, 0);
      if (overlaps(zs, ob)) { stop = o.id; break; }
      if (overlaps(zl, ob)) slow = true;
    }
    return { stop, slow };
  }
  zone(f, dir, reach, len) {
    const h = dir > 0 ? f.heading : f.heading + Math.PI;
    return poseBox(f.x, f.y, h, reach - 0.2, reach + len, FL.halfWidth + 0.15);
  }

  // Drive with a target speed (m/s, negative = reverse) and turn rate (rad/s).
  drive(f, dt, vTarget, omega, look = true, left = Infinity) {
    if (look && Math.abs(vTarget) > 0.01) {
      const la = this.lookAhead(f, Math.sign(vTarget), left);
      if (la.stop) { vTarget = 0; f.blockedNow = la.stop; f.zone = 'stop'; }
      else if (la.slow) { vTarget *= 0.4; f.zone = 'slow'; }
    }
    const speedingUp = Math.abs(f.speed) < 0.01 || (Math.sign(vTarget) === Math.sign(f.speed) && Math.abs(vTarget) > Math.abs(f.speed));
    const a = speedingUp ? ACC : DEC;
    f.speed += clamp(vTarget - f.speed, -a * dt, a * dt);
    const nh = f.heading + omega * dt;
    const nx = f.x + Math.cos(nh) * f.speed * dt, ny = f.y + Math.sin(nh) * f.speed * dt;
    if (Math.abs(f.speed) < 1e-4 && Math.abs(omega) < 1e-4) { f.moving = false; return true; }
    if (this.tryPose(f, nx, ny, nh)) { f.moving = true; return true; }
    // Blocked: try going straight without turning, or turning without moving.
    const keep = f.blockedNow;
    if (Math.abs(omega) > 1e-4) {
      const c = Math.cos(f.heading), s = Math.sin(f.heading);
      if (Math.abs(f.speed) > 0.01 && this.tryPose(f, f.x + c * f.speed * dt, f.y + s * f.speed * dt, f.heading)) { f.blockedNow = keep; return false; }
      if (this.tryPose(f, f.x, f.y, nh)) { f.speed *= 0.5; f.blockedNow = keep; return false; }
    }
    if (f.mode === 'manual' && keep === 'static') {
      const sx = f.x + Math.cos(nh) * f.speed * dt, sy = f.y + Math.sin(nh) * f.speed * dt;
      if (this.tryPose(f, sx, f.y, f.heading) || this.tryPose(f, f.x, sy, f.heading)) { f.speed *= 0.6; f.blockedNow = keep; return false; }
    }
    f.blockedNow = keep;
    f.speed = 0; f.moving = false;
    return false;
  }

  // Turn on the spot toward a heading. Returns true when facing it.
  rotateTo(f, dt, target) {
    const e = wrapAngle(target - f.heading);
    if (Math.abs(e) < 0.004) {
      if (this.tryPose(f, f.x, f.y, target)) return true;
      return false;
    }
    if (Math.abs(f.speed) > 0.05) { this.drive(f, dt, 0, 0, false); return false; }
    f.speed = 0;
    const w = Math.sign(e) * Math.min(TURN, Math.abs(e) * 3 + 0.15);
    const step = Math.abs(w * dt) > Math.abs(e) ? e : w * dt;
    if (this.tryPose(f, f.x, f.y, f.heading + step)) { f.moving = true; return Math.abs(e - step) < 0.004; }
    // A wall is in the way of turning: nudge forward or back and try again.
    if (f.blockedNow === 'static') {
      const c = Math.cos(f.heading), s = Math.sin(f.heading);
      if (!this.tryPose(f, f.x + c * 0.03, f.y + s * 0.03, f.heading)) this.tryPose(f, f.x - c * 0.03, f.y - s * 0.03, f.heading);
      f.blockedNow = 'static';
    }
    return false;
  }

  moveFork(f, dt, target) {
    const d = target - f.fork;
    f.fork += clamp(d, -FORK_SPEED * dt, FORK_SPEED * dt);
    return Math.abs(target - f.fork) < 1e-3;
  }

  // ------------------------------------------------------------- autopilot

  priority(f) {
    if (f.mode === 'manual') return 100;
    if (f.service) return 50;
    if (this.m.aisles.some(z => z.holder === f.id)) return 40;
    if (f.carrying) return 20;
    return 10;
  }

  updateAuto(f, dt) {
    f.taskT += dt;
    if (!f.steps.length) {
      f.idleT += dt;
      if (f.idleT > 0.6) { f.idleT = 0; this.assignTask(f); }
      if (!f.steps.length) { this.drive(f, dt, 0, 0, false); f.status = f.atHome ? 'Parked at charger' : 'Idle'; return; }
    }
    // Watchdog: a task that has been stuck for a long time is dropped.
    if (f.task && f.taskT > (f.taskLimit || 120)) this.abortTask(f, 'Task took too long');
    const st = f.steps[0];
    if (!st) return;
    f.stepT += dt;
    if (this.runStep(f, st, dt)) { f.steps.shift(); f.stepT = 0; }
  }

  runStep(f, st, dt) {
    switch (st.op) {
      case 'goto': return this.stepGoto(f, st, dt);
      case 'face': f.status = st.label || f.status; return this.rotateTo(f, dt, st.heading);
      case 'straight': return this.stepStraight(f, st, dt);
      case 'back': return this.stepBack(f, st, dt);
      case 'fork': if (Math.abs(f.speed) > 0.02) { this.drive(f, dt, 0, 0, false); return false; } return this.moveFork(f, dt, st.h);
      case 'attach': return this.attach(f, this.m.slotById.get(st.slot));
      case 'release': return this.release(f, this.m.slotById.get(st.slot));
      case 'service': f.service = st.slot ? this.m.slotById.get(st.slot) : null; return true;
      case 'await': return this.stepAwait(f, st, dt);
      case 'wait': this.drive(f, dt, 0, 0, false); return f.stepT >= st.t;
      case 'status': f.status = st.text; return true;
      case 'done': this.finishTask(f); return true;
      case 'align': return this.stepAlign(f, st, dt);
      case 'escape': return this.stepEscape(f, st, dt);
      case 'home': f.atHome = true; return true;
      case 'yield': {
        this.drive(f, dt, 0, 0, false);
        const o = this.forklift(st.other);
        f.status = st.label;
        const route = o ? this.routeOf(o) : [];
        const clear = !o || route.every((a, k) => segDist(a, route[Math.min(k + 1, route.length - 1)], f.x, f.y) > 2.6);
        const notWaitingOnMe = o && !o.moving && o.blockedBy !== f.id;
        return (f.stepT > 1.5 && (clear || notWaitingOnMe)) || f.stepT > 10;
      }
      default: return true;
    }
  }

  stepGoto(f, st, dt) {
    f.atHome = false;
    if (st.label) f.status = st.label;
    if (st.slot) {
      const sl = this.m.slotById.get(st.slot);
      const busy = this.forklifts.find(o => o !== f && o.service && o.service !== sl
        && dist(o.service.pre[0], o.service.pre[1], sl.pre[0], sl.pre[1]) < 3.6);
      if (busy && dist(f.x, f.y, sl.pre[0], sl.pre[1]) < 7) {
        this.drive(f, dt, 0, 0, false);
        f.blockedNow = busy.id; f.status = `Waiting for ${busy.id} to finish`;
        return false;
      }
    }
    if (!st.path) {
      if (st.retryAt && this.t < st.retryAt) { this.drive(f, dt, 0, 0, false); return false; }
      const avoid = st.avoid && this.t < st.avoidUntil ? this.avoidCells(f, st.avoid) : null;
      st.path = findPath(this.m.grid, f.x, f.y, st.x, st.y, { extraBlocked: avoid, minClear: 0.85 });
      st.i = 0;
      if (!st.path) {
        if (avoid) { st.avoid = null; f.steps.unshift({ op: 'back', d: 1.5 }); st.retryAt = this.t + 1; return false; }
        st.retryAt = this.t + 2; st.fails = (st.fails || 0) + 1;
        if (st.fails > 5) { this.abortTask(f, 'No route'); }
        return false;
      }
      st.path.push([st.x, st.y]);
    }
    const p = st.path;
    const holder = this.aisleAhead(f, p, st.i);
    if (holder) {
      this.drive(f, dt, 0, 0, false);
      f.blockedNow = 'aisle'; f.status = `Waiting for aisle (${holder.id} is in it)`;
      return false;
    }
    while (st.i < p.length) {
      const [tx, ty] = p[st.i];
      const last = st.i === p.length - 1;
      const d = dist(f.x, f.y, tx, ty);
      if (d < (last ? 0.18 : 0.35)) { st.i++; continue; }
      const want = Math.atan2(ty - f.y, tx - f.x);
      // Short hops (and making room) may be driven in reverse instead of turning around.
      let left = d;
      for (let k = st.i + 1; k < p.length; k++) left += dist(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]);
      const eF = wrapAngle(want - f.heading), eR = wrapAngle(want - f.heading - Math.PI);
      const rev = (st.refugeFor || left < 6) && Math.abs(eR) + 0.3 < Math.abs(eF);
      const e = rev ? eR : eF;
      if (Math.abs(e) > 0.4) { this.rotateTo(f, dt, rev ? want + Math.PI : want); return false; }
      // Slow down before the end and before sharp corners.
      let v = rev ? 0.9 : V_MAX;
      if (last) v = Math.min(v, 0.2 + d * 1.1);
      else if (st.i + 1 < p.length) {
        const [nx, ny] = p[st.i + 1];
        const turn = Math.abs(wrapAngle(Math.atan2(ny - ty, nx - tx) - want));
        if (turn > 0.5) v = Math.min(v, 0.4 + d * 1.0);
      }
      this.drive(f, dt, rev ? -v : v, clamp(e * 2.5, -TURN, TURN), true, left);
      return false;
    }
    this.drive(f, dt, 0, 0, false);
    return Math.abs(f.speed) < 0.05;
  }

  // Aisle locks: free an aisle once its holder has left it. A forklift that is
  // inside an unheld aisle (e.g. one you are driving) takes it.
  updateAisles() {
    for (const z of this.m.aisles) {
      const h = z.holder && this.forklift(z.holder);
      if (h && !overlaps(z.box, this.fullBox(h.x, h.y, h.heading, 0))) z.holder = null;
      if (!z.holder) {
        const f = this.forklifts.find(f => overlaps(z.box, this.fullBox(f.x, f.y, f.heading, -0.3)));
        if (f) z.holder = f.id;
      }
    }
  }

  // Before driving into an aisle, check that nobody else is working in it.
  // Returns the forklift holding the aisle ahead, or null if we may go on.
  aisleAhead(f, p, i) {
    const me = this.fullBox(f.x, f.y, f.heading, 0);
    // Look 4.5 m ahead so that a forklift waiting its turn stops well back from
    // the aisle mouth and leaves room for the one coming out.
    let px = f.x, py = f.y, left = 4.5;
    for (let k = i; k < p.length && left > 0; k++) {
      const [qx, qy] = p[k];
      const L = dist(px, py, qx, qy), n = Math.max(1, Math.ceil(L / 0.25));
      for (let s = 1; s <= n && left > 0; s++) {
        const x = px + (qx - px) * s / n, y = py + (qy - py) * s / n;
        left -= L / n;
        for (const z of this.m.aisles) {
          if (z.holder === f.id) continue;
          const zb = { ...z.box, hx: z.box.hx + 0.5, hy: z.box.hy + 0.5 };
          if (!overlaps(zb, obb(x, y, 0.05, 0.05))) continue;
          if (overlaps(z.box, me)) continue; // already in it
          if (z.holder) return this.forklift(z.holder);
          z.holder = f.id;
        }
      }
      px = qx; py = qy;
    }
    return null;
  }

  // Cells around forklifts we are trying to get past, for rerouting.
  avoidCells(f, ids) {
    const boxes = this.forklifts.filter(o => o !== f && (ids.includes(o.id) || !o.moving))
      .map(o => this.fullBox(o.x, o.y, o.heading, FL.halfWidth + 0.35));
    const g = this.m.grid;
    return (i, j) => {
      const [x, y] = g.center(i, j);
      for (const b of boxes) {
        const dx = x - b.cx, dy = y - b.cy;
        if (Math.abs(dx * b.ux + dy * b.uy) <= b.hx && Math.abs(dx * b.vx + dy * b.vy) <= b.hy) return true;
      }
      return false;
    };
  }

  // Drive straight (keeping the current heading) to a point, fixing any small
  // sideways error on the way.
  stepStraight(f, st, dt) {
    const dx = st.x - f.x, dy = st.y - f.y, d = Math.hypot(dx, dy);
    const dir = st.rev ? -1 : 1;
    if (d < 0.004) { f.speed = 0; f.moving = false; return true; }
    const la = this.lookAhead(f, dir, d);
    if (la.stop) { f.blockedNow = la.stop; f.zone = 'stop'; f.speed = 0; f.moving = false; return false; }
    const v = Math.min(st.rev ? 0.9 : 0.8, 0.1 + d * 1.5, Math.abs(f.speed) + ACC * dt);
    const stepLen = Math.min(d, v * dt);
    if (this.tryPose(f, f.x + dx / d * stepLen, f.y + dy / d * stepLen, f.heading)) { f.speed = dir * v; f.moving = true; }
    else { f.speed = 0; f.moving = false; }
    return false;
  }

  // Back up a little (to make room for someone else).
  stepBack(f, st, dt) {
    st.done = st.done || 0;
    const before = [f.x, f.y];
    const ok = this.drive(f, dt, -0.7, 0, true);
    st.done += dist(before[0], before[1], f.x, f.y);
    const [i, j] = this.m.grid.cellOf(f.x, f.y);
    const tight = this.m.grid.clear[this.m.grid.idx(i, j)] < 0.9;
    if (st.done >= st.d || tight || (!ok && f.stepT > 0.8) || f.stepT > 4) { f.speed = 0; return true; }
    return false;
  }

  // Before working a slot, wait until no other forklift is working right next
  // to it, so two forklifts never back out into each other.
  stepAwait(f, st, dt) {
    this.drive(f, dt, 0, 0, false);
    const slot = this.m.slotById.get(st.slot);
    const area = poseBox(slot.pre[0], slot.pre[1], slot.heading, -2.0, 2.0 + 0.6, 1.9);
    for (const o of this.forklifts) {
      if (o === f) continue;
      const near = (o.service && dist(o.service.pre[0], o.service.pre[1], slot.pre[0], slot.pre[1]) < 3.6)
        || overlaps(area, this.fullBox(o.x, o.y, o.heading, 0));
      if (near && f.stepT < 10) { f.blockedNow = o.id; f.status = `Waiting for ${o.id}`; return false; }
    }
    return true;
  }

  // Manual pick/drop: glide the last few centimeters into line with the slot.
  stepAlign(f, st, dt) {
    const k = Math.min(1, dt * 6);
    const tx = f.x + (st.x - f.x) * k, ty = f.y + (st.y - f.y) * k;
    const th = f.heading + wrapAngle(st.heading - f.heading) * k;
    if (!this.tryPose(f, tx, ty, th)) { f.steps = []; f.msg = 'Something is in the way'; return false; }
    if (dist(f.x, f.y, st.x, st.y) < 0.01 && Math.abs(wrapAngle(st.heading - f.heading)) < 0.003) {
      this.tryPose(f, st.x, st.y, st.heading); return true;
    }
    return false;
  }

  attach(f, slot) {
    const p = this.pallets.get(slot.pallet);
    if (!p) { f.msg = 'Slot is empty'; return true; }
    slot.pallet = null; slot.claim = null;
    p.slot = null; p.forklift = f.id; f.carrying = p.id;
    this.log(p, `Picked from ${slot.id} by ${f.id}`);
    return true;
  }
  release(f, slot) {
    const p = this.pallets.get(f.carrying);
    if (!p) return true;
    slot.pallet = p.id; slot.claim = null;
    p.slot = slot.id; p.forklift = null; p.since = this.t; f.carrying = null;
    this.log(p, slot.kind === 'stage' ? `Staged at ${slot.id} by ${f.id}` : `Put away to ${slot.id} by ${f.id}`);
    if (slot.dockKind === 'outbound') this.stats.picks++;
    if (slot.kind === 'rack') this.stats.putaways++;
    return true;
  }

  pickSteps(s, f) {
    return [
      { op: 'goto', x: s.pre[0], y: s.pre[1], slot: s.id, label: `Driving to ${s.id}` },
      { op: 'await', slot: s.id },
      { op: 'service', slot: s.id },
      { op: 'face', heading: s.heading, label: `Picking ${this.m.slotById.get(s.id).pallet || ''} at ${s.id}` },
      { op: 'fork', h: s.z + 0.04 },
      { op: 'straight', x: s.engage[0], y: s.engage[1] },
      { op: 'attach', slot: s.id },
      { op: 'fork', h: s.z + 0.12 },
      { op: 'straight', x: s.pre[0], y: s.pre[1], rev: true },
      { op: 'service', slot: null },
      { op: 'fork', h: FL.carryHeight },
    ];
  }
  dropSteps(s) {
    return [
      { op: 'goto', x: s.pre[0], y: s.pre[1], slot: s.id, label: `Taking pallet to ${s.id}` },
      { op: 'await', slot: s.id },
      { op: 'service', slot: s.id },
      { op: 'face', heading: s.heading, label: `Dropping at ${s.id}` },
      { op: 'fork', h: s.z + 0.12 },
      { op: 'straight', x: s.engage[0], y: s.engage[1] },
      { op: 'fork', h: s.z + 0.04 },
      { op: 'release', slot: s.id },
      { op: 'straight', x: s.pre[0], y: s.pre[1], rev: true },
      { op: 'service', slot: null },
      { op: 'fork', h: FL.carryHeight },
    ];
  }

  assignTask(f) {
    const m = this.m, R = this.rand;
    const free = s => !s.claim;
    const rackEmpty = m.slots.filter(s => s.kind === 'rack' && !s.pallet && free(s) && s.z + 0.2 <= FL.maxLift);
    const pickRandom = arr => arr[Math.floor(R() * arr.length)];
    const nearest = (arr, x = f.x, y = f.y) => arr.reduce((b, s) => (!b || dist(x, y, s.pre[0], s.pre[1]) < dist(x, y, b.pre[0], b.pre[1]) ? s : b), null);
    // A random one of the `n` slots nearest to (x, y): keeps trips in a long
    // building reasonable while still spreading pallets around.
    const nearRandom = (arr, x, y, n = 40) => pickRandom(arr.map(s => [dist(x, y, s.pre[0], s.pre[1]), s]).sort((a, b) => a[0] - b[0]).slice(0, n).map(e => e[1]));
    // Time allowed before the watchdog drops the task: 2 minutes plus the
    // driving, at about 1 m/s (routes go around racks and wait for traffic).
    const limit = (...pts) => { let d = 0; for (let k = 1; k < pts.length; k++) d += dist(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]); return 120 + d; };

    if (f.carrying) {
      const to = nearest(rackEmpty);
      if (!to) return;
      to.claim = f.id;
      f.task = { kind: 'putaway', to: to.id };
      f.steps = [{ op: 'fork', h: FL.carryHeight }, ...this.dropSteps(to), { op: 'done' }];
      f.taskT = 0; f.taskLimit = limit([f.x, f.y], to.pre);
      return;
    }
    const inbound = m.slots.filter(s => s.dockKind === 'inbound' && s.pallet && free(s));
    const outEmpty = m.slots.filter(s => s.dockKind === 'outbound' && !s.pallet && free(s));
    const rackFull = m.slots.filter(s => s.kind === 'rack' && s.pallet && free(s) && s.z + 0.2 <= FL.maxLift);

    let from = null, to = null, kind = null;
    const canPick = outEmpty.length && rackFull.length;
    const wantPutaway = inbound.length && rackEmpty.length && (!canPick || inbound.length >= 7 || R() < 0.5);
    if (wantPutaway) { kind = 'putaway'; from = nearest(inbound); to = nearRandom(rackEmpty, from.x, from.y); }
    else if (outEmpty.length && rackFull.length) { kind = 'pick'; to = pickRandom(outEmpty); from = nearRandom(rackFull, to.x, to.y); }

    if (!from || !to) {
      const h = m.homes.get(f.id);
      if (!f.atHome && h) {
        f.task = null;
        f.steps = [
          { op: 'goto', x: h.x, y: h.y, label: 'Returning to charger' },
          { op: 'face', heading: h.heading },
          { op: 'home' },
        ];
      }
      return;
    }
    from.claim = f.id; to.claim = f.id;
    f.msg = '';
    f.task = { kind, from: from.id, to: to.id, pallet: from.pallet };
    f.taskT = 0; f.taskLimit = limit([f.x, f.y], from.pre, to.pre);
    f.steps = [...this.pickSteps(from, f), ...this.dropSteps(to), { op: 'done' }];
  }

  finishTask(f) { f.task = null; f.status = 'Idle'; }

  abortTask(f, why) {
    for (const s of this.m.slots) if (s.claim === f.id) s.claim = null;
    f.task = null; f.service = null; f.steps = [];
    f.msg = why || '';
    f.taskT = 0;
  }

  // Two forklifts waiting on each other: the one with lower priority makes
  // room by driving to a nearby spot off the other's route, waiting for it to
  // pass, and then carrying on.
  resolveTraffic(f) {
    const oid = f.blockedBy;
    if (!oid) return;
    if (oid === 'aisle') {
      // Waiting at an aisle entrance. If we are in the way of someone (e.g. the
      // forklift coming out of that aisle), step aside.
      const o = this.forklifts.find(o => o.blockedBy === f.id && o.blockedFor > 1.2);
      const st = f.steps[0];
      if (o && st && st.op === 'goto') {
        o.blockedFor = 0; st.path = null;
        const spot = this.findRefuge(f, o);
        f.steps.unshift(spot
          ? { op: 'goto', x: spot[0], y: spot[1], label: `Making room for ${o.id}`, avoid: [o.id], avoidUntil: this.t + 30, refugeFor: o.id }
          : { op: 'escape', from: o.id },
          { op: 'yield', other: o.id, label: `Letting ${o.id} pass` });
      }
      return;
    }
    if (oid === 'static') {
      // Wedged against a rack or wall: back off a little and plan again.
      const st = f.steps[0];
      if (f.blockedFor > 2 && st && st.op === 'goto') {
        f.blockedFor = 0; st.path = null;
        f.steps.unshift({ op: 'escape', from: 'static' });
      }
      return;
    }
    const o = this.forklift(oid);
    if (!o) return;
    const st = f.steps[0];
    if (!st || st.op === 'yield' || st.op === 'escape') return;
    const mutual = o.blockedBy === f.id;
    const pf = this.priority(f), po = this.priority(o);
    // Already making room but cannot get out of the way: wriggle free instead.
    if (st.refugeFor) {
      if (f.blockedFor > 2) {
        f.steps.shift(); if (f.steps[0]?.op === 'yield') f.steps.shift();
        f.steps.unshift({ op: 'escape', from: o.id }, { op: 'yield', other: o.id, label: `Letting ${o.id} pass` });
        f.blockedFor = 0;
      }
      return;
    }
    // Long tangles, whoever is waiting on whom: the lower id-ranked one wriggles free.
    if (f.blockedFor > 8 && (pf < po || (pf === po && f.id > o.id) || f.blockedFor > 16)) {
      f.blockedFor = 0;
      if (f.steps[0].op === 'goto') f.steps[0].path = null;
      if (f.steps[0].op !== 'straight') {
        f.steps.unshift({ op: 'escape', from: o.id }, { op: 'yield', other: o.id, label: `Letting ${o.id} pass` });
        return;
      }
    }
    if (mutual) {
      const iYield = pf < po || (pf === po && f.id > o.id);
      if (!iYield || f.blockedFor < 0.8) return;
    } else {
      if (st.op === 'await') return;                       // wait our turn
      if (o.service && f.blockedFor < 12) return;          // it is busy at a slot; it will leave
      if (f.blockedFor < (o.moving ? 4 : 2.5)) return;
    }
    f.blockedFor = 0;
    f.status = `Making room for ${o.id}`;

    if (st.op === 'straight') {
      const sl = f.service;
      if (!sl) return;
      // Inside a slot: back out (or go back in) and try again a bit later.
      const p = st.rev ? sl.engage : sl.pre;
      f.steps.unshift({ op: 'straight', x: p[0], y: p[1], rev: !st.rev }, { op: 'wait', t: 2 + this.rand() * 2 });
      return;
    }
    if (f.service) {
      // Lined up in front of a slot but not inside it yet: give up the spot and
      // come back to it afterwards.
      const sl = f.service;
      f.service = null;
      f.steps.unshift({ op: 'goto', x: sl.pre[0], y: sl.pre[1], slot: sl.id, label: `Driving to ${sl.id}` }, { op: 'await', slot: sl.id }, { op: 'service', slot: sl.id });
    }
    if (!mutual && st.op === 'goto') {
      // Someone is parked in the way: try another route.
      st.path = null; st.avoid = [o.id]; st.avoidUntil = this.t + 10;
      return;
    }
    const spot = this.findRefuge(f, o);
    if (f.steps[0].op === 'goto') f.steps[0].path = null;
    if (spot) {
      f.steps.unshift(
        { op: 'goto', x: spot[0], y: spot[1], label: `Making room for ${o.id}`, avoid: [o.id], avoidUntil: this.t + 30, refugeFor: o.id },
        { op: 'yield', other: o.id, label: `Letting ${o.id} pass` },
      );
    } else {
      f.steps.unshift({ op: 'escape', from: o.id }, { op: 'yield', other: o.id, label: `Letting ${o.id} pass` });
    }
  }

  // Wriggle away from another forklift: try small forward/back/turning moves
  // and take the one that opens the gap the most without touching anything.
  // With from: 'static' it wriggles away from racks and walls instead.
  stepEscape(f, st, dt) {
    const g = this.m.grid;
    const room = (x, y, h) => { // free space around the whole forklift (front, middle, back)
      let m = Infinity;
      for (const d of [FL.back + 0.3, 0, FL.bodyFront]) {
        const [i, j] = g.cellOf(x + Math.cos(h) * d, y + Math.sin(h) * d);
        m = Math.min(m, g.clear[g.idx(i, j)]);
      }
      return m;
    };
    const wall = st.from === 'static';
    const o = wall ? null : this.forklift(st.from);
    if (!wall && !o) return true;
    f.status = wall ? 'Backing away from the rack' : `Making room for ${st.from}`;
    const ob = o && this.fullBox(o.x, o.y, o.heading, 0);
    if (wall ? (room(f.x, f.y, f.heading) >= 1.5 && f.stepT > 0.3) || f.stepT > 4
      : (boxGap(this.fullBox(f.x, f.y, f.heading, 0), ob) > 1.0 && f.stepT > 0.6) || f.stepT > 6) {
      f.speed = 0; f.moving = false; return true;
    }
    let best = null, bs = -Infinity;
    for (const v of [-0.7, 0, 0.7]) {
      for (const w of [-0.9, 0, 0.9]) {
        if (!v && !w) continue;
        const h = f.heading + w * dt, x = f.x + Math.cos(h) * v * dt, y = f.y + Math.sin(h) * v * dt;
        if (this.hits(f, x, y, h)) continue;
        const h2 = f.heading + w * 0.6, x2 = f.x + Math.cos(h2) * v * 0.6, y2 = f.y + Math.sin(h2) * v * 0.6;
        const r = Math.min(room(x2, y2, h2), 2.5);
        const score = (wall ? r : boxGap(this.fullBox(x2, y2, h2, 0), ob) + 0.3 * Math.min(r, 2)) - (v < 0 ? 0.05 : 0);
        if (score > bs) { bs = score; best = [x, y, h, v]; }
      }
    }
    if (!best) { f.blockedNow = wall ? 'static' : o.id; f.speed = 0; f.moving = false; return false; }
    this.tryPose(f, best[0], best[1], best[2]);
    f.speed = best[3]; f.moving = true;
    return false;
  }

  // Cells the other forklift will drive over next (its route, or where it is).
  routeOf(o) {
    const pts = [[o.x, o.y]];
    const st = o.steps[0];
    if (o.mode === 'auto' && st) {
      if (st.op === 'goto' && st.path) {
        let len = 0;
        for (let k = st.i || 0; k < st.path.length && len < 18; k++) {
          const q = st.path[k], pr = pts[pts.length - 1];
          len += dist(pr[0], pr[1], q[0], q[1]);
          pts.push(q);
        }
      } else if (o.service) pts.push(o.service.pre, o.service.engage);
    } else {
      const c = Math.cos(o.heading), s = Math.sin(o.heading);
      pts.push([o.x + c * 3, o.y + s * 3], [o.x - c * 3, o.y - s * 3]);
    }
    return pts;
  }

  // Nearest reachable spot that is clear of the other forklift's route.
  findRefuge(f, o) {
    const g = this.m.grid, route = this.routeOf(o);
    const avoid = this.avoidCells(f, [o.id]);
    const others = this.forklifts.filter(x => x !== f);
    const farFromRoute = (x, y) => {
      for (let k = 0; k < route.length; k++) {
        const a = route[k], b = route[Math.min(k + 1, route.length - 1)];
        if (segDist(a, b, x, y) < 2.6) return false;
      }
      return true;
    };
    const [si, sj] = g.cellOf(f.x, f.y);
    const seen = new Uint8Array(g.w * g.h), q = [[si, sj, 0]];
    seen[g.idx(si, sj)] = 1;
    for (let h = 0; h < q.length && h < 4000; h++) {
      const [i, j, d] = q[h];
      const [x, y] = g.center(i, j);
      if (d > 2 && g.clear[g.idx(i, j)] >= 1.7 && farFromRoute(x, y)
        && others.every(z => dist(z.x, z.y, x, y) > 3.5)) return [x, y];
      if (d > 50) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
        const k = g.idx(ni, nj);
        if (seen[k]) continue;
        seen[k] = 1;
        if (g.clear[k] < 0.85 || (d > 1 && avoid(ni, nj))) continue;
        q.push([ni, nj, d + 1]);
      }
    }
    return null;
  }

  // ------------------------------------------------------- manual control

  takeControl(id) {
    const f = this.forklift(id);
    if (!f || f.mode === 'manual') return;
    for (const s of this.m.slots) if (s.claim === f.id) s.claim = null;
    f.mode = 'manual'; f.task = null; f.steps = []; f.service = null; f.atHome = false;
    f.status = 'You are driving'; f.msg = '';
  }
  releaseControl(id) {
    const f = this.forklift(id);
    if (!f || f.mode !== 'manual') return;
    f.mode = 'auto'; f.steps = []; f.input = { throttle: 0, steer: 0, fork: 0 }; f.hint = null;
    f.autoLower = null; f.idleT = 1; f.status = 'Idle';
    if (Math.abs(f.fork - FL.carryHeight) > 0.01) f.steps.push({ op: 'fork', h: FL.carryHeight });
  }
  setInput(id, input) {
    const f = this.forklift(id);
    if (f) Object.assign(f.input, input);
  }

  // Which slot is in front of the forks right now (for pick or drop)?
  slotInFront(f) {
    const fx = f.x + Math.cos(f.heading) * FL.forkCenter, fy = f.y + Math.sin(f.heading) * FL.forkCenter;
    // The rack level is the one closest to the current fork height.
    let best = null, bd = Infinity;
    for (const s of this.m.slots) {
      if (s.claim && s.claim !== f.id) continue;
      if (f.carrying ? s.pallet : !s.pallet) continue;
      if (s.z > FL.maxLift - 0.1) continue;
      const d = dist(fx, fy, s.x, s.y);
      if (d > 0.6 || Math.abs(wrapAngle(f.heading - s.heading)) > 0.45) continue;
      const score = d + Math.abs(s.z - f.fork) * 2;
      if (Math.abs(s.z - f.fork) < 0.75 && score < bd) { bd = score; best = s; }
    }
    return best;
  }

  // Space bar: pick up or drop the pallet in front of the forks.
  action(id) {
    const f = this.forklift(id);
    if (!f || f.mode !== 'manual' || f.steps.length) return;
    const s = this.slotInFront(f);
    if (!s) { f.msg = f.carrying ? 'Line the forks up with an empty slot' : 'Line the forks up with a pallet'; return; }
    f.msg = '';
    const align = { op: 'align', x: s.engage[0], y: s.engage[1], heading: s.heading };
    if (f.carrying) {
      f.steps = [{ op: 'fork', h: s.z + 0.12 }, align, { op: 'fork', h: s.z + 0.04 }, { op: 'release', slot: s.id }];
    } else {
      f.steps = [{ op: 'fork', h: s.z + 0.04 }, align, { op: 'attach', slot: s.id }, { op: 'fork', h: s.z + 0.12 }];
    }
    f.autoLower = s;
  }

  updateManual(f, dt) {
    f.status = 'You are driving';
    if (f.steps.length) {
      f.stepT += dt;
      if (this.runStep(f, f.steps[0], dt)) { f.steps.shift(); f.stepT = 0; }
      return;
    }
    const inp = f.input;
    const vT = inp.throttle > 0 ? inp.throttle * V_MANUAL : inp.throttle * V_REVERSE;
    const omega = inp.steer * TURN * 1.2; // + = clockwise seen from above
    this.drive(f, dt, vT, omega, false);
    if (f.blockedNow && f.blockedNow !== 'static') f.zone = 'stop';
    if (inp.fork) f.fork = clamp(f.fork + inp.fork * FORK_SPEED * dt, 0, FL.maxLift);
    // After a pick or drop, lower the forks once they are out of the rack.
    if (f.autoLower && !inp.fork) {
      const fx = f.x + Math.cos(f.heading) * FL.forkCenter, fy = f.y + Math.sin(f.heading) * FL.forkCenter;
      if (dist(fx, fy, f.autoLower.x, f.autoLower.y) > 1.3) {
        if (this.moveFork(f, dt, FL.carryHeight)) f.autoLower = null;
      }
    } else if (inp.fork) f.autoLower = null;
    const s = this.slotInFront(f);
    f.hint = s ? { slot: s.id, action: f.carrying ? 'drop' : 'pick' } : null;
  }

  // ------------------------------------------------------------ dock flow

  updateDocks(dt) {
    this.nextInbound -= dt;
    if (this.nextInbound <= 0) {
      this.nextInbound = 35 + this.rand() * 20;
      const all = this.m.slots.filter(s => s.dockKind === 'inbound');
      const waiting = all.filter(s => s.pallet).length;
      const empty = all.filter(s => !s.pallet && !s.claim && !this.forkliftNear(s));
      if (waiting < 8 && empty.length) {
        const s = empty[Math.floor(this.rand() * empty.length)];
        this.newPallet(s, `Unloaded from truck at ${s.dock}`);
        this.stats.received++;
      }
    }
    for (const s of this.m.slots) {
      if (s.dockKind !== 'outbound' || !s.pallet || s.claim) continue;
      const p = this.pallets.get(s.pallet);
      if (this.t - p.since > 25 + (p.id.charCodeAt(p.id.length - 1) % 20) && !this.forkliftNear(s)) {
        this.log(p, `Loaded onto truck at ${s.dock}`);
        s.pallet = null; this.pallets.delete(p.id);
        this.stats.shipped++;
        this.emit({ type: 'shipped', id: p.id });
      }
    }
  }
  forkliftNear(s) {
    const b = obb(s.x, s.y, PALLET.width / 2 + 0.3, PALLET.length / 2 + 0.3);
    return this.forklifts.some(f => overlaps(b, this.fullBox(f.x, f.y, f.heading, 0)));
  }

  // Smallest gap between any two forklifts (for tests and the safety readout).
  minGap() {
    let g = Infinity;
    for (let i = 0; i < this.forklifts.length; i++) {
      for (let j = i + 1; j < this.forklifts.length; j++) {
        const a = this.forklifts[i], b = this.forklifts[j];
        g = Math.min(g, boxGap(this.fullBox(a.x, a.y, a.heading, 0), this.fullBox(b.x, b.y, b.heading, 0)));
      }
    }
    return g;
  }
}

function segDist(a, b, x, y) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1) : 0;
  return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
}
