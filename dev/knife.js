// 爪刀预览，两种模式。两种模式地址里都能带 skin=steel|emerald（默认 emerald）。
//
// 模型（默认）。地址栏参数（刷新后保持）：#view=偏航,俯仰,距离,tx,ty,tz&rot=转刀角度&spin&skin=steel&lamp=角度
//   一盏灯绕着刀转（lamp=角度 就停在那个角度），看高光和闪点怎么在刀上走。
//   控制台里 __knife 是 buildKarambit 的返回值，另外：
//     stats            网格数、三角形数、两套涂装各自的 draw call
//     skin(name)       换涂装；lamp(度) 把灯停在某个角度，lamp() 接着转
//     sheet(列数)      拼图：上排钢色、下排绿宝石，每列一个灯位；sheet(0) 回到单张
//
// 第一人称（?fp，可加 &aspect=1.6）：真的 Knife 类放在和游戏视图模型一样的 55° 相机前，调握姿和动作用。
//   键盘：1 快划（按住连击）、2 重击、` 检视、D 掏刀、H 收刀、N 取消收刀、I 瞬间到手、X 喷气、G 换涂装、
//         Shift 冲刺、C 滑铲、Q / E 探头
//   控制台 __fp：
//     go(name, t)               把一个片段重放到 t 秒处停住；name 见 CLIPS
//     sheet(name, from, to, n)  把片段里等间隔的 n 帧拼成一张图：每格左上角是时间，红框 = 前臂穿帮
//     tiles(n, setup)           通用拼图：setup(i) 摆好第 i 格的状态并返回标注（比如同一帧换几个 orbit 视角）；
//                               setup 里用 pose(name, t) 可以把几个片段拼在一张图里
//     check(name)               按 1/120 s 走完整个片段，返回前臂穿帮的时间段（16:9 和 16:10 都查）、离镜头最近的距离、
//                               刀身离屏幕中心最近的时刻、相邻两步之间姿态变化的最大值（毫米 / 度，查跳变用）
//     live()                    回到实时播放；orbit(偏航, 俯仰, 距离, x, y, z) 绕着手看握姿（xyz 是手的局部坐标里的注视点），fp() 回到第一人称
//     crop(x0, y0, x1, y1)      只看第一人称画面的一块（0..1，左上为原点），不带参数恢复；aspect(1.6) 换宽高比
//     knife / TUNE / MOVES      Knife 实例、KNIFE_TUNE、动作表（改了数值立即生效，调好再抄回 knife_anim.js）
import { startHarness } from './harness.js';
import { buildKarambit } from '../src/weapons/knife_model.js';

const VM_FOV = 55, NEAR = 0.03, STEP = 1 / 120;
const query = new URLSearchParams(location.search);
const hash = () => Object.fromEntries(location.hash.slice(1).split('&').map((kv) => kv.split('=')));
const SKIN = query.get('skin') || hash().skin || 'emerald';

