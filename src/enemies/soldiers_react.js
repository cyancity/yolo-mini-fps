// 挨打的反应（压制）：活着中弹时打断点射、推迟下一轮、准头变差，人要动起来（缩回掩体、横挪、换掩体），
// 不能站着照样还击。SoldierManager.hit() 在存活分支里调用。
const rand = (a, b) => a + Math.random() * (b - a);

export function suppress(s, m, part, player) {
  const g = s.gun, t = m.time;
  // 打断正在打的这一轮，下一轮推迟，准头降一级（下一轮回到大的系统误差）
  g.burst = 0;
  g.cool = Math.max(g.cool, rand(0.25, 0.4));
  s.onTarget = Math.max(0, s.onTarget - 1);
  // 头上、身上中弹会被打得一歪：下一轮带一个一次性的偏移，由 soldiers_gun.js 的 startBurst 加上
  if (part !== 'limb') s.shake = rand(0.5, 1);
  if (player) {
    // 直接看向开枪的人，不等瞄准点阻尼追过去
    const pp = player.position;
    s.aimPt.set(pp.x, pp.y + player.height * 0.62, pp.z);
    s.lookBase = Math.atan2(-(pp.x - s.pos.x), -(pp.z - s.pos.z));
  }
  if (s.tac === 'hold' && s.postCover) {
    // 蹲在掩体后的缩回去多躲一会儿（posture 里 duckT 没走完不探头）
    s.duckT = Math.max(s.duckT, rand(0.5, 1));
    s.lastBursts = g.bursts;
  } else if (s.pathN === 0 && s.nudgeT <= 0 && player) {
    // 站在明处：横着挪一步。左右每 1.2 秒换一次，连着挨打时不会原地来回抖
    const dx = player.position.x - s.pos.x, dz = player.position.z - s.pos.z, d = Math.hypot(dx, dz) || 1;
    const side = (s.id + Math.floor(t / 1.2)) % 2 ? 1 : -1;
    s.nudge.set((-dz / d) * side * 0.9, 0, (dx / d) * side * 0.9);
    s.nudgeT = 0.4;
  }
  // 1 秒内挨了 3 枪以上：去找掩体（combat() 下一拍按 exposedT 换位），1.5 秒内不重复触发
  if (t - s.hitWinT > 1) { s.hitWinT = t; s.hitN = 0; }
  if (++s.hitN > 3 && t - s.suppT > 1.5) {
    s.suppT = t;
    s.exposedT = 3;
    s.pickCool = 0;
  }
}
