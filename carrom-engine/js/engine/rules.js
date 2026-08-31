/**
 * rules.js — carrom game state machine.
 *
 * Simplified but faithful freestyle rules:
 *  · White (bottom) vs Black (top). Pocketing your colour keeps your turn.
 *  · Queen (red) must be *covered*: pocket one of your own coins in the same
 *    shot or on your very next shot, otherwise she returns to the centre.
 *  · You may not pocket your last coin while the Queen is still unclaimed —
 *    it comes back and it's a foul.
 *  · Pocketing the striker is a foul: one banked coin returns, turn passes.
 *  · Pocketing the opponent's last coin gifts them the board.
 */
import { B, makeCoin, makeStriker, sweepCorner } from './physics.js';
import { freeSpot, clamp, mulberry32 } from './geo.js';

export function newGame(seed = (Math.random() * 1e9) | 0) {
  const rng = mulberry32(seed);
  const pieces = [];
  const jit = () => (rng() - 0.5) * 0.06;

  pieces.push(makeCoin('Q', 'queen', jit(), jit()));

  let w = 0, b = 0;
  const r1 = 2 * B.COIN_R + 0.03;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const color = i % 2 === 0 ? 'white' : 'black';
    pieces.push(makeCoin(`${color === 'white' ? 'W' : 'B'}${color === 'white' ? ++w : ++b}`,
                          color, Math.cos(a) * r1 + jit(), Math.sin(a) * r1 + jit()));
  }
  const r2 = 4 * B.COIN_R + 0.06;
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + Math.PI / 12 + (i * Math.PI) / 6;
    const color = i % 2 === 0 ? 'black' : 'white';
    pieces.push(makeCoin(`${color === 'white' ? 'W' : 'B'}${color === 'white' ? ++w : ++b}`,
                          color, Math.cos(a) * r2 + jit(), Math.sin(a) * r2 + jit()));
  }

  return {
    pieces,
    players: [
      { name: 'White', color: 'white', banked: [] },
      { name: 'Black', color: 'black', banked: [] },
    ],
    turn: 0,
    phase: 'place',        // 'place' | 'anim' | 'over'
    queenBankedBy: null,   // player index once the queen is covered
    queenPending: null,    // player index that still owes a cover shot
    shotActiveIds: null,   // set by shoot(): ids live when the striker fired
    shotCount: 0,
    over: null,
    log: [{ n: 0, text: 'New game — White breaks.' }],
  };
}

export function baselineY(color) { return color === 'white' ? B.BASE_Y : -B.BASE_Y; }

/** Legal striker x for a desired x (nudged sideways if blocked). Same logic
 *  is used by the AI's simulator so predictions match the real shot. */
export function findStrikerX(pieces, x, by) {
  for (const dx of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8, -2.8, 3.5, -3.5]) {
    const tx = clamp(x + dx, -B.BASE_X, B.BASE_X);
    let ok = true;
    for (const p of pieces) {
      if (!p.active || p.kind === 'striker') continue;
      if (Math.hypot(p.x - tx, p.y - by) < p.r + B.STRIKER_R + 0.03) { ok = false; break; }
    }
    if (ok) return tx;
  }
  return null;
}

export function placeStriker(game, x) {
  if (game.phase !== 'place') return null;
  const by = baselineY(game.players[game.turn].color);
  const tx = findStrikerX(game.pieces, x, by);
  if (tx === null) return null;
  const st = makeStriker(tx, by);
  game.pieces.push(st);
  return st;
}

export function removeStriker(game) {
  game.pieces = game.pieces.filter(p => p.kind !== 'striker');
}

