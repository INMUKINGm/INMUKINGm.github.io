/* ===========================================================================
   build.mjs — MV から素材と譜面を作り直す一括処理
     node tools/build.mjs "C:\\path\\to\\MV.mp4"
   引数を省くと work/source.txt に記録された前回のMVを使う。
   ffmpeg / ffprobe は PATH か、よくある場所から自動で探す。
   =========================================================================== */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, 'work');
const ASSETS = path.join(ROOT, 'assets');
const SRCFILE = path.join(WORK, 'source.txt');

function findFF(name) {
  const candidates = [
    name,
    'C:/Program Files/KeepStreams/KeepBeats/' + name + '.exe',
    'C:/ffmpeg/bin/' + name + '.exe',
    'C:/Program Files/ffmpeg/bin/' + name + '.exe',
  ];
  for (const c of candidates) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (e) { /* 次を試す */ }
  }
  throw new Error(name + ' が見つかりません。ffmpeg を入れて PATH を通してください。');
}

const FFMPEG = findFF('ffmpeg');
const FFPROBE = findFF('ffprobe');
console.log('[build] ffmpeg:', FFMPEG);

const argv = process.argv.slice(2);
const SONG = argv.find(a => /^[a-z0-9_-]+$/i.test(a) && !fs.existsSync(a)) || 'inmuking';
let src = argv.find(a => fs.existsSync(a) && /\.(mp4|mkv|webm|mov|m4v)$/i.test(a));

const WORK_S = path.join(WORK, SONG);
const OUT_S = path.join(ASSETS, 'songs', SONG);
const SRCFILE_S = path.join(WORK_S, 'source.txt');
fs.mkdirSync(WORK_S, { recursive: true });
fs.mkdirSync(OUT_S, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'charts', SONG), { recursive: true });

if (!src && fs.existsSync(SRCFILE_S)) src = fs.readFileSync(SRCFILE_S, 'utf8').trim();
if (!src || !fs.existsSync(src)) {
  console.error('使い方:  node tools/build.mjs <曲id> "C:\path\to\MV.mp4"');
  process.exit(1);
}
fs.writeFileSync(SRCFILE_S, src);
console.log('[build] song  :', SONG);
console.log('[build] source:', src);

const run = (args, label) => {
  console.log('[build] ' + label);
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'inherit'] });
};

// 1) 解析用 WAV
run(['-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', path.join(WORK_S, 'song.wav')], '解析用 WAV を書き出し');

// 2) シーンカット検出
console.log('[build] シーンカットを検出');
{
  const out = execSync('"' + FFMPEG + '" -hide_banner -y -i "' + src +
    '" -filter_complex "[0:v:0]select=\'gt(scene,0.25)\',metadata=print:file=-" -an -f null - 2>nul', { shell: 'cmd.exe', maxBuffer: 1 << 26 }).toString();
  const cuts = [...out.matchAll(/pts_time:([0-9.]+)/g)].map(m => m[1]);
  fs.writeFileSync(path.join(WORK_S, 'cuts.txt'), cuts.join('\n'));
  console.log('[build]   cuts =', cuts.length);
}

// 3) 配信用の音と映像
run(['-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(OUT_S, 'song.m4a')], '音声(m4a)');
run(['-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-vn', '-c:a', 'libopus', '-b:a', '160k', path.join(OUT_S, 'song.ogg')], '音声(ogg)');

const dur = Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim());
const coverAt = Math.max(1, Math.min(dur - 1, dur * 0.3));
run(['-v', 'error', '-y', '-ss', String(coverAt), '-i', src, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', path.join(OUT_S, 'cover.jpg')], 'ジャケット');

run(['-v', 'error', '-stats', '-y', '-i', src, '-map', '0:v:0', '-an', '-c:v', 'libx264', '-crf', '21', '-preset', 'medium',
  '-pix_fmt', 'yuv420p', '-g', '48', '-movflags', '+faststart', path.join(OUT_S, 'mv_1080.mp4')], '映像 1080p（数分かかります）');
run(['-v', 'error', '-stats', '-y', '-i', src, '-map', '0:v:0', '-an', '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
  '-pix_fmt', 'yuv420p', '-g', '48', '-movflags', '+faststart', path.join(OUT_S, 'mv_720.mp4')], '映像 720p');

// 4) 解析 → 較正 → 譜面
const node = process.execPath;
for (const step of ['analyze.mjs', 'onset-bias.mjs', 'tempo-refine.mjs', 'generate-charts.mjs']) {
  console.log('[build] ' + step);
  execFileSync(node, [path.join(ROOT, 'tools', step), SONG], { stdio: 'inherit', env: { ...process.env, SONG } });
}

console.log('');
console.log('[build] 完了。start.bat で遊べます。');
console.log('        曲名を変えるときは tools/generate-charts.mjs の末尾 manifest を直して');
console.log('        node tools/generate-charts.mjs を実行してください。');
