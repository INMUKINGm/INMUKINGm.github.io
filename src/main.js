/* ===========================================================================
   main.js — 起動・メインループ・入力
   =========================================================================== */
import { AudioEngine } from './audio.js';
import { VideoSync } from './video.js';
import { Gfx } from './gfx.js';
import { Renderer } from './render.js';
import { TaikoRenderer, toTaikoChart } from './taiko.js';
import { Game } from './play.js';
import { settings, getBest, saveBest } from './store.js';
import { SongSelect, MODES, DIFFS } from './select.js';
import { $, $$, showScreen, currentScreen, buildSettings, renderResult, fmtScore, fmtTime, keyLabel } from './ui.js';

const audio = new AudioEngine();
const videoEl = $('#video');
const video = new VideoSync(videoEl);
const gfx = new Gfx($('#gl'), videoEl);
const rd4k = new Renderer($('#fx'));
const rdTaiko = new TaikoRenderer($('#fx'));

let song = null;
let charts = { '4k': {}, taiko: {} };
let entries = [];
let game = null, select = null, lastPick = null;
let attract = { on: false, next: 0 };

window.BEAST = window.MVBEAT = {
  audio, video, gfx, settings,
  get game() { return game; },
  get song() { return song; },
  get charts() { return charts; },
  get select() { return select; },
};

/* ======================================================= 起動 */
boot();

async function boot() {
  const bar = $('#load-fill'), txt = $('#load-txt');
  const step = (p, m) => { bar.style.width = (p * 100).toFixed(1) + '%'; txt.textContent = m; };

  try {
    step(0.03, '譜面データを読み込み中…');
    song = await (await fetch('assets/song.json')).json();

    step(0.10, '譜面を展開中…');
    for (const d of song.difficulties) {
      const ch = await (await fetch('charts/' + d.id + '.json')).json();
      charts['4k'][d.id] = ch;
      charts.taiko[d.id] = toTaikoChart(ch, song);
    }
    entries = buildEntries(song);

    step(0.16, 'グラフィックスを初期化中…');
    if (!gfx.init()) {
      console.warn('[mvbeat] WebGL が使えないため、映像を直接表示します');
      videoEl.style.opacity = '1';
      videoEl.style.filter = 'brightness(.6) saturate(1.2)';
      $('#gl').style.display = 'none';
    }
    resize();

    step(0.20, '楽曲を読み込み中…');
    await audio.load(['assets/song.m4a', 'assets/song.ogg'], p => step(0.20 + p * 0.55, '楽曲を読み込み中… ' + Math.round(p * 100) + '%'));

    step(0.78, 'MV を読み込み中…');
    await loadVideo(settings.quality);

    step(1, 'READY');
    setupUI();
    setTimeout(() => { showScreen('title'); startAttract(); }, 260);
  } catch (e) {
    console.error(e);
    txt.innerHTML = '読み込みに失敗しました。<br><small style="opacity:.7">' + String(e.message || e) +
      '<br>start.bat から起動してください（ファイルを直接開くと動きません）</small>';
  }
  requestAnimationFrame(loop);
}

/** 曲リストの中身。フル と、終盤から最後までのショート */
function buildEntries(s) {
  const barLen = s.grid * 16;
  const b0 = s.gridOffset + s.barPhase * s.grid;
  let start = s.musicEnd - 92;
  start = b0 + Math.round((start - b0) / barLen) * barLen;
  start = Math.max(s.musicStart, start);
  const end = s.musicEnd + 0.3;
  return [
    { id: 'full', name: 'フルバージョン', sub: fmtTime(s.musicEnd - s.musicStart), section: null },
    { id: 'short', name: 'ショートバージョン', sub: fmtTime(end - start), section: { start: start, end: end } },
  ];
}

/** 画質に応じて映像を読み込む。1080p が無い環境では 720p に落ちる
 *  （GitHub Pages には軽い 720p だけを置いているため） */
async function loadVideo(quality) {
  if (quality === 'off') { video.enabled = false; gfx.hasVideo = false; videoEl.pause(); return false; }
  const list = quality === 'lo' ? [song.video.lo] : [song.video.hi, song.video.lo];
  for (const url of list) {
    try {
      await video.load(url);
      video.enabled = true; gfx.hasVideo = true;
      return true;
    } catch (e) {
      console.warn('[beast] 映像を読み込めません:', url);
    }
  }
  video.enabled = false; gfx.hasVideo = false;
  return false;
}

