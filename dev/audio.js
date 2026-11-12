// 音效试听页：每个音一个按钮；离线渲染后测峰值、RMS、时长和频谱。控制台里用 __audio。
// 测量按职责放在 audio_dsp / audio_measure / audio_tests / audio_kit，这里只管页面装配
import { renderOffline, SOUND_NAMES, LOOP_NAMES, SURFACES } from '../src/audio/audio.js';
import { engine, PER_SURFACE, firefight, flick } from './audio_common.js';
import { analyze, bands, decay, fill, echoDensity, curvature } from './audio_dsp.js';
import { measure, measureSound, measureAll, fmt } from './audio_measure.js';
import { mixTest, indoorTest, clickTest, bakeTime } from './audio_tests.js';
import { KIT, kitReport, switchSpam, killOverBurst, targetFar, contribution } from './audio_kit.js';
import * as polish from './audio_polish.js';

const each = (name) => SURFACES.map((s) => [name, s]);
const GROUPS = [
  ['步枪', ['rifleShot', 'rifleDry', 'magOut', 'magIn', 'boltRack', 'boltRelease', 'selector', 'shell', 'shellSoft', 'weaponRaise']],
  ['拟音', ['reloadGrab', 'magRelease', 'magSeat', 'reloadSettle', 'inspectCloth', 'inspectTap', 'gear', ...each('magDrop')]],
  ['爪刀', ['knifeDraw', 'knifeSwing', 'knifeHitMetal', 'knifeHitSoft', 'knifeHitHard', 'knifeHitDull', 'knifeSpin']],
  ['脚步', [...each('footstep'), 'jump']],
  ['落地', each('land')],
  ['滑铲', each('slide')],
  ['弹着', ['impactMetal', 'impactConcrete', 'impactWood', 'impactAsphalt', 'impactGlass', 'impactSoft', 'impactGravel', 'ricochet', 'bulletWhiz']],
  ['水声', ['splashStep', 'splashHit', 'splashSlide', 'splashShell']],
  ['无人机', ['droneShot', 'droneHit', 'droneExplode', 'droneAlert', 'droneCrash']],
  ['敌人', ['npcShot', 'npcHurt', 'npcDeath', 'bodyHit', 'npcAlert', 'npcMagOut', 'npcMagIn', ...each('npcStep')]],
  ['技能', ['weaponSwitch', 'dash', 'smokeThrow', 'smokeBounce', 'smokeBurst']],
  ['靶场', ['targetHit', 'targetDown', 'targetReset']],
  ['界面', ['hurt', 'hitmarker', 'headshot', 'killConfirm', 'killHeadshot', 'waveStart', 'waveClear', 'uiClick', 'uiHover', 'heartbeat', 'playerDeath', 'regenBreath']],
  ['环境', ['ambThunder', 'ambHorn', 'ambClang', 'ambDrip', 'ambGull', 'ambHalyard']],
];
// 听者站在原点、面朝 -Z
const SPOTS = { 贴身: null, '右前 6 米': { x: 4.2, y: 1.6, z: -4.2 }, '左后 20 米': { x: -14, y: 1.6, z: 14 }, '正前 60 米': { x: 0, y: 3, z: -60 } };
const state = { spot: null, volume: 1, pitch: 1, indoor: 0, kind: 'room', paused: false };
const rnd = (a, b) => a + Math.random() * (b - a);

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

async function ensure() {
  const first = !engine.ctx;
  await engine.unlock();
  engine.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  showState();
  if (first) engine.baked.then(showState);
}

function showState() {
  let bytes = 0;
  for (const list of engine.bank.values()) for (const b of list) bytes += b.length * b.numberOfChannels * 4;
  stateEl.textContent = `${engine.ctx.state} · ${engine.ctx.sampleRate} Hz · 预渲染 ${engine.bank.size} 组 ${(bytes / 1048576).toFixed(1)} MB`;
  stateEl.classList.toggle('on', engine.ctx.state === 'running');
}

const opts = (extra) => ({ position: state.spot, volume: state.volume, pitch: state.pitch, ...extra });


