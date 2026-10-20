/* ===========================================================================
   play.js — ゲーム本体（判定・スコア・HYPE・入力）
   時計はオーディオ。描画も判定も毎フレーム同じ gameTime を見る。
   モードは 2 種類：
     '4k'    … 4レーン縦スクロール
     'taiko' … 一本レーン横スクロール（ドン／カの区別なし）
   =========================================================================== */

/* --- スコア：全良フルコンボでちょうど 114514 になるように配る -----------------
   内訳  ノーツ素点 + 45×(大/CUT) + 810(大/CUT全キメ) + 514(全良) + 1145(フルコンボ)
   ノーツ素点は floor 配分＋余りを頭から1点ずつ足して、端数まで合わせる。        */
export const SCORE_TOTAL = 114514;
export const SCORE_FC = 1145;   // ミスなし
export const SCORE_AP = 514;    // 判定が全部いちばん上
export const SCORE_SP = 810;    // 大 / CUT を全部キメた
export const SCORE_BIG = 45;    // 大 / CUT ひとつ

export const JUDGE_SETS = {
  '4k': [
    { name: 'JUST', win: 0.028, w: 1.000, cls: 'c-just', hype: 0.014 },
    { name: 'COOL', win: 0.055, w: 0.810, cls: 'c-cool', hype: 0.010 },
    { name: 'GOOD', win: 0.090, w: 0.514, cls: 'c-good', hype: 0.004 },
    { name: 'BAD', win: 0.125, w: 0.114, cls: 'c-bad', hype: -0.035 },
  ],
  taiko: [
    { name: '良', win: 0.034, w: 1.000, cls: 'c-just', hype: 0.014 },
    { name: '可', win: 0.080, w: 0.514, cls: 'c-good', hype: 0.004 },
  ],
};
export const MISS_NAME = { '4k': 'MISS', taiko: '不可' };
export const MISS = { w: 0, cls: 'c-miss', hype: -0.07 };
export const JUDGE = JUDGE_SETS['4k'];

const BIG_WINDOW = 0.045;   // 大音符を2キーで取るときの猶予

