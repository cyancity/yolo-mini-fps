// 移动音色：脚步、起跳、落地、滑铲，按地面材质分。每个函数拿到一个 Builder，往里搭节点。
import { rnd } from './synth.js';
import { clack } from './sounds_weapons.js';
import { grains, some } from './sounds_world.js';

// 各材质的响度先在这里配平，引擎表里只留一个总配平。地毯故意比别的轻，碎石故意比别的响。
// 沥青的水声拆出去以后（splashStep），干的那部分补到 1.6，晴天的沥青脚步不至于比湿的轻一大截
const STEP_LEVEL = { asphalt: 1.6, metal: 0.55, wood: 0.75, concrete: 1.7, carpet: 0.75, gravel: 1 };
const SLIDE_LEVEL = { metal: 0.8, wood: 0.8, concrete: 1, carpet: 0.8, gravel: 0.85 };

// 之后搭的节点都先过一级增益（配平用）。返回原来的出口，搭完要把 b.dest 还原回去
function trim(b, level) {
  const dest = b.dest;
  b.dest = b.gain(level);
  b.dest.connect(dest);
  return dest;
}

// 一把碎石：稀疏脉冲过带通，再过软限幅把个别特别大的颗粒压平。听起来是一把大小相近的石子在互相挤，
// 而不是几声孤零零的爆点；峰值也不会超过包络的 peak
function crunch(b, { freq, q = 1, peak = 1, tau = 0.03, at = 0, attack = 0.004, rate = 1, drive = 1.2, panTo = 0 }) {
  const g = b.gain(0);
  b.perc(g.gain, peak, tau, at, attack);
  b.out(b.chain(b.noise('crackle', { at, dur: attack + tau * 7, rate }), b.filter('bandpass', freq, q), b.gain(drive), b.shaper('soft'), g), 1, panTo);
}

