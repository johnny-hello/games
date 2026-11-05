// The few panels on top of the 3D view: the selection card, search and hints.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function setupUI(app) {
  const { model } = app;
  $('site').textContent = model.layout.name || '';

  // --------------------------------------------------------------- mode
  $('modeSim').classList.toggle('on', app.mode === 'sim');
  $('modeLive').classList.toggle('on', app.mode === 'live');
  $('modeSim').onclick = () => app.setMode('sim');
  $('modeLive').onclick = () => app.setMode('live');

  // ------------------------------------------------------------- buttons
  $('rotL').onclick = () => app.scene.rotateStep(-1);
  $('rotR').onclick = () => app.scene.rotateStep(1);
  $('home').onclick = () => { app.follow = false; app.scene.resetView(); };
  $('cams').onclick = () => app.toggleCameras();
  $('helpbtn').onclick = () => { $('help').hidden = !$('help').hidden; };

  // -------------------------------------------------------------- search
  const q = $('q'), results = $('results');
  let hits = [], hi = 0;
  const run = () => {
    const s = q.value.trim().toUpperCase();
    if (!s) { results.hidden = true; return; }
    hits = [];
    for (const f of app.fleet()) if (f.id.toUpperCase().includes(s)) hits.push({ kind: 'forklift', id: f.id, label: f.id, note: f.status });
    for (const p of app.pallets.values()) {
      const sku = model.skuById.get(p.sku);
      if (p.id.includes(s) || p.sku.includes(s) || (sku && sku.name.toUpperCase().includes(s))) hits.push({ kind: 'pallet', id: p.id, label: p.id, note: where(app, p) });
      if (hits.length > 40) break;
    }
    for (const sl of model.slots) {
      if (sl.id.toUpperCase().startsWith(s)) hits.push({ kind: 'slot', id: sl.id, label: sl.id, note: sl.pallet || 'empty' });
      if (hits.length > 60) break;
    }
    hi = 0;
    results.innerHTML = hits.length
      ? hits.slice(0, 30).map((h, i) => `<button data-i="${i}" class="${i === hi ? 'hi' : ''}"><span class="k">${h.kind}</span>${esc(h.label)}<small>${esc(h.note || '')}</small></button>`).join('')
      : '<div class="none">Nothing found</div>';
    results.hidden = false;
  };
  const choose = h => {
    if (!h) return;
    if (h.kind === 'slot') {
      const sl = model.slotById.get(h.id);
      if (sl.pallet) app.select({ kind: 'pallet', id: sl.pallet }, true);
      else app.scene.focus(sl.x, sl.y, 2.2);
    } else app.select({ kind: h.kind, id: h.id }, true);
    results.hidden = true; q.blur();
  };
  q.addEventListener('input', run);
  q.addEventListener('focus', run);
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') choose(hits[hi]);
    else if (e.key === 'Escape') { q.value = ''; results.hidden = true; q.blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hi = Math.max(0, Math.min(Math.min(hits.length, 30) - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
      [...results.children].forEach((b, i) => b.classList.toggle('hi', i === hi));
    }
  });
  results.addEventListener('click', e => { const b = e.target.closest('button'); if (b) choose(hits[+b.dataset.i]); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#search')) results.hidden = true; });

  // ---------------------------------------------------------------- card
  const card = $('card');
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'close') app.select(null);
    if (a === 'drive') app.takeControl();
    if (a === 'auto') app.releaseControl();
    if (a === 'follow') app.toggleFollow();
    if (a === 'cams') app.toggleCameras();
    if (a === 'find') { const p = app.pallets.get(b.dataset.id); if (p) app.select({ kind: 'pallet', id: p.id }, true); }
    if (a === 'findf') app.select({ kind: 'forklift', id: b.dataset.id }, true);
  });

  let lastHtml = '';
  const touch = matchMedia('(pointer: coarse)').matches;

  return {
    update() {
      const sel = app.selected;
      let html = '';
      if (sel && sel.kind === 'forklift') html = forkliftCard(app, sel.id, touch);
      if (sel && sel.kind === 'pallet') html = palletCard(app, sel.id);
      if (html !== lastHtml) { card.innerHTML = html; lastHtml = html; }
      card.hidden = !html;
      $('cams').classList.toggle('on', app.scene.showCameras);

      // Hint while driving.
      const f = app.driving();
      const toast = $('toast');
      let msg = '';
      if (f) {
        if (f.steps && f.steps.length) msg = f.carrying ? 'Lifting…' : 'Working…';
        else if (f.hint) {
          const sl = model.slotById.get(f.hint.slot);
          msg = f.hint.action === 'pick'
            ? `<kbd>Space</kbd> pick up ${esc(sl.pallet)} from ${esc(sl.id)}`
            : `<kbd>Space</kbd> drop into ${esc(sl.id)}`;
        } else if (f.msg) msg = esc(f.msg);
      }
      toast.hidden = !msg;
      if (msg && toast.innerHTML !== msg) toast.innerHTML = msg;

      const touchDrive = !!(touch && app.mode === 'sim' && sel && sel.kind === 'forklift');
      $('touch').hidden = !touchDrive;
      document.body.classList.toggle('touchdrive', touchDrive);

      // Live connection chip.
      const conn = $('conn');
      conn.hidden = app.mode !== 'live';
      if (app.mode === 'live') {
        const st = app.live.state, n = app.live.forklifts.filter(f => !f.stale).length;
        conn.className = st === 'connected' ? 'ok' : st === 'off' ? '' : 'wait';
        conn.querySelector('span').textContent = st === 'connected' ? `${n} live` : st === 'connecting' ? 'Connecting…' : st === 'retrying' ? 'Reconnecting…' : 'Off';
      }
    },
  };
}

