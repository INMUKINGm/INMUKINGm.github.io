// ===========================================================================
//  generate-charts.mjs — MVBEAT 譜面ジェネレータ
//  work/analysis.json (+ bias) から 4レーン譜面を4難易度ぶん生成する。
//
//  検証済みの前提：
//    BPM 133.000（位相ロック 0.4477 / 次点 0.059 で確定）
//    強いオンセットは16分グリッドに ±15ms で 80%、±25ms で 86% 一致
//    → グリッドから外れた弱い音は環境音・声の立ち上がりなのでノーツにしない
// ===========================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');



const A = JSON.parse(fs.readFileSync(ROOT + '/work/analysis.json', 'utf8'));
const BIAS = JSON.parse(fs.readFileSync(ROOT + '/work/bias.json', 'utf8')).biasMs / 1000;

const BPM = 133.000;
const BEAT = 60 / BPM;               // 0.451128s
const DIV = 4;                       // 16分
const GRID = BEAT / DIV;             // 0.112782s

// 再現性のための固定シード乱数
let _seed = 0x9e3779b9;
const rnd = () => (_seed = (_seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ---------------------------------------------------------------- 包絡
const FPS = A.vis.fps;
function boxSmooth(arr, w) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j < Math.min(arr.length, i + w); j++) { s += arr[j]; n++; }
    out[i] = s / n;
  }
  return out;
}
const rmsS = boxSmooth(A.vis.rms, 15);
const at = (arr, t) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(t * FPS)))];
const loudAt = (t) => at(rmsS, t);
const midAt = (t) => at(A.vis.mid, t);

// ---------------------------------------------------------------- グリッド位相
const biased = A.onsets.map(o => ({ t: +(o.t + BIAS).toFixed(4), s: o.s, r: o.r, b: o.b }));
function fitOffset(sample) {
  let best = 0, bestScore = -1;
  for (let off = 0; off < GRID; off += 0.0005) {
    let sc = 0;
    for (const o of sample) {
      let r = (o.t - off) % GRID; if (r > GRID / 2) r -= GRID;
      if (Math.abs(r) < 0.030) sc += o.s * (o.b === 0 ? 1.5 : 1);
    }
    if (sc > bestScore) { bestScore = sc; best = off; }
  }
  for (let k = 0; k < 4; k++) {
    let sum = 0, w = 0;
    for (const o of sample) {
      let r = (o.t - best) % GRID; if (r > GRID / 2) r -= GRID;
      if (Math.abs(r) < 0.028) { sum += r * o.s; w += o.s; }
    }
    if (w > 0) best += sum / w;
  }
  return ((best % GRID) + GRID) % GRID;
}
const OFFSET = fitOffset(biased.filter(o => o.t > 20 && o.t < 232 && o.s > 0.45));
const gridIndex = (t) => Math.round((t - OFFSET) / GRID);
const gridTime = (i) => +(OFFSET + i * GRID).toFixed(4);
const devOf = (t) => { let r = (t - OFFSET) % GRID; if (r > GRID / 2) r -= GRID; if (r < -GRID / 2) r += GRID; return r; };

// ---------------------------------------------------------------- 音楽区間
// 「グリッドに乗った強い音」が連続して現れる範囲を音楽の本体とみなす
function musicWindow() {
  const step = 2, hits = [];
  for (let t = 0; t < A.duration; t += step) {
    const os = biased.filter(o => o.t >= t && o.t < t + step && o.s > 0.45);
    if (os.length < 3) { hits.push(0); continue; }
    let on = 0; for (const o of os) if (Math.abs(devOf(o.t)) < 0.025) on++;
    hits.push((on / os.length >= 0.62 && loudAt(t + 1) > 0.12) ? 1 : 0);
  }
  let bs = 0, bl = 0, cs = -1, miss = 0;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i]) { if (cs < 0) cs = i; miss = 0; if (i - cs + 1 > bl) { bl = i - cs + 1; bs = cs; } }
    else { miss++; if (miss > 2) { cs = -1; miss = 0; } }
  }
  return [bs * step, (bs + bl) * step];
}
let [winA, winB] = musicWindow();
// 端を強いグリッド音に合わせる
const firstN = biased.find(o => o.t >= winA - 1 && o.s > 0.5 && Math.abs(devOf(o.t)) < 0.03);
const lastN = [...biased].reverse().find(o => o.t <= winB + 1.5 && o.s > 0.5 && Math.abs(devOf(o.t)) < 0.03);
const MUSIC_START = firstN ? firstN.t : winA;
const MUSIC_END = lastN ? lastN.t : winB;
console.log('grid offset =', OFFSET.toFixed(5));
console.log('music window =', MUSIC_START.toFixed(2), '-', MUSIC_END.toFixed(2), 's');

