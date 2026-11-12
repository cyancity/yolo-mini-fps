// 玩法道具的音色：切枪、喷气、烟雾弹、练习场的钢靶。每个函数拿到一个 Builder，往里搭节点。
import { rnd } from './synth.js';
import { clack } from './sounds_weapons.js';

// 一小下金属轻磕（背带扣、拉环、挂钩）：窄带噪声加几个不成倍数的分音。
// 比武器里的 clack 少了高通的“嚓”，连着响十几下也不扎耳
function tick(b, at, { f = 3000, peak = 0.1, tau = 0.004, ring = 0.03, panTo = 0 } = {}) {
  b.burst('white', { freq: f, q: 5, peak: peak * 2, tau, at, panTo });
  if (ring) b.partials(f * 1.31, [1, 1.58, 2.37], { peak: ring, tau: tau * 4, at, panTo });
}

// 之后搭的节点都先过一道低通，搭完要把 b.dest 还原
function under(b, hz) {
  const dest = b.dest;
  b.dest = b.filter('lowpass', hz, 0);
  b.dest.connect(dest);
  return dest;
}

// 切枪：枪身的金属件蹭过背带扣和导轨的一道摩擦，背心和弹匣包被枪撞一下的闷响，扣件再磕一两声。
// 连按 1、3 时一秒能响十几次：起音硬，但 9 kHz 以上压掉、单下很短，叠起来是一串利落的咔嚓，不糊也不刺耳
export function weaponSwitch(b, o) {
  const p = o.pitch * rnd(0.93, 1.07), len = rnd(0.14, 0.18);
  const dest = under(b, 9000);
  // 金属摩擦：窄带往上扫。稀疏脉冲给出一粒粒的刮擦，白噪垫底，不然听着像撒沙子
  const bp = b.filter('bandpass', 2600 * p, 5);
  b.env(bp.frequency, [[0, 2600 * p], [len * 0.6, 5200 * p], [len, 4200 * p]], true);
  const sg = b.gain(0);
  b.env(sg.gain, [[0, 0], [0.012, 1.5], [len * 0.5, 1], [len, 0]]);
  b.out(b.chain(b.noise('crackle', { dur: len, rate: rnd(2.2, 3) }), bp, b.filter('highpass', 1500, 0.7), sg), 1.5, rnd(-0.2, 0.2));
  b.burst('white', { freq: 3400 * p, freqTo: 5600 * p, sweep: len * 0.7, q: 3, peak: 0.6, tau: len * 0.35, attack: 0.008 });
  // 布料和装具：枪身撞在背心上的闷响，加一层粗布的摩擦
  b.burst('brown', { type: 'lowpass', freq: 420 * p, peak: 0.8, tau: 0.028, at: rnd(0.015, 0.04), attack: 0.003 });
  b.burst('pink', { freq: 1300 * p, freqTo: 800 * p, sweep: len, q: 0.8, peak: 1.0, tau: len * 0.35, attack: 0.015 });
  // 磕碰：一下重的带余响，再跟一两下轻的
  clack(b, rnd(0.02, 0.045), { f: rnd(2100, 2800) * p, peak: 0.22, tau: 0.008, ring: 0.07, thud: 0.06 });
  const n = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) tick(b, rnd(0.06, 0.15), { f: rnd(2600, 4200) * p, peak: rnd(0.08, 0.13), ring: 0.035, panTo: rnd(-0.35, 0.35) });
  b.dest = dest;
}

