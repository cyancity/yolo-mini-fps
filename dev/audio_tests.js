// 总线、室内外、咔哒声和预渲染计时这几项整体测试
import { AudioEngine, renderOffline } from '../src/audio/audio.js';
import { bake } from '../src/audio/bake.js';
import { SOUNDS } from '../src/audio/table.js';
import { engine, firefight } from './audio_common.js';
import { analyze, bands, decay, fill, echoDensity, curvature, onset, r3, BAND_HZ } from './audio_dsp.js';

// 主总线会不会削波：连发、三个敌人开火和爆炸叠在一起，室外和室内各渲染一遍。
// out 是过完总线的结果（峰值不到 1 就没有削波），pre 是没过压缩和限幅的原始叠加，看限幅器被推得多狠
export async function mixTest() {
  await engine.baked;
  const out = {};
  for (const near of [false, true]) {
    for (const indoor of [0, 1]) {
      const build = (a) => firefight(a, near);
      const buf = await renderOffline(build, { seconds: 4, bank: engine.bank, indoor });
      const pre = analyze(await renderOffline(build, { seconds: 4, bank: engine.bank, indoor, raw: true }));
      const r = analyze(buf);
      let hot = 0;
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > 0.9 || Math.abs(R[i]) > 0.9) hot++;
      out[`${near ? '贴身' : '常规距离'} · 室内 ${indoor}`] = {
        peak: r3(r.peak), loud: r3(r.loud), rms: r3(r.rms), over09: `${((hot / L.length) * 100).toFixed(3)}%`, prePeak: r3(pre.peak), preLoud: r3(pre.loud),
      };
    }
  }
  return out;
}

// 一个采样宽的脉冲直接打进混响发送，量到的就是当前室内程度下混响的脉冲响应
function impulseInto(a) {
  const ctx = a.ctx, buf = ctx.createBuffer(1, 8, ctx.sampleRate), src = ctx.createBufferSource();
  buf.getChannelData(0)[0] = 1;
  src.buffer = buf;
  src.connect(a.bus.reverb);
  src.start(ctx.currentTime);
}

// 室内程度 0 / 0.5 / 1 各渲染一遍：环境声底、混响的脉冲响应、一发步枪和一发敌人的枪，频谱按倍频程给 dB
export async function indoorTest() {
  await engine.baked;
  const out = { 倍频程中心频率: BAND_HZ };
  for (const indoor of [0, 0.5, 1]) {
    const bed = await renderOffline(() => {}, { seconds: 10, ambient: true, indoor, lead: 2 });
    const ir = await renderOffline(impulseInto, { seconds: 2.5, raw: true, indoor });
    const shot = await renderOffline((a) => a.play('rifleShot'), { seconds: 3, bank: engine.bank, indoor });
    const foe = await renderOffline((a) => a.play('npcShot', { position: { x: 12, y: 1.6, z: -16 } }), { seconds: 3, bank: engine.bank, indoor });
    const A = analyze(bed), S = analyze(shot), F = analyze(foe);
    out[`室内 ${indoor}`] = {
      环境声底: { rms: +A.rms.toFixed(4), 重心Hz: Math.round(A.centroid), 频谱dB: bands(bed, 2.5) },
      混响脉冲响应: { ...decay(ir, 0.5), 前100ms填充率: fill(ir, 0.5), 回声密度: echoDensity(ir, 0.5), 频谱dB: bands(ir, 0.5) },
      步枪: { peak: r3(S.peak), loud: r3(S.loud), 重心Hz: Math.round(S.centroid), ...decay(shot, 0.5), 频谱dB: bands(shot, 0.5), 起音80ms后频谱dB: bands(shot, onset(shot, 0.5) / shot.sampleRate + 0.08) },
      敌人开火20米: { peak: r3(F.peak), loud: r3(F.loud), 重心Hz: Math.round(F.centroid), ...decay(foe, 0.5), 频谱dB: bands(foe, 0.5) },
    };
  }
  return out;
}

// 切换有没有咔哒声：往一条总线送一个稳定的正弦，等混响的起振过去以后按各种节奏改室内程度
// （突变、10 毫秒内来回、像游戏里那样每帧渐变）。输出如果有跳变，二阶差分会冒尖；
// 干净的话它不超过同幅度正弦本身的曲率，比值在 1 上下
export async function clickTest() {
  const steps = [[2.5, 1], [2.55, 0], [2.56, 1], [2.57, 0.3], [4, 0], [4.02, 0.5], [4.9, 1]];
  for (let i = 0; i <= 40; i++) steps.push([5.7 + i * 0.016, 1 - i / 40]); // 每帧调一次，0.64 秒从 1 渐变到 0
  const run = (pick, hz, level) => renderOffline((a) => {
    const o = a.ctx.createOscillator(), g = a.ctx.createGain();
    o.frequency.value = hz;
    g.gain.value = level;
    o.connect(g).connect(pick(a));
    o.start();
    for (const [t, v] of steps) a.ctx.suspend(t).then(() => { a.setIndoor(v); a.ctx.resume(); });
  }, { seconds: 8, raw: true, lead: 0.1 });
  const out = {};
  for (const [label, pick, hz, level] of [
    ['环境声总线 150 Hz', (a) => a.bus.amb, 150, 0.5], ['环境声总线 1 kHz（低通扫过它）', (a) => a.bus.amb, 1000, 0.5],
    ['屋面雨点总线 150 Hz', (a) => a.bus.roof, 150, 0.5], ['混响发送 150 Hz', (a) => a.bus.reverb, 150, 0.2],
  ]) out[label] = curvature(await run(pick, hz, level), hz, 2.4);
  return out;
}

// 加新音和两种地面之前的表（按原来的份数还原）：没有滑铲、敌人、爆头和玻璃，四种地面，脚步 5 份、落地 3 份
const NEW = ['slide', 'impactGlass', 'npcShot', 'npcStep', 'npcHurt', 'npcDeath', 'bodyHit', 'npcAlert', 'headshot'];
const OLD_SURFACES = ['asphalt', 'metal', 'wood', 'concrete'];
const OLD_N = { footstep: 5, land: 3 };
function oldTable() {
  const t = {};
  for (const [name, d] of Object.entries(SOUNDS)) {
    if (NEW.includes(name)) continue;
    t[name] = d.surfaces ? { ...d, surfaces: OLD_SURFACES, n: OLD_N[name] || d.n } : d;
  }
  return t;
}

// 预渲染要多久：新建一个引擎从头烤一遍，量 runs 次。lanes 是同时渲染几份（1 就是老的串行做法），old 时烤加新音之前的表
// skip：去掉这些音再烤，看它们各占多少
export async function bakeTime(lanes, { old = false, runs = 3, skip = [] } = {}) {
  const out = [];
  const table = old ? oldTable() : Object.fromEntries(Object.entries(SOUNDS).filter(([name]) => !skip.includes(name)));
  for (let i = 0; i < runs; i++) {
    const e = new AudioEngine();
    e.attach(new OfflineAudioContext(2, 4800, 48000), { offline: true, ambient: false });
    const t0 = performance.now();
    await bake(e, lanes, table);
    let bytes = 0, bufs = 0;
    for (const list of e.bank.values()) for (const b of list) { bytes += b.length * b.numberOfChannels * 4; bufs++; }
    out.push({ ms: Math.round(performance.now() - t0), 组: e.bank.size, 份: bufs, MB: +(bytes / 1048576).toFixed(1) });
  }
  return out;
}
