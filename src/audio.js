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

  // ------------------------------------------------------------- 打撃音
  /* 円形膜の振動モードを重ねて和太鼓の胴鳴りを作る。
     低いモードほど長く残り、立ち上がりに短いノイズを足して皮の当たりを出す。 */
  _makeHitBuffers() {
    const ctx = this.ctx, sr = ctx.sampleRate;

    // 2次共振バンドパス（ノイズの色づけ用）
    const bandpass = (x, fc, Q) => {
      const w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
      const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const xn = x[i];
        const yn = b0 * xn + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = xn; y2 = y1; y1 = yn; x[i] = yn;
      }
      return x;
    };

    // 円形膜の固有モード比と、その鳴りの強さ
    const MODE = [1.000, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501];
    const AMP = [1.00, 0.46, 0.30, 0.23, 0.16, 0.12, 0.09, 0.06];

    const drum = (dur, f0, glide, decay, noiseAmt, noiseFc, gain) => {
      const n = Math.ceil(sr * dur), out = new Float32Array(n);
      const ph = new Float32Array(MODE.length);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = f0 * (1 + glide * Math.exp(-t / 0.013));   // 叩いた直後だけ高い
        let v = 0;
        for (let m = 0; m < MODE.length; m++) {
          ph[m] += 2 * Math.PI * f * MODE[m] / sr;
          v += Math.sin(ph[m]) * AMP[m] * Math.exp(-t / (decay / (1 + m * 0.6)));
        }
        out[i] = v / 2.4;
      }
      const nz = new Float32Array(n);
      for (let i = 0; i < n; i++) nz[i] = (Math.random() * 2 - 1) * Math.exp(-(i / sr) / 0.005);
      bandpass(nz, noiseFc, 0.75);
      for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] + nz[i] * noiseAmt) * gain * 1.15);
      const f = Math.round(sr * 0.012);                      // 末尾を落として切る
      for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f;
      const buf = ctx.createBuffer(1, n, sr);
      buf.getChannelData(0).set(out);
      return buf;
    };

    this.buf = {
      // ドン：低く太い面の音
      don: drum(0.42, 92, 1.45, 0.175, 0.34, 820, 0.92),
      // カ：縁を叩いた硬く短い音
      ka: drum(0.16, 338, 0.55, 0.045, 1.05, 2450, 0.80),
      // 大：ひとまわり下げて長く
      big: drum(0.56, 74, 1.55, 0.265, 0.40, 700, 1.05),
    };
    // 較正用メトロノーム
    {
      const n = Math.ceil(sr * 0.06), out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i / n;
        out[i] = Math.sin(2 * Math.PI * 1500 * i / sr) * Math.pow(1 - p, 4) * 0.55;
      }
      const buf = ctx.createBuffer(1, n, sr);
      buf.getChannelData(0).set(out);
      this.buf.tick = buf;
    }
  }

  /** kind: don / ka / big / tick （hit・cut は別名） */
  blip(kind = 'don', when = 0) {
    if (!this.ctx || !this.buf) return;
    const key = kind === 'hit' ? 'don' : kind === 'cut' ? 'big' : kind;
    const b = this.buf[key] || this.buf.don;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    // 毎回わずかに音程を散らして、連打が機械的に聞こえないようにする
    s.playbackRate.value = key === 'tick' ? 1 : 0.97 + Math.random() * 0.06;
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
