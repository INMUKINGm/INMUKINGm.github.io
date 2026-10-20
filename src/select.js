/* ===========================================================================
   select.js — 選曲画面
   ・上＝モード（4レーン / たいこ）のセグメント
   ・中央＝曲。選んでいるものだけが開いて4つの難易度タイルが出る
   ・左＝自己ベスト、右＝選択中の譜面の中身（密度グラフつき）
   =========================================================================== */
import { settings, getBest } from './store.js';

export const MODES = [
  { id: '4k', name: '4レーン', en: '4 LANE', c1: '#1fe6ff', c2: '#6f8bff' },
  { id: 'taiko', name: 'たいこ', en: 'TAIKO', c1: '#ff6a3d', c2: '#ff2e86' },
];

export const DIFFS = [
  { id: 'normal', jp: 'ふつう', en: 'NORMAL', c: '#3ce8c0' },
  { id: 'hard', jp: 'むずかしい', en: 'HARD', c: '#39a7ff' },
  { id: 'oni', jp: 'おに', en: 'ONI', c: '#ffc24a' },
  { id: 'ura', jp: '裏', en: 'URA', c: '#b05cff' },
];

const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
/** 先頭のゼロを沈めて桁を読みやすくする */
function scoreHtml(n) {
  const s = String(Math.max(0, Math.round(n || 0))).padStart(6, '0');
  const m = /^(0*)(\d*)$/.exec(s);
  return (m[1] ? '<i>' + m[1] + '</i>' : '') + m[2];
}

export class SongSelect {
  constructor(opt) {
    this.song = opt.song;
    this.charts = opt.charts;
    this.entries = opt.entries;
    this.onStart = opt.onStart;
    this.onBack = opt.onBack;
    this.mode = Math.max(0, MODES.findIndex(m => m.id === settings.lastMode));
    this.entry = 0;
    this.diff = Math.max(0, DIFFS.findIndex(d => d.id === settings.lastDiff));

    this.elInner = document.getElementById('sel2-inner');
    this.elTrack = document.getElementById('ms-track');
    this.elRows = document.getElementById('rec-rows');
    this.elDetail = document.getElementById('rec-detail');
    this.elDetailHead = document.getElementById('rec-detail-head');
    this.elGraph = null;

    document.querySelectorAll('.ms-key').forEach(b =>
      b.addEventListener('click', () => this.moveMode(+b.dataset.mode)));
    this.elTrack.querySelectorAll('.ms-seg').forEach(b =>
      b.addEventListener('click', () => { this.mode = +b.dataset.i; this.apply(); }));
    document.querySelector('.list-arw.up').addEventListener('click', () => this.moveEntry(-1));
    document.querySelector('.list-arw.down').addEventListener('click', () => this.moveEntry(1));

    this.buildList();
    this.apply();
    window.addEventListener('resize', () => { this.center(); this.drawDensity(); });
  }

  key() { return MODES[this.mode].id + ':' + this.entries[this.entry].id + ':' + DIFFS[this.diff].id; }
  chart() { return this.charts[MODES[this.mode].id][DIFFS[this.diff].id]; }
  bestOf(mi, ei, di) { return getBest(MODES[mi].id + ':' + this.entries[ei].id + ':' + DIFFS[di].id); }

  /** 区間を考慮したノーツ数・密度 */
  stat(mi, ei, di) {
    const ch = this.charts[MODES[mi].id][DIFFS[di].id];
    const sec = this.entries[ei].section;
    const notes = sec ? ch.notes.filter(a => a[0] >= sec.start && a[0] <= sec.end) : ch.notes;
    const span = sec ? sec.end - sec.start : (this.song.musicEnd - this.song.musicStart);
    let peak = 0;
    for (let i = 0; i < notes.length; i++) {
      let j = i; while (j < notes.length && notes[j][0] - notes[i][0] < 1) j++;
      if (j - i > peak) peak = j - i;
    }
    const taiko = MODES[mi].id === 'taiko';
    const dons = taiko ? notes.filter(n => n[2] !== 1 && n[1] === 0).length : 0;
    const kas = taiko ? notes.filter(n => n[2] !== 1 && n[1] === 1).length : 0;
    return { notes: notes, count: notes.length, nps: notes.length / Math.max(1, span), peak: peak,
      span: span, level: ch.level, ch: ch, dons: dons, kas: kas,
      bigs: notes.filter(n => n[2] === 2).length, rolls: notes.filter(n => n[2] === 1).length };
  }

