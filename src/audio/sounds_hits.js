// 补齐材质映射的弹着和撞击音色：地毯、碎石、刀砍硬面和软面、无人机残骸、钢靶复位，
// 以及湿沥青上单独叠的水声层（splash*，由引擎按地面湿度叠到沥青的脚步、落地、滑铲、弹着和弹壳上）。
import { rnd } from './synth.js';
import { clack } from './sounds_weapons.js';
import { grains, droplets, some } from './sounds_world.js';
import { scrape } from './sounds_move.js';

// 子弹打在地毯上：楼板被闷闷地顶了一下，绒面纤维和底下的灰崩起来，没有碎屑也没有余响
export function impactSoft(b, o) {
  const p = o.pitch * rnd(0.88, 1.14);
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.15, tau: 0.002 });
  b.burst('brown', { type: 'lowpass', freq: 350, peak: 1.0, tau: 0.025 });
  b.ping(150 * p, { peak: 0.3, tau: 0.025, freqTo: 90 * p, sweep: 0.04 });
  b.burst('pink', { type: 'lowpass', freq: 900 * p, q: 0, peak: 2.0, tau: 0.014 });
  b.burst('pink', { freq: 1800 * p, q: 0.8, peak: 0.6, tau: 0.03, at: 0.006, attack: 0.01 });
}

// 子弹打进屋面碎石：一声脆响，一把石子被崩开，随后零零星星落回来
export function impactGravel(b, o) {
  const p = o.pitch * rnd(0.88, 1.14);
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.6, tau: 0.003, attack: 0.0004 });
  b.burst('pink', { freq: 1400 * p, q: 0.9, peak: 1.8, tau: 0.018 });
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.7, tau: 0.025 });
  const g = b.gain(0);
  b.perc(g.gain, 1.6, 0.04, 0.004, 0.004);
  b.out(b.chain(b.noise('crackle', { at: 0.004, dur: 0.3, rate: 0.8 }), b.filter('bandpass', 3000 * p, 1.2), b.gain(1.2), b.shaper('soft'), g));
  grains(b, some(6, 9), { from: 0.04, to: 0.35, fLo: 1600, fHi: 4200, q: 6, peak: 0.5, tau: 0.004, fall: 0.6 });
}

// 刀尖砍在混凝土、沥青、碎石这类硬面上：一声又短又尖的“咔”，刀身一点点高频余振，崩下几粒碎屑
export function knifeHitHard(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  b.burst('white', { type: 'highpass', freq: 3500, peak: 0.7, tau: 0.0025, attack: 0.0003 });
  b.burst('white', { freq: 3800 * p, q: 2, peak: 1.2, tau: 0.006 });
  b.burst('pink', { freq: 1200 * p, q: 1, peak: 1.0, tau: 0.01 });
  b.partials(rnd(4800, 5600) * p, [1, 1.41, 2.03], { peak: 0.06, tau: 0.06 });
  grains(b, some(3, 5), { from: 0.008, to: 0.09, fLo: 2000, fHi: 5000, q: 4, peak: 0.35, tau: 0.004, fall: 0.7 });
}

// 刀砍在木头和地毯上：发闷的一声“笃”，刃口吃进去，没有金属的响
export function knifeHitDull(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.2, tau: 0.002 });
  b.burst('brown', { type: 'lowpass', freq: 450, peak: 0.7, tau: 0.02 });
  b.ping(rnd(220, 300) * p, { peak: 0.3, tau: 0.025, freqTo: 160 * p, sweep: 0.04 });
  b.burst('pink', { freq: 1100 * p, q: 1.6, peak: 2.2, tau: 0.012 });
}