export class Game {
  constructor(opt) {
    this.audio = opt.audio;
    this.video = opt.video;
    this.gfx = opt.gfx;
    this.rd = opt.renderer;
    this.song = opt.song;
    this.set = opt.settings;
    this.mods = opt.mods || {};
    this.hooks = opt.hooks || {};
    this.mode = opt.mode === 'taiko' ? 'taiko' : '4k';
    this.judgeTable = JUDGE_SETS[this.mode];
    this.missName = MISS_NAME[this.mode];
    this.missIdx = this.judgeTable.length;
    this.hitWin = this.judgeTable[this.judgeTable.length - 1].win;

    const sec = opt.section || null;
    this.section = sec;

    // ---- 譜面を展開
    const taiko = this.mode === 'taiko';
    const mirror = !!this.mods.mirror && !taiko;
    let raw = opt.chart.notes;
    if (sec) raw = raw.filter(a => a[0] >= sec.start - 0.001 && a[0] <= sec.end + 0.001);
    this.notes = raw.map(a => ({
      t: a[0],
      kind: taiko ? a[1] : 0,                       // 0=ドン 1=カ
      lane: taiko ? 0 : (a[1] < 0 ? -1 : (mirror ? 3 - a[1] : a[1])),
      type: a[2],
      dur: a[3] || 0,
      judged: false, holding: false, dead: false, result: -1, holdEnd: 0,
      rollActive: false, rollHits: 0, big: false,
    }));
    this.chartInfo = opt.chart;
    this.total = this.notes.length;
    this.bigCount = this.notes.filter(n => n.type === 2).length;
    const budget = SCORE_TOTAL - SCORE_FC - SCORE_AP - SCORE_SP - SCORE_BIG * this.bigCount;
    this.noteBudget = Math.max(0, budget);
    this.base = Math.floor(this.noteBudget / Math.max(1, this.total));
    this.rem = this.noteBudget - this.base * this.total;
    this.pts = 0; this.bigHits = 0; this._awarded = 0;

    // レーンごとの先頭ポインタ（判定用）。たいこは 1 本。
    this.qn = taiko ? 1 : 5;
    this.queues = []; for (let i = 0; i < this.qn; i++) this.queues.push([]);
    this.notes.forEach((n, i) => this.queues[taiko ? 0 : (n.lane < 0 ? 4 : n.lane)].push(i));
    this.heads = new Array(this.qn).fill(0);
    this.drawFrom = 0;

    // ---- 状態
    this.counts = new Array(this.judgeTable.length + 1).fill(0);
    this.combo = 0; this.maxCombo = 0;
    this.wSum = 0; this.comboSum = 0; this.done = 0; this.doneUnits = 0;
    this.score = 0; this.acc = 100;
    this.hype = 0.35;
    this.pressed = [false, false, false, false];
    this.devs = [];
    this.hypeLog = [];
    this.rollTotal = 0;
    this._hypeT = 0;
    this._big = null;
    this.gameTime = 0;
    this.finished = false;
    this.paused = false;

    // ---- 小節線
    const s = this.song;
    this.bars = [];
    const barLen = s.grid * 16;
    const b0 = s.gridOffset + s.barPhase * s.grid;
    for (let t = b0 - Math.ceil(b0 / barLen) * barLen; t < s.duration; t += barLen) if (t > 0) this.bars.push(t);

    // ---- 映像・音の反応用
    this.vis = s.vis;
    this.beatPulse = 0; this.cutPulse = 0;
    this._nextBeat = 0; this._nextCut = 0;
    this.beats = [];
    for (let t = s.gridOffset; t < s.duration; t += s.beat) if (t > 0) this.beats.push(t);

    this.lead = this.set.scroll;
    const first = sec ? sec.start : s.musicStart;
    this.startAt = (this.set.intro && !sec) ? 0 : Math.max(0, first - 3.6);
    const lastN = this.notes.length ? this.notes[this.notes.length - 1] : null;
    this.endAt = Math.min(s.duration, (lastN ? lastN.t + (lastN.dur || 0) : s.musicEnd) + 2.6);
    while (this._nextBeat < this.beats.length && this.beats[this._nextBeat] < this.startAt) this._nextBeat++;
    while (this._nextCut < s.cuts.length && s.cuts[this._nextCut] < this.startAt) this._nextCut++;
  }

  unitOf() { return 1; }

  /** ノーツ1個ぶんの素点を配る。判定が外れても枠は消費して配分をずらさない */
  _award(weight, big) {
    const i = this._awarded++;
    const v = this.base + (i < this.rem ? 1 : 0);
    let got = Math.round(v * weight);
    if (big && weight > 0) { got += SCORE_BIG; this.bigHits++; }
    this.pts += got;
    return got;
  }

  // ------------------------------------------------------------------ 開始
  async start() {
    const a = this.audio;
    a.setVolume(this.set.volume);
    a.setSfxVolume(this.set.hitsound ? this.set.hitvol : 0);
    await a.resume();
    await this.video.start(this.startAt);
    a.play(this.startAt, 0.18);
    this.running = true;
  }

  async pause() {
    if (this.paused || this.finished) return;
    this.paused = true;
    this.video.pause();
    await this.audio.suspend();
  }

  async resume() {
    if (!this.paused) return;
    const back = Math.max(this.startAt, this.gameTime - 1.6);
    this.audio.stop();
    await this.audio.resume();
    await this.video.start(back);
    this.audio.play(back, 0.25);
    this.paused = false;
  }

  stop() {
    this.running = false;
    this.audio.stop();
    this.video.pause();
  }

