// 人形敌人寻路网格的俯视图：建完整张关卡，按楼层画出可走格、掩体格和路径。
// 左键依次点起点、终点出 A* 路径（细线是原始格子路径，粗线是抽稀后的路点）。
// 控制台：__nav.path(x0, z0, x1, z1, 起点 y, 终点 y) 出一条路径并返回路点；__nav.floor(y) 换楼层；__nav.rebuild() 重建。
import { startHarness } from './harness.js';
import { buildLevel } from '../src/world/level.js';
import { MAP, Y } from '../src/world/plan.js';
import { SoldierNav, CELL } from '../src/enemies/soldier_nav.js';
import { PathFinder, MAX_WP } from '../src/enemies/soldiers_path.js';

startHarness(async ({ scene, mats, sky }) => {
  const level = await buildLevel({ scene, mats, sky });
  const nav = new SoldierNav(level.phys);
  const pf = new PathFinder(nav);
  const seeds = () => [{ x: level.spawn.x, y: 0, z: level.spawn.z }, ...level.spawns];
  nav.build(seeds());
  pf.ensure();

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;background:#0d0f12;cursor:crosshair';
  document.body.append(cv);
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:12px;top:10px;font:13px/1.5 system-ui,sans-serif;color:#cfd6dd;display:flex;gap:10px;align-items:center';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', '楼层');
  for (const [name, y] of [['全部', null], ['地面', Y.ground], ['月台', Y.dock], ['二层', Y.office2], ['办公楼屋面', Y.officeRoof], ['仓库屋面', Y.whRoof]]) {
    const o = document.createElement('option');
    o.textContent = name;
    o.value = y === null ? '' : String(y);
    sel.append(o);
  }
  const info = document.createElement('span');
  bar.append(sel, info);
  document.body.append(bar);

  const state = { floor: null, a: null, b: null, raw: [], wp: [] };
  const wpBuf = new Float32Array(MAX_WP * 3);
  let k = 1, ox = 0, oy = 0;
  const toPx = (x, z) => [ox + (x - MAP.x0) * k, oy + (z - MAP.z0) * k];
  const toWorld = (px, py) => [(px - ox) / k + MAP.x0, (py - oy) / k + MAP.z0];
  const inFloor = (y) => state.floor === null || Math.abs(y - state.floor) < 0.75;

  function draw() {
    const w = (cv.width = innerWidth * devicePixelRatio), h = (cv.height = innerHeight * devicePixelRatio);
    k = Math.min((w - 40) / (MAP.x1 - MAP.x0), (h - 80) / (MAP.z1 - MAP.z0));
    ox = (w - (MAP.x1 - MAP.x0) * k) / 2;
    oy = 50 * devicePixelRatio;
    const c = cv.getContext('2d'), s = CELL * k;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#333a42';
    c.strokeRect(...toPx(MAP.x0, MAP.z0), (MAP.x1 - MAP.x0) * k, (MAP.z1 - MAP.z0) * k);
    let shown = 0, cover = 0;
    // 先画低的再画高的，高处的格子盖在上面
    const order = [];
    for (let n = 0; n < nav.nodes; n++) if (nav.walk(n) && inFloor(nav.nY[n])) order.push(n);
    order.sort((a, b) => nav.nY[a] - nav.nY[b]);
    for (const n of order) {
      const y = nav.nY[n], [px, py] = toPx(nav.cx(n) - CELL / 2, nav.cz(n) - CELL / 2);
      const t = Math.min(1, y / 9.2);
      c.fillStyle = `hsl(${200 - t * 170}, 55%, ${30 + t * 25}%)`;
      c.fillRect(px, py, s - 0.5, s - 0.5);
      shown++;
      if (nav.cover[n]) {
        cover++;
        c.fillStyle = nav.low[n] ? 'rgba(255,214,90,0.75)' : 'rgba(255,120,80,0.7)';
        c.fillRect(px + s * 0.3, py + s * 0.3, s * 0.4, s * 0.4);
      }
    }
    // 出生点
    c.fillStyle = '#ff4d6d';
    for (const p of seeds()) {
      const [px, py] = toPx(p.x, p.z);
      c.beginPath(); c.arc(px, py, 4 * devicePixelRatio, 0, Math.PI * 2); c.fill();
    }
    const line = (pts, color, width) => {
      if (pts.length < 2) return;
      c.strokeStyle = color; c.lineWidth = width * devicePixelRatio;
      c.beginPath();
      pts.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.stroke();
    };
    line(state.raw, 'rgba(255,255,255,0.45)', 1);
    line(state.wp, '#7CFC9A', 2.5);
    c.fillStyle = '#7CFC9A';
    for (const [x, z] of state.wp) { const [px, py] = toPx(x, z); c.fillRect(px - 3, py - 3, 6, 6); }
    info.textContent = `可走 ${nav.walkable}（显示 ${shown}，掩体 ${cover}） · 建网格 ${nav.ms.toFixed(1)} ms` +
      (state.wp.length ? ` · 路点 ${state.wp.length - 1}，原始 ${state.raw.length}，搜索 ${pf.expanded} 个节点` : '');
  }

  function path(x0, z0, x1, z1, y = state.floor ?? 0, y1 = y) {
    const a = nav.nearest(x0, y, z0, 3), b = nav.nearest(x1, y1, z1, 3);
    state.raw = []; state.wp = [];
    if (a < 0 || b < 0) { draw(); return null; }
    const t0 = performance.now();
    const end = pf.search(a, b, 20000, false);
    const ms = performance.now() - t0;
    if (end >= 0) {
      const len = pf.extract(end);
      for (let i = 0; i < len; i++) state.raw.push([nav.cx(pf.nodes[i]), nav.cz(pf.nodes[i]), nav.nY[pf.nodes[i]]]);
      const count = pf.smooth(len, wpBuf);
      state.wp.push([nav.cx(a), nav.cz(a), nav.nY[a]]);
      for (let i = 0; i < count; i++) state.wp.push([wpBuf[i * 3], wpBuf[i * 3 + 2], wpBuf[i * 3 + 1]]);
    }
    draw();
    return { found: end >= 0, ms: +ms.toFixed(2), expanded: pf.expanded, waypoints: state.wp.map((p) => p.map((v) => +v.toFixed(2))) };
  }

  cv.addEventListener('click', (e) => {
    const [x, z] = toWorld(e.clientX * devicePixelRatio, e.clientY * devicePixelRatio);
    if (!state.a || state.b) { state.a = [x, z]; state.b = null; state.raw = []; state.wp = []; draw(); return; }
    state.b = [x, z];
    path(state.a[0], state.a[1], x, z);
  });
  sel.addEventListener('change', () => { state.floor = sel.value === '' ? null : +sel.value; draw(); });
  addEventListener('resize', draw);
  draw();
  window.__nav = {
    nav, pf, level, draw, path,
    floor(y) { state.floor = y; draw(); },
    rebuild() { const ms = nav.build(seeds()); pf.ensure(); draw(); return ms; },
  };
});