// 喷气冲刺：压缩气体一下子爆出来，听着是“chua”或者“嘭”的一声，两百毫秒上下收完，不拖嘶声。
// 起头是阀门顶开的爆破和两侧喷口一口很亮的气（ch）；紧接着气流撑开，噪声过两个共振峰，中心从合口的 u
// 滑到张口的 a；气瓶和喷管这段空腔被激出一声往下掉的“嘭”，底下的低频是身体被推出去的分量
const DASH_FORMANTS = [[340, 860, 3.5, 5.6], [740, 1320, 4.5, 4.6], [2300, 2700, 5, 1.6]];
export function dash(b, o) {
  const p = o.pitch * rnd(0.95, 1.05), len = rnd(0.18, 0.21);
  b.burst('white', { type: 'highpass', freq: 2500, peak: 0.7, tau: 0.003, attack: 0.0005 });
  b.burst('pink', { freq: 900 * p, q: 1, peak: 2, tau: 0.012 });
  for (const side of [-0.45, 0.45]) {
    b.burst('white', { freq: 4300 * p * rnd(0.92, 1.08), freqTo: 2300 * p, sweep: 0.05, q: 1.1, peak: 2.6, tau: 0.022, attack: 0.002, panTo: side });
  }
  // ua：一路噪声分给几个带通，响度在前 20 毫秒顶上去，随后一路掉
  const src = b.noise('white', { at: 0.006, dur: len });
  const vg = b.gain(0);
  b.env(vg.gain, [[0.006, 0.0001], [0.02, 1], [0.075, 0.5], [0.006 + len, 0.0001]], true);
  for (const [from, to, q, level] of DASH_FORMANTS) {
    const bp = b.filter('bandpass', from * p, q);
    b.env(bp.frequency, [[0.006, from * p], [0.075, to * p]], true);
    b.chain(src, bp, b.gain(level), vg);
  }
  b.out(vg);
  // 嘭：空腔的共振，音高跟着压力往下掉。正弦给出音头，同频的窄带噪声让它听着是气而不是电子音
  b.ping(460 * p, { peak: 0.45, tau: 0.04, freqTo: 300 * p, sweep: 0.08, attack: 0.002 });
  b.burst('pink', { freq: 470 * p, freqTo: 310 * p, sweep: 0.08, q: 6, peak: 3.5, tau: 0.035, attack: 0.002 });
  const sub = b.osc('sine', 110 * p, { dur: 0.3 });
  b.env(sub.frequency, [[0, 110 * p], [0.1, 46 * p]], true);
  const sg = b.gain(0);
  b.perc(sg.gain, 0.5, 0.045, 0, 0.004);
  b.out(b.chain(sub, sg, b.shaper('soft')), 0.55); // 过软饱和多出几个倍频，小喇叭上也听得到
  b.burst('brown', { type: 'lowpass', freq: 280, peak: 0.25, tau: 0.04, attack: 0.005 });
  const rl = b.filter('lowpass', 1500 * p, 0.7); // 带起来的一小团气流，很轻，四分之一秒内散掉
  b.env(rl.frequency, [[0, 1500 * p], [0.24, 420 * p]], true);
  const rg = b.gain(0);
  b.env(rg.gain, [[0, 0.0001], [0.02, 0.5], [0.1, 0.2], [0.24, 0.0001]], true);
  b.out(b.chain(b.noise('pink', { dur: 0.24 }), rl, rg));
}