  // ------------------------------------------------------------------ 更新
  update(dt) {
    if (!this.running || this.paused) return;
    const offs = this.set.offset / 1000;
    const songT = this.audio.time;
    this.gameTime = songT - offs;
    const t = this.gameTime;

    if (this.mods.auto) this._auto(t);
    this._sweepMiss(t);
    if (this.mode === 'taiko') this._updateRoll(t); else this._updateHold(t);
    if (this._big && t - this._big.t > BIG_WINDOW) this._big = null;

    this.hype += (0.22 - this.hype) * 0.10 * dt;
    this.hype = Math.max(0, Math.min(1, this.hype));
    this._hypeT += dt;
    if (this._hypeT > 0.4) { this._hypeT = 0; this.hypeLog.push(+this.hype.toFixed(3)); }

    while (this.drawFrom < this.notes.length) {
      const n = this.notes[this.drawFrom];
      const end = n.t + (n.dur || 0);
      if (end < t - 0.5) this.drawFrom++; else break;
    }

    const vf = Math.min(this.vis.rms.length - 1, Math.max(0, Math.round(songT * this.vis.fps)));
    const bass = this.vis.low[vf] || 0, treble = this.vis.high[vf] || 0;
    while (this._nextBeat < this.beats.length && this.beats[this._nextBeat] <= songT) { this.beatPulse = 1; this._nextBeat++; }
    while (this._nextCut < this.song.cuts.length && this.song.cuts[this._nextCut] <= songT) { this.cutPulse = 1; this._nextCut++; }
    this.beatPulse = Math.max(0, this.beatPulse - dt * 4.2);
    this.cutPulse = Math.max(0, this.cutPulse - dt * 5.0);

    const p = this.gfx.p;
    const fx = this.mods.light ? Math.min(this.set.fx, 0.22) : this.set.fx;
    p.beat = this.beatPulse * (0.35 + 0.65 * bass) * fx;
    p.bass = bass * fx;
    p.treble = treble;
    p.hype = this.hype;
    p.cut = this.cutPulse * fx;
    p.dim = this.set.dim;
    p.fx = fx;
    p.glow = 0.35 + 0.65 * this.hype;
    p.flash = Math.max(0, (p.flash || 0) - dt * 4.0);
    p.judgeY = this.rd.judgeY / this.rd.h;
    p.band = this.mode === 'taiko' ? 1 : 0;

    if (songT >= this.endAt) this.finish();
  }

  // ------------------------------------------------------------------ 入力
  press(lane, time) {
    if (!this.running || this.paused || this.finished || this.mods.auto) return;
    const t = time - this.set.offset / 1000;
    if (lane >= 0) this.pressed[lane] = true;

    // 内側(F/J)＝ドン、外側(D/K)＝カ
    const kind = (lane === 1 || lane === 2 || lane < 0) ? 0 : 1;
    // 太鼓と同じで、空振りでも叩いた音は鳴らす。押した瞬間に出すのが一番速い。
    if (this.set.hitsound) this.audio.blip(this.mode === 'taiko' && kind === 1 ? 'ka' : 'don');
    if (this.mode === 'taiko') return this._pressTaiko(lane, t, kind);

    const cut = this._findNear(4, t);
    const own = lane >= 0 ? this._findNear(lane, t) : null;
    let target = null;
    if (cut && own) target = Math.abs(cut.d) <= Math.abs(own.d) ? cut : own;
    else target = cut || own;
    if (!target) { this.hooks.onEmpty && this.hooks.onEmpty(lane); return; }
    this._judge(target.n, target.d);
  }

  _pressTaiko(lane, t, kind) {
    // 直前に叩いた大音符を、同じ側の別キーで 45ms 以内に重ねたら「大」成立
    if (this._big && t - this._big.t <= BIG_WINDOW && this._big.lane !== lane && this._big.kind === kind) {
      const n = this._big.n;
      if (!n.big) {
        n.big = true;
        this.hype = Math.min(1, this.hype + 0.04);
        this._recalc();
        this.rd.hit(n.kind, n.result, true);
        if (this.set.hitsound) this.audio.blip('big');
        this.gfx.shock(this.rd.judgeX / this.rd.w, this.gfx.p.judgeY, 1);
        this.gfx.p.flash = 0.3 * (this.mods.light ? 0.22 : this.set.fx);
      }
      this._big = null;
      return;
    }
    // 連打中なら、まずそれを拾う
    const roll = this._activeRoll(t);
    if (roll) {
      roll.rollHits++; this.rollTotal++;
      this.hype = Math.min(1, this.hype + 0.004);
      this.rd.roll(roll.rollHits);
      return;
    }
    const near = this._findNear(0, t);
    if (!near) { this.hooks.onEmpty && this.hooks.onEmpty(lane); return; }
    if (near.n.kind !== kind) return this._wrongSide(near.n);   // ドンとカを取り違えたら不可
    this._judge(near.n, near.d, lane);
  }