function setupUI() {
  $('#jacket').src = song.video.cover;
  $('#t-title').textContent = song.title;
  $('#t-sub').textContent = song.subtitle;
  $('#t-bpm').textContent = 'BPM ' + song.bpm;
  $('#t-len').textContent = fmtTime(song.musicEnd - song.musicStart);
  $('#t-cuts').textContent = song.cutNotes.length + ' CUT';

  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  buildSettings(onSettingChange, audio);

  select = new SongSelect({
    song: song, charts: charts, entries: entries,
    onStart: startGame,
    onBack: () => go('title'),
  });

  $('#pz-resume').addEventListener('click', () => resumeGame());
  $('#pz-retry').addEventListener('click', () => { $('#pause-layer').classList.remove('on'); startGame(lastPick); });
  $('#pz-quit').addEventListener('click', () => { $('#pause-layer').classList.remove('on'); quitGame(); });
  $('#r-retry').addEventListener('click', () => startGame(lastPick));
  $('#r-select').addEventListener('click', () => go('select'));
  $('#r-title-btn').addEventListener('click', () => go('title'));
  setupCalibration();
}

function go(name) {
  showScreen(name);
  if (name === 'select' && select) select.apply();
  if (name !== 'game') startAttract();
}

function onSettingChange(k) {
  audio.setVolume(settings.volume);
  audio.setSfxVolume(settings.hitsound ? settings.hitvol : 0);
  if (k === 'quality') loadVideo(settings.quality).then(ok => { if (ok) startAttract(); });
  if (game) game.lead = settings.scroll;
}

/* ======================================================= アトラクト */
function startAttract() {
  if (!video.ready || !video.enabled || (game && game.running)) return;
  attract.on = true; attract.next = 0;
  videoEl.muted = true;
  videoEl.play().catch(() => { });
}
function stopAttract() { attract.on = false; }

/* ======================================================= ゲーム開始 */
async function startGame(pick) {
  if (!pick) return;
  lastPick = pick;
  // タッチ端末は、この操作のうちに全画面へ入る（あとからだと許可されない）
  if (document.body.classList.contains('touch')) enterFullscreen();
  stopAttract();
  const taiko = pick.mode === 'taiko';
  const chart = charts[pick.mode][pick.diff];
  const mods = {
    auto: $('#mod-auto').checked,
    mirror: $('#mod-mirror').checked,
    light: $('#mod-nofx').checked,
  };
  if (game) game.stop();

  document.body.classList.toggle('mode-taiko', taiko);
  padLabels(taiko);
  resize();
  showScreen('game');
  const d = DIFFS.find(x => x.id === pick.diff);
  $('#hud-diff').textContent = (taiko ? 'たいこ / ' : '') + (d ? d.jp : chart.name);
  $('#combo-num').textContent = '0';
  $('#hud-combo').classList.remove('on');
  $('#hud-score').textContent = '0000000';
  $('#hud-acc').textContent = '100.00%';

  const rd = taiko ? rdTaiko : rd4k;
  rd.parts.length = 0;
  if (rd.rings) rd.rings.length = 0;
  if (rd.flies) rd.flies.length = 0;

  game = new Game({
    audio: audio, video: video, gfx: gfx, renderer: rd,
    song: song, chart: chart, settings: settings, mods: mods,
    mode: pick.mode, section: pick.entry.section,
    hooks: { onJudge: onJudge, onFinish: onFinish },
  });
  await game.start();
  countdown();
}

function countdown() {
  const el = $('#countdown');
  const tick = () => {
    if (!game || !game.running) return;
    const left = (game.startAt + 3.6) - game.gameTime;
    if (left < 0.4) { el.classList.remove('on'); return; }
    el.textContent = left > 2.4 ? 'READY' : String(Math.max(1, Math.ceil(left - 0.15)));
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    setTimeout(tick, 900);
  };
  tick();
}

function quitGame() {
  if (game) { game.stop(); game = null; }
  go('select');
}

async function togglePause() {
  if (!game || !game.running) return;
  if (game.paused) resumeGame();
  else { await game.pause(); $('#pause-layer').classList.add('on'); }
}
async function resumeGame() {
  $('#pause-layer').classList.remove('on');
  if (game) { await game.resume(); countdown(); }
}

