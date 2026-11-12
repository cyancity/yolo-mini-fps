// 音色表：每个音名对应的合成函数、配平和播放策略；以及按地面材质选音名的映射（IMPACT、KNIFE_HIT）。
import * as W from './sounds_weapons.js';
import * as E from './sounds_world.js';
import * as M from './sounds_move.js';
import * as N from './sounds_npc.js';
import * as K from './sounds_kit.js';
import * as H from './sounds_hits.js';
import * as F from './sounds_foley.js';
import * as A from './ambient.js';
import * as AD from './ambient_day.js';

export const SURFACES = ['asphalt', 'metal', 'wood', 'concrete', 'carpet', 'gravel'];
// 关卡里别的材质名先归到最接近的一种；归不上的一律按第一种（沥青）处理
// 用 Map 查：普通对象上 'constructor' 这类名字会查到原型上的函数
const ALIAS = new Map([['fabric', 'carpet'], ['glass', 'concrete']]);
export const surfaceOf = (name) => (SURFACES.includes(name) ? name : ALIAS.get(name) || SURFACES[0]);

// 子弹打在各种表面上放哪个音（玩家和敌人的子弹共用）。不认识的材质按沥青
const IMPACT = new Map([
  ['asphalt', 'impactAsphalt'], ['metal', 'impactMetal'], ['wood', 'impactWood'], ['concrete', 'impactConcrete'],
  ['carpet', 'impactSoft'], ['fabric', 'impactSoft'], ['glass', 'impactGlass'], ['gravel', 'impactGravel'],
]);
export const impactSound = (surface) => IMPACT.get(surface) || 'impactAsphalt';
// 刀砍在世界表面上：钢板当当响，木头和地毯发闷，其余硬面是刀尖崩一下。砍到人另放 bodyHit / knifeHitSoft
const KNIFE_HIT = new Map([['metal', 'knifeHitMetal'], ['wood', 'knifeHitDull'], ['carpet', 'knifeHitDull'], ['fabric', 'knifeHitDull']]);
export const knifeHitSound = (surface) => KNIFE_HIT.get(surface) || 'knifeHitHard';

// gain：按离线测量校准的配平（目标是过总线前“最响 50 ms”的 RMS：步枪 0.35，爆炸 0.2，其余更低）。
// 低频为主和高频为主的音放在一起比谁响（各种地面、敌人对玩家的脚步）时，看试听页表里的 A 计权一列
// send：混响发送量　prio：路数满了以后谁先被挤掉　max：同名音同时最多几个
// ref：空间化参考距离，响的声音传得远　choke：同组的新音会压低旧音的尾巴
// n / len：预渲染几份变体、每份最长几秒（n 为 0 就不预渲染）；lenOf：个别材质要更长的尾巴
// mono：只会被空间化播放，预渲染成单声道
// jitter：每次播放响度随机起伏的幅度　surfaces：按地面材质各渲染一套
// detune：播放时随机变调的幅度（0.03 即 ±3%）。只给低频为主的音，高频咔哒变调会损失一些
// tail：音里烤进了室外的回声和远场尾巴，从起音后这么多秒开始；人在室内时引擎把这一段压下去，换成房间混响
// air：空气吸收的距离尺度（米），越小高频随距离掉得越快；不写用引擎默认的 45
// sonic：带位置播放时按距离晚到（声速 343 m/s），50 米外晚约 0.15 s
// occ：false 时不做遮挡判定（贴身的小声音）　splash：[音名, 比例]，落在沥青上时按地面湿度叠一层水声
// bySurface：按材质换成另一个音（弹壳落在地毯上）　pump：每次播放把环境声按到这个比例，随后放回来
const def = (fn, gain, send, prio, extra) => ({ fn, gain, send, prio, bus: 'sfx', n: 3, len: 1.3, jitter: 0.08, ...extra });
const ui = (fn, gain, extra) => ({ fn, gain, send: 0, prio: 7, bus: 'ui', n: 1, len: 1.3, jitter: 0, ...extra });
const amb = (fn, gain, send, prio) => ({ fn, gain, send, prio, bus: 'amb', max: 4, n: 0, jitter: 0 }); // 很少响，现合成就行
const IMP = { max: 5, ref: 4, n: 5, mono: true, jitter: 0.15, detune: 0.03 };
const SPLASH = { send: 0.1, prio: 0, n: 4, jitter: 0.2, occ: false };

