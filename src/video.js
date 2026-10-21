/* ===========================================================================
   video.js — MV の再生と、オーディオ時計へのドリフト補正
   音ではなく「音の時計」に映像を追従させる。ずれ幅に応じて
   再生速度を微調整し、大きく飛んだときだけシークし直す。
   =========================================================================== */

export class VideoSync {
  constructor(el) {
    this.el = el;
    this.ready = false;
    this.enabled = true;
    this.drift = 0;
    this.lastSeek = -9;
    this.mediaTime = 0;
    this.frameSeq = 0;        // 新しいコマが届くたびに増える（texture の貼り直し用）
    this._rvfc = typeof el.requestVideoFrameCallback === 'function';
  }

  load(src) {
    return new Promise((resolve, reject) => {
      const el = this.el;
      const ok = () => { cleanup(); this.ready = true; resolve(); };
      const ng = () => { cleanup(); reject(new Error('video load failed: ' + src)); };
      const cleanup = () => {
        el.removeEventListener('loadeddata', ok);
        el.removeEventListener('error', ng);
      };
      el.addEventListener('loadeddata', ok);
      el.addEventListener('error', ng);
      el.src = src;
      el.load();
    });
  }

  _tickFrame() {
    if (!this._rvfc) return;
    this.el.requestVideoFrameCallback((_, meta) => {
      this.mediaTime = meta.mediaTime;
      this.frameSeq++;
      this._tickFrame();
    });
  }

  get currentTime() { return this._rvfc ? this.mediaTime : this.el.currentTime; }

  async seek(t) {
    const el = this.el;
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); resolve(); };
      el.addEventListener('seeked', fin);
      try { el.currentTime = Math.max(0, t); } catch (e) { fin(); }
      setTimeout(fin, 900);   // シークが返ってこない環境でも進める
    });
  }

  async start(t) {
    if (!this.ready || !this.enabled) return;
    await this.seek(t);
    this.mediaTime = t;
    try { await this.el.play(); } catch (e) { /* 自動再生が弾かれた場合は無音継続 */ }
    this._tickFrame();
  }

  pause() { try { this.el.pause(); } catch (e) { /* noop */ } }

  /** 毎フレーム：target（曲内位置・秒）に映像を合わせる */
  sync(target, now) {
    if (!this.ready || !this.enabled || this.el.paused) return;
    const d = this.currentTime - target;
    this.drift = d;
    const ad = Math.abs(d);
    if (ad > 0.30 && now - this.lastSeek > 0.8) {
      this.lastSeek = now;
      this.el.playbackRate = 1;
      this.seek(target + 0.04);
    } else if (ad > 0.045) {
      // 1フレーム(41.7ms)より大きいずれだけ速度で吸収する
      this.el.playbackRate = Math.max(0.90, Math.min(1.10, 1 - d * 1.1));
    } else if (this.el.playbackRate !== 1) {
      this.el.playbackRate = 1;
    }
  }

  setRate(r) { this.baseRate = r; }
}
