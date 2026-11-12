// 拟音：换弹和检视的手上动作、装具声、弹匣落地，以及玩家阵亡、回血、界面悬停这几个玩法事件的音色。
import { rnd } from './synth.js';
import { clack } from './sounds_weapons.js';
import { grains, some } from './sounds_world.js';

// 一段衣料摩擦：带通粉噪，中心频率从 f 滑到 to，响度带不规则抖动
function rustle(b, at, dur, { f = 1100, to = f, q = 0.9, peak = 1, rough = 0.4 } = {}) {
  const bp = b.filter('bandpass', f, q);
  b.env(bp.frequency, [[at, f], [at + dur, to]], true);
  const am = b.gain(1 - rough);
  b.wobble(am.gain, 35, rough, { at, dur });
  const g = b.gain(0);
  b.env(g.gain, [[at, 0], [at + dur * 0.3, peak], [at + dur, 0]]);
  b.out(b.chain(b.noise('pink', { at, dur }), bp, am, g));
}

// 手去摸弹匣：手套擦过枪身和弹匣包，扣件轻磕一下
export function reloadGrab(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  rustle(b, 0, 0.16, { f: 1100 * p, to: 1500 * p });
  b.burst('brown', { type: 'lowpass', freq: 380, peak: 0.35, tau: 0.02, at: 0.02 });
  clack(b, rnd(0.04, 0.08), { f: 2900 * p, peak: 0.08, tau: 0.004, ring: 0.015 });
}

// 按下弹匣卡笋：很短的一下“嗒”
export function magRelease(b, o) {
  const p = o.pitch * rnd(0.96, 1.04);
  clack(b, 0, { f: 3400 * p, peak: 0.22, tau: 0.003, ring: 0.02 });
  b.ping(1800 * p, { peak: 0.05, tau: 0.01 });
}

// 新弹匣的匣口碰到弹匣井口：一小段刮擦，接着一下轻磕
export function magSeat(b, o) {
  const p = o.pitch * rnd(0.95, 1.05);
  b.burst('white', { freq: 2200 * p, freqTo: 1600 * p, sweep: 0.05, q: 2, peak: 0.5, tau: 0.02, attack: 0.008 });
  clack(b, 0.035, { f: 1600 * p, peak: 0.16, tau: 0.008, ring: 0.03, thud: 0.06 });
}

// 换完弹枪回到肩上：衣料一蹭、枪托顶到肩窝的闷响，背带扣晃两下
export function reloadSettle(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  rustle(b, 0, 0.2, { f: 900 * p, to: 700 * p, peak: 1.1 });
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.6, tau: 0.03, at: 0.08 });
  clack(b, 0.1 + rnd(0, 0.03), { f: 3000 * p, peak: 0.1, tau: 0.004, ring: 0.02 });
  clack(b, 0.17 + rnd(0, 0.04), { f: 2300 * p, peak: 0.07, tau: 0.005, ring: 0.015 });
}

// 空弹匣掉在地上：聚合物壳体发空的“咚”，先是一角着地，随后整个拍平；供弹口的钢唇磕出一点金属声。
// 落在什么地面上不一样：钢板带板面的共振，木板发空，碎石沙沙响，地毯上只有一下闷的
export function magDrop(b, o) {
  const p = o.pitch * rnd(0.92, 1.08), s = o.surface, gap = rnd(0.03, 0.06);
  b.ping(rnd(380, 460) * p, { peak: 0.3, tau: 0.03, freqTo: 300 * p, sweep: 0.04 });
  if (s === 'carpet') {
    b.burst('brown', { type: 'lowpass', freq: 400, peak: 0.6, tau: 0.03 });
    b.burst('pink', { freq: 800 * p, q: 0.8, peak: 0.8, tau: 0.015 });
    return;
  }
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.3, tau: 0.003 });
  b.burst('pink', { freq: 1500 * p, q: 1.2, peak: 1.5, tau: 0.012 });
  clack(b, 0, { f: 2400 * p, peak: 0.12, tau: 0.005, ring: 0.03 });
  b.burst('pink', { freq: 1200 * p, q: 1, peak: 0.9, tau: 0.01, at: gap });
  b.ping(400 * p, { peak: 0.15, tau: 0.025, at: gap });
  if (s === 'metal') b.partials(rnd(250, 330) * p, [1, 1.58, 2.31], { peak: 0.12, tau: 0.12, spread: 0.04 });
  else if (s === 'wood') b.ping(rnd(170, 220) * p, { peak: 0.2, tau: 0.05, freqTo: 140 * p, sweep: 0.04 });
  else grains(b, s === 'gravel' ? some(4, 6) : some(1, 2), { from: 0.005, to: gap + 0.05, fLo: 2000, fHi: 4200, q: 5, peak: s === 'gravel' ? 0.5 : 0.25, tau: 0.004 });
}

