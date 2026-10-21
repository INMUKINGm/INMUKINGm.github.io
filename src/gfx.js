/* ===========================================================================
   gfx.js — WebGL による MV 背景のリアルタイム加工
   映像をテクスチャとして一枚絵に焼き、音と操作に反応させる：
     低域で画がズームし、HYPE で発色が上がり、
     叩いた場所から衝撃波が走り、MVのカットで色がズレる。
   =========================================================================== */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform vec2  uRes;        // キャンバス解像度
uniform vec2  uVid;        // 映像解像度
uniform float uTime;
uniform float uBeat;       // 0-1 ビートパルス
uniform float uHype;       // 0-1
uniform float uFlash;      // 0-1 白フラッシュ
uniform float uCut;        // 0-1 カット時のズレ
uniform float uDim;        // 暗幕の強さ
uniform float uFx;         // エフェクト総量 0-1
uniform float uBass;
uniform float uTreble;
uniform float uGlow;       // 判定ラインの発光
uniform vec3  uShock0;     // x,y,age
uniform vec3  uShock1;
uniform vec3  uShock2;
uniform float uJudgeY;     // 判定ラインの位置（画面上端からの比 0-1）
uniform float uBand;       // 0=下が暗い(4レーン) 1=帯だけ暗い(たいこ)
uniform float uHasVideo;

// cover フィット（はみ出した分は切り落とす。割り算にすると端が引き伸ばされる）
vec2 coverUv(vec2 uv){
  float ca = uRes.x/uRes.y, va = uVid.x/uVid.y;
  vec2 s = (ca > va) ? vec2(1.0, va/ca) : vec2(ca/va, 1.0);
  return (uv - 0.5)*s + 0.5;
}

