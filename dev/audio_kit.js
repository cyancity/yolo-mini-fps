// 切枪、喷气、烟雾弹、钢靶和击杀确认的测量：在混音里能不能听出来
import { AudioEngine, renderOffline } from '../src/audio/audio.js';
import { bake } from '../src/audio/bake.js';
import { SOUNDS } from '../src/audio/table.js';
import { engine, flick, LONG } from './audio_common.js';
import { analyze, aWeight, fft, stereo, r3, BAND_HZ } from './audio_dsp.js';

// ---------- 切枪、喷气、烟雾弹、钢靶和击杀确认（2026-11-12 新加） ----------
export const KIT = ['weaponSwitch', 'dash', 'smokeThrow', 'smokeBounce', 'smokeBurst', 'targetHit', 'targetDown', 'killConfirm', 'killHeadshot'];


// 改版前的击杀确认，对照用
function oldKillConfirm(b, o) {
  const p = o.pitch;
  b.ping(190 * p, { peak: 0.45, tau: 0.04, freqTo: 110 * p, sweep: 0.05 });
  b.burst('white', { type: 'highpass', freq: 4000, peak: 0.25, tau: 0.003 });
  b.ping(1568 * p, { peak: 0.28, tau: 0.05, type: 'triangle' });
  b.ping(2349 * p, { peak: 0.26, tau: 0.09, type: 'triangle', at: 0.06 });
  b.ping(4698 * p, { peak: 0.05, tau: 0.06, at: 0.06 });
}
SOUNDS.killConfirmOld = { ...SOUNDS.killConfirm, fn: oldKillConfirm, gain: 0.32, n: 0 };

// 测量用的音色库：试听页启用过音频就用它烤好的那份，否则自己离线烤一份（不用点“启用音频”）
let testBankP = null;
function testBank() {
  if (engine.ctx) return engine.baked.then(() => engine.bank);
  if (!testBankP) {
    const e = new AudioEngine();
    e.attach(new OfflineAudioContext(2, 4800, 48000), { offline: true, ambient: false });
    testBankP = bake(e).then(() => e.bank);
  }
  return testBankP;
}

// 固定种子的随机数：同一段混音渲染两遍，除了多放的那个音以外逐采样一样，相减就是那个音在混音里实际出来的样子
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
async function seeded(seed, run) {
  const real = Math.random;
  for (const d of Object.values(SOUNDS)) d.last = undefined; // 引擎记着上一次放的是哪份变体，也得清掉
  Math.random = mulberry(seed);
  try { return await run(); } finally { Math.random = real; }
}

function subtract(x, y) {
  const out = new AudioBuffer({ numberOfChannels: 2, length: x.length, sampleRate: x.sampleRate });
  for (let c = 0; c < 2; c++) {
    const a = x.getChannelData(c), b = y.getChannelData(c), d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = a[i] - b[i];
  }
  return out;
}

const peakOf = (buf) => {
  let p = 0;
  for (const d of stereo(buf)) for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};

// [from, to) 秒这一段的倍频程能量（左右声道功率相加）、总能量和 A 计权能量
function segment(buf, from, to) {
  const sr = buf.sampleRate, a = Math.floor(from * sr), n = Math.min(buf.length, Math.floor(to * sr)) - a;
  let N = 1;
  while (N < n) N <<= 1;
  const p = new Float64Array(N / 2);
  for (const d of stereo(buf)) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < n; i++) re[i] = d[a + i];
    fft(re, im);
    for (let k = 1; k < N / 2; k++) p[k] += re[k] * re[k] + im[k] * im[k];
  }
  const band = BAND_HZ.map(() => 0), third = THIRD_HZ.map(() => 0), edge = 2 ** (1 / 6);
  let total = 0, weighted = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    total += p[k];
    weighted += p[k] * aWeight(f);
    BAND_HZ.forEach((fc, i) => { if (f >= fc / Math.SQRT2 && f < fc * Math.SQRT2) band[i] += p[k]; });
    THIRD_HZ.forEach((fc, i) => { if (f >= fc / edge && f < fc * edge) third[i] += p[k]; });
  }
  return { band, third, total, weighted, n, N };
}
// 三分之一倍频程：500 Hz 以上和人耳的临界频带差不多宽，一个音在某一段里压过底下的混音，那一段就听得出它
const THIRD_HZ = Array.from({ length: 21 }, (_, i) => Math.round(100 * 2 ** (i / 3)));
const db = (x, y) => +(10 * Math.log10((x + 1e-20) / (y + 1e-20))).toFixed(1);

