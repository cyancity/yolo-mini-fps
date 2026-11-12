// 武器音色：步枪、换弹机械声、弹壳、爪刀。每个函数拿到一个 Builder，往里搭节点。
import { rnd } from './synth.js';

// 金属咔哒：窄带噪声定“材质”，高通噪声给锐度，几个不成倍数的分音给余响，可选低频给分量
export function clack(b, at, { f = 2200, peak = 0.3, tau = 0.012, ring = 0.05, thud = 0 } = {}) {
  b.burst('white', { freq: f * rnd(0.92, 1.08), q: 4, peak: peak * 2.2, tau, at });
  b.burst('white', { type: 'highpass', freq: 5000, q: 0.7, peak: peak * 0.5, tau: tau * 0.4, at });
  if (ring) b.partials(f * 1.37, [1, 1.62, 2.41], { peak: ring, tau: tau * 2.5, at });
  if (thud) b.ping(260 * rnd(0.9, 1.1), { peak: thud, tau: 0.022, at, freqTo: 170, sweep: 0.03 });
}

// 步枪单发。七层：高频爆裂、中频膛口冲击、枪身、低频闷响、枪机往复、集装箱拍击回声、左右不相关的远场尾巴
export function rifleShot(b, o) {
  const p = o.pitch * rnd(0.95, 1.05);
  const tap = b.gain(1); // 爆裂、冲击和枪身先汇到这里，再分几路延时当回声

  b.burst('white', { type: 'highpass', freq: 2200 * p, q: 0.6, peak: 2 * rnd(0.9, 1.1), tau: 0.006, attack: 0.0004, to: tap });
  b.burst('white', { freq: 3800 * p, q: 1.2, peak: 2.6, tau: 0.018, to: tap });
  b.burst('pink', { freq: 950 * p, q: 0.8, peak: 7.5 * rnd(0.9, 1.1), tau: 0.03, to: tap });

  const n = b.noise('pink', { dur: 0.4 });
  const lp = b.filter('lowpass', 6500 * p, 0.8);
  b.env(lp.frequency, [[0, 6500 * p], [0.04, 2200 * p], [0.2, 520 * p]], true);
  const body = b.gain(0);
  b.perc(body.gain, 1.0 * rnd(0.9, 1.1), 0.045, 0, 0.0008);
  b.chain(n, b.gain(5), b.shaper('hard'), lp, b.filter('highpass', 220, 0.7), body, tap);

  const sub = b.osc('sine', 175 * p, { dur: 0.36 });
  b.env(sub.frequency, [[0, 175 * p], [0.035, 92 * p], [0.16, 46 * p]], true);
  const subG = b.gain(0);
  b.perc(subG.gain, 0.85, 0.045, 0, 0.0015);
  b.out(b.chain(sub, subG, b.shaper('soft')), 0.9);
  b.burst('brown', { type: 'lowpass', freq: 240, q: 0.8, peak: 0.4, tau: 0.04 });

  clack(b, 0.021 * rnd(0.9, 1.1), { f: 2500 * p, peak: 0.16, tau: 0.007, ring: 0.03 });
  clack(b, 0.056 * rnd(0.9, 1.1), { f: 1900 * p, peak: 0.2, tau: 0.009, ring: 0.035, thud: 0.06 });

  b.out(tap);
  for (const [time, level, cut, side] of [[0.071, 0.3, 2600, -0.55], [0.148, 0.19, 1900, 0.6], [0.236, 0.11, 1300, -0.25]]) {
    b.out(b.chain(tap, b.delay(time * rnd(0.9, 1.12)), b.filter('lowpass', cut, 0.7)), level, side);
  }

  for (const side of [-0.75, 0.75]) {
    const tn = b.noise('pink', { at: 0.01, dur: 1.5 });
    const tl = b.filter('lowpass', 4500, 0.7);
    b.env(tl.frequency, [[0.01, 4500], [0.45, 1400], [1.5, 420]], true);
    const tg = b.gain(0);
    b.env(tg.gain, [[0.01, 0.0001], [0.03, 2], [0.14, 1], [0.55, 0.25], [1.5, 0.001]], true);
    b.out(b.chain(tn, b.filter('bandpass', 1100 * rnd(0.85, 1.15), 0.45), b.filter('highpass', 200, 0.7), tl, tg), 1, side);
  }
}

export function rifleDry(b, o) {
  clack(b, 0, { f: 3100 * o.pitch, peak: 0.5, tau: 0.004, ring: 0.06 });
  b.ping(1250 * o.pitch * rnd(0.95, 1.05), { peak: 0.12, tau: 0.02 });
}

