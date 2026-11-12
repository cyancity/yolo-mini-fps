// 玩家设置：菜单里改，存在 localStorage，启动时读回来。界面按 SETTING_DEFS 画控件
const KEY = 'dockzero.settings.v1';

// 动态效果的默认值跟系统的「减少动效」走；玩家亲手改过才写进存档，以存的为准
const FOLLOW_SYSTEM = ['motion'];
const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const SETTING_DEFS = {
  sensitivity: { label: '鼠标灵敏度', min: 0.2, max: 3, step: 0.05, def: 1 },
  adsSensitivity: { label: '开镜灵敏度', min: 0.3, max: 1.5, step: 0.05, def: 0.55 },
  fov: { label: '视野', min: 60, max: 95, step: 1, def: 72 },
  sprintMode: { label: '冲刺', options: [['toggle', '切换'], ['hold', '按住']], def: 'toggle' },
  fullscreen: { label: '全屏', options: [['on', '开'], ['off', '关']], def: 'on' },
  quality: { label: '画质', options: [['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '超高']], def: 'high' },
  brightness: { label: '画面亮度', min: 0.7, max: 1.8, step: 0.05, def: 1 },
  timeOfDay: { label: '时段', options: [['afternoon', '下午'], ['day', '白天'], ['night', '夜晚']], def: 'afternoon' },
  motion: { label: '动态效果', options: [['full', '完整'], ['reduced', '减弱']], def: prefersReduced ? 'reduced' : 'full' },
  volume: { label: '音量', min: 0, max: 1, step: 0.01, def: 0.8 },
  knifeSkin: { label: '爪刀涂装', options: [['steel', '钢色'], ['emerald', '绿宝石']], def: 'emerald' },
};

function clean(key, value) {
  const d = SETTING_DEFS[key];
  if (!d) return undefined;
  if (d.options) return d.options.some(([v]) => v === value) ? value : d.def;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.def;
}

export class Settings {
  constructor() {
    this.values = {};
    // 只在本次运行生效、不写回存档的值（省内存档强制低画质）。玩家在面板里改同一项就解除
    this.forced = {};
    this.listeners = [];
    // 跟系统走的项里，存档里有的或这次运行里玩家改过的
    this.pinned = new Set();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* 存坏了或隐私模式：用默认值 */ }
    // 默认时段从夜晚改成下午之前存下的档（那时还没有「全屏」这一项）：时段按新默认走，别的设置照旧
    if (!('fullscreen' in saved)) delete saved.timeOfDay;
    for (const key of FOLLOW_SYSTEM) if (key in saved) this.pinned.add(key);
    for (const key of Object.keys(SETTING_DEFS)) this.values[key] = clean(key, key in saved ? saved[key] : SETTING_DEFS[key].def);
  }

  keys() { return Object.keys(SETTING_DEFS); }
  get(key) { return key in this.forced ? this.forced[key] : this.values[key]; }

  set(key, value) {
    const v = clean(key, value);
    if (v === undefined) return;
    const before = this.get(key);
    delete this.forced[key];
    if (v !== this.values[key]) {
      this.values[key] = v;
      if (FOLLOW_SYSTEM.includes(key)) this.pinned.add(key);
      const out = { ...this.values };
      for (const k of FOLLOW_SYSTEM) if (!this.pinned.has(k)) delete out[k];
      try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* 存不了就只在这一局生效 */ }
    }
    if (v !== before) this.notify(key, v);
  }

  // 临时覆盖：界面和游戏照常收到变化，存档里还是玩家自己选的值
  force(key, value) {
    const v = clean(key, value);
    if (v === undefined) return;
    const before = this.get(key);
    this.forced[key] = v;
    if (v !== before) this.notify(key, v);
  }

  notify(key, v) { for (const cb of this.listeners) cb(key, v); }

  onChange(cb) { this.listeners.push(cb); }
}
