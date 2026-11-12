// 逐像素对比，perf_probe.js 装进 __perf 里用（snap、diff、showDiff、dropSnap）。
// 改动应该不改变画面时用。固定机位、固定时间、关掉雨和 TAA，内部分辨率固定 1280×720，
// 把画面存进 IndexedDB（同一个端口的所有标签页共用，刷新和重开都还在）。
//   await __perf.snap('base')   存一套；改完代码刷新页面后 await __perf.diff('base') 逐机位比较，
//   返回每个机位的 [最大差, 平均差, 差大于 2 的通道数]（0 到 255）。同一份代码重复比、刷新后再比，最大差都不超过 1。
//   __perf.showDiff('night:yardN') 把差值放大贴在画面上；await __perf.dropSnap('base') 删掉一套。
// 机位是 [x, 眼高 y, z, 偏航度, 俯仰度]；时段默认下午和夜晚各一套
const d = window.__dbg, p = d.pipeline, r = p.renderer, gl = r.getContext();
let size = null;

const SNAP_POSES = {
  yardN: [0, 1.64, -9, 0, 0], yardS: [0, 1.64, 2, 180, -4], yardW: [0, 1.64, 2, 90, -2], spawn: [-9, 1.64, 16, 0, 0],
  street: [35, 1.64, 4, 0, -3], streetS: [34, 1.64, 15, 180, -4], dock: [20, 1.64, -35, 0, -3],
  warehouse: [-16, 2.74, -26.5, -90, 2], warehouseE: [20, 1.64, -26.5, 90, 0], office: [-1, 2.74, -45.5, 120, -8], office2: [-12, 6.24, -40, -60, -6],
  roof: [-18, 10.7, -22, 160, -20], roofN: [-5, 9.74, -47, 0, -14],
};
const SNAP_SIZE = [1280, 720];

function snapSetup(tod) {
  const g = d.game;
  if (g.state !== 'playing' || g.mode !== 'waves') d.play('waves');
  d.god(true);
  g.nextWaveAt = Infinity;
  g.soldiers.clear?.();
  g.drones.clear?.();
  if (g.quality !== 'high') g.applyQuality('high');
  d.tod.set(tod);
  d.freeze(false);
  d.view(0, -9, 0, 0, 0);
  d.frame(40, 1 / 60);
  d.freeze(true);
  g.fx.rain.enabled = false;
  if (d.camera.children[0]) d.camera.children[0].visible = false;
  p.settings.taa = false;
  size(...SNAP_SIZE);
  // 钉住所有会动的东西：云、各分区的闪烁灯和远处车流、箱内灯管，粒子层整个不画；
  // 环境探针里烤着天空和灯，钉完重烤一次，两次截图才对得上
  const L = d.level.lighting;
  d.sky.material.uniforms.uTime.value = 500;
  for (const z of d.level.zones) z.update?.(0, 1234, L.zoneLights[z.name] || []);
  L.boxLight.intensity = 150;
  d.fxScene.visible = false;
  d.tod.bake();
}

function snapGrab(pose) {
  const [x, y, z, yaw, pitch] = pose;
  d.camera.position.set(x, y, z);
  d.camera.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
  d.camera.updateMatrixWorld(true);
  // 不走 dbg.frame：地面涟漪的时间也钉死。连画三帧（帧号 101 到 103），隔帧刷新的倒影和阴影都轮得到；取最后一帧
  const frame = { scene: d.scene, fxScene: d.fxScene, camera: d.camera, dt: 0, beforeMain: (rr) => d.level.ground.update(rr, d.scene, d.camera, 1000, p.frame) };
  p.frame = 100;
  p.time = 1000;
  for (let i = 0; i < 3; i++) p.render(frame);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, out = new Uint8Array(w * h * 4);
  r.setRenderTarget(null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

function snapAll(tods) {
  const shots = {};
  for (const tod of tods) {
    snapSetup(tod);
    d.level.lighting.refreshAllShadows?.();
    for (const [name, pose] of Object.entries(SNAP_POSES)) shots[tod + ':' + name] = snapGrab(pose);
  }
  return shots;
}

const idb = () => new Promise((ok, fail) => {
  const q = indexedDB.open('dock-zero-perf', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('snaps');
  q.onsuccess = () => ok(q.result);
  q.onerror = () => fail(q.error);
});
const idbDo = async (mode, fn) => {
  const db = await idb();
  return new Promise((ok, fail) => {
    const tx = db.transaction('snaps', mode), q = fn(tx.objectStore('snaps'));
    tx.oncomplete = () => { db.close(); ok(q.result); };
    tx.onerror = () => { db.close(); fail(tx.error); };
  });
};

async function snap(name = 'base', tods = ['afternoon', 'night']) {
  const shots = snapAll(tods);
  await idbDo('readwrite', (st) => st.put({ shots, size: SNAP_SIZE, at: new Date().toISOString(), programs: r.info.programs.length }, name));
  return { name, shots: Object.keys(shots).length, bytes: Object.values(shots).reduce((n, a) => n + a.length, 0) };
}

function cmpPixels(a, b) {
  if (!a || !b || a.length !== b.length) return [-1, -1, -1];
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i] - b[i]);
    if (v > max) max = v;
    sum += v;
    if (v > 2) over++;
  }
  return [max, +(sum / a.length).toFixed(4), over];
}

async function diff(name = 'base', tods = ['afternoon', 'night']) {
  const base = await idbDo('readonly', (st) => st.get(name));
  if (!base) throw new Error('没有名叫 ' + name + ' 的基线，先 __perf.snap');
  const shots = snapAll(tods), out = {};
  let worst = 0;
  for (const k of Object.keys(shots)) {
    out[k] = cmpPixels(shots[k], base.shots[k]);
    worst = Math.max(worst, out[k][0]);
  }
  // 只留有差别的机位给 showDiff 用，全留着要占两百兆
  const keep = Object.keys(out).filter((k) => out[k][0] !== 0), pick = (o) => Object.fromEntries(keep.map((k) => [k, o[k]]));
  window.__perfLast = { shots: pick(shots), base: pick(base.shots) };
  return { name, baseAt: base.at, worst, programs: [base.programs, r.info.programs.length], views: out };
}

// 一套基线九十多兆，用完删掉：不给名字就列出现有的
const dropSnap = (name) => (name ? idbDo('readwrite', (st) => st.delete(name)).then(() => name) : idbDo('readonly', (st) => st.getAllKeys()));

// 上一次 diff 里某个机位差在哪：把差值放大画到画布上，贴在页面左上角（再调一次传 null 拿掉）
function showDiff(key, gain = 16) {
  document.getElementById('perf-diff')?.remove();
  if (!key) return null;
  const L = window.__perfLast, a = L?.shots[key], b = L?.base[key];
  if (!a || !b) throw new Error('先跑 __perf.diff，再给一个机位名，比如 night:yardN');
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, c = document.createElement('canvas');
  c.id = 'perf-diff';
  c.width = w; c.height = h;
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:100%;height:100%;object-fit:contain;background:#000';
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4, o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) img.data[o + k] = Math.min(255, Math.abs(a[i + k] - b[i + k]) * gain);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.body.append(c);
  return key;
}

export function makeSnap(sizeFn) {
  size = sizeFn;
  return { snap, diff, showDiff, dropSnap, SNAP_POSES };
}
