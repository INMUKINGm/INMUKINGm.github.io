/* ===========================================================================
   bump.mjs — 配信物に版番号を打つ
   GitHub Pages は CSS/JS を 10分ほどキャッシュするので、押したあとに
   スマホで開くと古い見た目のままになる。index.html の読み込み先と
   モジュールの import に `?v=<版番号>` を付けて確実に入れ替える。
     node tools/bump.mjs
   版番号は src/ の中身ぜんぶから作る1つの値。どれか1つ直せば全部入れ替わる。
   （ファイルごとの番号にすると、import 先だけ変わったときに
     親の番号が変わらず、古い親が古い子を読み続けてしまう）
   中身が同じなら番号も同じなので、毎回打っても無害。
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const strip = (t) => t.replace(/\?v=[0-9a-f]{8}/g, '');

const files = fs.readdirSync(SRC).filter((f) => /\.(js|css)$/.test(f)).sort();
const h = crypto.createHash('sha1');
for (const f of files) h.update(f).update(strip(fs.readFileSync(path.join(SRC, f), 'utf8')));
const V = h.digest('hex').slice(0, 8);

let changed = 0;
const put = (p, re) => {
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(re, (m, a, file, _q, z) => a + file + '?v=' + V + z);
  if (after !== before) { fs.writeFileSync(p, after); changed++; console.log('  ' + path.relative(ROOT, p)); }
};

// src/*.js の相対 import
for (const f of files.filter((x) => x.endsWith('.js'))) {
  put(path.join(SRC, f), /(from\s+'\.\/)([\w.-]+\.js)(\?v=[0-9a-f]{8})?(')/g);
}
// index.html の <link rel=stylesheet> と <script type=module>
put(path.join(ROOT, 'index.html'), /((?:href|src)=")(src\/[\w.-]+\.(?:css|js))(\?v=[0-9a-f]{8})?(")/g);

console.log(changed ? '版番号 ' + V + ' に更新（' + changed + 'ファイル）' : '版番号 ' + V + ' のまま（変更なし）');
