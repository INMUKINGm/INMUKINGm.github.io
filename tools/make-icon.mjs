/* ===========================================================================
   make-icon.mjs — サイトのアイコンを作る（外部ライブラリなし）
   ドン（塗りのマゼンタ）とカ（シアンの輪）を並べた、ゲームそのままの意匠。
     node tools/make-icon.mjs
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icon');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- PNG 書き出し */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // フィルタなし
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/* ---------------------------------------------------------------- 絵を描く */
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const over = (dst, src, a) => [lerp(dst[0], src[0], a), lerp(dst[1], src[1], a), lerp(dst[2], src[2], a)];

const CY = [31, 230, 255], MG = [255, 46, 134];
const BG0 = [10, 14, 26], BG1 = [22, 30, 54];

/** 角を45度に落とした正方形の内側か（px単位の符号付き距離を返す） */
function tileDist(x, y, S, cut) {
  const m = S * 0.055;                               // 外側の余白
  const a = m, b = S - m;
  let d = Math.min(x - a, y - a, b - x, b - y);      // 四辺
  d = Math.min(d, (x - a) + (y - a) - cut);          // 左上の面取り
  d = Math.min(d, (b - x) + (b - y) - cut);          // 右下の面取り
  return d;
}

function render(S) {
  const buf = Buffer.alloc(S * S * 4);
  const cut = S * 0.30;
  const r = S * 0.158;                               // 円の半径
  const cxD = S * 0.355, cyD = S * 0.50;             // ドン
  const cxK = S * 0.645, cyK = S * 0.50;             // カ
  const ringW = r * 0.34;
  const aa = Math.max(1, S / 180);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = tileDist(px, py, S, cut);
      const inside = sstep(-aa, aa, d);
      if (inside <= 0.002) { buf[(y * S + x) * 4 + 3] = 0; continue; }

      // 地：斜めのグラデーション
      const g = Math.max(0, Math.min(1, (px + py) / (S * 2)));
      let col = mix(BG0, BG1, g * 0.85);

      // 上端の細い光
      col = over(col, [255, 255, 255], 0.05 * sstep(aa * 3, 0, d) * sstep(S * 0.5, 0, py));

      // 縁：左上はシアン、右下はマゼンタ
      const edge = sstep(aa * 2.2, 0, d) * 0.95;
      if (edge > 0.003) col = over(col, mix(CY, MG, g), edge);

      // ドン（塗り）
      const dd = Math.hypot(px - cxD, py - cyD);
      const fill = sstep(r + aa, r - aa, dd);
      if (fill > 0.003) {
        const sh = 1 - sstep(0, r, Math.hypot(px - (cxD - r * .32), py - (cyD - r * .36))) * 0.55;
        col = over(col, mix([255, 255, 255], MG, Math.min(1, 0.28 + 0.9 * (1 - sh))), fill);
        col = over(col, [255, 255, 255], fill * sstep(r, r - ringW * 0.5, dd) * 0.0);
      }
      // ドンの白フチ
      const dRim = Math.abs(dd - r);
      col = over(col, [255, 255, 255], sstep(aa * 1.6, 0, dRim - ringW * 0.16) * 0.9);

      // カ（輪）
      const dk = Math.hypot(px - cxK, py - cyK);
      const ring = sstep(aa, 0, Math.abs(dk - r) - ringW * 0.5);
      if (ring > 0.003) col = over(col, CY, ring);
      const kRim = sstep(aa * 1.4, 0, Math.abs(dk - r) - ringW * 0.5 - aa * 0.8);
      col = over(col, [255, 255, 255], kRim * 0.35 * (1 - ring));
      // 輪の内側をうっすら暗く
      if (dk < r - ringW * 0.5) col = over(col, [6, 10, 20], sstep(r - ringW * 0.5, r - ringW, dk) * 0.55);

      const o = (y * S + x) * 4;
      buf[o] = Math.round(Math.max(0, Math.min(255, col[0])));
      buf[o + 1] = Math.round(Math.max(0, Math.min(255, col[1])));
      buf[o + 2] = Math.round(Math.max(0, Math.min(255, col[2])));
      buf[o + 3] = Math.round(inside * 255);
    }
  }
  return buf;
}

for (const S of [512, 192, 180, 64, 32]) {
  const bytes = writePNG(path.join(OUT, 'icon-' + S + '.png'), S, S, render(S));
  console.log('icon-' + S + '.png', (bytes / 1024).toFixed(1) + 'KB');
}

/* SVG 版（モダンブラウザのタブ用。小さくても潰れない） */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="e" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1fe6ff"/><stop offset="1" stop-color="#ff2e86"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0e1a"/><stop offset="1" stop-color="#161e36"/>
    </linearGradient>
    <radialGradient id="d" cx="36%" cy="34%">
      <stop offset="0" stop-color="#ff9ac8"/><stop offset="1" stop-color="#ff2e86"/>
    </radialGradient>
  </defs>
  <path d="M35.5 5.5H94.5V64.5L64.5 94.5H5.5V35.5Z" fill="url(#b)" stroke="url(#e)" stroke-width="3"/>
  <circle cx="35.5" cy="50" r="15.8" fill="url(#d)" stroke="#fff" stroke-width="2.6"/>
  <circle cx="64.5" cy="50" r="15.8" fill="#060a14" stroke="#1fe6ff" stroke-width="5.4"/>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
console.log('icon.svg');
