/* ===========================================================================
   ui.js — 画面まわり（設定・リザルト描画）
   =========================================================================== */
import { settings, resetSettings, DEFAULT_SETTINGS } from './store.js?v=6b972638';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let current = 'load';
export function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $('#scr-' + name);
  if (el) el.classList.add('active');
  current = name;
  document.body.classList.toggle('playing', name === 'game');
  return el;
}
export const currentScreen = () => current;

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}
export function fmtScore(n) { return String(Math.max(0, Math.round(n))).padStart(6, '0'); }

/* ------------------------------------------------------------- 設定画面 */
export function buildSettings(onChange, audio) {
  const g = $('#settings-grid');
  g.innerHTML = '';
  const rows = [
    {
      k: 'scroll', label: 'ノーツ速度',
      desc: 'ノーツが出てから判定線に届くまでの時間。小さいほど速く・見やすくなります。たいこは約2倍の時間をかけて流れます。',
      min: 0.35, max: 1.6, step: 0.01,
      fmt: v => (1 / v).toFixed(2) + ' 倍速　(' + Math.round(v * 1000) + 'ms)',
    },
    {
      k: 'offset', label: '判定オフセット',
      desc: '＋にすると判定が遅く（遅れて叩く人向け）。CALIBRATE で自動計測できます。',
      min: -150, max: 150, step: 1, fmt: v => (v > 0 ? '+' : '') + v + ' ms',
    },
    { k: 'volume', label: '曲の音量', desc: '', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    {
      k: 'hitvol', label: '打撃音の音量',
      desc: '叩いたときのドン／カの大きさ。曲に対して埋もれるときは上げてください。',
      min: 0, max: 2.5, step: 0.05, fmt: v => Math.round(v * 100) + '%',
    },
    { k: 'dim', label: '映像の暗さ', desc: 'MVを暗くするほどノーツが見やすくなります。', min: 0, max: .85, step: .01, fmt: v => Math.round(v * 100) + '%' },
    { k: 'fx', label: 'エフェクト強度', desc: '衝撃波・色収差・ブルームの量。重いときは下げてください。', min: 0, max: 1.4, step: .05, fmt: v => Math.round(v * 100) + '%' },
    { k: 'persp', label: '奥行き（4レーン）', desc: 'ハイウェイのパース。0で真っすぐ落ちてきます。', min: 0, max: 1, step: .02, fmt: v => Math.round(v * 100) + '%' },
  ];
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<h4>' + r.label + '<em id="v-' + r.k + '">' + r.fmt(settings[r.k]) + '</em></h4>' +
      (r.desc ? '<p>' + r.desc + '</p>' : '') +
      '<input type="range" min="' + r.min + '" max="' + r.max + '" step="' + r.step + '" value="' + settings[r.k] + '">';
    const inp = $('input', row);
    inp.addEventListener('input', () => {
      settings[r.k] = +inp.value;
      $('#v-' + r.k, row).textContent = r.fmt(+inp.value);
      onChange && onChange(r.k);
    });
    g.appendChild(row);
  }

  g.appendChild(segRow('映像の画質', '重いときは 720p、映像なしでも遊べます。', [
    ['hi', '1080p'], ['lo', '720p'], ['off', 'OFF'],
  ], 'quality', onChange));
  g.appendChild(toggleRow('打鍵音', '叩いたときのクリック音。タイミングの手掛かりになります。', 'hitsound', onChange));
  g.appendChild(toggleRow('FAST / SLOW 表示', '判定が早かったか遅かったかを毎回出します（4レーンのみ）。', 'showFast', onChange));
  g.appendChild(toggleRow('MV冒頭から再生', 'オフなら曲の直前（0:09）から始まります。', 'intro', onChange));

  const kr = document.createElement('div');
  kr.className = 'set-row';
  kr.innerHTML = '<h4>キー配置<em>4 レーン</em></h4>' +
    '<p>ボタンを押してから、割り当てたいキーを押してください。たいこモードではこの4つとスペースが全部「叩く」になります。</p>' +
    '<div class="keybind">' + settings.keys.map((k, i) => '<button data-i="' + i + '">' + keyLabel(k) + '</button>').join('') + '</div>';
  $$('button', kr).forEach(b => b.addEventListener('click', () => {
    $$('button', kr).forEach(x => x.classList.remove('wait'));
    b.classList.add('wait');
    const h = (e) => {
      e.preventDefault();
      const keys = settings.keys.slice();
      keys[+b.dataset.i] = e.code;
      settings.keys = keys;
      b.textContent = keyLabel(e.code);
      b.classList.remove('wait');
      window.removeEventListener('keydown', h, true);
      onChange && onChange('keys');
    };
    window.addEventListener('keydown', h, true);
  }));
  g.appendChild(kr);

  $('#btn-reset').onclick = () => { resetSettings(); buildSettings(onChange, audio); onChange && onChange('*'); };
}