// ---------------------------------------------------------------- ノイズ除去 + スナップ
const SNAP_TOL = 0.040;
let src = [];
for (const o of biased) {
  if (o.t < MUSIC_START - 0.05 || o.t > MUSIC_END + 0.05) continue;
  const dev = devOf(o.t);
  const aligned = Math.abs(dev) <= 0.030;
  // グリッドに乗っていない弱い音＝環境音/声のゆらぎなので捨てる
  if (!aligned && o.s < 0.58) continue;
  if (loudAt(o.t) < 0.10) continue;
  const snap = Math.abs(dev) <= SNAP_TOL;
  src.push({ t: snap ? gridTime(gridIndex(o.t)) : o.t, s: o.s, b: o.b, gi: gridIndex(o.t), snapped: snap, dev: dev });
}
src.sort((a, b) => a.t - b.t);
src = src.filter((o, i) => i === 0 || o.t - src[i - 1].t > 0.030);
console.log('usable onsets =', src.length, '(from', A.onsets.length + ')');

// 小節頭（16グリッド）の位相：低域アクセントの位置で決める
let barPhase = 0, barBest = -1;
for (let k = 0; k < 16; k++) {
  let s = 0;
  for (const o of src) if (o.b === 0 && o.snapped && ((o.gi % 16) + 16) % 16 === k) s += o.s;
  if (s > barBest) { barBest = s; barPhase = k; }
}
const beatPos = (gi) => (((gi - barPhase) % 16) + 16) % 16;
console.log('bar phase =', barPhase);

// ---------------------------------------------------------------- カットノーツ
const CUT_TOL = 0.085;
const cutTimes = [];
for (const c of A.cuts) {
  if (c < MUSIC_START || c > MUSIC_END) continue;
  let best = null, bd = CUT_TOL;
  for (const o of src) {
    if (o.t > c + CUT_TOL) break;
    const d = Math.abs(o.t - c);
    if (d < bd) { bd = d; best = o; }
  }
  if (best && best.s >= 0.40) {
    if (!cutTimes.length || best.t - cutTimes[cutTimes.length - 1] > 1.4) cutTimes.push(best.t);
  }
}
const cutKey = (t) => t.toFixed(4);
const cutSet = new Set(cutTimes.map(cutKey));
console.log('cut notes =', cutTimes.length, '/ scene cuts', A.cuts.length);

// ---------------------------------------------------------------- 難易度
const DIFFS = [
  { id: 'normal', name: 'ふつう',     minGap: 0.26,  minS: 0.33, chordS: 0.95, holdGap: 0.55, holdMax: 0.20, cuts: true },
  { id: 'hard',   name: 'むずかしい', minGap: 0.16,  minS: 0.22, chordS: 0.80, holdGap: 0.55, holdMax: 0.14, cuts: true },
  { id: 'oni',    name: 'おに',       minGap: 0.104, minS: 0.00, chordS: 0.64, holdGap: 0.80, holdMax: 0.09, cuts: true },
  // 裏：鳴っている音を全部拾ったうえで、盛り上がっている所は16分で埋め、
  //     いちばん激しい所は32分を差し込む。人間が通せるぎりぎりを狙う。
  { id: 'ura',    name: '裏',         minGap: 0.052, minS: 0.00, chordS: 0.30, holdGap: 1.40, holdMax: 0.02, cuts: true,
    densify: { gate: 0.34, maxGrids: 4, burst: 0.52 } },
];

/** 盛り上がっている区間の隙間を16分（最も激しい所は32分）で埋める */
function densify(list, cfg) {
  const d = cfg.densify;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    out.push(a);
    const b = list[i + 1];
    if (!b) continue;
    const span = b.t - a.t;
    const grids = Math.round(span / GRID);
    if (grids < 2 || grids > d.maxGrids) continue;
    if (Math.abs(span - grids * GRID) > 0.030) continue;   // グリッドに乗っていない所は触らない
    const loud = loudAt(a.t + span / 2);
    if (loud < d.gate) continue;
    const half = loud >= d.burst && grids <= 2;            // ここぞは32分
    const step = half ? GRID / 2 : GRID;
    const n = Math.round(span / step);
    for (let k = 1; k < n; k++) {
      const t = +(a.t + k * step).toFixed(4);
      out.push({ t: t, s: 0.26 + 0.1 * (k % 2), b: (k % 2) ? 2 : 1, gi: gridIndex(t), snapped: true, fill: true });
    }
  }
  return out;
}