// 时频格子里的“空隙”：把 [from, to) 切成 20 ms 一帧（5 ms 一跳）、每帧按三分之一倍频程分格，
// 数这个音比底下的混音高出 3 dB 以上的格子（Cooke 的 glimpse 模型：耳朵靠这些格子在噪声里认出一个声音）。
// 连发的枪声是一下一下的，平均下来压得住，但两发之间的空当里这个音能不能露出来，看的是这个
function glimpses(sig, bed, from, to) {
  const sr = sig.sampleRate, N = 1024, len = Math.round(0.02 * sr), hop = Math.round(0.005 * sr), edge = 2 ** (1 / 6);
  const cell = (buf, a) => {
    const out = THIRD_HZ.map(() => 0);
    for (const d of stereo(buf)) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < len; i++) re[i] = d[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const f = (k * sr) / N, e = re[k] * re[k] + im[k] * im[k];
        THIRD_HZ.forEach((fc, i) => { if (f >= fc / edge && f < fc * edge) out[i] += e; });
      }
    }
    return out;
  };
  let count = 0, total = 0, best = { snr: -Infinity };
  for (let a = Math.floor(from * sr); a + len <= Math.floor(to * sr); a += hop) {
    const s = cell(sig, a), b = cell(bed, a);
    s.forEach((e, i) => {
      if (THIRD_HZ[i] < 500) return; // 500 Hz 以下的三分之一倍频程比临界频带窄得多，算出来偏乐观，不计
      total++;
      const snr = db(e, b[i]);
      if (snr > 3) count++;
      if (snr > best.snr) best = { snr, ms: Math.round((a / sr - from) * 1000), hz: THIRD_HZ[i] };
    });
  }
  return { 高出3dB的格子: count, 格子总数: total, 最好的格子: `${best.ms} ms 处 ${best.hz} Hz 高出 ${best.snr} dB` };
}

// 一个音放进一段混音里能不能听出来：base 是底下的混音，extra 只放这个音。同一个种子各渲染一遍，
// 相减得到它过完总线（连同它让压缩器多压掉的那部分）以后的实际贡献，再在 [at, at + win] 秒里和底下的混音逐个倍频程比
export async function contribution(base, extra, at, { win = 0.2, seconds = 3, ambient = false, seed = 7, lead = 0.5 } = {}) {
  const bank = await testBank();
  const render = (more) => seeded(seed, () => renderOffline((a) => { base(a); if (more) extra(a); }, { seconds, bank, ambient, lead }));
  const mix = await render(true), bed = await render(false), again = await render(false);
  const sig = subtract(mix, bed), from = lead + at, S = segment(sig, from, from + win), B = segment(bed, from, from + win);
  const diff = S.band.map((e, i) => db(e, B.band[i])), td = S.third.map((e, i) => db(e, B.third[i]));
  const best = diff.indexOf(Math.max(...diff)), tb = td.indexOf(Math.max(...td));
  return {
    时频空隙: glimpses(sig, bed, from, from + win),
    三分之一倍频程里最好的一段: `${THIRD_HZ[tb]} Hz 高出 ${td[tb]} dB`,
    三分之一倍频程高出0dB的段数: td.filter((v) => v > 0).length,
    同种子重渲两遍之差峰值: +peakOf(subtract(bed, again)).toExponential(1), // 不是 0 说明随机数没固定住，下面的数不可信
    混音峰值: r3(peakOf(mix)),
    这个音的峰值: r3(peakOf(sig)),
    倍频程Hz: BAND_HZ, 这个音dB: S.band.map((e) => db(e, 1)), 底下混音dB: B.band.map((e) => db(e, 1)), 差dB: diff,
    最好的一段: `${BAND_HZ[best]} Hz 高出 ${diff[best]} dB`, 总能量差dB: db(S.total, B.total), A计权差dB: db(S.weighted, B.weighted),
  };
}

