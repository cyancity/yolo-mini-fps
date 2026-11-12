// 步枪模型预览。控制台里：
//   __h.view(yaw, pitch, dist, tx, ty, tz)   环绕视角（yaw 0 = 从枪后往前看，-90 = 左侧，90 = 右侧）
//   __eye(x, y, z, fov, tx, ty, tz)          把相机放到枪的局部坐标某点，默认朝正前方看
//   __ads(fov = 55)                          相机放到开镜时的眼位（光轴上、镜片后面 EYE_RELIEF）
//   __studio(on = true)                      中性摄影棚（灰背景、中性环境光）；false 回到关卡的夜空
//   __only(name)                             只看单独建的一份部件：sight / upper / lower / laser / stack / stock；不传回到整枪
//   __shot(name)                             验收机位：sight（后方四分之三看红点）、stackSide、stackFront、upper、stock、left、right
//   __measure(aspect = 16 / 9)               开镜取景的数：镜片和整个瞄具占画面高度的比例、红点周围的净空、枪托一组是否入画
//   __transit(aspect = 16 / 9)               腰射到开镜一路上枪托一组和拉机柄在不在画面里
//   __pose({ mag, bolt, handle, trigger, selector })   摆活动件：前三个是位移（米），后两个是转角（弧度）
//   __arms(on = true)                        挂上两只手（和游戏里同一套握持）
//   __reload(t, empty = false)               手和弹匣摆到换弹第 t 秒（整枪不动，方便绕着看有没有穿模）
//   __rifle                                  buildRifle 的返回值
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { startHarness } from './harness.js';
import { buildRifle } from '../src/weapons/rifle_model.js';
import { buildArm } from '../src/weapons/hands.js';
import { RifleRig, RIFLE_POSES } from '../src/weapons/rifle_anim.js';
import { EYE_RELIEF, SIGHT, OPTIC } from '../src/weapons/rifle_optics.js';
import { makeKit, RAIL_Y } from '../src/weapons/rifle_kit.js';
import { makeMarkings } from '../src/weapons/rifle_marks.js';
import { buildLowerRiser, buildUpperRiser } from '../src/weapons/rifle_risers.js';
import { buildSight, lensMaterials } from '../src/weapons/rifle_sight.js';
import { buildLaser } from '../src/weapons/rifle_lasermod.js';
import { buildStock } from '../src/weapons/rifle_stock.js';

const VM_FOV = 55, NEAR = 0.03; // 游戏里第一人称武器的视场角和近裁面
const SHOTS = {
  sight: [null, 30, 20, 0.15, 0.002, 0.086, -0.133],
  stackSide: [null, -90, 2, 0.25, 0, 0.062, -0.158],
  stackFront: [null, -146, 30, 0.27, 0, 0.058, -0.16],
  upper: ['upper', -58, 14, 0.105, 0, 0.0612, -0.1325],
  stock: [null, 90, 2, 0.5, 0, -0.035, 0.148],
  left: [null, -90, 8, 1.15, 0, -0.03, -0.16],
  right: [null, 90, 8, 1.15, 0, -0.03, -0.16],
};