const COMBOS = {
  '连发 12 发': () => {
    for (let i = 0; i < 12; i++) {
      engine.play('rifleShot', opts({ delay: i * 0.092 }));
      engine.play('shell', opts({ delay: i * 0.092 + rnd(0.32, 0.45), volume: state.volume * 0.8 }));
    }
  },
  换弹: () => {
    engine.play('magOut', opts());
    engine.play('magIn', opts({ delay: 0.8 }));
    engine.play('boltRelease', opts({ delay: 1.4 }));
  },
  每种地面走两步: () => SURFACES.forEach((surface, i) => {
    engine.play('footstep', opts({ surface, delay: i * 0.8 }));
    engine.play('footstep', opts({ surface, delay: i * 0.8 + 0.4 }));
  }),
  敌人靠近: () => {
    for (let i = 0; i < 8; i++) engine.play('npcStep', { surface: 'concrete', delay: i * 0.38, position: { x: 3, y: 0.1, z: -18 + i * 2 } });
    engine.play('npcAlert', { delay: 3.1, position: { x: 3, y: 1.6, z: -3 } });
  },
  交火: () => firefight(engine),
  '连切枪 12 次/秒': () => flick(engine),
  烟雾弹: () => {
    engine.play('smokeThrow', opts());
    [[0.55, 1], [0.8, 0.55], [0.97, 0.3]].forEach(([delay, volume]) => engine.play('smokeBounce', opts({ delay, volume: state.volume * volume })));
    engine.play('smokeBurst', opts({ delay: 1.6 }));
  },
  '钢靶 50 米': () => {
    const target = { x: 0, y: 1.2, z: -50 };
    for (let i = 0; i < 3; i++) {
      engine.play('rifleShot', { delay: i * 0.5, volume: 0.9 });
      engine.play('targetHit', { delay: i * 0.5, position: target });
    }
    engine.play('targetDown', { delay: 1, position: target });
  },
  连发中击杀: () => {
    for (let i = 0; i < 12; i++) engine.play('rifleShot', { delay: i * 0.092, volume: 0.9 });
    engine.play('killConfirm', { delay: 0.276, volume: 0.8 });
    engine.play('killHeadshot', { delay: 0.736, volume: 0.8 });
  },
  全部过一遍: () => playAll(),
};

function playAll(gap = 0.6) {
  let t = 0;
  for (const name of SOUND_NAMES) {
    for (const surface of PER_SURFACE.includes(name) ? SURFACES : [undefined]) {
      engine.play(name, opts({ surface, delay: t }));
      t += name.startsWith('amb') || name === 'droneExplode' ? gap * 3 : name === 'slide' ? gap * 2 : gap;
    }
  }
  return t;
}

// ---------- 界面 ----------
const stateEl = el('span', { id: 'state', textContent: '未启用' });
const slider = (text, min, max, value, onInput) => {
  const input = el('input', { type: 'range', min, max, step: 0.01, value });
  input.addEventListener('input', () => onInput(+input.value));
  return el('label', {}, text, input);
};
const spot = el('select', {}, ...Object.keys(SPOTS).map((k) => el('option', { textContent: k })));
spot.addEventListener('change', () => { state.spot = SPOTS[spot.value]; });
const kind = el('select', {}, el('option', { value: 'room', textContent: '小房间' }), el('option', { value: 'hall', textContent: '大厅' }));
kind.addEventListener('change', () => { state.kind = kind.value; engine.setIndoor(state.indoor, state.kind); });
const tod = el('select', {}, ...['night', 'afternoon', 'day'].map((v) => el('option', { value: v, textContent: v })));
tod.addEventListener('change', () => engine.setTimeOfDay(tod.value));

function button(text, run, cls = '') {
  const b = el('button', { textContent: text, className: cls });
  b.addEventListener('click', async () => {
    await ensure();
    run(b);
  });
  return b;
}

const loops = {};
function toggleLoop(name, b) {
  if (loops[name]) {
    loops[name].stop(0.3);
    delete loops[name];
  } else {
    loops[name] = engine.loop(name, { position: { x: 3, y: 1.6, z: -2 } });
  }
  b.classList.toggle('on', !!loops[name]);
}

