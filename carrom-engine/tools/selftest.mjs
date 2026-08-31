/**
 * selftest.mjs — headless validation of the carrom autoplay engine.
 *
 *   node tools/selftest.mjs [games] [budgetMs]
 *
 * Plays full engine-vs-engine games with no DOM and checks:
 *   · the physics never produces NaN or out-of-bounds rest positions
 *   · coin conservation (9 white / 9 black / 1 queen accounted for at all times)
 *   · games actually finish and produce sane pot rates
 */
import { B, stepWorld, sweepCorner } from '../js/engine/physics.js';
import { newGame, placeStriker, shoot, resolveShot } from '../js/engine/rules.js';
import { computeBestShot } from '../js/engine/ai.js';

const GAMES = parseInt(process.argv[2] ?? '2', 10);
const BUDGET = parseInt(process.argv[3] ?? '250', 10);

let totalShots = 0, totalPots = 0, totalEvals = 0, totalTime = 0, maxShots = 0;
const winners = { White: 0, Black: 0 };

for (let g = 0; g < GAMES; g++) {
  const game = newGame(1234 + g);
  let shots = 0, pots = 0;

  while (!game.over && shots < 220) {
    const plan = computeBestShot(game, { budgetMs: BUDGET });
    if (!plan) break;
    totalEvals += plan.evals;
    totalTime += plan.ms;

    // invariant: board composition before the shot
    checkInvariants(game, `game ${g} shot ${shots} (pre)`);

    const st = placeStriker(game, plan.shot.x);
    if (!st) { game.turn = 1 - game.turn; continue; }
    shoot(game, plan.shot.angle, plan.shot.v);

    let t = 0, settled = false;
    while (t < 12 && !settled) {
      settled = stepWorld(game.pieces, 1 / 120, { pockets: [], hits: [] });
      t += 1 / 120;
      for (const p of game.pieces) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new Error(`NaN position on piece ${p.id}`);
        }
      }
    }
    sweepCorner(game.pieces, { pockets: [] });
    // any resting piece fully outside the board is a physics bug
    for (const p of game.pieces) {
      if (p.active && (Math.abs(p.x) > B.HALF - p.r + 0.31 || Math.abs(p.y) > B.HALF - p.r + 0.31)) {
        throw new Error(`piece ${p.id} resting outside walls at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) game ${g} shot ${shots}`);
      }
    }

    const res = resolveShot(game);
    shots++;
    if (res.ownP > 0) pots += res.ownP;
    checkInvariants(game, `game ${g} shot ${shots} (post)`);
  }

  if (game.over) winners[game.players[game.over.winner].name]++;
  totalShots += shots;
  totalPots += pots;
  maxShots = Math.max(maxShots, shots);
  const potted = game.players[0].banked.length + game.players[1].banked.length;
  console.log(`game ${g + 1}: ${shots} shots · ${pots} own-coins potted · ` +
              `W ${game.players[0].banked.length}/9 · B ${game.players[1].banked.length}/9 · ` +
              (game.over ? `winner ${game.players[game.over.winner].name} (${game.over.reason})` : 'DID NOT FINISH'));
  if (!game.over) console.log('  ⚠ unfinished — last log:', game.log.slice(-3).map(l => l.text));
}

console.log('---');
console.log(`games=${GAMES} shots=${totalShots} (max ${maxShots})`);
console.log(`pot rate: ${(totalPots / Math.max(1, totalShots) * 100).toFixed(1)}% of shots potted an own coin`);
console.log(`engine: avg ${(totalEvals / Math.max(1, totalShots)).toFixed(0)} sims/shot, avg ${(totalTime / Math.max(1, totalShots)).toFixed(0)} ms/shot @ ${BUDGET}ms budget`);
console.log(`winners:`, winners);
if (!Object.values(winners).some(Boolean)) {
  console.log('⚠ no game finished — engine/rules may be stuck');
  process.exitCode = 1;
}

function checkInvariants(game, where) {
  const onBoard = { white: 0, black: 0, queen: 0 };
  for (const p of game.pieces) {
    if (!p.active || p.kind !== 'coin') continue;
    onBoard[p.color]++;
  }
  const w = onBoard.white + game.players[0].banked.length;
  const b = onBoard.black + game.players[1].banked.length;
  const q = onBoard.queen + (game.queenBankedBy !== null || game.queenPending !== null ? 1 : 0);
  if (w !== 9 || b !== 9 || q !== 1) {
    throw new Error(`conservation broken at ${where}: W=${w} B=${b} Q=${q}`);
  }
}
