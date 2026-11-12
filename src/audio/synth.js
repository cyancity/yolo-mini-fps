// 合成基础件：噪声缓冲、失真曲线、混响脉冲，以及给音色函数用的 Builder。
// 所有东西只依赖 BaseAudioContext，所以同一套音色既能实时播放，也能用 OfflineAudioContext 离线渲染做测量。

export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// crackle 不是连续的噪声，是稀疏的随机脉冲（每秒约 400 个，大小差到五倍）：过带通就是一粒粒的
// 碎石、玻璃碴、雨点。放慢播放（rate 小于 1）脉冲变稀也变钝
const CRACKLE_RATE = 400;
function fillNoise(data, kind, sr) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') {
      data[i] = w;
    } else if (kind === 'crackle') {
      data[i] = Math.random() * sr < CRACKLE_RATE ? Math.sign(w) * (0.6 + 2.4 * Math.random()) : 0;
    } else if (kind === 'pink') {
      // Paul Kellet 的粉噪滤波器
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
}

// 首尾交叉淡化，循环播放时接缝处不出咔哒声
function makeNoise(ctx, seconds, kind) {
  const sr = ctx.sampleRate, fade = 4096;
  const raw = new Float32Array(Math.floor(seconds * sr) + fade);
  fillNoise(raw, kind, sr);
  const len = raw.length - fade;
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    out[i] = i < fade ? raw[i] * (i / fade) + raw[len + i] * (1 - i / fade) : raw[i];
  }
  return buf;
}

function tanhCurve(drive, n = 2048) {
  const c = new Float32Array(n), k = Math.tanh(drive);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / k;
  return c;
}

// 软限幅：0.5 以下线性，以上平滑压到 0.98 封顶。WaveShaper 只认 ±1 的输入，
// 所以曲线按 ±LIMIT_RANGE 的幅度来画，使用时前面垫一级 1 / LIMIT_RANGE 的增益
export const LIMIT_RANGE = 4;
function limiterCurve(n = 8192) {
  const c = new Float32Array(n), knee = 0.5, top = 0.98;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * LIMIT_RANGE, a = Math.abs(x);
    const y = a < knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

// 程序化混响：几下离散的早期反射（集装箱之间来回的拍击）+ 高频衰减更快的扩散尾巴。
// 室外堆场没有长混响，尾巴一秒多就没了，空间感主要靠前 200 ms 的拍击
function makeImpulse(ctx, seconds = 1.8) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const taps = [[0.021, 1], [0.038, 0.85], [0.057, 0.7], [0.083, 0.62], [0.118, 0.5], [0.154, 0.38], [0.207, 0.27], [0.262, 0.16]];
  const energy = (a) => a.reduce((e, v) => e + v * v, 0);
  for (let ch = 0; ch < 2; ch++) {
    const tail = new Float32Array(len), early = new Float32Array(len);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.22;
      lp2 += (lp - lp2) * 0.08;
      // 三个频段各自的衰减：高频最快，低频拖得最久
      tail[i] = Math.min(1, t / 0.04) * ((w - lp) * 0.3 * Math.exp(-t / 0.07) + (lp - lp2) * 0.75 * Math.exp(-t / 0.16) + lp2 * 1.1 * Math.exp(-t / 0.24));
    }
    taps.forEach(([time, amp], k) => {
      // 左右耳的到达时间和强弱错开，拍击才有宽度；越晚的反射走得越远，也越闷
      const at = Math.floor(time * (ch ? 1.06 : 1) * sr), side = k === 0 || (k + ch) % 2 ? 1 : 0.65, smooth = 0.75 - k * 0.07;
      let y = 0;
      for (let j = 0; j < 140; j++) {
        y += ((Math.random() * 2 - 1) - y) * smooth;
        early[at + j] += amp * side * y * Math.exp(-j / 30);
      }
    });
    // 两部分各自归一化到固定能量：换采样率或换随机数，响度和比例都不变
    const kt = Math.sqrt(0.55 / energy(tail)), ke = Math.sqrt(0.45 / energy(early));
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = tail[i] * kt + early[i] * ke;
  }
  return buf;
}

