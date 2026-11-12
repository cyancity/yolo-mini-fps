// 世界音色：弹着、跳弹、无人机、界面提示。每个函数拿到一个 Builder，往里搭节点。
import { rnd } from './synth.js';

export const some = (lo, hi) => lo + ((Math.random() * (hi - lo + 1)) | 0);

// 一小把随机颗粒声（砂砾、碎屑、火花）；fall 越大，越晚的颗粒越轻
export function grains(b, n, { from = 0, to = 0.1, fLo = 1800, fHi = 4000, q = 4, peak = 0.15, tau = 0.005, fall = 0, pan = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const at = rnd(from, to);
    const k = 1 - fall * ((at - from) / (to - from));
    b.burst('white', { freq: rnd(fLo, fHi), q, peak: peak * rnd(0.5, 1) * k, tau: tau * rnd(0.7, 1.4), at, panTo: pan ? rnd(-pan, pan) : 0 });
  }
}

// 水滴溅起：短促上滑的正弦
export function droplets(b, n, from, to, peak) {
  for (let i = 0; i < n; i++) {
    const f = rnd(900, 2000);
    b.ping(f, { peak: peak * rnd(0.5, 1), tau: 0.012, at: rnd(from, to), freqTo: f * rnd(1.5, 2), sweep: 0.03, panTo: rnd(-0.4, 0.4) });
  }
}

export function impactMetal(b, o) {
  const p = o.pitch * rnd(0.85, 1.2);
  b.burst('white', { type: 'highpass', freq: 3500, peak: 0.9, tau: 0.003, attack: 0.0004 });
  b.burst('white', { freq: 2400 * p, q: 2, peak: 1.6, tau: 0.012 });
  // 瓦楞钢板的一组不成倍数模态，低的衰减慢
  b.partials(rnd(520, 760) * p, [1, 1.47, 2.09, 2.56, 3.39, 4.16, 5.33], { peak: 0.4, tau: rnd(0.14, 0.24), spread: 0.04 });
  b.ping(rnd(150, 210) * p, { peak: 0.25, tau: 0.09, freqTo: 120 * p, sweep: 0.08 }); // 箱体空腔
  b.partials(rnd(3100, 4300) * p, [1, 1.34, 1.81], { peak: 0.16, tau: 0.05 });
}

export function impactConcrete(b, o) {
  const p = o.pitch * rnd(0.88, 1.15);
  b.burst('white', { type: 'highpass', freq: 2800, peak: 0.8, tau: 0.004, attack: 0.0004 });
  b.burst('pink', { freq: 1700 * p, q: 0.9, peak: 2.2, tau: 0.022 });
  b.burst('brown', { type: 'lowpass', freq: 320, peak: 0.9, tau: 0.03 });
  grains(b, some(5, 8), { from: 0.02, to: 0.2, fLo: 1500, fHi: 5000, q: 3, peak: 0.4, tau: 0.006, fall: 0.8, pan: 0.5 }); // 崩落的碎屑
  b.burst('white', { freq: 5200, q: 0.6, peak: 0.12, tau: 0.07, at: 0.01, attack: 0.02 }); // 扬尘
}

export function impactWood(b, o) {
  const p = o.pitch * rnd(0.85, 1.2);
  b.burst('white', { type: 'highpass', freq: 2500, peak: 0.5, tau: 0.003 });
  b.ping(rnd(230, 330) * p, { peak: 0.4, tau: 0.03, freqTo: 170 * p, sweep: 0.04 });
  b.ping(rnd(520, 700) * p, { peak: 0.3, tau: 0.018 });
  b.burst('pink', { freq: 1300 * p, q: 2.2, peak: 6, tau: 0.014 });
  grains(b, some(3, 5), { from: 0.012, to: 0.1, fLo: 1800, fHi: 4200, q: 6, peak: 1.4, tau: 0.004, fall: 0.7 }); // 木刺劈开
}

export function impactAsphalt(b, o) {
  const p = o.pitch * rnd(0.88, 1.15);
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.5, tau: 0.003 });
  b.burst('brown', { type: 'lowpass', freq: 380, peak: 1.0, tau: 0.03 });
  b.burst('pink', { freq: 1100 * p, q: 0.8, peak: 1.8, tau: 0.02 });
  grains(b, some(4, 6), { from: 0.015, to: 0.16, fLo: 1400, fHi: 3800, q: 3, peak: 0.35, tau: 0.006, fall: 0.8, pan: 0.5 });
  // 积水被崩起来的那一层是单独的 splashHit，路面湿时引擎叠上去
}

