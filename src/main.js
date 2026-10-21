/* ===========================================================================
   main.js — 起動・メインループ・入力
   =========================================================================== */
import { AudioEngine } from './audio.js?v=fd8d7e6d';
import { VideoSync } from './video.js?v=fd8d7e6d';
import { Gfx } from './gfx.js?v=fd8d7e6d';
import { Renderer } from './render.js?v=fd8d7e6d';
import { TaikoRenderer, toTaikoChart } from './taiko.js?v=fd8d7e6d';
import { Game } from './play.js?v=fd8d7e6d';
import { settings, getBest, saveBest } from './store.js?v=fd8d7e6d';
import { SongSelect, MODES, DIFFS } from './select.js?v=fd8d7e6d';
import { $, $$, showScreen, currentScreen, buildSettings, renderResult, fmtScore, fmtTime, keyLabel } from './ui.js?v=fd8d7e6d';

const audio = new AudioEngine();
const videoEl = $('#video');
const video = new VideoSync(videoEl);
const gfx = new Gfx($('#gl'), videoEl);
const rd4k = new Renderer($('#fx'));
const rdTaiko = new TaikoRenderer($('#fx'));

let songs = [];                 // 読み込んだ曲（マニフェスト）
let song = null;                // いま媒体を読んである曲
let charts = {};                // charts[曲id][モード][難易度]
let entries = [];               // 曲 × 区間 の一覧
let game = null, select = null, lastPick = null, swapTimer = 0;
let attract = { on: false, next: 0 };

window.BEAST = window.MVBEAT = {
  audio, video, gfx, settings,
  get game() { return game; },
  get song() { return song; },
  get songs() { return songs; },
  get charts() { return charts; },
  get entries() { return entries; },
  get select() { return select; },
};

/* ======================================================= 起動 */
boot();