// 室内混响：比堆场的短得多、密得多。前 70 ms 是墙、顶和货架挤在一起的一串反射（间隔从 1 毫秒拉开到 3 毫秒多，
// 小房间里反射来得又早又密），尾巴半秒内收完，再垫几条房间驻波。枪声在屋里“闷在盒子里”的感觉主要来自这条脉冲
function makeRoomImpulse(ctx, seconds = 0.8) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const taps = []; // 毫秒
  for (let ms = 2.1; ms < 68; ms += 0.9 + ms * 0.045) taps.push(ms);
  // 驻波频率、衰减时间常数。放在 200~600 Hz：“盒子感”在这一段，再往下就成了发轰的低频，连发时糊成一片
  const modes = [[196, 0.09], [251, 0.085], [317, 0.075], [394, 0.065], [482, 0.055], [589, 0.045]];
  const energy = (a) => a.reduce((e, v) => e + v * v, 0);
  for (let ch = 0; ch < 2; ch++) {
    const tail = new Float32Array(len), early = new Float32Array(len), ring = new Float32Array(len);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.2;
      lp2 += (lp - lp2) * 0.05;
      tail[i] = Math.min(1, t / 0.006) * ((w - lp) * 0.25 * Math.exp(-t / 0.03) + (lp - lp2) * 0.9 * Math.exp(-t / 0.065) + lp2 * 0.8 * Math.exp(-t / 0.1));
    }
    taps.forEach((ms, k) => {
      // 正负交替、左右错开；越晚的反射越弱也越闷
      const at = Math.floor(ms * 0.001 * (ch ? 1.09 : 1) * sr), amp = Math.exp(-ms / 28) * ((k + ch) % 3 ? 1 : 0.6) * (k % 2 ? -1 : 1), smooth = 0.6 * Math.exp(-ms / 60);
      let y = 0;
      for (let j = 0; j < 70; j++) {
        y += ((Math.random() * 2 - 1) - y) * smooth;
        early[at + j] += amp * y * Math.exp(-j / 14);
      }
    });
    for (const [f, tau] of modes) {
      // 衰减的正弦用旋转的复数递推出来，不用每个采样都算一次 sin 和 exp
      const w = (2 * Math.PI * f) / sr, r = Math.exp(-1 / (tau * sr)), c = r * Math.cos(w), s = r * Math.sin(w), ph = Math.random() * 2 * Math.PI;
      let re = Math.cos(ph), im = Math.sin(ph);
      for (let i = 0; i < len; i++) {
        ring[i] += re * Math.min(1, i / (0.008 * sr));
        const t = re * c - im * s;
        im = re * s + im * c;
        re = t;
      }
    }
    const kt = Math.sqrt(0.36 / energy(tail)), ke = Math.sqrt(0.5 / energy(early)), kr = Math.sqrt(0.14 / energy(ring));
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = tail[i] * kt + early[i] * ke + ring[i] * kr;
  }
  return buf;
}