// 扔烟雾弹：拔销时拉环一声细“叮”，挥臂带起一阵风，出手时击针打下去，握片弹飞。
// 握片是一条薄钢片，自由振动的分音比约 1 : 2.76 : 5.40，边转边飞，余振忽强忽弱
export function smokeThrow(b, o) {
  const p = o.pitch * rnd(0.96, 1.04);
  b.burst('white', { freq: 4200 * p, freqTo: 5200 * p, sweep: 0.03, q: 3, peak: 0.25, tau: 0.01, attack: 0.008, panTo: 0.25 });
  tick(b, 0.028, { f: 3300 * p, peak: 0.12, ring: 0.06, panTo: 0.25 });
  const at = 0.04, dur = 0.32;
  const bp = b.filter('bandpass', 420 * p, 1.3);
  b.env(bp.frequency, [[at, 420 * p], [at + 0.15, 1600 * p], [at + dur, 520 * p]], true);
  const g = b.gain(0);
  b.env(g.gain, [[at, 0], [at + 0.13, 1.5], [at + 0.2, 0.9], [at + dur, 0]]);
  const pn = b.pan(0.35); // 风声从右手边扫到正前方
  b.env(pn.pan, [[at, 0.35], [at + dur, -0.05]]);
  b.out(b.chain(b.noise('pink', { at, dur }), bp, g, pn));
  const rel = at + 0.14;
  tick(b, rel, { f: 2100 * p, peak: 0.18, tau: 0.005, ring: 0.03 });
  const spin = b.out(b.gain(0.7), 1, 0.1);
  b.mod(spin.gain, rnd(18, 26), 0.3, { at: rel, dur: 0.45 });
  const f0 = rnd(1900, 2300) * p;
  for (const [r, pk, tau] of [[1, 0.13, 0.09], [2.756, 0.07, 0.05], [5.404, 0.02, 0.03]]) b.ping(f0 * r, { peak: pk, tau, at: rel + 0.012, to: spin });
}

// 烟雾弹落地：一截实心钢罐磕在硬地上。一端先着地、另一端紧跟着拍下来，所以是连着的两下；
// 罐壁厚，分音高而短，罐里装满了药剂，低频那下发闷
export function smokeBounce(b, o) {
  const p = o.pitch * rnd(0.9, 1.1), gap = rnd(0.006, 0.022);
  for (const [at, k] of [[0, 1], [gap, rnd(0.45, 0.8)]]) {
    b.burst('white', { type: 'highpass', freq: 3500, peak: 0.45 * k, tau: 0.0025, attack: 0.0004, at });
    b.burst('pink', { freq: 1500 * p * rnd(0.9, 1.1), q: 1.2, peak: 1.1 * k, tau: 0.01, at });
    b.partials(rnd(1650, 2100) * p, [1, 1.53, 2.31, 3.07], { peak: 0.18 * k, tau: 0.05, at, spread: 0.03 });
  }
  b.ping(rnd(340, 420) * p, { peak: 0.3, tau: 0.018, freqTo: 260 * p, sweep: 0.03 });
  b.burst('brown', { type: 'lowpass', freq: 420, peak: 0.4, tau: 0.015 });
}

// 烟雾弹起爆：引信点着药剂的一声“啪”，随后烟从罐口喷出来。嘶声带着抖动，
// 一秒半里慢慢泄下去，压力越低越暗；药剂燃烧还有一点噼啪
export function smokeBurst(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  b.burst('white', { type: 'highpass', freq: 2600, peak: 0.9, tau: 0.003, attack: 0.0004 });
  b.burst('pink', { freq: 1100 * p, q: 0.9, peak: 3, tau: 0.014 });
  b.ping(150 * p, { peak: 0.5, tau: 0.03, freqTo: 70 * p, sweep: 0.05 });
  const at = 0.025, dur = 1.6;
  const bp = b.filter('bandpass', 2800 * p, 0.6);
  b.wobble(bp.frequency, 30, 800 * p, { at, dur });
  const lp = b.filter('lowpass', 8000, 0);
  b.env(lp.frequency, [[at, 8000], [at + 0.4, 5000], [at + dur, 1600]], true);
  const flutter = b.gain(0.75);
  b.wobble(flutter.gain, 22, 0.25, { at, dur });
  const g = b.gain(0);
  b.env(g.gain, [[at, 0.0001], [at + 0.05, 1.3], [at + 0.25, 0.9], [at + 0.8, 0.3], [at + dur, 0.0001]], true);
  b.out(b.chain(b.noise('white', { at, dur }), b.filter('highpass', 900 * p, 0.7), bp, lp, flutter, g));
  const rg = b.gain(0);
  b.env(rg.gain, [[at, 0.0001], [at + 0.06, 0.6], [at + 1.2, 0.0001]], true);
  b.out(b.chain(b.noise('pink', { at, dur: 1.2 }), b.filter('lowpass', 700, 0.7), rg));
  const cg = b.gain(0);
  b.env(cg.gain, [[at + 0.03, 0.0001], [at + 0.1, 0.5], [at + 1.13, 0.0001]], true);
  b.out(b.chain(b.noise('crackle', { at: at + 0.03, dur: 1.1, rate: 0.6 }), b.filter('bandpass', 2600 * p, 2), cg));
}

