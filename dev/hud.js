// HUD 预览页：不起渲染管线，只用假数据驱动 src/ui/hud.js 的每个状态。
// 控制台里可以用 window.__hud（Hud 实例）和 window.__dev（状态与动作）。
// 标签页在后台时 rAF 不跑：用 __dev.tick(n, dt) 手动推进，__dev.hold(ms) 把正在播的 CSS 动画停在某一时刻再截图。
import { Hud } from '../src/ui/hud.js';
import { SETTING_DEFS } from '../src/game/settings.js';

const hud = new Hud(document.getElementById('hud'));
const scene = document.getElementById('scene');
const panel = document.getElementById('dev');

// 假的设置存储：接口同 src/game/settings.js，但不写 localStorage，免得改到游戏页的设置
const fakeSettings = {
  values: Object.fromEntries(Object.entries(SETTING_DEFS).map(([k, d]) => [k, d.def])),
  listeners: [],
  keys() { return Object.keys(SETTING_DEFS); },
  get(key) { return this.values[key]; },
  set(key, value) {
    const d = SETTING_DEFS[key];
    const v = d.options ? value : Math.min(d.max, Math.max(d.min, Number(value)));
    if (v === this.values[key]) return;
    this.values[key] = v;
    note(`set ${key} ${v}`);
    for (const cb of this.listeners) cb(key, v);
  },
  onChange(cb) { this.listeners.push(cb); },
};
hud.bindSettings(fakeSettings);

const RIFLE = 'KR-7 突击步枪';
const KNIFE = '爪刀';
const LONG_NAME = 'KR-7 突击步枪 · 夜间行动涂装 · 消音器 · 全息瞄具 · 扩容弹匣 · 战术握把';
const MAG = 30;
const RELOAD_S = 1.8;
const COOLDOWN = { dash: 1.6, smoke: 8 };
const BREAK_S = 4; // 清完一个区域到下一个目标出现，同 game.js 的 NEXT_IN
const ZONES = ['堆场', '仓库', '办公楼', '楼顶', '街道']; // 同 plan.js 的 ROUTE

const fresh = () => ({
  slot: 1, mode: '全自动', longName: false, mag: MAG, reserve: 120, hp: 100,
  wave: 1, left: 3, goal: null, score: 0, kills: 0, yaw: 0, spread: 4, cross: true, reload: -1,
  game: 'waves', shots: 0, hits: 0, rKills: 0, heads: 0, dash: 1, smoke: 1,
  next: -1, marks: [],
});
const st = fresh();
let menu = 'hidden';
let auto = true;
let loadTimer = 0;

function showMenu(mode, extra) {
  clearInterval(loadTimer);
  menu = mode;
  hud.showMenu({ mode, ...extra });
}

function loadDemo() {
  let p = 0;
  showMenu('loading', { progress: 0 });
  loadTimer = setInterval(() => {
    p = Math.min(1, p + 0.02 + Math.random() * 0.05);
    hud.showMenu({ mode: 'loading', progress: p });
    if (p >= 1) showMenu('start');
  }, 90);
}

function setMode(mode) {
  st.game = mode;
  hud.setMode(mode);
}

function fire() {
  if (st.slot !== 1 || st.reload >= 0) return;
  if (st.mag <= 0) return reload();
  st.mag--;
  st.shots++;
  st.spread = Math.min(26, st.spread + 5);
}

function reload() {
  if (st.slot !== 1 || st.reload >= 0 || st.mag >= MAG || st.reserve <= 0) return;
  st.reload = 0;
}

// 和游戏里的算分一致：（基础分 + 爆头 70）× 目标序号，练习场不乘
function points(kind, headshot) {
  return ((kind === 'soldier' ? 150 : 100) + (headshot ? 70 : 0)) * (st.game === 'range' ? 1 : Math.max(1, st.wave));
}

function confirmKill(kind = 'soldier', headshot = false) {
  const pts = points(kind, headshot);
  hud.kill({ kind, headshot, points: pts, dist: 20 + Math.random() * 40 });
  hud.hitmarker(true);
  st.kills++;
  st.score += pts;
  if (st.game === 'range') {
    st.hits++;
    st.rKills++;
    if (headshot) st.heads++;
  } else if (st.left > 0 && --st.left <= 0) clearWave();
}

function kill() {
  confirmKill(Math.random() < 0.6 ? 'soldier' : 'drone', Math.random() < 0.3);
}

