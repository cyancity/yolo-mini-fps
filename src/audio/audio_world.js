// AudioEngine 里和“世界状态”有关的那一半：雨量、时段、地面湿度、灯具嗡声、游戏暂停，以及每 200 ms 的定时器
// （收尾播完的音、跟进循环音的距离和遮挡、随机触发环境事件）。audio.js 用 Object.assign 挂到类上，this 就是引擎
import { rnd } from './synth.js';
import { aim, AMB_GAIN } from './bus.js';
import { startAmbient } from './ambient.js';

// 各时段的环境层开度和地面湿度（与 timeofday_presets 的 ground.wetness 一致：夜里下雨全湿，下午还有积水，白天基本干了）
const TOD = {
  night: { day: 0, night: 1, wet: 1 },
  afternoon: { day: 0.6, night: 0, wet: 0.9 },
  day: { day: 1, night: 0, wet: 0.3 },
};
const LAMP_R2 = 14 * 14; // 灯具嗡声只挂在这个距离以内最近的两盏灯上
const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

export const worldMethods = {
  initWorld() {
    this.rain = 1;
    this._tod = 'night';
    this._day = 0;
    this._wet = 1;
    this._worldPaused = false;
    this._lamps = null;
    this._lampSlots = null;
  },

  // attach 里调：起环境声底，按记下的雨量、时段、暂停状态直接到位
  attachWorld(ambient) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.bus.world.gain.value = this._worldPaused ? 0 : 1;
    if (!ambient) return;
    this.ambient = startAmbient(ctx, this.res, this.bus.amb, this.bus.roof, t + 0.02, this.bus.tone);
    this.setRain(this.rain, 0);
    this.setTimeOfDay(this._tod, { wet: this._wet, tau: 0 });
    this.bus.ambOut.gain.setValueAtTime(0, t);
    this.bus.ambOut.gain.linearRampToValueAtTime(AMB_GAIN, t + (this.offline ? 0.05 : 2.5));
    this._nextDrip = t + rnd(2, 4);
    this._nextEvent = t + rnd(12, 30);
    this._nextGull = t + rnd(4, 10);
    this._nextHalyard = t + rnd(5, 12);
  },

  // 雨量 0..1（时段给的）：雨声的两层按它开闸，滴水和远雷只在下雨时有
  setRain(amount, tau = 1.5) {
    this.rain = clamp01(amount);
    this._gate(this.ambient?.rain, this.rain, tau);
  },

  // 时段 'night' | 'afternoon' | 'day'：白天有远处的车流、海鸥和旗绳，夜里有高杆灯的嗡声；同时按时段设地面湿度。
  // wet 给了就用它（比如 TimeOfDay 的 ground.wetness），不给按上面的表
  setTimeOfDay(name, { wet, tau = 1.5 } = {}) {
    const p = TOD[name] || TOD.night;
    this._tod = TOD[name] ? name : 'night';
    this._day = p.day;
    this.setWet(wet ?? p.wet);
    this._gate(this.ambient?.day, p.day, tau);
    this._gate(this.ambient?.night, p.night, tau);
  },

  // 地面湿度 0..1：沥青上的脚步、落地、滑铲、弹着、弹壳按它叠水声，0.05 以下不叠
  setWet(amount) {
    this._wet = clamp01(amount);
  },

  _gate(params, value, tau) {
    if (!params || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const p of params) aim(p, value, t, tau);
  },

  // 灯具的位置列表（[{ x, y, z }]，室内的灯）。引擎只在离听者最近的两盏上挂 lampHum，人走动时定时换过去
  setLamps(list) {
    this._lamps = Array.isArray(list) ? list.filter((p) => p && Number.isFinite(p.x + p.y + p.z)).map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
  },

  // 游戏暂停：世界里的声音（音效、环境声、混响）0.08 秒淡出，界面音照常；上下文不挂起，恢复时没有爆音
  setWorldPaused(on) {
    this._worldPaused = !!on;
    if (!this.ready) return;
    if (!on && this.ctx.state !== 'running' && !this.offline) this.resume();
    this.bus.world.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.02);
  },

  _tick() {
    const ctx = this.ctx, now = ctx.currentTime;
    if (ctx.state !== 'running') return;
    this._reap(now);
    for (const h of this.loops) if (h.live) this._loopSpace(h);
    this._lampTick();
    if (!this.ambient || this._worldPaused) return;
    const rain = this.rain ?? 1, indoor = this._indoorNow(now);
    if (now >= this._nextDrip) {
      // 箱檐的滴水在屋里听不见：越往里越少触发，省得白合成
      if (rain > 0.05 && Math.random() >= indoor) this.play('ambDrip', { volume: rnd(0.3, 1) * rain, delay: rnd(0, 0.2) });
      this._nextDrip = now + rnd(0.4, 2.6);
    }
    if (now >= this._nextEvent) {
      // 不下雨的时段不打雷，那一份概率分给船笛和吊装声
      const r = Math.random() * (rain > 0.3 ? 1 : 0.55) + (rain > 0.3 ? 0 : 0.45);
      this.play(r < 0.45 ? 'ambThunder' : r < 0.8 ? 'ambHorn' : 'ambClang', { volume: rnd(0.6, 1) });
      this._nextEvent = now + rnd(25, 70);
    }
    if (now >= this._nextGull) {
      // 海鸥只在白天，下雨时少；屋里同滴水一样少触发
      if (this._day > 0.05 && Math.random() >= indoor) this.play('ambGull', { volume: rnd(0.4, 1) * this._day * (1 - 0.6 * rain) });
      this._nextGull = now + rnd(6, 18);
    }
    if (now >= this._nextHalyard) {
      if (Math.random() >= indoor) this.play('ambHalyard', { volume: rnd(0.5, 1) * (0.5 + 0.5 * this._day) });
      this._nextHalyard = now + rnd(9, 24);
    }
  },

  // 两个 lampHum 槽位跟着最近的两盏灯走。换灯时先淡出（这一跳），下一跳再挪位置、淡入，挪动时不会听到声像跳
  _lampTick() {
    const lamps = this._lamps;
    if (!lamps?.length) {
      if (this._lampSlots) for (const s of this._lampSlots) if (s.at >= 0) { s.h.set({ volume: 0 }); s.at = -1; }
      return;
    }
    if (!this._lampSlots) this._lampSlots = [0, 1].map(() => ({ h: this.loop('lampHum', { volume: 0, position: lamps[0], pitch: rnd(0.995, 1.005) }), at: -1 }));
    const l = this.lpos, near = [];
    lamps.forEach((p, i) => {
      const d2 = (p.x - l.x) ** 2 + (p.y - l.y) ** 2 + (p.z - l.z) ** 2;
      if (d2 < LAMP_R2) near.push([d2, i]);
    });
    near.sort((a, b) => a[0] - b[0]);
    const want = near.slice(0, 2).map((n) => n[1]);
    const slots = this._lampSlots;
    for (const s of slots) {
      if (s.at >= 0 && !want.includes(s.at)) { s.h.set({ volume: 0 }); s.at = -2; } // 本跳淡出，下一跳才能再用
    }
    for (const i of want) {
      if (slots.some((s) => s.at === i)) continue;
      const s = slots.find((x) => x.at === -1);
      if (!s) continue;
      s.h.set({ position: lamps[i], volume: 1 });
      s.at = i;
    }
    for (const s of slots) if (s.at === -2) s.at = -1;
  },
};
