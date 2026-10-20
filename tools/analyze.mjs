// ===========================================================================
//  analyze.mjs  —  MVBEAT 楽曲解析エンジン
//  work/song.wav (mono 16bit PCM) を読み、
//  スペクトルフラックス onset / 3バンド分離 / BPM・ビートグリッド /
//  可視化用エネルギー包絡 を work/analysis.json に書き出す。
//  依存ライブラリなし（Node 標準のみ）
// ===========================================================================
import fs from 'node:fs';
import path from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');



const WAV = path.join(ROOT, 'work', 'song.wav');
const CUTS = path.join(ROOT, 'work', 'cuts.txt');
const OUT = path.join(ROOT, 'work', 'analysis.json');

// ---------------------------------------------------------------- WAV 読み込み
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('bad wav');
  const n = Math.floor(data.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2) / 32768;
  return { fmt, x };
}

// ---------------------------------------------------------------- FFT (radix-2)
function makeFFT(N) {
  const levels = Math.log2(N) | 0;
  const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = Math.sin(2 * Math.PI * i / N); }
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let j = 0; j < levels; j++) r |= ((i >> j) & 1) << (levels - 1 - j); rev[i] = r; }
  return function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

// ---------------------------------------------------------------- メイン
console.log('[analyze] reading', WAV);
const { fmt, x } = readWav(WAV);
const SR = fmt.sampleRate;
const duration = x.length / SR;
console.log('[analyze] ' + SR + 'Hz ' + fmt.channels + 'ch  ' + duration.toFixed(2) + 's  ' + x.length + ' samples');

const N = 1024;          // 窓長 (23.2ms)
const HOP = 256;         // ホップ (5.8ms) — 音ゲー用に細かく
const frames = Math.floor((x.length - N) / HOP);
const bins = N / 2 + 1;
const fft = makeFFT(N);
const win = new Float32Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); // Hann

const binHz = SR / N;
const bandEdge = (hz) => Math.max(1, Math.min(bins - 1, Math.round(hz / binHz)));
const BANDS = [
  { name: 'low',  lo: bandEdge(30),   lo2: 0, hi: bandEdge(220)  },  // キック/ベース
  { name: 'mid',  lo: bandEdge(220),  lo2: 0, hi: bandEdge(2200) },  // ボーカル/コード
  { name: 'high', lo: bandEdge(2200), lo2: 0, hi: bandEdge(14000) }, // ハイハット/シンバル
];

const flux = new Float32Array(frames);
const bandFlux = BANDS.map(() => new Float32Array(frames));
const bandEnergy = BANDS.map(() => new Float32Array(frames));
const rms = new Float32Array(frames);

let prev = new Float32Array(bins);
const re = new Float32Array(N), im = new Float32Array(N);

console.log('[analyze] STFT ' + frames + ' frames...');
for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  let sq = 0;
  for (let i = 0; i < N; i++) { const v = x[off + i]; sq += v * v; re[i] = v * win[i]; im[i] = 0; }
  rms[f] = Math.sqrt(sq / N);
  fft(re, im);
  const mag = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    mag[b] = Math.log1p(Math.hypot(re[b], im[b]) * 240);  // 対数圧縮
  }
  let total = 0;
  for (let bi = 0; bi < BANDS.length; bi++) {
    const lo = BANDS[bi].lo, hi = BANDS[bi].hi;
    let d = 0, e = 0;
    for (let b = lo; b < hi; b++) {
      const diff = mag[b] - prev[b];
      if (diff > 0) d += diff;
      e += mag[b];
    }
    bandFlux[bi][f] = d;
    bandEnergy[bi][f] = e / (hi - lo);
    total += d;
  }
  flux[f] = total;
  prev = mag;
}

// ---------------------------------------------------------------- 正規化
function normalize(arr) {
  // 前後3秒の最大値で割り、曲中の音量変化に強くする
  const W = Math.round(3.0 * SR / HOP);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let mx = 1e-9;
    const a = Math.max(0, i - W), b = Math.min(arr.length, i + W);
    for (let j = a; j < b; j += 8) if (arr[j] > mx) mx = arr[j];
    out[i] = arr[i] / mx;
  }
  return out;
}
const fluxN = normalize(flux);
const bandFluxN = bandFlux.map(normalize);

// ---------------------------------------------------------------- ピーク検出
function pickPeaks(env, opt) {
  const preW = opt.preW || 4, postW = opt.postW || 4, meanW = opt.meanW || 26;
  const delta = opt.delta, wait = opt.wait, minVal = opt.minVal;
  const peaks = [];
  let last = -1e9;
  for (let i = preW; i < env.length - postW; i++) {
    const v = env[i];
    if (v < minVal) continue;
    let isMax = true;
    for (let j = i - preW; j <= i + postW; j++) if (env[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - meanW); j < Math.min(env.length, i + meanW); j++) { sum += env[j]; cnt++; }
    const mean = sum / cnt;
    if (v < mean + delta) continue;
    if (i - last < wait) continue;
    last = i;
    // 放物線補間でサブフレーム精度に
    const y0 = env[i - 1], y1 = env[i], y2 = env[i + 1];
    const denom = (y0 - 2 * y1 + y2);
    const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    peaks.push({ f: i + Math.max(-0.5, Math.min(0.5, shift)), v: v, ratio: v / (mean + 1e-6) });
  }
  return peaks;
}

const frameToTime = (f) => (f * HOP + N / 2) / SR;

const allPeaks = pickPeaks(fluxN, { delta: 0.08, wait: 6, minVal: 0.10 });
const bandPeaks = bandFluxN.map((e, i) =>
  pickPeaks(e, { delta: i === 0 ? 0.12 : 0.09, wait: i === 2 ? 5 : 8, minVal: 0.12 }));
