/* ===========================================================================
   render.js — ノーツハイウェイの描画（Canvas2D）
   MV の上に、奥行きのある4レーンを重ねる。遠近は実写の消失点に合わせて
   効かせ、ノーツ自体はシルエットが潰れないよう手前で十分な大きさにする。
   =========================================================================== */

const NUM = '"Chakra Petch",Bahnschrift,"DIN Alternate","Segoe UI",system-ui,sans-serif';

const LANE_COL = [
  ['#19d9ff', '#9ff4ff'],
  ['#ffffff', '#d9ecff'],
  ['#ffffff', '#d9ecff'],
  ['#19d9ff', '#9ff4ff'],
];
const HOLD_COL = ['#19ffb0', '#b9ffe6'];
const CUT_COL = ['#ffd200', '#fff3b0'];

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.parts = [];
    this.rings = [];
    this.laneFlash = [0, 0, 0, 0];
    this.cutFlash = 0;
    this.portrait = false;
  }

  resize(w, h, dpr, padH) {
    this.dpr = dpr;
    this.w = w; this.h = h; this.padH = padH || 0;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.portrait = h / w > 1.15;
    const avail = h - this.padH;                 // 叩きパッドの上だけを使う
    this.judgeY = avail * (this.portrait ? 0.80 : 0.87);
    this.horizonY = avail * (this.portrait ? 0.15 : 0.21);
    this.fieldW = this.portrait
      ? Math.min(w * 0.96, 580)
      : Math.min(w * 0.52, h * 0.76, 820);
    this.cx = w / 2;
    this.noteH = (this.portrait ? 28 : 27) * Math.max(0.82, Math.min(1.5, h / 900));
  }

  /** 残り時間の比 d(1=出現, 0=判定線) から画面座標の倍率を返す */
  persp(d, K) {
    const dd = Math.max(-0.28, Math.min(1.08, d));
    const sc = 1 / (1 + dd * K);
    const sFar = 1 / (1 + K);
    return { sc: sc, yp: (sc - sFar) / (1 - sFar) };
  }
  yAt(yp) { return this.horizonY + (this.judgeY - this.horizonY) * yp; }
  laneX(lane, sc) { return this.cx + (lane - 1.5) * (this.fieldW / 4) * sc; }

  hit(lane, judge, big) {
    const K = this.K || 1;
    const x = lane < 0 ? this.cx : this.laneX(lane, 1);
    const col = judge === 0 ? '#9ff4ff' : judge === 1 ? '#39ff9e' : judge === 2 ? '#ffd200' : '#ff9b3d';
    if (this.rings.length > 7) this.rings.splice(0, this.rings.length - 7);
    this.rings.push({ x: x, y: this.judgeY, r: 0, max: big ? this.fieldW * 0.60 : this.fieldW * 0.20, a: 1, col: col, w: big ? 5 : 2.4 });
    const n = big ? 22 : 6;
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * (big ? 3.0 : 1.7);
      const sp = (big ? 240 : 150) * (0.4 + Math.random());
      this.parts.push({
        x: x + (Math.random() - .5) * (big ? this.fieldW * 0.8 : this.fieldW / 5),
        y: this.judgeY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, dec: 2.6 + Math.random() * 1.4, col: col, sz: (big ? 3.4 : 2.4) * (0.6 + Math.random()),
      });
    }
    if (lane >= 0) this.laneFlash[lane] = 1;
    if (big) this.cutFlash = 1;
  }

  // ------------------------------------------------------------------ 本体
  draw(g, dt) {
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    const K = this.K = 0.25 + g.set.persp * 1.7;
    const lead = g.lead;
    const t = g.gameTime;
    const fw = this.fieldW;

    // ---------------------------------------------------------- 床
    const topSc = this.persp(1, K).sc;
    const lx0 = this.laneX(-0.5, topSc), lx1 = this.laneX(3.5, topSc);
    const bx0 = this.laneX(-0.5, 1), bx1 = this.laneX(3.5, 1);
    const grd = c.createLinearGradient(0, this.horizonY, 0, this.judgeY);
    grd.addColorStop(0, 'rgba(8,14,26,0)');
    grd.addColorStop(.45, 'rgba(8,14,26,.22)');
    grd.addColorStop(1, 'rgba(6,10,20,.62)');
    c.beginPath();
    c.moveTo(lx0, this.horizonY); c.lineTo(lx1, this.horizonY);
    c.lineTo(bx1, this.judgeY); c.lineTo(bx0, this.judgeY); c.closePath();
    c.fillStyle = grd; c.fill();

    // 小節線（奥行きの手がかり）
    if (g.bars) {
      c.lineWidth = 1;
      for (const bt of g.bars) {
        const d = (bt - t) / lead;
        if (d > 1.02 || d < -0.1) continue;
        const p = this.persp(d, K);
        const y = this.yAt(p.yp);
        c.strokeStyle = 'rgba(255,255,255,' + (0.03 + 0.10 * p.yp).toFixed(3) + ')';
        c.beginPath();
        c.moveTo(this.laneX(-0.5, p.sc), y); c.lineTo(this.laneX(3.5, p.sc), y); c.stroke();
      }
    }

    // レーン境界
    for (let i = 0; i <= 4; i++) {
      const g2 = c.createLinearGradient(0, this.horizonY, 0, this.judgeY);
      const edge = (i === 0 || i === 4);
      g2.addColorStop(0, 'rgba(255,255,255,0)');
      g2.addColorStop(1, edge ? 'rgba(31,230,255,.55)' : 'rgba(255,255,255,.16)');
      c.strokeStyle = g2; c.lineWidth = edge ? 2 : 1;
      c.beginPath();
      c.moveTo(this.laneX(i - 0.5, topSc), this.horizonY);
      c.lineTo(this.laneX(i - 0.5, 1), this.judgeY);
      c.stroke();
    }

    // 押している／光っているレーン
    for (let i = 0; i < 4; i++) {
      const lit = Math.max(g.pressed[i] ? 0.55 : 0, this.laneFlash[i]);
      if (lit <= 0.01) continue;
      const g3 = c.createLinearGradient(0, this.horizonY, 0, this.judgeY);
      g3.addColorStop(0, 'rgba(31,230,255,0)');
      g3.addColorStop(.6, 'rgba(31,230,255,' + (0.05 * lit).toFixed(3) + ')');
      g3.addColorStop(1, 'rgba(120,245,255,' + (0.38 * lit).toFixed(3) + ')');
      c.beginPath();
      c.moveTo(this.laneX(i - 0.5, topSc), this.horizonY);
      c.lineTo(this.laneX(i + 0.5, topSc), this.horizonY);
      c.lineTo(this.laneX(i + 0.5, 1), this.judgeY);
      c.lineTo(this.laneX(i - 0.5, 1), this.judgeY);
      c.closePath(); c.fillStyle = g3; c.fill();
      this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt * 4.5);
    }

    // ---------------------------------------------------------- ノーツ
    const notes = g.notes;
    const from = g.drawFrom;
    // 遠くから描いて、手前のノーツが上に来るようにする
    const list = [];
    for (let i = from; i < notes.length; i++) {
      const n = notes[i];
      const d = (n.t - t) / lead;
      if (d > 1.04) break;
      if (n.dead) continue;
      const dEnd = n.type === 1 ? (n.t + n.dur - t) / lead : d;
      if (dEnd < -0.26) continue;
      list.push(n);
    }
    for (let i = list.length - 1; i >= 0; i--) this.drawNote(c, list[i], t, lead, K, g);

    // ---------------------------------------------------------- 判定ライン
    const glow = 0.45 + 0.55 * g.hype;
    const jw = bx1 - bx0;
    c.save();
    // 手前に溜まる光
    const bloom = c.createLinearGradient(0, this.judgeY - 86, 0, this.judgeY + 4);
    bloom.addColorStop(0, 'rgba(31,230,255,0)');
    bloom.addColorStop(1, 'rgba(31,230,255,' + (0.14 * glow).toFixed(3) + ')');
    c.fillStyle = bloom;
    c.fillRect(bx0 - 10, this.judgeY - 86, jw + 20, 90);
    // 太いソフトライン
    const soft = c.createLinearGradient(bx0, 0, bx1, 0);
    soft.addColorStop(0, 'rgba(31,230,255,0)');
    soft.addColorStop(.5, 'rgba(31,230,255,' + (0.85 * glow).toFixed(3) + ')');
    soft.addColorStop(1, 'rgba(31,230,255,0)');
    c.shadowColor = 'rgba(31,230,255,' + (0.85 * glow).toFixed(3) + ')';
    c.shadowBlur = 24 * glow;
    c.fillStyle = soft;
    c.fillRect(bx0 - 14, this.judgeY - 3.5, jw + 28, 7);
    // 芯
    c.shadowBlur = 0;
    const core = c.createLinearGradient(bx0, 0, bx1, 0);
    core.addColorStop(0, 'rgba(255,255,255,.15)');
    core.addColorStop(.5, 'rgba(255,255,255,.98)');
    core.addColorStop(1, 'rgba(255,255,255,.15)');
    c.fillStyle = core;
    c.fillRect(bx0 - 14, this.judgeY - 1, jw + 28, 2);
    c.restore();

    // キーの当たり位置
    for (let i = 0; i < 4; i++) {
      const x = this.laneX(i, 1), lw = fw / 4;
      const on = g.pressed[i] ? 1 : 0;
      const lit = Math.max(on, this.laneFlash[i]);
      c.save();
      if (lit > 0.01) { c.shadowColor = 'rgba(120,245,255,.9)'; c.shadowBlur = 16 * lit; }
      const kg = c.createLinearGradient(0, this.judgeY + 5, 0, this.judgeY + 16);
      kg.addColorStop(0, lit > .01 ? 'rgba(160,250,255,' + (.35 + .55 * lit) + ')' : 'rgba(255,255,255,.14)');
      kg.addColorStop(1, lit > .01 ? 'rgba(31,230,255,' + (.18 + .4 * lit) + ')' : 'rgba(255,255,255,.03)');
      c.fillStyle = kg;
      roundRect(c, x - lw / 2 + 4, this.judgeY + 5, lw - 8, 11, 5.5);
      c.fill();
      c.restore();
    }
    if (this.cutFlash > 0.01) {
      c.save();
      c.shadowColor = 'rgba(255,210,0,.9)'; c.shadowBlur = 30 * this.cutFlash;
      c.fillStyle = 'rgba(255,225,80,' + (0.55 * this.cutFlash) + ')';
      roundRect(c, bx0 - 22, this.judgeY - 5, jw + 44, 10, 5);
      c.fill();
      c.restore();
      this.cutFlash = Math.max(0, this.cutFlash - dt * 3);
    }

    // ---------------------------------------------------------- 粒子
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.life -= p.dec * dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.sz * p.life, 0, 6.2832); c.fill();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 10); r.a -= dt * 3.4;
      if (r.a <= 0) { this.rings.splice(i, 1); continue; }
      c.globalAlpha = Math.max(0, r.a) * .55;
      c.strokeStyle = r.col; c.lineWidth = Math.max(1, r.w * r.a);
      c.beginPath(); c.ellipse(r.x, r.y, r.r, r.r * 0.22, 0, 0, 6.2832); c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  drawNote(c, n, t, lead, K, g) {
    const d = (n.t - t) / lead;
    if (n.type === 2) return this.drawCut(c, n, d, K, g);

    const p = this.persp(d, K);
    const y = this.yAt(p.yp);
    const x = this.laneX(n.lane, p.sc);
    const wv = (this.fieldW / 4) * p.sc * 0.86;
    const hv = this.noteH * p.sc;
    const fade = n.judged && n.type !== 1 ? 0 : 1;
    if (fade <= 0) return;

    // ロングノーツの帯
    if (n.type === 1) {
      const dEnd = (n.t + n.dur - t) / lead;
      const pe = this.persp(Math.max(dEnd, -0.26), K);
      const ye = this.yAt(pe.yp);
      const we = (this.fieldW / 4) * pe.sc * 0.52;
      const wb = wv * 0.62;
      const held = n.holding;
      const xe = this.laneX(n.lane, pe.sc);
      c.save();
      c.beginPath();
      c.moveTo(x - wb / 2, y); c.lineTo(x + wb / 2, y);
      c.lineTo(xe + we / 2, ye); c.lineTo(xe - we / 2, ye);
      c.closePath();
      const gb = c.createLinearGradient(0, ye, 0, y);
      gb.addColorStop(0, held ? 'rgba(25,255,176,.10)' : 'rgba(25,255,176,.06)');
      gb.addColorStop(1, held ? 'rgba(130,255,210,.40)' : 'rgba(25,255,176,.24)');
      c.fillStyle = gb; c.fill();
      // 流れるシェブロン
      c.save();
      c.clip();
      c.globalAlpha = held ? .42 : .24;
      c.strokeStyle = '#ddfff2';
      c.lineWidth = Math.max(1, 1.6 * p.sc);
      const ph = (t * 1.5) % 1;
      for (let k = -1; k < 7; k++) {
        const u = (k + ph) / 6;
        if (u < 0 || u > 1) continue;
        const yy = ye + (y - ye) * u;
        const ww = (we + (wb - we) * u) * 0.5;
        c.beginPath();
        c.moveTo(x - ww, yy - ww * 0.22);
        c.lineTo(x, yy + ww * 0.16);
        c.lineTo(x + ww, yy - ww * 0.22);
        c.stroke();
      }
      c.restore();
      // 両脇のレール
      c.lineWidth = Math.max(1, 1.4 * p.sc);
      c.strokeStyle = held ? 'rgba(200,255,235,.9)' : 'rgba(25,255,176,.6)';
      if (held) { c.shadowColor = 'rgba(25,255,176,.8)'; c.shadowBlur = 10 * p.sc; }
      c.beginPath();
      c.moveTo(x - wb / 2, y); c.lineTo(xe - we / 2, ye);
      c.moveTo(x + wb / 2, y); c.lineTo(xe + we / 2, ye);
      c.stroke();
      c.restore();
      if (n.judged && n.holding) return;  // 頭は消えて帯だけ残る
    }

    const col = n.type === 1 ? HOLD_COL : LANE_COL[n.lane];
    // 遠くはうっすら出てくる（急に湧いて見えないように）
    const fadeIn = Math.max(0, Math.min(1, (1.0 - d) / 0.14));
    this.capsule(c, x, y, wv, hv, col, p.sc, fadeIn);
  }

  /** ノーツ本体：下に落ちる影・色の身・白い天面・暗い縁 で厚みを出す */
  capsule(c, x, y, w, h, col, sc, alpha) {
    const r = h * 0.46;
    c.save();
    c.globalAlpha = alpha;

    // 1) レーンに落ちる影
    c.globalAlpha = alpha * 0.45;
    c.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(c, x - w / 2, y - h / 2 + h * 0.42, w, h, r);
    c.fill();

    // 2) 色の身＋外側の発光
    c.globalAlpha = alpha;
    c.shadowColor = col[0];
    c.shadowBlur = 15 * sc;
    const g = c.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(.20, col[1]);
    g.addColorStop(.56, col[0]);
    g.addColorStop(1, shade(col[0], -0.55));
    c.fillStyle = g;
    roundRect(c, x - w / 2, y - h / 2, w, h, r);
    c.fill();
    c.shadowBlur = 0;

    // 3) 天面のハイライト
    const hg = c.createLinearGradient(0, y - h / 2, 0, y - h / 2 + h * 0.42);
    hg.addColorStop(0, 'rgba(255,255,255,.95)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hg;
    roundRect(c, x - w / 2 + w * 0.045, y - h / 2 + h * 0.08, w * 0.91, h * 0.4, r * 0.7);
    c.fill();

    // 4) 縁
    c.lineWidth = Math.max(1, 1.1 * sc);
    c.strokeStyle = 'rgba(2,6,14,.5)';
    roundRect(c, x - w / 2, y - h / 2, w, h, r);
    c.stroke();
    c.restore();
  }

  drawCut(c, n, d, K, g) {
    const p = this.persp(d, K);
    const y = this.yAt(p.yp);
    const x0 = this.laneX(-0.62, p.sc), x1 = this.laneX(3.62, p.sc);
    const hv = this.noteH * p.sc * 0.92;
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const fadeIn = Math.max(0, Math.min(1, (1.0 - d) / 0.14));
    c.save();
    c.globalAlpha = fadeIn;

    c.globalAlpha = fadeIn * 0.45;
    c.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(c, x0, y - hv / 2 + hv * 0.42, w, hv, hv * 0.46); c.fill();

    c.globalAlpha = fadeIn;
    c.shadowColor = CUT_COL[0]; c.shadowBlur = 26 * p.sc;
    const gg = c.createLinearGradient(0, y - hv / 2, 0, y + hv / 2);
    gg.addColorStop(0, '#fffdf0');
    gg.addColorStop(.22, CUT_COL[1]);
    gg.addColorStop(.58, CUT_COL[0]);
    gg.addColorStop(1, shade(CUT_COL[0], -0.55));
    c.fillStyle = gg;
    roundRect(c, x0, y - hv / 2, w, hv, hv * 0.46);
    c.fill();
    c.shadowBlur = 0;

    const hg = c.createLinearGradient(0, y - hv / 2, 0, y - hv / 2 + hv * 0.42);
    hg.addColorStop(0, 'rgba(255,255,255,.9)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hg;
    roundRect(c, x0 + 4, y - hv / 2 + hv * 0.08, w - 8, hv * 0.4, hv * 0.3);
    c.fill();

    // 左右に伸びる矢羽
    c.strokeStyle = 'rgba(60,40,0,.45)';
    c.lineWidth = Math.max(1.2, 1.8 * p.sc);
    const ax = hv * 0.42;
    for (const [sx, dir] of [[x0 + w * 0.13, 1], [x1 - w * 0.13, -1]]) {
      for (let k = 0; k < 2; k++) {
        const bx = sx + dir * k * ax * 0.75;
        c.beginPath();
        c.moveTo(bx - dir * ax * 0.3, y - ax * 0.3);
        c.lineTo(bx + dir * ax * 0.3, y);
        c.lineTo(bx - dir * ax * 0.3, y + ax * 0.3);
        c.stroke();
      }
    }
    c.fillStyle = 'rgba(55,38,0,.62)';
    c.font = '700 ' + Math.max(8, 10.5 * p.sc) + 'px ' + NUM;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('C U T', cx, y + 0.5);

    c.lineWidth = Math.max(1, 1.1 * p.sc);
    c.strokeStyle = 'rgba(2,6,14,.4)';
    roundRect(c, x0, y - hv / 2, w, hv, hv * 0.46);
    c.stroke();
    c.restore();
  }
}

/** 色を暗く／明るくする（#rrggbb 前提） */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = amt < 0 ? 1 + amt : 1;
  const add = amt > 0 ? 255 * amt : 0;
  const r = Math.round(((n >> 16) & 255) * f + add);
  const g = Math.round(((n >> 8) & 255) * f + add);
  const b = Math.round((n & 255) * f + add);
  return 'rgb(' + Math.min(255, r) + ',' + Math.min(255, g) + ',' + Math.min(255, b) + ')';
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