function selectOnsets(cfg) {
  const out = [];
  let last = -9;
  for (const o of src) {
    const isCut = cutSet.has(cutKey(o.t));
    const pos = o.snapped ? beatPos(o.gi) : -1;
    const onBeat = pos >= 0 && pos % 4 === 0;
    const onDown = pos === 0;
    let want = o.s >= cfg.minS || isCut || onDown;
    if (cfg.id === 'easy') want = isCut || onDown || (onBeat && o.s >= cfg.minS) || o.s >= 0.75;
    if (cfg.id === 'normal' && !onBeat && !isCut) want = want && o.s >= 0.46;
    if (!want) continue;
    if (!isCut && o.t - last < cfg.minGap) {
      const prev = out[out.length - 1];
      if (prev && !cutSet.has(cutKey(prev.t)) && o.s > prev.s * 1.4) { out[out.length - 1] = o; last = o.t; }
      continue;
    }
    // カットノーツは間隔制限を無視して置くので、直前の音符が近すぎる場合は吸収する
    if (isCut && out.length && o.t - out[out.length - 1].t < 0.12 && !cutSet.has(cutKey(out[out.length - 1].t))) out.pop();
    out.push(o); last = o.t;
  }
  return out;
}

// ---------------------------------------------------------------- レーン配置
function assignLanes(list, cfg) {
  const notes = [];
  let prevLane = -1, prevT = -9, dir = 1, streak = 0;
  const hand = [0, 0];
  const recent = [];
  for (const o of list) {
    const gap = o.t - prevT;
    const isCut = cutSet.has(cutKey(o.t));
    const decay = Math.exp(-gap / 1.5);
    hand[0] *= decay; hand[1] *= decay;
    while (recent.length && o.t - recent[0].t > 1.1) recent.shift();

    let lane;
    if (isCut) {
      lane = -1;
    } else if (gap < GRID * 1.5 && prevLane >= 0 && cfg.id !== 'easy') {
      // 16分の連なり＝階段。端で折り返し、長すぎたら向きを変える
      streak++;
      if (streak > 5 && rnd() < 0.4) dir = -dir;
      let next = prevLane + dir;
      if (next > 3 || next < 0) { dir = -dir; next = prevLane + dir; }
      lane = next;
    } else {
      streak = 0;
      let cand = o.b === 0 ? [0, 3, 1, 2] : o.b === 2 ? [1, 2, 3, 0] : [2, 1, 0, 3];
      const cost = (l) => {
        let s = 0;
        if (l === prevLane) s += gap < 0.28 ? 8 : 1.5;
        s += hand[l < 2 ? 0 : 1] * 1.0;
        for (const r of recent) if (r.lane === l) s += 0.4 * (1.1 - (o.t - r.t));
        return s;
      };
      cand = cand.slice().sort((a, b) => cost(a) - cost(b));
      lane = (cand.length > 1 && rnd() < 0.25) ? cand[1] : cand[0];
      dir = lane >= prevLane ? 1 : -1;
    }

    notes.push({ t: o.t, lane: lane, type: isCut ? 2 : 0, dur: 0, s: o.s, b: o.b, gi: o.gi, snapped: o.snapped });
    if (lane >= 0) { hand[lane < 2 ? 0 : 1] += 1; recent.push({ t: o.t, lane: lane }); prevLane = lane; }
    prevT = o.t;
  }
  return notes;
}

// ---------------------------------------------------------------- 和音
function addChords(notes, cfg) {
  const extra = [];
  let lastChord = -9;
  const minSpace = cfg.id === 'ura' ? 0.34 : cfg.id === 'oni' ? 0.8 : 1.8;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.type !== 0 || n.s < cfg.chordS) continue;
    if (n.t - lastChord < minSpace) continue;
    const pg = i > 0 ? n.t - notes[i - 1].t : 9;
    const ng = i < notes.length - 1 ? notes[i + 1].t - n.t : 9;
    if (Math.min(pg, ng) < (cfg.id === 'ura' ? 0.09 : 0.18)) continue;
    const opp = n.lane < 2 ? [3, 2] : [0, 1];
    extra.push({ t: n.t, lane: opp[rnd() < 0.65 ? 0 : 1], type: 0, dur: 0, s: n.s, b: n.b, gi: n.gi, snapped: n.snapped });
    lastChord = n.t;
  }
  return notes.concat(extra).sort((a, b) => a.t - b.t || a.lane - b.lane);
}