function segRow(label, desc, opts, key, onChange) {
  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = '<h4>' + label + '</h4><p>' + desc + '</p><div class="seg">' +
    opts.map(([v, t]) => '<button data-v="' + v + '" class="' + (settings[key] === v ? 'on' : '') + '">' + t + '</button>').join('') + '</div>';
  $$('button', row).forEach(b => b.addEventListener('click', () => {
    settings[key] = b.dataset.v;
    $$('button', row).forEach(x => x.classList.toggle('on', x === b));
    onChange && onChange(key);
  }));
  return row;
}
function toggleRow(label, desc, key, onChange) {
  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = '<h4>' + label + '</h4><p>' + desc + '</p><div class="seg">' +
    '<button data-v="1" class="' + (settings[key] ? 'on' : '') + '">ON</button>' +
    '<button data-v="0" class="' + (!settings[key] ? 'on' : '') + '">OFF</button></div>';
  $$('button', row).forEach(b => b.addEventListener('click', () => {
    settings[key] = b.dataset.v === '1';
    $$('button', row).forEach(x => x.classList.toggle('on', x === b));
    onChange && onChange(key);
  }));
  return row;
}
export function keyLabel(code) {
  return code.replace('Key', '').replace('Digit', '').replace('Arrow', '')
    .replace('Semicolon', ';').replace('Space', '␣').replace('Comma', ',').replace('Period', '.')
    .replace('Slash', '/').replace('Quote', "'").replace('BracketLeft', '[').replace('BracketRight', ']');
}

/* ------------------------------------------------------------- リザルト */
export function renderResult(res, song, diff, isBest, prevBest) {
  $('#r-title').textContent = song.title;
  $('#r-diff').textContent = diff.entry + '　/　' + diff.name + '　Lv' + diff.level +
    (res.mods.auto ? '　/ AUTO' : '') + (res.mods.mirror ? '　/ MIRROR' : '');
  $('#r-grade').textContent = res.grade;
  $('#r-score').textContent = fmtScore(res.score);
  $('#r-best').textContent = res.mods.auto ? 'AUTO PLAY（記録なし）'
    : isBest ? '★ NEW RECORD' : prevBest ? 'BEST ' + fmtScore(prevBest.score) : '';

  const b = res.breakdown;
  if (b) {
    const row = (lab, val, on) =>
      '<span class="' + (on ? 'on' : '') + '"><em>' + lab + '</em><b>' + (val > 0 ? '+' : '') + val + '</b></span>';
    $('#r-break').innerHTML =
      '<span class="base"><em>ノーツ素点</em><b>' + b.notes + '</b></span>' +
      row('大 / CUT ×' + b.bigHits, b.big, b.bigHits > 0) +
      row('全キメ', b.sp, b.sp > 0) +
      row('全良', b.ap, b.ap > 0) +
      row('フルコンボ', b.fc, b.fc > 0) +
      '<span class="cap"><em>満点</em><b>' + b.total + '</b></span>';
  }

  const names = res.names, cls = res.classes;
  const mx = Math.max(1, ...res.counts);
  $('#r-judges').innerHTML =
    names.map((n, i) => '<div class="jrow ' + cls[i] + '"><b>' + n + '</b>' +
      '<i><em style="width:' + (res.counts[i] / mx * 100) + '%"></em></i>' +
      '<span>' + res.counts[i] + '</span></div>').join('') +
    '<div class="jrow"><b>COMBO</b><i></i><span>' + res.combo + '</span></div>' +
    '<div class="jrow"><b>ACCURACY</b><i></i><span>' + res.acc.toFixed(2) + '%</span></div>' +
    (res.mode === 'taiko' && res.rolls ? '<div class="jrow c-good"><b>連打</b><i></i><span>' + res.rolls + '</span></div>' : '') +
    '<div class="jrow"><b>MV HYPE</b><i></i><span>' + res.hypeAvg + '%</span></div>' +
    (res.perfect ? '<div class="jrow c-just"><b>ALL ' + names[0] + '</b><i></i><span>★</span></div>'
      : res.full ? '<div class="jrow c-cool"><b>FULL COMBO</b><i></i><span>★</span></div>' : '');

  drawTiming($('#r-timing'), res.devs, res.wins || [0.028, 0.055, 0.090, 0.125]);
  drawHype($('#r-life'), res.hypeLog);
  $('#r-mean').textContent = (res.meanDev > 0 ? '+' : '') + res.meanDev + 'ms (σ' + res.sdDev + ')';
  $('#r-end').textContent = fmtTime(song.musicEnd - song.musicStart);

  const m = res.medDev;
  let advice;
  if (res.devs.length < 20) advice = 'もう少し叩くと、ズレの傾向を出せます。';
  else if (Math.abs(m) >= 12) {
    const sug = Math.round(settings.offset + m);
    advice = '平均して <b>' + (m > 0 ? m + 'ms 遅い' : (-m) + 'ms 早い') + '</b>です。' +
      '判定オフセットを <b>' + (sug > 0 ? '+' : '') + sug + 'ms</b> にすると中心に寄ります。' +
      '<button class="start-btn ghost" id="r-apply" style="margin-left:14px;padding:7px 18px">この値にする</button>';
  } else if (res.sdDev < 26) advice = 'ズレ幅 σ' + res.sdDev + 'ms。かなり安定しています。速度を上げても追えます。';
  else advice = 'ズレの中心は合っています。σ' + res.sdDev + 'ms なので、精度を詰めるなら速度を少し上げると取りやすくなります。';
  $('#r-advice').innerHTML = advice;
  const ap = $('#r-apply');
  if (ap) ap.onclick = () => {
    settings.offset = Math.max(-150, Math.min(150, Math.round(settings.offset + m)));
    ap.textContent = '設定しました（' + (settings.offset > 0 ? '+' : '') + settings.offset + 'ms）';
    ap.disabled = true;
  };
}