function modelView(h) {
  const { THREE, scene, camera, renderer } = h;
  const knife = buildKarambit(h.gear);
  scene.add(knife.root);
  knife.setSkin(SKIN);
  const stats = { meshes: 0, tris: 0, calls: {} };
  knife.root.traverse((o) => {
    if (!o.isMesh) return;
    stats.meshes++;
    // 各网格共用一条缓冲，只画自己那一段
    stats.tris = Math.max(stats.tris, o.geometry.attributes.position.count / 3);
  });
  const lamp = new THREE.PointLight(0xfff0dc, 0.55);
  scene.add(lamp);
  const state = { lamp: null, cols: 0, spin: false };
  // 灯在刀面前方绕竖轴转：90° 时正对刀面（和默认机位同侧）
  const aim = (deg) => {
    const a = THREE.MathUtils.degToRad(deg);
    lamp.position.set(Math.sin(a) * 0.36, 0.1, -0.03 + Math.cos(a) * 0.36);
  };
  const count = (skin) => {
    knife.setSkin(skin);
    renderer.info.reset();
    const sky = h.sky.mesh.visible;
    h.sky.mesh.visible = false;
    renderer.render(scene, camera);
    h.sky.mesh.visible = sky;
    return renderer.info.render.calls;
  };
  window.__knife = {
    ...knife, stats, lampLight: lamp,
    skin(name) { knife.setSkin(name); return name; },
    lamp(deg = null) { state.lamp = deg; },
    sheet(cols = 4) { state.cols = cols; },
    measure() {
      stats.calls = { steel: count('steel'), emerald: count('emerald') };
      knife.setSkin(SKIN);
      return stats;
    },
  };
  const apply = () => {
    const q = hash();
    h.view(...(q.view ? q.view.split(',').map(Number) : [90, 0, 0.3, 0, -0.012, -0.025]));
    knife.spin.rotation.x = THREE.MathUtils.degToRad(Number(q.rot) || 0);
    state.spin = 'spin' in q;
    state.lamp = 'lamp' in q ? Number(q.lamp) : null;
    if (q.skin) knife.setSkin(q.skin);
  };
  addEventListener('hashchange', apply);
  apply();
  const canvas = renderer.domElement;
  h.onFrame = (dt, t) => {
    knife.gem.uniforms.uGemTime.value += dt;
    if (state.spin) knife.spin.rotation.x += dt * 4;
    const W = canvas.clientWidth, H = canvas.clientHeight, cols = state.cols;
    if (!cols) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      aim(state.lamp ?? t * 40);
      return;
    }
    const tw = W / cols, th = H / 2;
    renderer.setScissorTest(true);
    camera.aspect = tw / th;
    camera.updateProjectionMatrix();
    ['steel', 'emerald'].forEach((skin, row) => {
      knife.setSkin(skin);
      for (let c = 0; c < cols; c++) {
        aim(30 + 120 * c / Math.max(1, cols - 1));
        renderer.setViewport(c * tw, H - (row + 1) * th, tw, th);
        renderer.setScissor(c * tw, H - (row + 1) * th, tw, th);
        renderer.render(scene, camera);
      }
    });
    renderer.setViewport(0, 0, 1, 1);
    renderer.setScissor(0, 0, 1, 1);
  };
}

// 片段：len 是默认看多长；player 是替身角色的状态；start 触发动作；hold 是全程按住的键；
// at = [[秒, 做什么], ...] 是中途的事件；sprint / dash = [从, 到] 这段时间在冲刺 / 喷气（喷气后收刀硬直 0.26 s，同 weapons.js）
const CLIPS = {
  idle: { len: 1 },
  sprint: { len: 1.2, sprint: [0, 9] },
  run: { len: 1.6, sprint: [0.15, 1.1] },
  slide: { len: 1, player: { slide: 1 } },
  leanL: { len: 1, player: { lean: -1 } },
  leanR: { len: 1, player: { lean: 1 } },
  draw: { len: 0.9, start: (k) => k.equip() },
  holster: { len: 0.25, start: (k) => k.unequip() },
  cancelA: { len: 0.5, start: (k) => k.unequip(), at: [[0.05, (k) => k.cancelUnequip()]] },
  cancelB: { len: 0.5, start: (k) => k.unequip(), at: [[0.11, (k) => k.cancelUnequip()]] },
  cancelC: { len: 0.5, start: (k) => k.unequip(), at: [[0.18, (k) => k.cancelUnequip()]] },
  drawCut: { len: 0.4, start: (k) => k.equip(), at: [[0.12, (k) => k.unequip()]] },
  hammer: { len: 1, start: (k) => k.unequip(), at: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t, i) => [t, (k) => (i % 2 ? k.unequip() : k.cancelUnequip())]) },
  instant: { len: 0.3, start: (k) => k.equip({ instant: true }) },
  dash: { len: 0.9, dash: [0.1, 0.3], player: { dashS: 0 } },
  dashL: { len: 0.9, dash: [0.1, 0.3], player: { dashS: -1 } },
  dashR: { len: 0.9, dash: [0.1, 0.3], player: { dashS: 1 } },
  slashA: { len: 0.55, start: (k) => k.start('slashA') },
  slashB: { len: 0.55, start: (k) => k.start('slashB') },
  slashCut: { len: 0.6, start: (k) => k.start('slashA'), at: [[0.13, (k) => k.unequip()], [0.24, (k) => k.cancelUnequip()]] },
  heavy: { len: 1.1, start: (k) => k.start('heavy') },
  inspect: { len: 4.2, start: (k) => k.start('inspect') },
  combo: { len: 2, hold: 'Mouse0' },
};
const REST = { sprinting: false, slide: 0, lean: 0, stride: 0, moveAmount: 0, dash: 0, dashS: 0, dashF: 0 };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