// 大厅混响（仓库：约 60 × 12 米、净高 8.8 米）：早期反射比小房间稀、来得晚，随后在两道长墙之间来回的颤动回声
// （间隔约 36 毫秒，一下比一下闷），尾巴两秒上下，低频拖得最久。和堆场的区别是尾巴不散、四面都在响
function makeHallImpulse(ctx, seconds = 2.2) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const taps = [[0.011, 0.9], [0.019, 0.7], [0.027, 0.75], [0.036, 0.6], [0.044, 0.55], [0.058, 0.5], [0.071, 0.42], [0.089, 0.35], [0.112, 0.28]];
  const energy = (a) => a.reduce((e, v) => e + v * v, 0);
  for (let ch = 0; ch < 2; ch++) {
    const tail = new Float32Array(len), early = new Float32Array(len), flutter = new Float32Array(len);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.2;
      lp2 += (lp - lp2) * 0.06;
      // 高、中、低三段的衰减时间常数约合 RT60 1.0 / 1.8 / 2.4 秒
      tail[i] = Math.min(1, t / 0.035) * ((w - lp) * 0.3 * Math.exp(-t / 0.145) + (lp - lp2) * 0.8 * Math.exp(-t / 0.26) + lp2 * 1.0 * Math.exp(-t / 0.35));
    }
    const spray = (arr, at, amp, smooth, width) => {
      let y = 0;
      for (let j = 0; j < width && at + j < len; j++) {
        y += ((Math.random() * 2 - 1) - y) * smooth;
        arr[at + j] += amp * y * Math.exp(-j / (width / 4));
      }
    };
    taps.forEach(([time, amp], k) => spray(early, Math.floor(time * (ch ? 1.07 : 1) * sr), amp * ((k + ch) % 2 ? 1 : -0.8), 0.7 - k * 0.05, 160));
    for (let k = 0; k < 12; k++) spray(flutter, Math.floor((0.05 + k * 0.036) * (ch ? 1.012 : 1) * sr), Math.exp(-k / 4) * (k % 2 ? 1 : -1), 0.35 * Math.exp(-k / 8), 240);
    const kt = Math.sqrt(0.6 / energy(tail)), ke = Math.sqrt(0.3 / energy(early)), kf = Math.sqrt(0.1 / energy(flutter));
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = tail[i] * kt + early[i] * ke + flutter[i] * kf;
  }
  return buf;
}

export function createResources(ctx) {
  return {
    white: makeNoise(ctx, 2, 'white'),
    pink: makeNoise(ctx, 2, 'pink'),
    brown: makeNoise(ctx, 4, 'brown'),
    crackle: makeNoise(ctx, 2, 'crackle'),
    curves: { soft: tanhCurve(1.6), hard: tanhCurve(5), limit: limiterCurve() },
    impulse: makeImpulse(ctx),
    room: makeRoomImpulse(ctx),
    hall: makeHallImpulse(ctx),
  };
}

// 音色函数拿到的搭建器：建节点、接线、排包络，并记下所有节点和结束时间，播完由引擎统一断开。
// 所有时间参数都相对本音起点（秒）。
export class Builder {
  constructor(ctx, res, dest, t0, opts = {}) {
    this.ctx = ctx;
    this.res = res;
    this.dest = dest;
    this.t = t0;
    this.o = opts;
    this.nodes = [];
    this.sources = [];
    this.end = t0;
  }

  reg(n) { this.nodes.push(n); return n; }

  // dur 传 Infinity 表示一直响（循环音和环境声），由引擎负责停
  startStop(src, at, dur, offset) {
    const t = this.t + at;
    if (offset === undefined) src.start(t); else src.start(t, offset);
    if (dur !== Infinity) {
      src.stop(t + dur);
      this.end = Math.max(this.end, t + dur);
    }
    this.sources.push(src);
    return src;
  }

  noise(kind = 'white', { at = 0, dur = 0.2, rate = 1 } = {}) {
    const buf = this.res[kind];
    const s = this.reg(this.ctx.createBufferSource());
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.loop = true;
    return this.startStop(s, at, dur, Math.random() * (buf.duration - 0.01));
  }

