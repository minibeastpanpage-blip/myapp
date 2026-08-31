/**
 * ai.js — "KE-1" autoplay engine.
 *
 * Three-stage shot search, the same recipe the aim-bot engines use:
 *
 *  1. GEOMETRY — for every (own coin × pocket) pair, solve the contact
 *     equation: the striker must arrive at the ghost-contact point so the
 *     impact normal points at the pocket. Sweep the striker position along
 *     the baseline, keep shots with a make-able cut angle, clear striker
 *     path and clear coin path, and size the launch speed from friction.
 *
 *  2. SIMULATION — every candidate is rolled forward through the *same*
 *     deterministic physics the live board uses; the resulting position is
 *     scored with a rules-aware evaluation (pots, fouls, queen logic, leave).
 *
 *  3. REFINEMENT — the best survivors get Gaussian perturbations around
 *     angle / power / placement and are re-simulated, hill-climbing to the
 *     final shot. Monte-Carlo samples are mixed in to discover rebounds and
 *     combination shots the geometry stage can't express.
 *
 * The chosen shot is re-simulated once with trajectory recording, which is
 * what gets drawn as the guideline overlay.
 */
import { B, clonePiece, makeStriker, stepWorld, sweepCorner } from './physics.js';
import { clearPath, clamp, placementClear } from './geo.js';
import { baselineY, findStrikerX } from './rules.js';

const TRANSFER = 1.41;   // (1+e)·m_s/(m_s+m_c): striker→coin speed transfer
const A_EST = 265;       // friction estimate for speed sizing (slightly hot)
const POCKET_NAMES = ['TL', 'TR', 'BL', 'BR'];

function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

