#!/usr/bin/env node
// Local server for the Warehouse Twin, with a fake VSLAM feed for testing
// live mode before the real forklifts are connected.
//
//   node warehouse/tools/dev-server.mjs          -> http://localhost:8080
//   PORT=3000 node warehouse/tools/dev-server.mjs
//
// /           serves the warehouse page
// /vslam      Server-Sent Events: forklift poses (in the VSLAM map frame, as
//             real VSLAM would send them) and pallet moves, ~10 times a second.
//             The poses come from a headless copy of the simulation and are
//             turned into map coordinates with the inverse of the calibration
//             in layout.js, plus a little noise. Now and then a forklift
//             "loses tracking" for a moment, like real VSLAM can.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import layout from '../layout.js';
import { buildModel } from '../src/model.js';
import { Sim } from '../src/sim.js';
import { layoutToMap } from '../src/calibration.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = +(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

// ------------------------------------------------------- fake VSLAM feed
const sim = new Sim(buildModel({ ...layout, seed: (layout.seed || 1) + 11 }));
const cal = layout.live.calibration;
const clients = new Set();
const lost = new Map(); // forklift id -> time tracking comes back
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const noise = s => (rand() - 0.5) * 2 * s;

const palletAt = p => p.slot ? { slot: p.slot } : p.forklift ? { forklift: p.forklift } : null;
sim.on(ev => {
  if (ev.type === 'pallet') { const p = sim.pallets.get(ev.id); if (p) send({ type: 'pallet', id: p.id, sku: p.sku, at: palletAt(p), note: ev.msg }); }
  if (ev.type === 'shipped') send({ type: 'pallet', id: ev.id, at: null, note: 'Loaded onto truck' });
});
function send(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}
let simT = 0;
setInterval(() => {
  sim.update(0.1);
  simT += 0.1;
  const now = Date.now() / 1000;
  const batch = [];
  for (const f of sim.forklifts) {
    if (!lost.has(f.id) && rand() < 0.0015) lost.set(f.id, simT + 1.5 + rand() * 2);
    if (lost.has(f.id) && simT > lost.get(f.id)) lost.delete(f.id);
    if (lost.has(f.id)) { batch.push({ type: 'pose', forklift: f.id, tracking: 'lost', ts: now }); continue; }
    const m = layoutToMap(cal, f.x, f.y, f.heading);
    batch.push({
      type: 'pose', forklift: f.id, ts: now,
      x: +(m.x + noise(0.02)).toFixed(3), y: +(m.y + noise(0.02)).toFixed(3), yaw: +(m.yaw + noise(0.006)).toFixed(4),
      fork: +f.fork.toFixed(3), carrying: f.carrying, tracking: 'ok', confidence: +(0.86 + rand() * 0.13).toFixed(2),
    });
  }
  send(batch);
}, 100);

// ------------------------------------------------------------- http server
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/vslam') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    const pallets = [...sim.pallets.values()].map(p => ({ id: p.id, sku: p.sku, at: palletAt(p) })).filter(p => p.at);
    res.write(`data: ${JSON.stringify({ type: 'snapshot', pallets })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT + sep)) && file !== normalize(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Warehouse Twin: http://localhost:${PORT}/`);
  console.log(`Live mode with the fake VSLAM feed: http://localhost:${PORT}/?mode=live`);
});
