# myapp / Carrom Autoplay Engine

This repo now contains a **standalone carrom autoplay engine** in
[`carrom-engine/`](carrom-engine/README.md) — a deterministic physics core
plus a shot-search AI ("KE-1") that plays full carrom games by itself, with
KOS-style guideline/trajectory overlays.

```bash
cd carrom-engine
python3 -m http.server 8080        # then open http://localhost:8080
node tools/selftest.mjs 5 250      # headless engine-vs-engine validation
node tools/uismoke.mjs            # runs the real UI pipeline against a DOM mock
```

## Why this shape

The repo originally contained only `kEngine3.3-sumongaming.apk` — a modded
"KOS" client for a commercial online carrom game. That artifact is untouched.

This project deliberately does **not** replicate what that APK does (screen
reading / auto-aim injection into a live multiplayer game): that's cheating
other players and violates the game's terms of service. What it *does*
recreate, openly, is the interesting engineering underneath those tools:

- **physics** — impulse-based carrom simulation at real board dimensions,
- **shot search** — geometric contact-point solving + Monte-Carlo sampling +
  rules-aware simulation scoring + local refinement,
- **guidelines** — the chosen shot's exact simulated trajectory, drawn live.

Point it at any carrom-like physics and the same search finds the shots;
watch it beat you in the included game.

See [`carrom-engine/README.md`](carrom-engine/README.md) for architecture,
rules, tuning and controls.