// 子弹打在玻璃上：很脆的一声裂响，玻璃板几个又高又不成倍数的分音一闪而过，碎碴跟着稀里哗啦往下掉
export function impactGlass(b, o) {
  const p = o.pitch * rnd(0.88, 1.16);
  b.burst('white', { type: 'highpass', freq: 4200, peak: 0.8, tau: 0.0025, attack: 0.0003 });
  b.burst('white', { freq: 6200 * p, q: 1.6, peak: 0.8, tau: 0.007 });
  b.burst('pink', { freq: 1900 * p, q: 1.1, peak: 1.6, tau: 0.009 }); // 中频的“啪”，不然只剩一片尖的
  b.partials(rnd(2300, 3300) * p, [1, 1.32, 1.71, 2.26, 2.93, 3.6], { peak: 0.12, tau: 0.05, spread: 0.05 });
  b.ping(430 * p, { peak: 0.4, tau: 0.016, freqTo: 280 * p, sweep: 0.03 }); // 整块玻璃被顶了一下
  b.ping(rnd(850, 1050) * p, { peak: 0.12, tau: 0.025 });
  // 碎碴：稀疏的脉冲去敲几个很尖的共振，每一粒都是一小声“叮”，越往后越稀
  const g = b.gain(0);
  b.env(g.gain, [[0.012, 0], [0.03, 1], [0.2, 0.4], [0.62, 0]]);
  b.chain(b.noise('crackle', { at: 0.012, dur: 0.62, rate: rnd(0.28, 0.4) }), g);
  for (const f of [rnd(3500, 4300), rnd(5200, 6300), rnd(7400, 9000)]) b.out(b.chain(g, b.filter('bandpass', f * p, 200)), 11);
}

// 跳弹：变形的弹头翻滚着飞走，下滑的哨音上叠着翻滚带来的快速颤动
export function ricochet(b, o) {
  const p = o.pitch * rnd(0.85, 1.2);
  const dur = rnd(0.32, 0.55), f0 = rnd(2800, 4600) * p, f1 = f0 * rnd(0.28, 0.45);
  b.burst('white', { type: 'highpass', freq: 4000, peak: 0.6, tau: 0.003 });
  const osc = b.osc('triangle', f0, { dur });
  b.env(osc.frequency, [[0, f0], [dur, f1]], true);
  b.mod(osc.frequency, rnd(38, 75), f0 * 0.05, { dur });
  const g = b.gain(0);
  b.env(g.gain, [[0, 0.0001], [0.004, 0.3], [dur * 0.5, 0.1], [dur, 0.0001]], true);
  b.out(b.chain(osc, g));
  const n = b.noise('white', { dur });
  const bp = b.filter('bandpass', f0, 16);
  b.env(bp.frequency, [[0, f0], [dur, f1]], true);
  const ng = b.gain(0);
  b.env(ng.gain, [[0, 0.0001], [0.004, 3], [dur * 0.6, 0.6], [dur, 0.0001]], true);
  b.out(b.chain(n, bp, ng));
}

// 近失弹：超音速弹头的激波“啪”，随后是从一侧掠到另一侧的气流
export function bulletWhiz(b, o) {
  const p = o.pitch * rnd(0.85, 1.2);
  b.burst('white', { type: 'highpass', freq: 2600, peak: 0.9, tau: 0.0025, attack: 0.0003 });
  b.burst('white', { freq: 5200 * p, q: 1.5, peak: 1.0, tau: 0.006 });
  const at = 0.004, dur = rnd(0.16, 0.26), side = Math.random() < 0.5 ? -0.8 : 0.8;
  const n = b.noise('pink', { at, dur });
  const bp = b.filter('bandpass', 3200 * p, 2.2);
  b.env(bp.frequency, [[at, 3200 * p], [at + dur, 700 * p]], true);
  const g = b.gain(0);
  b.env(g.gain, [[at, 0], [at + dur * 0.25, 3], [at + dur, 0]]);
  const pn = b.pan(side);
  b.env(pn.pan, [[at, side], [at + dur, -side]]);
  b.out(b.chain(n, bp, g, pn));
}

