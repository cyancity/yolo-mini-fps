// 空仓换弹：旧弹匣从第一人称交给世界里的掉落道具（src/fx/mags.js）。
// 第一人称画在更窄的视场角（pipeline.vmFov）里，同一个位置在世界里画出来会小一圈：交接时把它摆到镜头前
// 深度乘 tan(vmFov/2) / tan(fov/2) 的地方，横竖不动，屏幕上的位置和大小都和这一帧第一人称里的弹匣对得上
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 脱落时顺着匣井往外的速度（米/秒）；翻滚角速度（弧度/秒）
const EJECT = 1.1, TUMBLE = 5;
const KEEP = new Set(['position', 'normal', 'uv']);
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _cq = new THREE.Quaternion();
const deg = THREE.MathUtils.degToRad;

// 第一人称弹匣的外形（弹匣自己的坐标），只取 materials 里那几份网格（匣体和底板，不要露出来的子弹），一个都没有就取顶点最多的那份。
// 合成一个网格、一份材质画；只留位置、法线、UV：和场景里用同一材质的网格一样，不多出着色器变体
export function magShape(group, materials) {
  const want = new Set([].concat(materials)), meshes = [];
  group.traverse((o) => { if (o.isMesh && want.has(o.material)) meshes.push(o); });
  if (!meshes.length) {
    let best = null;
    group.traverse((o) => { if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o; });
    if (best) meshes.push(best);
  }
  group.updateWorldMatrix(true, true);
  _m.copy(group.matrixWorld).invert();
  const geos = meshes.map((o) => {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    return g.applyMatrix4(_t.multiplyMatrices(_m, o.matrixWorld));
  });
  return geos.length > 1 ? mergeGeometries(geos) : geos[0];
}

// model：buildRifle 的返回值；rest：弹匣插在井里时相对枪的位置（不转）。在骨架和相机都更新完以后调用
export function dropMag(env, model, rest) {
  const mags = env.fx?.mags, cam = env.camera;
  if (!mags || !cam) return;
  cam.updateMatrixWorld();
  model.root.updateWorldMatrix(true, false);
  // 插在井里的那个弹匣在相机坐标里的位姿
  _m.multiplyMatrices(cam.matrixWorldInverse, model.root.matrixWorld).multiply(_t.makeTranslation(rest.x, rest.y, rest.z));
  _m.decompose(_p, _q, _s);
  const k = Math.tan(deg((env.pipeline?.vmFov ?? 55) * 0.5)) / Math.tan(deg(cam.fov * 0.5));
  _p.z *= k;
  // 顺着匣井往外掉（弹匣的 -Y），初速的深度分量同样压一压，头几帧在屏幕上走的方向和第一人称里一致
  _v.set(0, -EJECT, 0).applyQuaternion(_q);
  _v.z *= k;
  cam.getWorldQuaternion(_cq);
  _p.applyMatrix4(cam.matrixWorld);
  _q.premultiply(_cq);
  _v.applyQuaternion(_cq);
  if (env.player?.velocity) _v.add(env.player.velocity);
  _w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(TUMBLE * (0.6 + 0.4 * Math.random()));
  mags.spawn(_p, _q, _v, _w);
}
