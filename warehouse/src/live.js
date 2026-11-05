// Live mode: forklift poses from VSLAM (and optionally pallet moves) arrive as
// JSON messages over Server-Sent Events or a WebSocket. See README.md for the
// message format. Poses are converted from the VSLAM map frame to the layout
// with the calibration in layout.js, then smoothed for display.

import { mapToLayout } from './calibration.js';
import { FORKLIFT as FL } from './model.js';
import { poseBox, boxGap, wrapAngle } from './geometry.js';

export class LiveSource {
  constructor(model, pallets) {
    this.m = model;
    this.pallets = pallets;          // shared pallet store (Map) from the simulation
    this.cfg = model.layout.live || {};
    this.cal = this.cfg.calibration || { flipY: false, rotationDeg: 0, scale: 1, tx: 0, ty: 0 };
    this.forklifts = [];
    this.byId = new Map();
    this.state = 'off';
    this.lastMsg = 0;
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  connect(url) {
    this.close();
    this.url = url;
    this.state = 'connecting';
    this.open();
  }
  open() {
    const url = this.url;
    const onMsg = data => { try { this.handle(JSON.parse(data)); } catch (e) { console.warn('Bad live message', e, data); } };
    if (/^wss?:/i.test(url)) {
      const ws = this.ws = new WebSocket(url);
      ws.onopen = () => { this.state = 'connected'; };
      ws.onmessage = e => onMsg(e.data);
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.state = 'retrying';
        this.retry = setTimeout(() => this.open(), 2000);
      };
    } else {
      const es = this.es = new EventSource(url);
      es.onopen = () => { this.state = 'connected'; };
      es.onmessage = e => onMsg(e.data);
      es.onerror = () => { this.state = es.readyState === 2 ? 'closed' : 'retrying'; };
    }
  }
  close() {
    clearTimeout(this.retry);
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
    if (this.es) { this.es.close(); this.es = null; }
    this.state = 'off';
  }

  handle(msg) {
    this.lastMsg = performance.now();
    if (Array.isArray(msg)) { msg.forEach(m => this.handle(m)); return; }
    switch (msg.type) {
      case 'pose': this.pose(msg); break;
      case 'pallet': this.pallet(msg); break;
      case 'snapshot': this.snapshot(msg); break;
      default: break;
    }
  }

  pose(msg) {
    const id = msg.forklift || msg.id;
    if (!id) return;
    let f = this.byId.get(id);
    if (!f) {
      f = { id, x: 0, y: 0, heading: 0, fork: FL.carryHeight, carrying: null, mode: 'live', status: 'Live', zone: 'clear',
        speed: 0, moving: false, tracking: 'ok', confidence: null, seen: 0, fresh: true };
      this.byId.set(id, f);
      this.forklifts.push(f);
    }
    f.tracking = msg.tracking || 'ok';
    if (msg.confidence != null) f.confidence = msg.confidence;
    if (msg.fork != null) f.fork = msg.fork;
    if (msg.carrying !== undefined) f.carrying = msg.carrying;
    if (msg.x == null || msg.y == null || f.tracking === 'lost') return; // keep the last good pose
    const p = msg.frame === 'layout'
      ? { x: msg.x, y: msg.y, heading: msg.heading ?? msg.yaw ?? 0 }
      : mapToLayout(this.cal, msg.x, msg.y, msg.yaw ?? msg.heading ?? 0);
    const now = performance.now();
    if (f.fresh) { f.x = p.x; f.y = p.y; f.heading = p.heading; f.fresh = false; }
    if (f.seen && f.tx != null) {
      // Speed from successive VSLAM poses, lightly filtered against noise.
      const dt = (now - f.seen) / 1000;
      if (dt > 0.02 && dt < 2) {
        const v = Math.hypot(p.x - f.tx, p.y - f.ty) / dt;
        f.speedEst = f.speedEst == null ? v : f.speedEst * 0.7 + v * 0.3;
      }
    }
    f.tx = p.x; f.ty = p.y; f.th = p.heading;
    f.seen = now;
  }

