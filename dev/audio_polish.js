// 2026-11-12 音效打磨（A1~A12）的测量：遮挡、大厅混响、湿度水声、心跳、敌人脚步、落地、暂停、预渲染耗时。
// 控制台里 __audio.polish.<名字>()，每个都返回一个对象
import { AudioEngine, renderOffline } from '../src/audio/audio.js';
import { bake } from '../src/audio/bake.js';
import { Builder, createResources, rnd } from '../src/audio/synth.js';
import { SOUNDS, SURFACES } from '../src/audio/table.js';
import { footstep } from '../src/audio/sounds_move.js';
import { engine, LONG } from './audio_common.js';
import { analyze, bands, decay, r3 } from './audio_dsp.js';
import { contribution } from './audio_kit.js';

const bankOf = async () => { await engine.unlock(); await engine.baked; return engine.bank; };
const stat = (buf, from = 0.5) => {
  const r = analyze(buf);
  return { 峰值: r3(r.peak), 最响50ms: r3(r.loud), A计权: r3(r.loudA), 重心Hz: Math.round(r.centroid), 频谱dB: bands(buf, from) };
};
const dB = (a, b) => +(20 * Math.log10(a / b)).toFixed(1);

// 假的碰撞几何：mode 'wall' 每条射线都撞，'low' 第一条撞、抬高的第二条通（矮掩体）
function fakePhys(mode) {
  let n = 0;
  return { rayDist: (o, d, max) => (mode === 'wall' || (mode === 'low' && n++ % 2 === 0) ? max * 0.5 : -1) };
}

// A1：20 米外敌人开一枪，没挡、矮掩体、隔墙、隔楼板四种；人在小房间里时再比混响（起音 300 ms 以后的能量）。
// 隔墙的那一枪走 bus.far，不应该激起房间混响：屋里的尾巴能量要比没挡的低得多
export async function occlusionTest() {
  const bank = await bankOf(), out = {};
  const cases = { 没挡: [null, -16], 矮掩体: ['low', -16], 隔墙: ['wall', -16], 隔楼板: ['wall', -20] };
  for (const indoor of [0, 1]) {
    for (const [label, [mode, z]] of Object.entries(cases)) {
      const pos = { x: 12, y: label === '隔楼板' ? 4.9 : 1.6, z };
      const buf = await renderOffline((a) => {
        a.setListener({ x: 0, y: 1.6, z: 0 });
        if (mode) a.setGeometry(fakePhys(mode));
        a.play('npcShot', { position: pos });
      }, { seconds: 3, bank, indoor });
      const s = stat(buf), late = analyze(sliceFrom(buf, 0.8));
      out[`室内${indoor} · ${label}`] = { ...s, 起音300ms后RMS: +late.rms.toExponential(2) };
    }
  }
  // 循环音：旋翼挂在 6 米外，前一秒没挡，后面换成隔墙，看 _loopSpace 平滑过渡后的电平
  const rotor = await renderOffline((a) => {
    const h = a.loop('droneRotor', { position: { x: 4, y: 3, z: -4 } });
    a.ctx.suspend(a.ctx.currentTime + 1).then(() => { a.setGeometry(fakePhys('wall')); for (const l of a.loops) a._loopSpace(l); a.ctx.resume(); });
    return h;
  }, { seconds: 2.5 });
  out.旋翼_前一秒没挡后面隔墙 = { 前一秒RMS: rmsOf(rotor, 0.7, 1.4), 隔墙后RMS: rmsOf(rotor, 2.2, 3), 差dB: dB(rmsOf(rotor, 2.2, 3), rmsOf(rotor, 0.7, 1.4)) };
  return out;
}

