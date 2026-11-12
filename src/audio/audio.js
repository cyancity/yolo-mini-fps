// 程序化音效引擎：全部用 WebAudio 合成，不加载任何音频文件。总线的接法见 bus.js，预渲染见 bake.js，
// 遮挡见 occlusion.js，循环音见 audio_loops.js；雨、时段、湿度、灯具嗡声、暂停和环境事件的定时器在 audio_world.js（挂到同一个类上）。
import { Builder, createResources, rnd } from './synth.js';
import { createBus, setBusIndoor, muffleHz, INDOOR_TAU } from './bus.js';
import { bake } from './bake.js';
import { Occluder, occCut, occGain } from './occlusion.js';
import { worldMethods } from './audio_world.js';
import { loopMethods } from './audio_loops.js';
import { SOUNDS, LOOPS, SURFACES, surfaceOf } from './table.js';

export { SURFACES };
export { impactSound, knifeHitSound } from './table.js';
export const SOUND_NAMES = Object.keys(SOUNDS);
export const LOOP_NAMES = Object.keys(LOOPS);

const MAX_VOICES = 32;
export const LOOKAHEAD = 0.004; // 实时合成时把起音排到下一个渲染块之后，不然零点几毫秒的起音包络会被截掉
const TAIL = 0.3;        // 声源停了以后，延时线和滤波器里还剩的余音
const REF = 3.5;         // 默认参考距离（米）；特别响的声音在表里单独给更大的 ref
const AIR = 45;          // 默认的空气吸收距离尺度（米）
// 人在室内时，枪声里烤进去的室外回声和远场尾巴压掉这么多，尾巴交给房间混响。大厅的混响本身就长，压得少一些
const TAIL_CUT = { room: 0.75, hall: 0.4 };
const SPEED = 343;       // 声速（米/秒），表里标了 sonic 的音按距离晚到

const FORWARD = { x: 0, y: 0, z: -1 }, UP = { x: 0, y: 1, z: 0 };
const SP = { att: 1, cutoff: 20000, wet: 1 }; // _space 的结果，每次覆盖着用
export const finite = (p) => Number.isFinite(p.x + p.y + p.z);
const occOr0 = (occ) => (occ > 0 ? occ : 0); // 遮挡判定超出射线预算时是 -1，单发的音当没挡