  // Pallet moves: { type: 'pallet', id, sku?, at: { slot } | { forklift } | { x, y } | null }
  pallet(msg) {
    let p = this.pallets.get(msg.id);
    const at = msg.at;
    if (p) this.detach(p);
    if (at == null) { if (p) this.pallets.delete(p.id); this.emit({ type: 'pallet', id: msg.id }); return; }
    if (!p) {
      p = { id: msg.id, sku: msg.sku || this.m.skus[0].id, slot: null, forklift: null, history: [] };
      this.pallets.set(p.id, p);
    }
    if (msg.sku) p.sku = msg.sku;
    if (at.slot && this.m.slotById.has(at.slot)) { p.slot = at.slot; this.m.slotById.get(at.slot).pallet = p.id; }
    else if (at.forklift) { p.forklift = at.forklift; const f = this.byId.get(at.forklift); if (f) f.carrying = p.id; }
    else if (at.x != null) {
      const q = at.frame === 'layout' ? { x: at.x, y: at.y, heading: at.heading || 0 } : mapToLayout(this.cal, at.x, at.y, at.yaw || 0);
      p.floor = { x: q.x, y: q.y, heading: q.heading };
    }
    p.history.push({ t: Date.now() / 1000, msg: msg.note || describe(at) });
    if (p.history.length > 12) p.history.shift();
    this.emit({ type: 'pallet', id: p.id });
  }
  detach(p) {
    if (p.slot) { const s = this.m.slotById.get(p.slot); if (s && s.pallet === p.id) s.pallet = null; }
    if (p.forklift) { const f = this.byId.get(p.forklift); if (f && f.carrying === p.id) f.carrying = null; }
    p.slot = null; p.forklift = null; p.floor = null;
  }
  snapshot(msg) {
    for (const s of this.m.slots) s.pallet = null;
    this.pallets.clear();
    for (const q of msg.pallets || []) this.pallet({ type: 'pallet', ...q });
  }

  update(dt) {
    const now = performance.now(), stale = (this.cfg.staleAfter || 3) * 1000;
    const k = 1 - Math.exp(-dt * 8);
    for (const f of this.forklifts) {
      if (f.tx != null) {
        f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k;
        f.heading = wrapAngle(f.heading + wrapAngle(f.th - f.heading) * k);
      }
      f.stale = !f.seen || now - f.seen > stale;
      f.speed = f.stale ? 0 : (f.speedEst || 0);
      f.moving = f.speed > 0.15;
      f.age = f.seen ? (now - f.seen) / 1000 : Infinity;
    }
    // Proximity alarm: real forklifts are not stopped by this app, but it
    // shows when two of them get close.
    for (const f of this.forklifts) { f.zone = 'clear'; f.near = null; }
    for (let i = 0; i < this.forklifts.length; i++) {
      for (let j = i + 1; j < this.forklifts.length; j++) {
        const a = this.forklifts[i], b = this.forklifts[j];
        if (a.stale || b.stale) continue;
        const gap = boxGap(poseBox(a.x, a.y, a.heading, FL.back, FL.front, FL.halfWidth), poseBox(b.x, b.y, b.heading, FL.back, FL.front, FL.halfWidth));
        const z = gap < 0.6 ? 'stop' : gap < 1.8 ? 'slow' : 'clear';
        for (const [f, o] of [[a, b], [b, a]]) {
          if (z !== 'clear' && (!f.near || gap < f.near.gap)) { f.near = { id: o.id, gap }; f.zone = z; }
        }
      }
    }
    for (const f of this.forklifts) {
      f.status = f.stale ? `No position for ${f.age === Infinity ? 'a while' : f.age.toFixed(0) + ' s'}`
        : f.tracking === 'lost' ? 'VSLAM tracking lost'
          : f.near ? `Close to ${f.near.id} (${f.near.gap.toFixed(1)} m)`
            : f.moving ? 'Moving' : 'Stopped';
    }
  }
}

function describe(at) {
  if (at.slot) return `In ${at.slot}`;
  if (at.forklift) return `On ${at.forklift}`;
  return 'On the floor';
}