async function boot() {
  const bar = $('#load-fill'), txt = $('#load-txt');
  const step = (p, m) => { bar.style.width = (p * 100).toFixed(1) + '%'; txt.textContent = m; };

  try {
    step(0.03, '曲データを読み込み中…');
    const list = await (await fetch('assets/songs.json')).json();
    for (const url of list) {
      try {
        const sg = await (await fetch(url)).json();
        if (!sg.id) sg.id = url.split('/').slice(-2)[0];
        songs.push(sg);
      } catch (e) { console.warn('[beast] 曲を読めません:', url, e); }
    }
    if (!songs.length) throw new Error('assets/songs.json の曲を1つも読めませんでした');

    step(0.10, '譜面を展開中…');
    for (const sg of songs) {
      charts[sg.id] = { '4k': {}, taiko: {} };
      const base = 'charts/' + sg.id + '/';
      for (const d of sg.difficulties) {
        const ch = await (await fetch(base + d.id + '.json')).json();
        charts[sg.id]['4k'][d.id] = ch;
        charts[sg.id].taiko[d.id] = toTaikoChart(ch, sg);
      }
      entries.push(...buildEntries(sg));
    }
    song = songs[0];

    step(0.16, 'グラフィックスを初期化中…');
    if (!gfx.init()) {
      console.warn('[mvbeat] WebGL が使えないため、映像を直接表示します');
      videoEl.style.opacity = '1';
      videoEl.style.filter = 'brightness(.6) saturate(1.2)';
      $('#gl').style.display = 'none';
    }
    resize();

    step(0.20, '楽曲を読み込み中…');
    await loadAudio(song, p => step(0.20 + p * 0.55, '楽曲を読み込み中… ' + Math.round(p * 100) + '%'));

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

/** 曲リストの中身。曲ごとに フル と、終盤から最後までのショート */
function buildEntries(s) {
  const barLen = s.grid * 16;
  const b0 = s.gridOffset + s.barPhase * s.grid;
  let start = s.musicEnd - (s.shortSec || 92);
  start = b0 + Math.round((start - b0) / barLen) * barLen;
  start = Math.max(s.musicStart, start);
  const end = s.musicEnd + 0.3;
  return [
    { id: s.id + ':full', song: s, name: 'フルバージョン',
      sub: fmtTime(s.musicEnd - s.musicStart), section: null },
    { id: s.id + ':short', song: s, name: 'ショートバージョン',
      sub: fmtTime(end - start), section: { start: start, end: end } },
  ];
}

/** 曲の音を読み込む（曲を切り替えたときだけ実際に読む） */
async function loadAudio(sg, onProgress) {
  if (audio._songId === sg.id && audio.buffer) return;
  await audio.load([sg.audio.m4a, sg.audio.ogg], onProgress);
  audio._songId = sg.id;
}

/** 選んだ曲の音と映像をそろえる。重いので、必要なときだけ読む */
let mediaBusy = null;
async function useSong(sg, onProgress) {
  if (!sg || (song === sg && audio._songId === sg.id)) return;
  if (mediaBusy) await mediaBusy.catch(() => {});
  mediaBusy = (async () => {
    song = sg;
    await loadAudio(sg, onProgress);
    await loadVideo(settings.quality);
    setupTitleCard();
  })();
  try { await mediaBusy; } finally { mediaBusy = null; }
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

function setupTitleCard() {
  $('#jacket').src = song.video.cover;
  $('#t-title').textContent = song.title;
  $('#t-sub').textContent = song.subtitle;
  $('#t-bpm').textContent = 'BPM ' + song.bpm;
  $('#t-len').textContent = fmtTime(song.musicEnd - song.musicStart);
  $('#t-cuts').textContent = songs.length > 1 ? songs.length + ' SONGS' : song.cutNotes.length + ' CUT';
}

function setupUI() {
  setupTitleCard();

  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  buildSettings(onSettingChange, audio);
  setFpsMeter(settings.fpsMeter);

  select = new SongSelect({
    charts: charts, entries: entries,
    onStart: startGame,
    onBack: () => go('title'),
    onSong: (sg) => {
      // 選び直しのたびに読むと重いので、落ち着いてから差し替える
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => {
        if (game && game.running) return;
        useSong(sg).then(() => { if (currentScreen() === 'select') startAttract(); });
      }, 420);
    },
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
  setFpsMeter(settings.fpsMeter);
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
  clearTimeout(swapTimer);

  // 別の曲なら、始める前に音と映像を入れ替える
  const sg = pick.entry.song;
  if (song !== sg || audio._songId !== sg.id) {
    const bar = $('#load-fill'), txt = $('#load-txt');
    showScreen('load');
    bar.style.width = '4%'; txt.textContent = sg.title + ' を読み込み中…';
    await useSong(sg, p => { bar.style.width = (6 + p * 88).toFixed(1) + '%'; });
    bar.style.width = '100%';
  }

  const taiko = pick.mode === 'taiko';
  const chart = charts[sg.id][pick.mode][pick.diff];
  const mods = {
    auto: $('#mod-auto').checked,
    mirror: $('#mod-mirror').checked,
    light: $('#mod-nofx').checked,
  };
  if (game) game.stop();

  document.body.classList.toggle('mode-taiko', taiko);
  padLabels();
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
    song: sg, chart: chart, settings: settings, mods: mods,
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
  const sg = lastPick.entry.song;
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
  requestAnimationFrame(() => renderResult(res, sg, {
    name: (d ? d.jp : lastPick.diff) + '　/　' + m.name,
    level: charts[sg.id][lastPick.mode][lastPick.diff].level,
    entry: lastPick.entry.name,
  }, isBest, prev));
  setTimeout(startAttract, 400);
}

/* ======================================================= メインループ */
let lastT = performance.now() / 1000, hudT = 0;
let fpsN = 0, fpsT = 0, fpsVal = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000;
  let dt = t - lastT; lastT = t;
  if (dt > 0.1) dt = 0.1;
  audio.syncClock(dt);

  const g = game;
  if (g && g.running && !g.paused) {
    g.update(dt);
    if (g === game && g.running) {
      video.sync(audio.time, t);
      // 譜面は毎フレーム描く。120Hz でも 360Hz でも間引かない
      g.rd.draw(g, dt);
      hudT += dt;
      if (hudT > 0.033) { hudT = 0; updateHud(); }
    }
  } else {
    rd4k.ctx.clearRect(0, 0, rd4k.w, rd4k.h);
    attractUpdate(t, dt);
  }
  gfx.render(t, dt, video.frameSeq);

  // FPS表示（設定でオンのときだけ）
  if (fpsEl) {
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) {
      const v = Math.round(fpsN / fpsT);
      if (v !== fpsVal) { fpsVal = v; fpsEl.textContent = v + ' FPS'; }
      fpsN = 0; fpsT = 0;
    }
  }
}

/* ---- FPS表示。画面の出せる速さそのままで回っているかを見るためのもの */
let fpsEl = null;
function setFpsMeter(on) {
  if (on && !fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.id = 'fps-meter';
    fpsEl.textContent = '— FPS';
    document.body.appendChild(fpsEl);
  } else if (!on && fpsEl) {
    fpsEl.remove(); fpsEl = null; fpsVal = 0; fpsN = 0; fpsT = 0;
  }
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
function padLabels() {
  $$('#pads .pad').forEach((el, i) => {
    el.querySelector('b').textContent = keyLabel(settings.keys[i]);
    el.querySelector('em').textContent = 'LANE ' + (i + 1);
  });
}

/** 太鼓のパッド。肌色の半円の中＝ドン（左右で手を分ける）、
 *  半円の外は画面のいちばん上までぜんぶカ。カの面は完全に透明。 */
function layoutDrum(w, hFull, drumH) {
  const svg = $('#pad-drum');
  if (!svg || hFull <= 0) return;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hFull);
  const cx = w / 2, b = hFull - 2;                          // 半円の底辺＝画面の下端
  // 幅は画面の約6割。残した左右がカの叩き場所になる。高さは下の帯のぶん。
  const portrait = hFull / w > 1.15;
  const rx = Math.max(52, w * (portrait ? 0.285 : 0.185));
  const ry = Math.max(40, Math.min(drumH * 0.82, rx * 1.2));
  const arc = (sweep, ex) => 'A' + rx + ',' + ry + ' 0 0 ' + sweep + ' ' + ex + ',' + b;
  const set = (id, a2) => { const e = document.getElementById(id); for (const k in a2) e.setAttribute(k, a2[k]); };

  // カは画面いっぱい。左右で手を分ける
  set('dz0', { x: 0, y: 0, width: cx, height: hFull });
  set('dz3', { x: cx, y: 0, width: w - cx, height: hFull });

  const rw = Math.max(3, Math.min(rx, ry) * 0.075);          // 黒ぶちの太さ
  const semi = (RX, RY) => 'M' + (cx - RX) + ',' + b + 'A' + RX + ',' + RY + ' 0 0 1 ' + (cx + RX) + ',' + b + 'Z';
  set('drum-rim', { d: semi(rx + rw, ry + rw) });
  set('drum-head', { d: semi(rx, ry) });
  set('drum-edge', { d: 'M' + (cx - rx * 0.95) + ',' + b +
    'A' + (rx * 0.95) + ',' + (ry * 0.95) + ' 0 0 1 ' + (cx + rx * 0.95) + ',' + b,
    'stroke-width': Math.max(1, rw * 0.55) });
  set('dz1', { d: 'M' + cx + ',' + (b - ry) + arc(0, cx - rx) + 'L' + cx + ',' + b + 'Z' });
  set('dz2', { d: 'M' + cx + ',' + (b - ry) + arc(1, cx + rx) + 'L' + cx + ',' + b + 'Z' });
  set('drum-split', { x1: cx, y1: b - ry * 0.96, x2: cx, y2: b });
  set('drum-sheen', { d: semi(rx, ry) });
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
const pauseBtn = $('#btn-pause');
if (pauseBtn) pauseBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePause(); });
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
        Math.max(76, h * (portrait ? (taikoPad ? 0.23 : 0.22) : (taikoPad ? 0.38 : 0.30)))))
    : 0;
  document.documentElement.style.setProperty('--pad-h', padH + 'px');
  if (padH > 0) layoutDrum(w, h, padH);
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
