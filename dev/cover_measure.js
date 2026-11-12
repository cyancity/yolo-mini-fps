// DOCK ZERO 室外掩体量法。开发服务器上的游戏页里加载：await import('/dev/cover_measure.js?v=' + Date.now())
// 前提：__dbg.play('waves') 后寻路网格已建好。
// 用法：
//   __cover.run()            → 三项指标的分布、最差 15 个位置、出生点附近的掩体、各区最长视线
//   __cover.run({ save: 'base' })  把结果存进 localStorage，改完后 __cover.run({ cmp: 'base' }) 对比同一批位置
//   __cover.heat(ppm, only)  在页面上叠一张俯视热力图（三联：到掩体距离 / 暴露度 / 最长视线；only 取 0/1/2 只画一张），__cover.hide() 收起
//   __cover.paths()          每个敌人出生点到玩家出生点的步行距离（米），不连通返回 null
// 掩体：站在节点上，16 个方向里有一个方向，在脚底以上 1.05 米（矮，比蹲姿眼高 1.02 高；run({ lowH }) 可改）或 1.75 米（高）处，
//   中线和左右各偏 0.4 米的三条水平射线都在 1.5 米内碰到东西（= 高 1.0 米以上、宽 0.8 米以上）。
// 暴露度：节点在 2 米网格上抽样，从胸口（+1.1）连向 12~45 米内其他抽样节点的眼睛（+1.6），没被挡住的比例。
// 最长视线：1 米网格上的节点，眼高 1.5，8 个朝向各取两头射线长度之和（射线截到地图边界），取最大。
(() => {
  const D = window.__dbg, nav = D.game.soldiers.nav, phys = D.level.phys, pf = D.game.soldiers.pf;
  const Vec = D.camera.position.constructor;
  const MAP = { x0: -30.4, x1: 42.4, z0: -48.4, z1: 21.3 };
  const ZW = { x0: -29.6, x1: 29.6, z0: -32.5, z1: -20.4 }, ZO = { x0: -29.6, x1: 8, z0: -47.6, z1: -32.9 }, ZC = { x0: 8.4, x1: 30, z0: -47.6, z1: -32.9 };
  const inR = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const zoneAt = (x, z) => inR(ZW, x, z) ? 'warehouse' : inR(ZO, x, z) ? 'office' : inR(ZC, x, z) ? 'court' : x > 29.3 ? 'street' : 'yard';
  const o = new Vec(), d = new Vec(), a = new Vec(), b = new Vec();

  // 室外节点：堆场、街道、卸货场的地面（含人行道、月台），两块屋面
  function outdoor() {
    const list = [];
    for (let n = 0; n < nav.nodes; n++) {
      if (!nav.walk(n)) continue;
      const x = nav.cx(n), z = nav.cz(n), y = nav.nY[n], zn = zoneAt(x, z);
      let layer = null;
      if (y > 7.9 && (Math.abs(y - 8.1) < 0.15 || Math.abs(y - 9.0) < 0.15)) layer = 'roof';
      else if (zn !== 'warehouse' && zn !== 'office' && (y < 0.35 || (zn === 'yard' && Math.abs(y - 1.1) < 0.1))) layer = 'ground';
      // 墙厚里的门洞格子（仓库正立面 z -20.2、背墙 z -32.7）算室内
      if (layer === 'ground' && (z < -19.98 && z > -20.45 || z < -32.45 && z > -32.95)) layer = null;
      if (!layer) continue;
      const col = nav.nCol[n];
      list.push({ n, x, y, z, zone: layer === 'roof' ? 'roof' : zn, layer, i: col % nav.nx, k: (col / nav.nx) | 0 });
    }
    return list;
  }

  const hitWithin = (x, y, z, dx, dz, max) => { o.set(x, y, z); d.set(dx, 0, dz); const t = phys.rayDist(o, d, max); return t >= 0 && t <= max; };
  function coverAt(p, h) {
    for (let s = 0; s < 16; s++) {
      const an = (s / 16) * Math.PI * 2, dx = Math.cos(an), dz = Math.sin(an), px = -dz * 0.4, pz = dx * 0.4;
      if (!hitWithin(p.x, p.y + h, p.z, dx, dz, 1.5)) continue;
      if (hitWithin(p.x + px, p.y + h, p.z + pz, dx, dz, 1.5) && hitWithin(p.x - px, p.y + h, p.z - pz, dx, dz, 1.5)) return true;
    }
    return false;
  }
  const clipT = (x, z, dx, dz) => {
    let t = 1e9;
    if (dx > 1e-9) t = Math.min(t, (MAP.x1 - x) / dx); else if (dx < -1e-9) t = Math.min(t, (MAP.x0 - x) / dx);
    if (dz > 1e-9) t = Math.min(t, (MAP.z1 - z) / dz); else if (dz < -1e-9) t = Math.min(t, (MAP.z0 - z) / dz);
    return Math.max(0, t);
  };
  function longest(p) {
    let best = 0, dir = 0;
    for (let s = 0; s < 8; s++) {
      const an = (s / 8) * Math.PI, dx = Math.cos(an), dz = Math.sin(an);
      let len = 0;
      for (const sg of [1, -1]) {
        const cx = dx * sg, cz = dz * sg, lim = clipT(p.x, p.z, cx, cz);
        o.set(p.x, p.y + 1.5, p.z); d.set(cx, 0, cz);
        const t = phys.rayDist(o, d, lim + 0.01);
        len += t >= 0 ? Math.min(t, lim) : lim;
      }
      if (len > best) { best = len; dir = s * 22.5; }
    }
    return [best, dir];
  }

  const q = (arr, f) => { const s = [...arr].sort((u, v) => u - v); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))] : NaN; };
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  const dist3 = (s) => ({ med: r2(q(s, 0.5)), p90: r2(q(s, 0.9)), max: r2(Math.max(...s)), n: s.length });

  function run(opt = {}) {
    const t0 = performance.now();
    const all = outdoor();
    // a. 掩体
    const lowH = opt.lowH || 1.05;
    for (const p of all) { p.low = coverAt(p, lowH); p.high = coverAt(p, 1.75); p.cov = p.low || p.high; }
    const covs = { ground: all.filter((p) => p.cov && p.layer === 'ground'), roof: all.filter((p) => p.cov && p.layer === 'roof') };
    const highs = all.filter((p) => p.high);
    for (const p of all) {
      let best = Infinity;
      for (const c of covs[p.layer]) { const dd = (c.x - p.x) ** 2 + (c.z - p.z) ** 2; if (dd < best) best = dd; }
      p.dc = Math.sqrt(best);
    }
    // b. 暴露度（2 米网格）
    const grid2 = all.filter((p) => p.i % 4 === 0 && p.k % 4 === 0);
    for (const p of grid2) {
      let seen = 0, tot = 0;
      a.set(p.x, p.y + 1.1, p.z);
      for (const t of grid2) {
        const dd = Math.hypot(t.x - p.x, t.z - p.z);
        if (dd < 12 || dd > 45) continue;
        b.set(t.x, t.y + 1.6, t.z);
        tot++;
        if (!phys.blocked(a, b)) seen++;
      }
      p.exp = tot ? seen / tot : 0;
    }
    // c. 最长视线（1 米网格）
    const grid1 = all.filter((p) => p.i % 2 === 0 && p.k % 2 === 0);
    for (const p of grid1) [p.ls, p.lsDir] = longest(p);

    const ground = all.filter((p) => p.layer === 'ground');
    const out = {
      ms: Math.round(performance.now() - t0), nodes: all.length,
      coverDist: { ground: dist3(ground.map((p) => p.dc)), roof: dist3(all.filter((p) => p.layer === 'roof').map((p) => p.dc)) },
      exposure: dist3(grid2.map((p) => p.exp)),
      longest: dist3(grid1.map((p) => p.ls)),
    };
    const sorted = [...grid2].sort((u, v) => v.exp - u.exp), top = sorted.slice(0, Math.ceil(sorted.length / 10));
    out.exposure.top10mean = r2(top.reduce((s, p) => s + p.exp, 0) / top.length);
    out.worstCover = [...all].sort((u, v) => v.dc - u.dc).filter((p, i, arr) => arr.slice(0, i).every((w) => Math.hypot(w.x - p.x, w.z - p.z) > 2.5)).slice(0, 15).map((p) => [p.x, p.z, p.y, r1(p.dc), p.zone]);
    out.worstExposure = sorted.slice(0, 15).map((p) => [p.x, p.z, p.y, r2(p.exp), p.zone]);
    out.longestByZone = {};
    for (const zn of ['yard', 'street', 'court', 'roof']) {
      const s = grid1.filter((p) => p.zone === zn).sort((u, v) => v.ls - u.ls);
      if (s.length) out.longestByZone[zn] = { max: r1(s[0].ls), at: [s[0].x, s[0].z, s[0].lsDir], p90: r1(q(s.map((p) => p.ls), 0.9)) };
    }
    out.spawnHigh = r1(Math.min(...highs.filter((p) => p.layer === 'ground').map((p) => Math.hypot(p.x + 9, p.z - 16))));
    out.byZone = {};
    for (const zn of ['yard', 'street', 'court', 'roof']) {
      const g = all.filter((p) => p.zone === zn), e = grid2.filter((p) => p.zone === zn);
      out.byZone[zn] = { coverP90: r1(q(g.map((p) => p.dc), 0.9)), coverMax: r1(Math.max(...g.map((p) => p.dc))), expMed: r2(q(e.map((p) => p.exp), 0.5)) };
    }
    if (opt.cmp) {
      const base = JSON.parse(localStorage.getItem('coverMeasure:' + opt.cmp) || 'null');
      if (base) {
        const key = (x, z, y) => `${x.toFixed(2)},${z.toFixed(2)},${y.toFixed(1)}`;
        const now = new Map(grid2.map((p) => [key(p.x, p.z, p.y), p.exp]));
        let sb = 0, sa = 0, cnt = 0, gone = 0;
        for (const [x, z, y, e] of base.top) { const v = now.get(key(x, z, y)); if (v === undefined) { gone++; continue; } sb += e; sa += v; cnt++; }
        out.cmp = { baseTop10: r2(base.top10mean), sameNodesBefore: r2(sb / cnt), sameNodesAfter: r2(sa / cnt), compared: cnt, removed: gone };
      }
    }
    if (opt.save) localStorage.setItem('coverMeasure:' + opt.save, JSON.stringify({ top10mean: out.exposure.top10mean, top: top.map((p) => [p.x, p.z, p.y, p.exp]) }));
    window.__cover.last = { all, grid1, grid2 };
    return out;
  }

  // 俯视热力图：三联，6 像素一米；底下画齐胸高的碰撞体轮廓
  function heat(ppm = 6, only = -1) {
    const L = window.__cover.last || (run(), window.__cover.last);
    hide();
    const W = Math.ceil((MAP.x1 - MAP.x0) * ppm), H = Math.ceil((MAP.z1 - MAP.z0) * ppm);
    const cv = document.createElement('canvas');
    cv.id = 'coverHeat'; cv.width = only >= 0 ? W : W * 3 + 40; cv.height = H + 28;
    Object.assign(cv.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, background: '#111' });
    const c = cv.getContext('2d');
    const px = (x) => (x - MAP.x0) * ppm, pz = (z) => (z - MAP.z0) * ppm;
    const ramp = (t) => { t = Math.max(0, Math.min(1, t)); return `hsl(${(1 - t) * 120},90%,${45 + t * 5}%)`; };
    const panels = [
      ['到掩体距离 0–8 m', L.all, (p) => p.dc / 8, 0.5],
      ['暴露度 0–100%', L.grid2, (p) => p.exp, 2],
      ['最长视线 20–60 m', L.grid1, (p) => (p.ls - 20) / 40, 1],
    ];
    panels.forEach(([title, pts, f, cell], k) => {
      if (only >= 0 && k !== only) return;
      if (only >= 0) k = 0;
      c.save(); c.translate(k * (W + 20), 28);
      c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, W, H);
      const order = [...pts].sort((u, v) => (u.layer === 'roof') - (v.layer === 'roof'));
      for (const p of order) { c.fillStyle = ramp(f(p)); c.fillRect(px(p.x) - (cell * ppm) / 2, pz(p.z) - (cell * ppm) / 2, cell * ppm, cell * ppm); }
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1;
      for (const bx of phys.boxes) {
        if (bx.playerOnly || bx.top < 0.9 || bx.bottom > 1.5) continue;
        c.beginPath();
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const ux = lx * bx.hx, uz = lz * bx.hz, wx = bx.cx + bx.c * ux + bx.s * uz, wz = bx.cz - bx.s * ux + bx.c * uz;
          c.lineTo(px(wx), pz(wz));
        }
        c.closePath(); c.stroke();
      }
      for (const cy of phys.cyls) { if (cy.y1 < 0.9 || cy.y0 > 1.5) continue; c.beginPath(); c.arc(px(cy.x), pz(cy.z), Math.max(1, cy.r * ppm), 0, 7); c.stroke(); }
      c.fillStyle = '#fff'; c.beginPath(); c.arc(px(-9), pz(16), 4, 0, 7); c.fill();
      c.restore();
      c.fillStyle = '#ddd'; c.font = '16px sans-serif'; c.fillText(title, k * (W + 20) + 6, 20);
    });
    document.body.appendChild(cv);
    return { w: cv.width, h: cv.height };
  }
  function hide() { document.getElementById('coverHeat')?.remove(); }

  // 敌人出生点 → 玩家出生点的步行距离
  function paths() {
    const out = [];
    const goal = nav.nearest(-9, 0, 16, 3);
    for (const s of D.level.spawns) {
      const st = nav.nearest(s.x, s.y || 0, s.z, 3);
      let len = null;
      if (st >= 0 && goal >= 0) {
        const end = pf.search(st, goal, 40000, false);
        if (end === goal || (end >= 0 && nav.cx(end) === nav.cx(goal) && nav.cz(end) === nav.cz(goal))) {
          const k = pf.extract(end);
          len = 0;
          for (let i = 1; i < k; i++) { const u = pf.nodes[i - 1], v = pf.nodes[i]; len += Math.hypot(nav.cx(u) - nav.cx(v), nav.nY[u] - nav.nY[v], nav.cz(u) - nav.cz(v)); }
          len = r1(len);
        }
      }
      out.push([s.x, s.z, s.zone, len]);
    }
    return out;
  }

  window.__cover = { run, heat, hide, paths, coverAt, outdoor };
  return 'ok';
})();