/* ======================================================= 判定フィードバック */
const judgeEl = $('#hud-judge'), fastEl = $('#hud-fast'), comboEl = $('#hud-combo'), comboNum = $('#combo-num');
function onJudge(j, d, n) {
  const tbl = game.judgeTable;
  const name = j < tbl.length ? tbl[j].name : game.missName;
  const cls = j < tbl.length ? tbl[j].cls : 'c-miss';
  if (game.mode !== 'taiko') {
    judgeEl.textContent = name;
    judgeEl.className = cls;
    judgeEl.classList.remove('show'); void judgeEl.offsetWidth; judgeEl.classList.add('show');
    if (settings.showFast && j > 0 && j < tbl.length && Math.abs(d) > 0.022) {
      fastEl.textContent = d < 0 ? 'FAST' : 'SLOW';
      fastEl.className = d < 0 ? 'c-good' : 'c-bad';
      fastEl.classList.remove('show'); void fastEl.offsetWidth; fastEl.classList.add('show');
    }
    const cb0 = game.combo;
    comboNum.textContent = cb0;
    comboEl.classList.toggle('on', cb0 >= 3);
    if (cb0 >= 3) { comboEl.classList.remove('pop'); void comboEl.offsetWidth; comboEl.classList.add('pop'); }
  }
  const cb = game.combo;
  if (cb > 0 && cb % 100 === 0) {
    gfx.p.flash = 0.35 * (game.mods.light ? 0.22 : settings.fx);
    gfx.shock(game.mode === 'taiko' ? rdTaiko.judgeX / rdTaiko.w : 0.5, gfx.p.judgeY, 1);
  }
}

function onFinish(res) {
  const key = lastPick.mode + ':' + lastPick.entry.id + ':' + lastPick.diff;
  const prev = getBest(key);
  let isBest = false;
  if (!res.mods.auto) {
    isBest = saveBest(key, {
      score: res.score, acc: res.acc, combo: res.combo, grade: res.grade,
      full: res.full, date: Date.now(),
    });
  }
  const d = DIFFS.find(x => x.id === lastPick.diff);
  const m = MODES.find(x => x.id === lastPick.mode);
  showScreen('result');
  requestAnimationFrame(() => renderResult(res, song, {
    name: (d ? d.jp : lastPick.diff) + '　/　' + m.name,
    level: charts[lastPick.mode][lastPick.diff].level,
    entry: lastPick.entry.name,
  }, isBest, prev));
  setTimeout(startAttract, 400);
}

/* ======================================================= メインループ */
let lastT = performance.now() / 1000, hudT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000;
  let dt = t - lastT; lastT = t;
  if (dt > 0.1) dt = 0.1;
  audio.syncClock();

  const g = game;
  if (g && g.running && !g.paused) {
    g.update(dt);
    if (g === game && g.running) {
      video.sync(audio.time, t);
      g.rd.draw(g, dt);
      hudT += dt;
      if (hudT > 0.033) { hudT = 0; updateHud(); }
    }
  } else {
    rd4k.ctx.clearRect(0, 0, rd4k.w, rd4k.h);
    attractUpdate(t, dt);
  }
  gfx.render(t, dt);
}

function updateHud() {
  $('#hud-score').textContent = fmtScore(game.score);
  $('#hud-acc').textContent = (game.acc != null ? game.acc : 100).toFixed(2) + '%';
  $('#hud-mult').textContent = 'HYPE ' + Math.round(game.hype * 100) + '%';
  $('#hype-fill').style.width = (game.hype * 100).toFixed(1) + '%';
  const a = game.startAt + 3.6, b = game.endAt - 2.6;
  const p = (game.gameTime - a) / Math.max(1, b - a);
  $('#prog-fill').style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(2) + '%';
}

