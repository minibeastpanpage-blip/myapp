/**
 * physics.js — deterministic carrom physics core.
 *
 * Units: centimetres and seconds. Origin at the centre of the playing
 * surface, +x → right, +y → down (matches screen space).
 *
 * The step function is pure with respect to the piece list, so the AI can
 * clone a game state and roll it forward with bit-identical results to the
 * live animation. That determinism is what makes the "guideline" overlay
 * exact.
 */

export const B = {
  HALF: 37,          // playing surface half-width (74 cm board)
  COIN_R: 1.59,      // carrom man radius (3.18 cm dia)
  STRIKER_R: 2.065,  // striker radius (4.13 cm dia)
  HOLE_R: 2.25,      // pocket radius (4.5 cm dia), tangent to walls
  CAPTURE_R: 2.02,  // centre-of-mass distance at which a piece drops
  OUTER: 38.6,       // hard safety bound (pieces can only exceed walls near pockets)
  MASS_COIN: 1,
  MASS_STRIKER: 2.7, // ~15 g striker vs ~5.5 g carrom man
  E_COIN: 0.87,      // coin↔coin restitution
  E_WALL: 0.60,      // wall restitution
  T_WALL: 0.96,      // wall tangential retention
  FR_A: 245,         // constant sliding deceleration (cm/s²)
  FR_K: 0.42,        // velocity-proportional damping (1/s)
  STOP_V: 4.5,       // below this speed a piece is considered at rest
  V_MIN: 60,
  V_MAX: 470,
  BASE_Y: 30.1,      // striker baseline distance from centre
  BASE_X: 22.2,      // striker baseline half-length
  POCKETS: [
    { x: -34.75, y: -34.75 }, // TL
    { x: 34.75, y: -34.75 },  // TR
    { x: -34.75, y: 34.75 },  // BL
    { x: 34.75, y: 34.75 },   // BR
  ],
};

export function makeCoin(id, color, x, y) {
  return { id, kind: 'coin', color, x, y, vx: 0, vy: 0,
           r: B.COIN_R, mass: B.MASS_COIN, active: true, pocket: -1 };
}

export function makeStriker(x, y) {
  return { id: 'striker', kind: 'striker', color: 'striker', x, y, vx: 0, vy: 0,
           r: B.STRIKER_R, mass: B.MASS_STRIKER, active: true, pocket: -1 };
}

export function clonePiece(p) {
  return { id: p.id, kind: p.kind, color: p.color, x: p.x, y: p.y,
           vx: p.vx, vy: p.vy, r: p.r, mass: p.mass, active: p.active, pocket: p.pocket };
}

/** Advance the world by dt. Returns true when everything is at rest. */
export function stepWorld(pieces, dt, ev) {
  let vmax = 0;
  for (const p of pieces) {
    if (!p.active) continue;
    const s = Math.hypot(p.vx, p.vy);
    if (s > vmax) vmax = s;
  }
  if (vmax === 0) return true;

  // Substep so no piece moves more than 0.45 cm per substep (anti-tunnelling).
  const n = Math.max(1, Math.ceil((vmax * dt) / 0.45));
  const h = dt / n;
  for (let k = 0; k < n; k++) substep(pieces, h, ev);

  for (const p of pieces) {
    if (p.active && (p.vx !== 0 || p.vy !== 0)) return false;
  }
  return true;
}