// 击落的无人机砸到地上：塑料机壳和电机的一记重响，铝臂嗡一下，再散落几块碎件
export function droneCrash(b, o) {
  const p = o.pitch * rnd(0.9, 1.1);
  b.burst('white', { type: 'highpass', freq: 2800, peak: 0.6, tau: 0.004, attack: 0.0004 });
  b.burst('brown', { type: 'lowpass', freq: 260, peak: 1.0, tau: 0.05 });
  b.ping(rnd(110, 140) * p, { peak: 0.5, tau: 0.06, freqTo: 70 * p, sweep: 0.08 });
  b.burst('pink', { freq: 900 * p, q: 0.9, peak: 2.5, tau: 0.025 });
  b.partials(rnd(380, 520) * p, [1, 1.47, 2.09, 2.56, 3.39], { peak: 0.18, tau: 0.1, spread: 0.05 });
  for (let i = 0, k = 1; i < 4; i++, k *= 0.7) {
    const at = rnd(0.08, 0.6);
    b.partials(rnd(1200, 2600) * p, [1, 1.52, 2.37], { peak: 0.05 * k, tau: 0.04, at });
    b.burst('pink', { freq: rnd(1500, 3000), q: 2, peak: 0.4 * k, tau: 0.006, at });
  }
}

// 钢靶复位：棘轮几下“咔咔”，电机把板子拉起来的一小段呜声，最后板子顶到限位“当”地一下
export function targetReset(b, o) {
  const p = o.pitch * rnd(0.95, 1.05), top = rnd(0.3, 0.36);
  for (let i = 0; i < 4; i++) clack(b, 0.02 + i * 0.045, { f: 2200 * p, peak: 0.08, tau: 0.003, ring: 0.01 });
  const saw = b.osc('sawtooth', 180 * p, { at: 0.02, dur: top - 0.02 });
  b.env(saw.frequency, [[0.02, 180 * p], [top, 260 * p]], true);
  const sg = b.gain(0);
  b.env(sg.gain, [[0.02, 0], [0.06, 0.04], [top - 0.02, 0.03], [top, 0]]);
  b.out(b.chain(saw, b.filter('bandpass', 1200 * p, 3), sg));
  b.burst('pink', { freq: 1000 * p, q: 1, peak: 1.6, tau: 0.018, at: top });
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.5, tau: 0.03, at: top });
  b.partials(rnd(900, 1100) * p, [1, 1.52, 2.37, 3.11], { peak: 0.12, tau: 0.08, at: top, spread: 0.03 });
}

// 黄铜弹壳落在地毯上：两下又闷又短的“嗒”，没有金属余响
export function shellSoft(b, o) {
  const p = o.pitch * rnd(0.9, 1.1);
  b.burst('pink', { freq: 1600 * p, q: 1.2, peak: 0.5, tau: 0.006 });
  b.ping(rnd(2800, 3400) * p, { peak: 0.03, tau: 0.01 });
  b.burst('pink', { freq: 1400 * p, q: 1.2, peak: 0.2, tau: 0.005, at: rnd(0.05, 0.08) });
}

// ---------- 湿沥青的水声层：引擎按 setWet 的湿度叠上去，晴天就没有 ----------

// 脚下的水膜被挤开的“啪嗒”，再溅起一两滴
export function splashStep(b) {
  b.burst('white', { freq: rnd(2800, 4200), q: 0.9, peak: 0.55, tau: 0.03, at: 0.004, attack: 0.008 });
  b.burst('white', { type: 'highpass', freq: 5500, peak: 0.1, tau: 0.045, at: rnd(0.04, 0.075), attack: 0.01 });
  droplets(b, some(1, 2), 0.03, 0.13, 0.05);
}

// 子弹把积水崩起来
export function splashHit(b) {
  b.burst('white', { type: 'highpass', freq: 4200, q: 0.7, peak: 0.22, tau: 0.05, at: 0.006, attack: 0.012 });
  droplets(b, 2, 0.05, 0.18, 0.05);
}

// 滑铲推开贴地的水膜，带起一点水
export function splashSlide(b) {
  const dur = rnd(0.6, 0.7);
  scrape(b, 'white', { type: 'highpass', from: 5200, end: 4200, q: 0, peak: 0.16, dur, rough: 0.2, hz: 18 });
  droplets(b, some(2, 3), 0.1, dur + 0.1, 0.05);
}

// 弹壳落在湿地上的一点水声
export function splashShell(b) {
  b.burst('white', { freq: 4200, q: 0.8, peak: 0.05, tau: 0.02, at: 0.004 });
  b.burst('white', { freq: 4200, q: 0.8, peak: 0.02, tau: 0.02, at: rnd(0.09, 0.14) });
}
