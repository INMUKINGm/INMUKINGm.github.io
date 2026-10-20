/* ===========================================================================
   audio.js — WebAudio による再生とマスタークロック
   ・曲全体を AudioBuffer に展開し、AudioContext.currentTime を時計にする
   ・出力レイテンシを引いて「いま実際に鳴っている位置」を返す
   ・performance.now() → オーディオ時計 の変換を保持し、
     キー入力イベントの timeStamp からサブフレーム精度で押下時刻を求める
   =========================================================================== */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.src = null;
    this.gain = null;
    this.startCtx = 0;     // 再生開始時の ctx.currentTime
    this.startOffset = 0;  // 再生開始時の曲内位置
    this.playing = false;
    this.rate = 1;
    this.pa = 0;           // ctx.currentTime - performance.now()/1000
    this._paInit = false;
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.5;
    this.sfx.connect(this.ctx.destination);
    this._makeHitBuffers();
    this.syncClock();
  }

  /** 出力レイテンシ（秒）。取れない環境では baseLatency で代用 */
  get latency() {
    const c = this.ctx;
    if (!c) return 0;
    const o = (typeof c.outputLatency === 'number' && isFinite(c.outputLatency)) ? c.outputLatency : 0;
    return o || c.baseLatency || 0;
  }

  /** performance.now() とオーディオ時計の対応を更新（毎フレーム呼ぶ） */
  syncClock() {
    if (!this.ctx) return;
    const pa = this.ctx.currentTime - performance.now() / 1000;
    if (!this._paInit || !isFinite(this.pa)) { this.pa = pa; this._paInit = true; return; }
    const diff = pa - this.pa;
    // 大きく飛んだら即追従、ふだんは緩やかに均して時計のジッタを消す
    if (Math.abs(diff) > 0.05) this.pa = pa;
    else this.pa += diff * 0.05;
  }

  async load(urls, onProgress) {
    await this.init();
    let res = null, lastErr = null;
    for (const u of urls) {
      try {
        res = await fetchWithProgress(u, onProgress);
        if (res) break;
      } catch (e) { lastErr = e; }
    }
    if (!res) throw lastErr || new Error('audio load failed');
    this.buffer = await this.ctx.decodeAudioData(res);
    return this.buffer.duration;
  }

  /** 指定位置から再生。startIn は「何秒後に鳴らし始めるか」 */
  play(offset = 0, startIn = 0.14, rate = 1) {
    this.stop();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    src.connect(this.gain);
    const when = ctx.currentTime + startIn;
    src.start(when, Math.max(0, offset));
    this.src = src;
    this.rate = rate;
    this.startCtx = when;
    this.startOffset = offset;
    this.playing = true;
    return when;
  }

  stop() {
    if (this.src) { try { this.src.stop(); } catch (e) { /* 停止済み */ } this.src.disconnect(); this.src = null; }
    this.playing = false;
  }

  async suspend() { if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend(); }
  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }

  setVolume(v) { if (this.gain) this.gain.gain.value = v; }

  /** いま耳に届いている曲内位置（秒） */
  get time() {
    if (!this.playing) return this.startOffset;
    return (this.ctx.currentTime - this.latency - this.startCtx) * this.rate + this.startOffset;
  }

  /** イベントの timeStamp(ms) から曲内位置を求める */
  timeAtEvent(tsMs) {
    if (!this.playing) return this.time;
    // timeStamp を持たない合成イベントは現在時刻で代用する
    if (!tsMs || !isFinite(tsMs) || tsMs <= 0) return this.time;
    const ctxT = tsMs / 1000 + this.pa;
    return (ctxT - this.latency - this.startCtx) * this.rate + this.startOffset;
  }

  // ------------------------------------------------------------- 打鍵音
  _makeHitBuffers() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const mk = (dur, fn) => {
      const b = ctx.createBuffer(1, Math.ceil(sr * dur), sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, i / d.length);
      return b;
    };
    // 短いクリック（ノイズ＋高めのサイン）
    this.hitBuf = mk(0.05, (t, p) => {
      const env = Math.pow(1 - p, 3);
      return (Math.sin(2 * Math.PI * 1900 * t) * 0.55 + (Math.random() * 2 - 1) * 0.45) * env * 0.5;
    });
    // CUT 用の太い音
    this.cutBuf = mk(0.14, (t, p) => {
      const env = Math.pow(1 - p, 2.2);
      return (Math.sin(2 * Math.PI * (420 - 240 * p) * t) * 0.7 + (Math.random() * 2 - 1) * 0.3) * env * 0.6;
    });
    // 較正用メトロノーム
    this.tickBuf = mk(0.06, (t, p) => Math.sin(2 * Math.PI * 1500 * t) * Math.pow(1 - p, 4) * 0.6);
  }

  blip(kind = 'hit', when = 0) {
    if (!this.ctx) return;
    const b = kind === 'cut' ? this.cutBuf : kind === 'tick' ? this.tickBuf : this.hitBuf;
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.sfx);
    s.start(when || 0);
  }
  setSfxVolume(v) { if (this.sfx) this.sfx.gain.value = v; }
}

async function fetchWithProgress(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const total = +(r.headers.get('content-length') || 0);
  if (!r.body || !total || !onProgress) return await r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out.buffer;
}