  /** 逆の側で叩いてしまった音符。太鼓と同じく不可にして消す */
  _wrongSide(n) {
    n.judged = true; n.dead = true; n.result = this.missIdx;
    this.counts[this.missIdx]++; this.done++; this.doneUnits += 1;
    this._award(0, false);
    this.combo = 0;
    this.hype = Math.max(0, this.hype + MISS.hype);
    this._recalc(); this._advance(n);
    if (this.rd.missPop) this.rd.missPop(this.missIdx);
    this.hooks.onJudge && this.hooks.onJudge(this.missIdx, 0, n);
  }

  release(lane, time) {
    if (lane >= 0) this.pressed[lane] = false;
    if (!this.running || this.paused || this.mods.auto || this.mode === 'taiko') return;
    const t = time - this.set.offset / 1000;
    const arr = this.queues[lane] || [];
    for (let k = Math.max(0, this.heads[lane] || 0); k < arr.length; k++) {
      const n = this.notes[arr[k]];
      if (n.holding) {
        if (t < n.holdEnd - 0.14) this._breakHold(n);
        else { n.holding = false; n.dead = true; this.hype = Math.min(1, this.hype + 0.012); }
        break;
      }
    }
  }

  _activeRoll(t) {
    const arr = this.queues[0];
    for (let k = this.heads[0]; k < arr.length; k++) {
      const n = this.notes[arr[k]];
      if (n.type === 1 && n.rollActive) return n;
      if (n.t > t + 0.2) break;
    }
    return null;
  }

  _findNear(q, t) {
    const arr = this.queues[q];
    let best = null;
    for (let k = this.heads[q]; k < arr.length; k++) {
      const n = this.notes[arr[k]];
      if (n.judged || n.dead) continue;
      if (this.mode === 'taiko' && n.type === 1) continue;   // 連打は別扱い
      const d = t - n.t;
      if (d > this.hitWin) continue;
      if (d < -this.hitWin) break;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { n: n, d: d };
    }
    return best;
  }

  _judge(n, d, lane) {
    let j = this.missIdx;
    for (let i = 0; i < this.judgeTable.length; i++) if (Math.abs(d) <= this.judgeTable[i].win) { j = i; break; }
    const hit = j < this.judgeTable.length;
    n.judged = true; n.result = j;
    this.counts[j]++;
    this.wSum += hit ? this.judgeTable[j].w : 0;
    this.done++;
    this.doneUnits += (this.mode === 'taiko' && n.type === 2) ? 1 : this.unitOf(n);
    const comboOk = hit && (this.mode === 'taiko' || j <= this.judgeTable.length - 2);
    if (comboOk) { this.combo++; if (this.combo > this.maxCombo) this.maxCombo = this.combo; }
    else this.combo = 0;
    this.comboSum += this.combo;
    this.devs.push(+(d * 1000).toFixed(1));
    this.hype = Math.max(0, Math.min(1, this.hype + (hit ? this.judgeTable[j].hype : MISS.hype)));

    const big = n.type === 2;
    n.awarded = this._award(hit ? this.judgeTable[j].w : 0, big);
    if (this.mode === 'taiko') {
      n.dead = true;
      this._recalc();
      this._advance(n);
      this.rd.hit(n.kind, j, false);
      if (big && hit) this._big = { n: n, t: n.t + d, lane: lane == null ? -1 : lane, kind: n.kind };
      if (big && hit && this.set.hitsound) this.audio.blip('big');
      this.hooks.onJudge && this.hooks.onJudge(j, d, n);
      return;
    }

    if (n.type === 1 && hit) { n.holding = true; n.holdEnd = n.t + n.dur; }
    else if (n.type !== 1) n.dead = true;
    this._recalc();
    this._advance(n);
    this.rd.hit(n.lane, j, big);
    if (big) {
      this.gfx.shock(0.5, this.gfx.p.judgeY, 1);
      this.gfx.p.flash = 0.45 * (this.mods.light ? 0.22 : this.set.fx);
      this.hype = Math.min(1, this.hype + 0.03);
    }
    if (big && this.set.hitsound) this.audio.blip('big');
    this.hooks.onJudge && this.hooks.onJudge(j, d, n);
  }

