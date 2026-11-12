// 人形敌人的音色：开火、脚步、中弹、倒地、电台。都只会被空间化播放，所以不做左右声像。
import { rnd } from './synth.js';
import { clack, magOut, magIn } from './sounds_weapons.js';
import { footstep } from './sounds_move.js';

// 敌人的卡宾枪，从场地另一头传过来：比无人机的电磁枪低沉、厚重。近处才有的爆裂只留一点，
// 分量放在膛口的低频冲击和它在箱墙之间来回滚的尾巴上，隔着距离也认得出是火药枪
export function npcShot(b, o) {
  const p = o.pitch * rnd(0.94, 1.06);
  const tap = b.gain(1); // 爆裂、冲击和枪身先汇到这里，再分几路延时当回声

  b.burst('white', { type: 'highpass', freq: 1700 * p, q: 0.6, peak: 1.1, tau: 0.005, attack: 0.0004, to: tap });
  b.burst('pink', { freq: 620 * p, q: 0.8, peak: 6.5 * rnd(0.9, 1.1), tau: 0.036, to: tap });

  const n = b.noise('pink', { dur: 0.45 });
  const lp = b.filter('lowpass', 4200 * p, 0.8);
  b.env(lp.frequency, [[0, 4200 * p], [0.05, 1500 * p], [0.25, 380 * p]], true);
  const body = b.gain(0);
  b.perc(body.gain, rnd(0.9, 1.1), 0.06, 0, 0.001);
  b.chain(n, b.gain(5), b.shaper('hard'), lp, b.filter('highpass', 150, 0.7), body, tap);

  const sub = b.osc('sine', 128 * p, { dur: 0.45 });
  b.env(sub.frequency, [[0, 128 * p], [0.045, 74 * p], [0.2, 40 * p]], true);
  const subG = b.gain(0);
  b.perc(subG.gain, 1, 0.06, 0, 0.002);
  b.out(b.chain(sub, subG, b.shaper('soft')), 0.9);

  b.out(tap);
  // 箱墙和仓库立面弹回来的几下：一下比一下晚，也一下比一下闷
  for (const [time, level, cut] of [[0.094, 0.36, 1700], [0.201, 0.24, 1150], [0.337, 0.14, 800]]) {
    b.out(b.chain(tap, b.delay(time * rnd(0.88, 1.14)), b.filter('lowpass', cut, 0.7)), level);
  }
  // 滚动的远场尾巴，比玩家自己那支枪的更长、更显
  const tn = b.noise('pink', { at: 0.012, dur: 1.4 });
  const tl = b.filter('lowpass', 3000, 0.7);
  b.env(tl.frequency, [[0.012, 3000], [0.4, 1000], [1.4, 300]], true);
  const tg = b.gain(0);
  b.env(tg.gain, [[0.012, 0.0001], [0.04, 2.4], [0.16, 1.3], [0.6, 0.3], [1.4, 0.001]], true);
  b.out(b.chain(tn, b.filter('bandpass', 700 * rnd(0.85, 1.15), 0.45), b.filter('highpass', 160, 0.7), tl, tg));
}

// 碎石的“咔嚓”大多在 2~4 kHz，单独压一点，敌人的脚步才在哪种地面上都比玩家的轻。
// 钢板不用补：低通放到 5.5 kHz 以后，8 米外钢板的 A 计权已经比混凝土高 1~2 dB（dev 的 npcStepTest）
const NPC_STEP_LEVEL = { gravel: 0.9 };

// 敌人的脚步：和玩家同一套材质，但是军靴，更沉。低通放在 5.5 kHz，留住 2~4 kHz 鞋底的颗粒，
// 隔着十几米还能听出是哪种地面；每步再带一下身上装具的磕碰
export function npcStep(b, o) {
  const dest = b.dest;
  b.dest = b.filter('lowpass', 5500, 0);
  b.chain(b.dest, b.gain(NPC_STEP_LEVEL[o.surface] || 1), dest);
  footstep(b, { ...o, pitch: o.pitch * 0.84 });
  b.burst('brown', { type: 'lowpass', freq: 170, peak: o.surface === 'carpet' ? 0.25 : 0.5, tau: 0.03 }); // 靴跟的分量
  clack(b, rnd(0.02, 0.08), { f: rnd(2000, 2600), peak: 0.06, tau: 0.005, ring: 0.015 });
  b.dest = dest;
}

// 敌人换弹：抽出弹匣、插上新弹匣，比玩家自己的低一点、钝一点（隔着几米听到的）。两下分开放，由敌人的换弹逻辑排时间
export function npcMagOut(b, o) {
  magOut(b, { ...o, pitch: o.pitch * rnd(0.82, 0.9) });
  b.burst('brown', { type: 'lowpass', freq: 300, peak: 0.25, tau: 0.02, at: 0.11 });
}

export function npcMagIn(b, o) {
  magIn(b, { ...o, pitch: o.pitch * rnd(0.82, 0.9) });
}