// 清场：过 BREAK_S 秒自动给下一个目标
function clearWave() {
  st.left = 0;
  st.marks = [];
  st.goal = null;
  st.next = BREAK_S;
  hud.notice('区域已肃清', 2400, 'wave');
}

// 剩两个敌人：一个在正前方偏右，一个在身后（钉在罗盘左边）
function lastTwo() {
  st.left = 2;
  st.next = -1;
  st.marks = [st.yaw + 25, st.yaw - 150];
}

// 字段同 game.stats()；死因是假的，验收阵亡页的副标题用
const stats = () => {
  const range = st.game === 'range';
  return {
    mode: st.game, wave: st.wave, zones: st.wave - 1, kills: range ? st.rKills : st.kills, score: st.score,
    shots: st.shots, hits: Math.min(st.hits, st.shots), headshots: st.heads, time: 187,
    death: { kind: 'soldier', dist: 23.4 },
  };
};

// 验收用：三连杀，第二个是爆头
function chain3() {
  confirmKill('soldier', false);
  confirmKill('soldier', true);
  confirmKill('drone', false);
}

function useAbility(name) {
  if (st[name] < 1) return;
  st[name] = 0;
}

// 下一个目标：区域在右前方 40 度，罗盘上出菱形
function nextWave() {
  st.wave++;
  st.left = Math.min(6, 3 + ((st.wave - 1) >> 1));
  st.next = -1;
  st.marks = [];
  st.goal = st.yaw + 40;
  hud.notice(`前往${ZONES[(st.wave - 1) % ZONES.length]}`, 2600, 'wave');
}

function hurt(amount = 12, angle = Math.random() * Math.PI * 2) {
  hud.damage(angle);
  st.hp = Math.max(0, st.hp - amount);
  if (st.hp <= 0) showMenu('dead', { stats: stats() });
}

function reset() {
  const game = st.game;
  Object.assign(st, fresh(), { game });
  hud.resetRun();
}

// 把页面上正在播的 CSS 动画停在第 ms 毫秒（截图用）；不传参数就全部继续
function hold(ms) {
  for (const a of document.getAnimations()) {
    if (ms === undefined) { a.play(); continue; }
    a.pause();
    a.currentTime = ms;
  }
}

const toggles = {
  自动演示: () => (auto = !auto),
  亮背景: () => (scene.dataset.bg = scene.dataset.bg === 'bright' ? 'night' : 'bright') === 'bright',
  准星: () => (st.cross = !st.cross),
  FPS: () => hud.toggleFps(),
};

const groups = {
  菜单: {
    加载: loadDemo,
    开始: () => showMenu('start'),
    暂停: () => showMenu('paused', { stats: stats() }),
    阵亡: () => showMenu('dead', { stats: stats() }),
    关闭: () => showMenu('hidden'),
  },
  玩法: { 实战: () => setMode('waves'), 练习场: () => setMode('range') },
  武器: {
    步枪: () => (st.slot = 1),
    爪刀: () => (st.slot = 3),
    模式: () => (st.mode = st.mode === '全自动' ? '单发' : '全自动'),
    长名: () => (st.longName = !st.longName),
  },
  弹药: { 开火: fire, 换弹: reload, 打空: () => (st.mag = 0), 剩五发: () => (st.mag = 5) },
  生命: { '−12': () => hurt(), 低血: () => (st.hp = 24), 回满: () => (st.hp = 100) },
  技能: { 喷气: () => useAbility('dash'), 烟雾弹: () => useAbility('smoke') },
  击倒: {
    普通: () => confirmKill('soldier', false),
    爆头: () => confirmKill('soldier', true),
    无人机: () => confirmKill('drone', false),
    靶子: () => confirmKill('target', Math.random() < 0.4),
    三连杀: chain3,
  },
  反馈: {
    命中: () => hud.hitmarker(),
    击毁: () => kill(),
    受击: () => hud.damage(Math.random() * Math.PI * 2),
    横幅: () => hud.notice('无人机接近'),
    长横幅: () => hud.notice('三号泊位发现重型无人机编队，正在从北侧龙门吊方向接近', 5000),
    大分数: () => (st.score = 1234567890),
  },
  目标: {
    下一个: nextWave,
    进入区域: () => (st.goal = null),
    剩两个: lastTwo,
    清场: clearWave,
  },
  画面: toggles,
};

