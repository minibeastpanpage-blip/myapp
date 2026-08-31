/**
 * main.js — app controller: game loop, turn orchestration, input, panel.
 */
import { B, stepWorld, sweepCorner } from './engine/physics.js';
import { newGame, placeStriker, removeStriker, shoot, resolveShot, findStrikerX, baselineY } from './engine/rules.js';
import { computeBestShot } from './engine/ai.js';
import { clamp } from './engine/geo.js';
import { Renderer } from './ui/render.js';
import { Sfx } from './ui/audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const renderer = new Renderer(canvas);
const sfx = new Sfx();

const app = {
  game: newGame(),
  autoplay: { white: true, black: true },
  speed: 1,
  lines: true,
  perfect: false,      // true = shots execute with zero wobble (bot mode)
  plan: null,          // engine plan for the upcoming/current shot
  thinking: false,
  placedPiece: null,   // human-placed striker
  ghostLegal: false,
  aim: null,           // { dir:[x,y], power, dragging }
  mouse: { x: 0, y: 0, onBoard: false },
  anim: { steps: 0 },
  timers: [],
};

function after(ms, fn) {
  const id = setTimeout(fn, ms);
  app.timers.push(id);
  return id;
}
function clearTimers() { app.timers.forEach(clearTimeout); app.timers = []; }
function delayScale(ms) { return app.speed >= 1e6 ? 0 : ms / clamp(app.speed, 0.5, 4); }

const isAuto = () => app.autoplay[app.game.players[app.game.turn].color];
const isHumanTurn = () => app.game.phase === 'place' && !isAuto();

/* ------------------------------------------------------------------ */
/* Turn orchestration                                                  */
/* ------------------------------------------------------------------ */

function scheduleTurn() {
  if (app.game.phase !== 'place' || app.game.over) return;
  if (isAuto()) startThink();
  else updatePanel();
}

function startThink() {
  if (app.thinking) return;
  app.thinking = true;
  app.plan = null;
  updatePanel();
  after(delayScale(220), () => {
    if (app.game.phase !== 'place' || !isAuto()) { app.thinking = false; updatePanel(); return; }
    const color = app.game.players[app.game.turn].color;
    const plan = computeBestShot(app.game);
    plan.shotColor = color;
    app.plan = plan;
    app.thinking = false;
    updatePanel();
    after(delayScale(560), () => {
      if (app.game.phase !== 'place' || !isAuto()) return;
      executeShot(plan.shot);
    });
  });
}

function executeShot(shot) {
  app.placedPiece = null;
  app.aim = null;
  const st = placeStriker(app.game, shot.x);
  if (!st) { // should not happen — engine validated placement
    app.game.turn = 1 - app.game.turn;
    updatePanel();
    after(delayScale(300), scheduleTurn);
    return;
  }
  sfx.ensure();
  sfx.shoot(clamp((shot.v - B.V_MIN) / (B.V_MAX - B.V_MIN), 0, 1));
  shoot(app.game, shot.angle, shot.v, !app.perfect);
  app.anim.steps = 0;
  updatePanel();
}

function humanShoot(angle, v) {
  if (!app.placedPiece) return;
  sfx.ensure();
  sfx.shoot(clamp((v - B.V_MIN) / (B.V_MAX - B.V_MIN), 0, 1));
  app.plan = null;
  app.aim = null;
  app.placedPiece = null;
  shoot(app.game, angle, v, !app.perfect);
  app.anim.steps = 0;
  updatePanel();
}

