// 每帧都会被调用的几块状态：技能栏的冷却、练习场的命中统计、罗盘上的敌人方位。都先和上次写入的值比较，没变就不碰 DOM。

// 冷却填充分 40 档：1.6 秒的喷气冷却每 40ms 才写一次
const ABILITY_STEPS = 40;

export class Abilities {
  constructor(root) {
    this.slots = {};
    for (const el of root.querySelectorAll('[data-ability]')) {
      this.slots[el.dataset.ability] = { el, cd: el.querySelector('.hud-ability-cd'), step: ABILITY_STEPS, sec: 0 };
    }
  }

  // remainSec 给了才显示剩余秒数（整数）；喷气只有 1.6 秒，不传
  set(name, ready01, remainSec = 0) {
    const slot = this.slots[name];
    if (!slot) return;
    const r = Math.min(1, Math.max(0, Number(ready01) || 0));
    const step = r >= 0.999 ? ABILITY_STEPS : Math.floor(r * ABILITY_STEPS);
    const sec = step < ABILITY_STEPS && remainSec > 0 ? Math.ceil(remainSec) : 0;
    if (sec !== slot.sec) {
      slot.sec = sec;
      slot.cd.textContent = sec || '';
      slot.el.toggleAttribute('data-count', sec > 0);
    }
    if (step === slot.step) return;
    const wasReady = slot.step === ABILITY_STEPS;
    slot.step = step;
    slot.el.style.setProperty('--cd', step / ABILITY_STEPS);
    const ready = step === ABILITY_STEPS;
    if (ready !== wasReady) slot.el.toggleAttribute('data-ready', ready);
  }
}

export const pct = (part, whole) => (whole > 0 ? `${Math.min(100, Math.round((part / whole) * 100))}%` : '—');

// 练习场：命中率 = 命中 / 开枪，爆头率 = 爆头击倒 / 击倒
export class RangeStats {
  constructor(el) {
    this.acc = el.rangeAcc;
    this.kills = el.rangeKills;
    this.head = el.rangeHead;
    this.v = { shots: -1, hits: -1, kills: -1, headshots: -1 };
  }

  set({ shots = 0, hits = 0, kills = 0, headshots = 0 } = {}) {
    const v = this.v;
    if (shots === v.shots && hits === v.hits && kills === v.kills && headshots === v.headshots) return;
    if (shots !== v.shots || hits !== v.hits) this.acc.textContent = pct(hits, shots);
    if (kills !== v.kills) this.kills.textContent = kills;
    if (kills !== v.kills || headshots !== v.headshots) this.head.textContent = pct(headshots, kills);
    v.shots = shots; v.hits = hits; v.kills = kills; v.headshots = headshots;
  }
}

// 罗盘上的敌人方位：方位角和罗盘读数同一套（0 北，90 东）。看不到的那一侧钉在罗盘边上，
// 两端有淡出遮罩（tokens.css 的 --mask-fade-x，16% 起全不透明），所以只钉到 EDGE 为止，落在遮罩不透明区里
const EDGE = 0.33;

export class CompassMarks {
  constructor(root, view) {
    this.view = view;
    this.yaw = 0;
    this.degs = [];
    this.items = [...root.children].map((el) => ({ el, x: null, on: false, edge: false }));
  }

  // degs 可以是游戏每帧复用的同一个数组：这里拷一份
  set(degs) {
    const n = Math.min(degs?.length || 0, this.items.length);
    let same = n === this.degs.length;
    for (let i = 0; same && i < n; i++) same = Math.abs(degs[i] - this.degs[i]) < 0.05;
    if (same) return;
    this.degs.length = n;
    for (let i = 0; i < n; i++) this.degs[i] = degs[i];
    this.layout();
  }

  setYaw(yaw) {
    this.yaw = yaw;
    if (this.degs.length) this.layout();
  }

  layout() {
    const half = this.view / 2;
    this.items.forEach((item, i) => {
      const on = i < this.degs.length;
      if (on !== item.on) { item.on = on; item.el.toggleAttribute('data-on', on); }
      if (!on) return;
      const rel = ((((this.degs[i] - this.yaw) % 360) + 540) % 360) - 180;
      const edge = Math.abs(rel) > half * EDGE * 2;
      const t = Math.max(-EDGE, Math.min(EDGE, rel / this.view));
      const x = Math.round((50 + t * 100) * 4) / 4; // 0.25% 一档
      if (x !== item.x) { item.x = x; item.el.style.setProperty('--x', `${x}%`); }
      if (edge !== item.edge) { item.edge = edge; item.el.toggleAttribute('data-edge', edge); }
    });
  }
}