// 钢靶中弹：弹头拍在钢板上的一声脆响，整块板“当”地响起来、很快收住。分音取挂着的方钢板的几阶模态，
// 每阶再拆成差几赫兹的一对，余音里有板子晃动的拍频。几块靶大小不一：预渲染的几份轮流取一个基频。
// 基频放在 1.3~1.7 kHz（二三十厘米的小靶板）：再低就落进自己枪声尾巴最厚的 1 kHz 一带，50 米外被盖住
const PLATES = [1350, 1460, 1580, 1700];
let plate = 0;
export function targetHit(b, o) {
  const p = o.pitch * rnd(0.99, 1.01), f = PLATES[plate++ % PLATES.length] * p;
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.9, tau: 0.0025, attack: 0.0003 });
  b.burst('white', { freq: 2600 * p, q: 1.5, peak: 1.4, tau: 0.006 });
  for (const [r, pk, tau] of [[1, 0.42, 0.14], [1.52, 0.2, 0.1], [2.37, 0.24, 0.11], [3.11, 0.08, 0.06], [4.3, 0.05, 0.04]]) {
    b.ping(f * r, { peak: pk, tau });
    b.ping(f * r * 1.0045, { peak: pk * 0.5, tau: tau * 1.2 });
  }
  b.ping(190 * p, { peak: 0.2, tau: 0.03, freqTo: 140 * p, sweep: 0.04 }); // 支架和挂链
}

// 钢靶倒下：挂钩松开“咔”一声，板子绕铰链往后倒，铰链吱一下，砸在底座的挡块上，再弹两下停住。
// 压在挡块上的板子响不起来，所以比中弹低沉、闷得多。起音后约 0.2 s 砸到底
export function targetDown(b, o) {
  const p = o.pitch * rnd(0.94, 1.06), fall = rnd(0.18, 0.23);
  tick(b, 0, { f: 2600 * p, peak: 0.25, tau: 0.005, ring: 0.05 });
  const saw = b.osc('sawtooth', 210 * p, { at: 0.02, dur: fall - 0.02 });
  b.env(saw.frequency, [[0.02, 210 * p], [fall, 340 * p]], true); // 越倒越快，铰链的吱声往上走
  const sg = b.gain(0);
  b.env(sg.gain, [[0.02, 0], [0.06, 0.05], [fall - 0.03, 0.03], [fall, 0]]);
  b.out(b.chain(saw, b.filter('bandpass', 1500 * p, 3), sg));
  b.burst('white', { type: 'highpass', freq: 2500, peak: 0.6, tau: 0.004, at: fall });
  b.burst('pink', { freq: 900 * p, q: 1, peak: 2.4, tau: 0.02, at: fall });
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.9, tau: 0.04, at: fall });
  b.partials(rnd(430, 520) * p, [1, 1.52, 2.37, 3.11], { peak: 0.3, tau: 0.09, at: fall, spread: 0.03 });
  let t = fall + rnd(0.07, 0.1), k = 0.45;
  for (let i = 0; i < 2; i++) {
    b.burst('pink', { freq: 1200 * p, q: 1.2, peak: 1.2 * k, tau: 0.012, at: t });
    b.partials(rnd(520, 640) * p, [1, 1.52, 2.37], { peak: 0.16 * k, tau: 0.05, at: t });
    t += rnd(0.04, 0.06);
    k *= 0.45;
  }
}