// 敌人中弹的反应：打在身上的一记闷响，紧跟一口被挤出来的气。只用滤过的噪声：
// 三个共振峰往下滑，响度按喉音的节奏抖动，听着像一声闷哼，但没有任何语音成分
export function npcHurt(b, o) {
  const p = o.pitch * rnd(0.9, 1.12);
  b.burst('brown', { type: 'lowpass', freq: 320, peak: 0.7, tau: 0.03 });
  b.burst('pink', { freq: 1000 * p, q: 1, peak: 1.6, tau: 0.014 });
  const at = rnd(0.025, 0.045), dur = rnd(0.17, 0.24);
  const n = b.noise('pink', { at, dur });
  const am = b.gain(0.55);
  const lfo = b.mod(am.gain, 118 * p, 0.45, { type: 'sawtooth', at, dur });
  b.env(lfo.frequency, [[at, 118 * p], [at + dur, 78 * p]], true);
  const g = b.gain(0);
  b.env(g.gain, [[at, 0], [at + 0.02, 1], [at + dur * 0.45, 0.7], [at + dur, 0]]);
  b.chain(n, am, g);
  for (const [f, q, level, drop] of [[620, 4, 3.2, 0.72], [1150, 5, 1.6, 0.8], [2500, 5, 0.5, 0.9]]) {
    const bp = b.filter('bandpass', f * p, q);
    b.env(bp.frequency, [[at, f * p], [at + dur, f * p * drop]], true);
    b.out(b.chain(g, bp), level);
  }
  b.burst('white', { type: 'highpass', freq: 3800, q: 0.7, peak: 0.08, tau: 0.03, at, attack: 0.02 }); // 气流擦过牙缝的一点嘶声
}

// 敌人倒地：膝盖先着地，身体随后砸下来，枪和身上的装备跟着摔在地上
export function npcDeath(b, o) {
  const p = o.pitch * rnd(0.92, 1.08);
  const fall = rnd(0.24, 0.34);
  b.burst('brown', { type: 'lowpass', freq: 230, peak: 0.6, tau: 0.03 });
  b.burst('pink', { freq: 800 * p, q: 0.9, peak: 0.9, tau: 0.02 });
  b.burst('pink', { freq: 1100 * p, freqTo: 600 * p, sweep: fall, q: 0.7, peak: 0.6, tau: 0.07, at: 0.03, attack: 0.08 }); // 倒下去那一段的衣料声
  b.burst('brown', { type: 'lowpass', freq: 170, peak: 1.1, tau: 0.055, at: fall });
  b.ping(72 * p, { peak: 0.45, tau: 0.06, at: fall, freqTo: 44 * p, sweep: 0.09 });
  b.burst('pink', { freq: 700 * p, q: 0.8, peak: 1.5, tau: 0.03, at: fall, attack: 0.004 });
  // 枪摔在地上弹了两下，背具上的扣件哗啦一声
  let t = fall + rnd(0.03, 0.09), level = 1;
  for (let i = 0; i < 3; i++) {
    clack(b, t, { f: rnd(1300, 2100) * p, peak: 0.3 * level, tau: 0.012, ring: 0.07 * level, thud: 0.18 * level });
    t += rnd(0.09, 0.15) * Math.pow(0.6, i);
    level *= 0.5;
  }
  b.burst('crackle', { freq: 3400 * p, q: 3, peak: 1.2, tau: 0.05, at: fall + 0.01, attack: 0.01 });
}

// 子弹打在人身上：先穿过织物，再被防弹插板挡住。又短又闷的一声“噗”，没有金属的余响
export function bodyHit(b, o) {
  const p = o.pitch * rnd(0.88, 1.14);
  b.burst('brown', { type: 'lowpass', freq: 420 * p, peak: 0.9, tau: 0.022 });
  b.ping(170 * p, { peak: 0.4, tau: 0.028, freqTo: 95 * p, sweep: 0.045 });
  b.burst('pink', { freq: 1250 * p, q: 1.1, peak: 3.2, tau: 0.011 }); // 织物被拍了一下
  b.partials(rnd(640, 880) * p, [1, 1.87, 2.9], { peak: 0.2, tau: 0.016, spread: 0.05 }); // 插板的“笃”
  b.burst('white', { freq: 2800 * p, q: 1, peak: 0.35, tau: 0.02, at: 0.006, attack: 0.008 }); // 崩起来的纤维和尘
  b.burst('white', { type: 'highpass', freq: 3000, peak: 0.3, tau: 0.0025 });
}

// 敌人发现玩家：电台按下通话键的一小段。静噪打开的“嚓”，两声下行的提示音，松键时再“嗤”一下。
// 全压在对讲机喇叭的窄频带里，和无人机那三声上行的合成音分得开
export function npcAlert(b, o) {
  const p = o.pitch * rnd(0.96, 1.04);
  const radio = b.filter('highpass', 520, 0.7);
  b.out(b.chain(radio, b.filter('lowpass', 3100, 2), b.filter('peaking', 1700, 1.2, 6)));
  for (const [at, dur, peak] of [[0, 0.07, 0.5], [0.27, 0.085, 0.65]]) {
    // 过载的噪声压成近乎方波，才有电台底噪那种发硬的沙沙声
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.003, peak], [at + dur * 0.6, peak * 0.7], [at + dur, 0]]);
    b.chain(b.noise('white', { at, dur: dur + 0.02 }), b.gain(4), b.shaper('hard'), g, radio);
  }
  for (const [at, f] of [[0.075, 1480], [0.165, 1110]]) {
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.004, 0.3], [at + 0.07, 0.26], [at + 0.085, 0]]);
    b.chain(b.osc('square', f * p, { at, dur: 0.1 }), g, radio);
  }
}