  _breakHold(n) {
    n.holding = false; n.dead = true;
    if (n.result >= 0 && n.result < this.judgeTable.length) {
      this.counts[n.result]--; this.counts[this.missIdx]++;
      this.wSum -= this.judgeTable[n.result].w;
    }
    this.pts -= (n.awarded || 0); n.awarded = 0;
    this.combo = 0;
    this.hype = Math.max(0, this.hype - 0.05);
    this._recalc();
    this.hooks.onJudge && this.hooks.onJudge(this.missIdx, 0, n);
  }

  _updateHold(t) {
    for (let k = 0; k < this.qn; k++) {
      for (let i = this.heads[k]; i < this.queues[k].length; i++) {
        const n = this.notes[this.queues[k][i]];
        if (!n.holding) continue;
        if (t >= n.holdEnd) { n.holding = false; n.dead = true; this.hype = Math.min(1, this.hype + 0.012); }
        else if (Math.random() < 0.12) this.rd.parts.push({
          x: this.rd.laneX(n.lane, 1) + (Math.random() - .5) * this.rd.fieldW / 6,
          y: this.rd.judgeY, vx: (Math.random() - .5) * 60, vy: -110 - Math.random() * 90,
          life: .7, dec: 2.2, col: '#19ffb0', sz: 2,
        });
      }
    }
  }

  /** 連打の受付と終了処理 */
  _updateRoll(t) {
    const arr = this.queues[0];
    for (let i = this.heads[0]; i < arr.length; i++) {
      const n = this.notes[arr[i]];
      if (n.type !== 1 || n.dead) continue;
      if (n.t > t + 0.2) break;
      n.rollActive = (t >= n.t - 0.02 && t <= n.t + n.dur);
      if (t > n.t + n.dur) {
        n.rollActive = false;
        n.judged = true; n.dead = true;
        const ok = n.rollHits > 0;
        n.result = ok ? 0 : this.missIdx;
        this.counts[n.result]++;
        this.done++; this.doneUnits++;
        this.wSum += ok ? 1 : 0;
        n.awarded = this._award(ok ? 1 : 0, false);
        if (ok) { this.combo++; if (this.combo > this.maxCombo) this.maxCombo = this.combo; }
        else this.combo = 0;
        this.comboSum += this.combo;
        this._recalc();
        this.hooks.onJudge && this.hooks.onJudge(n.result, 0, n);
      }
    }
  }

  _sweepMiss(t) {
    for (let k = 0; k < this.qn; k++) {
      const arr = this.queues[k];
      while (this.heads[k] < arr.length) {
        const n = this.notes[arr[this.heads[k]]];
        if (n.dead) { this.heads[k]++; continue; }
        if (n.judged) { if (n.holding) break; this.heads[k]++; continue; }
        if (this.mode === 'taiko' && n.type === 1) {
          if (t > n.t + n.dur) { this.heads[k]++; continue; }
          break;
        }
        if (n.t < t - this.hitWin) {
          n.judged = true; n.dead = true; n.result = this.missIdx;
          this.counts[this.missIdx]++; this.done++; this.doneUnits += 1;
          this._award(0, false);
          this.combo = 0;
          this.hype = Math.max(0, this.hype + MISS.hype);
          this._recalc();
          this.heads[k]++;
          if (this.mode === 'taiko' && this.rd.missPop) this.rd.missPop(this.missIdx);
          this.hooks.onJudge && this.hooks.onJudge(this.missIdx, 0, n);
        } else break;
      }
    }
  }

  _advance(n) {
    const q = this.mode === 'taiko' ? 0 : (n.lane < 0 ? 4 : n.lane);
    const arr = this.queues[q];
    while (this.heads[q] < arr.length) {
      const m = this.notes[arr[this.heads[q]]];
      if (m.dead) { this.heads[q]++; continue; }
      if (m.judged && !m.holding) { this.heads[q]++; continue; }
      break;
    }
  }