// 旋翼绕着听者飞，顺便起伏一点转速，方便听 HRTF 和连续变调
function animate(ms) {
  const t = ms / 1000;
  loops.droneRotor?.set({ position: { x: Math.sin(t * 0.7) * 8, y: 3 + Math.sin(t * 0.4) * 1.5, z: Math.cos(t * 0.7) * 8 }, pitch: 1 + 0.18 * Math.sin(t * 1.3) });
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

const table = el('table');
const report = el('pre', { id: 'report' });
const show = async (run) => { report.textContent = '测量中…'; report.textContent = JSON.stringify(await run(), null, 1); };
document.body.append(
  el('header', {},
    el('h1', { textContent: '音效试听' }),
    button('启用音频', () => {}, 'main'),
    stateEl,
    el('label', {}, '位置', spot),
    slider('音量', 0, 1.5, 1, (v) => { state.volume = v; }),
    slider('音高', 0.5, 1.5, 1, (v) => { state.pitch = v; }),
    slider('主音量', 0, 1, 1, (v) => engine.setMaster(v)),
    slider('闷响', 0, 1, 0, (v) => engine.setMuffle(v)),
    slider('室内', 0, 1, 0, (v) => { state.indoor = v; engine.setIndoor(v, state.kind); }),
    el('label', {}, '房间', kind),
    el('label', {}, '时段', tod),
    slider('地面湿度', 0, 1, 1, (v) => engine.setWet(v)),
  ),
  ...GROUPS.map(([title, items]) => el('section', {},
    el('h2', { textContent: title }),
    el('div', { className: 'row' }, ...items.map((item) => {
      const [name, surface] = Array.isArray(item) ? item : [item];
      return button(surface ? `${name}:${surface}` : name, () => engine.play(name, opts({ surface })));
    })),
  )),
  el('section', {},
    el('h2', { textContent: '循环' }),
    el('div', { className: 'row' }, ...LOOP_NAMES.map((name) => button(name, (b) => toggleLoop(name, b)))),
  ),
  el('section', {},
    el('h2', { textContent: '组合' }),
    el('div', { className: 'row' },
      ...Object.entries(COMBOS).map(([text, run]) => button(text, run, 'main')),
      button('暂停 / 继续', (b) => { state.paused = !state.paused; engine.setWorldPaused(state.paused); b.classList.toggle('on', state.paused); }, 'main'),
    ),
  ),
  el('section', {},
    el('h2', { textContent: '测量' }),
    el('div', { className: 'row' },
      button('全表', () => fillTable(), 'main'),
      button('交火压总线', () => show(mixTest), 'main'),
      button('室内外对比', () => show(indoorTest), 'main'),
      button('切换有无咔哒', () => show(clickTest), 'main'),
      button('预渲染计时', () => show(bakeTime), 'main'),
      button('新音测量', () => show(kitReport), 'main'),
      button('连切枪', () => show(switchSpam), 'main'),
      button('连发中击杀', () => show(killOverBurst), 'main'),
      button('钢靶 50 米', () => show(targetFar), 'main'),
      ...[['遮挡', 'occlusionTest'], ['大厅混响', 'hallTest'], ['湿度水声', 'splashTest'], ['心跳', 'heartbeatTest'], ['敌人脚步', 'npcStepTest'],
        ['落地材质', 'landTest'], ['暂停', 'pauseTest'], ['时段环境声', 'ambientTest'], ['新音配平', 'newReport'], ['预渲染新旧对比', 'bakeCompare'], ['len 余量', 'lenCheck']]
        .map(([text, fn]) => button(text, () => show(polish[fn]), 'main')),
    ),
  ),
  table,
  report,
);

async function fillTable() {
  await engine.baked;
  table.replaceChildren(el('tr', {}, ...['音', '峰值', 'RMS', '最响 50 ms', 'A 计权', '时长 s', '重心 Hz', '低/中/高 %'].map((t) => el('th', { textContent: t }))));
  const row = (label, r) => table.append(el('tr', {}, el('td', { textContent: label }), ...fmt(r).map((t, i) => el('td', { textContent: t, className: i === 0 && r.peak > 0.98 ? 'warn' : '' }))));
  for (const [label, r] of Object.entries(await measureAll())) row(label, r);
  const auto = (a) => { for (let i = 0; i < 12; i++) a.play('rifleShot', { delay: i * 0.092 }); };
  row('rifleShot ×12 连发', await measure(auto, { seconds: 4 }));
  row('交火（连发 + 3 敌人 + 爆炸）', await measure((a) => firefight(a, true), { seconds: 4 }));
  for (const name of LOOP_NAMES) row(`${name}（循环）`, await measure((a) => a.loop(name, { position: { x: 0, y: 0, z: -3 } }), { n: 1, seconds: 3 }));
  for (const indoor of [0, 0.5, 1]) row(`环境声底（室内 ${indoor}）`, await measure(() => {}, { n: 1, seconds: 10, ambient: true, indoor }));
}

window.__audio = {
  engine, renderOffline, analyze, bands, decay, fill, echoDensity, curvature, measure, measureSound, measureAll, playAll, fillTable,
  mixTest, indoorTest, clickTest, bakeTime, firefight, SOUND_NAMES, LOOP_NAMES, SURFACES,
  kitReport, switchSpam, killOverBurst, targetFar, contribution, KIT, polish,
};
