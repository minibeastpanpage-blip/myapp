/** geo.js — small geometry helpers shared by the engine and the AI. */

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Squared distance from point to segment. */
export function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/**
 * Is the straight path from A to B clear for a circle of `radius`,
 * considering every active piece not in `ignore`? Small forgiveness so
 * near-tangent lines aren't rejected (the simulator verifies anyway).
 */
export function clearPath(pieces, ax, ay, bx, by, radius, ignore) {
  for (const p of pieces) {
    if (!p.active || ignore.has(p.id)) continue;
    const thresh = radius + p.r - 0.12;
    if (segDist2(p.x, p.y, ax, ay, bx, by) < thresh * thresh) return false;
  }
  return true;
}

/** Is a striker spot free? */
export function placementClear(pieces, x, y, strikerR) {
  for (const p of pieces) {
    if (!p.active || p.kind === 'striker') continue;
    if (Math.hypot(p.x - x, p.y - y) < p.r + strikerR + 0.03) return false;
  }
  return true;
}

/** Nearest legal resting spot to the centre (for returned coins / queen). */
export function freeSpot(pieces) {
  const R = 1.59;
  for (let ring = 0; ring < 14; ring++) {
    const rad = ring * 1.7;
    const steps = ring === 0 ? 1 : 6 + ring * 4;
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2 + ring * 0.7;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (Math.abs(x) > 20 || Math.abs(y) > 20) continue;
      let ok = true;
      for (const p of pieces) {
        if (!p.active) continue;
        if (Math.hypot(p.x - x, p.y - y) < p.r + R + 0.06) { ok = false; break; }
        // keep returned pieces away from pockets
        for (const pk of [{x:-34.75,y:-34.75},{x:34.75,y:-34.75},{x:-34.75,y:34.75},{x:34.75,y:34.75}]) {
          if (Math.hypot(p.x - pk.x, p.y - pk.y) < 6) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/** Deterministic little RNG for board setup / wood grain. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
