// 预渲染：把每个音提前离线渲染成几份变体。实时合成一发步枪要建六七十个节点，全自动射击再叠上几路敌人交火，
// 音频线程会跑不过来（实测出现断续）；烤好以后播放只是一个 BufferSource。没烤好的音先实时合成顶着。
import { Builder } from './synth.js';
import { SOUNDS } from './table.js';

// 先后顺序：开局最先用到、也最费节点的排前面
const FIRST = ['rifleShot', 'shell', 'footstep', 'impactMetal', 'impactAsphalt', 'impactConcrete', 'droneShot', 'npcShot', 'droneExplode', 'hitmarker', 'bulletWhiz'];
const LANES = 3; // 同时渲染几批。每个离线上下文有自己的渲染线程，并行能把总时间压到三分之一左右
// 一批里塞几份、最长几秒：建一个离线上下文、起一次渲染的固定开销比渲染一秒声音还贵（实测把所有 len 改成 0.02 秒，
// 总耗时只少三成），所以几份变体首尾相接放进同一个上下文，渲染完再切开。每份的节点在渲染走到它那一段时才建
// （offline.suspend），上一份同时断开：一开始就全部建好的话，后面几份的滤波器从 0 秒起就在空转，反而更慢
const BATCH = 8;
const BATCH_SECONDS = 6;
const GAP = 0.02; // 两份之间空出一点，滤波器和延时线的余音不会串到下一份里

const lenOf = (d, surface) => d.lenOf?.[surface] ?? d.len;

// 渲染结果收尾：从 [start, start + len) 切出一份，去掉尾部静音；左右声道一样、或者这个音只会被空间化播放，就存成单声道
function pack(ctx, buf, start, len, mono) {
  const L = buf.getChannelData(0).subarray(start, start + len), R = buf.getChannelData(1).subarray(start, start + len);
  let n = L.length, same = true;
  while (n > 1 && Math.abs(L[n - 1]) < 3e-4 && Math.abs(R[n - 1]) < 3e-4) n--;
  n = Math.min(L.length, n + 480);
  for (let i = 0; i < n && same; i += 5) same = Math.abs(L[i] - R[i]) < 1e-6;
  const ch = mono || same ? 1 : 2, out = ctx.createBuffer(ch, n, buf.sampleRate), fade = Math.min(n, 960);
  for (let c = 0; c < ch; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = ch === 2 ? (c ? R[i] : L[i]) : (L[i] + R[i]) * 0.5;
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  }
  return out;
}

// 把表里的音烤进 engine.bank（音名，带材质的是 “音名:材质” → 几份变体）。
// table 默认是正式的音色表，试听页拿别的表来比预渲染的耗时；batch 为 1 就是一份一个上下文的老做法
export async function bake(engine, lanes = LANES, table = SOUNDS, batch = BATCH) {
  const { ctx, res, bank } = engine, sr = ctx.sampleRate;
  const order = [...FIRST.filter((n) => table[n]), ...Object.keys(table).filter((n) => !FIRST.includes(n))];
  const most = Math.max(...order.map((n) => table[n].n));
  const jobs = [];
  for (let pass = 0; pass < most; pass++) { // 一轮只排每个音的一份，所有音都尽快有得用
    for (const name of order) {
      const d = table[name];
      if (pass < d.n) for (const surface of d.surfaces || [undefined]) jobs.push([name, d, surface]);
    }
  }
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const group = [];
      let seconds = 0;
      while (next < jobs.length && group.length < batch && (!group.length || seconds + lenOf(jobs[next][1], jobs[next][2]) <= BATCH_SECONDS)) {
        const job = jobs[next++];
        group.push({ job, at: seconds });
        seconds = (Math.ceil(((seconds + lenOf(job[1], job[2]) + GAP) * sr) / 128) * 128) / sr; // suspend 只能停在 128 帧的边界上
      }
      const off = new OfflineAudioContext(2, Math.ceil(seconds * sr) + 128, sr);
      let prev = null;
      for (const g of group) {
        const [name, d, surface] = g.job, len = lenOf(d, surface);
        const build = () => {
          if (prev) prev.disconnect();
          const gate = (prev = off.createGain()); // 闸门：越界的余音一律切掉
          gate.gain.setValueAtTime(1, g.at);
          gate.gain.setValueAtTime(0, g.at + len);
          gate.connect(off.destination);
          const b = new Builder(off, res, gate, g.at, { pitch: 1, surface });
          d.fn(b, b.o);
          if (b.end - g.at > len) engine._warn(`len:${name}`, `${name} 长 ${(b.end - g.at).toFixed(2)} s，超过表里的 len，尾巴被截掉了`);
        };
        if (g.at === 0) build();
        else off.suspend(g.at).then(() => { build(); off.resume(); });
      }
      const buf = await off.startRendering();
      for (const { job: [name, d, surface], at } of group) {
        const key = surface ? `${name}:${surface}` : name;
        if (!bank.has(key)) bank.set(key, []);
        bank.get(key).push(pack(ctx, buf, Math.round(at * sr), Math.round(lenOf(d, surface) * sr), d.mono));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, lanes) }, lane));
}