function attractUpdate(t, dt) {
  const p = gfx.p;
  const onSelect = currentScreen() === 'select';
  p.dim = onSelect ? 0.74 : 0.52;
  p.fx = onSelect ? Math.min(0.35, settings.fx) : Math.min(0.85, settings.fx);
  p.flash = Math.max(0, p.flash - dt * 3);
  p.glow = 0; p.band = 0;
  p.cut = Math.max(0, p.cut - dt * 4);
  if (!attract.on || !video.ready || !song) { p.beat = 0; p.bass = 0; return; }
  const vt = videoEl.currentTime;
  const f = Math.min(song.vis.rms.length - 1, Math.max(0, Math.round(vt * song.vis.fps)));
  p.bass = (song.vis.low[f] || 0) * 0.8;
  p.treble = song.vis.high[f] || 0;
  p.beat = (song.vis.rms[f] || 0) * 0.6;
  p.hype = 0.25 + (song.vis.rms[f] || 0) * 0.35;
  if (t > attract.next) {
    attract.next = t + 9 + Math.random() * 5;
    const cuts = song.cuts.filter(c => c > song.musicStart + 4 && c < song.musicEnd - 10);
    if (cuts.length) {
      const target = cuts[Math.floor(Math.random() * cuts.length)];
      try { videoEl.currentTime = target; p.cut = 1; } catch (e) { /* シーク不可 */ }
    }
  }
}

/* ======================================================= 入力 */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const scr = currentScreen();
  if (scr === 'game' && game) {
    if (e.code === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (game.paused) return;
    const lane = settings.keys.indexOf(e.code);
    if (lane >= 0) { e.preventDefault(); game.press(lane, audio.timeAtEvent(e.timeStamp)); }
    else if (e.code === 'Space') { e.preventDefault(); game.press(game.mode === 'taiko' ? 1 : -1, audio.timeAtEvent(e.timeStamp)); }
    return;
  }
  if (scr === 'calibrate') { if (e.code === 'Space') { e.preventDefault(); calTap(e.timeStamp); } return; }
  if (scr === 'select' && select && select.handleKey(e)) return;
  menuKey(e, scr);
});

window.addEventListener('keyup', (e) => {
  if (currentScreen() !== 'game' || !game) return;
  const lane = settings.keys.indexOf(e.code);
  if (lane >= 0) game.release(lane, audio.timeAtEvent(e.timeStamp));
});

function menuKey(e, scr) {
  const list = scr === 'title' ? $$('#scr-title .menu-btn') : [];
  if (!list.length) {
    if (e.code === 'Escape') go('title');
    return;
  }
  let i = list.findIndex(x => x.classList.contains('sel'));
  if (i < 0) i = 0;
  if (e.code === 'ArrowUp') i = (i - 1 + list.length) % list.length;
  else if (e.code === 'ArrowDown') i = (i + 1) % list.length;
  else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); list[i].click(); return; }
  else if (e.code === 'Escape') { go('title'); return; }
  else return;
  e.preventDefault();
  list.forEach((x, k) => x.classList.toggle('sel', k === i));
}

/* ------------------------------------------------- 叩きパッド（スマホ） */
const padPointers = new Map();
function padLabels(taiko) {
  $$('#pads .pad').forEach((el, i) => {
    el.querySelector('b').textContent = taiko ? '' : keyLabel(settings.keys[i]);
    el.querySelector('em').textContent = 'LANE ' + (i + 1);
  });
}

