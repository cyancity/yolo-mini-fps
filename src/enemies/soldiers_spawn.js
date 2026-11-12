import * as THREE from 'three';

// 每波的出生点：按步行距离挑。从玩家所在的网格节点做一次限距 Dijkstra，量出到各出生点要走多远
// （直线近的楼顶、二层要绕楼梯走一百多米，按直线挑会让人半分钟都到不了）。
// 第 1、2 波至少一个点在步行 FIRST 米以内，其余点落在 NEAR..FAR_WALK；玩家看得见的点、贴脸的点都不用。
const FIRST = 50, NEAR = 20, FAR_WALK = 90, MAX_COST = 110;
const _e = new THREE.Vector3(), _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

export function pickSpawns(m, count, player, wave = 1) {
  const all = (m.level?.spawns || []).slice();
  const pp = player?.position;
  if (!all.length) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      all.push({ x: (pp?.x || 0) + Math.cos(a) * 25, y: 0, z: (pp?.z || 0) + Math.sin(a) * 25 });
    }
  }
  const walk = walkCosts(m, all, pp);
  const eye = player?.eye;
  const info = all.map((p, i) => {
    const d = pp ? Math.hypot(p.x - pp.x, p.z - pp.z) : 30;
    // 量不到（超出限距或者不连通）的按很远算
    const w = walk ? Math.min(walk[i], MAX_COST + d) : d * 1.3;
    // 看得见的点：站在出生点的人头部高度和玩家眼睛之间没有遮挡
    const seen = !!eye && d < 70 && !m.phys.blocked(_e.copy(eye), _v.set(p.x, (p.y || 0) + 1.5, p.z));
    return { p, d, w, bad: (seen ? 1000 : 0) + (d < 12 ? 500 : 0) };
  });
  const out = [], used = new Set();
  const take = (lo, hi) => {
    let best = null, bk = Infinity;
    for (const r of info) {
      if (used.has(r)) continue;
      // 范围内基本随机，稍微偏向近的（90 米比 20 米只差 7 分，随机项有 12 分）
      const k = r.bad + (r.w < lo ? (lo - r.w) * 3 : r.w > hi ? (r.w - hi) * 2 : 0) + r.w * 0.1 + Math.random() * 12;
      if (k < bk) { bk = k; best = r; }
    }
    if (best) used.add(best);
    return best;
  };
  // 第 1、2 波先挑一个近点，保证开波后十来秒就有人接敌
  if (wave <= 2) { const r = take(NEAR * 0.75, FIRST); if (r) out.push(r); }
  while (out.length < Math.min(count, info.length)) {
    const r = take(NEAR, FAR_WALK);
    if (!r) break;
    out.push(r);
  }
  if (!out.length) return [];
  m.spawnLog = out.map((r) => ({ x: r.p.x, y: r.p.y || 0, z: r.p.z, walk: +r.w.toFixed(1), dist: +r.d.toFixed(1), bad: r.bad }));
  const pts = [];
  for (let i = 0; i < count; i++) {
    const p = out[i % out.length].p, round = Math.floor(i / out.length);
    // 同一个点用第二次就错开一点
    pts.push(round ? { x: p.x + rand(-1.4, 1.4), y: p.y || 0, z: p.z + rand(-1.4, 1.4) } : { x: p.x, y: p.y || 0, z: p.z });
  }
  return pts;
}

// 每个出生点的步行代价；网格没好或者玩家不在网格上时返回 null（退回按直线估）
function walkCosts(m, all, pp) {
  const nav = m.nav, pf = m.pf;
  if (!pp || !nav.ready) return null;
  const start = nav.nearest(pp.x, pp.y, pp.z, 3);
  if (start < 0) return null;
  const nodes = all.map((p) => nav.nearest(p.x, p.y || 0, p.z, 2));
  let left = 0;
  for (const n of nodes) if (n >= 0) left++;
  // 出生点都量到了就收工，不必把整张图都填完
  const visit = (n) => {
    for (let i = 0; i < nodes.length; i++) if (nodes[i] === n) left--;
    return left <= 0;
  };
  pf.watch.on = false;
  pf.flood(start, MAX_COST, visit, 60000);
  return nodes.map((n) => pf.cost(n));
}
