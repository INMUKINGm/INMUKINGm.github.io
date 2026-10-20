/* ===========================================================================
   serve.mjs — MVBEAT 用のローカルサーバ
   Range リクエストに対応（MVのシークに必須）。依存ライブラリなし。
   =========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8730);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + p); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start >= st.size) { res.writeHead(416, { 'content-range': 'bytes */' + st.size }).end(); return; }
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      res.writeHead(206, { ...head, 'content-range': 'bytes ' + start + '-' + end + '/' + st.size, 'content-length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...head, 'content-length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
});

let port = PORT, tries = 0;
function listen() {
  server.listen(port, () => {
    const url = 'http://localhost:' + port + '/';
    console.log('');
    console.log('  BEAST 先輩  ->  ' + url);
    console.log('  (このウィンドウを閉じるとサーバが止まります)');
    console.log('');
    if (process.argv.includes('--open')) {
      import('node:child_process').then(cp => cp.exec('start "" "' + url + '"', { shell: 'cmd.exe' }));
    }
  });
}
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < 8) {
    tries++; port++;
    console.log('  ポート ' + (port - 1) + ' は使用中。' + port + ' を試します…');
    setTimeout(listen, 60);
  } else {
    console.error(e.message || e);
  }
});
listen();