  // -------------------------------------------------------------- リスト
  buildList() {
    const s = this.song;
    this.elInner.innerHTML = this.entries.map((e, i) =>
      '<div class="s-item" data-i="' + i + '">' +
      '  <div class="s-bar"><span class="sb-mark"></span>' +
      '    <span class="sb-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
      '    <span class="sb-name">' + e.name + '</span><span class="sb-meta">' + e.sub + '</span></div>' +
      '  <div class="s-card bev"><div class="sc-in bev-in">' +
      '    <div class="sc-top">' +
      '      <div class="sc-jacket"><img src="' + s.video.cover + '" alt=""></div>' +
      '      <div class="sc-info">' +
      '        <div class="sc-title">' + s.title + '</div>' +
      '        <div class="sc-sub">' + s.subtitle + '</div>' +
      '        <div class="sc-meta"><span>' + e.name + '</span><span>BPM ' + s.bpm + '</span>' +
      '          <span>' + e.sub + '</span><span class="sc-cut"></span></div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="s-diffs"></div>' +
      '  </div></div>' +
      '</div>').join('');
    this.elInner.querySelectorAll('.s-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        const i = +el.dataset.i;
        if (i !== this.entry) { this.entry = i; this.apply(); return; }
        const tile = ev.target.closest('.dtile');
        if (tile) {
          const d = +tile.dataset.d;
          if (d === this.diff) this.start(); else { this.diff = d; this.apply(); }
        }
      });
    });
  }

  buildTiles() {
    const item = this.elInner.querySelector('.s-item[data-i="' + this.entry + '"]');
    if (!item) return;
    const host = item.querySelector('.s-diffs');
    const taiko = MODES[this.mode].id === 'taiko';
    host.innerHTML = DIFFS.map((d, i) => {
      const st = this.stat(this.mode, this.entry, i);
      const best = this.bestOf(this.mode, this.entry, i);
      const lv = Math.max(1, Math.min(12, Math.round(st.level / 20 * 12)));
      const meter = Array.from({ length: 12 }, (_, k) =>
        '<i class="' + (k < lv ? 'on' : '') + '"></i>').join('');
      return '<button class="dtile bev' + (i === this.diff ? ' sel' : '') + '" data-d="' + i + '" style="--c:' + d.c + '">' +
        '<span class="dt-in bev-in">' +
        '<span class="dt-en">' + d.en + '</span>' +
        '<span class="dt-grade' + (best ? '' : ' none') + '">' + (best ? best.grade : '–') + '</span>' +
        '<span class="dt-lv">' + st.level + '</span>' +
        '<span class="dt-meter">' + meter + '</span>' +
        '<span class="dt-foot"><em>' + d.jp + '</em><b>' + st.count + '</b></span>' +
        '</span></button>';
    }).join('');
    const cut = item.querySelector('.sc-cut');
    const st = this.stat(this.mode, this.entry, this.diff);
    if (cut) cut.textContent = taiko
      ? (st.dons + ' ドン / ' + st.kas + ' カ')
      : (st.ch.cuts + ' CUT');
  }

  // -------------------------------------------------------------- 記録欄
  buildRecords() {
    let cleared = 0, fc = 0, top = 0;
    this.elRows.innerHTML = DIFFS.map((d, i) => {
      const best = this.bestOf(this.mode, this.entry, i);
      if (best) { cleared++; if (best.full) fc++; if (best.score > top) top = best.score; }
      return '<div class="pb-row' + (i === this.diff ? ' sel' : '') + '" style="--c:' + d.c + '">' +
        '<span class="pb-dot"></span>' +
        '<span class="pb-name">' + d.jp + '</span>' +
        '<span class="pb-score">' + scoreHtml(best ? best.score : 0) + '</span>' +
        '<span class="pb-grade">' + (best ? best.grade : '') + '</span>' +
        '</div>';
    }).join('') +
      '<div class="pb-sum">' +
      '<div><dt>PLAYED</dt><dd>' + cleared + ' / 4</dd></div>' +
      '<div><dt>FULL COMBO</dt><dd>' + fc + ' / 4</dd></div>' +
      '<div><dt>HIGHEST</dt><dd>' + scoreHtml(top) + '</dd></div>' +
      '</div>';

    const d = DIFFS[this.diff];
    const st = this.stat(this.mode, this.entry, this.diff);
    const best = getBest(this.key());
    const taiko = MODES[this.mode].id === 'taiko';
    this.elDetailHead.textContent = d.jp + ' / ' + d.en;
    this.elDetail.style.setProperty('--c', d.c);
    this.elDetail.innerHTML =
      '<div class="rd-top">' +
      '  <div class="rd-grade' + (best ? ' has' : '') + '">' + (best ? best.grade : '–') + '</div>' +
      '  <div class="rd-top-right">' +
      '    <b>' + scoreHtml(best ? best.score : 0) + '</b>' +
      '    <span>' + (best ? best.acc.toFixed(2) + '%　' + best.combo + ' COMBO' + (best.full ? '　FC' : '') : 'まだ記録がありません') + '</span>' +
      '  </div>' +
      '</div>' +
      '<canvas class="rd-graph"></canvas>' +
      '<div class="rd-graph-lab"><span>DENSITY</span><span>' + fmtTime(st.span) + '</span></div>' +
      '<dl>' +
      '<div><dt>LEVEL</dt><dd>' + st.level + '</dd></div>' +
      '<div><dt>NOTES</dt><dd>' + st.count + '</dd></div>' +
      '<div><dt>AVG</dt><dd>' + st.nps.toFixed(2) + ' /s</dd></div>' +
      '<div><dt>PEAK</dt><dd>' + st.peak + ' /s</dd></div>' +
      (taiko
        ? '<div><dt>ドン / カ</dt><dd>' + st.dons + ' / ' + st.kas + '</dd></div>' +
          '<div><dt>大 / 連打</dt><dd>' + st.bigs + ' / ' + st.rolls + '</dd></div>'
        : '<div><dt>LONG / CUT</dt><dd>' + st.ch.holds + ' / ' + st.ch.cuts + '</dd></div>') +
      '</dl>';
    this.elGraph = this.elDetail.querySelector('.rd-graph');
    requestAnimationFrame(() => this.drawDensity());
  }

  /** 譜面の密度を時間軸で描く */
  drawDensity() {
    const cv = this.elGraph;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (r.width < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    c.clearRect(0, 0, w, h);

    const st = this.stat(this.mode, this.entry, this.diff);
    const sec = this.entries[this.entry].section;
    const a = sec ? sec.start : this.song.musicStart;
    const b = sec ? sec.end : this.song.musicEnd;
    const N = Math.max(24, Math.round(w / 3));
    const bins = new Float32Array(N);
    for (const n of st.notes) {
      const i = Math.floor((n[0] - a) / (b - a) * N);
      if (i >= 0 && i < N) bins[i]++;
    }
    const sm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, cnt = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(N - 1, i + 2); j++) { s += bins[j]; cnt++; }
      sm[i] = s / cnt;
    }
    let mx = 0; for (const v of sm) if (v > mx) mx = v;
    if (mx <= 0) return;

    const col = DIFFS[this.diff].c;
    const yAt = (i) => h - 2 - (sm[i] / mx) * (h - 7);
    c.beginPath();
    c.moveTo(0, h);
    for (let i = 0; i < N; i++) c.lineTo(i / (N - 1) * w, yAt(i));
    c.lineTo(w, h);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, col + '55');
    g.addColorStop(1, col + '0a');
    c.fillStyle = g; c.fill();
    c.beginPath();
    for (let i = 0; i < N; i++) { const x = i / (N - 1) * w; i ? c.lineTo(x, yAt(i)) : c.moveTo(x, yAt(i)); }
    c.strokeStyle = col; c.lineWidth = 1.4; c.globalAlpha = .95; c.stroke();
    c.globalAlpha = 1;
  }

  // -------------------------------------------------------------- 反映
  apply() {
    const m = MODES[this.mode];
    const root = document.documentElement.style;
    root.setProperty('--sel-c1', m.c1);
    root.setProperty('--sel-c2', m.c2);
    this.elTrack.dataset.i = String(this.mode);
    this.elTrack.querySelectorAll('.ms-seg').forEach((b, i) => b.classList.toggle('on', i === this.mode));
    settings.lastMode = m.id;
    settings.lastDiff = DIFFS[this.diff].id;

    const st = this.stat(this.mode, this.entry, this.diff);
    document.getElementById('sh-song-title').textContent = this.song.title;
    document.getElementById('sh-song-meta').textContent =
      'BPM ' + this.song.bpm + '　/　' + this.entries[this.entry].name + '　/　' + DIFFS[this.diff].jp + ' Lv' + st.level;

    this.elInner.querySelectorAll('.s-item').forEach((el, i) => el.classList.toggle('sel', i === this.entry));
    this.buildTiles();
    this.buildRecords();
    requestAnimationFrame(() => this.center());
  }

  center() {
    const sel = this.elInner.querySelector('.s-item.sel');
    if (!sel) return;
    const wrap = this.elInner.parentElement;
    const y = sel.offsetTop + sel.offsetHeight / 2;
    this.elInner.style.transform = 'translateY(' + (wrap.clientHeight / 2 - y) + 'px)';
  }

  // -------------------------------------------------------------- 操作
  moveMode(d) { this.mode = (this.mode + d + MODES.length) % MODES.length; this.apply(); }
  moveEntry(d) { this.entry = (this.entry + d + this.entries.length) % this.entries.length; this.apply(); }
  moveDiff(d) { this.diff = (this.diff + d + DIFFS.length) % DIFFS.length; this.apply(); }

  start() {
    this.onStart({
      mode: MODES[this.mode].id,
      entry: this.entries[this.entry],
      diff: DIFFS[this.diff].id,
      chart: this.chart(),
    });
  }

  handleKey(e) {
    switch (e.code) {
      case 'ArrowUp': this.moveEntry(-1); break;
      case 'ArrowDown': this.moveEntry(1); break;
      case 'ArrowLeft': this.moveDiff(-1); break;
      case 'ArrowRight': this.moveDiff(1); break;
      case 'KeyQ': this.moveMode(-1); break;
      case 'KeyE': this.moveMode(1); break;
      case 'Enter': case 'Space': this.start(); break;
      case 'Escape': this.onBack(); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }
}
