// AudioEngine 的循环音（无人机旋翼、灯具嗡声、残骸短路）：句柄、链路、定时跟进距离和遮挡。audio.js 用 Object.assign 挂到类上
import { Builder } from './synth.js';
import { aim } from './bus.js';
import { occCut, occGain } from './occlusion.js';
import { LOOPS } from './table.js';
import { dispose, finite, LOOKAHEAD } from './audio.js';

export const loopMethods = {
  // 循环音。返回 { set({ position, volume, pitch }), stop(fade) }。
  // unlock 之前调用也行：句柄先记着参数，unlock 之后自动开始响（期间 stop 掉的就不会响）
  loop(name, { position, volume = 1, pitch = 1 } = {}) {
    const h = { name, volume, pitch, position: position && finite(position) ? { x: position.x, y: position.y, z: position.z } : null, live: null, stopped: false };
    const handle = {
      set: ({ position: p, volume: vol, pitch: pit } = {}) => {
        if (h.stopped) return;
        if (p && finite(p)) { h.position = h.position || {}; h.position.x = p.x; h.position.y = p.y; h.position.z = p.z; }
        if (Number.isFinite(vol)) h.volume = vol;
        if (Number.isFinite(pit)) h.pitch = pit;
        if (h.live) this._loopApply(h);
      },
      stop: (fade = 0.1) => {
        if (h.stopped) return;
        h.stopped = true;
        this._loopStop(h, fade);
      },
    };
    if (!LOOPS[name]) {
      h.stopped = true;
      this._warn(name, `没有这个循环音：${name}`);
      return handle;
    }
    this.loops.add(h);
    if (this.ready) this._loopStart(h);
    return handle;
  },

  // 循环音都是空间化的；没给位置就停在创建时听者所在的地方。
  // 链路：out → 低通 → 遮挡增益 → 声像 → 总线；声像后面两路发送，没挡时进 reverb，挡住时进 far，由 _loopSpace 交叉
  _loopStart(h) {
    const ctx = this.ctx, d = LOOPS[h.name], t0 = ctx.currentTime + LOOKAHEAD;
    const out = ctx.createGain();
    out.gain.value = 0;
    const b = new Builder(ctx, this.res, out, t0);
    const ctl = d.fn(b);
    ctl.setPitch(h.pitch, t0, 0.001);
    const { lp, pan } = this._spatial(out, d, h.position || this.lpos, 20000);
    const occG = ctx.createGain(), near = ctx.createGain(), far = ctx.createGain();
    lp.connect(occG).connect(pan).connect(this.bus[d.bus]);
    pan.connect(near).connect(this.bus.reverb);
    pan.connect(far).connect(this.bus.far);
    far.gain.value = 0;
    h.live = { out, ctl, lp, occG, pan, near, far, occ: 0, extra: [lp, occG, pan, near, far], nodes: b.nodes, sources: b.sources, volume: -1, pitch: h.pitch };
    this._loopSpace(h, 0);
    this._loopApply(h);
  },

  _loopApply(h) {
    const live = h.live, d = LOOPS[h.name], t = this.ctx.currentTime;
    if (h.volume !== live.volume) {
      live.volume = h.volume;
      live.out.gain.setTargetAtTime(h.volume * d.gain, t, 0.06);
    }
    if (Math.abs(h.pitch - live.pitch) > 0.002) {
      live.pitch = h.pitch;
      live.ctl.setPitch(h.pitch, t);
    }
    if (h.position) {
      const pan = live.pan;
      pan.positionX.value = h.position.x; pan.positionY.value = h.position.y; pan.positionZ.value = h.position.z;
    }
  },

  // 距离低通、遮挡和混响比例不用每帧算，定时器里跟一下就够；变化都平滑过去，不出咔哒
  _loopSpace(h, tau = 0.12) {
    const L = h.live, d = LOOPS[h.name], t = this.ctx.currentTime, pos = h.position || this.lpos;
    const occ = this.occluder.test(this.lpos, pos, false, d.lift);
    if (occ >= 0) L.occ = occ; // 超出射线预算时沿用上一次的结果
    const sp = this._space(pos, d), send = d.send * sp.wet, walled = L.occ >= 1;
    aim(L.lp.frequency, Math.min(sp.cutoff, occCut(L.occ)), t, tau);
    aim(L.occG.gain, occGain(L.occ), t, tau);
    aim(L.near.gain, walled ? 0 : send, t, tau);
    aim(L.far.gain, walled ? send : 0, t, tau);
  },

  _loopStop(h, fade) {
    this.loops.delete(h);
    const live = h.live;
    if (!live) return;
    h.live = null;
    const t = this.ctx.currentTime, f = Math.max(0.01, fade);
    live.out.gain.cancelScheduledValues(t);
    live.out.gain.setTargetAtTime(0, t, f / 4);
    setTimeout(() => dispose(live), (f + 0.1) * 1000);
  },
};
