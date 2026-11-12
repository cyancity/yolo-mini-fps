// 循环音（无人机旋翼、灯具电流声）和环境声（细雨、港口低频、风，以及偶发的远雷、船笛、吊装声、滴水）。
import { Builder, rnd, pick } from './synth.js';
import { dayNight, roomTone } from './ambient_day.js';

// 循环音的搭建函数返回 { setPitch(p, t, tau) }，引擎用它连续改音高
export function droneRotor(b) {
  const base = 172, params = [];
  const mix = b.gain(1);
  // 四个旋翼转速略有差别，叠出拍频；每个再缓慢漂一点，听起来才是活的
  [0.965, 1, 1.027, 1.058].forEach((k, i) => {
    const s = b.osc('sawtooth', base * k, { dur: Infinity });
    b.mod(s.detune, rnd(0.4, 1.1), 14, { dur: Infinity });
    b.chain(s, b.gain(0.16), mix);
    params.push([s.frequency, base * k]);
    if (i % 2 === 0) {
      const h = b.osc('square', base * k * 2, { dur: Infinity });
      b.chain(h, b.gain(0.05), mix);
      params.push([h.frequency, base * k * 2]);
    }
  });
  const lp = b.filter('lowpass', 3800, 0.8);
  b.out(b.chain(mix, b.filter('highpass', 140, 0.7), b.filter('peaking', 620, 1.2, 7), lp)); // 机臂共振
  // 桨叶切气流的宽带噪声，按桨频调幅
  const am = b.gain(0.55);
  const lfo = b.mod(am.gain, base, 0.45, { dur: Infinity });
  params.push([lfo.frequency, base]);
  b.out(b.chain(b.noise('pink', { dur: Infinity }), b.filter('bandpass', 2600, 0.7), am), 3);
  return {
    setPitch(p, t, tau = 0.08) {
      for (const [param, f] of params) param.setTargetAtTime(f * p, t, tau);
      lp.frequency.setTargetAtTime(3800 * Math.sqrt(p), t, tau);
    },
  };
}

export function lampHum(b) {
  const params = [];
  // 镇流器：100 Hz 及其谐波，上面叠一条被 100 Hz 调幅的高频“滋”
  for (const [k, level] of [[1, 0.22], [2, 0.3], [3, 0.2], [4, 0.14], [5, 0.08], [6, 0.09], [8, 0.05]]) {
    const s = b.osc('sine', 100 * k, { dur: Infinity });
    b.out(b.chain(s, b.gain(level)));
    params.push([s.frequency, 100 * k]);
  }
  const saw = b.osc('sawtooth', 100, { dur: Infinity });
  params.push([saw.frequency, 100]);
  const buzz = b.gain(0.5);
  b.mod(buzz.gain, rnd(0.3, 0.9), 0.2, { dur: Infinity }); // 接触不良，忽强忽弱
  b.out(b.chain(saw, b.filter('bandpass', 2700, 2.5), buzz), 1.6);
  const am = b.gain(0.5);
  const lfo = b.mod(am.gain, 100, 0.5, { type: 'square', dur: Infinity });
  params.push([lfo.frequency, 100]);
  b.out(b.chain(b.noise('white', { dur: Infinity }), b.filter('bandpass', 6200, 1.5), am), 0.25);
  return { setPitch(p, t, tau = 0.08) { for (const [param, f] of params) param.setTargetAtTime(f * p, t, tau); } };
}

// 无人机残骸冒烟时的短路：一阵一阵的电火花噼啪，夹着电机线圈被反复接通的嗡响
export function droneSpark(b) {
  const on = { dur: Infinity };
  const gate = b.gain(0.4);
  b.wobble(gate.gain, 7, 0.6, on); // 接触时通时断，响度忽有忽无
  b.out(b.chain(b.noise('crackle', { dur: Infinity, rate: 1.6 }), b.filter('bandpass', 4200, 1.2), b.gain(1.2), b.shaper('soft'), gate));
  const buzz = b.osc('sawtooth', 118, on);
  const bg = b.gain(0.3);
  b.wobble(bg.gain, 11, 0.35, on);
  b.out(b.chain(buzz, b.filter('bandpass', 900, 2), bg));
  return { setPitch(p, t, tau = 0.08) { buzz.frequency.setTargetAtTime(118 * p, t, tau); } };
}

