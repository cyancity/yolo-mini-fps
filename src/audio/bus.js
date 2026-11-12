// 总线：sfx / 环境声 / 混响回送 → 世界闸门（暂停时淡出）→ 低通（负伤时的闷响）→ 压缩 → 软限幅 → 主音量；
// ui 总线绕过世界闸门和低通，暂停菜单里照样响。
// 室内程度（0 露天，1 楼里深处）管这几件事：室外的环境声被屋顶和墙挡掉高频并降下来，屋面雨点和房间底噪浮上来，
// 混响从堆场的拍击回声换成房间声（小房间或大厅按 hall 交叉）。三套混响都在输入端切换：
// 刚进屋时堆场混响里已经在响的尾巴照样放完，只是不再有新的声音送进去。
// far 是隔着墙的声源和室外环境事件的混响发送：只进堆场混响，人在屋里时它先过一道低通再进去，听起来是墙外的回声
import { LIMIT_RANGE } from './synth.js';

const POST_COMP = 0.655;  // 抵消压缩器按阈值和压缩比自动加上的补偿增益（实测 1.527 倍），小信号正好原样通过
export const AMB_GAIN = 0.45;
export const INDOOR_TAU = 0.4; // 室内外过渡的时间常数（秒）
const ENV_OCTAVES = 5.2;  // 进到最里面，室外环境声的低通从 20 kHz 往下压这么多个八度（约 540 Hz）
const ENV_DROP = 0.5;     // 低通之外整体再降到这个比例
const FAR_OCTAVES = 4.4;  // 墙外传进来的混响压到约 950 Hz
const ROOM_WET = 1.4;   // 房间混响的回送比室外的大：四面都是墙，反射多。取 1.4 时步枪在屋里比屋外响约 1.5 dB；远处声源的混响加成在屋里由 audio.js 的 _space 收掉
const HALL_WET = 1.1;   // 大厅的尾巴长，回送给小一点，响度和小房间差不多

export const muffleHz = (amount, ctx) => Math.min(20000 * Math.pow(320 / 20000, amount), ctx.sampleRate * 0.45);

// raw 时跳过低通、压缩和限幅，校准配平时用来量每个音自身的峰值
export function createBus(ctx, res, raw) {
  const gain = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filter = (type, freq, q) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, ctx.sampleRate * 0.45);
    f.Q.value = q;
    return f;
  };
  const conv = (impulse) => {
    const c = ctx.createConvolver();
    c.normalize = false; // 脉冲已经归一化到单位能量，不要浏览器再按自己的算法缩放一遍
    c.buffer = impulse;
    return c;
  };
  // amb：室外的环境声（声底和远处的偶发事件）；roof：只有室内听得到的屋面雨点；tone：只有室内才有的房间底噪；
  // reverb：普通音的混响发送；far：见文件开头
  // ambDuck 是低血量时环境声让位的那一档（setMuffle 跟着推），ambPump 是每下心跳把环境声按下去一点
  const bus = {
    sfx: gain(), ui: gain(), amb: gain(), roof: gain(0), tone: gain(0), reverb: gain(), far: gain(), master: gain(), world: gain(),
    muffle: filter('lowpass', 20000, 0.5), env: filter('lowpass', 20000, -3), envLevel: gain(), ambOut: gain(AMB_GAIN),
    ambDuck: gain(), ambPump: gain(),
    yardIn: gain(), roomIn: gain(0), hallIn: gain(0), farLP: filter('lowpass', 20000, -3), farLevel: gain(),
  };
  // 低通的 detune 保持逐采样（a-rate）：改成一个渲染块算一次系数，系数台阶在 150 Hz 正弦上量得出折点（二阶差分 6 倍）
  const wet = filter('highpass', 120, 1); // 混响回送切掉最低的一段，连发时低频才不会糊成一片
  const yard = conv(res.impulse);
  bus.reverb.connect(bus.yardIn).connect(yard).connect(wet);
  bus.reverb.connect(bus.roomIn).connect(conv(res.room)).connect(wet);
  bus.reverb.connect(bus.hallIn).connect(conv(res.hall)).connect(wet);
  bus.far.connect(bus.farLP).connect(bus.farLevel).connect(yard);
  bus.amb.connect(bus.env).connect(bus.envLevel).connect(bus.ambOut);
  bus.roof.connect(bus.ambOut);
  bus.tone.connect(bus.ambOut);
  bus.ambOut.connect(bus.ambDuck).connect(bus.ambPump);
  bus.master.connect(ctx.destination);
  if (raw) {
    for (const n of [bus.sfx, bus.ui, bus.ambPump, wet]) n.connect(bus.master);
    return bus;
  }
  for (const n of [bus.sfx, bus.ambPump, wet]) n.connect(bus.world);
  bus.world.connect(bus.muffle);
  const comp = ctx.createDynamicsCompressor();
  // 压得轻、起音慢：它只管连发和爆炸叠在一起时的整体响度。压缩器自带 6 ms 预读，
  // 起音一快就会把枪声的爆裂压扁，所以瞬态留给后面的软限幅
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.03;
  comp.release.value = 0.25;
  const limit = ctx.createWaveShaper();
  limit.curve = res.curves.limit;
  bus.muffle.connect(comp);
  bus.ui.connect(comp);
  comp.connect(gain(POST_COMP / LIMIT_RANGE)).connect(limit).connect(bus.master);
  return bus;
}

export function aim(param, value, t, tau) {
  if (tau > 0) param.setTargetAtTime(value, t, tau); else param.value = value;
}

// 把室内程度写到总线上。hall 是大厅的比例（0 小房间，1 大厅）。tau 给 0 就立刻到位（总线刚建好、还没出声的时候用）；
// 平时每个参数各自按指数曲线靠过去，没有任何跳变，所以怎么来回切都不会出咔哒声
export function setBusIndoor(bus, amount, t, tau, hall = 0) {
  const turn = amount * Math.PI * 0.5, h = hall * Math.PI * 0.5, s = Math.sin(turn);
  aim(bus.env.detune, -1200 * ENV_OCTAVES * amount, t, tau); // 用音分调，低通在对数频率上匀速开合
  aim(bus.envLevel.gain, Math.pow(ENV_DROP, amount), t, tau);
  aim(bus.roof.gain, amount, t, tau);
  aim(bus.tone.gain, amount, t, tau);
  aim(bus.farLP.detune, -1200 * FAR_OCTAVES * amount, t, tau);
  aim(bus.farLevel.gain, Math.pow(ENV_DROP, amount), t, tau);
  aim(bus.yardIn.gain, Math.cos(turn), t, tau); // 三套混响等功率交叉
  aim(bus.roomIn.gain, ROOM_WET * s * Math.cos(h), t, tau);
  aim(bus.hallIn.gain, HALL_WET * s * Math.sin(h), t, tau);
}