function sliceFrom(buf, from) {
  const a = Math.floor(from * buf.sampleRate), out = new AudioBuffer({ numberOfChannels: 2, length: buf.length - a, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(a));
  return out;
}
function rmsOf(buf, from, to) {
  const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(1);
  let e = 0, n = 0;
  for (let i = Math.floor(from * sr); i < Math.min(L.length, to * sr); i++, n++) e += L[i] * L[i] + R[i] * R[i];
  return +Math.sqrt(e / (2 * Math.max(1, n))).toExponential(3);
}

function impulseInto(a) {
  const ctx = a.ctx, buf = ctx.createBuffer(1, 8, ctx.sampleRate), src = ctx.createBufferSource();
  buf.getChannelData(0)[0] = 1;
  src.buffer = buf;
  src.connect(a.bus.reverb);
  src.start(ctx.currentTime);
}

// A3：露天、小房间、大厅三种混响的脉冲响应和一发步枪
export async function hallTest() {
  const bank = await bankOf(), out = {};
  for (const [label, indoor, kind] of [['露天', 0, 'room'], ['小房间', 1, 'room'], ['大厅', 1, 'hall']]) {
    const ir = await renderOffline(impulseInto, { seconds: 3, raw: true, indoor, kind });
    const shot = await renderOffline((a) => a.play('rifleShot', { volume: 0.9 }), { seconds: 3, bank, indoor, kind });
    const S = analyze(shot);
    out[label] = { 脉冲响应: { ...decay(ir, 0.5), 频谱dB: bands(ir, 0.5) }, 步枪: { 峰值: r3(S.peak), 最响50ms: r3(S.loud), A计权: r3(S.loudA), ...decay(shot, 0.5) } };
  }
  return out;
}

// A8：沥青上的音在湿度 0 / 0.3 / 1 时的 A 计权和 4 kHz 以上的能量
export async function splashTest() {
  const bank = await bankOf(), out = {};
  for (const [name, opts] of [['footstep', { surface: 'asphalt', volume: 0.75 }], ['land', { surface: 'asphalt' }], ['slide', { surface: 'asphalt' }], ['impactAsphalt', { position: { x: 2, y: 0, z: -3 } }], ['shell', { position: { x: 0.5, y: 0, z: -0.5 } }]]) {
    const row = {};
    for (const wet of [0, 0.3, 1]) {
      let loudA = 0, hi = 0;
      for (let i = 0; i < 4; i++) {
        const buf = await renderOffline((a) => { a.setWet(wet); a.play(name, opts); }, { seconds: 1.5, bank });
        loudA += analyze(buf).loudA / 4;
        const b = bands(buf, 0.5);
        hi += (b[6] + b[7]) / 8;
      }
      row[`湿度${wet}`] = { A计权: r3(loudA), '4k和8k平均dB': +hi.toFixed(1) };
    }
    out[name] = row;
  }
  return out;
}

// 改版前的心跳和敌人脚步，对照用
function oldHeartbeat(b, o) {
  for (const [at, f, k] of [[0, 62, 1], [0.17, 52, 0.65]]) {
    b.ping(f * o.pitch, { peak: 0.9 * k, tau: 0.045, at, attack: 0.008, freqTo: f * 0.68 * o.pitch, sweep: 0.09 });
    b.ping(f * 2 * o.pitch, { peak: 0.22 * k, tau: 0.03, at, attack: 0.006, freqTo: f * 1.4 * o.pitch, sweep: 0.06 });
    b.burst('brown', { type: 'lowpass', freq: 150, peak: 0.8 * k, tau: 0.035, at, attack: 0.008 });
  }
}
function oldNpcStep(b, o) {
  const dest = b.dest;
  b.dest = b.filter('lowpass', 3600, 0);
  b.chain(b.dest, b.gain(o.surface === 'gravel' ? 0.9 : 1), dest);
  footstep(b, { ...o, pitch: o.pitch * 0.84 });
  b.burst('brown', { type: 'lowpass', freq: 170, peak: o.surface === 'carpet' ? 0.25 : 0.5, tau: 0.03 });
  b.dest = dest;
}
SOUNDS.heartbeatOld = { ...SOUNDS.heartbeat, fn: oldHeartbeat, n: 0, pump: undefined };
SOUNDS.npcStepOld = { ...SOUNDS.npcStep, fn: oldNpcStep, gain: 0.26, ref: 4, n: 0, splash: undefined, detune: 0 };

// 下午无雨的声底；muffle 是低血量时游戏给的闷响（low × 0.7）
const quiet = (muffle = 0) => (a) => { a.setRain(0, 0); a.setTimeOfDay('afternoon', { tau: 0 }); a.setMuffle(muffle); };
const brief = (r) => ({ 格子: `${r.时频空隙.高出3dB的格子}/${r.时频空隙.格子总数}`, 最好: r.三分之一倍频程里最好的一段, A计权差dB: r.A计权差dB, 总能量差dB: r.总能量差dB, 混音峰值: r.混音峰值 });

// A11：心跳压在下午的声底上（volume 0.85），老版、新版、新版加低血量的闷响和环境让位
export async function heartbeatTest() {
  const beat = (name) => (a) => a.play(name, { volume: 0.85 });
  return {
    老版: brief(await contribution(quiet(0), beat('heartbeatOld'), 0, { win: 0.4, ambient: true })),
    新版: brief(await contribution(quiet(0), beat('heartbeat'), 0, { win: 0.4, ambient: true })),
    新版_低血量闷响0点6: brief(await contribution(quiet(0.6), beat('heartbeat'), 0, { win: 0.4, ambient: true, lead: 1.5 })),
  };
}

// A4：敌人跑动的 4 步（volume 0.85）在 4 / 8 / 15 / 25 米，混凝土和钢板，下午无雨的声底
export async function npcStepTest() {
  const out = {};
  for (const surface of ['concrete', 'metal']) {
    for (const dist of [4, 8, 15, 25]) {
      const steps = (name) => (a) => { for (let i = 0; i < 4; i++) a.play(name, { surface, volume: 0.85, delay: i * 0.33, position: { x: dist * 0.6, y: 0.1, z: -dist * 0.8 } }); };
      const row = {};
      for (const name of ['npcStepOld', 'npcStep']) row[name === 'npcStep' ? '新' : '老'] = brief(await contribution(quiet(0), steps(name), 0, { win: 1.4, ambient: true }));
      out[`${surface} ${dist}米`] = row;
    }
  }
  return out;
}

// A5：六种地面的落地，倍频程频谱（dB）、1 kHz 以上占比、衰减。各渲染 4 遍取平均
export async function landTest() {
  const bank = await bankOf(), out = {};
  for (const surface of SURFACES) {
    const acc = { b: null, hi: 0, d30: 0 };
    for (let i = 0; i < 4; i++) {
      const buf = await renderOffline((a) => { a.setWet(0); a.play('land', { surface }); }, { seconds: 2.5, bank, raw: true });
      const b = bands(buf, 0.5), r = analyze(buf);
      acc.b = acc.b ? acc.b.map((v, k) => v + b[k] / 4) : b.map((v) => v / 4);
      acc.hi += r.high / 4;
      acc.d30 += decay(buf, 0.5).掉30dB毫秒 / 4;
    }
    out[surface] = { 频谱dB: acc.b.map((v) => +v.toFixed(1)), 高频占比: r3(acc.hi), 掉30dB毫秒: Math.round(acc.d30) };
  }
  return out;
}

// A12：开一枪，0.1 秒后暂停世界，0.6 秒响一下界面点击。暂停后世界那一路应该没声，点击照常
export async function pauseTest() {
  const bank = await bankOf();
  const buf = await renderOffline((a) => {
    a.play('rifleShot', { volume: 0.9 });
    a.play('uiClick', { delay: 0.6 });
    a.ctx.suspend(a.ctx.currentTime + 0.1).then(() => { a.setWorldPaused(true); a.ctx.resume(); });
  }, { seconds: 1.2, bank, ambient: true });
  return { 枪声头100ms_RMS: rmsOf(buf, 0.5, 0.6), 暂停后300到550ms_RMS: rmsOf(buf, 0.8, 1.05), 界面点击那50ms_RMS: rmsOf(buf, 1.1, 1.15) };
}

// 每个音现合成 runs 次，实际最长多久（b.end）和表里 len 的余量
export function lenCheck(runs = 20) {
  const ctx = new OfflineAudioContext(2, 4800, 48000), res = createResources(ctx), over = [];
  for (const [name, d] of Object.entries(SOUNDS)) {
    if (!d.n) continue;
    for (const s of d.surfaces || [undefined]) {
      let mx = 0;
      for (let i = 0; i < runs; i++) { const b = new Builder(ctx, res, ctx.destination, 0, { pitch: 1, surface: s }); d.fn(b, b.o); mx = Math.max(mx, b.end); }
      const len = d.lenOf?.[s] ?? d.len;
      if (mx > len || mx < len * 0.6) over.push(`${name}${s ? ':' + s : ''} 最长 ${mx.toFixed(2)} / len ${len}`);
    }
  }
  return over;
}

// 预渲染耗时：改版前的表（同一套音色函数，按当时的份数和 len，一份一个上下文）和现在的表交替烤，各 runs 次
const OLD = 'rifleShot 8 1.8,rifleDry 2 0.5,magOut 2 0.6,magIn 2 0.7,boltRack 2 0.9,boltRelease 2 0.6,selector 2 0.4,shell 6 0.9,knifeDraw 2 1.9,knifeSwing 4 0.5,knifeHitMetal 3 1.6,knifeHitSoft 3 0.5,knifeSpin 2 1.9,weaponRaise 3 0.6,footstep 4 1.2,jump 2 0.6,land 2 1.3,slide 2 1.3,impactMetal 5 2.2,impactConcrete 5 0.9,impactWood 5 0.6,impactAsphalt 5 0.7,impactGlass 3 0.9,ricochet 4 0.7,bulletWhiz 4 0.5,droneShot 4 0.8,droneHit 3 0.7,droneExplode 3 2.3,droneAlert 1 0.6,npcShot 4 1.7,npcStep 2 1.2,npcHurt 3 0.6,npcDeath 2 1.4,bodyHit 4 0.5,npcAlert 2 0.7,weaponSwitch 5 0.6,dash 2 0.7,smokeThrow 2 0.9,smokeBounce 4 0.5,targetHit 4 1.25,targetDown 2 1,hurt 3 1.8,hitmarker 2 0.3,headshot 2 0.6,killConfirm 2 0.6,killHeadshot 2 0.6,waveStart 1 1.4,waveClear 1 2.7,uiClick 1 0.2,heartbeat 1 0.7';
export async function bakeCompare(runs = 5) {
  const old = {};
  for (const s of OLD.split(',')) { const [k, n, len] = s.split(' '); old[k] = { ...SOUNDS[k], n: +n, len: +len, lenOf: undefined }; }
  const once = async (table, batch) => {
    const e = new AudioEngine();
    e._warn = () => {};
    e.attach(new OfflineAudioContext(2, 4800, 48000), { offline: true, ambient: false });
    const t0 = performance.now();
    await bake(e, 3, table, batch);
    const ms = Math.round(performance.now() - t0);
    let bytes = 0, bufs = 0;
    for (const list of e.bank.values()) for (const b of list) { bytes += b.length * b.numberOfChannels * 4; bufs++; }
    e.bank.clear();
    await new Promise((r) => setTimeout(r, 300)); // 让垃圾回收跟上，不然越烤越慢
    return { ms, bufs, MB: +(bytes / 1048576).toFixed(1) };
  };
  const res = { 改版前: [], 现在: [] };
  for (let i = 0; i < runs; i++) {
    res.改版前.push(await once(old, 1));
    res.现在.push(await once(SOUNDS));
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const sum = (a) => ({ 中位ms: med(a.map((x) => x.ms)), 最快ms: Math.min(...a.map((x) => x.ms)), 份: a[0].bufs, MB: a[0].MB, 每次: a.map((x) => x.ms) });
  const o = sum(res.改版前), n = sum(res.现在);
  return { 改版前: o, 现在: n, 中位增加: `${Math.round((n.中位ms / o.中位ms - 1) * 100)}%`, 最快增加: `${Math.round((n.最快ms / o.最快ms - 1) * 100)}%` };
}

// A10：三个时段的环境声底，露天、小房间、大厅
export async function ambientTest() {
  const out = {};
  for (const tod of ['night', 'afternoon', 'day']) {
    for (const [label, indoor, kind] of [['露天', 0, 'room'], ['屋里', 1, 'room']]) {
      const buf = await renderOffline((a) => a.setRain(tod === 'night' ? 1 : 0, 0), { seconds: 8, ambient: true, indoor, kind, tod, lead: 2 });
      const r = analyze(buf);
      out[`${tod} · ${label}`] = { rms: +r.rms.toFixed(4), 重心Hz: Math.round(r.centroid), 频谱dB: bands(buf, 2.5) };
    }
  }
  return out;
}

// 新音和改过的音逐个量（总线前，同表里配平的口径），旁边放同类的老音做参照
export const NEW = {
  换弹拟音: ['magOut', 'magIn', 'reloadGrab', 'magRelease', 'magSeat', 'reloadSettle', 'inspectCloth', 'inspectTap', 'weaponSwitch'],
  装具: ['jump', 'gear'],
  弹着: ['impactConcrete', 'impactAsphalt', 'impactSoft', 'impactGravel', 'impactWood'],
  刀: ['knifeHitMetal', 'knifeHitSoft', 'knifeHitHard', 'knifeHitDull'],
  落地物: ['smokeBounce', 'shell', 'shellSoft', 'droneHit', 'droneCrash', 'targetDown', 'targetReset'],
  敌人: ['npcMagOut', 'npcMagIn', 'npcHurt'],
  界面: ['uiClick', 'uiHover', 'hurt', 'heartbeat', 'playerDeath', 'regenBreath'],
  水声: ['splashStep', 'splashHit', 'splashSlide', 'splashShell'],
};
export async function newReport(groups = NEW, n = 4) {
  const bank = await bankOf(), out = {};
  for (const [g, names] of Object.entries(groups)) {
    out[g] = {};
    for (const name of names) {
      const sum = { peak: 0, loud: 0, loudA: 0, centroid: 0 };
      for (let i = 0; i < n; i++) {
        const r = analyze(await renderOffline((a) => { a.setWet(0); a.play(name); }, { seconds: LONG[name] || 2.5, raw: true, bank }));
        for (const k in sum) sum[k] = k === 'peak' ? Math.max(sum[k], r[k]) : sum[k] + r[k] / n;
      }
      out[g][name] = `峰 ${r3(sum.peak)} 响 ${r3(sum.loud)} A ${r3(sum.loudA)} 重心 ${Math.round(sum.centroid)}`;
    }
  }
  return out;
}

export { rnd };