function substep(pieces, h, ev) {
  // Integrate + friction.
  for (const p of pieces) {
    if (!p.active || (p.vx === 0 && p.vy === 0)) continue;
    p.x += p.vx * h;
    p.y += p.vy * h;
    const sp = Math.hypot(p.vx, p.vy);
    const ns = sp - (B.FR_A + B.FR_K * sp) * h;
    if (ns < B.STOP_V) { p.vx = 0; p.vy = 0; }
    else { const f = ns / sp; p.vx *= f; p.vy *= f; }
  }

  // Walls (skipped inside a pocket's mouth so pieces can enter the corner).
  for (const p of pieces) {
    if (!p.active) continue;
    const lim = B.HALF - p.r;
    const nearHole = nearestPocketDist2(p) < (B.HOLE_R + p.r + 0.8) ** 2;
    if (!nearHole) {
      if (p.x > lim)      { p.x = lim;  if (p.vx > 0) { wallHit(ev, p.vx); p.vx = -p.vx * B.E_WALL; p.vy *= B.T_WALL; } }
      else if (p.x < -lim){ p.x = -lim; if (p.vx < 0) { wallHit(ev, -p.vx); p.vx = -p.vx * B.E_WALL; p.vy *= B.T_WALL; } }
      if (p.y > lim)      { p.y = lim;  if (p.vy > 0) { wallHit(ev, p.vy); p.vy = -p.vy * B.E_WALL; p.vx *= B.T_WALL; } }
      else if (p.y < -lim){ p.y = -lim; if (p.vy < 0) { wallHit(ev, -p.vy); p.vy = -p.vy * B.E_WALL; p.vx *= B.T_WALL; } }
    }
    // Hard outer bound (only reachable inside a pocket mouth).
    const o = B.OUTER;
    if (p.x > o)  { p.x = o;  p.vx = -Math.abs(p.vx) * 0.4; }
    if (p.x < -o) { p.x = -o; p.vx = Math.abs(p.vx) * 0.4; }
    if (p.y > o)  { p.y = o;  p.vy = -Math.abs(p.vy) * 0.4; }
    if (p.y < -o) { p.y = -o; p.vy = Math.abs(p.vy) * 0.4; }
  }

  // Pocket capture: centre of mass over the hole → it drops.
  const cap2 = B.CAPTURE_R * B.CAPTURE_R;
  for (const p of pieces) {
    if (!p.active) continue;
    for (let i = 0; i < 4; i++) {
      const pk = B.POCKETS[i];
      const dx = p.x - pk.x, dy = p.y - pk.y;
      if (dx * dx + dy * dy < cap2) {
        p.active = false; p.vx = 0; p.vy = 0; p.pocket = i;
        ev?.pockets?.push({ piece: p, pocket: i });
        break;
      }
    }
  }

  // Pairwise collisions (impulse + positional separation).
  const n = pieces.length;
  for (let i = 0; i < n; i++) {
    const a = pieces[i];
    if (!a.active) continue;
    for (let j = i + 1; j < n; j++) {
      const b = pieces[j];
      if (!b.active) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rs = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rs * rs) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-6) { nx = 1; ny = 0; d = 1e-6; } else { nx = dx / d; ny = dy / d; }
      const ima = 1 / a.mass, imb = 1 / b.mass, ims = ima + imb;
      const overlap = rs - d;
      a.x -= nx * overlap * (ima / ims); a.y -= ny * overlap * (ima / ims);
      b.x += nx * overlap * (imb / ims); b.y += ny * overlap * (imb / ims);
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rvn < 0) {
        const jimp = -(1 + B.E_COIN) * rvn / ims;
        a.vx -= jimp * nx * ima; a.vy -= jimp * ny * ima;
        b.vx += jimp * nx * imb; b.vy += jimp * ny * imb;
        ev?.hits?.push({ t: 'coin', m: Math.abs(jimp) });
      }
    }
  }
}

function wallHit(ev, mag) { ev?.hits?.push({ t: 'wall', m: Math.abs(mag) }); }

function nearestPocketDist2(p) {
  let best = Infinity;
  for (const pk of B.POCKETS) {
    const dx = p.x - pk.x, dy = p.y - pk.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * A piece that came to rest outside the wall line must be sitting in a
 * pocket mouth — pocket it (prevents ugly "resting on the frame" states).
 */
export function sweepCorner(pieces, ev) {
  for (const p of pieces) {
    if (!p.active) continue;
    const lim = B.HALF - p.r + 0.3;
    if (p.x > -lim && p.x < lim && p.y > -lim && p.y < lim) continue;
    // nearest pocket
    let bi = 0, bd = Infinity;
    for (let i = 0; i < 4; i++) {
      const pk = B.POCKETS[i];
      const d2 = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    p.active = false; p.vx = 0; p.vy = 0; p.pocket = bi;
    ev?.pockets?.push({ piece: p, pocket: bi });
  }
}

export function isSettled(pieces) {
  for (const p of pieces) if (p.active && (p.vx !== 0 || p.vy !== 0)) return false;
  return true;
}