export function magOut(b, o) {
  const p = o.pitch;
  clack(b, 0, { f: 2700 * p, peak: 0.35, tau: 0.006, ring: 0.04 });
  // 聚合物弹匣滑出弹匣井，末尾空腔“咚”一下
  b.burst('pink', { freq: 1900 * p, freqTo: 800 * p, sweep: 0.12, q: 1.4, peak: 0.7, tau: 0.045, at: 0.02, attack: 0.03 });
  b.ping(300 * p * rnd(0.9, 1.1), { peak: 0.2, tau: 0.03, at: 0.11, freqTo: 180 * p, sweep: 0.05 });
  b.burst('white', { freq: 1300 * p, q: 3, peak: 0.4, tau: 0.01, at: 0.11 });
}

export function magIn(b, o) {
  const p = o.pitch;
  b.burst('pink', { freq: 900 * p, freqTo: 2100 * p, sweep: 0.1, q: 1.4, peak: 0.65, tau: 0.04, attack: 0.04 });
  clack(b, 0.12, { f: 1500 * p, peak: 0.5, tau: 0.012, ring: 0.07, thud: 0.2 });
  clack(b, 0.165, { f: 2900 * p, peak: 0.22, tau: 0.006, ring: 0.03 });
}

// 拉机柄：拉到底一下，松手后复进簧把枪机推回闭锁
export function boltRack(b, o) {
  const p = o.pitch;
  b.burst('white', { freq: 2400 * p, freqTo: 1500 * p, sweep: 0.1, q: 2.2, peak: 0.6, tau: 0.04, attack: 0.03 });
  clack(b, 0.11, { f: 1700 * p, peak: 0.42, tau: 0.012, ring: 0.06, thud: 0.12 });
  b.burst('white', { type: 'highpass', freq: 4200, q: 0.8, peak: 0.16, tau: 0.02, at: 0.2, attack: 0.012 });
  b.ping(520 * p, { peak: 0.07, tau: 0.05, at: 0.2, freqTo: 780 * p, sweep: 0.05, type: 'triangle' });
  clack(b, 0.255, { f: 1250 * p, peak: 0.6, tau: 0.016, ring: 0.09, thud: 0.22 });
  clack(b, 0.262, { f: 3300 * p, peak: 0.25, tau: 0.008, ring: 0.03 });
}

export function boltRelease(b, o) {
  const p = o.pitch;
  clack(b, 0, { f: 3000 * p, peak: 0.25, tau: 0.005, ring: 0.02 });
  b.burst('white', { type: 'highpass', freq: 4200, q: 0.8, peak: 0.14, tau: 0.016, at: 0.01, attack: 0.008 });
  clack(b, 0.045, { f: 1250 * p, peak: 0.6, tau: 0.016, ring: 0.09, thud: 0.22 });
}

export function selector(b, o) {
  clack(b, 0, { f: 3600 * o.pitch, peak: 0.3, tau: 0.004, ring: 0.03 });
  clack(b, 0.035, { f: 2800 * o.pitch, peak: 0.22, tau: 0.004, ring: 0.02 });
}

// 黄铜弹壳落地：一小段薄壁管的不成倍数模态，弹跳几次，间隔越来越短
export function shell(b, o) {
  const base = 2900 * o.pitch * rnd(0.82, 1.2);
  const ratios = [1, 1.47, 2.09, 2.83, 3.41];
  const bounces = 3 + ((Math.random() * 2) | 0);
  let t = 0, level = 1;
  for (let i = 0; i < bounces; i++) {
    // 每次落地姿态不同，激发的模态略有偏移
    const f = base * (i % 2 ? rnd(1.04, 1.12) : 1);
    const side = rnd(-0.3, 0.3);
    b.partials(f, ratios, { peak: 0.2 * level, tau: 0.045 * rnd(0.8, 1.3), at: t, spread: 0.01, panTo: side });
    b.burst('white', { type: 'highpass', freq: 6000, peak: 0.12 * level, tau: 0.002, at: t, panTo: side }); // 湿地面的水声是单独的 splashShell
    t += rnd(0.07, 0.12) * Math.pow(0.62, i) + 0.02;
    level *= rnd(0.45, 0.6);
  }
  b.burst('white', { freq: base * 1.47, q: 9, peak: 0.08, tau: 0.05, at: t, attack: 0.02 }); // 最后滚了一小段
}