startHarness(async ({ scene, gear, view, camera, renderer, sky }) => {
  const t0 = performance.now();
  const rifle = buildRifle(gear);
  scene.add(rifle.root);
  let meshes = 0, tris = 0;
  rifle.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += o.geometry.attributes.position.count / 3;
  });
  console.log('[rifle] ' + meshes + ' meshes, ' + Math.round(tris) + ' tris, built in ' + Math.round(performance.now() - t0) + ' ms');
  const rest = {};
  for (const [name, p] of Object.entries(rifle.parts)) rest[name] = p.position.clone();
  window.__rifle = rifle;
  window.__pose = ({ mag = 0, bolt = 0, handle = 0, trigger = 0, selector = 0 } = {}) => {
    const { parts } = rifle;
    parts.mag.position.y = rest.mag.y - mag;
    parts.bolt.position.z = rest.bolt.z + bolt;
    parts.chargingHandle.position.z = rest.chargingHandle.z + handle;
    parts.trigger.rotation.x = trigger;
    parts.selector.rotation.x = selector;
  };
  window.__eye = (x, y, z, fov = VM_FOV, tx = x, ty = y, tz = z - 1) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
  };
  window.__ads = (fov = VM_FOV) => window.__eye(SIGHT.pos[0], SIGHT.pos[1], SIGHT.pos[2] + EYE_RELIEF, fov);

  // 单独的部件：同样的材质另建一份，只在 __only 时显示
  const extras = { decal: gear.decal(makeMarkings()), ledR: gear.glow(0xff3a22, 3), ...lensMaterials(gear) };
  const solo = {};
  const part = (name, build) => {
    const k = makeKit(gear, [0, 0, 0], extras);
    build(k);
    solo[name] = k.finish('solo.' + name);
    solo[name].visible = false;
    scene.add(solo[name]);
  };
  part('sight', buildSight);
  part('upper', buildUpperRiser);
  part('lower', buildLowerRiser);
  part('laser', buildLaser);
  part('stock', buildStock);
  part('stack', (k) => { buildLowerRiser(k); buildUpperRiser(k); buildLaser(k); buildSight(k); });
  window.__only = (name) => {
    rifle.root.visible = !name;
    for (const [key, g] of Object.entries(solo)) g.visible = key === name;
  };

  // 中性摄影棚：关卡的夜空偏红偏暗，黑色的零件看不出形状
  const night = { env: scene.environment, intensity: scene.environmentIntensity };
  const room = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const lights = scene.children.filter((o) => o.isDirectionalLight);
  const tint = lights.map((l) => l.color.clone());
  window.__studio = (on = true) => {
    sky.mesh.visible = !on;
    scene.background = on ? new THREE.Color(0x4a4d52) : null;
    scene.environment = on ? room : night.env;
    scene.environmentIntensity = on ? 0.85 : night.intensity;
    lights.forEach((l, i) => { if (on) l.color.set(0xffffff); else l.color.copy(tint[i]); });
    renderer.toneMappingExposure = on ? 1.25 : 1;
  };
  window.__shot = (name) => {
    const [only, yaw, pitch, dist, tx, ty, tz] = SHOTS[name];
    window.__only(only);
    camera.fov = 35;
    camera.updateProjectionMatrix();
    view(yaw, pitch, dist, tx, ty, tz);
  };

  let rig = null;
  const state = { boltT: 0, boltDrop: 0, locked: false, selT: 1, auto: true, reloading: false, reloadT: 0, reloadEmpty: false };
  window.__arms = (on = true) => {
    if (!rig) rig = new RifleRig(rifle, buildArm(gear, 'R'), buildArm(gear, 'L'));
    rig.armR.root.visible = rig.armL.root.visible = on;
    state.reloading = false;
    rig.parts(state, 0, false);
    return rig;
  };
  window.__reload = (t, empty = false) => {
    window.__arms();
    Object.assign(state, { reloading: true, reloadT: t, reloadEmpty: empty, locked: empty && t < 1.7, boltDrop: 0 });
    rig.parts(state, 0, false);
  };

  measuring(rifle, solo);
  window.__studio(true);
  window.__shot('left');
});

