// Mouse, touch and keyboard: moving the view, selecting things and driving.

export function setupControls(app) {
  const { scene } = app;
  const el = scene.renderer.domElement;
  const keys = new Set();
  const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

  // ------------------------------------------------------------- pointer
  const pointers = new Map();
  let drag = null, pinch = null;

  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, rotate: e.button === 2 || e.shiftKey };
    } else if (pointers.size === 2) {
      drag = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  });
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
      scene.zoomBy(d / pinch.d, mx, my);
      scene.pan(mx - pinch.mx, my - pinch.my);
      let da = ang - pinch.ang; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < 0.5) scene.rotateBy(-da);
      pinch = { d, mx, my, ang };
      app.follow = false;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.moved) {
      if (drag.rotate) scene.rotateBy(-dx * 0.008);
      else { scene.pan(dx, dy); app.follow = false; }
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && pointers.size === 0) app.select(scene.pick(e.clientX, e.clientY));
    if (pointers.size === 0) drag = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); drag = null; pinch = null; });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    scene.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX, e.clientY);
  }, { passive: false });

  // ------------------------------------------------------------ keyboard
  const DRIVE = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 'f'];
  addEventListener('keydown', e => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (DRIVE.includes(k)) {
      e.preventDefault();
      keys.add(k);
      app.takeControl();
      return;
    }
    if (k === ' ') { e.preventDefault(); app.action(); return; }
    if (k === 'escape') { app.select(null); return; }
    if (k === 'tab') { e.preventDefault(); app.cycle(e.shiftKey ? -1 : 1); return; }
    if (k === 'q') scene.rotateStep(-1);
    if (k === 'e') scene.rotateStep(1);
    if (k === 'h') { app.follow = false; scene.resetView(); }
    if (k === 'c') app.toggleFollow();
    if (k === 'v') app.toggleCameras();
    if (k === '/' ) { e.preventDefault(); document.getElementById('q').focus(); }
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  // ---------------------------------------------------- touch joystick
  const joy = document.getElementById('joy'), knob = joy.querySelector('i');
  const touchInput = { throttle: 0, steer: 0, fork: 0 };
  let joyId = null;
  const joyMove = e => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 14, d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touchInput.throttle = -dy / max;
    touchInput.steer = dx / max;
    if (Math.abs(touchInput.throttle) < 0.12) touchInput.throttle = 0;
    if (Math.abs(touchInput.steer) < 0.12) touchInput.steer = 0;
  };
  joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); app.takeControl(); joyMove(e); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; knob.style.transform = ''; touchInput.throttle = touchInput.steer = 0; };
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
  const hold = (id, v) => {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', e => { e.preventDefault(); app.takeControl(); touchInput.fork = v; });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { if (touchInput.fork === v) touchInput.fork = 0; });
  };
  hold('tUp', 1); hold('tDown', -1);
  document.getElementById('tAct').addEventListener('click', () => app.action());

  // Called every frame: current driving input.
  return {
    input() {
      const has = (...ks) => ks.some(k => keys.has(k));
      const kb = {
        throttle: (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0),
        steer: (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0),
        fork: (has('r') ? 1 : 0) - (has('f') ? 1 : 0),
      };
      return {
        throttle: kb.throttle || touchInput.throttle,
        steer: kb.steer || touchInput.steer,
        fork: kb.fork || touchInput.fork,
      };
    },
  };
}