  osc(type, freq, { at = 0, dur = 0.2, detune = 0 } = {}) {
    const o = this.reg(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    return this.startStop(o, at, dur);
  }

  gain(v = 1) { const g = this.reg(this.ctx.createGain()); g.gain.value = v; return g; }

  // 注意：WebAudio 里 lowpass / highpass 的 Q 是以 dB 计的谐振峰，其他类型才是常规 Q 值
  filter(type, freq, q = 0.707, gainDb = 0) {
    const f = this.reg(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = Math.min(freq, this.ctx.sampleRate * 0.45);
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  shaper(name = 'soft') {
    const s = this.reg(this.ctx.createWaveShaper());
    s.curve = this.res.curves[name];
    return s;
  }

  delay(time) { const d = this.reg(this.ctx.createDelay(1)); d.delayTime.value = time; return d; }

  pan(v) { const p = this.reg(this.ctx.createStereoPanner()); p.pan.value = v; return p; }

  // 低频振荡器调制某个参数（叠加在参数本身的值上）；返回振荡器，方便之后改频率
  mod(param, freq, depth, { type = 'sine', at = 0, dur = 0.2 } = {}) {
    const o = this.osc(type, freq, { at, dur });
    this.chain(o, this.gain(depth)).connect(param);
    return o;
  }

  // 不规则的抖动：把白噪声放得极慢，当随机的低频振荡器用（每秒约 hz 个随机值，中间线性过渡），
  // 同样叠加在参数本身的值上。摩擦、喘气这类不该有固定节拍的起伏用它
  wobble(param, hz, depth, { at = 0, dur = 0.2 } = {}) {
    const n = this.noise('white', { at, dur, rate: hz / this.ctx.sampleRate });
    this.chain(n, this.gain(depth)).connect(param);
    return n;
  }

  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }

  // 接到本音的输出；level 不为 1 时多垫一级增益
  out(node, level = 1, panTo = 0) {
    let last = node;
    if (level !== 1) last = this.chain(last, this.gain(level));
    if (panTo) last = this.chain(last, this.pan(panTo));
    last.connect(this.dest);
    return node;
  }

  // 折线包络；exp 时用指数斜坡（适合频率和响度）
  env(param, points, exp = false) {
    const lim = this.ctx.sampleRate * 0.45;
    const val = (v) => (exp ? Math.max(Math.min(v, lim), 1e-4) : v);
    param.setValueAtTime(val(points[0][1]), this.t + points[0][0]);
    for (let i = 1; i < points.length; i++) {
      const t = this.t + points[i][0], v = val(points[i][1]);
      if (exp) param.exponentialRampToValueAtTime(v, t); else param.linearRampToValueAtTime(v, t);
    }
  }

  // 打击包络：极短起音后按时间常数 tau 指数衰减
  perc(param, peak, tau, at = 0, attack = 0.001) {
    const t = this.t + at;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(0, t + attack, tau);
  }

  // 噪声脉冲：噪声 → 滤波（可扫频）→ 打击包络。返回包络增益节点；to 为 null 时不自动接输出
  burst(kind, { type = 'bandpass', freq = 1000, freqTo, sweep = 0.05, q = 1, peak = 1, tau = 0.03, at = 0, attack = 0.001, rate = 1, panTo = 0, to } = {}) {
    const dur = attack + tau * 7;
    const n = this.noise(kind, { at, dur, rate });
    const f = this.filter(type, freq, q);
    if (freqTo) this.env(f.frequency, [[at, freq], [at + sweep, freqTo]], true);
    const g = this.gain(0);
    this.perc(g.gain, peak, tau, at, attack);
    this.chain(n, f, g);
    if (to === undefined) this.out(g, 1, panTo); else if (to) g.connect(to);
    return g;
  }

  // 衰减分音：正弦（或其他波形）+ 打击包络，可带滑音。金属声靠一组不成倍数的分音堆出来
  ping(freq, { peak = 0.3, tau = 0.1, at = 0, attack = 0.001, type = 'sine', freqTo, sweep = 0.05, detune = 0, panTo = 0, to } = {}) {
    const dur = attack + tau * 7;
    const o = this.osc(type, freq, { at, dur, detune });
    if (freqTo) this.env(o.frequency, [[at, freq], [at + sweep, freqTo]], true);
    const g = this.gain(0);
    this.perc(g.gain, peak, tau, at, attack);
    o.connect(g);
    if (to === undefined) this.out(g, 1, panTo); else if (to) g.connect(to);
    return g;
  }

  // 一组不成倍数的分音（比值 × 基频），衰减时间随频率升高而变短
  partials(base, ratios, { peak = 0.2, tau = 0.12, at = 0, spread = 0.02, panTo = 0, to } = {}) {
    ratios.forEach((r, i) => {
      this.ping(base * r * (1 + rnd(-spread, spread)), {
        peak: (peak / (1 + i * 0.55)) * rnd(0.7, 1.15), tau: (tau / (1 + i * 0.35)) * rnd(0.8, 1.2), at, panTo, to,
      });
    });
  }
}
