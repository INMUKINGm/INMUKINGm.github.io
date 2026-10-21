/* ===========================================================================
   bpm-scan.mjs — テンポの候補を総当たりで比べる
     node tools/bpm-scan.mjs <曲id> [最小bpm] [最大bpm]
   work/<id>/analysis.json のオンセットを使い、
   「拍グリッドにどれだけ揃うか」を複素和の大きさ（位相ロック）で測る。
   拍・8分・16分のそれぞれで見て、倍・半分の取り違えを見分ける。
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SONG = process.argv[2] || 'inmuking';
const LO = +(process.argv[3] || 60);
const HI = +(process.argv[4] || 210);

const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'work', SONG, 'analysis.json'), 'utf8'));
const ons = A.onsets.filter(o => o.s > 0.25);
console.log(SONG + ': onsets ' + ons.length + ' / ' + A.onsets.length +
  '  (analyze の自動判定 ' + A.bpm.toFixed(3) + ')');

/** period 秒のグリッドに対する位相ロックの強さ（0〜1）と最良の位相 */
function lock(period) {
  let re = 0, im = 0, w = 0;
  for (const o of ons) {
    const ph = 2 * Math.PI * (o.t / period);
    re += Math.cos(ph) * o.s; im += Math.sin(ph) * o.s; w += o.s;
  }
  const m = Math.hypot(re, im) / Math.max(1e-9, w);
  const ang = Math.atan2(im, re);
  let off = ang / (2 * Math.PI) * period;
  off = ((off % period) + period) % period;
  return { m, off };
}

const rows = [];
for (let bpm = LO; bpm <= HI; bpm += 0.01) {
  const beat = 60 / bpm;
  const b = lock(beat), e = lock(beat / 2), s = lock(beat / 4);
  // 拍で揃い、かつ16分でも揃うものを高く見る
  rows.push({ bpm, beat: b.m, eighth: e.m, sixteenth: s.m, score: b.m * 0.5 + e.m * 0.3 + s.m * 0.2, off: s.off });
}
rows.sort((x, y) => y.score - x.score);

// 近い候補はまとめる
const picked = [];
for (const r of rows) {
  if (picked.some(p => Math.abs(p.bpm - r.bpm) < 1.2 ||
                       Math.abs(p.bpm * 2 - r.bpm) < 1.2 || Math.abs(p.bpm / 2 - r.bpm) < 1.2)) continue;
  picked.push(r);
  if (picked.length >= 10) break;
}

console.log('  bpm      拍      8分     16分    総合');
for (const r of picked) {
  console.log('  ' + r.bpm.toFixed(3).padStart(7) + '  ' +
    r.beat.toFixed(4) + '  ' + r.eighth.toFixed(4) + '  ' + r.sixteenth.toFixed(4) +
    '  ' + r.score.toFixed(4));
}

// 一番良いものの倍率違いも並べる
const best = picked[0];
console.log('\n最良 ' + best.bpm.toFixed(3) + ' の倍率違い:');
for (const k of [0.5, 2 / 3, 0.75, 1, 4 / 3, 1.5, 2]) {
  const bpm = best.bpm * k;
  if (bpm < 40 || bpm > 300) continue;
  const beat = 60 / bpm;
  const b = lock(beat), s = lock(beat / 4);
  console.log('  ×' + k.toFixed(3) + ' = ' + bpm.toFixed(3).padStart(7) +
    '  拍 ' + b.m.toFixed(4) + '  16分 ' + s.m.toFixed(4));
}