// 脚步：脚跟先着地，脚掌随后；每一步的音高、间隔和颗粒都重新随机
export function footstep(b, o) {
  const p = o.pitch * rnd(0.88, 1.12);
  const toe = rnd(0.04, 0.075);
  const w = rnd(0.8, 1.1);
  const dest = trim(b, STEP_LEVEL[o.surface] || 1);
  if (o.surface === 'metal') {
    // 箱顶钢板：低频的“咚”加上板面不成倍数的共振
    b.burst('brown', { type: 'lowpass', freq: 300 * p, peak: 0.7 * w, tau: 0.03 });
    b.ping(92 * p, { peak: 0.35 * w, tau: 0.07, freqTo: 68 * p, sweep: 0.08 });
    b.partials(rnd(205, 290) * p, [1, 1.58, 2.31, 3.17, 4.4], { peak: 0.3 * w, tau: 0.11, spread: 0.04 });
    b.burst('pink', { freq: 1300 * p, q: 1, peak: 0.7 * w, tau: 0.012 });
    b.burst('white', { freq: 2600 * p, q: 1.5, peak: 0.9, tau: 0.012, at: toe });
    b.burst('white', { type: 'highpass', freq: 3500, peak: 0.15, tau: 0.003 });
    b.partials(rnd(420, 540) * p, [1, 1.71, 2.6], { peak: 0.08, tau: 0.06, at: toe });
  } else if (o.surface === 'wood') {
    // 木栈板：空腔的“笃”，偶尔吱一声
    b.burst('brown', { type: 'lowpass', freq: 380 * p, peak: 0.4 * w, tau: 0.025 });
    b.ping(rnd(150, 195) * p, { peak: 0.22 * w, tau: 0.035, freqTo: 118 * p, sweep: 0.05 });
    b.ping(rnd(330, 430) * p, { peak: 0.3, tau: 0.022 });
    b.burst('pink', { freq: 1100 * p, q: 2.5, peak: 4.5 * w, tau: 0.012 });
    b.burst('pink', { freq: 1500 * p, q: 2, peak: 1.6, tau: 0.01, at: toe });
    if (Math.random() < 0.3) {
      const f = rnd(620, 900);
      b.ping(f, { peak: 0.035, tau: 0.03, at: toe + 0.02, attack: 0.02, type: 'sawtooth', freqTo: f * rnd(1.1, 1.25), sweep: 0.08 });
    }
  } else if (o.surface === 'concrete') {
    // 干硬地面：短促的“嗒”，鞋底带一点砂粒
    b.burst('brown', { type: 'lowpass', freq: 260 * p, peak: 0.85 * w, tau: 0.022 });
    b.burst('pink', { freq: 900 * p, q: 1.2, peak: 1.2 * w, tau: 0.014 });
    b.burst('white', { type: 'highpass', freq: 3200, q: 0.7, peak: 0.1, tau: 0.008 });
    b.burst('white', { freq: 2400 * p, q: 1, peak: 0.3, tau: 0.02, at: toe, attack: 0.006 });
    grains(b, some(1, 2), { from: 0.01, to: toe + 0.03, fLo: 2200, fHi: 4200, q: 5, peak: 0.35, tau: 0.003 });
  } else if (o.surface === 'carpet') {
    // 办公室地毯：鞋底陷进绒面，硬的“嗒”全被吃掉，只剩楼板传上来的闷响和一点织物摩擦
    b.burst('brown', { type: 'lowpass', freq: 210 * p, q: 0, peak: 0.45 * w, tau: 0.028, attack: 0.004 });
    b.ping(84 * p, { peak: 0.1 * w, tau: 0.03, attack: 0.004, freqTo: 60 * p, sweep: 0.06 });
    b.burst('pink', { type: 'lowpass', freq: 640 * p, q: 0, peak: 1.7 * w, tau: 0.02, attack: 0.006 });
    b.burst('pink', { freq: 1150 * p, q: 0.7, peak: 0.55, tau: 0.03, at: toe, attack: 0.012 });
  } else if (o.surface === 'gravel') {
    // 屋面压顶的碎石：一脚下去石子互相挤着滚，一串又密又脆的“咔嚓”，比落脚本身还响
    b.burst('brown', { type: 'lowpass', freq: 220 * p, peak: 0.6 * w, tau: 0.03 });
    b.burst('pink', { freq: 1500 * p, q: 0.8, peak: 1.4 * w, tau: 0.018 });
    crunch(b, { freq: 2400 * p, q: 1.1, peak: 1.5 * w, tau: 0.032, rate: 0.7 });
    crunch(b, { freq: 3700 * p, q: 1.4, peak: 1.1, tau: 0.04, at: toe, attack: 0.012 });
    grains(b, some(3, 5), { from: 0.015, to: toe + 0.1, fLo: 1400, fHi: 3800, q: 6, peak: 0.9, tau: 0.004, fall: 0.5 }); // 被踢开的几粒
  } else {
    // 沥青：闷的落脚、砂砾，前掌在粗糙路面上搓一下。水膜被挤开的“啪嗒”是单独的 splashStep，路面湿时引擎叠上去
    b.burst('brown', { type: 'lowpass', freq: 240 * p, peak: 0.85 * w, tau: 0.028 });
    b.burst('pink', { freq: 700 * p, q: 1, peak: 1.6 * w, tau: 0.016 });
    b.burst('white', { freq: rnd(2600, 3600), q: 1.1, peak: 0.3, tau: 0.014, at: toe, attack: 0.004 });
    grains(b, some(2, 3), { from: 0.01, to: toe + 0.03, fLo: 1800, fHi: 3600, q: 5, peak: 0.4, tau: 0.004 });
  }
  b.dest = dest;
}

export function jump(b, o) {
  const p = o.pitch * rnd(0.93, 1.07);
  // 蹬地：鞋底搓地，装备跟着上提
  b.burst('pink', { freq: 600 * p, freqTo: 1500 * p, sweep: 0.09, q: 1, peak: 1.2, tau: 0.03, attack: 0.02 });
  b.burst('brown', { type: 'lowpass', freq: 220, peak: 0.5, tau: 0.03 });
  b.burst('white', { freq: 3000 * p, q: 0.8, peak: 0.25, tau: 0.04, at: 0.03, attack: 0.03 });
  clack(b, 0.05 + rnd(0, 0.03), { f: 2600 * p, peak: 0.05, tau: 0.004, ring: 0.01 });
}

// 落地时身体那一层的分量：钢板和木板上压低，让板子自己的共振露出来；地毯上闷响本来就是主体
const LAND_BODY = { metal: 0.5, wood: 0.5, carpet: 0.8 };

