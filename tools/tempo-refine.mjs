// tempo-refine.mjs — onset群に対する位相ロックで BPM を小数3桁まで追い込む
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const d = JSON.parse(fs.readFileSync(ROOT + '/work/analysis.json', 'utf8'));

// 音楽が鳴っている区間だけを使う（会話/環境音の誤検出を除外）
const smooth = (arr, w) => arr.map((_, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - w); j < Math.min(arr.length, i + w); j++) { s += arr[j]; n++; }
  return s / n;
});
const rmsS = smooth(d.vis.rms, 30);           // ±0.5s
const loud = (t) => rmsS[Math.min(rmsS.length - 1, Math.max(0, Math.round(t * d.vis.fps)))];

const GATE = 0.22;
const used = d.onsets.filter(o => loud(o.t) >= GATE && o.t > 8 && o.t < 240);
console.log('onsets used:', used.length, '/', d.onsets.length);
const t0 = used[0].t, t1 = used[used.length - 1].t;
console.log('range', t0.toFixed(2), '-', t1.toFixed(2));

// 16分グリッドへの位相ロック（複素和）
function score(bpm, div) {
  const period = 60 / bpm / div;
  let re = 0, im = 0, wsum = 0;
  for (const o of used) {
    const w = o.s * (o.b === 0 ? 1.4 : 1.0);   // キック系を重視
    const a = 2 * Math.PI * (o.t / period);
    re += w * Math.cos(a); im += w * Math.sin(a); wsum += w;
  }
  return { mag: Math.hypot(re, im) / wsum, ang: Math.atan2(im, re), period };
}

let best = null; const peaks = [];
for (let bpm = 120; bpm <= 150; bpm += 0.001) {
  const s = score(bpm, 4);
  if (!best || s.mag > best.mag) best = { bpm: bpm, ...s };
  peaks.push([bpm, s.mag]);
}
peaks.sort((a, b) => b[1] - a[1]);
const top = [];
for (const [bpm, m] of peaks) {
  if (top.every(x => Math.abs(x[0] - bpm) > 0.3)) top.push([bpm, m]);
  if (top.length >= 6) break;
}
console.log('top candidates (bpm, lock strength):');
for (const [bpm, m] of top) console.log('  ', bpm.toFixed(3), m.toFixed(4));

// 最良BPMでのグリッド原点
const b = best;
let off = b.ang / (2 * Math.PI) * b.period;    // 位相→時間
while (off < 0) off += b.period;
off %= b.period;
console.log('BEST bpm =', b.bpm.toFixed(4), ' lock =', b.mag.toFixed(4));
console.log('16th period =', b.period.toFixed(5), ' grid offset =', off.toFixed(5));

// 残差（各onsetのグリッドからのズレ）統計
let dev = [], onGrid = 0;
for (const o of used) {
  let r = (o.t - off) % b.period; if (r > b.period / 2) r -= b.period;
  dev.push(Math.abs(r));
  if (Math.abs(r) < 0.035) onGrid++;
}
dev.sort((a, b2) => a - b2);
console.log('on-grid(±35ms) rate =', (onGrid / used.length * 100).toFixed(1) + '%',
  ' median dev =', (dev[dev.length >> 1] * 1000).toFixed(1) + 'ms');

// 小節頭（4拍）の推定：低域onsetの強さで4通りを比較
const beatP = 60 / b.bpm;
let bestBar = 0, bestBarScore = -1;
for (let k = 0; k < 4; k++) {
  let s = 0;
  for (const o of used) {
    if (o.b !== 0) continue;
    const n = Math.round((o.t - off) / beatP);
    if (((n % 4) + 4) % 4 === k) s += o.s;
  }
  if (s > bestBarScore) { bestBarScore = s; bestBar = k; }
}
const barStart = off + bestBar * beatP;
console.log('bar origin =', (barStart % (beatP * 4)).toFixed(4), 'beat =', beatP.toFixed(5));

fs.writeFileSync(ROOT + '/work/tempo.json', JSON.stringify({
  bpm: +b.bpm.toFixed(4), gridOffset: +off.toFixed(5), sixteenth: +b.period.toFixed(5),
  beat: +beatP.toFixed(5), barOrigin: +(barStart % (beatP * 4)).toFixed(5),
  musicStart: +t0.toFixed(3), musicEnd: +t1.toFixed(3), lock: +b.mag.toFixed(4),
}, null, 2));
console.log('wrote work/tempo.json');
