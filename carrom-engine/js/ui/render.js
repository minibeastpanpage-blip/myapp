/**
 * render.js — canvas renderer: board, pieces, aim UI and the engine's
 * guideline / trajectory overlay.
 */
import { B } from '../engine/physics.js';
import { baselineY } from '../engine/rules.js';
import { clamp, mulberry32 } from '../engine/geo.js';

const FRAME = 6.2;      // wooden frame thickness (cm)
const VIEW = B.HALF + FRAME + 1.6;

const COIN_STYLE = {
  white:  { a: '#fffdf2', b: '#e8d5a2', rim: '#a98f5c' },
  black:  { a: '#565664', b: '#17171d', rim: '#000000' },
  queen:  { a: '#ff7261', b: '#8e2018', rim: '#5c130d' },
};
const POCKET_LABEL = ['TL', 'TR', 'BL', 'BR'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 600;
    this.dpr = 1;
    this.time = 0;
    const rng = mulberry32(1234);
    this.grain = Array.from({ length: 46 }, () => ({
      y: (rng() * 2 - 1) * B.HALF,
      w: 6 + rng() * 26,
      a: 0.03 + rng() * 0.05,
    }));
    this.resize();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const s = Math.min(wrap.clientWidth, wrap.clientHeight || 1e9);
    this.size = Math.max(280, s);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.scale = (this.size / (VIEW * 2)) * this.dpr;
  }

  w2s(x, y) {
    const c = this.canvas.width / 2;
    return [c + x * this.scale, c + y * this.scale];
  }
  s2w(px, py) {
    const c = this.canvas.width / 2;
    return [(px * this.dpr - c) / this.scale, (py * this.dpr - c) / this.scale];
  }

  draw(app, dtMs) {
    this.time += dtMs;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBoard();
    const { game, plan } = app;

    // Engine guideline overlay (pre-shot plan, or the remaining path mid-shot).
    if (app.lines && plan && plan.trajectory) {
      const progress = game.phase === 'anim' ? app.anim.steps : 0;
      this.drawTrajectory(plan.trajectory, progress);
      if (game.phase === 'place') this.drawPlanStriker(plan);
    }

    for (const p of game.pieces) if (p.active) this.drawPiece(p);

    if (game.phase === 'place') this.drawAimUI(app);
    if (app.thinking) this.drawBadge('ENGINE THINKING');
    if (game.over) this.drawBadge(`${game.players[game.over.winner].name.toUpperCase()} WINS`, true);
  }

  /* ---------------- board ---------------- */

  drawBoard() {
    const ctx = this.ctx;
    const [x0, y0] = this.w2s(-VIEW, -VIEW);
    const full = VIEW * 2 * this.scale;

    // frame
    const fg = ctx.createLinearGradient(x0, y0, x0 + full, y0 + full);
    fg.addColorStop(0, '#a06c35'); fg.addColorStop(0.5, '#7c4f26'); fg.addColorStop(1, '#5e3a1c');
    ctx.fillStyle = fg;
    roundRect(ctx, x0, y0, full, full, 0.035 * full);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = this.scale * 0.25;
    ctx.stroke();

    // playing surface
    const [sx, sy] = this.w2s(-B.HALF, -B.HALF);
    const ssize = B.HALF * 2 * this.scale;
    const sg = ctx.createRadialGradient(
      sx + ssize / 2, sy + ssize / 2, ssize * 0.1,
      sx + ssize / 2, sy + ssize / 2, ssize * 0.75);
    sg.addColorStop(0, '#f8ecc9'); sg.addColorStop(0.8, '#f1e0b4'); sg.addColorStop(1, '#e2cd9c');
    ctx.fillStyle = sg;
    ctx.fillRect(sx, sy, ssize, ssize);

    // wood grain
    ctx.save();
    ctx.beginPath(); ctx.rect(sx, sy, ssize, ssize); ctx.clip();
    ctx.strokeStyle = 'rgba(120,85,40,1)';
    for (const g of this.grain) {
      ctx.globalAlpha = g.a;
      const [, gy] = this.w2s(-B.HALF, g.y);
      ctx.lineWidth = this.scale * 0.06;
      ctx.beginPath();
      ctx.moveTo(sx, gy);
      ctx.bezierCurveTo(sx + ssize * 0.3, gy + g.w * this.scale * 0.2,
                        sx + ssize * 0.7, gy - g.w * this.scale * 0.2, sx + ssize, gy);
      ctx.stroke();
    }
    ctx.restore();

    this.drawDecor();
    this.drawPockets();

    // frame inner edge
    ctx.strokeStyle = 'rgba(40,20,5,0.55)';
    ctx.lineWidth = this.scale * 0.3;
    ctx.strokeRect(sx, sy, ssize, ssize);
  }

  drawDecor() {
    const ctx = this.ctx;
    const RED = '#b3382c';
    ctx.strokeStyle = RED;
    ctx.lineWidth = Math.max(1, this.scale * 0.09);

    // centre circle
    const [ccx, ccy] = this.w2s(0, 0);
    ctx.beginPath();
    ctx.arc(ccx, ccy, 8.5 * this.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(ccx, ccy, 1.59 * this.scale, 0, Math.PI * 2);
    ctx.fillStyle = RED; ctx.fill();
    ctx.globalAlpha = 1;

    // baselines + base circles
    for (const s of [1, -1]) {
      const y = s * B.BASE_Y;
      const [stx] = this.w2s(-23.5, 0);
      const [ex] = this.w2s(23.5, 0);
      for (const off of [-1.59, 1.59]) {
        const [, ay] = this.w2s(0, y + off);
        ctx.beginPath();
        ctx.moveTo(stx, ay);
        ctx.lineTo(ex, ay);
        ctx.stroke();
      }
      for (const ex2 of [-23.5, 23.5]) {
        const [cx2, cy2] = this.w2s(ex2, y);
        ctx.beginPath();
        ctx.arc(cx2, cy2, 1.59 * this.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // corner arrows toward the pockets
    ctx.lineWidth = Math.max(1, this.scale * 0.08);
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const [ax, ay] = this.w2s(sx * 23.5, sy * 23.5);
      const [bx, by] = this.w2s(sx * 30.6, sy * 30.6);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      // arrowhead
      const ang = Math.atan2(by - ay, bx - ax);
      const hl = this.scale * 1.1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - hl * Math.cos(ang - 0.45), by - hl * Math.sin(ang - 0.45));
      ctx.lineTo(bx - hl * Math.cos(ang + 0.45), by - hl * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = RED; ctx.fill();
    }
  }

  drawPockets() {
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const pk = B.POCKETS[i];
      const [px, py] = this.w2s(pk.x, pk.y);
      // dark halo
      ctx.beginPath();
      ctx.arc(px, py, (B.HOLE_R + 0.55) * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,18,8,0.35)';
      ctx.fill();
      // hole
      const g = ctx.createRadialGradient(px, py, this.scale * 0.2, px, py, B.HOLE_R * this.scale);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#120b06'); g.addColorStop(1, '#2c1c0e');
      ctx.beginPath();
      ctx.arc(px, py, B.HOLE_R * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,235,200,0.25)';
      ctx.lineWidth = this.scale * 0.07;
      ctx.stroke();
    }
  }

  /* ---------------- pieces ---------------- */

  drawPiece(p) {
    const ctx = this.ctx;
    const [px, py] = this.w2s(p.x, p.y);
    const r = p.r * this.scale;

    // shadow
    ctx.beginPath();
    ctx.ellipse(px + r * 0.14, py + r * 0.22, r * 1.02, r * 0.96, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,15,0,0.34)';
    ctx.fill();

    if (p.kind === 'striker') {
      const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.62, '#f3ecd9'); g.addColorStop(1, '#cfc2a4');
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, r * 0.66, 0, Math.PI * 2);
      ctx.strokeStyle = '#c63d2f'; ctx.lineWidth = r * 0.24; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(60,40,10,0.5)'; ctx.lineWidth = this.scale * 0.05; ctx.stroke();
      return;
    }

    const st = COIN_STYLE[p.color] ?? COIN_STYLE.white;
    const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.08, px, py, r * 1.05);
    g.addColorStop(0, st.a); g.addColorStop(0.72, st.b); g.addColorStop(1, st.rim);
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = this.scale * 0.045;
    ctx.stroke();
    // gloss
    ctx.beginPath();
    ctx.arc(px - r * 0.28, py - r * 0.32, r * 0.42, Math.PI * 0.9, Math.PI * 1.7);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = r * 0.14;
    ctx.stroke();
  }

  /* ---------------- overlays ---------------- */

  drawTrajectory(traj, fromStep) {
    const ctx = this.ctx;
    const skip = Math.floor(fromStep / 2);
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 260);

    for (const e of traj.entries) {
      if (e.pts.length < 4) continue;
      const pts = e.pts;
      const isStriker = e.kind === 'striker';
      const color = e.color === 'white' ? '#ffe9b0'
                  : e.color === 'black' ? '#9aa4ff'
                  : e.color === 'queen' ? '#ff8d7e' : '#22d3ee';

      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = skip * 2; i < pts.length; i += 2) {
        const [x, y] = this.w2s(pts[i], pts[i + 1]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      if (!started) { ctx.restore(); continue; }

      if (isStriker) {
        ctx.strokeStyle = 'rgba(34,211,238,0.95)';
        ctx.lineWidth = Math.max(1.5, this.scale * 0.16);
        ctx.shadowColor = 'rgba(34,211,238,0.8)';
        ctx.shadowBlur = 8;
      } else {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.66;
        ctx.lineWidth = Math.max(1, this.scale * 0.1);
        ctx.setLineDash([this.scale * 0.55, this.scale * 0.45]);
      }
      ctx.stroke();
      ctx.restore();

      // end marker
      const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
      const [exs, eys] = this.w2s(ex, ey);
      if (e.end === 'pocket') {
        const pk = B.POCKETS[e.pocket];
        const [px, py] = this.w2s(pk.x, pk.y);
        ctx.beginPath();
        ctx.arc(px, py, (B.HOLE_R + 0.5 + pulse * 0.5) * this.scale, 0, Math.PI * 2);
        ctx.strokeStyle = e.kind === 'striker' ? 'rgba(255,80,80,0.9)' : 'rgba(120,255,170,0.95)';
        ctx.lineWidth = this.scale * 0.14;
        ctx.stroke();
      } else if (!isStriker) {
        ctx.beginPath();
        ctx.arc(exs, eys, this.scale * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  drawPlanStriker(plan) {
    const ctx = this.ctx;
    const by = baselineY(plan.shotColor ?? 'white');
    const [px, py] = this.w2s(plan.shot.x, by);
    ctx.beginPath();
    ctx.arc(px, py, B.STRIKER_R * this.scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(34,211,238,0.35)';
    ctx.strokeStyle = 'rgba(34,211,238,0.9)';
    ctx.lineWidth = this.scale * 0.1;
    ctx.fill(); ctx.stroke();
  }

  drawAimUI(app) {
    const { game, aim, mouse } = app;
    if (game.phase !== 'place') return;
    const humanColor = game.players[game.turn].color;
    const by = baselineY(humanColor);
    const ctx = this.ctx;

    // ghost striker while unplaced
    if (!app.placedPiece && mouse && mouse.onBoard) {
      const gx = clamp(mouse.x, -B.BASE_X, B.BASE_X);
      const legal = app.ghostLegal;
      const [px, py] = this.w2s(gx, by);
      ctx.beginPath();
      ctx.arc(px, py, B.STRIKER_R * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = legal ? 'rgba(120,255,170,0.30)' : 'rgba(255,90,90,0.30)';
      ctx.strokeStyle = legal ? 'rgba(120,255,170,0.85)' : 'rgba(255,90,90,0.85)';
      ctx.lineWidth = this.scale * 0.09;
      ctx.fill(); ctx.stroke();
    }

    const st = app.placedPiece;
    if (!st) return;

    // aim ray (+ one cushion reflection, aim-tool style)
    if (aim && aim.dir) {
      const dir = aim.dir;
      let x = st.x, y = st.y;
      let dx = dir[0], dy = dir[1];
      for (let bounce = 0; bounce < 2; bounce++) {
        const lim = B.HALF - B.STRIKER_R;
        let tMin = Infinity, nx = 0, ny = 0;
        if (dx > 1e-9) { const t = (lim - x) / dx; if (t < tMin) { tMin = t; nx = -1; ny = 0; } }
        if (dx < -1e-9) { const t = (-lim - x) / dx; if (t < tMin) { tMin = t; nx = 1; ny = 0; } }
        if (dy > 1e-9) { const t = (lim - y) / dy; if (t < tMin) { tMin = t; nx = 0; ny = -1; } }
        if (dy < -1e-9) { const t = (-lim - y) / dy; if (t < tMin) { tMin = t; nx = 0; ny = 1; } }
        const t = Math.min(tMin, bounce === 0 ? 130 : 26);
        const ex = x + dx * t, ey = y + dy * t;
        const [ax, ay] = this.w2s(x, y);
        const [bx, by2] = this.w2s(ex, ey);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by2);
        if (bounce === 0) {
          ctx.strokeStyle = 'rgba(34,211,238,0.85)';
          ctx.lineWidth = Math.max(1.4, this.scale * 0.14);
          ctx.shadowColor = 'rgba(34,211,238,0.6)'; ctx.shadowBlur = 6;
        } else {
          ctx.strokeStyle = 'rgba(34,211,238,0.28)';
          ctx.lineWidth = Math.max(1, this.scale * 0.09);
          ctx.setLineDash([this.scale * 0.5, this.scale * 0.5]);
        }
        ctx.stroke();
        ctx.restore();
        if (tMin > t) break;             // ran out of length, no reflection
        if (tMin >= 130) break;
        x = ex; y = ey;
        const d = dx * nx + dy * ny;
        dx -= 2 * d * nx; dy -= 2 * d * ny;
      }
    }

    // pull-back line + power arc while dragging
    if (aim && aim.dragging && mouse && mouse.onBoard) {
      const [ax, ay] = this.w2s(st.x, st.y);
      const [bx, by2] = this.w2s(mouse.x, mouse.y);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by2);
      ctx.strokeStyle = 'rgba(255,90,90,0.8)';
      ctx.lineWidth = Math.max(1.2, this.scale * 0.1);
      ctx.setLineDash([this.scale * 0.3, this.scale * 0.3]);
      ctx.stroke();
      ctx.restore();

      const pwr = aim.power ?? 0;
      const [cx, cy] = this.w2s(st.x, st.y);
      ctx.beginPath();
      ctx.arc(cx, cy, (B.STRIKER_R + 1.1) * this.scale, -Math.PI / 2,
              -Math.PI / 2 + pwr * Math.PI * 2);
      ctx.strokeStyle = pwr > 0.85 ? '#ff5d5d' : pwr > 0.5 ? '#ffb347' : '#7dffa8';
      ctx.lineWidth = this.scale * 0.22;
      ctx.stroke();
    }
  }

  drawBadge(text, big = false) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const y = this.scale * (big ? 4 : 6);
    ctx.save();
    ctx.font = `600 ${Math.round(this.scale * (big ? 2.4 : 1.5))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    roundRect(ctx, w / 2 - tw / 2 - this.scale * 1.4, y - this.scale * 1.2,
              tw + this.scale * 2.8, this.scale * 2.4, this.scale * 1.2);
    ctx.fillStyle = 'rgba(10,14,20,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,0.7)';
    ctx.lineWidth = this.scale * 0.09;
    ctx.stroke();
    const dots = '.'.repeat(1 + (Math.floor(this.time / 380) % 3));
    ctx.fillStyle = big ? '#ffd166' : '#22d3ee';
    ctx.fillText(big ? text : text + dots, w / 2, y);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