export function land(b, o) {
  const p = o.pitch * rnd(0.93, 1.05), s = o.surface, k = LAND_BODY[s] || 1;
  footstep(b, { ...o, pitch: p * 0.8 });
  b.burst('brown', { type: 'lowpass', freq: 200, peak: 0.9 * k, tau: 0.045 });
  b.ping(85 * p, { peak: 0.4 * k, tau: 0.06, freqTo: 48 * p, sweep: 0.09 });
  b.burst('pink', { freq: 1200 * p, q: 0.8, peak: s === 'carpet' ? 0.6 : 1.4, tau: 0.04, at: 0.02, attack: 0.02 });
  if (s === 'metal') {
    // 箱顶钢板被整个人砸下去：板面几阶低模态一起响，比一步长得多，底下是空箱体的轰
    b.partials(rnd(300, 380) * p, [1, 1.53, 2.21, 2.87], { peak: 0.35, tau: 0.22, spread: 0.04 });
    b.ping(rnd(120, 150) * p, { peak: 0.4, tau: 0.16, freqTo: 95 * p, sweep: 0.12 });
  } else if (s === 'wood') {
    // 栈板底下的空腔“笃”
    b.ping(rnd(180, 250) * p, { peak: 0.45, tau: 0.08, freqTo: 140 * p, sweep: 0.05 });
    b.burst('pink', { freq: 900 * p, q: 2.5, peak: 2.5, tau: 0.02, at: 0.004 });
  }
  // 身上装备晃了两下
  clack(b, 0.03 + rnd(0, 0.02), { f: 2400 * p, peak: 0.1, tau: 0.006, ring: 0.02 });
  clack(b, 0.09 + rnd(0, 0.03), { f: 1700 * p, peak: 0.08, tau: 0.006, ring: 0.02, thud: 0.05 });
}

// 一段摩擦声：带通噪声，中心频率随着减速往下滑，响度上叠一层不规则的抖动（一粘一滑）。
// to 给了节点就接过去（拿去激励共振），不给就直接出声
// drive 给了就在滤波后加一级软限幅（用稀疏脉冲当声源时把大颗粒压平，同 crunch）
export function scrape(b, kind, { from, end, q = 0.8, peak = 1, at = 0, dur = 0.8, rough = 0.4, hz = 40, type = 'bandpass', rate = 1, drive = 0, panTo = 0, to }) {
  const f = b.filter(type, from, q);
  b.env(f.frequency, [[at, from], [at + dur, end]], true);
  const am = b.gain(1 - rough);
  b.wobble(am.gain, hz, rough, { at, dur });
  const g = b.gain(0);
  b.env(g.gain, [[at, 0], [at + 0.05, peak], [at + dur * 0.5, peak * 0.6], [at + dur, 0]]);
  b.chain(b.noise(kind, { at, dur, rate }), f);
  b.chain(drive ? b.chain(f, b.gain(drive), b.shaper('soft')) : f, am, g);
  if (to) g.connect(to); else b.out(g, 1, panTo);
}