async function firstPerson(h) {
  const { THREE, scene, camera, renderer } = h;
  const [{ Knife }, { KNIFE_TUNE, MOVES }] = await Promise.all([import('../src/weapons/knife.js'), import('../src/weapons/knife_anim.js')]);
  // 夜空太暗，看不清深色手套的轮廓
  h.sky.mesh.visible = false;
  scene.background = new THREE.Color(0x4a4f57);

  // Knife 只读这几样东西，全用替身。vm.time 和 state.tuck 照 weapons.js 的走法推进
  const keys = new Set(), hit = new Set();
  const player = { ...REST }, vm = { time: 0, aim() {}, punch() {} }, env = { tuck: 0 };
  const knife = new Knife({
    gear: h.gear, player, vm, state: env,
    input: { down: (c) => keys.has(c), pressed: (c) => hit.has(c) },
    audio: { play() {} }, hud: { hitmarker() {} }, fx: {},
    hitscan: () => null, strike: () => ({}), kickView() {},
  });
  knife.setSkin(SKIN);
  scene.add(knife.holder);

  const state = { aspect: Number(query.get('aspect')) || 16 / 9, clip: 'idle', t: 0, sheet: null, live: true, orbit: null, sprint: false, dashAt: -9 };
  const inside = (r, t) => !!r && t >= r[0] - 1e-9 && t < r[1] - 1e-9;
  // 推进一步。clip 给了时间段的按片段走，没给的（实时模式）按键盘的开关走
  const tick = (dt, clip) => {
    const t = state.t;
    for (const [at, fn] of clip?.at || []) if (at >= t - 1e-9 && at < t + dt - 1e-9) fn(knife);
    const sprinting = clip?.sprint ? inside(clip.sprint, t) : state.sprint;
    const dashing = clip?.dash ? inside(clip.dash, t) : t - state.dashAt < 0.2;
    const tucked = clip?.dash ? t >= clip.dash[0] && t < clip.dash[1] + 0.26 : t - state.dashAt < 0.46;
    player.sprinting = sprinting && !dashing;
    player.moveAmount = damp(player.moveAmount, player.sprinting ? 1.4 : 0, 10, dt);
    if (player.sprinting) player.stride += 6.93 * dt / 1.05;
    player.dash = damp(player.dash, dashing ? 1 : 0, dashing ? 30 : 7, dt);
    env.tuck = damp(env.tuck, tucked ? 1 : 0, tucked ? 26 : 13, dt);
    knife.update(dt, !tucked);
    vm.time += dt;
    hit.clear();
    state.t += dt;
  };
  const restart = (name) => {
    const clip = CLIPS[name];
    knife.reset();
    Object.assign(player, REST, clip.player);
    env.tuck = 0;
    keys.clear();
    hit.clear();
    if (clip.hold) keys.add(clip.hold);
    clip.start?.(knife);
    // 0 秒那一格也要摆到片段的起始姿态，不然留着上一格的样子
    knife.animate();
    state.clip = name;
    state.t = 0;
  };
  const advance = (to) => { while (state.t < to - 1e-9) tick(STEP, CLIPS[state.clip]); };

  // 前臂是根 0.34 m 的管子，肘那头是封口的断面。看它落在画面里的那部分：
  // end = 沿前臂最远到哪（到 0.33 以上就是断面进了画面），cut = 在画面里穿过近裁剪面（会看进管子里面）
  const _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _lastP = new THREE.Vector3(), _lastQ = new THREE.Quaternion();
  const tv = Math.tan(THREE.MathUtils.degToRad(VM_FOV / 2));
  const forearm = (aspect = state.aspect) => {
    const th = tv * aspect;
    knife.arm.root.updateWorldMatrix(true, false);
    _m.copy(knife.arm.root.matrixWorld);
    let end = 0, cut = false;
    for (let a = 0; a < 16; a++) {
      const c = Math.cos(a * Math.PI / 8), s = Math.sin(a * Math.PI / 8);
      let px = 0, py = 0, pz = 1;
      for (let z = 0.04; z < 0.3445; z += 0.004) {
        const k = Math.min(1, (z - 0.04) / 0.26);
        _p.set((0.04 + 0.016 * k) * c, -0.003 + (0.034 + 0.016 * k) * s, z).applyMatrix4(_m);
        const front = _p.z < -NEAR;
        if (front && Math.abs(_p.x) < -_p.z * th * 1.02 && Math.abs(_p.y) < -_p.z * tv * 1.02) end = Math.max(end, z);
        if (pz <= 0 && front !== pz < -NEAR) {
          const u = (-NEAR - pz) / (_p.z - pz), x = px + (_p.x - px) * u, y = py + (_p.y - py) * u;
          if (Math.abs(x) < NEAR * th * 1.05 && Math.abs(y) < NEAR * tv * 1.05) cut = true;
        }
        px = _p.x; py = _p.y; pz = _p.z;
      }
    }
    return { end: +end.toFixed(3), cut, bad: end > 0.33 || cut };
  };
  // 刀身（刀根 → 刀尖的弦）离屏幕中心多远，单位是半个屏幕高；顺带给刀尖的屏幕坐标
  const blade = (aspect = state.aspect) => {
    knife.model.anchors.tip.getWorldPosition(_a);
    knife.model.anchors.grip.getWorldPosition(_b).lerp(_a, 0.35);
    const ax = _a.x / -_a.z / tv, ay = _a.y / -_a.z / tv, bx = _b.x / -_b.z / tv, by = _b.y / -_b.z / tv;
    const dx = bx - ax, dy = by - ay, u = Math.min(1, Math.max(0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    return { gap: +Math.hypot(ax + dx * u, ay + dy * u).toFixed(3), tip: [+(ax / aspect).toFixed(2), +ay.toFixed(2)], depth: +(-_a.z).toFixed(3) };
  };
  // 手和刀上离镜头最近的点（相机前方的距离）
  const nearest = () => {
    let min = Infinity;
    const see = (o) => { min = Math.min(min, -o.getWorldPosition(_p).z); };
    for (const chain of knife.arm.root.userData.rig.chains) for (const bone of chain) see(bone);
    see(knife.arm.hand);
    for (const k in knife.model.anchors) see(knife.model.anchors[k]);
    return +min.toFixed(3);
  };

  // 画面：实时模式按给定宽高比居中留黑边；拼图模式把各帧画进一格一格的视口。
  // state.crop = [x0, y0, x1, y1]（0..1，左上为原点）只画第一人称画面里的这一块，放大看细节
  const canvas = renderer.domElement, labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:11px/1 ui-monospace,Consolas,monospace;color:#fff;text-shadow:0 0 3px #000';
  document.body.append(labels);
  const crop = () => (state.orbit ? null : state.crop);
  const shape = () => { const c = crop(); return state.aspect * (c ? (c[2] - c[0]) / (c[3] - c[1]) : 1); };
  const mark = (x, y, w, hgt, text, bad) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${hgt}px;box-sizing:border-box;padding:3px 4px;border:${bad ? '2px solid #f33' : '1px solid #0006'}`;
    d.textContent = text;
    // 屏幕中心的小圈
    const c = crop(), cx = c ? (0.5 - c[0]) / (c[2] - c[0]) : 0.5, cy = c ? (0.5 - c[1]) / (c[3] - c[1]) : 0.5;
    if (cx > 0 && cx < 1 && cy > 0 && cy < 1) {
      const o = document.createElement('div');
      o.style.cssText = `position:absolute;left:${cx * 100}%;top:${cy * 100}%;width:9px;height:9px;margin:-5px 0 0 -5px;border:1px solid #fffc;border-radius:50%`;
      d.append(o);
    }
    labels.append(d);
  };
  const rect = (x, y, w, hgt) => {
    const H = canvas.clientHeight, c = crop();
    renderer.setViewport(x, H - y - hgt, w, hgt);
    renderer.setScissor(x, H - y - hgt, w, hgt);
    camera.aspect = state.aspect;
    if (c) camera.setViewOffset(1, 1, c[0], c[1], c[2] - c[0], c[3] - c[1]);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  const eye = () => {
    if (state.orbit) {
      camera.fov = 35; camera.near = 0.005;
      // 目标点给的是手的局部坐标（默认拳心），视角跟着手走
      const o = state.orbit;
      knife.arm.hand.localToWorld(_p.set(o[3] ?? 0, o[4] ?? -0.02, o[5] ?? -0.07));
      h.view(o[0], o[1], o[2], _p.x, _p.y, _p.z);
    } else {
      camera.fov = VM_FOV; camera.near = NEAR;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    }
  };
  let drawn = '';
  h.onFrame = (dt) => {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = state.sheet;
    renderer.setScissorTest(true);
    const sig = `${W}x${H}:${s ? [s.id, s.n] : state.live}:${state.aspect}:${state.crop}:${state.orbit}`;
    if (sig !== drawn) {
      drawn = sig;
      labels.textContent = '';
      renderer.setViewport(0, 0, W, H);
      renderer.setScissor(0, 0, W, H);
      renderer.setClearColor(0x000000);
      renderer.clear();
    }
    const fresh = !labels.childElementCount;
    if (!s) {
      if (state.live) tick(Math.min(dt, 0.05), null);
      const w = Math.min(W, H * shape()), hgt = w / shape(), x = (W - w) / 2, y = (H - hgt) / 2;
      eye();
      rect(x, y, w, hgt);
      if (fresh) mark(x, y, w, hgt, '', false);
      return;
    }
    // 拼图：选一个让格子最大的列数，逐格推进到那一帧再画；最后把视口缩成一个像素，harness 自己那次渲染就不会盖掉它
    let cols = 1, tw = 0;
    for (let c = 1; c <= s.n; c++) {
      const w = Math.min(W / c, (H / Math.ceil(s.n / c)) * shape());
      if (w > tw) { tw = w; cols = c; }
    }
    const thh = tw / shape();
    for (let i = 0; i < s.n; i++) {
      const label = s.setup(i), x = (i % cols) * tw, y = Math.floor(i / cols) * thh;
      eye();
      rect(x, y, tw, thh);
      renderer.render(scene, camera);
      if (fresh) mark(x, y, tw, thh, label, !state.orbit && (forearm(16 / 9).bad || forearm(1.6).bad));
    }
    renderer.setViewport(0, 0, 1, 1);
    renderer.setScissor(0, 0, 1, 1);
  };

  const api = (window.__fp = {
    knife, TUNE: KNIFE_TUNE, MOVES, CLIPS, state, player, env, forearm, blade, nearest,
    go(name = state.clip, t = 0) {
      state.sheet = null;
      state.live = false;
      restart(name);
      advance(t);
      drawn = '';
      return { ...forearm(), ...blade(), nearest: nearest() };
    },
    sheet(name = state.clip, from = 0, to = CLIPS[name].len, n = 12) {
      return api.tiles(n, (i) => {
        if (i === 0) restart(name);
        const t = n > 1 ? from + (to - from) * i / (n - 1) : from;
        advance(t);
        return t.toFixed(3);
      }, `${name} ${from}..${to}`);
    },
    // 把片段摆到 t 秒，不动画面模式；给 tiles 的 setup 用（一张图里拼几个片段）
    pose(name, t = 0) { restart(name); advance(t); return `${name} ${t}`; },
    // 通用拼图：setup(i) 把第 i 格的状态摆好并返回标注文字
    tiles(n, setup, id = String(Math.random())) {
      state.sheet = { n, setup, id };
      state.live = false;
      drawn = '';
      return `${id} × ${n}`;
    },
    live() { state.sheet = null; state.live = true; drawn = ''; },
    orbit(yaw = 0, pitch = 30, dist = 0.45, x, y, z) { state.orbit = [yaw, pitch, dist, x, y, z]; },
    fp() { state.orbit = null; },
    aspect(a) { state.aspect = a; },
    crop(x0, y0, x1, y1) { state.crop = x0 === undefined ? null : [x0, y0, x1, y1]; },
    skin(name) { knife.setSkin(name); return knife.skin; },
    check(name = state.clip, len = CLIPS[name].len) {
      const bad = [], bad10 = [], hitT = MOVES[name]?.hit;
      let open = null, open10 = null, near = Infinity, best = { gap: Infinity }, atHit = null, jumpP = 0, jumpR = 0, jumpAt = 0;
      const span = (list, cur, f, t) => {
        if (f.bad && !cur) return [+t.toFixed(3), len, f.cut ? 'cut' : 'end'];
        if (!f.bad && cur) { cur[1] = +t.toFixed(3); list.push(cur); return null; }
        return cur;
      };
      restart(name);
      for (let t = 0; t <= len + 1e-9; t += STEP) {
        advance(t);
        open = span(bad, open, forearm(16 / 9), t);
        open10 = span(bad10, open10, forearm(1.6), t);
        near = Math.min(near, nearest());
        const b = blade(16 / 9);
        if (b.gap < best.gap) best = { t: +t.toFixed(3), ...b };
        if (hitT !== undefined && !atHit && t >= hitT - 1e-9) atHit = { t: +t.toFixed(3), ...b };
        // 相邻两步（1/120 s）之间 holder 走了多远、转了多少
        knife.holder.getWorldPosition(_p);
        knife.holder.getWorldQuaternion(_q);
        if (t > 0) {
          const dp = _p.distanceTo(_lastP) * 1000;
          if (dp > jumpP) { jumpP = dp; jumpAt = t; }
          jumpR = Math.max(jumpR, THREE.MathUtils.radToDeg(_q.angleTo(_lastQ)));
        }
        _lastP.copy(_p);
        _lastQ.copy(_q);
      }
      if (open) bad.push(open);
      if (open10) bad10.push(open10);
      return { bad, bad10, nearest: near, centre: best, atHit, step: { mm: +jumpP.toFixed(2), deg: +jumpR.toFixed(2), at: +jumpAt.toFixed(3) } };
    },
  });

  const TAP = { Digit1: 'Mouse0', Digit2: 'Mouse2', Backquote: 'Backquote' };
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tap = TAP[e.code];
    if (tap || 'KeyD KeyH KeyN KeyI KeyX KeyG ShiftLeft KeyC KeyQ KeyE'.includes(e.code)) api.live();
    if (tap) { keys.add(tap); hit.add(tap); e.preventDefault(); }
    if (e.code === 'KeyD') knife.equip();
    if (e.code === 'KeyH') knife.unequip();
    if (e.code === 'KeyN') knife.cancelUnequip();
    if (e.code === 'KeyI') knife.equip({ instant: true });
    if (e.code === 'KeyX') state.dashAt = state.t;
    if (e.code === 'KeyG') knife.setSkin(knife.skin === 'emerald' ? 'steel' : 'emerald');
    if (e.code === 'ShiftLeft') state.sprint = true;
    if (e.code === 'KeyC') player.slide = 1;
    if (e.code === 'KeyQ') player.lean = -1;
    if (e.code === 'KeyE') player.lean = 1;
  });
  addEventListener('keyup', (e) => {
    keys.delete(TAP[e.code]);
    if (e.code === 'ShiftLeft') state.sprint = false;
    if (e.code === 'KeyC') player.slide = 0;
    if (e.code === 'KeyQ' || e.code === 'KeyE') player.lean = 0;
  });
}

startHarness(query.has('fp') ? firstPerson : modelView);
