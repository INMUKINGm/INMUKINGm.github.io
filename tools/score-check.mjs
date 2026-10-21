/* ===========================================================================
   score-check.mjs — 全良フルコンがちょうど 114514 になるか検算する
     node tools/score-check.mjs
   ブラウザを立てずに Game を AUTO で最後まで回す。時計は偽物、描画は空。
   譜面を作り直したら必ず通すこと（連打が採点から漏れていた事故がある）。
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Game } = await import(pathToFileURL(path.join(ROOT, 'src/play.js')).href);
const { toTaikoChart } = await import(pathToFileURL(path.join(ROOT, 'src/taiko.js')).href);
const song = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/song.json'), 'utf8'));

let CLOCK = 0;
const audio = {
  setVolume() {}, setSfxVolume() {}, async resume() {}, play() {}, stop() {}, blip() {},
  async suspend() {}, get time() { return CLOCK; }, timeAtEvent() { return CLOCK; },
};
const video = { async start() {}, pause() {}, sync() {} };
const gfx = { shock() {}, p: { judgeY: 0, flash: 0 } };
const rd = {
  hit() {}, missPop() {}, roll() {}, parts: [], laneX() { return 0; },
  judgeY: 0, h: 100, w: 100, fieldW: 100, judgeX: 10,
};
const settings = {
  scroll: 0.78, offset: 0, volume: 0.85, hitsound: false, hitvol: 1.1,
  intro: false, fx: 1, dim: 0.35, persp: 0.75, showFast: false,
};

function run(mode, file) {
  let chart = JSON.parse(fs.readFileSync(path.join(ROOT, 'charts', file), 'utf8'));
  if (mode === 'taiko') chart = toTaikoChart(chart, song);
  const g = new Game({
    audio, video, gfx, renderer: rd, song, settings,
    mods: { auto: true }, hooks: {}, mode, chart, section: null,
  });
  g.running = true;
  CLOCK = g.startAt;
  const dt = 1 / 240;
  while (!g.finished && CLOCK < g.endAt + 1) { g.update(dt); CLOCK += dt; }
  const bo = g.bonuses();
  return {
    score: g.score, pts: g.pts, ...bo,
    awarded: g._awarded, total: g.total,
    bigHits: g.bigHits, bigCount: g.bigCount, counts: g.counts.slice(),
  };
}

let ng = 0;
for (const mode of ['4k', 'taiko']) {
  for (const f of ['normal.json', 'hard.json', 'oni.json', 'ura.json']) {
    const r = run(mode, f);
    const ok = r.score === 114514;
    if (!ok) ng++;
    console.log((ok ? '  OK ' : '  NG ') + mode.padEnd(6) + f.replace('.json', '').padEnd(8) +
      ' score=' + String(r.score).padStart(7) +
      ' (素点' + r.pts + ' +全キメ' + r.sp + ' +全良' + r.ap + ' +フルコン' + r.fc + ')' +
      ' 配点済み ' + r.awarded + '/' + r.total +
      ' 大 ' + r.bigHits + '/' + r.bigCount);
  }
}
console.log(ng ? ng + ' 譜面が 114514 になりません' : 'すべて 114514 ちょうど');
process.exit(ng ? 1 : 0);