float shockAt(vec3 s, vec2 p){
  if(s.z <= 0.0 || s.z > 1.0) return 0.0;
  float d = distance(p, s.xy);
  float r = s.z * 0.85;
  float w = 0.055;
  float ring = exp(-pow((d-r)/w, 2.0));
  return ring * (1.0 - s.z);
}

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  // 画面上端を 0 とする座標（HUD / 判定ラインと同じ向き）
  vec2 sUv = vec2(vUv.x, 1.0 - vUv.y);

  // --- ビートに合わせた中心ズーム
  float zoom = 1.0 - (0.022*uBeat + 0.016*uBass) * uFx;
  uv = c*zoom + 0.5;

  // --- 衝撃波で歪ませる（判定ラインを中心に広がる）
  float sh = shockAt(uShock0, sUv) + shockAt(uShock1, sUv) + shockAt(uShock2, sUv);
  vec2 sdir = normalize(sUv - vec2(0.5, uJudgeY) + 1e-5);
  vec2 dir = vec2(sdir.x, -sdir.y);
  uv += dir * sh * 0.030 * uFx;

  // --- 色収差（中心から外ほど強く／カットと衝撃波で増す）
  float ab = (0.0012 + 0.010*uCut + 0.012*sh + 0.004*uHype*uBass) * uFx;
  vec2 off = c * ab * 2.0 + dir * sh * 0.006;

  vec2 b0 = coverUv(uv + off);
  vec2 b1 = coverUv(uv);
  vec2 b2 = coverUv(uv - off);

  vec3 col;
  if(uHasVideo > 0.5){
    col = vec3(texture(uTex, b0).r, texture(uTex, b1).g, texture(uTex, b2).b);
  }else{
    // 映像オフのときは音に反応する幾何背景
    float g = 0.04 + 0.12*uBass;
    float bands = sin((vUv.y*26.0) + uTime*1.3)*0.5+0.5;
    col = vec3(g*0.4, g*0.8, g) + vec3(0.02,0.10,0.16)*bands*uHype;
  }

  // --- 簡易ブルーム（明部だけを広げて足す）
  if(uFx > 0.35){
    vec3 bl = vec3(0.0);
    float r = 0.004 + 0.006*uHype;
    for(int i=0;i<6;i++){
      float a = float(i)*1.0472 + uTime*0.2;
      vec2 o = vec2(cos(a), sin(a))*r;
      vec3 s = texture(uTex, coverUv(uv+o)).rgb;
      bl += max(s - 0.74, 0.0);
    }
    col += bl * (0.16 + 0.26*uHype) * uFx;
  }

  // --- カラーグレード：HYPE で彩度とコントラストが上がる
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  float sat = 0.86 + 0.55*uHype;
  col = mix(vec3(lum), col, sat);
  col = (col - 0.5) * (1.0 + 0.16*uHype) + 0.5;
  col *= 0.86 + 0.26*uHype;
  // ハイライトをわずかにシアン／マゼンタへ寄せる
  col += vec3(-0.012, 0.004, 0.022) * (1.0-uHype) * 0.6;
  col += vec3(0.035, -0.008, 0.022) * uHype * lum;

  // --- スキャンライン・グレイン
  float scan = 0.985 + 0.015*sin(vUv.y*uRes.y*1.6 + uTime*8.0);
  col *= mix(1.0, scan, 0.5*uFx);
  float gr = hash(vUv*uRes + fract(uTime)*137.0);
  col += (gr-0.5) * (0.030 + 0.03*uTreble) * uFx;

  // --- ビネット
  float vig = smoothstep(1.05, 0.25, length(c*vec2(1.0,1.12)));
  col *= mix(1.0, vig, 0.55);

  // --- ノーツを読ませるための暗幕
  float lowA = smoothstep(uJudgeY-0.75, uJudgeY+0.10, sUv.y);          // 縦スクロール：下ほど濃い
  float lowB = exp(-pow((sUv.y-uJudgeY)/0.17, 2.0));                    // たいこ：帯だけ濃い
  col *= 1.0 - uDim*mix(0.35 + 0.75*lowA, 0.22 + 0.95*lowB, uBand);

  // --- 判定ラインの発光
  float jl = exp(-pow((sUv.y-uJudgeY)/0.045, 2.0));
  col += vec3(0.10,0.55,0.75) * jl * uGlow * (0.35+0.65*uHype);

  // --- 衝撃波の光
  col += vec3(0.45,0.85,1.0) * sh * 0.55 * uFx;

  // --- フラッシュ
  col = mix(col, vec3(1.0), clamp(uFlash,0.0,1.0)*0.85);

  outColor = vec4(col, 1.0);
}`;

const FRAG1 = FRAG
  .replace('#version 300 es\n', '')
  .replace('in vec2 vUv;', 'varying vec2 vUv;')
  .replace('out vec4 outColor;', '')
  .replace(/texture\(/g, 'texture2D(')
  .replace(/outColor/g, 'gl_FragColor');
const VERT1 = VERT
  .replace('#version 300 es\n', '')
  .replace('in vec2 aPos;', 'attribute vec2 aPos;')
  .replace('out vec2 vUv;', 'varying vec2 vUv;');

export class Gfx {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this._vseq = -1;
    this.gl = null;
    this.ok = false;
    this.hasVideo = true;
    this.shocks = [[0, 0, 9], [0, 0, 9], [0, 0, 9]];
    this.shockIdx = 0;
    this.p = { beat: 0, hype: .35, flash: 0, cut: 0, dim: .35, fx: 1, bass: 0, treble: 0, glow: .6, judgeY: .84, band: 0 };
  }

  init() {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
    let gl = this.canvas.getContext('webgl2', opts), v2 = true;
    if (!gl) { gl = this.canvas.getContext('webgl', opts); v2 = false; }
    if (!gl) return false;
    this.gl = gl; this.v2 = v2;

    const vs = compile(gl, gl.VERTEX_SHADER, v2 ? VERT : VERT1);
    const fs = compile(gl, gl.FRAGMENT_SHADER, v2 ? FRAG : FRAG1);
    if (!vs || !fs) return false;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      console.warn('[gfx] link failed', gl.getProgramInfoLog(pr));
      return false;
    }
    gl.useProgram(pr);
    this.prog = pr;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // 映像は上下が逆に入るので、取り込み時に反転させる
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 8, 14, 255]));

    this.u = {};
    for (const n of ['uTex', 'uRes', 'uVid', 'uTime', 'uBeat', 'uHype', 'uFlash', 'uCut', 'uDim', 'uFx',
      'uBass', 'uTreble', 'uGlow', 'uShock0', 'uShock1', 'uShock2', 'uJudgeY', 'uHasVideo', 'uBand']) {
      this.u[n] = gl.getUniformLocation(pr, n);
    }
    gl.uniform1i(this.u.uTex, 0);
    this.ok = true;
    return true;
  }

  resize(w, h, dpr) {
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.canvas.width === cw && this.canvas.height === ch) return;
    this.canvas.width = cw; this.canvas.height = ch;
    if (this.gl) this.gl.viewport(0, 0, cw, ch);
  }

  shock(x, y, strength = 1) {
    this.shocks[this.shockIdx] = [x, y, 0.001];
    this.shockIdx = (this.shockIdx + 1) % 3;
  }

  /** seq … 映像の新しいコマが来るたびに増える数。同じコマなら貼り直さない。
   *  （360Hz だと1コマを12回も GPU に送ることになり、それだけで帯域を食う） */
  render(t, dt, seq) {
    if (!this.ok) return;
    const gl = this.gl, u = this.u, p = this.p;
    for (const s of this.shocks) if (s[2] > 0 && s[2] < 1.4) s[2] += dt * 1.9;

    const vid = this.video;
    const live = this.hasVideo && vid && vid.readyState >= 2 && vid.videoWidth > 0;
    if (live) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      if (seq == null || seq !== this._vseq) {
        this._vseq = seq;
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid); } catch (e) { /* フレーム未到達 */ }
      }
      gl.uniform2f(u.uVid, vid.videoWidth, vid.videoHeight);
    } else {
      this._vseq = -1;
    }
    gl.uniform1f(u.uHasVideo, live ? 1 : 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uBeat, p.beat);
    gl.uniform1f(u.uHype, p.hype);
    gl.uniform1f(u.uFlash, p.flash);
    gl.uniform1f(u.uCut, p.cut);
    gl.uniform1f(u.uDim, p.dim);
    gl.uniform1f(u.uFx, p.fx);
    gl.uniform1f(u.uBass, p.bass);
    gl.uniform1f(u.uTreble, p.treble);
    gl.uniform1f(u.uGlow, p.glow);
    gl.uniform1f(u.uJudgeY, p.judgeY);
    gl.uniform1f(u.uBand, p.band || 0);
    gl.uniform3fv(u.uShock0, this.shocks[0]);
    gl.uniform3fv(u.uShock1, this.shocks[1]);
    gl.uniform3fv(u.uShock2, this.shocks[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[gfx] shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