  _auto(t) {
    for (let k = 0; k < this.qn; k++) {
      for (let i = this.heads[k]; i < this.queues[k].length; i++) {
        const n = this.notes[this.queues[k][i]];
        if (n.judged || n.dead) continue;
        if (this.mode === 'taiko' && n.type === 1) {
          if (n.rollActive && Math.random() < 0.55) { n.rollHits++; this.rollTotal++; this.rd.roll(n.rollHits); }
          continue;
        }
        if (n.t <= t) {
          if (this.set.hitsound) {
            this.audio.blip(n.type === 2 ? 'big' : (this.mode === 'taiko' && n.kind === 1 ? 'ka' : 'don'));
          }
          if (this.mode === 'taiko') {
            const lane = n.kind === 0 ? 1 : 0;      // ドンは内側、カは外側
            this.pressed[lane] = true;
            this._judge(n, 0, lane);
            if (this._big) this._pressTaiko(n.kind === 0 ? 2 : 3, n.t, n.kind);
            setTimeout(() => { this.pressed[lane] = false; }, 60);
          } else {
            const lane = n.lane >= 0 ? n.lane : 0;
            this.pressed[lane] = true;
            this._judge(n, 0, lane);
            setTimeout(() => { this.pressed[lane] = false; }, 60);
          }
        } else break;
      }
    }
  }

  _recalc() {
    this.score = this.pts;
    this.acc = this.done ? (this.wSum / this.done) * 100 : 100;
  }

  /** 最後に付くボーナス。全部そろうと合計がちょうど 114514 */
  bonuses() {
    const miss = this.counts[this.missIdx];
    const allTop = this.counts.slice(1).every(c => c === 0) && this.done > 0;
    return {
      fc: (this.done > 0 && miss === 0 &&
           (this.mode === 'taiko' || this.counts[this.judgeTable.length - 1] === 0)) ? SCORE_FC : 0,
      ap: allTop ? SCORE_AP : 0,
      sp: (this.bigCount > 0 && this.bigHits === this.bigCount) ? SCORE_SP : 0,
    };
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.audio.stop();
    this.video.pause();
    const acc = this.doneUnits ? this.wSum / this.doneUnits * 100 : 0;
    const devs = this.devs;
    const mean = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0;
    const sorted = devs.slice().sort((a, b) => a - b);
    const med = sorted.length ? sorted[sorted.length >> 1] : 0;
    const sd = devs.length ? Math.sqrt(devs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / devs.length) : 0;
    const miss = this.counts[this.missIdx];
    const worst = this.judgeTable.length - 1;
    const bo = this.bonuses();
    this.score = this.pts + bo.fc + bo.ap + bo.sp;
    const res = {
      mode: this.mode,
      breakdown: {
        notes: this.pts - SCORE_BIG * this.bigHits,
        big: SCORE_BIG * this.bigHits, bigHits: this.bigHits, bigCount: this.bigCount,
        fc: bo.fc, ap: bo.ap, sp: bo.sp, total: SCORE_TOTAL,
      },
      names: this.judgeTable.map(j => j.name).concat([this.missName]),
      wins: this.judgeTable.map(j => j.win),
      classes: this.judgeTable.map(j => j.cls).concat(['c-miss']),
      score: this.score,
      acc: +acc.toFixed(2),
      counts: this.counts.slice(),
      combo: this.maxCombo,
      total: this.total,
      rolls: this.rollTotal,
      full: miss === 0 && this.counts[worst] === 0,
      perfect: this.counts.slice(1).every(c => c === 0),
      devs: devs,
      meanDev: +mean.toFixed(1),
      medDev: +med.toFixed(1),
      sdDev: +sd.toFixed(1),
      hypeLog: this.hypeLog,
      hypeAvg: this.hypeLog.length ? +(this.hypeLog.reduce((a, b) => a + b, 0) / this.hypeLog.length * 100).toFixed(0) : 0,
      grade: grade(this.score, acc, miss),
      diff: this.chartInfo.id,
      mods: { ...this.mods },
    };
    this.hooks.onFinish && this.hooks.onFinish(res);
  }
}

export function grade(score, acc, miss) {
  const r = score / SCORE_TOTAL;
  if (miss === 0 && acc >= 99.5) return 'SSS';
  if (r >= 0.99) return 'SS';
  if (r >= 0.96) return 'S';
  if (r >= 0.92) return 'A';
  if (r >= 0.85) return 'B';
  if (r >= 0.75) return 'C';
  return 'D';
}
