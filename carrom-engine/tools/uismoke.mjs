/**
 * uismoke.mjs — run the real app (main.js) against a minimal DOM/canvas mock
 * and drive it through a full autoplayed game at ∞ speed. Catches wiring and
 * runtime errors that a pure engine test can't.
 */
const rafQueue = [];
const els = {};

function makeCtx() {
  const gradient = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'canvas') return els['board'];
      if (!(prop in t)) t[prop] = () => gradient;
      return t[prop];
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

function makeEl(id) {
  const el = {
    id, children: [], style: {}, dataset: {}, listeners: {},
    _innerHTML: '', _textContent: '',
    set innerHTML(v) { this._innerHTML = v; this.children = []; },
    get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._textContent = String(v); },
    get textContent() { return this._textContent; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    appendChild(c) { this.children.push(c); },
    classList: { toggle() {}, add() {}, remove() {} },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 700, height: 700 }; },
    parentElement: null,
    clientWidth: 700, clientHeight: 700,
    disabled: false, checked: true,
    width: 700, height: 700,
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); },
  };
  return el;
}

// --- globals the app expects ---
globalThis.window = {
  addEventListener(type, fn) { (globalThis.__win ??= {}); (globalThis.__win[type] ??= []).push(fn); },
  devicePixelRatio: 1,
};
globalThis.performance = globalThis.performance;
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
globalThis.document = {
  getElementById(id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  createElement: () => makeEl(),
};

// canvas specifics
els['board'] = makeEl('board');
els['board'].getContext = () => makeCtx();
els['board'].parentElement = { clientWidth: 680, clientHeight: 680 };

// speed segment buttons
{
  const seg = (globalThis.document.getElementById('speedSeg'));
  seg.children = ['0.5', '1', '2', '4', '1e9'].map((s) => {
    const b = makeEl('spd-' + s);
    b.dataset.s = s;
    b.closest = function () { return this; };
    return b;
  });
}

// --- load the app ---
await import('../js/main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vt = 0;
async function pump(frames, gapMs = 1) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue.splice(0);
    vt += 16.7;
    for (const cb of q) cb(vt);
    if (gapMs) await sleep(gapMs);
  }
}

// initial paint + let the first think timer fire
await pump(3, 50);
await sleep(800);

// switch to ∞ speed via the real click handler
const seg = els['speedSeg'];
const infBtn = seg.children[seg.children.length - 1];
seg.listeners.click[0]({ target: infBtn });

// drive the game
let frames = 0;
const t0 = Date.now();
while (frames < 20000 && Date.now() - t0 < 25000) {
  await pump(3, 1);
  frames += 3;
  const turnText = els['turnText'] ? els['turnText']._textContent : '';
  if (turnText.includes('wins')) break;
}

const turn = els['turnText']._textContent;
const logCount = els['logList'].children.length;
console.log('--- UI smoke result ---');
console.log('turnText   :', turn);
console.log('phaseText  :', els['phaseText']._textContent);
console.log('score W/B  :', els['scoreWhite']._textContent, '/', els['scoreBlack']._textContent);
console.log('queen      :', els['queenState']._textContent);
console.log('statDesc   :', els['statDesc']._textContent);
console.log('log entries:', logCount);
console.log('frames     :', frames);

if (!turn.includes('wins')) {
  console.log('⚠ game did not finish in the UI harness');
  process.exitCode = 1;
} else {
  console.log('✓ full autoplayed game completed through the real UI pipeline');
}

/* ---- phase 2: new game + manual turn + hint + engine shot ---- */
els['btnNew'].click();
await sleep(50);
await pump(3, 1);

// hand the human a turn: autoplay off for both
els['apWhite'].listeners.change[0]({ target: { checked: false } });
els['apBlack'].listeners.change[0]({ target: { checked: false } });
await pump(2, 1);

// human places striker + drags: simulate pointer events on canvas
const board = els['board'];
const fire = (type, ev) => (board.listeners[type] || []).forEach((fn) => fn(ev));
const ptr = (x, y) => ({
  clientX: 350 + x * 8, clientY: 350 + y * 8,
});
fire('pointermove', ptr(0, 30));          // hover baseline
fire('pointerdown', ptr(0, 30));          // place striker
fire('pointerdown', ptr(0, 30));          // grab the striker (near it → drag)
fire('pointermove', ptr(3, 5));           // pull back/down-right
(globalThis.__win.pointerup || []).forEach((fn) => fn({}));
await pump(5, 1);
const phaseAfterShot = els['phaseText']._textContent;
console.log('after human shot:', phaseAfterShot);
if (!/settling|place|autoplay|baseline|drag/.test(phaseAfterShot)) {
  console.log('⚠ unexpected phase after human shot');
  process.exitCode = 1;
}

// next human turn: ask for a hint, then let the engine shoot
if (!els['turnText']._textContent.includes('wins')) {
  els['btnHint'].click();
  await sleep(1500);
  await pump(2, 1);
  const hintDesc = els['statDesc']._textContent;
  console.log('hint desc   :', hintDesc);
  if (hintDesc === '–' || !hintDesc) { console.log('⚠ hint produced no description'); process.exitCode = 1; }

  els['btnShoot'].click();
  await sleep(2000);
  await pump(10, 1);
  console.log('after engine shot:', els['phaseText']._textContent);
}
console.log('✓ phase 2 (new game / manual input / hint / engine shot) survived');
