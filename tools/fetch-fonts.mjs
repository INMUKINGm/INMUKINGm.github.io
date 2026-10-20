/* ===========================================================================
   fetch-fonts.mjs — 使うフォントを woff2 ごとこのプロジェクトに落としてくる。
   ネットがない環境でも同じ見た目になるよう、CDN は参照しない。
     node tools/fetch-fonts.mjs
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FAMILIES = [
  // 日本語＋英字の本文
  { q: 'Zen+Kaku+Gothic+New:wght@500;700', slug: 'zkgn', skip: [] },
  // 数字・英字の見出し
  { q: 'Chakra+Petch:wght@600;700', slug: 'chakra', skip: ['thai', 'vietnamese'] },
];

let css = '/* 自動生成: node tools/fetch-fonts.mjs */\n';
let files = 0, bytes = 0;

for (const fam of FAMILIES) {
  const url = 'https://fonts.googleapis.com/css2?family=' + fam.q + '&display=swap';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('css ' + res.status + ' ' + url);
  const text = await res.text();

  // 日本語のCSSは subset コメントが付かないので、@font-face 単位で拾う
  const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?(@font-face\s*\{[\s\S]*?\})/g;
  let m, idx = 0;
  while ((m = re.exec(text)) !== null) {
    const subset = (m[1] || 'jp').replace(/[^\w\-]/g, '');
    const block = m[2];
    if (fam.skip.includes(subset)) continue;
    const wM = /font-weight:\s*(\d+)/.exec(block);
    const uM = /src:\s*url\((https:[^)]+\.woff2)\)/.exec(block);
    if (!uM) continue;
    const weight = wM ? wM[1] : '400';
    const name = fam.slug + '-' + weight + '-' + subset + '-' + (idx++) + '.woff2';
    const dst = path.join(OUT, name);
    if (!fs.existsSync(dst)) {
      const f = await fetch(uM[1], { headers: { 'User-Agent': UA } });
      if (!f.ok) { console.warn('skip', uM[1], f.status); continue; }
      const buf = Buffer.from(await f.arrayBuffer());
      fs.writeFileSync(dst, buf);
      bytes += buf.length;
    } else {
      bytes += fs.statSync(dst).size;
    }
    files++;
    css += block
      .replace(/\/\*[^*]*\*\/\s*/g, '')
      .replace(uM[1], '../assets/fonts/' + name)
      .trim() + '\n';
  }
  console.log('[fonts]', fam.q, '→', idx, 'files');
}

fs.writeFileSync(path.join(ROOT, 'src', 'fonts.css'), css);
console.log('[fonts] total', files, 'files', (bytes / 1024 / 1024).toFixed(2), 'MB → src/fonts.css');