function pocketProx(x, y) {
  let d = Infinity;
  for (const pk of B.POCKETS) d = Math.min(d, Math.hypot(x - pk.x, y - pk.y));
  return clamp(1 - (d - B.HOLE_R) / 26, 0, 1);
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

function simulateShot(game, cand, record = false) {
  const meIdx = game.turn;
  const me = game.players[meIdx];
  const myColor = me.color;
  const oppColor = myColor === 'white' ? 'black' : 'white';
  const by = baselineY(myColor);

  // Clone the live board (coins only; striker doesn't exist yet).
  const pieces = game.pieces.filter(p => p.active && p.kind === 'coin').map(clonePiece);

  // Striker placement, nudged exactly like the real game will nudge it.
  const sx = findStrikerX(pieces, cand.x, by);
  if (sx === null) return null;
  const st = makeStriker(sx, by);
  st.vx = Math.cos(cand.angle) * cand.v;
  st.vy = Math.sin(cand.angle) * cand.v;
  pieces.push(st);

  const ev = { pockets: [], hits: [] };
  const traj = record ? { entries: [], step: 0, byId: new Map() } : null;
  let t = 0;
  for (;;) {
    const settled = stepWorld(pieces, 1 / 120, ev);
    t += 1 / 120;
    if (traj && (traj.step++ % 2) === 0) recordTraj(traj, pieces);
    if (settled || t > 11) break;
  }
  sweepCorner(pieces, ev);
  if (traj) finalizeTraj(traj, ev);

  const score = scoreOutcome(game, meIdx, myColor, oppColor,
                             ev.pockets.map(e => e.piece), pieces);
  return { score, pieces, pockets: ev.pockets, trajectory: traj };
}

function recordTraj(traj, pieces) {
  for (const p of pieces) {
    if (!p.active) continue;
    let e = traj.byId.get(p.id);
    if (!e) {
      e = { id: p.id, color: p.color, kind: p.kind, pts: [], end: 'rest', pocket: -1 };
      traj.byId.set(p.id, e);
      traj.entries.push(e);
    }
    e.pts.push(p.x, p.y);
  }
}

function finalizeTraj(traj, ev) {
  for (const e of traj.entries) {
    const hit = ev.pockets.find(x => x.piece.id === e.id);
    if (hit) { e.end = 'pocket'; e.pocket = hit.pocket; }
  }
}

/* ------------------------------------------------------------------ */
/* Rules-aware evaluation of a simulated outcome                       */
/* ------------------------------------------------------------------ */

function scoreOutcome(game, meIdx, myColor, oppColor, pocketed, finalPieces) {
  let ownP = 0, oppP = 0, queenIn = false, strikerIn = false;
  for (const p of pocketed) {
    if (p.kind === 'striker') strikerIn = true;
    else if (p.color === 'queen') queenIn = true;
    else if (p.color === myColor) ownP++;
    else oppP++;
  }

  const myBefore = game.pieces.filter(p => p.active && p.kind === 'coin' && p.color === myColor).length;
  const oppBefore = game.pieces.filter(p => p.active && p.kind === 'coin' && p.color === oppColor).length;
  const myAfter = myBefore - ownP;
  const oppAfter = oppBefore - oppP;
  const queenBankedBefore = game.queenBankedBy !== null;

  let score = 0;

  // Cover a pending queen with this shot → big.
  if (!queenIn && game.queenPending === meIdx && ownP > 0) score += 26;
  // Pocketing the queen: covered now (great) or pending (mild).
  if (queenIn) score += ownP > 0 ? 28 : 9;

  let effOwn = ownP;
  // Last-coin-before-queen foul: coin comes back.
  if (ownP > 0 && myAfter === 0 && !queenBankedBefore && !(queenIn && ownP > 0)) {
    effOwn = ownP - 1;
    score -= 18;
  }

  score += 13 * effOwn;
  score -= 7 * oppP;

  if (oppP > 0 && oppAfter === 0) score -= 400;      // gift the opponent the board
  if (ownP > 0 && myAfter === 0 && effOwn === ownP) score += 400; // win
  if (strikerIn) score -= 16;
  if (effOwn > 0 && !strikerIn) score += 5;          // keep shooting
  if (ownP === 0 && oppP === 0 && !queenIn) score -= 1.5; // tempo

  // Positional value of the leave.
  for (const p of finalPieces) {
    if (!p.active || p.kind !== 'coin') continue;
    const prox = pocketProx(p.x, p.y);
    if (p.color === myColor) score += 0.8 * prox;          // my coins near holes: good
    else if (p.color === oppColor) score -= 0.6 * prox;    // theirs near holes: bad
    else if (p.color === 'queen' && !queenBankedBefore) score += 0.7 * prox;
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

function geometricCandidates(game, targets) {
  const myColor = game.players[game.turn].color;
  const by = baselineY(myColor);
  const cands = [];
  const xs = [];
  for (let x = -B.BASE_X; x <= B.BASE_X + 1e-9; x += B.BASE_X / 14) xs.push(x);

  for (const t of targets) {
    for (let pi = 0; pi < 4; pi++) {
      const pk = B.POCKETS[pi];
      const dx = pk.x - t.x, dy = pk.y - t.y;
      const dC = Math.hypot(dx, dy);
      if (dC < 1) continue;
      const ux = dx / dC, uy = dy / dC;
      // Ghost-contact point: striker centre at the moment of impact.
      const cx = t.x - ux * (B.COIN_R + B.STRIKER_R);
      const cy = t.y - uy * (B.COIN_R + B.STRIKER_R);

      for (const sx0 of xs) {
        if (!placementClear(game.pieces, sx0, by, B.STRIKER_R)) continue;
        const ax = cx - sx0, ay = cy - by;
        const dS = Math.hypot(ax, ay);
        if (dS < 0.5) continue;
        const adx = ax / dS, ady = ay / dS;
        const cut = Math.acos(clamp(adx * ux + ady * uy, -1, 1));
        if (cut > 1.22) continue; // > ~70°: too thin to transfer energy
        if (!clearPath(game.pieces, sx0, by, cx, cy, B.STRIKER_R, new Set([t.id]))) continue;
        if (!clearPath(game.pieces, t.x, t.y, pk.x, pk.y, B.COIN_R, new Set([t.id]))) continue;

        const vCoin = Math.sqrt(2 * A_EST * (dC + 8)) + 14;
        const vImp = vCoin / Math.max(0.18, TRANSFER * Math.cos(cut));
        if (vImp > 480) continue;
        let v = Math.sqrt(vImp * vImp + 2 * A_EST * dS);
        v = clamp(v, 100, B.V_MAX);

        cands.push({ x: sx0, angle: Math.atan2(ady, adx), v, cut, kind: 'geo',
                     target: t.id, pocket: pi, dC, dS,
                     h: cut * 10 + dC * 0.05 + dS * 0.03 });
      }
    }
  }
  cands.sort((a, b) => a.h - b.h);
  return cands;
}

function monteCarloCandidates(game, targets, n) {
  const myColor = game.players[game.turn].color;
  const by = baselineY(myColor);
  const cands = [];
  for (let i = 0; i < n; i++) {
    let sx = (Math.random() * 2 - 1) * B.BASE_X;
    let ok = placementClear(game.pieces, sx, by, B.STRIKER_R);
    for (let k = 0; k < 5 && !ok; k++) {
      sx = (Math.random() * 2 - 1) * B.BASE_X;
      ok = placementClear(game.pieces, sx, by, B.STRIKER_R);
    }
    if (!ok) continue;
    let angle;
    if (Math.random() < 0.72 && targets.length) {
      const t = targets[(Math.random() * targets.length) | 0];
      angle = Math.atan2(t.y - by, t.x - sx) + gauss() * 0.16;
    } else {
      angle = Math.random() * Math.PI * 2;
    }
    const v = 130 + Math.random() * 330;
    cands.push({ x: sx, angle, v, cut: -1, kind: 'mc', target: null, pocket: -1, h: 99 });
  }
  return cands;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Compute the engine's chosen shot for the player to move.
 * Returns { shot, score, evals, ms, desc, trajectory }.
 */
export function computeBestShot(game, opts = {}) {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 700;
  const meIdx = game.turn;
  const myColor = game.players[meIdx].color;

  const coins = game.pieces.filter(p => p.active && p.kind === 'coin');
  const targets = coins.filter(c => c.color === myColor ||
    (c.color === 'queen' && game.queenBankedBy === null));

  const geo = geometricCandidates(game, targets);
  const mc = monteCarloCandidates(game, targets, 130);
  const queue = [...geo, ...mc];

  const results = [];
  let evals = 0;
  const evaluate = (c) => {
    const out = simulateShot(game, c);
    if (!out) return -Infinity;
    results.push({ c, s: out.score });
    evals++;
    return out.score;
  };

  for (const c of queue) {
    if (evals > 60 && Date.now() - t0 > budget) break;
    evaluate(c);
  }

  // Local refinement around the survivors.
  const refine = (pool, nPert, dAng, dV, dX) => {
    for (const r of pool) {
      for (let i = 0; i < nPert; i++) {
        if (evals > 100 && Date.now() - t0 > budget * 1.7) return;
        const nx = clamp(r.c.x + gauss() * dX, -B.BASE_X, B.BASE_X);
        if (!placementClear(game.pieces, nx, baselineY(myColor), B.STRIKER_R)) continue;
        evaluate({
          x: nx,
          angle: r.c.angle + gauss() * dAng,
          v: clamp(r.c.v * (1 + gauss() * dV), 90, B.V_MAX),
          cut: r.c.cut, kind: 'ref', target: r.c.target, pocket: r.c.pocket,
        });
      }
    }
  };
  results.sort((a, b) => b.s - a.s);
  refine(results.slice(0, 6), 9, 0.02, 0.06, 1.4);
  results.sort((a, b) => b.s - a.s);
  refine(results.slice(0, 3), 8, 0.008, 0.03, 0.7);
  results.sort((a, b) => b.s - a.s);

  if (!results.length) {
    // Board is so blocked nothing simulated — tap gently forward.
    const fallback = { x: 0, angle: myColor === 'white' ? -Math.PI / 2 : Math.PI / 2,
                       v: 200, kind: 'fallback' };
    return { shot: fallback, score: 0, evals, ms: Date.now() - t0,
             desc: 'fallback tap', trajectory: null };
  }

  const best = results[0];
  const final = simulateShot(game, best.c, true) ?? { trajectory: null };
  return {
    shot: best.c,
    score: best.s,
    evals,
    ms: Date.now() - t0,
    desc: describe(best.c),
    trajectory: final.trajectory,
  };
}

function describe(c) {
  const pwr = Math.round(((c.v - B.V_MIN) / (B.V_MAX - B.V_MIN)) * 100);
  if (c.kind === 'geo' || (c.kind === 'ref' && c.target)) {
    const cut = c.cut >= 0 ? ` · cut ${Math.round((c.cut * 180) / Math.PI)}°` : '';
    return `${c.target ?? '?'} → ${POCKET_NAMES[c.pocket] ?? '?'}${cut} · pwr ${Math.max(0, pwr)}%`;
  }
  return `search shot · pwr ${Math.max(0, pwr)}%`;
}
