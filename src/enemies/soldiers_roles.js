import { TUNE } from './tuning.js';

// 交战分工。一波里只有少数几个突击手：朝着自己进场的方位往前压到 keepDist 附近，被盯上、挨了打时绕侧翼，
// 玩家躲起来就守着，躲久了（searchAfter）去他最后出现的地方找（soldiers_tactics.js 的 combat）。其余是压制手：
// 各守一个交战距离，在那儿找能打到玩家最后位置的掩体蹲守、探头点射，轮不到名额时只在附近换掩体，不往前压、不绕圈。
// 不能僵住：全队一阵看不见玩家，压制手的交战距离慢慢收到 keepDist；突击手全死了，过一会儿从压制手里就近提一个。
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export function assaultQuota(level) {
  const A = TUNE.assault;
  return A[Math.min(A.length - 1, Math.max(0, level - 1))];
}

// spawnWave 用：count 个人里随机挑突击手，其余压制
export function waveRoles(count, level) {
  const out = new Array(count).fill('support');
  let k = Math.min(count, assaultQuota(level));
  while (k > 0) {
    const i = (Math.random() * count) | 0;
    if (out[i] === 'assault') continue;
    out[i] = 'assault';
    k--;
  }
  return out;
}

// 出生时定角色：spawnWave 给了就用，没给（spawnAt、补刷）就按这一波还缺几个突击手来定
export function assignRole(s, m, role) {
  if (role !== 'assault' && role !== 'support') {
    let n = 0;
    for (const o of m.active) if (o !== s && o.alive && o.role === 'assault') n++;
    role = n < assaultQuota(s.level) ? 'assault' : 'support';
  }
  s.role = role;
  s.engage = s.reach = rand(TUNE.supportDist[0], TUNE.supportDist[1]);
  s.anchor = NaN;
  s.holdDist = 0; // 选点时所守掩体离玩家最后位置多远（pickPost 记）：判断是不是玩家自己冲过来的
}

// 每帧：突击手全死了（还有压制手活着），过 promoteAfter 秒把离玩家最近的压制手提成突击手
export function updateRoles(m, dt) {
  const pp = m.player?.position;
  let assault = 0, best = null, bd = Infinity;
  for (const s of m.active) {
    if (!s.alive || s.broken) continue;
    if (s.role === 'assault') { assault++; continue; }
    const d = pp ? (s.pos.x - pp.x) ** 2 + (s.pos.z - pp.z) ** 2 : 0;
    if (d < bd) { bd = d; best = s; }
  }
  if (assault > 0 || !best) { m.promoteT = 0; return; }
  m.promoteT += dt;
  if (m.promoteT > TUNE.promoteAfter) {
    best.role = 'assault';
    m.promoteT = 0;
  }
}

// 压制手当前的交战距离：全队看不见玩家超过 supportLost 秒后按 supportCreep 收到 keepDist，重新看见就恢复
export function supportReach(s, m) {
  const T = m.tune, lost = m.time - s.knownT - T.supportLost;
  s.reach = lost > 0 ? Math.max(T.keepDist, s.engage - lost * T.supportCreep) : s.engage;
  return s.reach;
}

// 压制手多久看不见玩家才放弃交火、转入搜索：交战距离收到 keepDist 以后再等 supportSearch 秒
export function supportGiveUp(s, T) {
  return T.supportLost + Math.max(0, s.engage - T.keepDist) / T.supportCreep + T.supportSearch;
}

// 压制手蹲守时要不要换位：别人看得见玩家、自己探头却看不见（blind），换个角度；名额轮不到、蹲够了也换；
// 全队都看不见玩家（gone，他躲起来了）时探头扑空不算，守着等他再露头；
// 玩家自己冲到 keepDist 以内（掩体原本在 keepDist 以外）、自己又在掩体后：守着不动，不往后撤
export function supportHold(s, dK, gone) {
  const T = TUNE;
  if (s.blind) {
    if (!gone) return 'shift';
    s.blind = false;
  }
  if (s.token || s.holdT > 0) return null;
  if (dK < T.keepDist && s.postCover && s.holdDist >= T.keepDist) {
    s.holdT = rand(T.supportHold[0], T.supportHold[1]);
    return null;
  }
  // 站在明处的（附近没找到掩体）放开范围重找
  return s.postCover ? 'shift' : 'post';
}

// 换位的方位基准（压制手换掩体、突击手往前压都用）：第一次选点时记下自己相对玩家的方位；
// 玩家挪远了（最后位置变了 6 米以上）就按新位置重记
export function anchorOf(s, P) {
  if (Number.isNaN(s.anchor) || (P.x - s.anchorX) ** 2 + (P.z - s.anchorZ) ** 2 > 36) {
    s.anchor = Math.atan2(s.pos.z - P.z, s.pos.x - P.x);
    s.anchorX = P.x;
    s.anchorZ = P.z;
  }
  return s.anchor;
}

// 压制手选点的附加罚分：比想要的距离近、方位转得比 supportShift 多（相对现在的位置和相对基准各算一次）
export function supportScore(C, dP, dx, dz) {
  let sc = dP < C.want ? (C.want - dP) * 0.8 : 0;
  const b = Math.atan2(dz, dx), lim = C.shift;
  sc += Math.max(0, Math.abs(wrap(b - C.bearing)) - lim) * 30 * C.turn;
  sc += Math.max(0, Math.abs(wrap(b - C.anchor)) - lim) * 15 * C.turn;
  return sc;
}