// 环境声底：一直响。室外的几层接在 dest（amb 总线）上，屋面雨点那一层接在 roof 上、房间底噪接在 tone 上，
// 平时没声，人进了屋由引擎推上来。返回 Builder，引擎靠它的 nodes / sources 收尾；
// b.rain、b.day、b.night 是几组闸门（AudioParam 数组），引擎按雨量和时段推
export function startAmbient(ctx, res, dest, roof, t0, tone) {
  const b = new Builder(ctx, res, dest, t0);
  dayNight(b, dest);
  if (tone) roomTone(b, tone);
  const on = { dur: Infinity };
  // 两层雨声各过一个总闸，开度跟着时段的雨量走（引擎的 setRain），不下雨的时段只剩港口的低频和风
  const wetRoof = b.gain(1), wet = b.gain(1);
  wetRoof.connect(roof);
  wet.connect(dest);
  b.rain = [wetRoof.gain, wet.gain];
  // 屋面上的雨：稀疏的脉冲过带通，就是一粒粒打在屋面板上的雨点；底下垫一层板子被敲出来的低沉轰响
  b.dest = wetRoof;
  for (const side of [-1, 1]) {
    const g = b.gain(0.5);
    b.mod(g.gain, rnd(0.05, 0.11), 0.14, on);
    const n = b.noise('crackle', { dur: Infinity, rate: side < 0 ? 1 : 0.87 });
    b.out(b.chain(n, b.filter('bandpass', 1000, 0.9), b.filter('lowpass', 2200, 0), g), 1, side * 0.6);
  }
  const dg = b.gain(0.1);
  b.mod(dg.gain, 0.07, 0.03, on);
  b.out(b.chain(b.noise('pink', { dur: Infinity, rate: 0.9 }), b.filter('bandpass', 260, 0.8), dg));
  b.dest = wet;
  // 细雨：左右两路不相关的高频噪声 + 中频的落地声，各自有缓慢的强弱起伏
  for (const side of [-1, 1]) {
    const g = b.gain(0.11);
    b.mod(g.gain, rnd(0.06, 0.12), 0.025, on);
    const n = b.noise('white', { dur: Infinity, rate: side < 0 ? 1 : 0.93 });
    b.out(b.chain(n, b.filter('highpass', 3200, 0.7), b.filter('lowpass', 11000, 0.7), g), 1, side * 0.75);
    const mg = b.gain(0.2);
    b.mod(mg.gain, rnd(0.04, 0.09), 0.05, on);
    const m = b.noise('pink', { dur: Infinity, rate: side < 0 ? 0.97 : 1.05 });
    b.out(b.chain(m, b.filter('bandpass', 1500, 0.6), mg), 1, side * 0.5);
  }
  b.dest = dest;
  // 远处港口的低频轰鸣：棕噪过低通，加几条略微失谐的机器声互相拍频
  const rg = b.gain(0.22);
  b.mod(rg.gain, 0.05, 0.06, on);
  b.out(b.chain(b.noise('brown', on), b.filter('lowpass', 120, 0.8), rg));
  for (const [f, level, side] of [[46.2, 0.03, -0.4], [46.7, 0.03, 0.4], [69.5, 0.018, 0.2], [93.1, 0.012, -0.2]]) {
    b.out(b.chain(b.osc('sine', f, on), b.gain(level)), 1, side);
  }
  // 风：带通粉噪，中心频率和响度都缓慢游走
  for (const side of [-1, 1]) {
    const bp = b.filter('bandpass', 520, 1.1);
    b.mod(bp.frequency, rnd(0.05, 0.09), 220, on);
    const g = b.gain(0.3);
    b.mod(g.gain, rnd(0.07, 0.13), 0.16, on);
    b.out(b.chain(b.noise('pink', { dur: Infinity, rate: side < 0 ? 0.81 : 0.88 }), bp, g), 1, side * 0.6);
  }
  // 箱缝里的风：一条窄带的“呜”
  const hb = b.filter('bandpass', 380, 9);
  b.mod(hb.frequency, 0.11, 70, on);
  b.mod(hb.frequency, 0.037, 50, on);
  const hg = b.gain(0.07);
  b.mod(hg.gain, 0.083, 0.06, on);
  b.out(b.chain(b.noise('pink', { dur: Infinity, rate: 0.9 }), hb, hg), 1, 0.3);
  return b;
}

