# Carrom Autoplay Engine — "KE-1"

A standalone carrom (carrom board) game with a **physics core** and an
**autoplay AI engine** that searches for and executes shots by itself — the
same underlying technology the "auto-aim" engines are built on, implemented
in the open as a self-contained demo you can watch, play against, and hack on.

> **Scope note:** this project is a carrom physics/AI sandbox. It does not
> read memory, capture screens, or inject input into any commercial game
> (e.g. Miniclip's Carrom Pool), and it isn't a cheat client. If you want a
> fair game online, this won't help you — it's here to show how the shot
> search itself works.

## Run it

No build step, no dependencies:

```bash
cd carrom-engine
python3 -m http.server 8080
# open http://localhost:8080
```

Headless engine validation (Node only, no DOM):

```bash
node tools/selftest.mjs 5 250     # games, search budget ms
```

The self-test plays full engine-vs-engine games and asserts coin
conservation, no NaN positions and no pieces resting outside the board.

## What you see

- **Autoplay White / Autoplay Black** — toggle the engine for either side.
  Both on by default: the engine breaks, searches, shoots, covers the queen,
  commits fouls and recovers, end to end.
- **Engine guidelines** — the KOS-style overlay: after each search the chosen
  shot's full simulated trajectory is drawn (striker path in cyan, coin paths
  dashed, pocket rings pulsing on predicted pots). It's the *actual*
  simulation replay, not a mock-up.
- **KE-1 ENGINE panel** — sims evaluated, think time, search score, and a
  plain-language shot description (`W4 → TR · cut 21° · pwr 64%`).
- **Perfect execution** — off by default: shots execute with a small
  human-like wobble (angle σ ≈ 0.23°, power σ ≈ 1.2%), so the engine has to
  find *robust* shots, not just geometrically perfect thin cuts. Flip it on
  to watch pure bot mode.
- **Speed ½×–∞** — ∞ finishes a full game in a couple of seconds.
- **Manual play** — turn both autoplays off: click your baseline to place the
  striker, drag back and release to shoot (aim line shows one cushion
  reflection). `H` = hint from the engine, `E` = let the engine take the shot.

## Rules implemented

Freestyle carrom: 9 white + 9 black coins, red queen, pocket your colour to
keep shooting, queen must be covered (own coin in the same shot or your next
shot, else she returns to centre), no pocketing your last coin before the
queen is claimed, striker foul returns one banked coin, and gifting the
opponent their final coin loses the board.

## Architecture

```
carrom-engine/
├── index.html / style.css     UI shell (dark panel, canvas board)
├── js/
│   ├── engine/
│   │   ├── physics.js         deterministic impulse physics: friction,
│   │   │                      coin↔coin / wall restitution, pocket capture,
│   │   │                      adaptive sub-stepping (anti-tunnelling)
│   │   ├── geo.js             segment clearance, free-spot search, RNG
│   │   ├── rules.js           game state machine: turns, queen cover,
│   │   │                      fouls, banking, win detection
│   │   └── ai.js              KE-1: the autoplay engine
│   ├── ui/render.js           canvas renderer + guideline overlay
│   ├── ui/audio.js            tiny WebAudio synth for hits/pots/shots
│   └── main.js                game loop, turn orchestration, input, panel
└── tools/selftest.mjs         headless engine-vs-engine validation
```

### The KE-1 shot search

1. **Geometric candidates** — for every (own coin × pocket) pair, solve the
   contact equation: the striker must reach the *ghost contact point* so the
   impact normal points at the pocket. The striker position is swept along
   the baseline; candidates need a makeable cut angle (< ~70°), a clear
   striker path and a clear coin path, and launch speed sized from the
   friction model.
2. **Monte-Carlo candidates** — random placements/angles/powers biased at own
   coins, which discover rebounds and combination pots the geometry can't
   express.
3. **Simulation scoring** — every candidate is rolled forward through the
   *same deterministic physics the live board uses* (that's why the guideline
   overlay is exact), then scored rules-aware: pots, fouls, queen logic,
   board-clear wins, and the positional value of the leave.
4. **Refinement** — the best survivors get Gaussian perturbations of angle /
   power / placement and re-simulate, hill-climbing to the final choice,
   under a wall-clock budget (~700 ms default).

Typical search: 200–400 full simulations per shot in ~60–150 ms.

### Physics notes

Real carrom dimensions are used throughout: 74 cm playing surface, 3.18 cm
coins, 4.13 cm striker, 4.5 cm pockets tangent to the walls, striker mass
≈ 2.7× a coin. Friction is constant deceleration + linear damping; collisions
are equal-restitution impulses with positional separation; integration
sub-steps adaptively so nothing tunnels. The queen/coin arrangement matches
the standard alternating double-ring break with a seeded jitter so no two
games play out identically.