function dpi(cv) {
  const r = cv.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(10, r.width * d); cv.height = Math.max(10, r.height * d);
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
  return { c: c, w: r.width, h: r.height };
}

function drawTiming(cv, devs, wins) {
  const { c, w, h } = dpi(cv);
  c.clearRect(0, 0, w, h);
  const RANGE = Math.max(130, Math.round(wins[wins.length - 1] * 1000 + 25));
  const BIN = 5;
  const n = Math.ceil(RANGE * 2 / BIN);
  const bins = new Array(n).fill(0);
  for (const d of devs) {
    const i = Math.floor((d + RANGE) / BIN);
    if (i >= 0 && i < n) bins[i]++;
  }
  const mx = Math.max(1, ...bins);
  const zoneCols = ['rgba(125,249,255,.16)', 'rgba(57,255,158,.12)', 'rgba(255,210,0,.10)', 'rgba(255,155,61,.10)'];
  for (let i = wins.length - 1; i >= 0; i--) {
    const x0 = (0.5 - wins[i] * 1000 / (RANGE * 2)) * w, x1 = (0.5 + wins[i] * 1000 / (RANGE * 2)) * w;
    c.fillStyle = zoneCols[Math.min(zoneCols.length - 1, i)];
    c.fillRect(x0, 0, x1 - x0, h);
  }
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
  const bw = w / n;
  const barCols = ['#7df9ff', '#39ff9e', '#ffd200', '#ff9b3d'];
  for (let i = 0; i < n; i++) {
    if (!bins[i]) continue;
    const bh = bins[i] / mx * (h - 6);
    const center = Math.abs((i + .5) * BIN - RANGE) / 1000;
    let k = wins.findIndex(x => center <= x);
    if (k < 0) k = wins.length - 1;
    c.fillStyle = barCols[Math.min(barCols.length - 1, k)];
    c.fillRect(i * bw + .5, h - bh, bw - 1, bh);
  }
}

function drawHype(cv, log) {
  const { c, w, h } = dpi(cv);
  c.clearRect(0, 0, w, h);
  if (!log.length) return;
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#2f6fff'); g.addColorStop(.5, '#1fe6ff'); g.addColorStop(1, '#ff2e86');
  c.strokeStyle = g; c.lineWidth = 2;
  c.beginPath();
  log.forEach((v, i) => {
    const x = i / (log.length - 1 || 1) * w, y = h - v * (h - 4) - 2;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
  c.lineTo(w, h); c.lineTo(0, h); c.closePath();
  c.fillStyle = 'rgba(31,230,255,.10)'; c.fill();
}

export { DEFAULT_SETTINGS };