for (const [name, actions] of Object.entries(groups)) {
  const set = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = name;
  set.append(legend);
  for (const [label, run] of Object.entries(actions)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (actions === toggles) button.setAttribute('aria-pressed', label === '自动演示' || label === '准星');
    button.addEventListener('click', () => {
      const result = run();
      if (actions === toggles) button.setAttribute('aria-pressed', !!result);
    });
    set.append(button);
  }
  panel.append(set);
}

const events = document.createElement('output');
events.textContent = '事件：无';
const collapse = document.createElement('button');
collapse.type = 'button';
collapse.className = 'dev-toggle';
collapse.textContent = '收起';
collapse.addEventListener('click', () => {
  collapse.textContent = panel.toggleAttribute('data-collapsed') ? '面板' : '收起';
});
panel.append(events, collapse);

function note(text) { events.textContent = `事件：${text}`; }
hud.on('start', (mode) => { note(`start ${mode}`); setMode(mode || st.game); reset(); showMenu('hidden'); });
hud.on('resume', () => { note('resume'); showMenu('hidden'); });
hud.on('restart', () => { note('restart'); reset(); setMode(st.game); showMenu('hidden'); });

// 自动演示：模拟一局里每帧都在变的量，顺便让高频方法走「值没变就不写 DOM」的路径
const acc = { fire: 0, hit: 0, kill: 0, hurt: 0, dash: 0 };
function simulate(dt) {
  st.yaw += dt * 22;
  for (const k in acc) acc[k] += dt;
  if (st.slot === 1 && acc.fire > 0.11) { acc.fire = 0; fire(); }
  if (acc.hit > 0.45) { acc.hit = 0; hud.hitmarker(); if (st.game === 'range') st.hits++; }
  if (acc.kill > 2.4) { acc.kill = 0; kill(); }
  if (acc.hurt > 3.1 && st.game === 'waves') { acc.hurt = 0; hurt(9); }
  if (acc.dash > 2.7) { acc.dash = 0; useAbility('dash'); }
}

function update(dt) {
  if (auto && menu === 'hidden') simulate(dt);
  st.spread = Math.max(4, st.spread - dt * 40);
  st.dash = Math.min(1, st.dash + dt / COOLDOWN.dash);
  st.smoke = Math.min(1, st.smoke + dt / COOLDOWN.smoke);
  if (st.next >= 0 && (st.next -= dt) < 0) nextWave();
  if (st.reload >= 0) {
    st.reload += dt / RELOAD_S;
    if (st.reload >= 1) {
      const take = Math.min(MAG - st.mag, st.reserve);
      st.mag += take;
      st.reserve -= take;
      st.reload = -1;
    }
  }

  const rifle = st.slot === 1;
  hud.setWeapon(st.slot, st.longName ? LONG_NAME : rifle ? RIFLE : KNIFE, rifle ? st.mode : '');
  hud.setAmmo(st.mag, rifle ? (st.game === 'range' ? Infinity : st.reserve) : null);
  hud.setHealth(st.hp);
  hud.setObjective(st.game === 'range' ? '' : ZONES[(st.wave - 1) % ZONES.length], st.left);
  hud.setCompassMarks(st.game === 'range' ? [] : st.marks);
  hud.setCompassGoal(st.game === 'range' ? null : st.goal);
  hud.setScore(st.score);
  hud.setCompass(st.yaw);
  hud.setCrosshair({ spread: st.spread, visible: st.cross });
  hud.setReloading(st.reload >= 0, Math.max(0, st.reload));
  hud.setAbility('dash', st.dash);
  hud.setAbility('smoke', st.smoke, (1 - st.smoke) * COOLDOWN.smoke);
  if (st.game === 'range') hud.setRange({ shots: st.shots, hits: Math.min(st.hits, st.shots), kills: st.rKills, headshots: st.heads });
}

let last = performance.now();
let fps = 60;
let paused = false; // 截图时停住冷却和自动演示，只用 tick 推进
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (!paused) update(dt);
  hud.setFps(fps);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(dt); return { ...st }; };

window.__hud = hud;
window.__dev = {
  st, showMenu, loadDemo, fire, reload, kill, confirmKill, chain3, useAbility, hurt, nextWave, clearWave, lastTwo, reset, setMode, tick, hold,
  settings: fakeSettings,
  pause: (on = true) => (paused = on),
  setAuto: (on) => (auto = on),
  setBg: (bg) => (scene.dataset.bg = bg),
  LONG_NAME,
};
