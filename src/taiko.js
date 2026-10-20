/* ===========================================================================
   taiko.js — たいこモード
   ・4レーン譜面から、一本レーンの横スクロール譜面へ変換する
   ・ドン（内側 F / J）とカ（外側 D / K）を区別する
       ドン … キック／表拍。塗りつぶしのマゼンタ
       カ   … ハイハット／裏拍。輪っかのシアン
       大   … 同時押しだった音 / MVのカット。2キー同時で「大」成立
       連打 … 伸ばしていた音。どちらで叩いてもよい
   見た目は他の画面と同じ配色（シアン／マゼンタ）と線の細さで作る。
   =========================================================================== */

export const T_SMALL = 0, T_ROLL = 1, T_BIG = 2;
export const DON = 0, KA = 1;

/** 4レーン譜面 → たいこ譜面。出力は [時刻, ドン0/カ1, 種別, 長さ] */
export function toTaikoChart(chart, song) {
  const src = chart.notes;
  const grid = song.grid, off = song.gridOffset, phase = song.barPhase;
  /** 小節内の16分位置（グリッドから外れていたら -1） */
  const posOf = (t) => {
    const gi = Math.round((t - off) / grid);
    if (Math.abs(t - (off + gi * grid)) > 0.045) return -1;
    return (((gi - phase) % 16) + 16) % 16;
  };

  // --- 連打区間を決める（長い伸ばしから順に、間隔をあけて採用）
  const cands = src.filter(a => a[2] === 1 && a[3] >= 0.55)
    .map(a => ({ t: a[0], dur: Math.min(a[3], 2.6) }))
    .sort((a, b) => b.dur - a.dur);
  const picked = [];
  for (const c of cands) {
    if (picked.some(r => c.t < r.t + r.dur + 1.6 && r.t < c.t + c.dur + 1.6)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.t - b.t);
  const rolls = [];
  for (const r of picked) {
    const prev = rolls[rolls.length - 1];
    if (!prev || r.t - (prev.t + prev.dur) > 5.0) rolls.push(r);
  }
  const inRoll = (t) => rolls.some(r => t > r.t + 0.02 && t <= r.t + r.dur + 0.14);

  // --- 残りを同時刻でまとめ、ドン／カを決める
  const out = rolls.map(r => [+r.t.toFixed(4), DON, T_ROLL, +r.dur.toFixed(3)]);
  const hits = [];
  let i = 0, run = 0, last = -1;
  while (i < src.length) {
    const t = src[i][0];
    let j = i;
    while (j < src.length && src[j][0] - t < 0.020) j++;
    if (!inRoll(t) && !rolls.some(r => Math.abs(r.t - t) < 0.02)) {
      const group = src.slice(i, j);
      const big = group.some(n => n[2] === 2) || group.length >= 2;
      const bands = group.map(n => n[4]);
      const p = posOf(t);
      let kind;
      if (bands.includes(0)) kind = DON;            // キックは必ずドン
      else if (p < 0) kind = KA;                    // グリッド外の細かい音はカ
      else if (p % 4 === 0) kind = DON;             // 表拍
      else if (p % 4 === 2) kind = KA;              // 裏拍
      else kind = last === DON ? KA : DON;          // 16分は交互に
      // 同じ側が続きすぎたら折る（キック以外）
      if (kind === last) run++; else run = 1;
      if (run >= 5 && !bands.includes(0)) { kind = kind === DON ? KA : DON; run = 1; }
      last = kind;
      hits.push([+t.toFixed(4), kind, big ? T_BIG : T_SMALL, 0]);
    }
    i = j;
  }
  out.push(...hits);
  out.sort((a, b) => a[0] - b[0]);

  // 連打の終わりが次のノーツに重ならないよう詰める
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k][2] !== T_ROLL) continue;
    const room = out[k + 1][0] - out[k][0] - 0.20;
    if (out[k][3] > room) out[k][3] = Math.max(0, +room.toFixed(3));
    if (out[k][3] < 0.4) { out[k][2] = T_SMALL; out[k][3] = 0; }
  }

  const count = out.length;
  return {
    ...chart,
    notes: out,
    count: count,
    holds: out.filter(n => n[2] === T_ROLL).length,
    cuts: out.filter(n => n[2] === T_BIG).length,
    dons: out.filter(n => n[1] === DON && n[2] !== T_ROLL).length,
    kas: out.filter(n => n[1] === KA && n[2] !== T_ROLL).length,
    nps: +(count / Math.max(1, (out[count - 1][0] - out[0][0]))).toFixed(2),
  };
}