// 出鞘：刃口擦过鞘口的上扫摩擦声，随后刀身余振（成对失谐的高分音互相拍频）
export function knifeDraw(b, o) {
  const p = o.pitch * rnd(0.96, 1.05);
  const n = b.noise('white', { dur: 0.3 });
  const bp = b.filter('bandpass', 2800 * p, 7);
  b.env(bp.frequency, [[0, 2800 * p], [0.16, 7200 * p], [0.3, 8200 * p]], true);
  const g = b.gain(0);
  b.env(g.gain, [[0, 0], [0.025, 1.6], [0.12, 2.6], [0.17, 1.1], [0.3, 0]]);
  b.out(b.chain(n, bp, b.filter('highpass', 1800, 0.7), g));
  for (const [f, pk, tau] of [[4100, 0.09, 0.22], [6350, 0.07, 0.17], [8900, 0.045, 0.12], [11800, 0.02, 0.08]]) {
    for (const det of [-9, 11]) b.ping(f * p, { peak: pk, tau, at: 0.13, attack: 0.02, detune: det, panTo: det < 0 ? -0.3 : 0.3 });
  }
}

export function knifeSwing(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  const n = b.noise('pink', { dur: 0.3 });
  const f = b.filter('bandpass', 480 * p, 1.6);
  b.env(f.frequency, [[0, 480 * p], [0.09, 1900 * p], [0.26, 650 * p]], true);
  const g = b.gain(0);
  b.env(g.gain, [[0, 0], [0.07, 1.8], [0.13, 1.1], [0.28, 0]]);
  b.out(b.chain(n, f, g));
  // 刀尖划破空气的高频“嘶”
  const n2 = b.noise('white', { at: 0.03, dur: 0.24 });
  const f2 = b.filter('bandpass', 3000 * p, 2.5);
  b.env(f2.frequency, [[0.03, 3000 * p], [0.1, 6200 * p], [0.22, 3600 * p]], true);
  const g2 = b.gain(0);
  b.env(g2.gain, [[0.03, 0], [0.09, 0.5], [0.25, 0]]);
  b.out(b.chain(n2, f2, g2));
}

export function knifeHitMetal(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.6, tau: 0.004 });
  b.partials(1350 * p, [1, 2.17, 3.26, 5.04, 6.71], { peak: 0.3, tau: 0.16, spread: 0.03 });
  b.ping(210 * p, { peak: 0.25, tau: 0.08, freqTo: 150 * p }); // 被敲的钢板自己的低频
  b.burst('white', { freq: 5200 * p, freqTo: 3000 * p, sweep: 0.08, q: 5, peak: 0.5, tau: 0.03, at: 0.01, attack: 0.01 });
}

export function knifeHitSoft(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  b.burst('brown', { type: 'lowpass', freq: 500 * p, peak: 0.7, tau: 0.035 });
  b.ping(130 * p, { peak: 0.3, tau: 0.04, freqTo: 80 * p, sweep: 0.06 });
  b.burst('pink', { freq: 1600 * p, q: 1, peak: 2.2, tau: 0.02 });
  b.burst('white', { freq: 3000 * p, q: 1.2, peak: 0.5, tau: 0.025, at: 0.008, attack: 0.01 }); // 刃口划开织物
}

// 检视转刀：指环绕食指转，气流声周期性起伏，中段最快
export function knifeSpin(b, o) {
  const p = o.pitch;
  const n = b.noise('pink', { dur: 0.6 });
  const am = b.gain(0.5);
  const lfo = b.osc('sine', 9, { dur: 0.6 });
  b.env(lfo.frequency, [[0, 9], [0.35, 17], [0.6, 12]]);
  b.chain(lfo, b.gain(0.5)).connect(am.gain);
  const g = b.gain(0);
  b.env(g.gain, [[0, 0], [0.08, 1.4], [0.45, 1.1], [0.6, 0]]);
  b.out(b.chain(n, b.filter('bandpass', 1900 * p, 1.4), am, g));
  b.partials(5200 * p, [1, 1.52], { peak: 0.03, tau: 0.2, at: 0.05 });
}

export function weaponRaise(b, o) {
  const p = o.pitch * rnd(0.9, 1.1);
  for (const [at, pk] of [[0, 0.8], [0.09, 0.6]]) {
    b.burst('pink', { freq: 1400 * p * rnd(0.8, 1.2), q: 0.8, peak: pk, tau: 0.035, at, attack: 0.03 });
  }
  // 背带扣和枪身的轻微磕碰
  clack(b, 0.05 + rnd(0, 0.03), { f: 3200 * p, peak: 0.1, tau: 0.004, ring: 0.015 });
  clack(b, 0.15 + rnd(0, 0.04), { f: 2300 * p, peak: 0.14, tau: 0.006, ring: 0.02, thud: 0.08 });
}