export function dispose(v) {
  for (const s of v.sources) { try { s.stop(); } catch { /* 已经停了 */ } s.disconnect(); }
  for (const n of v.nodes) n.disconnect();
  for (const n of v.extra) n.disconnect();
  v.out.disconnect();
}

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.voices = [];
    this.loops = new Set();
    this.bank = new Map();           // 音名（带材质的是 “音名:材质”）→ 预渲染好的几份变体
    this.baked = Promise.resolve();  // unlock 之后换成“全部预渲染完”的 Promise，加载界面可以等它
    this.lpos = { x: 0, y: 0, z: 0 };
    this.lfwd = { ...FORWARD };
    this.lup = { ...UP };
    this.occluder = new Occluder();
    this._recent = new Map();        // 每组变体最近放过哪几份
    this._master = 1;
    this._muffle = 0;
    this._indoor = 0; // 室内程度的目标值；_inV 是按时间常数平滑到此刻的值，_inT 是上次结算的时刻
    this._kind = 'room';
    this._inV = 0;
    this._inT = 0;
    this._paused = false;
    this._warned = new Set();
    this.initWorld();
  }

  // 必须在用户手势里调用。可以反复调：已经建好就只确保上下文在跑
  async unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      this.attach(new AC({ latencyHint: 'interactive' }));
    }
    if (!this._paused && this.ctx.state !== 'running') {
      // 没有用户手势时 resume 会一直挂着，所以不无限等
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    }
    return this.ready;
  }

  // 接到一个现成的上下文上并建好总线；离线渲染（测量用）也走这里
  attach(ctx, { offline = false, raw = false, ambient = true } = {}) {
    this.ctx = ctx;
    this.offline = offline;
    this.res = createResources(ctx);
    this.bus = createBus(ctx, this.res, raw);
    this.bus.master.gain.value = this._master;
    this.bus.muffle.frequency.value = muffleHz(this._muffle, ctx);
    this.bus.ambDuck.gain.value = ambDuck(this._muffle);
    this._inV = this._indoor;
    this._inT = ctx.currentTime;
    setBusIndoor(this.bus, this._indoor, 0, 0, this._kind === 'hall' ? 1 : 0); // unlock 之前就设过室内程度的，这里直接到位
    ctx.createPanner().panningModel = 'HRTF'; // 提前触发 HRTF 数据加载，加载完之前 HRTF 声像是静音的
    this.ready = true;
    this.setListener(this.lpos, this.lfwd, this.lup);
    this.attachWorld(ambient);
    for (const h of this.loops) this._loopStart(h); // unlock 之前就申请的循环音，现在补上
    if (offline) return;
    this._timer = setInterval(() => this._tick(), 200);
    this.baked = bake(this).catch((err) => this._warn('bake', '预渲染失败，继续用实时合成', err));
  }

  setListener(pos, forward = FORWARD, up = UP) {
    if (!pos || !finite(pos) || !finite(forward) || !finite(up)) return; // 坏数据会让 AudioParam 直接抛错
    const p = this.lpos, f = this.lfwd, u = this.lup;
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    f.x = forward.x; f.y = forward.y; f.z = forward.z;
    u.x = up.x; u.y = up.y; u.z = up.z;
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // 关卡的碰撞几何（Physics，要有 rayDist）。给了以后带位置的声音按遮挡压低通、降音量，挡住的不进房间混响
  setGeometry(phys) {
    this.occluder.phys = phys || null;
  }

  // 一次性音。不给 position 就不做空间化（玩家自己的声音）；surface 是地面材质名（表里带 surfaces、splash、bySurface 的音才看）
  play(name, { position, volume = 1, pitch = 1, delay = 0, surface } = {}) {
    if (!this.ready) return;
    let d = SOUNDS[name];
    if (!d) return this._warn(name, `没有这个音：${name}`);
    const ground = surfaceOf(surface); // 不认识的材质名在这里落到已有的一种上
    if (d.bySurface && surface && SOUNDS[d.bySurface[ground]]) d = SOUNDS[(name = d.bySurface[ground])];
    const key = d.surfaces ? `${name}:${ground}` : name;
    const list = this.bank.get(key);
    const pos = position && finite(position) ? position : null;
    const lag = d.sonic && pos ? Math.hypot(pos.x - this.lpos.x, pos.y - this.lpos.y, pos.z - this.lpos.z) / SPEED : 0;
    const ctx = this.ctx, t0 = ctx.currentTime + (list ? 0 : LOOKAHEAD) + Math.max(0, delay) + lag;
    if (!this.offline) this._reap(ctx.currentTime);
    let cutoff = 20000, wet = 1, att = 1, occ = 0;
    if (pos) {
      occ = d.bus === 'sfx' && d.occ !== false ? occOr0(this.occluder.test(this.lpos, pos, d.prio >= 6)) : 0;
      const sp = this._space(pos, d);
      att = sp.att;
      wet = sp.wet;
      cutoff = Math.min(sp.cutoff, occCut(occ));
    }
    const og = occGain(occ), level = volume * att * og;

    // 连发：上一发的尾巴每来一发新的就压低一半，压过两次直接收掉，新的一发才清楚
    if (d.choke) {
      for (const v of this.voices) {
        if (v.dead || v.end <= t0 || v.d.choke !== d.choke) continue;
        v.duck *= 0.5;
        if (v.duck < 0.2) {
          this._kill(v, t0, 0.06);
        } else {
          v.out.gain.cancelScheduledValues(t0); // 还没生效的室内压尾一并撤掉，下面的目标值里已经算进去了
          v.out.gain.setTargetAtTime(v.base * v.duck * v.gate, t0, 0.012);
        }
      }
    }
    let count = 0, same = 0, oldest = null, victim = null, low = Infinity;
    for (const v of this.voices) {
      if (v.dead || v.end <= t0) continue;
      count++;
      if (v.name === name) {
        same++;
        if (!oldest || v.t0 < oldest.t0) oldest = v;
      }
      // 优先级低的先走；同级里挑又轻又快播完的
      const score = v.d.prio + v.level * (1 - Math.max(0, t0 - v.t0) / (v.end - v.t0));
      if (score < low) { low = score; victim = v; }
    }
    if (same >= (d.max || 8)) {
      this._kill(oldest, t0, 0.03);
      count--;
    }
    if (count >= MAX_VOICES) {
      if (low > d.prio + level) return; // 新来的比场上最不重要的还轻，丢它
      if (!victim.dead) this._kill(victim, t0, 0.03);
    }

    const out = ctx.createGain();
    const v = { name, d, out, t0, level, duck: 1, gate: 1, base: volume * og * d.gain * (1 + rnd(-d.jitter, d.jitter)), dead: false };
    out.gain.value = v.base;
    if (d.tail) {
      // 室内：起音原样放出去，随后那段烤进去的室外回声压低，听起来短而闷
      const indoor = this._indoorNow(ctx.currentTime);
      if (indoor > 0.02) {
        v.gate = 1 - TAIL_CUT[this._kind] * indoor;
        out.gain.setTargetAtTime(v.base * v.gate, t0 + d.tail, 0.05);
      }
    }
    if (list) {
      const i = this._pick(key, list.length);
      // 变调要重采样，高频咔哒会损失一些，所以只有表里标了 detune 的低频为主的音才做；pitch 为 1 且没有 detune 时原样播放
      const src = ctx.createBufferSource(), rate = Math.max(0.05, pitch) * (d.detune ? 1 + rnd(-d.detune, d.detune) : 1);
      src.buffer = list[i];
      src.playbackRate.value = rate;
      src.connect(out);
      src.start(t0);
      v.sources = [src];
      v.nodes = [];
      v.end = t0 + list[i].duration / rate + 0.02;
      if (d.splash && ground === 'asphalt' && this._wet > 0.05) this._splash(v, d, t0);
    } else {
      const b = new Builder(ctx, this.res, out, t0, { pitch, surface: d.surfaces ? ground : undefined });
      try {
        d.fn(b, b.o);
      } catch (err) {
        this._warn(name, `音色 ${name} 搭建失败`, err);
      }
      v.nodes = b.nodes;
      v.sources = b.sources;
      v.end = b.end + TAIL;
    }
    if (d.pump) this._pump(d.pump, t0);
    v.extra = this._route(out, d, pos, cutoff, wet, occ >= 1);
    this.voices.push(v);
  }

  // 从 n 份变体里挑一份：不重复最近 n/2 份（两份时只能交替，三份起才是真的打乱）
  _pick(key, n) {
    if (n < 2) return 0;
    let recent = this._recent.get(key);
    if (!recent) this._recent.set(key, (recent = []));
    let i;
    do i = (Math.random() * n) | 0; while (recent.includes(i));
    recent.push(i);
    if (recent.length > Math.max(1, n >> 1)) recent.shift();
    return i;
  }

  // 湿沥青的水声：从表里 splash 指定的那组变体挑一份，和本音接在同一个出口上（同一个声像、同一路发声数），音量乘地面湿度
  _splash(v, d, t0) {
    const [name, k] = d.splash, sd = SOUNDS[name], list = this.bank.get(name);
    if (!list || !sd) return;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), buf = list[this._pick(name, list.length)];
    src.buffer = buf;
    g.gain.value = (k * this._wet * sd.gain * (1 + rnd(-sd.jitter, sd.jitter))) / d.gain;
    src.connect(g).connect(v.out);
    src.start(t0);
    v.sources.push(src);
    v.nodes.push(g);
    v.end = Math.max(v.end, t0 + buf.duration + 0.02);
  }

  // 心跳这类音：把环境声瞬间按到 level，随后慢慢放回来，像侧链压缩
  _pump(level, t0) {
    const g = this.bus.ambPump.gain;
    g.cancelScheduledValues(t0);
    g.setTargetAtTime(level, t0, 0.012);
    g.setTargetAtTime(1, t0 + 0.16, 0.18);
  }

  // 0..1，低血量和阵亡时把整个世界闷掉（界面音不受影响），环境声同时让出几 dB 给心跳
  setMuffle(amount) {
    const a = Math.min(1, Math.max(0, amount || 0));
    if (Math.abs(a - this._muffle) < 0.004) return;
    this._muffle = a;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.bus.muffle.frequency.setTargetAtTime(muffleHz(a, this.ctx), t, 0.1);
    this.bus.ambDuck.gain.setTargetAtTime(ambDuck(a), t, 0.3);
  }

  // amount：0（露天）到 1（楼里深处）；kind：'room'（办公楼、楼梯间）或 'hall'（仓库）。可以每帧调：
  // 目标没怎么变就直接返回，变了才去动总线上的几个参数，过渡由参数自己按 INDOOR_TAU 的时间常数走完。unlock 之前调只记下数值
  setIndoor(amount, kind = 'room') {
    const a = amount > 0 ? Math.min(1, amount) : 0; // NaN 和负数都当露天
    const k = kind === 'hall' ? 'hall' : 'room';
    const step = Math.abs(a - this._indoor);
    if (k === this._kind && (step === 0 || (step < 0.01 && a > 0 && a < 1))) return;
    if (this.ready) {
      const t = this.ctx.currentTime;
      this._indoorNow(t); // 换目标之前，先把旧目标下走到了哪儿结算掉
      setBusIndoor(this.bus, a, t, INDOOR_TAU, k === 'hall' ? 1 : 0);
    }
    this._indoor = a;
    this._kind = k;
  }

  // 室内程度此刻平滑到了多少：和总线参数上的 setTargetAtTime 是同一条指数曲线，不用回读 AudioParam
  _indoorNow(now) {
    const dt = now - this._inT;
    if (dt > 0) {
      this._inV += (this._indoor - this._inV) * (1 - Math.exp(-dt / INDOOR_TAU));
      this._inT = now;
    }
    return this._inV;
  }

  setMaster(volume) {
    const v = Math.max(0, Number.isFinite(volume) ? volume : 1);
    if (v === this._master) return;
    this._master = v;
    if (this.ready) this.bus.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  // 挂起整个上下文（界面音也停）。游戏暂停改用 setWorldPaused，这两个留给切后台之类的场合
  suspend() {
    this._paused = true;
    return this.ctx && !this.offline ? this.ctx.suspend().catch(() => {}) : Promise.resolve();
  }

  resume() {
    this._paused = false;
    return this.ctx && !this.offline ? this.ctx.resume().catch(() => {}) : Promise.resolve();
  }

  _warn(key, msg, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[audio] ${msg}`, err || '');
  }

  // 距离带来的三样东西：直达声衰减（和 PannerNode 的 inverse 模型一致）、空气吸收的低通、混响比例。
  // d 是音色表里的条目（用它的 ref 和 air）。结果写在共用的 SP 里，拿到就用，别存着
  _space(p, d) {
    const l = this.lpos, dist = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z), ref = d.ref || REF;
    const att = dist > ref ? ref / dist : 1;
    SP.att = att;
    SP.cutoff = Math.min(20000, Math.max(1200, 20000 * Math.exp(-dist / (d.air || AIR))), this.ctx.sampleRate * 0.45);
    // 混响按 sqrt(att) 衰减，比直达声慢，越远越“湿”。发送取在声像之后，信号已经乘过 att，所以这里是除。
    // 人在屋里时这份加成收掉，混响跟直达声一起衰减：远处的声源多半在屋外或别的房间，
    // 不收的话 40 米外敌人的枪声进屋反而比在屋外响 4 dB
    const wet = (1 + Math.min(dist / 40, 1)) / Math.sqrt(att);
    SP.wet = wet + (1 - wet) * this._indoorNow(this.ctx.currentTime);
    return SP;
  }

  // 把一路单发的音接进总线。有位置就走 距离和遮挡的低通 → HRTF 声像。混响发送取在声像之后：
  // 送进混响的是已经分好左右的立体声，远处的声音直达声很弱时，靠混响也还听得出方向。
  // far：隔着墙，发送改进 bus.far（只进堆场混响，人在屋里时还要先过低通），不激起听者所在房间的混响
  _route(out, d, pos, cutoff, wet, far) {
    const ctx = this.ctx, extra = [];
    let tap = out;
    if (pos) {
      const { lp, pan } = this._spatial(out, d, pos, cutoff);
      lp.connect(pan).connect(this.bus[d.bus]);
      tap = pan;
      extra.push(lp, pan);
    } else {
      out.connect(this.bus[d.bus]);
      wet = 1;
    }
    if (d.send) {
      const send = ctx.createGain();
      send.gain.value = d.send * wet;
      tap.connect(send).connect(d.bus === 'amb' || far ? this.bus.far : this.bus.reverb);
      extra.push(send);
    }
    return extra;
  }

  // HRTF 按单声道处理输入，带声像的立体声层先在这里合成一路；返回接好 out → lp 的低通和还没接出去的声像
  _spatial(out, d, pos, cutoff) {
    const ctx = this.ctx, lp = ctx.createBiquadFilter(), pan = ctx.createPanner();
    out.channelCount = 1;
    out.channelCountMode = 'explicit';
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.value = cutoff;
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = d.ref || REF;
    pan.rolloffFactor = 1;
    pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z;
    out.connect(lp);
    return { lp, pan };
  }

  _kill(v, at, fade) {
    v.dead = true;
    v.out.gain.cancelScheduledValues(at);
    v.out.gain.setTargetAtTime(0, at, fade / 4);
    v.end = Math.min(v.end, at + fade + 0.02);
  }

  // 播完的音：停掉声源、断开所有节点
  _reap(now) {
    const vs = this.voices;
    let w = 0;
    for (let i = 0; i < vs.length; i++) {
      if (vs[i].end > now) vs[w++] = vs[i]; else dispose(vs[i]);
    }
    vs.length = w;
  }

}
Object.assign(AudioEngine.prototype, worldMethods, loopMethods);

// 低血量时环境声让出来的那一档：闷响 0.7（快死了）时约 -4.5 dB
function ambDuck(muffle) {
  return 1 - 0.45 * Math.min(1, muffle / 0.7);
}

// 离线渲染一段声音，走和实时完全相同的总线；试听页用它做测量。build 里照常调 engine.play / loop。
// 传入实时引擎的 bank，量到的就是实际播放的那几份预渲染变体；不传则每次现合成。
// 开头空出 lead 秒再开始：压缩器刚启动的头一两百毫秒增益还没稳住，贴着 0 秒播的声音会被量小
// indoor：从头就处在这个室内程度（不走过渡），kind 同 setIndoor；tod：时段（不给就是夜里）
export async function renderOffline(build, { seconds = 2, sampleRate = 48000, raw = false, ambient = false, bank, lead = 0.5, indoor = 0, kind = 'room', tod } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + lead) * sampleRate), sampleRate);
  const engine = new AudioEngine();
  engine.setIndoor(indoor, kind);
  if (tod) engine.setTimeOfDay(tod);
  engine.attach(ctx, { offline: true, raw, ambient });
  if (bank) engine.bank = bank;
  ctx.suspend(lead).then(() => {
    build(engine);
    ctx.resume();
  });
  return ctx.startRendering();
}