// 滑铲：身体先砸到地上一记闷响，接着衣料和装备贴着地面擦过去，越滑越慢、越擦越低，停住时装备晃一下
export function slide(b, o) {
  const p = o.pitch * rnd(0.94, 1.06), s = o.surface, dur = rnd(0.74, 0.84);
  const dest = trim(b, SLIDE_LEVEL[s] || 1);
  b.burst('brown', { type: 'lowpass', freq: 190, peak: s === 'carpet' ? 0.5 : 0.8, tau: 0.04 });
  b.ping(74 * p, { peak: 0.3, tau: 0.05, freqTo: 46 * p, sweep: 0.08 });
  scrape(b, 'pink', { from: 950 * p, end: 520 * p, q: 0.7, peak: 1.5, dur, rough: 0.35, hz: 30, panTo: -0.12 }); // 衣料，哪种地面都有
  if (s === 'metal') {
    // 箱顶钢板：摩擦一路激着板面的几个模态，底下是空箱体的轰响
    const plate = b.gain(1);
    scrape(b, 'white', { from: 1700 * p, end: 800 * p, q: 0.6, peak: 1, dur, rough: 0.5, hz: 55, to: plate });
    b.out(plate, 0.45, 0.12);
    const base = rnd(250, 330) * p;
    for (const [k, q, level] of [[1, 30, 5], [1.58, 40, 4.5], [2.31, 50, 4], [3.17, 60, 3]]) b.out(b.chain(plate, b.filter('bandpass', base * k, q)), level);
    b.ping(88 * p, { peak: 0.4, tau: 0.09, freqTo: 64 * p, sweep: 0.1 });
  } else if (s === 'wood') {
    // 木栈板：声音发空，每擦过一道板缝“咯噔”一下，间隔随着减速拉开
    scrape(b, 'pink', { from: 1300 * p, end: 650 * p, q: 1.2, peak: 2.2, dur, rough: 0.45, hz: 34, panTo: 0.12 });
    let t = rnd(0.07, 0.12), gap = rnd(0.085, 0.11);
    while (t < dur - 0.08) {
      const k = 1 - t / dur;
      b.ping(rnd(150, 200) * p, { peak: 0.22 * k, tau: 0.03, at: t, freqTo: 120 * p, sweep: 0.04 });
      b.burst('pink', { freq: 1100 * p, q: 2.5, peak: 2.2 * k, tau: 0.01, at: t });
      t += gap;
      gap *= 1.3;
    }
  } else if (s === 'concrete') {
    // 干硬地面：沙沙的干擦，夹几粒被带起来的砂子
    scrape(b, 'white', { from: 2300 * p, end: 1300 * p, q: 0.8, peak: 0.9, dur, rough: 0.4, hz: 45, panTo: 0.12 });
    grains(b, some(4, 6), { from: 0.05, to: dur, fLo: 2200, fHi: 4500, q: 5, peak: 0.3, tau: 0.003, fall: 0.6 });
  } else if (s === 'carpet') {
    // 地毯：只有织物搓织物，又闷又短，一粒硬的东西都没有
    scrape(b, 'pink', { type: 'lowpass', from: 1400 * p, end: 600 * p, q: 0, peak: 1.3, dur: dur * 0.85, rough: 0.25, hz: 22, panTo: 0.12 });
    scrape(b, 'pink', { from: 1900 * p, end: 1200 * p, q: 1.4, peak: 0.5, dur: dur * 0.6, rough: 0.5, hz: 70 }); // 绒面被搓起来的“嗞”
  } else if (s === 'gravel') {
    // 碎石：身体把一路的石子犁开，密密的“哗啦”盖过衣料，停下来以后还有几粒在滚
    scrape(b, 'crackle', { from: 2600 * p, end: 1700 * p, q: 0.7, peak: 1.1, dur, rough: 0.3, hz: 30, drive: 1.2, panTo: 0.15 });
    scrape(b, 'crackle', { from: 4000 * p, end: 2900 * p, q: 1.2, peak: 0.7, dur: dur * 0.8, rough: 0.45, hz: 50, rate: 1.3, drive: 1.2 }); // 小石子尖的那一层
    scrape(b, 'crackle', { from: 900 * p, end: 600 * p, q: 0.9, peak: 0.45, dur, rough: 0.3, hz: 24, rate: 0.5, drive: 2, panTo: -0.15 });
    b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.4, tau: 0.12, attack: 0.05 });
    grains(b, some(4, 7), { from: dur * 0.5, to: dur + 0.12, fLo: 1500, fHi: 4000, q: 6, peak: 0.7, tau: 0.004, fall: 0.5, pan: 0.5 });
  } else {
    // 沥青：粗砂纸一样的摩擦。贴地的水膜被推开的声音是单独的 splashSlide，路面湿时引擎叠上去
    scrape(b, 'white', { from: 2600 * p, end: 1500 * p, q: 0.7, peak: 0.8, dur, rough: 0.4, hz: 42, panTo: 0.12 });
    grains(b, some(3, 5), { from: 0.05, to: dur, fLo: 1800, fHi: 3600, q: 5, peak: 0.3, tau: 0.004, fall: 0.6 });
  }
  clack(b, rnd(0.05, 0.11), { f: 2500 * p, peak: 0.07, tau: 0.005, ring: 0.015 });
  clack(b, dur - rnd(0.02, 0.12), { f: 1800 * p, peak: 0.09, tau: 0.006, ring: 0.02, thud: 0.05 });
  b.dest = dest;
}
