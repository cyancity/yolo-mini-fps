// DOCK ZERO 掩体可靠度量法：玩家被看见后躲到一处高掩体后面不动，量从躲好到第一次被任何士兵看见要多久，
// 以及 60 秒内有没有士兵走到能看见他的位置（不能僵住）。借用 dev/tune_measure.js 的内部工具，没加载会先加载它。
//   await import('/dev/tune_cover.js?v=' + Date.now())
//   __tune.cover(5, 'yard', 3, 5)  掩体、波次、人数。掩体：yard 堆场中部的开口集装箱，west 出生点西边的集装箱，van 街上的送货车
// 每局：士兵按波次的分工摆在掩体另一侧 14~24 米的扇形里（站着看得见露头位、看不见躲藏位），玩家在露头位站着，
// 有人看见他以后再站 2 秒（最多等 6 秒），用 0.9 秒走进躲藏位（瞬移过去的话，感知 10 Hz 的滞后会把躲藏位直接报给敌人）。不用 0 伤害的命中惊动：那会记成挨了打，突击手 3 秒内会去绕侧翼。see = 躲好到第一次被看见（视野锥里、视线没被挡）的秒数，60 秒都没有记 60；
// los = 第一次有士兵和玩家之间没遮挡（不管朝向）；who = 第一个看见的人的分工和距离。
// 躲进去那一刻已经有人和躲藏位之间没遮挡（露头时有人走到了掩体挡不住的角度），这一局作废：void = 1，see 记 null，不进中位数。
// 目标：see 中位不少于 12 秒；los 都不超过 60（60 秒内总有人找过来）。
if (!window.__tune?.lib) await import('/dev/tune_measure.js?v=' + Date.now());
const D = window.__dbg, G = D.game, P = D.player, S = G.soldiers, phys = D.level.phys;
const { reset, run, sum, ground, rep, r2 } = window.__tune.lib;
const V = D.camera.position.constructor;
const a = new V(), b = new V(), c = new V();
// hide 躲藏位，expose 露头位，dir 敌人所在的方向（atan2(dz, dx)，+z 是南）
const SITES = {
  // 开口集装箱，口朝西：躲在口内 1 米，西南偏西（方位 155° 以外）能看进去，敌人摆在南面 28°~132°
  yard: { hide: [7.6, -2.4], expose: [5.4, -2.4], dir: 1.4, spread: 0.9 },
  west: { hide: [-16.4, 17.4], expose: [-12.2, 17.4], dir: -Math.PI / 2 },
  // 车身窄，街上也窄：敌人只能在西南方向的堆场口子里（看得见露头位、车挡得住的是 105°~165°，两头各让 10°）
  van: { hide: [36.4, -3.8], expose: [36.4, -0.2], dir: 2.36, spread: 0.44 },
};

function spots(st, n) {
  const out = [];
  for (let k = 0; k < 600 && out.length < n; k++) {
    const ang = st.dir + (Math.random() * 2 - 1) * (st.spread || 1.1), r = 14 + Math.random() * 10;
    const x = st.hide[0] + Math.cos(ang) * r, z = st.hide[1] + Math.sin(ang) * r;
    if (!ground(x, z) || out.some(([u, v]) => (u - x) ** 2 + (v - z) ** 2 < 9)) continue;
    a.set(x, 1.6, z);
    b.set(st.expose[0], 1.5, st.expose[1]);
    if (phys.blocked(a, b)) continue;
    b.set(st.hide[0], 1.6, st.hide[1]);
    if (!phys.blocked(a, b)) continue;
    b.y = 1.1;
    if (!phys.blocked(a, b)) continue;
    out.push([x, z]);
  }
  return out;
}

const los = (s) => {
  if (!phys.blocked(s.eye, P.eye)) return true;
  c.set(P.position.x, P.position.y + P.height * 0.62, P.position.z);
  return !phys.blocked(s.eye, c);
};

function once(site, level, count) {
  const st = SITES[site];
  reset(st.expose[0], st.expose[1]);
  S.setLevel(level);
  const pts = spots(st, count);
  for (const [x, z] of pts) S.place(x, 0, z, level, { hunter: true });
  run(6, null, () => S.active.some((s) => s.alive && s.sees && s.state === 'combat'));
  run(2);
  for (let i = 1; i <= 108; i++) {
    const k = i / 108;
    P.position.set(st.expose[0] + (st.hide[0] - st.expose[0]) * k, 0, st.expose[1] + (st.hide[1] - st.expose[1]) * k);
    D.step(1 / 120);
  }
  if (S.active.some((s) => s.alive && los(s))) return { see: null, los: 0, who: 'void', void: 1, n: pts.length };
  const th = G.time;
  let see = null, first = null, who = '';
  for (let i = 0; i < 60 * 120 && see == null; i++) {
    D.step(1 / 120);
    if (i % 6) continue;
    for (const s of S.active) {
      if (!s.alive || !los(s)) continue;
      if (first == null) first = G.time - th;
      if (s.sees) {
        see = G.time - th;
        who = (s.role || '-') + '@' + Math.round(Math.hypot(s.pos.x - P.position.x, s.pos.z - P.position.z));
        break;
      }
    }
  }
  const roles = {};
  for (const s of S.active) roles[s.role || '-'] = (roles[s.role || '-'] || 0) + 1;
  return { see: r2(see ?? 60), los: first == null ? null : r2(first), who, void: 0, n: pts.length, roles: JSON.stringify(roles), dmg: r2(sum(th, G.time)) };
}

window.__tune.cover = (n = 5, site = 'yard', level = 3, count = 5) => rep(n, () => once(site, level, count));
window.__tune.coverSites = SITES;