/** 太鼓の形のパッド。面（中）＝ドン、ふちから外側ぜんぶ＝カ。左右で手を分ける */
function layoutDrum(w, h) {
  const svg = $('#pad-drum');
  if (!svg || h <= 0) return;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  const cx = w / 2, cy = h * 0.50;
  const R = Math.max(38, Math.min(h * 0.48, w * 0.26));   // ふちの外側
  const rh = R * 0.74;                                     // 面
  const set = (id, a) => { const e = document.getElementById(id); for (const k in a) e.setAttribute(k, a[k]); };

  set('dz0', { x: 0, y: 0, width: cx, height: h });
  set('dz3', { x: cx, y: 0, width: w - cx, height: h });
  set('bg-split', { x1: cx, y1: 0, x2: cx, y2: h });

  // 胴
  set('drum-body', {
    d: 'M' + (cx - R * .86) + ',' + (cy + R * .30) +
       'L' + (cx - R * .70) + ',' + (cy + R * .92) +
       'Q' + cx + ',' + (cy + R * 1.08) + ' ' + (cx + R * .70) + ',' + (cy + R * .92) +
       'L' + (cx + R * .86) + ',' + (cy + R * .30) + 'Z',
  });
  // ふち（カ）と面（ドン）
  set('drum-rim', { cx: cx, cy: cy, r: R });
  set('drum-head', { cx: cx, cy: cy, r: rh });
  // 鋲
  const tacks = document.getElementById('drum-tacks');
  const tr = (R + rh) / 2, ts = Math.max(1.4, R * 0.045);
  let d = '';
  for (let i = 0; i < 24; i++) {
    const a2 = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a2) * tr, y = cy + Math.sin(a2) * tr;
    d += 'M' + (x - ts) + ',' + y + 'a' + ts + ',' + ts + ' 0 1 0 ' + (ts * 2) + ',0a' + ts + ',' + ts + ' 0 1 0 ' + (-ts * 2) + ',0';
  }
  tacks.innerHTML = '<path class="drum-tack" d="' + d + '"/>';

  // 面の左右半分＝ドン
  set('dz1', { d: 'M' + cx + ',' + (cy - rh) + ' A' + rh + ',' + rh + ' 0 0 0 ' + cx + ',' + (cy + rh) + ' Z' });
  set('dz2', { d: 'M' + cx + ',' + (cy - rh) + ' A' + rh + ',' + rh + ' 0 0 1 ' + cx + ',' + (cy + rh) + ' Z' });
  set('drum-split', { x1: cx, y1: cy - rh * .97, x2: cx, y2: cy + rh * .97 });

  const fs = Math.max(9, Math.min(rh * 0.36, h * 0.15));
  set('dl1', { x: cx - rh * 0.46, y: cy, 'font-size': fs });
  set('dl2', { x: cx + rh * 0.46, y: cy, 'font-size': fs });
  const kx = Math.max(fs * 1.6, Math.min(cx - R - fs * 1.9, w * 0.17));
  set('dl0', { x: kx, y: cy, 'font-size': fs * 1.2 });
  set('dl3', { x: w - kx, y: cy, 'font-size': fs * 1.2 });
}

$$('#pads [data-lane]').forEach(el => {
  const lane = +el.dataset.lane;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    document.body.classList.add('touch');
    if (!game || !game.running || game.paused) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    padPointers.set(e.pointerId, el);
    el.classList.add('hit');
    game.press(lane, audio.timeAtEvent(e.timeStamp));
  }, { passive: false });
  const up = (e) => {
    if (!padPointers.has(e.pointerId)) return;
    padPointers.delete(e.pointerId);
    if (![...padPointers.values()].includes(el)) el.classList.remove('hit');
    if (game) game.release(lane, audio.timeAtEvent(e.timeStamp));
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
});

/* ------------------------------------------------- タッチ / マウス */
const activePointers = new Map();
function laneFromX(x) {
  if (game && game.mode === 'taiko') return Math.max(0, Math.min(3, Math.floor(x / (window.innerWidth / 4))));
  const left = rd4k.cx - rd4k.fieldW / 2;
  const i = Math.floor((x - left) / (rd4k.fieldW / 4));
  return (i < 0 || i > 3) ? -1 : i;
}
$('#scr-game').addEventListener('pointerdown', (e) => {
  if (!game || !game.running || game.paused) return;
  document.body.classList.add('touch');
  const lane = laneFromX(e.clientX);
  activePointers.set(e.pointerId, lane);
  game.press(lane, audio.timeAtEvent(e.timeStamp));
  e.preventDefault();
}, { passive: false });
window.addEventListener('pointerup', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  const lane = activePointers.get(e.pointerId);
  activePointers.delete(e.pointerId);
  if (game && lane >= 0) game.release(lane, audio.timeAtEvent(e.timeStamp));
});
window.addEventListener('pointercancel', (e) => {
  const lane = activePointers.get(e.pointerId);
  activePointers.delete(e.pointerId);
  if (game && lane >= 0) game.release(lane, performance.now() / 1000);
});
$('#scr-game').style.pointerEvents = 'auto';