// 检视：枪身翻到一边，衣料和背带一阵摩擦
export function inspectCloth(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  rustle(b, 0, 0.38, { f: 800 * p, to: 1300 * p, peak: 0.9, rough: 0.5 });
  clack(b, rnd(0.12, 0.2), { f: 2700 * p, peak: 0.06, tau: 0.004, ring: 0.015 });
}

// 检视：手指在导轨上轻敲两下
export function inspectTap(b, o) {
  const p = o.pitch * rnd(0.95, 1.05), gap = rnd(0.09, 0.14);
  clack(b, 0, { f: 2600 * p, peak: 0.12, tau: 0.004, ring: 0.04 });
  clack(b, gap, { f: 2800 * p, peak: 0.08, tau: 0.004, ring: 0.03 });
  b.burst('brown', { type: 'lowpass', freq: 500, peak: 0.12, tau: 0.01 });
}

// 下蹲、探头、滑铲起身：衣料一蹭，装具扣件磕一下
export function gear(b, o) {
  const p = o.pitch * rnd(0.92, 1.08), dur = rnd(0.12, 0.2);
  rustle(b, 0, dur, { f: 1000 * p, to: 1400 * p, peak: 0.9 });
  b.burst('brown', { type: 'lowpass', freq: 320, peak: 0.25, tau: 0.02, at: dur * 0.4 });
  clack(b, rnd(0.03, dur), { f: rnd(2400, 3200) * p, peak: 0.07, tau: 0.004, ring: 0.02 });
  if (Math.random() < 0.5) clack(b, rnd(0.05, dur + 0.04), { f: rnd(2000, 2800) * p, peak: 0.04, tau: 0.004, ring: 0.01 });
}

// 玩家阵亡：身体砸在地上的低频闷击，随后一阵慢慢消下去的耳鸣。走界面总线，不被阵亡时的闷响压掉
export function playerDeath(b, o) {
  const p = o.pitch;
  b.ping(70 * p, { peak: 0.9, tau: 0.12, attack: 0.004, freqTo: 38 * p, sweep: 0.2 });
  b.burst('brown', { type: 'lowpass', freq: 180, peak: 1.0, tau: 0.08, attack: 0.004 });
  b.burst('pink', { type: 'lowpass', freq: 700, peak: 0.6, tau: 0.04 });
  const f = rnd(3400, 3900);
  const g = b.gain(0);
  b.env(g.gain, [[0.05, 0], [0.35, 0.06], [1.2, 0.035], [2.3, 0]]);
  b.out(b.chain(b.osc('sine', f, { at: 0.05, dur: 2.3 }), g));
  b.ping(f * 1.49, { peak: 0.012, tau: 0.25, at: 0.1, attack: 0.2 });
}

// 脱战回血：长长呼出一口气。两条带通当口腔的共振，没有声带的成分
export function regenBreath(b, o) {
  const p = o.pitch * rnd(0.95, 1.05), dur = rnd(0.7, 0.85);
  const g = b.gain(0);
  b.env(g.gain, [[0, 0], [0.09, 1], [dur * 0.45, 0.6], [dur, 0]]);
  const n = b.chain(b.noise('pink', { dur }), g);
  for (const [f, q, level] of [[650, 2.2, 1.4], [1500, 2.5, 0.8], [3200, 1.5, 0.25]]) {
    const bp = b.filter('bandpass', f * p, q);
    b.env(bp.frequency, [[0, f * p], [dur, f * p * 0.85]], true);
    b.out(b.chain(n, bp), level);
  }
}

// 界面悬停：比点击更轻、更短的一下
export function uiHover(b, o) {
  b.burst('white', { type: 'highpass', freq: 4000, peak: 0.1, tau: 0.001 });
  b.ping(2600 * o.pitch, { peak: 0.12, tau: 0.004 });
}
