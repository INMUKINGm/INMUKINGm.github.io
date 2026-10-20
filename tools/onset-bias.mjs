// onset-bias.mjs — スペクトルフラックス検出時刻と、実際の波形の立ち上がりの
// 系統的なズレ(ms)を実測する。音ゲーの絶対タイミング精度を出すための較正。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


function readWav(file) {
  const buf = fs.readFileSync(file);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4), body = pos + 8;
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4) };
    else if (id === 'data') data = buf.subarray(body, body + size);
    pos = body + size + (size & 1);
  }
  const n = Math.floor(data.length / 2), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2) / 32768;
  return { fmt, x };
}

const { fmt, x } = readWav(ROOT + '/work/song.wav');
const SR = fmt.sampleRate;
const d = JSON.parse(fs.readFileSync(ROOT + '/work/analysis.json', 'utf8'));

// 1ms 窓の短時間エネルギー
const W = Math.round(SR * 0.001);
function energyAt(s) {
  let e = 0;
  for (let i = s; i < s + W && i < x.length; i++) e += x[i] * x[i];
  return e / W;
}

const strong = d.onsets.filter(o => o.s > 0.55 && o.t > 15 && o.t < 230);
const biases = [];
for (const o of strong) {
  const c = Math.round(o.t * SR);
  const a = Math.max(0, c - Math.round(SR * 0.045));
  const b = Math.min(x.length - W, c + Math.round(SR * 0.045));
  let peak = 0, peakPos = c;
  for (let s = a; s < b; s += W) { const e = energyAt(s); if (e > peak) { peak = e; peakPos = s; } }
  if (peak <= 0) continue;
  // ピークの手前で、ピークの15%を初めて超えた位置＝アタックの立ち上がり
  let rise = peakPos;
  for (let s = peakPos; s >= a; s -= W) { if (energyAt(s) < peak * 0.15) { rise = s + W; break; } }
  biases.push((rise / SR - o.t) * 1000);
}
biases.sort((a, b) => a - b);
const med = biases[biases.length >> 1];
const q1 = biases[Math.floor(biases.length * 0.25)], q3 = biases[Math.floor(biases.length * 0.75)];
console.log('samples:', biases.length);
console.log('bias median = ' + med.toFixed(2) + 'ms   IQR = ' + q1.toFixed(2) + ' .. ' + q3.toFixed(2) + 'ms');
console.log('→ onset時刻に ' + med.toFixed(2) + 'ms を加えると実際のアタックに一致');
fs.writeFileSync(ROOT + '/work/bias.json', JSON.stringify({ biasMs: +med.toFixed(2), n: biases.length }));