// 远雷：几下滚动的低频隆隆，没有近处的炸裂声
export function thunder(b) {
  const points = [[0, 0.0001]];
  const rolls = 3 + ((Math.random() * 3) | 0);
  let t = 0.15;
  for (let i = 0; i < rolls; i++) {
    const peak = rnd(0.5, 1) * (1 - i / (rolls + 1));
    points.push([t, peak]);
    t += rnd(0.25, 0.6);
    points.push([t, peak * rnd(0.2, 0.4)]);
    t += rnd(0.1, 0.3);
  }
  const dur = t + rnd(1.2, 2);
  points.push([dur, 0.0001]);
  const lp = b.filter('lowpass', 260, 0.7);
  b.env(lp.frequency, [[0, 260], [dur, 70]], true);
  const g = b.gain(0);
  b.env(g.gain, points, true);
  b.out(b.chain(b.noise('brown', { dur }), lp, g), 1, rnd(-0.4, 0.4));
}

// 远处的船笛：低沉的锯齿叠层，慢起慢收；偶尔一短一长两声
export function horn(b, o) {
  const f = pick([87.3, 98, 110, 116.5]) * o.pitch, side = rnd(-0.5, 0.5);
  const long = rnd(1.8, 3.2);
  const blasts = Math.random() < 0.35 ? [[0, 0.8], [1.25, long]] : [[0, long]];
  for (const [at, dur] of blasts) {
    const lp = b.filter('lowpass', 420, 0.9);
    for (const [mul, det] of [[1, -6], [1, 7], [1.498, 3], [2, -4]]) b.osc('sawtooth', f * mul, { at, dur, detune: det }).connect(lp);
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.3, 0.5], [at + dur - 0.4, 0.45], [at + dur, 0]]);
    b.out(b.chain(lp, b.filter('highpass', 70, 0.7), g), 1, side);
  }
}

// 远处吊机放下集装箱：闷的一声巨响，带箱体的低频余振
export function clang(b) {
  const far = b.filter('lowpass', 900, 0.7);
  b.out(far, 1, rnd(-0.6, 0.6));
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.9, tau: 0.12, to: far });
  b.partials(rnd(70, 110), [1, 1.83, 2.71, 3.9, 5.2, 7.1], { peak: 0.4, tau: 0.5, spread: 0.05, to: far });
  b.burst('pink', { freq: 800, q: 0.7, peak: 0.6, tau: 0.05, to: far });
}

// 箱檐滴水：落进积水是上滑的“啾”，敲在铁皮上是一小声金属响
export function drip(b) {
  const side = rnd(-0.9, 0.9);
  if (Math.random() < 0.6) {
    const f = rnd(700, 1500);
    b.ping(f, { peak: 0.5, tau: 0.02, freqTo: f * rnd(1.5, 2.2), sweep: 0.035, panTo: side });
    b.burst('white', { type: 'highpass', freq: 5000, peak: 0.15, tau: 0.003, panTo: side });
  } else {
    b.partials(rnd(900, 1800), [1, 1.63, 2.4], { peak: 0.35, tau: 0.035, panTo: side });
    b.burst('white', { freq: 3000, q: 2, peak: 0.6, tau: 0.004, panTo: side });
  }
}
