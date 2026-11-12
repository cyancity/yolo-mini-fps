import { SPEED } from './soldiers_move.js';

// 状态切换和移动目标的小工具，感知（soldier_ai.js）和战术（soldiers_tactics.js）共用
export const THINK = 0.1; // 每个敌人每秒想 10 次

export function setGoal(s, x, y, z, speed) {
  s.goal.set(x, y, z);
  s.needPath = true;
  s.speedWant = speed;
  s.arrived = false;
}

// 还在赶路，或者路还在排队、正在分帧搜（这几帧 pathN 是 0，不能当成已经到了）
export const busy = (s, m) => s.pathN > 0 || s.needPath || m.job === s;

// 直接走到相邻的一个网格点（掩体和探头位之间来回）。goal 跟着改，卡住后重新寻路才不会跑回旧目标
export function setWaypoint(s, nav, n, speed) {
  s.goal.set(nav.cx(n), nav.nY[n], nav.cz(n));
  s.path[0] = nav.cx(n);
  s.path[1] = nav.nY[n];
  s.path[2] = nav.cz(n);
  s.pathN = 1;
  s.pathI = 0;
  s.needPath = false;
  s.arrived = false;
  s.speedWant = speed;
}

export function halt(s) {
  s.pathN = 0;
  s.needPath = false;
  s.speedWant = 0;
}

export function enterCombat(s, m) {
  if (s.state === 'combat') return;
  s.state = 'combat';
  s.stateT = 0;
  s.tac = 'none';
  s.exposedT = 0;
  s.watchedT = 0;
  s.blind = false;
  if (m.time - s.alertT > 6) m.audio?.play?.('npcAlert', { position: s.eye, volume: 1 });
  s.alertT = m.time;
}

export function enterSearch(s, m) {
  m.releaseToken(s);
  s.state = 'search';
  s.stateT = 0;
  s.searchT = 0;
  s.lookT = 0;
  s.lookDur = 1.5;
  s.tac = 'none';
  s.crouchWant = 0;
  setGoal(s, s.lastKnown.x, s.lastKnown.y, s.lastKnown.z, 2.6);
}

// 去某处看看：听到枪声、看见尸体、整波人朝玩家大致方位压过去
export function investigate(s, m, pos, urgent) {
  if (s.state === 'combat') return;
  s.state = 'investigate';
  s.stateT = 0;
  s.lookT = 0;
  s.urgent = urgent;
  s.lastKnown.copy(pos);
  s.crouchWant = 0;
  setGoal(s, pos.x, pos.y, pos.z, urgent ? SPEED.run * 0.8 : 2.2);
}