// 无人机开火：电磁加速的小口径，尖、干，带一声下滑的“啾”，和步枪的火药声区分开
export function droneShot(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  b.burst('white', { type: 'highpass', freq: 3000 * p, peak: 1.0, tau: 0.004, attack: 0.0004 });
  const z = b.osc('sawtooth', 2600 * p, { dur: 0.2 });
  b.env(z.frequency, [[0, 2600 * p], [0.03, 900 * p], [0.12, 260 * p]], true);
  const zf = b.filter('bandpass', 2600 * p, 1.2);
  b.env(zf.frequency, [[0, 2600 * p], [0.1, 600 * p]], true);
  const zg = b.gain(0);
  b.perc(zg.gain, 1.6, 0.028);
  b.out(b.chain(z, zf, b.shaper('soft'), zg));
  b.burst('pink', { freq: 1500 * p, q: 0.8, peak: 1.8, tau: 0.02 });
  b.ping(240 * p, { peak: 0.5, tau: 0.03, freqTo: 110 * p, sweep: 0.05 });
  b.partials(3900 * p, [1, 1.27, 1.63], { peak: 0.05, tau: 0.07, at: 0.01 }); // 电容放电后的余音
}

// 子弹打在无人机上：碳纤维机壳和铝臂，短促发闷，带几粒电火花
export function droneHit(b, o) {
  const p = o.pitch * rnd(0.88, 1.15);
  b.burst('white', { type: 'highpass', freq: 3200, peak: 0.7, tau: 0.003 });
  b.burst('pink', { freq: 2100 * p, q: 2.5, peak: 2.4, tau: 0.01 });
  b.partials(rnd(1500, 2100) * p, [1, 1.41, 2.23, 3.02], { peak: 0.22, tau: 0.045, spread: 0.04 });
  b.ping(330 * p, { peak: 0.35, tau: 0.025, freqTo: 210 * p });
  grains(b, some(3, 5), { from: 0.01, to: 0.12, fLo: 5000, fHi: 9000, q: 2, peak: 0.3, tau: 0.002, fall: 0.5 });
}

export function droneExplode(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  b.burst('white', { type: 'highpass', freq: 1800, peak: 1.2, tau: 0.008, attack: 0.0004 });
  // 低频冲击：下滑的正弦过失真
  const sub = b.osc('sine', 105 * p, { dur: 1.2 });
  b.env(sub.frequency, [[0, 105 * p], [0.08, 58 * p], [0.6, 30 * p]], true);
  const sg = b.gain(0);
  b.perc(sg.gain, 1.1, 0.17, 0, 0.002);
  b.out(b.chain(sub, sg, b.shaper('soft')), 0.9);
  // 爆轰主体：粉噪过硬失真，低通从亮扫到暗
  const n = b.noise('pink', { dur: 1.4 });
  const lp = b.filter('lowpass', 7500, 0.8);
  b.env(lp.frequency, [[0, 7500], [0.1, 3600], [0.5, 900], [1.4, 250]], true);
  const g = b.gain(0);
  b.perc(g.gain, 1.2, 0.2, 0, 0.001);
  b.out(b.chain(n, b.gain(5), b.shaper('hard'), lp, g));
  b.burst('white', { freq: 1800 * p, q: 0.7, peak: 4, tau: 0.06 }); // 爆裂的中频，不然只剩一团低频
  // 电池和电机短路的电弧
  const fz = b.noise('white', { at: 0.02, dur: 0.5 });
  const chop = b.gain(0.5);
  b.mod(chop.gain, rnd(55, 95), 0.5, { type: 'square', at: 0.02, dur: 0.5 });
  const fg = b.gain(0);
  b.env(fg.gain, [[0.02, 0.0001], [0.04, 1.6], [0.25, 0.4], [0.5, 0.0001]], true);
  b.out(b.chain(fz, b.filter('bandpass', rnd(3500, 5200), 5), chop, fg));
  // 碎片：先是密集的崩裂，再是零件落地
  grains(b, 16, { from: 0.03, to: 0.7, fLo: 1500, fHi: 6000, q: 3, peak: 1.1, tau: 0.007, fall: 0.85, pan: 0.8 });
  for (let i = 0; i < 3; i++) {
    const at = rnd(0.45, 1.25), side = rnd(-0.7, 0.7);
    b.partials(rnd(900, 2400), [1, 1.52, 2.37, 3.11], { peak: 0.07 * rnd(0.5, 1), tau: 0.05, at, panTo: side });
    b.burst('white', { freq: rnd(2000, 4000), q: 2, peak: 0.2, tau: 0.006, at, panTo: side });
  }
  // 远场的低频余波
  const tn = b.noise('brown', { at: 0.03, dur: 2 });
  const tl = b.filter('lowpass', 500, 0.7);
  b.env(tl.frequency, [[0.03, 500], [2, 110]], true);
  const tg = b.gain(0);
  b.env(tg.gain, [[0.03, 0.0001], [0.08, 0.6], [0.5, 0.2], [2, 0.0005]], true);
  b.out(b.chain(tn, tl, tg));
}