function where(app, p) {
  if (p.slot) {
    const s = app.model.slotById.get(p.slot);
    return s.kind === 'stage' ? `Dock ${s.dock} lane` : `Rack ${s.rack}, bay ${s.bay + 1}, level ${s.level + 1}`;
  }
  if (p.forklift) return `On ${p.forklift}`;
  if (p.floor) return 'On the floor';
  return 'Gone';
}

function fmtTime(app, t) {
  if (app.mode === 'live') return new Date(t * 1000).toTimeString().slice(0, 5);
  const m = 8 * 60 + Math.floor(t / 60); // simulation clock starts at 08:00
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function forkliftCard(app, id, touch) {
  const f = app.fleet().find(x => x.id === id);
  if (!f) return '';
  const p = f.carrying && app.pallets.get(f.carrying);
  const sku = p && app.model.skuById.get(p.sku);
  const live = f.mode === 'live';
  const tag = live ? (f.stale ? '<span class="tag bad">No signal</span>' : '<span class="tag live">Live · VSLAM</span>')
    : f.mode === 'manual' ? '<span class="tag manual">You are driving</span>' : '<span class="tag auto">Autopilot</span>';
  const stClass = f.zone === 'stop' ? 'bad' : f.zone === 'slow' || (live && f.tracking === 'lost') ? 'warn' : '';
  const status = f.mode === 'manual' ? (f.blockedBy && f.blockedBy !== 'static' ? `Stopped: too close to ${f.blockedBy}` : f.msg || 'Driving') : f.status;
  let rows = `
    <span>Carrying</span><b>${p ? `<a data-act="find" data-id="${esc(p.id)}" style="cursor:pointer;color:var(--cobalt)">${esc(p.id)}</a> · ${esc(sku ? sku.name : p.sku)}` : '—'}</b>
    <span>Forks</span><b>${f.fork.toFixed(2)} m</b>
    <span>Speed</span><b>${Math.abs(f.speed || 0).toFixed(1)} m/s</b>`;
  if (live) {
    rows += `<span>VSLAM</span><b class="plain">${f.tracking === 'lost' ? 'Tracking lost' : 'Tracking'}${f.confidence != null ? ` · ${Math.round(f.confidence * 100)}%` : ''} · ${f.age === Infinity ? '—' : f.age.toFixed(1) + ' s ago'}</b>`;
    rows += `<span>Position</span><b>x ${f.x.toFixed(2)} · y ${f.y.toFixed(2)} · ${Math.round(((f.heading * 180 / Math.PI) % 360 + 360) % 360)}°</b>`;
  }
  const acts = live ? '' : f.mode === 'manual'
    ? '<button class="btn" data-act="auto">Back to autopilot</button>'
    : '<button class="btn primary" data-act="drive">Drive this forklift</button>';
  const tip = live ? '' : f.mode === 'manual'
    ? (touch ? 'Use the stick to drive and the buttons to lift and pick.' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>R</kbd>/<kbd>F</kbd> forks · <kbd>Space</kbd> pick or drop · <kbd>Esc</kbd> autopilot')
    : (touch ? '' : 'Press a drive key (<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) to take over.');
  return `
    <div class="h"><b>${esc(f.id)}</b>${tag}<button class="x" data-act="close" title="Close (Esc)">✕</button></div>
    <div class="st ${stClass}">${esc(status)}</div>
    <div class="kv">${rows}</div>
    <div class="acts">${acts}
      <button class="btn ${app.follow ? 'on' : ''}" data-act="follow">Follow</button>
      <button class="btn ${app.scene.showCameras ? 'on' : ''}" data-act="cams">Cameras</button>
    </div>
    ${tip ? `<div class="tip">${tip}</div>` : ''}`;
}

function palletCard(app, id) {
  const p = app.pallets.get(id);
  if (!p) return `<div class="h"><b>${esc(id)}</b><span class="tag">Shipped</span><button class="x" data-act="close">✕</button></div><div class="st">This pallet has left the building.</div>`;
  const sku = app.model.skuById.get(p.sku);
  const hist = (p.history || []).slice().reverse().slice(0, 6)
    .map(h => `<li><time>${fmtTime(app, h.t)}</time>${esc(h.msg)}</li>`).join('');
  return `
    <div class="h"><b>${esc(p.id)}</b><span class="tag">${esc(p.sku)}</span><button class="x" data-act="close" title="Close (Esc)">✕</button></div>
    <div class="st">${esc(sku ? sku.name : '')}</div>
    <div class="kv">
      <span>Location</span><b class="plain">${esc(where(app, p))}</b>
      ${p.slot ? `<span>Slot</span><b>${esc(p.slot)}</b>` : ''}
      ${p.forklift ? `<span>Forklift</span><b><a data-act="findf" data-id="${esc(p.forklift)}" style="cursor:pointer;color:var(--cobalt)">${esc(p.forklift)}</a></b>` : ''}
    </div>
    ${hist ? `<ul>${hist}</ul>` : ''}`;
}