// 开镜取景的测量：不渲染，直接把三角形投到“眼睛在光轴上、视场角 55°”的画面里算
function measuring(rifle, solo) {
  const tanY = Math.tan(THREE.MathUtils.degToRad(VM_FOV / 2));
  const v = new THREE.Vector3();
  // 一个网格的三角形换到相机坐标（pose 是枪在相机里的位姿矩阵），逐个交给 fn(a, b, c)。
  // minZ：先在枪坐标里把 z 小于它的部分切掉（拉机柄只算露在机匣后面的柄头，杆身藏在机匣里）
  const eachTri = (mesh, pose, fn, minZ = -Infinity) => {
    mesh.updateWorldMatrix(true, false);
    const p = mesh.geometry.attributes.position, idx = mesh.geometry.index, pts = [];
    for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).toArray());
    const cam = (q) => v.fromArray(q).applyMatrix4(pose).toArray();
    for (let i = 0; i < (idx ? idx.count : p.count); i += 3) {
      const tri = [0, 1, 2].map((k) => pts[idx ? idx.getX(i + k) : i + k]);
      if (Math.min(tri[0][2], tri[1][2], tri[2][2]) >= minZ) {
        fn(cam(tri[0]), cam(tri[1]), cam(tri[2]));
        continue;
      }
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3], ina = a[2] >= minZ, inb = b[2] >= minZ;
        if (ina) poly.push(a);
        if (ina !== inb) {
          const t = (minZ - a[2]) / (b[2] - a[2]);
          poly.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, minZ]);
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) fn(cam(poly[0]), cam(poly[k]), cam(poly[k + 1]));
    }
  };
  const meshesOf = (o) => { const out = []; o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };
  // 近裁面以内的部分切掉，剩下的投成切线坐标 [x / -z, y / -z]
  const project = (tri) => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], ina = a[2] < -NEAR, inb = b[2] < -NEAR;
      if (ina) out.push([a[0] / -a[2], a[1] / -a[2]]);
      if (ina !== inb) {
        const t = (-NEAR - a[2]) / (b[2] - a[2]);
        out.push([(a[0] + (b[0] - a[0]) * t) / NEAR, (a[1] + (b[1] - a[1]) * t) / NEAR]);
      }
    }
    return out;
  };
  // 凸多边形和画面矩形（半宽 hx、半高 hy）有没有重叠：分离轴
  const onScreen = (poly, hx, hy) => {
    if (poly.length < 3) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x0 > hx || x1 < -hx || y0 > hy || y1 < -hy) return false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], nx = b[1] - a[1], ny = a[0] - b[0];
      let pmin = Infinity, pmax = -Infinity;
      for (const [x, y] of poly) { const d = x * nx + y * ny; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
      const r = Math.abs(nx) * hx + Math.abs(ny) * hy;
      if (pmin > r || pmax < -r) return false;
    }
    return true;
  };
  // 原点（红点）到多边形的距离，原点在多边形里面算 0
  const distToOrigin = (poly) => {
    let best = Infinity, inside = poly.length >= 3, sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1];
      const t = Math.max(0, Math.min(1, -(a[0] * ex + a[1] * ey) / (ex * ex + ey * ey || 1)));
      best = Math.min(best, Math.hypot(a[0] + ex * t, a[1] + ey * t));
      const c = a[0] * ey - a[1] * ex;
      if (c !== 0) { if (sign && Math.sign(c) !== sign) inside = false; sign = sign || Math.sign(c); }
    }
    return inside && sign ? 0 : best;
  };
  const adsPose = () => new THREE.Matrix4().makeTranslation(-SIGHT.pos[0], -SIGHT.pos[1], -EYE_RELIEF - SIGHT.pos[2]);
  const glassy = (mat) => mat.transparent;
  // 开镜时不该进画面的东西：枪托一组整个算，拉机柄只算机匣后端面以后的柄头
  const rearMeshes = () => [
    ...meshesOf(rifle.root.getObjectByName('rifle.stock')).map((mesh) => ({ mesh, key: 'stock', minZ: -Infinity })),
    ...meshesOf(rifle.parts.chargingHandle).map((mesh) => ({ mesh, key: 'handle', minZ: 0.0005 })),
  ];
  const pct = (x) => +(x * 100).toFixed(2), deg = (t) => +THREE.MathUtils.radToDeg(Math.atan(t)).toFixed(2);

  window.__measure = (aspect = 16 / 9) => {
    const pose = adsPose(), tanX = tanY * aspect, sill = OPTIC.deck + OPTIC.base;
    rifle.setAim(0);
    // 镜片：下槛到镜片上沿
    const ty = (y, z) => (y - SIGHT.pos[1]) / (EYE_RELIEF + SIGHT.pos[2] - z);
    const glass = (ty(sill + OPTIC.glass, OPTIC.z) - ty(sill, OPTIC.z)) / (2 * tanY);
    // 整个瞄具（镜座、立柱、镜片）在画面里的上下范围
    let lo = Infinity, hi = -Infinity;
    for (const mesh of meshesOf(solo.sight)) {
      eachTri(mesh, pose, (a, b, c) => { for (const q of project([a, b, c])) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); } });
    }
    // 红点周围的净空：除了镜片以外，离光轴最近的东西有多远
    let clear = Infinity;
    for (const mesh of meshesOf(rifle.root)) {
      if (glassy(mesh.material)) continue;
      eachTri(mesh, pose, (a, b, c) => { clear = Math.min(clear, distToOrigin(project([a, b, c]))); });
    }
    // 枪托一组和拉机柄：有没有三角形进画面，最高的一点离画面下沿还差多少
    let shown = 0, top = -Infinity;
    for (const { mesh, minZ } of rearMeshes()) {
      eachTri(mesh, pose, (a, b, c) => {
        const poly = project([a, b, c]);
        if (onScreen(poly, tanX, tanY)) shown++;
        for (const q of poly) top = Math.max(top, q[1]);
      }, minZ);
    }
    const eyeY = SIGHT.pos[1], eyeZ = SIGHT.pos[2] + EYE_RELIEF;
    return {
      aspect: +aspect.toFixed(3),
      glassPct: pct(glass), sightPct: pct((hi - lo) / (2 * tanY)), sightTopPct: pct(hi / (2 * tanY)), sightBottomPct: pct(lo / (2 * tanY)),
      clearDeg: deg(clear), sillDeg: deg(-ty(sill, OPTIC.z)), postDeg: deg(OPTIC.postX / EYE_RELIEF),
      rearOnScreen: shown, rearTopBelowEdgePct: top === -Infinity ? null : pct((-tanY - top) / (2 * tanY)),
      eye: [0, +eyeY.toFixed(4), +eyeZ.toFixed(4)],
      // 画面下沿切到机匣导轨的位置（z），在它后面的机匣顶面都不在画面里
      railCutZ: +(eyeZ - (eyeY - RAIL_Y) / tanY).toFixed(4),
    };
  };

  // 腰射到开镜：按 rifle_anim.js 的混合方式摆位，逐档看枪托一组和拉机柄有没有三角形在画面里
  window.__transit = (aspect = 16 / 9, steps = 20) => {
    const tanX = tanY * aspect, hip = RIFLE_POSES.hip, ads = [-SIGHT.pos[0], -SIGHT.pos[1], -EYE_RELIEF - SIGHT.pos[2], 0, 0, 0];
    const pose = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), out = [];
    for (let i = 0; i <= steps; i++) {
      const a = i / steps, s = a * a * (3 - 2 * a), p = hip.map((h, j) => h + (ads[j] - h) * s);
      pose.compose(new THREE.Vector3(p[0], p[1], p[2]), q.setFromEuler(e.set(p[3], p[4], p[5], 'YXZ')), new THREE.Vector3(1, 1, 1));
      rifle.setAim(a);
      const seen = { ads: a, stock: 0, handle: 0, hidden: !rifle.root.getObjectByName('rifle.stock').visible };
      for (const { mesh, key, minZ } of rearMeshes()) {
        eachTri(mesh, pose, (t0, t1, t2) => { if (onScreen(project([t0, t1, t2]), tanX, tanY)) seen[key]++; }, minZ);
      }
      out.push(seen);
    }
    rifle.setAim(0);
    return out;
  };
}
