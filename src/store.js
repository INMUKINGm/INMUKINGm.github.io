/* ===========================================================================
   store.js — 設定とスコアの保存
   =========================================================================== */
const KEY = 'mvbeat.v1';

const DEFAULTS = {
  scroll: 0.78,        // ノーツが画面に出てから判定線に来るまでの秒数
  offset: 0,           // 判定オフセット(ms)  +で「遅く叩く人」向けに遅らせる
  volume: 0.85,
  hitsound: true,
  hitvol: 1.10,        // 打撃音の音量
  fx: 1.0,             // 映像エフェクトの強さ
  dim: 0.35,           // 映像の暗さ（ノーツの見やすさ）
  persp: 0.75,         // ハイウェイの奥行き感
  quality: 'hi',       // hi | lo | off
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  lastDiff: 'hard',
  lastMode: '4k',
  showFast: true,
  intro: false,        // MV冒頭の寸劇から再生するか（既定は曲頭から）
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, scores: {} };
    const o = JSON.parse(raw);
    return { ...DEFAULTS, ...o, scores: o.scores || {} };
  } catch (e) {
    return { ...DEFAULTS, scores: {} };
  }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても遊べる */ }
}

export const settings = new Proxy({}, {
  get: (_, k) => state[k],
  set: (_, k, v) => { state[k] = v; persist(); return true; },
});

export function resetSettings() {
  const scores = state.scores;
  state = { ...DEFAULTS, scores };
  persist();
}

export function getBest(diff) { return state.scores[diff] || null; }

export function saveBest(diff, rec) {
  const cur = state.scores[diff];
  if (!cur || rec.score > cur.score) {
    state.scores[diff] = rec;
    persist();
    return true;
  }
  // フルコンボなどの実績は上書きしない形で残す
  if (rec.maxCombo > (cur.maxCombo || 0)) { cur.maxCombo = rec.maxCombo; persist(); }
  return false;
}

export const DEFAULT_SETTINGS = DEFAULTS;