// 无人机锁定目标：三声上行的合成短音，带一点调频的机械感
export function droneAlert(b, o) {
  const p = o.pitch;
  [[0, 1320], [0.085, 1660], [0.17, 2217]].forEach(([at, f], i) => {
    const dur = i === 2 ? 0.16 : 0.06;
    const osc = b.osc('square', f * p, { at, dur: dur + 0.02 });
    b.mod(osc.frequency, 38, f * 0.015, { at, dur: dur + 0.02 });
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.004, 0.22], [at + dur * 0.7, 0.16], [at + dur + 0.015, 0]]);
    b.out(b.chain(osc, b.filter('bandpass', f * p, 1.8), g));
  });
  b.burst('white', { type: 'highpass', freq: 6000, peak: 0.06, tau: 0.004 });
}

// 玩家中弹：防弹板上的闷击、织物拍打，再加一小段耳鸣
export function hurt(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.8, tau: 0.04 });
  b.ping(120 * p, { peak: 0.4, tau: 0.055, freqTo: 55 * p, sweep: 0.09 });
  b.burst('pink', { freq: 1300 * p, q: 0.9, peak: 6, tau: 0.018 });
  b.burst('white', { type: 'highpass', freq: 3500, peak: 0.25, tau: 0.004 });
  const side = rnd(-0.4, 0.4);
  b.ping(rnd(3400, 4200), { peak: 0.035, tau: 0.22, attack: 0.03, panTo: side });
  b.ping(rnd(5200, 6100), { peak: 0.02, tau: 0.16, attack: 0.03, panTo: -side });
}

export function hitmarker(b, o) {
  const p = o.pitch * rnd(0.97, 1.03);
  b.burst('white', { type: 'highpass', freq: 4500, peak: 0.35, tau: 0.002 });
  b.ping(2350 * p, { peak: 0.3, tau: 0.014, type: 'triangle' });
  b.ping(3520 * p, { peak: 0.2, tau: 0.01, type: 'triangle', at: 0.012 });
}

// 爆头确认：比命中提示低一截、长一截的一声“叮”。全用正弦，带一个不成倍数的泛音像敲在硬壳上，
// 再垫一下很轻的低频；没有噪声成分，所以亮而不刺
export function headshot(b, o) {
  const p = o.pitch * rnd(0.985, 1.015);
  b.ping(1480 * p, { peak: 0.34, tau: 0.05, freqTo: 1440 * p, sweep: 0.02 });
  b.ping(4085 * p, { peak: 0.1, tau: 0.022 });
  b.ping(2220 * p, { peak: 0.2, tau: 0.065, at: 0.03, attack: 0.003 });
  b.ping(260 * p, { peak: 0.28, tau: 0.016, freqTo: 150 * p, sweep: 0.03 });
  b.burst('white', { freq: 3000 * p, q: 2, peak: 0.5, tau: 0.0012 });
}

// 击杀确认的底子：一记往下沉的低频“咚”（过软饱和，小喇叭上也有分量），加一下木块似的中频“笃”
function killBody(b, p, k) {
  const sh = b.out(b.shaper('soft'), 0.4 * k);
  b.ping(150 * p, { peak: 0.7, tau: 0.05, attack: 0.002, freqTo: 72 * p, sweep: 0.05, to: sh });
  b.ping(540 * p, { peak: 0.16 * k, tau: 0.016, type: 'triangle', freqTo: 440 * p, sweep: 0.02 });
}

// 亮的“叮”：一个三角波加它上方五度的正弦，前面只有一毫秒的点击，亮而不刺
function killTick(b, f, at, k) {
  b.burst('white', { freq: 6000, q: 1.2, peak: 0.3 * k, tau: 0.0012, at });
  b.ping(f, { peak: 0.42 * k, tau: 0.06, at, type: 'triangle' });
  b.ping(f * 1.5, { peak: 0.15 * k, tau: 0.04, at });
}

