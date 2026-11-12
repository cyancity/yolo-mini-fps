import * as THREE from 'three';
import { SPEED } from './soldiers_move.js';
import { reload } from './soldiers_gun.js';
import { THINK, setGoal, setWaypoint, enterSearch, halt, busy } from './soldiers_states.js';
import { supportReach, supportGiveUp, supportHold, anchorOf, supportScore } from './soldiers_roles.js';

// 交火中的战术：同时开火的人数有限（令牌），拿到令牌的在掩体后探身点射，其余的人换位置——
// 往前压、绕侧翼、受伤后撤、躲起来换弹。掩体从寻路网格里找：贴着障碍、而且障碍挡在自己和玩家之间的格子。
// 往前压和绕侧翼只有突击手做；压制手（soldiers_roles.js）守在交战距离上，只在附近换掩体。
const CAND = 6;
const FAR = 22; // 超过这个距离又看不见玩家，就不在附近找掩体，直接长途压过去
const FLOOR = 1.5; // 高差超过它算不同楼层：在本层附近找掩体帮不上忙，得上下楼
// 方位扇区（按角度排的 8 份）对应 soldier_nav 的方向编号
const SEC2DIR = [0, 4, 1, 5, 2, 6, 3, 7];
const FACE = SEC2DIR.map((_, k) => (1 << SEC2DIR[k]) | (1 << SEC2DIR[(k + 1) % 8]) | (1 << SEC2DIR[(k + 7) % 8]));
const SIDE_X = [0, 2], SIDE_Z = [1, 3];
const candN = new Int32Array(CAND), candS = new Float64Array(CAND), candF = new Uint8Array(CAND);
const CROWD = new Float32Array(32); // 别人的站位（xz 成对），打分时不扎堆
const C = { nav: null, kind: '', w: null, crowd: 0, crowdR: 0, px: 0, py: 0, pz: 0, sx: 0, sz: 0, want: 0, bearing: 0, count: 0, keep: 0, sup: false, anchor: 0, shift: 0, turn: 1 };
// 各种换位的打分权重：dist 离理想距离的偏差，open 没有掩护，near 原地打转；
// arc 往前压时离开自己的基准方位（anchorOf，第一次选点时相对玩家的方位）超过它（弧度）开始罚分：
// 压是朝着人压过去，几步下来也不会绕到侧面；绕侧翼是 flank 的事
const W = {
  cover: { dist: 0.5, open: 9, near: 4 },
  advance: { dist: 1.4, open: 5, near: 7, arc: 0.35 },
  flank: { dist: 0.8, open: 5, near: 7 },
  fallback: { dist: 0.8, open: 9, near: 6 },
};
// 压制手：post 进入交火后第一次选点，shift 在附近换一处，cover 站在明处被看见、换弹没掩体时就近躲
const WS = {
  post: { dist: 0.9, open: 16, near: 0, flood: 16 },
  shift: { dist: 0.9, open: 16, near: 6, flood: 12 },
  cover: { dist: 0.6, open: 16, near: 0, flood: 10 },
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export function combat(s, m, player) {
  const g = s.gun, sup = s.role === 'support';
  if (sup) supportReach(s, m);
  if (m.time - s.knownT > (sup ? supportGiveUp(s, m.tune) : m.tune.searchAfter) || !player.alive) { enterSearch(s, m); return; }
  if (s.token) {
    s.tokenT += THINK;
    // 跑位途中看不见玩家就把开火名额让出来；蹲在掩体后等着探头的人多留一会儿
    const blindFor = s.tac === 'move' ? 0.5 : 1.2, T = m.tune;
    // 拿着名额一轮都没打出去（被队友挡、枪口对不上、蹲着）也让出来，别占着不打
    const idle = g.bursts === s.tokenBursts && s.tokenT > T.tokenIdle;
    if (s.tokenT > T.tokenHold || g.bursts - s.tokenBursts >= T.tokenBursts || g.reloadT > 0 || idle || (!s.sees && s.lostT > blindFor && s.tokenT > blindFor + 0.3)) m.releaseToken(s);
  } else {
    // 蹲在掩体后看不见玩家也可以要令牌：拿到了就去探头位
    const canPeek = s.tac === 'hold' && s.postCover && s.peekNode >= 0 && !s.blind;
    s.tokenCool -= THINK;
    if ((s.sees || canPeek) && s.tokenCool <= 0 && g.reloadT <= 0 && g.mag > 0) m.requestToken(s);
  }
  const hidden = s.tac === 'hold' && s.postCover && s.crouch > 0.6;
  if (g.burst === 0 && g.reloadT <= 0 && (g.mag === 0 || (g.mag < 10 && hidden && !s.token))) reload(s, m);
  // 站在明处不动又被玩家看得见：超过 2 秒必须挪
  const sp = Math.hypot(s.vel.x, s.vel.z);
  if (s.sees && sp < 0.5 && s.crouch < 0.6) s.exposedT += THINK;
  else s.exposedT = Math.max(0, s.exposedT - THINK * 2);
  watched(s, player);
  const dY = Math.abs(s.pos.y - s.lastKnown.y);
  if (s.tac === 'move' && (s.arrived || !busy(s, m))) {
    s.tac = 'hold';
    // 长途赶过来的人到了地方别在空地上干站，马上就近找掩体
    // 压制手没找到掩体时站在明处：等一会儿就再找，不在空地上干站
    const SH = m.tune.supportHold;
    // 突击手没掩体时上限压到 3.5 秒：看不见玩家时 exposedT 不涨，等满 5 秒就成了明处发呆。
    // 不再压得更短：一看不见就挪，挪着挪着就看见了躲起来的人，掩体撑不住
    s.holdT = s.postKind === 'approach' ? 0.5 : !sup ? rand(2.5, s.postCover ? 5 : 3.5) : s.postCover ? rand(SH[0], SH[1]) : rand(1.5, 2.5);
    // 赶到了却还不在那一层（路只搜出半截，或者玩家又换了层）：缓两秒再长途寻路，不在两种走法之间来回切
    if (s.postKind === 'approach' && dY > FLOOR) s.pickCool = 2;
    s.peekT = 0;
    s.duckT = 0;
    s.lastBursts = g.bursts;
  }
  // 玩家躲起来了（全队 creepAfter 秒没看见）：蹲在掩体后的人等得更久才换位，探头扑空也不马上挪，给玩家的掩体留出时间
  const gone = m.time - s.knownT > m.tune.creepAfter, creep = gone && s.postCover;
  s.holdT -= creep ? THINK * m.tune.creepRate : THINK;
  s.pickCool -= THINK;
  const hurt = s.hp < s.maxHp * 0.35;
  const dK = Math.hypot(s.pos.x - s.lastKnown.x, s.pos.z - s.lastKnown.z);
  const unseen = m.time - s.lastSeenT > 3;
  // 和玩家不在一层、又一阵没看见：哪怕水平上就在脚下，也得走全图寻路上下楼
  const offFloor = dY > FLOOR && unseen;
  const far = (dK > FAR || offFloor) && unseen;
  let kind = null;
  if (s.tac === 'none') kind = sup ? 'post' : s.token ? 'cover' : 'advance';
  else if (hurt && !s.fellBack) kind = 'fallback';
  else if (s.exposedT > 2) kind = 'cover';
  // 突击手往前压到一半玩家躲没了：就近找掩体停下，不沿着原来的路一直走到他的侧面
  else if (!sup && gone && s.tac === 'move' && s.postKind === 'advance' && !s.sees) kind = 'cover';
  else if (s.tac === 'move' && s.postKind === 'approach') {
    // 赶路途中看见玩家、或者已经到了附近：停下找掩体，转入正常交火
    // 压制手到了交战距离就停
    if ((s.sees && s.seeT >= s.reaction) || (dK < (sup ? Math.max(14, s.reach + 1) : 14) && !offFloor)) kind = 'cover';
  } else if (s.tac === 'hold') {
    if (sup) kind = supportHold(s, dK, gone);
    else if (s.blind && !creep) kind = 'advance';
    else if (!s.token && s.holdT <= 0) kind = s.watchedT > 1 || m.time - s.hurtT < 3 ? 'flank' : 'advance';
    // 在掩体后时，玩家躲起来了、或者已经压到 keepDist 附近（再压只能贴着他横着绕圈）：不再往前压，守着等他露头
    // （绕侧翼只在被盯上、挨了打时做）；他一直躲着，到 searchAfter 去他最后出现的地方找
    if (kind === 'advance' && s.postCover && (gone || dK < m.tune.keepDist + 2.5)) { kind = null; s.blind = false; s.holdT = rand(2.5, 5); }
    if (!kind && g.reloadT > 0 && !s.postCover) kind = 'cover';
  }
  if (kind && s.pickCool <= 0) {
    if (far && kind !== 'cover' && kind !== 'fallback') approach(s, m);
    else if (m.spendSearch()) pickPost(s, m, kind);
  }
  posture(s, m);
}

// 离玩家最后出现的地方很远、又好一阵没看见他：附近的掩体帮不上忙，走 A* 整条路压过去
// （寻路给玩家视线方向加价，自然会绕着走）
function approach(s, m) {
  const P = s.lastKnown;
  s.pickCool = 1;
  s.tac = 'move';
  s.postKind = 'approach';
  s.postCover = false;
  s.postNode = s.peekNode = -1;
  s.post.copy(P);
  s.blind = false;
  s.exposedT = 0;
  s.crouchWant = 0;
  setGoal(s, P.x + rand(-3, 3), P.y, P.z + rand(-3, 3), SPEED.run);
}

// 玩家正盯着这个人看（准星在他身上附近）：该绕路了
function watched(s, player) {
  const yaw = player.yaw;
  if (yaw === undefined || !s.sees) { s.watchedT = Math.max(0, s.watchedT - THINK); return; }
  const dx = s.pos.x - player.position.x, dz = s.pos.z - player.position.z, d = Math.hypot(dx, dz) || 1;
  if ((dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > 0.94) s.watchedT += THINK;
  else s.watchedT = Math.max(0, s.watchedT - THINK);
}

// 到位以后：有令牌就从探头位打一轮、缩回去、再探；没令牌就蹲在掩体后面
function posture(s, m) {
  const g = s.gun, nav = m.nav;
  if (s.tac !== 'hold') {
    s.crouchWant = 0;
    if (s.tac === 'move') s.speedWant = s.sees ? SPEED.run : 3.4;
    return;
  }
  if (!s.postCover || !nav.ready || s.postNode < 0) {
    // 没掩体时开枪只略微压低身子：蹲到 0.35 以上就不开火了（soldier_ai.js 的 wantFire）
    s.crouchWant = s.token && s.sees ? 0.25 : 0;
    if (s.pathN === 0) s.speedWant = 0;
    return;
  }
  // 打完一轮缩回去躲一会儿；玩家整个人站在明处（pressure 的计时到了、自己也还看得见他）时不缩，接着打，
  // 站桩不能比探头还安全
  if (g.bursts !== s.lastBursts) { s.lastBursts = g.bursts; s.duckT = m.openT > m.tune.pressureT && s.sees ? 0 : rand(0.5, 1.3); }
  if (s.duckT > 0) s.duckT -= THINK;
  const peek = s.token && g.reloadT <= 0 && s.duckT <= 0;
  const target = peek ? s.peekNode : s.postNode;
  const dx = nav.cx(target) - s.pos.x, dz = nav.cz(target) - s.pos.z;
  if (dx * dx + dz * dz > 0.09) { if (s.pathN === 0) setWaypoint(s, nav, target, 1.8); }
  else if (s.pathN === 0) halt(s);
  s.crouchWant = peek ? 0 : 1;
  if (peek && s.pathN === 0) {
    s.peekT += THINK;
    if (s.peekT > 1.5 && !s.sees) s.blind = true;
  } else s.peekT = 0;
}

// 在网格上从自己出发做限距 Dijkstra，给每个可达格打分，留最好的几个再用射线核实
function visit(n, cost) {
  const nav = C.nav;
  const x = nav.cx(n), z = nav.cz(n), dx = x - C.px, dz = z - C.pz, dP = Math.hypot(dx, dz);
  if (dP < 3.5) return;
  const sec = ((Math.round(Math.atan2(-dz, -dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const facing = (nav.cover[n] & FACE[sec]) !== 0;
  const w = C.w;
  const dy = Math.abs(nav.nY[n] - C.py);
  let sc = cost * 0.45 + Math.abs(dP - C.want) * w.dist + (dy > FLOOR ? 25 : dy * 0.3);
  if (!facing) sc += w.open;
  if (C.kind === 'flank') sc += Math.max(0, 1 - Math.abs(wrap(Math.atan2(dz, dx) - C.bearing))) * 14;
  else if (w.arc) sc += Math.max(0, Math.abs(wrap(Math.atan2(dz, dx) - C.anchor)) - w.arc) * 20;
  if (C.sup) sc += supportScore(C, dP, dx, dz);
  // 离玩家太近：推到几米内能从掩体侧面看见、刚探头就挨打，室内实在没别处可去时才会选
  if (dP < C.keep) sc += (C.keep - dP) * 10;
  if ((x - C.sx) ** 2 + (z - C.sz) ** 2 < 6.25) sc += w.near;
  if (dP > 45) sc += dP - 45;
  for (let i = 0; i < C.crowd; i++) if ((x - CROWD[i * 2]) ** 2 + (z - CROWD[i * 2 + 1]) ** 2 < C.crowdR) sc += 12;
  if (C.count === CAND && sc >= candS[CAND - 1]) return;
  // 挨着的格子（1.5 米内）只留分低的一个：同一堵墙后面一排格子往往一起探不了头，候选要分散到不同的掩体上
  for (let j = 0; j < C.count; j++) {
    const q = candN[j];
    if ((nav.cx(q) - x) ** 2 + (nav.cz(q) - z) ** 2 >= 2.25) continue;
    if (candS[j] <= sc) return;
    for (let k = j; k < C.count - 1; k++) { candN[k] = candN[k + 1]; candS[k] = candS[k + 1]; candF[k] = candF[k + 1]; }
    C.count--;
    break;
  }
  // 插入有序的候选表
  let i;
  if (C.count < CAND) i = C.count++;
  else if (sc >= candS[CAND - 1]) return;
  else i = CAND - 1;
  while (i > 0 && candS[i - 1] > sc) {
    candN[i] = candN[i - 1]; candS[i] = candS[i - 1]; candF[i] = candF[i - 1];
    i--;
  }
  candN[i] = n; candS[i] = sc; candF[i] = facing ? 1 : 0;
}

let peekOut = -1;
// 核实一个候选掩体：蹲着时胸口被挡住；站起来或者往旁边挪一两步能看见玩家（探头位）。返回是否真能当掩体
function verify(m, n, P, rays) {
  const nav = m.nav, phys = m.phys, x = nav.cx(n), y = nav.nY[n], z = nav.cz(n);
  peekOut = -1;
  _b.set(P.x, P.y + 1.1, P.z);
  _a.set(x, y + 0.85, z);
  rays.n--;
  if (!phys.blocked(_a, _b)) return false;
  _b.y = P.y + 1.5;
  _a.y = y + 1.6;
  rays.n--;
  if (!phys.blocked(_a, _b)) { peekOut = n; return true; }
  // 高掩体：顺着和玩家方向垂直的两侧各找两格
  const dx = P.x - x, dz = P.z - z, side = Math.abs(dx) > Math.abs(dz) ? SIDE_Z : SIDE_X;
  for (const d of side) {
    let k = n;
    for (let step = 0; step < 3 && rays.n > 0; step++) {
      k = nav.links[k * 8 + d];
      if (k < 0) break;
      if (step === 0) continue;
      _a.set(nav.cx(k), nav.nY[k] + 1.6, nav.cz(k));
      rays.n--;
      if (!phys.blocked(_a, _b)) {
        // 格子中心刚好擦着掩体边能看见，人停在离格子中心 0.3 米内、头也不在正中：再往外让一格才稳
        const out = nav.links[k * 8 + d];
        peekOut = out >= 0 ? out : k;
        return true;
      }
    }
  }
  return true;
}

const RAYS = { n: 0 };
function pickPost(s, m, kind) {
  s.pickCool = 0.6;
  const nav = m.nav, pf = m.pf;
  const start = nav.ready ? nav.nearest(s.pos.x, s.pos.y, s.pos.z, 2) : -1;
  if (start < 0) { openHold(s, -1); return; }
  const P = s.lastKnown, cur = Math.hypot(s.pos.x - P.x, s.pos.z - P.z), T = m.tune;
  const sup = s.role === 'support' && kind !== 'fallback';
  C.nav = nav; C.kind = kind; C.w = sup ? WS[kind] || WS.cover : W[kind]; C.count = 0;
  C.px = P.x; C.py = P.y; C.pz = P.z; C.sx = s.pos.x; C.sz = s.pos.z;
  C.keep = T.keepDist;
  C.bearing = Math.atan2(s.pos.z - P.z, s.pos.x - P.x);
  C.sup = sup;
  C.crowdR = sup ? 16 : 6.25; // 压制手互相离开 4 米，不挤成一排
  // 玩家自己冲过来：这人原本守在 keepDist 以外的掩体后（holdDist），现在离得近了。
  // 自己走近的（出生后去查看时一路走到跟前、第一次选点）不算，照样退回交战距离
  const pushed = sup && kind !== 'post' && cur < T.keepDist && s.postCover && s.holdDist >= T.keepDist;
  if (sup) {
    // 守自己的交战距离；被冲脸时就地找掩体，不往后撤
    if (pushed) C.keep = cur * 0.9;
    C.want = pushed ? cur : s.reach;
    C.anchor = anchorOf(s, P);
    C.shift = T.supportShift * Math.PI / 180;
    C.turn = s.postCover ? 1 : 0.3; // 站在明处的先找到掩体要紧，方位放宽
  } else {
    const k1 = C.keep + 1.5;
    if (kind === 'advance') C.anchor = anchorOf(s, P);
    C.want = kind === 'advance' ? Math.max(k1, cur - 8) : kind === 'fallback' ? cur + 8 : kind === 'flank' ? Math.max(k1, cur - 4) : Math.max(C.keep, Math.min(cur, 30));
  }
  C.crowd = 0;
  for (const o of m.active) {
    if (o === s || !o.alive || C.crowd >= 16) continue;
    const q = o.state === 'combat' && o.tac !== 'none' ? o.post : o.pos;
    CROWD[C.crowd * 2] = q.x;
    CROWD[C.crowd * 2 + 1] = q.z;
    C.crowd++;
  }
  m.watchFrom(pf, true);
  pf.flood(start, sup ? C.w.flood : kind === 'cover' ? 10 : kind === 'flank' ? 20 : 16, visit, 4000);
  pf.watch.on = false;
  if (C.count === 0) { openHold(s, start); return; }
  // 依次核实：要掩护又能探头的优先；后撤和换弹只要掩护；附近根本没掩体就接受开阔位置
  RAYS.n = 14;
  let chosen = -1, cov = false, peek = -1, blindCov = -1;
  const needPeek = kind !== 'fallback' && s.gun.reloadT <= 0;
  for (let c = 0; c < C.count && RAYS.n >= 2; c++) {
    const n = candN[c];
    if (!candF[c]) { if (!sup || blindCov < 0) { chosen = n; peek = n; } break; }
    const ok = verify(m, n, P, RAYS);
    if (ok && (peekOut >= 0 || !needPeek)) { chosen = n; cov = true; peek = peekOut >= 0 ? peekOut : n; break; }
    if (ok && blindCov < 0) blindCov = n;
  }
  // 压制手宁可蹲在探不了头的掩体后（等下次换位），也不站到空地上
  if (chosen < 0 && sup && blindCov >= 0) { chosen = peek = blindCov; cov = true; }
  if (chosen < 0) { chosen = candN[0]; peek = chosen; }
  // 压制手附近没有别的掩体：守在原来的掩体后，不出来站到空地上
  if (sup && !cov && kind === 'shift' && s.postCover) {
    s.holdT = rand(1.5, 3);
    s.blind = false;
    s.pickCool = 1.5;
    return;
  }
  // 还在分帧搜的旧路线作废，不然搜完会把这条覆盖掉
  if (m.job === s) m.job = null;
  const len = pf.extract(chosen);
  s.pathN = pf.smooth(len, s.path);
  s.pathI = 0;
  s.needPath = false;
  s.arrived = s.pathN === 0;
  s.postNode = chosen;
  s.peekNode = peek;
  s.postCover = cov;
  s.post.set(nav.cx(chosen), nav.nY[chosen], nav.cz(chosen));
  // 被冲脸时就近换的点不更新，玩家一直贴着就一直不后撤
  if (!pushed) s.holdDist = Math.hypot(s.post.x - P.x, s.post.z - P.z);
  s.goal.copy(s.post); // 卡住后重新寻路要回到这里
  s.tac = 'move';
  s.postKind = kind;
  s.blind = false;
  s.exposedT = 0;
  if (kind === 'fallback') s.fellBack = true;
}

// 找不到地方：原地开阔位置先顶一会儿
function openHold(s, n) {
  s.tac = 'hold';
  s.holdT = 1.5;
  s.postCover = false;
  s.postNode = s.peekNode = n;
  s.post.copy(s.pos);
  s.blind = false;
  s.holdDist = 0;
}