// ---------------------------------------------------------------- ロングノーツ
function addHolds(notes, cfg) {
  for (let i = 0; i < notes.length - 1; i++) {
    const n = notes[i];
    if (n.type !== 0) continue;
    // 同レーンの次ノーツまでの余白を見る
    let nx = null;
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[j].lane === n.lane || notes[j].type === 2) { nx = notes[j]; break; }
    }
    if (!nx) continue;
    const gap = nx.t - n.t;
    if (gap < cfg.holdGap || gap > 3.4) continue;
    let sum = 0, cnt = 0;
    for (let t = n.t + 0.1; t < nx.t - 0.1; t += 0.05) { sum += midAt(t); cnt++; }
    if (!cnt || sum / cnt < 0.52) continue;
    const dur = Math.min(gap - 0.18, 2.4);
    if (dur < 0.42) continue;
    n.type = 1; n.dur = +dur.toFixed(3);
  }
  // ロングが多すぎる場合は弱いものから間引く
  const holds = notes.filter(n => n.type === 1);
  const limit = Math.floor(notes.length * (cfg.holdMax || 0.18));
  if (holds.length > limit) {
    holds.sort((a, b) => a.s - b.s);
    for (let i = 0; i < holds.length - limit; i++) { holds[i].type = 0; holds[i].dur = 0; }
  }
  return notes;
}

// ---------------------------------------------------------------- 生成
const manifestDiffs = [];
for (const cfg of DIFFS) {
  _seed = 0x9e3779b9;
  let list = selectOnsets(cfg);
  if (cfg.densify) list = densify(list, cfg);
  let notes = assignLanes(list, cfg);
  notes = addChords(notes, cfg);
  notes = addHolds(notes, cfg);
  notes = notes.filter((n, i) => !(i > 0 && notes[i - 1].lane === n.lane && Math.abs(notes[i - 1].t - n.t) < 0.035));

  const span = MUSIC_END - MUSIC_START;
  const nps = notes.length / span;
  let maxNps = 0;
  for (let i = 0; i < notes.length; i++) {
    let j = i; while (j < notes.length && notes[j].t - notes[i].t < 1) j++;
    if (j - i > maxNps) maxNps = j - i;
  }
  const holds = notes.filter(n => n.type === 1).length;
  const cuts = notes.filter(n => n.type === 2).length;
  const level = Math.max(1, Math.min(20, Math.round(nps * 1.3 + maxNps * 0.28)));

  const out = {
    id: cfg.id, name: cfg.name, level: level,
    count: notes.length, nps: +nps.toFixed(2), maxNps: maxNps, holds: holds, cuts: cuts,
    // [時刻, レーン, 種別(0tap 1hold 2cut), 長さ, 帯域(0低 1中 2高 -1不明)]
    notes: notes.map(n => [+n.t.toFixed(4), n.lane, n.type, n.dur, n.b]),
  };
  fs.writeFileSync(ROOT + '/charts/' + cfg.id + '.json', JSON.stringify(out));
  manifestDiffs.push({ id: cfg.id, name: cfg.name, level: level, count: notes.length, nps: out.nps, maxNps: maxNps, holds: holds, cuts: cuts });
  console.log(cfg.name.padEnd(7), 'Lv' + String(level).padStart(2),
    String(notes.length).padStart(4) + ' notes  nps ' + out.nps.toFixed(2).padStart(5) +
    '  peak ' + String(maxNps).padStart(2) + '/s  hold ' + String(holds).padStart(3) + '  cut ' + String(cuts).padStart(3));
}

const manifest = {
  title: 'INMU KING',
  subtitle: '野獣と化した先輩 / SPECIAL SORRY',
  artist: 'MUSIC VIDEO',
  bpm: BPM,
  duration: A.duration,
  gridOffset: +OFFSET.toFixed(5),
  grid: +GRID.toFixed(6),
  beat: +BEAT.toFixed(6),
  barPhase: barPhase,
  musicStart: +MUSIC_START.toFixed(3),
  musicEnd: +MUSIC_END.toFixed(3),
  video: { hi: 'assets/mv_1080.mp4', lo: 'assets/mv_720.mp4', cover: 'assets/cover.jpg' },
  audio: { m4a: 'assets/song.m4a', ogg: 'assets/song.ogg' },
  cuts: A.cuts,
  cutNotes: cutTimes.map(t => +t.toFixed(4)),
  difficulties: manifestDiffs,
  vis: A.vis,
};
fs.writeFileSync(ROOT + '/assets/song.json', JSON.stringify(manifest));
console.log('wrote assets/song.json', (fs.statSync(ROOT + '/assets/song.json').size / 1024).toFixed(0) + 'KB');