function finishShot() {
  sweepCorner(app.game.pieces, { pockets: [] });
  const res = resolveShot(app.game);
  app.plan = null;
  updatePanel();
  if (app.game.over) return;
  after(delayScale(420), scheduleTurn);
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

let lastT = 0;
function tick(t) {
  const dtMs = Math.min(50, t - lastT || 16);
  lastT = t;

  if (app.game.phase === 'anim') {
    const perFrame = app.speed >= 1e6 ? 1e9 : Math.max(1, Math.round(2 * app.speed));
    for (let i = 0; i < perFrame; i++) {
      const ev = { pockets: [], hits: [] };
      const settled = stepWorld(app.game.pieces, 1 / 120, ev);
      app.anim.steps++;
      for (const h of ev.hits) sfx.hit(h.m);
      for (const e of ev.pockets) sfx.pocket();
      if (settled) { finishShot(); break; }
    }
  }

  renderer.draw(app, dtMs);
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  const [x, y] = renderer.s2w(e.clientX - r.left, e.clientY - r.top);
  return { x, y };
}

canvas.addEventListener('pointermove', (e) => {
  const w = toWorld(e);
  app.mouse.x = w.x; app.mouse.y = w.y; app.mouse.onBoard = true;
  if (!isHumanTurn()) return;
  const color = app.game.players[app.game.turn].color;
  const by = baselineY(color);
  if (!app.placedPiece) {
    app.ghostLegal = findStrikerX(app.game.pieces, clamp(w.x, -B.BASE_X, B.BASE_X), by) !== null;
    return;
  }
  if (app.aim?.dragging) {
    const st = app.placedPiece;
    const dx = st.x - w.x, dy = st.y - w.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.8) {
      app.aim.dir = [dx / len, dy / len];
      app.aim.power = clamp(len / 26, 0.05, 1);
    } else {
      app.aim.dir = null;
      app.aim.power = 0;
    }
  } else {
    const st = app.placedPiece;
    const dx = w.x - st.x, dy = w.y - st.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.5) app.aim = { dir: [dx / len, dy / len], power: 0, dragging: false };
  }
});

canvas.addEventListener('pointerleave', () => { app.mouse.onBoard = false; });

canvas.addEventListener('pointerdown', (e) => {
  sfx.ensure();
  if (!isHumanTurn()) return;
  const w = toWorld(e);
  app.mouse.x = w.x; app.mouse.y = w.y; app.mouse.onBoard = true;
  const color = app.game.players[app.game.turn].color;
  const by = baselineY(color);

  if (!app.placedPiece) {
    const st = placeStriker(app.game, clamp(w.x, -B.BASE_X, B.BASE_X));
    if (st) {
      app.placedPiece = st;
      app.aim = null;
      updatePanel();
    }
    return;
  }
  const st = app.placedPiece;
  if (Math.hypot(w.x - st.x, w.y - st.y) < 5.5) {
    app.aim = { dir: null, power: 0, dragging: true };
  } else {
    // re-place from a different spot
    removeStriker(app.game);
    const ns = placeStriker(app.game, clamp(w.x, -B.BASE_X, B.BASE_X));
    app.placedPiece = ns;
    app.aim = null;
    updatePanel();
  }
});