export const SOUNDS = {
  rifleShot: def(W.rifleShot, 0.42, 0.3, 9, { choke: 'rifle', ref: 9, n: 8, len: 1.6, jitter: 0.05, tail: 0.05 }),
  rifleDry: def(W.rifleDry, 0.63, 0.05, 5, { n: 2, len: 0.2 }),
  magOut: def(W.magOut, 0.51, 0.06, 5, { n: 3, len: 0.4 }),
  magIn: def(W.magIn, 0.57, 0.06, 5, { n: 3, len: 0.42 }),
  boltRack: def(W.boltRack, 0.5, 0.08, 5, { n: 2, len: 0.65 }),
  boltRelease: def(W.boltRelease, 0.5, 0.08, 5, { n: 2, len: 0.42 }),
  selector: def(W.selector, 0.53, 0.04, 4, { n: 2, len: 0.16 }),
  // 换弹和检视的拟音：填上抽匣和入匣之间的空当
  reloadGrab: def(F.reloadGrab, 0.52, 0.05, 4, { n: 3, len: 0.2 }),
  magRelease: def(F.magRelease, 0.64, 0.04, 4, { n: 2, len: 0.1 }),
  magSeat: def(F.magSeat, 0.48, 0.05, 4, { n: 3, len: 0.25 }),
  reloadSettle: def(F.reloadSettle, 0.44, 0.05, 4, { n: 2, len: 0.4 }),
  magDrop: def(F.magDrop, 0.4, 0.15, 3, { max: 3, ref: 3, n: 2, len: 0.28, lenOf: { metal: 1.1, wood: 0.4 }, mono: true, surfaces: SURFACES, detune: 0.04, occ: false }),
  inspectCloth: def(F.inspectCloth, 0.46, 0.04, 3, { n: 2, len: 0.45 }),
  inspectTap: def(F.inspectTap, 0.8, 0.05, 3, { n: 2, len: 0.3 }),
  shell: def(W.shell, 0.4, 0.12, 1, { max: 6, ref: 2, n: 6, len: 0.75, jitter: 0.15, occ: false, splash: ['splashShell', 1], bySurface: { carpet: 'shellSoft' } }),
  shellSoft: def(H.shellSoft, 0.96, 0.05, 1, { max: 6, ref: 2, n: 3, len: 0.15, jitter: 0.15, occ: false }),
  knifeDraw: def(W.knifeDraw, 0.22, 0.12, 5, { choke: 'knife', n: 2, len: 1.75 }),
  knifeSwing: def(W.knifeSwing, 0.39, 0.05, 5, { n: 4, len: 0.33 }),
  knifeHitMetal: def(W.knifeHitMetal, 0.35, 0.25, 6, { len: 1.4 }),
  knifeHitSoft: def(W.knifeHitSoft, 0.44, 0.1, 6, { len: 0.3 }),
  knifeHitHard: def(H.knifeHitHard, 0.48, 0.15, 6, { len: 0.52 }),
  knifeHitDull: def(H.knifeHitDull, 0.7, 0.1, 6, { len: 0.25, detune: 0.03 }),
  knifeSpin: def(W.knifeSpin, 0.46, 0.04, 4, { choke: 'knife', n: 2, len: 1.75 }),
  weaponRaise: def(W.weaponRaise, 0.6, 0.04, 4, { len: 0.4 }),
  // 六种地面。份数少的靠播放时的 ±3% 变调和“不重复最近几份”的洗牌拉开
  footstep: def(M.footstep, 0.35, 0.1, 2, { max: 4, ref: 3, n: 4, len: 0.4, lenOf: { metal: 0.98 }, jitter: 0.12, surfaces: SURFACES, detune: 0.03, splash: ['splashStep', 0.8] }),
  jump: def(M.jump, 0.47, 0.06, 3, { n: 4, len: 0.38, detune: 0.03 }),
  land: def(M.land, 0.39, 0.12, 4, { n: 4, len: 0.6, lenOf: { metal: 1.95 }, surfaces: SURFACES, detune: 0.03, splash: ['splashStep', 1.2] }),
  slide: def(M.slide, 0.4, 0.08, 3, { max: 2, n: 4, len: 1, surfaces: SURFACES, detune: 0.025, splash: ['splashSlide', 1] }),
  gear: def(F.gear, 0.4, 0.04, 2, { max: 3, n: 5, len: 0.35, jitter: 0.15 }),
  impactMetal: def(E.impactMetal, 0.25, 0.3, 3, { ...IMP, len: 2 }),
  impactConcrete: def(E.impactConcrete, 0.55, 0.22, 3, { ...IMP, len: 0.6 }),
  impactWood: def(E.impactWood, 0.38, 0.18, 3, { ...IMP, len: 0.3 }),
  impactAsphalt: def(E.impactAsphalt, 0.49, 0.18, 3, { ...IMP, len: 0.26, splash: ['splashHit', 1] }),
  impactGlass: def(E.impactGlass, 0.4, 0.22, 3, { ...IMP, n: 3, ref: 5, len: 0.7, detune: 0 }),
  impactSoft: def(H.impactSoft, 0.48, 0.12, 3, { ...IMP, n: 4, len: 0.25 }),
  impactGravel: def(H.impactGravel, 0.36, 0.2, 3, { ...IMP, n: 4, len: 0.45 }),
  splashStep: def(H.splashStep, 0.35, SPLASH.send, 0, { ...SPLASH, len: 0.4 }),
  splashHit: def(H.splashHit, 0.49, SPLASH.send, 0, { ...SPLASH, len: 0.4 }),
  splashSlide: def(H.splashSlide, 0.4, SPLASH.send, 0, { ...SPLASH, n: 3, len: 0.95 }),
  splashShell: def(H.splashShell, 0.4, SPLASH.send, 0, { ...SPLASH, len: 0.3 }),
  ricochet: def(E.ricochet, 0.27, 0.3, 3, { max: 3, ref: 4, n: 4, len: 0.6, mono: true, jitter: 0.15 }),
  bulletWhiz: def(E.bulletWhiz, 0.5, 0.1, 5, { max: 3, n: 4, len: 0.3, jitter: 0.12, occ: false }),
  droneShot: def(E.droneShot, 0.26, 0.3, 6, { max: 6, ref: 12, n: 4, len: 0.65, mono: true }),
  droneHit: def(E.droneHit, 0.37, 0.2, 4, { max: 4, ref: 5, len: 0.4, mono: true }),
  droneExplode: def(E.droneExplode, 0.15, 0.45, 8, { ref: 9, len: 2.1, mono: true }),
  droneAlert: def(E.droneAlert, 0.37, 0.25, 5, { ref: 6, n: 1, len: 0.4, mono: true, jitter: 0 }),
  droneCrash: def(H.droneCrash, 0.45, 0.25, 5, { max: 3, ref: 6, n: 2, len: 1.1, mono: true, detune: 0.04 }),
  npcShot: def(N.npcShot, 0.3, 0.34, 6, { max: 6, ref: 12, air: 22, tail: 0.06, n: 4, len: 1.5, mono: true }),
  // 敌人跑动的一步要在 10 米外还听得出：参考距离 7 米，低通放到 5.5 kHz
  npcStep: def(N.npcStep, 0.32, 0.12, 1, { max: 6, ref: 7, n: 5, len: 0.4, lenOf: { metal: 0.98 }, mono: true, jitter: 0.15, surfaces: SURFACES, detune: 0.04, splash: ['splashStep', 0.6] }),
  npcMagOut: def(N.npcMagOut, 0.5, 0.1, 5, { max: 3, ref: 6, n: 2, len: 0.4, mono: true }),
  npcMagIn: def(N.npcMagIn, 0.5, 0.1, 5, { max: 3, ref: 6, n: 2, len: 0.42, mono: true }),
  npcHurt: def(N.npcHurt, 0.69, 0.14, 4, { max: 3, ref: 5, n: 3, len: 0.35, mono: true, jitter: 0.12 }),
  npcDeath: def(N.npcDeath, 0.45, 0.15, 5, { max: 3, ref: 5, n: 2, len: 0.95, mono: true }),
  bodyHit: def(N.bodyHit, 0.4, 0.12, 4, { max: 5, ref: 5, n: 4, len: 0.25, mono: true, jitter: 0.15, detune: 0.03 }),
  npcAlert: def(N.npcAlert, 0.12, 0.22, 5, { max: 3, ref: 7, n: 2, len: 0.42, mono: true, jitter: 0 }),
  // 切枪一秒能响十几次：同时最多两个，新的一下压低旧的尾巴，叠不起来
  weaponSwitch: def(K.weaponSwitch, 0.42, 0.04, 3, { choke: 'switch', max: 2, n: 5, len: 0.5, jitter: 0.15 }),
  dash: def(K.dash, 0.25, 0.1, 5, { max: 2, n: 2, len: 0.5, jitter: 0.06 }),
  smokeThrow: def(K.smokeThrow, 0.68, 0.06, 4, { max: 2, n: 2, len: 0.9 }),
  smokeBounce: def(K.smokeBounce, 0.38, 0.15, 2, { max: 4, ref: 3, n: 4, len: 0.5, mono: true, jitter: 0.15 }),
  // 起爆一颗才响一次、又长，现合成，不占预渲染的内存
  smokeBurst: def(K.smokeBurst, 0.41, 0.25, 4, { max: 3, ref: 6, n: 0, len: 2, mono: true }),
  // 钢靶要在 50 米外也听得清：参考距离给大，空气吸收放慢，留住“当”的那几个分音；按声速晚到，才不和自己那一枪撞在一起
  targetHit: def(K.targetHit, 0.36, 0.25, 5, { choke: 'steel', sonic: true, max: 4, ref: 12, air: 70, n: 4, len: 1.25, mono: true, jitter: 0.06 }),
  targetDown: def(K.targetDown, 0.38, 0.2, 5, { sonic: true, max: 3, ref: 8, n: 2, len: 1, mono: true }),
  targetReset: def(H.targetReset, 0.4, 0.2, 4, { sonic: true, max: 3, ref: 8, n: 2, len: 1.08, mono: true }),
  hurt: ui(E.hurt, 0.44, { n: 3, len: 1.65 }),
  hitmarker: ui(E.hitmarker, 0.45, { n: 2, len: 0.14 }),
  headshot: ui(E.headshot, 0.3, { n: 2, len: 0.55 }),
  killConfirm: ui(E.killConfirm, 0.5, { n: 2, len: 0.6 }),
  killHeadshot: ui(E.killHeadshot, 0.5, { n: 2, len: 0.55 }),
  waveStart: ui(E.waveStart, 0.2, { send: 0.2, len: 1.3 }),
  waveClear: ui(E.waveClear, 0.45, { send: 0.2, len: 2.65 }),
  uiClick: ui(E.uiClick, 0.52, { len: 0.08 }),
  uiHover: ui(F.uiHover, 0.5, { max: 2, len: 0.05 }),
  heartbeat: ui(E.heartbeat, 0.26, { len: 0.55, pump: 0.68 }),
  playerDeath: ui(F.playerDeath, 0.33, { len: 2.4 }),
  regenBreath: ui(F.regenBreath, 0.3, { n: 2, len: 0.9 }),
  // 环境事件：引擎自己随机触发，也可以手动 play
  ambThunder: amb(A.thunder, 0.45, 0.5, 2),
  ambHorn: amb(A.horn, 0.042, 0.6, 2),
  ambClang: amb(A.clang, 0.12, 0.6, 1),
  ambDrip: amb(A.drip, 0.1, 0.3, 0),
  ambGull: amb(AD.gull, 0.12, 0.4, 1),
  ambHalyard: amb(AD.halyard, 0.2, 0.3, 1),
};

export const LOOPS = {
  droneRotor: { fn: A.droneRotor, gain: 0.24, send: 0.12, ref: 7, bus: 'sfx' },
  // lift：遮挡判定时声源点往下挪（灯具贴着顶棚，见 occlusion.js）
  lampHum: { fn: A.lampHum, gain: 0.05, send: 0.05, ref: 2.5, bus: 'sfx', lift: -0.35 },
  droneSpark: { fn: A.droneSpark, gain: 0.1, send: 0.1, ref: 4, bus: 'sfx' },
};