export function shoot(game, angle, v, noise = true) {
  const st = game.pieces.find(p => p.kind === 'striker');
  if (!st) return false;
  let vv = clamp(v, B.V_MIN, B.V_MAX);
  // Execution imprecision: a real flick is never exact. The engine searches
  // with perfect physics, but the board executes with a human wobble.
  if (noise) {
    angle += (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * 0.006;
    vv *= 1 + (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * 0.035;
    vv = clamp(vv, B.V_MIN, B.V_MAX);
  }
  st.vx = Math.cos(angle) * vv;
  st.vy = Math.sin(angle) * vv;
  game.phase = 'anim';
  // Snapshot which pieces are on the board: anything from this set that ends
  // up inactive was pocketed by this shot (robust to how the caller drives
  // the physics loop).
  game.shotActiveIds = new Set(game.pieces.filter(p => p.active).map(p => p.id));
  game.shotCount++;
  return true;
}

function countActive(game, color) {
  let n = 0;
  for (const p of game.pieces) if (p.active && p.kind === 'coin' && p.color === color) n++;
  return n;
}

/** Called after the world settles. Applies rules, advances the turn. */
export function resolveShot(game) {
  const meIdx = game.turn, me = game.players[meIdx], opp = game.players[1 - meIdx];
  const my = me.color, oc = opp.color;
  // Pieces that were live when the striker was fired and are gone now.
  const pocketed = game.pieces.filter(p => !p.active && game.shotActiveIds?.has(p.id));
  const msgs = [];

  let ownP = 0, oppP = 0, queenIn = false, strikerIn = false;
  for (const p of pocketed) {
    if (p.kind === 'striker') strikerIn = true;
    else if (p.color === 'queen') queenIn = true;
    else if (p.color === my) ownP++;
    else oppP++;
  }

  // Bank every pocketed coin with its colour's owner.
  for (const p of pocketed) {
    if (p.kind === 'coin' && p.color !== 'queen') {
      game.players[p.color === 'white' ? 0 : 1].banked.push(p);
    }
  }

  let foul = strikerIn;

  // A pending queen from my previous shot: cover now or lose her.
  if (!queenIn && game.queenPending === meIdx) {
    if (ownP > 0) {
      game.queenBankedBy = meIdx; game.queenPending = null;
      msgs.push('Queen covered');
    } else {
      const q = game.pieces.find(p => p.color === 'queen');
      const s = freeSpot(game.pieces);
      q.x = s.x; q.y = s.y; q.active = true;
      game.queenPending = null;
      msgs.push('Queen returned to centre');
    }
  }
  if (queenIn) {
    if (ownP > 0) { game.queenBankedBy = meIdx; msgs.push('Queen covered!'); }
    else { game.queenPending = meIdx; msgs.push('Queen pocketed — cover required'); }
  }

  // Last coin before the queen is claimed → coin comes back, foul.
  if (ownP > 0 && countActive(game, my) === 0 && game.queenBankedBy === null) {
    const c = me.banked.pop();
    if (c) { const s = freeSpot(game.pieces); c.x = s.x; c.y = s.y; c.active = true; }
    foul = true;
    msgs.push('last coin before Queen — returned');
  }

  // Gifting the opponent their final coin loses the board.
  if (oppP > 0 && countActive(game, oc) === 0) {
    game.over = { winner: 1 - meIdx, reason: `${me.name} pocketed the opponent's last coin` };
    msgs.push(`${me.name} potted Black's last coin`);
  }
  if (!game.over && ownP > 0 && countActive(game, my) === 0) {
    game.over = { winner: meIdx, reason: 'board cleared' };
  }

  // Striker foul: one banked coin returns.
  if (strikerIn) {
    if (me.banked.length > 0) {
      const c = me.banked.pop();
      const s = freeSpot(game.pieces);
      c.x = s.x; c.y = s.y; c.active = true;
      msgs.push('foul — coin returned');
    } else {
      msgs.push('foul — striker pocketed');
    }
    foul = true;
  }

  removeStriker(game);

  const continueTurn = ownP > 0 && !foul && !game.over;
  if (!continueTurn && !game.over) game.turn = 1 - meIdx;
  game.phase = game.over ? 'over' : 'place';

  const bits = [];
  if (ownP) bits.push(`${ownP} ${my}`);
  if (oppP) bits.push(`${oppP} ${oc}`);
  if (queenIn) bits.push('Queen');
  if (strikerIn) bits.push('striker');
  game.log.push({
    n: game.shotCount,
    text: `${me.name}: ${bits.length ? 'potted ' + bits.join(', ') : 'no pot'}` +
          `${continueTurn ? ' — shoots again' : ''}${msgs.length ? ' · ' + msgs.join(' · ') : ''}`,
  });
  if (game.log.length > 60) game.log.shift();

  return { continueTurn, ownP, oppP, queenIn, strikerIn, foul, msgs, winner: game.over?.winner };
}