/* ======================================================= 較正 */
let cal = null;
function setupCalibration() {
  $('#cal-start').addEventListener('click', startCal);
  $('#cal-apply').addEventListener('click', () => {
    if (!cal || cal.result == null) return;
    settings.offset = Math.max(-150, Math.min(150, Math.round(cal.result)));
    buildSettings(onSettingChange, audio);
    $('#cal-result').innerHTML = '判定オフセットを <b>' + (settings.offset > 0 ? '+' : '') + settings.offset + 'ms</b> にしました';
    $('#cal-apply').disabled = true;
  });
  $('#scr-calibrate').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    calTap(e.timeStamp);
  });
}
async function startCal() {
  await audio.init(); await audio.resume();
  const period = 60 / song.bpm;
  const t0 = audio.ctx.currentTime + 0.6;
  cal = { ticks: [], devs: [], period: period, result: null, n: 0 };
  for (let i = 0; i < 44; i++) {
    const w = t0 + i * period;
    audio.blip('tick', w);
    cal.ticks.push(w);
  }
  $('#cal-count').textContent = '0 / 16';
  $('#cal-result').textContent = '…';
  $('#cal-apply').disabled = true;
  const dot = $('#cal-dot');
  cal.timer = setInterval(() => {
    if (!cal) return;
    const now = audio.ctx.currentTime - audio.latency;
    const idx = Math.round((now - t0) / period);
    if (idx !== cal.lastPulse && idx >= 0 && idx < 44) {
      cal.lastPulse = idx;
      dot.classList.remove('pulse'); void dot.offsetWidth; dot.classList.add('pulse');
    }
    if (now > t0 + 44 * period) { clearInterval(cal.timer); }
  }, 16);
}
function calTap(tsMs) {
  if (!cal) return;
  const tapCtx = tsMs / 1000 + audio.pa - audio.latency;
  let best = 1e9;
  for (const tk of cal.ticks) { const d = tapCtx - tk; if (Math.abs(d) < Math.abs(best)) best = d; }
  if (Math.abs(best) > cal.period * 0.45) return;
  cal.n++;
  if (cal.n <= 4) { $('#cal-count').textContent = '0 / 16（最初の4回は捨てます）'; return; }
  cal.devs.push(best * 1000);
  $('#cal-count').textContent = Math.min(16, cal.devs.length) + ' / 16';
  if (cal.devs.length >= 16) {
    const s = cal.devs.slice().sort((a, b) => a - b);
    const med = s[s.length >> 1];
    const trimmed = s.slice(2, -2);
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    cal.result = mean;
    clearInterval(cal.timer);
    $('#cal-result').innerHTML = 'あなたの打鍵は平均 <b>' + (mean > 0 ? '+' : '') + mean.toFixed(1) + 'ms</b>' +
      (mean > 0 ? '（遅め）' : '（早め）') + '　中央値 ' + med.toFixed(1) + 'ms';
    $('#cal-apply').disabled = false;
    cal.devs = []; cal.n = 0;
  }
}

/* ======================================================= 全画面 */
const FS_OK = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
if (FS_OK) document.body.classList.add('can-fs');

async function enterFullscreen() {
  if (!FS_OK || document.fullscreenElement) return;
  const el = document.documentElement;
  try {
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
  } catch (e) { return; }
  // 横向きで固定できる端末は固定する（できなくても遊べる）
  try { await screen.orientation.lock('landscape'); } catch (e) { /* 非対応 */ }
}
async function exitFullscreen() {
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* noop */ }
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) { /* noop */ }
}
function toggleFullscreen() { document.fullscreenElement ? exitFullscreen() : enterFullscreen(); }

const fsBtn = $('#btn-fs');
if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fs', !!document.fullscreenElement);
  setTimeout(resize, 120);
  setTimeout(resize, 400);
});

/* ======================================================= リサイズ */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  document.body.classList.toggle('portrait', h / w > 1.15);
  const taikoPad = document.body.classList.contains('mode-taiko');
  const portrait = h / w > 1.15;
  const padH = document.body.classList.contains('touch')
    ? Math.round(Math.min(taikoPad ? 240 : 188,
        Math.max(76, h * (portrait ? (taikoPad ? 0.26 : 0.22) : (taikoPad ? 0.38 : 0.30)))))
    : 0;
  document.documentElement.style.setProperty('--pad-h', padH + 'px');
  if (padH > 0) layoutDrum(w, padH);
  rd4k.resize(w, h, dpr, padH);
  rdTaiko.resize(w, h, dpr, padH);
  gfx.resize(w, h, Math.min(1.5, window.devicePixelRatio || 1));
  gfx.p.judgeY = (game ? game.rd.judgeY : rd4k.judgeY) / h;
  if (select) select.center();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.running && !game.paused) togglePause();
});
if (matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
}
resize();