console.log('[analyze] peaks total=' + allPeaks.length +
  ' low=' + bandPeaks[0].length + ' mid=' + bandPeaks[1].length + ' high=' + bandPeaks[2].length);

// 各 onset にバンド属性を付与
const TOL = 0.030; // 30ms
const bandTimes = bandPeaks.map(ps => ps.map(p => ({ t: frameToTime(p.f), v: p.v })));
function bandOfFast(t) {
  let best = -1, bestScore = 0;
  for (let b = 0; b < 3; b++) {
    const arr = bandTimes[b];
    let lo = 0, hi = arr.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t < t - TOL) lo = m + 1; else { idx = m; hi = m - 1; } }
    if (idx < 0) continue;
    for (let i = idx; i < arr.length && arr[i].t <= t + TOL; i++) {
      const w = arr[i].v * (1 - Math.abs(arr[i].t - t) / TOL * 0.5);
      if (w > bestScore) { bestScore = w; best = b; }
    }
  }
  return best;
}

const onsets = allPeaks.map(p => {
  const t = frameToTime(p.f);
  return { t: +t.toFixed(4), s: +Math.min(1, p.v).toFixed(3), r: +p.ratio.toFixed(2), b: bandOfFast(t) };
});

// ---------------------------------------------------------------- テンポ推定
function estimateTempo(env, from, to) {
  const minLag = Math.round(60 / 200 * SR / HOP);  // 200BPM
  const maxLag = Math.round(60 / 65 * SR / HOP);   // 65BPM
  const seg = env.subarray(from, to);
  let mean = 0; for (let i = 0; i < seg.length; i++) mean += seg[i]; mean /= seg.length;
  const ac = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < seg.length; i += 2) s += (seg[i] - mean) * (seg[i + lag] - mean);
    ac[lag] = s / (seg.length - lag);
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * HOP / SR);
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.55, 2)); // 125BPM中心の事前分布
    let harm = ac[lag];
    if (lag * 2 <= maxLag) harm += 0.5 * ac[lag * 2];
    if ((lag >> 1) >= minLag) harm += 0.5 * ac[lag >> 1];
    const score = harm * w;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return { lag: bestLag, bpm: 60 / (bestLag * HOP / SR), score: bestScore };
}

const globalTempo = estimateTempo(fluxN, 0, frames);
const segs = 6, segTempos = [];
for (let s = 0; s < segs; s++) {
  const a = Math.floor(frames * s / segs), b = Math.floor(frames * (s + 1) / segs);
  segTempos.push(+estimateTempo(fluxN, a, b).bpm.toFixed(2));
}
console.log('[analyze] bpm = ' + globalTempo.bpm.toFixed(3) + '  segments: ' + segTempos.join(', '));

// ビート位相：コムフィルタで最良オフセットを探す
function beatPhase(env, lagF) {
  let bestOff = 0, bestScore = -Infinity;
  const L = Math.round(lagF);
  for (let off = 0; off < L; off++) {
    let s = 0, c = 0;
    for (let i = off; i < env.length; i += lagF) {
      const idx = Math.round(i);
      if (idx < env.length) { s += env[idx]; c++; }
    }
    if (c && s / c > bestScore) { bestScore = s / c; bestOff = off; }
  }
  return bestOff;
}
const lagF = globalTempo.lag;
const phase = beatPhase(fluxN, lagF);
const beatPeriod = lagF * HOP / SR;
const beat0raw = frameToTime(phase);
const beats = [];
let t0 = beat0raw - Math.floor(beat0raw / beatPeriod) * beatPeriod;
for (let t = t0; t < duration; t += beatPeriod) if (t >= 0) beats.push(+t.toFixed(4));
console.log('[analyze] beat period ' + beatPeriod.toFixed(4) + 's  first beat ' + beats[0] + 's  beats=' + beats.length);

// ---------------------------------------------------------------- 可視化用エネルギー (60fps)
const VFPS = 60;
const vFrames = Math.floor(duration * VFPS);
const vis = { fps: VFPS, low: [], mid: [], high: [], rms: [] };
const bandMax = bandEnergy.map(a => { let m = 1e-9; for (const v of a) if (v > m) m = v; return m; });
let rmsMax = 1e-9; for (const v of rms) if (v > rmsMax) rmsMax = v;
for (let i = 0; i < vFrames; i++) {
  const f = Math.min(frames - 1, Math.round(i / VFPS * SR / HOP));
  vis.low.push(+(bandEnergy[0][f] / bandMax[0]).toFixed(3));
  vis.mid.push(+(bandEnergy[1][f] / bandMax[1]).toFixed(3));
  vis.high.push(+(bandEnergy[2][f] / bandMax[2]).toFixed(3));
  vis.rms.push(+(rms[f] / rmsMax).toFixed(3));
}

// ---------------------------------------------------------------- シーンカット
let cuts = [];
if (fs.existsSync(CUTS)) {
  cuts = fs.readFileSync(CUTS, 'utf8').split(/\s+/).filter(Boolean).map(Number)
    .filter(t => !Number.isNaN(t)).sort((a, b) => a - b);
}
console.log('[analyze] scene cuts = ' + cuts.length);

// ---------------------------------------------------------------- 書き出し
const out = {
  duration: +duration.toFixed(3),
  sampleRate: SR,
  hop: HOP,
  bpm: +globalTempo.bpm.toFixed(3),
  bpmSegments: segTempos,
  beatPeriod: +beatPeriod.toFixed(5),
  beats: beats,
  onsets: onsets,
  cuts: cuts.map(t => +t.toFixed(3)),
  vis: vis,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('[analyze] wrote ' + OUT + '  ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB');