/* =========================================================================
   描画
   ========================================================================= */
const NUM = '"Chakra Petch",Bahnschrift,"DIN Alternate",system-ui,sans-serif';
const JP = '"Zen Kaku Gothic New","Yu Gothic UI","Hiragino Sans",system-ui,sans-serif';

const C_DON = { core: '#ff2e86', lite: '#ff8fc0', glow: 'rgba(255,46,134,.75)' };
const C_KA = { core: '#1fe6ff', lite: '#9ef4ff', glow: 'rgba(31,230,255,.75)' };
const C_ROLL = { core: '#ffc24a', lite: '#ffe7b0', glow: 'rgba(255,194,74,.7)' };

export class TaikoRenderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.rings = [];
    this.flies = [];
    this.judgePop = { t: -9, j: 0, big: false };
    this.rollPop = { t: -9, n: 0 };
    this.hitFlash = 0;
    this.w = 0; this.h = 0;
  }

  resize(w, h, dpr, padH) {
    this.padH = padH || 0;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h; this.dpr = dpr;
    const portrait = h / w > 1.15;
    const avail = h - this.padH;
    const narrow = w < 620;
    this.laneH = Math.max(66, Math.min(portrait ? 132 : 168, avail * 0.26, w * 0.15));
    // 上のHUD（細い画面では2段）と判定文字がぶつからない位置まで下げる
    const hudH = w < 620 ? 88 : 58;
    this.laneY = Math.min(
      Math.max(avail * (portrait ? 0.44 : 0.50), hudH + this.laneH * 0.95),
      Math.max(this.laneH * 0.72, avail - this.laneH * 0.62));
    this.judgeX = Math.max(66, Math.min(w * 0.185, 270));
    this.judgeY = this.laneY;
    // 狭い画面は音符が重なるので、小さくしてスクロールも詰める
    this.rSmall = Math.min(this.laneH * 0.27, w * 0.044);
    this.rBig = this.rSmall * 1.5;
    this.leadMul = narrow ? 1.30 : 2.0;
  }

  xAt(dt, lead) { return this.judgeX + (dt / lead) * (this.w + this.rBig * 2 - this.judgeX); }

  hit(kind, judge, big) {
    const col = kind === KA ? C_KA : C_DON;
    const x = this.judgeX, y = this.laneY;
    this.rings.push({ x, y, r: this.rSmall * .7, max: (big ? this.rBig : this.rSmall) * 3.2, a: 1, col: col.lite, w: big ? 4 : 2.6 });
    this.flies.push({ x, y, vx: 520 + Math.random() * 170, vy: -430 - Math.random() * 110, r: big ? this.rBig : this.rSmall, a: 1, big: !!big, kind });
    const n = big ? 20 : 9;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.6;
      const sp = (big ? 300 : 190) * (0.4 + Math.random());
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, dec: 2.6 + Math.random(), col: col.lite, sz: (big ? 3.4 : 2.4) * (0.5 + Math.random()) });
    }
    this.judgePop = { t: 0, j: judge, big: !!big };
    this.hitFlash = 1;
  }

  missPop(j) { this.judgePop = { t: 0, j: j, big: false }; }

  roll(count) {
    this.rollPop = { t: 0, n: count };
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.2;
      const sp = 220 * (0.4 + Math.random());
      this.parts.push({ x: this.judgeX, y: this.laneY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .8, dec: 2.9, col: C_ROLL.lite, sz: 2.6 });
    }
    this.hitFlash = Math.max(this.hitFlash, .7);
  }

  // ------------------------------------------------------------------ 本体
  draw(g, dt) {
    if (!g) return;               // 終了と同時にフレームが来ても落ちないように
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    const t = g.gameTime;
    const lead = g.lead * (this.leadMul || 2.0);
    const ly = this.laneY, lh = this.laneH;
    const top = ly - lh / 2, bot = ly + lh / 2;
    const glow = .4 + .6 * g.hype;

    // ---------------------------------------------------------- レーン
    const lg = c.createLinearGradient(0, top, 0, bot);
    lg.addColorStop(0, 'rgba(5,8,16,.70)');
    lg.addColorStop(.5, 'rgba(8,12,22,.44)');
    lg.addColorStop(1, 'rgba(5,8,16,.72)');
    c.fillStyle = lg;
    c.fillRect(0, top, w, lh);
    const rail = (yy) => {
      const rg = c.createLinearGradient(0, 0, w, 0);
      rg.addColorStop(0, 'rgba(255,255,255,.02)');
      rg.addColorStop(.14, 'rgba(255,255,255,.2)');
      rg.addColorStop(.8, 'rgba(255,255,255,.08)');
      rg.addColorStop(1, 'rgba(255,255,255,.015)');
      c.fillStyle = rg; c.fillRect(0, yy, w, 1);
    };
    rail(top - 1); rail(bot);

    // 小節線
    if (g.bars) {
      for (const bt of g.bars) {
        const d = bt - t;
        if (d < -0.3 || d > lead) continue;
        const x = this.xAt(d, lead);
        c.fillStyle = 'rgba(255,255,255,.12)';
        c.fillRect(Math.round(x), top + 5, 1, lh - 10);
      }
    }

    // ---------------------------------------------------------- 判定点
    c.save();
    // 手前に溜まる光
    const bl = c.createLinearGradient(this.judgeX - this.rBig * 2.6, 0, this.judgeX + this.rBig * 2.6, 0);
    bl.addColorStop(0, 'rgba(31,230,255,0)');
    bl.addColorStop(.5, 'rgba(31,230,255,' + (.10 * glow).toFixed(3) + ')');
    bl.addColorStop(1, 'rgba(31,230,255,0)');
    c.fillStyle = bl;
    c.fillRect(this.judgeX - this.rBig * 2.6, top, this.rBig * 5.2, lh);
    // 縦のいま線
    c.fillStyle = 'rgba(255,255,255,' + (.26 + .3 * glow).toFixed(3) + ')';
    c.fillRect(Math.round(this.judgeX), top - 7, 1, lh + 14);
    // 的（二重の輪）
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(255,255,255,' + (.30 + .25 * glow).toFixed(3) + ')';
    c.beginPath(); c.arc(this.judgeX, ly, this.rBig, 0, 6.2832); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.beginPath(); c.arc(this.judgeX, ly, this.rSmall, 0, 6.2832); c.stroke();
    if (this.hitFlash > .01) {
      c.beginPath(); c.arc(this.judgeX, ly, this.rBig * 1.02, 0, 6.2832);
      c.fillStyle = 'rgba(255,255,255,' + (.16 * this.hitFlash).toFixed(3) + ')'; c.fill();
      this.hitFlash = Math.max(0, this.hitFlash - dt * 5.5);
    }
    c.restore();

    // ---------------------------------------------------------- ノーツ
    const notes = g.notes;
    const vis = [];
    for (let i = g.drawFrom; i < notes.length; i++) {
      const n = notes[i];
      const d = n.t - t;
      if (d > lead + .1) break;
      if (n.dead && n.type !== T_ROLL) continue;
      if (n.type === T_ROLL && t > n.t + n.dur + .2) continue;
      if (d < -.35 && n.type !== T_ROLL) continue;
      vis.push(n);
    }
    for (const n of vis) if (n.type === T_ROLL) this.drawRoll(c, n, t, lead);
    for (let i = vis.length - 1; i >= 0; i--) {
      const n = vis[i];
      if (n.type !== T_ROLL) this.drawNote(c, n, t, lead);
    }

    // ---------------------------------------------------------- 飛ぶ音符
    c.save();
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1500 * dt; f.a -= dt * 1.6;
      if (f.a <= 0 || f.y > h) { this.flies.splice(i, 1); continue; }
      c.globalAlpha = Math.max(0, f.a);
      this.mark(c, f.x, f.y, f.r, f.kind, f.big, false);
    }
    c.restore();

    // ---------------------------------------------------------- 粒子・輪
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.life -= p.dec * dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.sz * p.life, 0, 6.2832); c.fill();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 11); r.a -= dt * 3.1;
      if (r.a <= 0) { this.rings.splice(i, 1); continue; }
      c.globalAlpha = Math.max(0, r.a) * .65;
      c.strokeStyle = r.col; c.lineWidth = Math.max(1, r.w * r.a);
      c.beginPath(); c.arc(r.x, r.y, r.r, 0, 6.2832); c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;

    // ---------------------------------------------------------- 文字
    this.drawText(c, g, dt, top, bot, ly, lh);
  }

  /** ドン＝塗り／カ＝輪。どちらも細いリムとグローで他の画面と揃える */
  mark(c, x, y, r, kind, big, approach) {
    const col = kind === KA ? C_KA : C_DON;
    c.save();
    // 影で浮かせる
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = r * .5; c.shadowOffsetY = r * .12;
    if (kind === KA) {
      c.beginPath(); c.arc(x, y, r * .97, 0, 6.2832);
      c.fillStyle = 'rgba(6,10,20,.62)'; c.fill();
    } else {
      const g = c.createRadialGradient(x - r * .3, y - r * .34, r * .08, x, y, r);
      g.addColorStop(0, col.lite);
      g.addColorStop(.52, col.core);
      g.addColorStop(1, 'rgba(90,6,40,.92)');
      c.beginPath(); c.arc(x, y, r, 0, 6.2832);
      c.fillStyle = g; c.fill();
    }
    c.restore();

    c.save();
    c.shadowColor = col.glow; c.shadowBlur = r * (big ? .75 : .55);
    c.lineWidth = Math.max(2, r * (kind === KA ? .22 : .13));
    c.strokeStyle = kind === KA ? col.core : col.lite;
    c.beginPath(); c.arc(x, y, r - c.lineWidth * .5, 0, 6.2832); c.stroke();
    c.restore();

    if (kind === KA) {
      // 内側の細い線で芯を作る
      c.lineWidth = Math.max(1, r * .06);
      c.strokeStyle = 'rgba(255,255,255,.4)';
      c.beginPath(); c.arc(x, y, r * .50, 0, 6.2832); c.stroke();
    } else {
      c.lineWidth = Math.max(1, r * .06);
      c.strokeStyle = 'rgba(255,255,255,.45)';
      c.beginPath(); c.arc(x, y, r * .62, Math.PI * 1.06, Math.PI * 1.72); c.stroke();
    }
    if (big) {
      c.lineWidth = 1.2;
      c.strokeStyle = kind === KA ? 'rgba(158,244,255,.5)' : 'rgba(255,143,192,.5)';
      c.beginPath(); c.arc(x, y, r * 1.14, 0, 6.2832); c.stroke();
    }
    void approach;
  }

  drawNote(c, n, t, lead) {
    const x = this.xAt(n.t - t, lead);
    if (x < -this.rBig * 2 || x > this.w + this.rBig * 2) return;
    const big = n.type === T_BIG;
    const r = big ? this.rBig : this.rSmall;
    const fade = Math.max(0, Math.min(1, (this.w + this.rBig - x) / (this.rBig * 2.2)));
    c.save();
    c.globalAlpha = fade;
    this.mark(c, x, this.laneY, r, n.kind, big, true);
    c.restore();
  }

  drawRoll(c, n, t, lead) {
    const x0 = this.xAt(n.t - t, lead);
    const x1 = this.xAt(n.t + n.dur - t, lead);
    const r = this.rSmall * .94;
    const active = n.rollActive;
    const ly = this.laneY;
    c.save();
    c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
    c.beginPath();
    c.moveTo(x0, ly - r); c.lineTo(x1, ly - r);
    c.arc(x1, ly, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x0, ly + r);
    c.arc(x0, ly, r, Math.PI / 2, -Math.PI / 2);
    c.closePath();
    const gd = c.createLinearGradient(0, ly - r, 0, ly + r);
    gd.addColorStop(0, active ? 'rgba(255,231,176,.95)' : 'rgba(255,231,176,.72)');
    gd.addColorStop(.55, C_ROLL.core);
    gd.addColorStop(1, 'rgba(120,76,0,.9)');
    c.fillStyle = gd; c.fill();
    c.restore();
    // リム
    c.save();
    c.shadowColor = C_ROLL.glow; c.shadowBlur = active ? 16 : 8;
    c.lineWidth = Math.max(1.4, r * .12);
    c.strokeStyle = 'rgba(255,238,190,.92)';
    c.beginPath();
    c.moveTo(x0, ly - r + c.lineWidth * .5); c.lineTo(x1, ly - r + c.lineWidth * .5);
    c.moveTo(x0, ly + r - c.lineWidth * .5); c.lineTo(x1, ly + r - c.lineWidth * .5);
    c.stroke();
    c.restore();
    // 流れる矢羽
    c.save();
    c.beginPath();
    c.moveTo(x0, ly - r); c.lineTo(x1, ly - r);
    c.arc(x1, ly, r, -Math.PI / 2, Math.PI / 2);
    c.lineTo(x0, ly + r);
    c.arc(x0, ly, r, Math.PI / 2, -Math.PI / 2);
    c.closePath(); c.clip();
    c.globalAlpha = active ? .5 : .28;
    c.strokeStyle = '#4a2c00';
    c.lineWidth = Math.max(1.4, r * .16);
    const ph = (t * 2.2) % 1;
    for (let k = -1; k < 14; k++) {
      const bx = x0 + (k + ph) * r * 1.5;
      if (bx < x0 - r || bx > x1 + r) continue;
      c.beginPath();
      c.moveTo(bx - r * .32, ly - r * .45);
      c.lineTo(bx + r * .22, ly);
      c.lineTo(bx - r * .32, ly + r * .45);
      c.stroke();
    }
    c.restore();
  }

  drawText(c, g, dt, top, bot, ly, lh) {
    // 判定
    this.judgePop.t += dt;
    if (this.judgePop.t < .5) {
      const p = this.judgePop, k = Math.min(1, p.t / .12);
      const names = g.judgeTable.map(x => x.name).concat([g.missName]);
      const cols = ['#9ef4ff', '#39ff9e', '#ff4d6a'];
      c.save();
      c.globalAlpha = 1 - Math.max(0, (p.t - .3) / .2);
      c.font = '700 ' + Math.round(lh * .38) + 'px ' + JP;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const y = top - lh * .28 - (1 - k) * 8;
      c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 12;
      c.fillStyle = cols[Math.min(2, p.j)];
      c.fillText(names[p.j], this.judgeX, y);
      c.restore();
    }
    // 連打数
    this.rollPop.t += dt;
    if (this.rollPop.t < .6 && this.rollPop.n > 0) {
      c.save();
      c.globalAlpha = 1 - Math.max(0, (this.rollPop.t - .35) / .25);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 10;
      c.font = '700 ' + Math.round(lh * .3) + 'px ' + NUM;
      c.fillStyle = C_ROLL.core;
      c.fillText(this.rollPop.n, this.judgeX, bot + lh * .3);
      c.font = '500 ' + Math.round(lh * .13) + 'px ' + NUM;
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.fillText('R O L L', this.judgeX, bot + lh * .52);
      c.restore();
    }
    // コンボ
    if (g.combo >= 5) {
      c.save();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 14;
      // 上に出すと HUD とぶつかる高さしかない時は、レーンの下へ回す
      const above = ly - lh * 1.52;
      const cy = above < lh * 0.9 ? ly + lh * 1.12 : above;
      c.font = '600 ' + Math.round(lh * .56) + 'px ' + NUM;
      const grd = c.createLinearGradient(0, cy - lh * .3, 0, cy + lh * .3);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, g.combo >= 100 ? '#ff8fc0' : 'rgba(255,255,255,.75)');
      c.fillStyle = grd;
      c.fillText(g.combo, this.judgeX, cy);
      c.font = '600 ' + Math.round(lh * .13) + 'px ' + NUM;
      c.fillStyle = 'rgba(255,255,255,.4)';
      c.fillText('C O M B O', this.judgeX, cy + lh * .38);
      c.restore();
    }
  }
}