// 新音逐个离线渲染 n 遍（量的是预渲染好的变体，smokeBurst 现合成）：总线前是校准配平的口径，过总线是实际出来的样子。
// 时长按 -60 dBFS 算，含混响尾巴
export async function kitReport(n = 4) {
  const bank = await testBank(), out = {};
  for (const name of KIT) {
    const row = {};
    for (const raw of [true, false]) {
      const sum = { peak: 0, rms: 0, loud: 0, loudA: 0, dur: 0, centroid: 0 };
      for (let i = 0; i < n; i++) {
        const r = analyze(await renderOffline((a) => a.play(name), { seconds: LONG[name] || 2.5, raw, bank }));
        for (const k in sum) sum[k] = k === 'peak' ? Math.max(sum[k], r[k]) : sum[k] + r[k] / n;
      }
      row[raw ? '总线前' : '过总线'] = { 峰值: r3(sum.peak), RMS: +sum.rms.toFixed(4), 最响50ms: r3(sum.loud), A计权: r3(sum.loudA), 时长s: +sum.dur.toFixed(2), 重心Hz: Math.round(sum.centroid) };
    }
    out[name] = row;
  }
  return out;
}

// 一段的 RMS：segment 的能量是 FFT 域的，按帕塞瓦尔定理除以 N 和采样数换回时域
const segRms = (buf, from, to) => {
  const s = segment(buf, from, to);
  return Math.sqrt((s.total * 2) / (s.N * s.n * 2));
};

// 一秒 12 下切枪连按两秒：过总线的峰值（软限幅 0.5 以下是线性区）、每 250 ms 的 RMS 走势，
// 以及把同时最多几路和互相压尾巴都去掉以后的对照
export async function switchSpam(rate = 12, seconds = 2) {
  const bank = await testBank(), lead = 0.5;
  const run = async () => {
    const buf = await renderOffline((a) => flick(a, rate, seconds), { seconds: seconds + 1, bank, lead });
    const raw = await renderOffline((a) => flick(a, rate, seconds), { seconds: seconds + 1, bank, lead, raw: true });
    const steps = [];
    for (let t = 0; t < seconds - 1e-6; t += 0.25) steps.push(+segRms(buf, lead + t, lead + t + 0.25).toFixed(4));
    return { 过总线峰值: r3(peakOf(buf)), 总线前峰值: r3(peakOf(raw)), 每250msRMS: steps, 后一秒比前一秒dB: db(segRms(buf, lead + 1, lead + 2) ** 2, segRms(buf, lead, lead + 1) ** 2) };
  };
  const one = await renderOffline((a) => a.play('weaponSwitch', { volume: 0.55 }), { seconds: 1, bank, lead });
  const d = SOUNDS.weaponSwitch, keep = { choke: d.choke, max: d.max };
  const limited = await run();
  delete d.choke;
  d.max = 8;
  const free = await run().finally(() => Object.assign(d, keep));
  return { 单下: { 峰值: r3(peakOf(one)), 最响50ms: r3(analyze(one).loud) }, 限路数: limited, 不限路数对照: free };
}

// 击杀确认压不压得住连发：自己全自动 12 发，第 7 发打死人，同一刻响命中提示和击杀确认（音量照 rifle.js 和 game.js）。
// 底下的混音含枪声和命中提示，比的是击杀确认之后 200 ms 里多出来的那部分
export async function killOverBurst() {
  const out = {}, at = 6 * 0.092;
  const base = (marker) => (a) => {
    for (let i = 0; i < 12; i++) a.play('rifleShot', { delay: i * 0.092, volume: 0.9 });
    a.play(marker, { delay: at, volume: 0.5 });
  };
  for (const [name, marker] of [['killConfirm', 'hitmarker'], ['killHeadshot', 'headshot'], ['killConfirmOld', 'hitmarker']]) {
    out[name] = await contribution(base(marker), (a) => a.play(name, { delay: at, volume: 0.8 }), at, { seconds: 2.5 });
  }
  return out;
}

// 50 米外的钢靶：雨声环境底开着，自己开一枪，同一帧命中（判定是瞬时的），靶声按表里的 sonic 晚 dist / 343 秒传到；
// 再给去掉 sonic、和枪声同一刻响的对照，以及只有雨声时的对比
export async function targetFar(dist = 50) {
  const pos = { x: 0, y: 1.2, z: -dist }, late = dist / 343, d = SOUNDS.targetHit, keep = d.sonic;
  const shot = (a) => a.play('rifleShot', { volume: 0.9 });
  const ding = (a) => a.play('targetHit', { position: pos });
  const out = {
    压在枪声和雨声上: await contribution(shot, ding, late, { win: 0.4, ambient: true }),
    只有雨声: await contribution(() => {}, ding, late, { win: 0.4, ambient: true }),
  };
  d.sonic = false;
  out.对照_不按声速和枪声同一刻 = await contribution(shot, ding, 0, { win: 0.4, ambient: true }).finally(() => { d.sonic = keep; });
  return out;
}