window.addEventListener('pointerup', (e) => {
  if (app.aim?.dragging && isHumanTurn() && app.placedPiece) {
    const dir = app.aim.dir;
    const power = app.aim.power ?? 0;
    if (dir && power > 0.06) {
      const v = B.V_MIN + power * (B.V_MAX - B.V_MIN);
      humanShoot(Math.atan2(dir[1], dir[0]), v);
      return;
    }
    app.aim = { dir: null, power: 0, dragging: false };
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') newGameUi();
  else if (e.key === 'h' || e.key === 'H') hint();
  else if (e.key === 'e' || e.key === 'E') engineShot();
  else if (e.key === 'Escape' && app.placedPiece && isHumanTurn()) {
    removeStriker(app.game);
    app.placedPiece = null;
    app.aim = null;
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isHumanTurn()) {
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (!app.placedPiece) {
      const st = placeStriker(app.game, clamp(app.mouse.x + dir * 0.001, -B.BASE_X, B.BASE_X));
      if (st) { app.placedPiece = st; updatePanel(); }
    } else {
      const st = app.placedPiece;
      removeStriker(app.game);
      const ns = placeStriker(app.game, st.x + dir * 0.6);
      app.placedPiece = ns ?? placeStriker(app.game, st.x);
      updatePanel();
    }
  }
});

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

function updatePanel() {
  const g = app.game;
  $('scoreWhite').textContent = g.players[0].banked.length;
  $('scoreBlack').textContent = g.players[1].banked.length;
  $('queenState').textContent =
    g.queenBankedBy !== null ? `covered by ${g.players[g.queenBankedBy].name}`
    : g.queenPending !== null ? `pending cover — ${g.players[g.queenPending].name}`
    : 'on board';

  const p = g.players[g.turn];
  $('turnText').textContent = g.over
    ? `${g.players[g.over.winner].name} wins — ${g.over.reason}`
    : `${p.name} to shoot`;

  const ph = $('phaseText');
  ph.classList.toggle('thinking', app.thinking);
  if (g.over) ph.textContent = 'game over — press New Game';
  else if (g.phase === 'anim') ph.textContent = 'board settling…';
  else if (app.thinking) ph.textContent = 'KE-1 searching for a shot…';
  else if (isAuto()) ph.textContent = 'autoplay enabled';
  else if (!app.placedPiece) ph.textContent = 'place the striker on your baseline';
  else ph.textContent = 'drag back from the striker & release';

  const plan = app.plan;
  $('statEvals').textContent = plan ? plan.evals : '–';
  $('statTime').textContent = plan ? `${plan.ms} ms` : '–';
  $('statScore').textContent = plan ? plan.score.toFixed(1) : '–';
  $('statDesc').textContent = plan ? plan.desc : '–';

  $('btnHint').disabled = !isHumanTurn() || app.thinking;
  $('btnShoot').disabled = !isHumanTurn() || app.thinking;

  const log = $('logList');
  log.innerHTML = '';
  for (let i = g.log.length - 1; i >= 0 && i > g.log.length - 11; i--) {
    const li = document.createElement('li');
    const e = g.log[i];
    li.innerHTML = `<b>${e.n || '·'}</b>${escapeHtml(e.text)}`;
    log.appendChild(li);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

function newGameUi() {
  clearTimers();
  app.game = newGame();
  app.plan = null;
  app.thinking = false;
  app.placedPiece = null;
  app.aim = null;
  updatePanel();
  after(delayScale(500), scheduleTurn);
}

function hint() {
  if (!isHumanTurn() || app.thinking) return;
  app.thinking = true;
  app.plan = null;
  updatePanel();
  after(30, () => {
    const color = app.game.players[app.game.turn].color;
    const plan = computeBestShot(app.game, { budgetMs: 900 });
    plan.shotColor = color;
    app.plan = plan;
    app.thinking = false;
    updatePanel();
  });
}

function engineShot() {
  if (!isHumanTurn() || app.thinking) return;
  app.thinking = true;
  app.plan = null;
  updatePanel();
  after(30, () => {
    const color = app.game.players[app.game.turn].color;
    const plan = computeBestShot(app.game, { budgetMs: 900 });
    plan.shotColor = color;
    app.plan = plan;
    app.thinking = false;
    if (app.placedPiece) { removeStriker(app.game); app.placedPiece = null; }
    updatePanel();
    after(delayScale(700), () => { if (app.game.phase === 'place') executeShot(plan.shot); });
  });
}

$('btnNew').addEventListener('click', newGameUi);
$('btnHint').addEventListener('click', hint);
$('btnShoot').addEventListener('click', engineShot);

$('apWhite').addEventListener('change', (e) => {
  app.autoplay.white = e.target.checked;
  if (app.game.phase === 'place' && !app.game.over) {
    if (e.target.checked && app.game.players[app.game.turn].color === 'white') {
      if (app.placedPiece) { removeStriker(app.game); app.placedPiece = null; app.aim = null; }
      scheduleTurn();
    } else updatePanel();
  }
});
$('apBlack').addEventListener('change', (e) => {
  app.autoplay.black = e.target.checked;
  if (app.game.phase === 'place' && !app.game.over) {
    if (e.target.checked && app.game.players[app.game.turn].color === 'black') {
      if (app.placedPiece) { removeStriker(app.game); app.placedPiece = null; app.aim = null; }
      scheduleTurn();
    } else updatePanel();
  }
});
$('linesToggle').addEventListener('change', (e) => { app.lines = e.target.checked; });
$('soundToggle').addEventListener('change', (e) => { sfx.enabled = e.target.checked; sfx.ensure(); });
$('perfectToggle').addEventListener('change', (e) => { app.perfect = e.target.checked; });

$('speedSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  app.speed = parseFloat(btn.dataset.s);
  for (const b of $('speedSeg').children) b.classList.toggle('active', b === btn);
});

window.addEventListener('resize', () => renderer.resize());

/* go */
renderer.resize();
updatePanel();
after(600, scheduleTurn);
requestAnimationFrame(tick);
