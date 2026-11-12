// 离线测量的信号分析：峰值、响度、频谱、衰减、回声密度、曲率。只看缓冲，不碰引擎
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export const stereo = (buf) => [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
export const r3 = (v) => +v.toFixed(3);

// 峰值、有声段的 RMS 和时长（-60 dBFS 为界）、最响 50 ms 的 RMS、频谱重心和低/中/高三段的能量占比
export function analyze(buf) {
  const sr = buf.sampleRate, [L, R] = stereo(buf), n = L.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const hop = Math.round(sr * 0.005), frames = Math.floor(n / hop), env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += L[i] * L[i] + R[i] * R[i];
    env[f] = Math.sqrt(e / (2 * hop));
  }
  let a = 0, b = frames - 1;
  while (a < frames && env[a] < 0.001) a++;
  while (b > a && env[b] < 0.001) b--;
  if (a >= frames) return { peak, rms: 0, loud: 0, loudA: 0, dur: 0, centroid: 0, low: 0, mid: 0, high: 0, env };
  let e = 0, loud = 0;
  for (let f = a; f <= b; f++) {
    e += env[f] * env[f];
    let s = 0;
    for (let k = f; k < Math.min(f + 10, frames); k++) s += env[k] * env[k];
    loud = Math.max(loud, Math.sqrt(s / 10));
  }
  const N = 2048, spec = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  for (let s = a * hop; s < (b + 1) * hop; s += N / 2) {
    for (let i = 0; i < N; i++) {
      const x = s + i < n ? (L[s + i] + R[s + i]) * 0.5 : 0;
      re[i] = x * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  let total = 0, moment = 0, low = 0, mid = 0, weighted = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    total += spec[k];
    moment += spec[k] * f;
    weighted += spec[k] * aWeight(f);
    if (f < 250) low += spec[k]; else if (f < 2500) mid += spec[k];
  }
  return {
    peak, rms: Math.sqrt(e / (b - a + 1)), loud, loudA: loud * Math.sqrt(weighted / total), dur: (b - a + 1) * 0.005, centroid: moment / total,
    low: low / total, mid: mid / total, high: 1 - (low + mid) / total, env,
  };
}

// A 计权（功率比）。RMS 不分频率，低频为主的音量出来偏大；比较不同材质谁更响时看 loudA，它按人耳的灵敏度打了折
export function aWeight(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * ra * 1.585;
}

// 倍频程各段的电平（dB，按 from 秒到结尾这一整段的均方算）
export const BAND_HZ = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export function bands(buf, from = 0) {
  const sr = buf.sampleRate, [L, R] = stereo(buf), N = 4096;
  const spec = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = Math.floor(from * sr); s + N <= L.length; s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = (L[s + i] + R[s + i]) * 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  return BAND_HZ.map((fc) => {
    let e = 0;
    for (let k = Math.max(1, Math.ceil(((fc / Math.SQRT2) * N) / sr)); k < Math.min(N / 2, Math.ceil((fc * Math.SQRT2 * N) / sr)); k++) e += spec[k];
    return +(10 * Math.log10((2 * e) / (frames * N * N * 0.375) + 1e-14)).toFixed(1); // 0.375 是汉宁窗的功率增益
  });
}

// 声音的起点：from 秒之后第一个超过峰值 5% 的采样
export function onset(buf, from) {
  const [L, R] = stereo(buf);
  let a = Math.floor(from * buf.sampleRate), peak = 0;
  for (let i = a; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  while (a < L.length && Math.max(Math.abs(L[a]), Math.abs(R[a])) < peak * 0.05) a++;
  return a;
}

// 衰减得多快：从起点往后把能量反向积分（Schroeder 曲线），量它掉 10 / 20 / 30 dB 各用多少毫秒，以及前 80 毫秒占全部能量的比例
export function decay(buf, from = 0) {
  const sr = buf.sampleRate, [L, R] = stereo(buf), a = onset(buf, from), n = L.length - a;
  const edc = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) edc[i] = edc[i + 1] + L[a + i] * L[a + i] + R[a + i] * R[a + i];
  const at = (db) => {
    const lim = edc[0] * 10 ** (-db / 10);
    let i = 0;
    while (i < n && edc[i] > lim) i++;
    return Math.round((i / sr) * 1000);
  };
  return { 掉10dB毫秒: at(10), 掉20dB毫秒: at(20), 掉30dB毫秒: at(30), 前80毫秒能量占比: r3(1 - edc[Math.min(n, Math.round(0.08 * sr))] / edc[0]) };
}

// 反射有多密：起点之后的 100 毫秒切成 1 毫秒一格，能量在最响那格的 -20 dB 以内的格子占多少
export function fill(buf, from = 0) {
  const sr = buf.sampleRate, [L, R] = stereo(buf), a = onset(buf, from), win = Math.round(sr * 0.001), e = [];
  for (let w = 0; w < 100; w++) {
    let s = 0;
    for (let i = a + w * win; i < a + (w + 1) * win && i < L.length; i++) s += L[i] * L[i] + R[i] * R[i];
    e.push(s);
  }
  const max = Math.max(...e);
  return e.filter((v) => v > max * 0.01).length / 100;
}

// 回声密度（Abel 和 Huang 的归一化回声密度）：起点后 to 毫秒以内，每个 10 毫秒窗里落在一个标准差以外的采样占比，
// 除以高斯噪声的理论值 0.3173 再取平均。接近 1 是一片连续的漫反射，越小越像一下一下分开的拍击
export function echoDensity(buf, from = 0, to = 80) {
  const sr = buf.sampleRate, [L] = stereo(buf), a = onset(buf, from), win = Math.round(sr * 0.01), out = [];
  for (let s = a; s + win <= Math.min(L.length, a + (to / 1000) * sr); s += win) {
    let e = 0, over = 0;
    for (let i = s; i < s + win; i++) e += L[i] * L[i];
    const sd = Math.sqrt(e / win);
    for (let i = s; i < s + win; i++) if (Math.abs(L[i]) > sd) over++;
    out.push(over / win / 0.3173);
  }
  return r3(out.reduce((x, y) => x + y, 0) / out.length);
}

// 二阶差分的最大值，除以同幅度同频率的正弦本身的曲率（A·ω²）。信号里有跳变时这个比值会远大于 1
export function curvature(buf, hz, from = 0) {
  const sr = buf.sampleRate, w = (2 * Math.PI * hz) / sr;
  let worst = 0, peak = 0, at = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = Math.floor(from * sr) + 2; i < d.length; i++) {
      const dd = Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]);
      peak = Math.max(peak, Math.abs(d[i]));
      if (dd > worst) { worst = dd; at = i; }
    }
  }
  return { 峰值: r3(peak), 最大二阶差分: +worst.toExponential(2), 正弦自身曲率: +(peak * w * w).toExponential(2), 比值: r3(worst / (peak * w * w)), 出现在秒: r3(at / sr) };
}