// 击杀确认：低频托底，“叮”晚 30 ms 出来，再往下落一个音收住。击杀总是和打出那一枪同一刻触发，
// 枪声的爆裂在 30 ms 里就掉下去了，3~4 kHz 这一段随后最空，“叮”落在这里压不住；整个音 0.25 s 以内收完
const KILL_TICK = 0.03;
export function killConfirm(b, o) {
  const p = o.pitch * rnd(0.99, 1.01);
  killBody(b, p, 1);
  killTick(b, 2960 * p, KILL_TICK, 1);
  b.ping(2490 * p, { peak: 0.14, tau: 0.07, at: KILL_TICK + 0.045, attack: 0.004 });
}

// 爆头击杀：同一个底子轻一点，换成往上走的两下“叮”，整体明显更亮
export function killHeadshot(b, o) {
  const p = o.pitch * rnd(0.99, 1.01);
  killBody(b, p * 1.08, 0.5);
  killTick(b, 3520 * p, KILL_TICK, 1);
  killTick(b, 4400 * p, KILL_TICK + 0.052, 0.85);
  b.ping(7040 * p, { peak: 0.03, tau: 0.05, at: KILL_TICK + 0.052 });
}

// 新一波来袭：低沉的两音警报，锯齿叠层过逐渐打开的低通，底下垫一记低频
export function waveStart(b, o) {
  const p = o.pitch;
  for (const [at, f] of [[0, 98], [0.42, 130.8]]) {
    const lp = b.filter('lowpass', 400, 1.2);
    b.env(lp.frequency, [[at, 400], [at + 0.25, 2200], [at + 0.75, 500]], true);
    for (const det of [-11, 0, 9]) b.osc('sawtooth', f * p, { at, dur: 0.8, detune: det }).connect(lp);
    b.osc('sawtooth', f * p * 2, { at, dur: 0.8, detune: 5 }).connect(lp);
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.03, 0.3], [at + 0.3, 0.22], [at + 0.75, 0]]);
    b.out(b.chain(lp, g));
  }
  b.ping(70, { peak: 0.5, tau: 0.12, freqTo: 42, sweep: 0.15 });
  b.burst('pink', { type: 'lowpass', freq: 900, peak: 0.6, tau: 0.08 });
}

export function waveClear(b, o) {
  const p = o.pitch;
  [[0, 587.3], [0.09, 880], [0.18, 1174.7]].forEach(([at, f], i) => {
    b.ping(f * p, { peak: 0.22, tau: 0.22 + i * 0.06, at, type: 'triangle', panTo: (i - 1) * 0.3 });
    b.ping(f * p * 2.01, { peak: 0.04, tau: 0.12, at });
  });
  b.ping(146.8 * p, { peak: 0.2, tau: 0.3, attack: 0.02 });
}

export function uiClick(b, o) {
  b.burst('white', { type: 'highpass', freq: 5000, peak: 0.2, tau: 0.0015 });
  b.ping(1900 * o.pitch, { peak: 0.25, tau: 0.008, freqTo: 1300 * o.pitch, sweep: 0.02 });
}

// 一次心跳（“咚-哒”两下）；低血量时由玩法层按节奏反复触发。
// 52~124 Hz 正好压在港口的低频轰鸣底下，所以每下再叠一层 260 Hz 附近的闷击（胸腔里听到的那一下），
// 倍频也加重；引擎在每下心跳时把环境声按下去一点（表里的 pump）
export function heartbeat(b, o) {
  for (const [at, f, k] of [[0, 62, 1], [0.17, 52, 0.65]]) {
    b.ping(f * o.pitch, { peak: 0.9 * k, tau: 0.045, at, attack: 0.008, freqTo: f * 0.68 * o.pitch, sweep: 0.09 });
    b.ping(f * 2 * o.pitch, { peak: 0.5 * k, tau: 0.03, at, attack: 0.006, freqTo: f * 1.4 * o.pitch, sweep: 0.06 }); // 小喇叭放不出 60 Hz，垫一层倍频
    b.burst('brown', { type: 'lowpass', freq: 150, peak: 0.8 * k, tau: 0.035, at, attack: 0.008 });
    b.burst('pink', { freq: 260 * o.pitch, q: 1.2, peak: 2.4 * k, tau: 0.025, at, attack: 0.006 });
    b.burst('pink', { freq: 540 * o.pitch, q: 1.4, peak: 2.2 * k, tau: 0.018, at, attack: 0.004 }); // 500 Hz 往上没有这一点，声底稍一响就整个被盖住
  }
}
