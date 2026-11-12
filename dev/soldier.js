// 人形敌人预览。?v=0|1|2 选变体，?night 换成夜间单灯。
// 控制台：__s 是当前的 SoldierRig（改 __s.state 驱动动画），__S 是调试工具：
//   __S.drive = true      让根节点按 state.speed/moveYaw 真的走起来（看脚是否打滑）
//   __S.hits(true)        画命中体线框；__S.lines(true) 画枪口方向（红）和要求的瞄准方向（绿）
//   __S.skate(速度, moveYaw, 秒)  测支撑脚着地点的最大滑移（米）
//   __S.aimError(yaw, pitch)      抵肩瞄准后枪口方向与要求方向的夹角（度）
//   __S.die(kind, flip)           指定死法（back / forward / spin），__S.rest() 报静止后的贴地情况（含 meshLow）
//   __S.meshLow()                 蒙皮网格逐顶点的最低点；__S.gripGap() 两手离握把多远（厘米）
//   __S.bench(帧数)               10 个士兵每帧 update 的总毫秒数
//   __S.lineup()                  三个变体并排
import * as THREE from 'three';
import { startHarness } from './harness.js';
import { SoldierRig, createSoldierShared, SOLDIER_VARIANTS } from '../src/enemies/soldier_rig.js';
import { VOLUMES, LIMB_CHAINS, TORSO_VOLUMES } from '../src/enemies/soldier_hit.js';
import { lowestAll } from '../src/enemies/soldier_death.js';
import { B, GRIP_HOLE } from '../src/enemies/soldier_skeleton.js';
import { GUN } from '../src/enemies/soldier_gun.js';

const query = new URLSearchParams(location.search);

startHarness(async (h) => {
  const { scene, mats, view } = h;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x4a4c4f, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0x3a4048, 0x262a30);
  grid.position.y = 0.002;
  scene.add(grid);
  if (query.has('night')) {
    scene.environmentIntensity = 0.15;
    scene.traverse((o) => { if (o.isDirectionalLight) o.intensity *= 0.08; });
    const spot = new THREE.SpotLight(0xffd2a0, 60, 20, 0.6, 0.5, 2);
    spot.position.set(2, 6, 3);
    spot.castShadow = true;
    scene.add(spot, spot.target);
  } else {
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    scene.add(sun);
  }

  const t0 = performance.now();
  const shared = createSoldierShared(mats);
  const buildMs = performance.now() - t0;
  const rig = new SoldierRig(shared, +(query.get('v') || 0));
  scene.add(rig.root);
  window.__s = rig;

  // 调试线：枪口方向、要求的瞄准方向、命中体线框
  const lineGeo = (color) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 10;
    l.visible = false;
    scene.add(l);
    return l;
  };
  const muzzleLine = lineGeo(0xff3030), aimLine = lineGeo(0x30ff60);
  const hitMat = new THREE.MeshBasicMaterial({ color: 0x40e0ff, wireframe: true, depthTest: false, transparent: true, opacity: 0.6 });
  // 端点都挂在同一根骨上，胶囊长度不变，按绑定长度建一次
  const hitMeshes = VOLUMES.map((v) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(v.r, v.a.distanceTo(v.b), 3, 10), hitMat);
    m.renderOrder = 11;
    m.visible = false;
    scene.add(m);
    return m;
  });
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const extra = [];
  const S = {
    rig, shared, buildMs, drive: false, turn: 0, showHits: false, showLines: false, extra,
    hits(on) { S.showHits = on; hitMeshes.forEach((m) => { m.visible = on; }); },
    lines(on) { S.showLines = on; muzzleLine.visible = aimLine.visible = on; },
    overlay() {
      const r = S.rig;
      if (S.showLines) {
        r.getMuzzle(_a, _d);
        muzzleLine.geometry.attributes.position.setXYZ(0, _a.x, _a.y, _a.z);
        muzzleLine.geometry.attributes.position.setXYZ(1, _a.x + _d.x * 4, _a.y + _d.y * 4, _a.z + _d.z * 4);
        muzzleLine.geometry.attributes.position.needsUpdate = true;
        const yaw = r.root.rotation.y + r.state.aimYaw, p = r.state.aimPitch;
        _d.set(-Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p));
        aimLine.geometry.attributes.position.setXYZ(0, _a.x, _a.y + 0.004, _a.z);
        aimLine.geometry.attributes.position.setXYZ(1, _a.x + _d.x * 4, _a.y + 0.004 + _d.y * 4, _a.z + _d.z * 4);
        aimLine.geometry.attributes.position.needsUpdate = true;
      }
      if (S.showHits) {
        const W = r.hits.world;
        hitMeshes.forEach((m, i) => {
          _a.fromArray(W, i * 6); _b.fromArray(W, i * 6 + 3);
          m.position.copy(_a).add(_b).multiplyScalar(0.5);
          if (_a.distanceTo(_b) > 1e-4) m.quaternion.setFromUnitVectors(UP, _d.subVectors(_b, _a).normalize());
          m.visible = !r.dead;
        });
      }
    },
    tick(dt) {
      for (const r of [S.rig, ...extra]) {
        // 和游戏里一样按 state.speed（不平滑）挪根节点：rig 按根节点的真实位移踩地
        if (S.drive && !r.dead) {
          const yaw = r.root.rotation.y + r.state.moveYaw;
          r.root.position.x += -Math.sin(yaw) * r.state.speed * dt;
          r.root.position.z += -Math.cos(yaw) * r.state.speed * dt;
        }
        r.root.rotation.y += S.turn * dt;
        r.update(dt);
      }
      S.overlay();
    },
    // 支撑期着地点的最大滑移：脚掌平放时量前掌和后跟，抬脚跟时只量前掌
    skate(speed = 1.4, moveYaw = 0, seconds = 3, dt = 1 / 60) {
      const r = S.rig;
      Object.assign(r.state, { speed, moveYaw });
      S.drive = true;
      for (let i = 0; i < 90; i++) S.tick(dt);
      const worst = { R: 0, L: 0 }, start = {}, pos = new THREE.Vector3();
      for (let t = 0; t < seconds; t += dt) {
        S.tick(dt);
        for (const f of r.gait.feet) {
          const key = f.side, planted = f.lift < 1e-4 && f.stanceU >= 0 && f.stanceU < 0.98;
          if (!planted) { start[key] = null; continue; }
          r.root.updateMatrixWorld(true);
          pos.setFromMatrixPosition(r.bones[B['toe' + key]].matrixWorld);
          if (!start[key]) { start[key] = pos.clone(); continue; }
          worst[key] = Math.max(worst[key], Math.hypot(pos.x - start[key].x, pos.z - start[key].z));
        }
      }
      S.drive = false;
      return { speed, moveYaw, slideR: +worst.R.toFixed(4), slideL: +worst.L.toFixed(4) };
    },
    aimError(yaw = 0, pitch = 0) {
      const r = S.rig;
      Object.assign(r.state, { speed: 0, aim: 1, aimYaw: yaw, aimPitch: pitch });
      for (let i = 0; i < 90; i++) S.tick(1 / 60);
      r.getMuzzle(_a, _d);
      const wy = r.root.rotation.y + Math.max(-0.9, Math.min(0.9, yaw)), p = Math.max(-0.9, Math.min(0.9, pitch));
      _b.set(-Math.sin(wy) * Math.cos(p), Math.sin(p), -Math.cos(wy) * Math.cos(p));
      return +THREE.MathUtils.radToDeg(_d.angleTo(_b)).toFixed(3);
    },
    die(kind = 'back', flip = false) {
      const r = S.rig;
      r.dead = true; r.deathDone = false; r.deathKind = kind;
      r.bones[B.led].scale.setScalar(0);
      r.death.start(r.pose, kind, flip, new THREE.Vector3());
      return kind;
    },
    // 静止后：全身最低点、躯干最低点、各肢体最低点（都应接近 0），枪管轴线高度
    rest() {
      const r = S.rig, pose = r.pose, out = { done: r.deathDone, all: +lowestAll(pose, r.death.pack).toFixed(3) };
      const low = (list) => {
        let m = Infinity;
        for (const i of list) { const v = VOLUMES[i]; m = Math.min(m, pose.point(v.bone, v.a, _a).y - v.r, pose.point(v.bone, v.b, _a).y - v.r); }
        return +m.toFixed(3);
      };
      out.torso = low(TORSO_VOLUMES);
      for (const [k, c] of Object.entries(LIMB_CHAINS)) out[k] = low(c.slice(1));
      out.gunY = +pose.weaponPos.y.toFixed(3);
      out.maxLift = +r.death.lift.toFixed(3);
      out.mesh = S.meshLow();
      return out;
    },
    // 蒙皮后真实网格的最低点（CPU 逐顶点算，慢，只在验收时用）：soft、hard 各自的最低高度和低于 -5 mm 的顶点数
    meshLow(r = S.rig) {
      r.root.updateMatrixWorld(true);
      r.skeleton.update();
      const out = {};
      for (const m of r.mesh.meshes) {
        // 两个网格共用一套顶点缓冲，按各自的索引取
        const idx = m.geometry.index.array, seen = new Uint8Array(m.geometry.attributes.position.count);
        let min = Infinity, below = 0;
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          if (seen[i]) continue;
          seen[i] = 1;
          const y = m.getVertexPosition(i, _a).applyMatrix4(m.matrixWorld).y;
          min = Math.min(min, y);
          if (y < -0.005) below++;
        }
        out[m.name.replace('soldier-', '')] = { min: +min.toFixed(3), below };
      }
      return out;
    },
    // 当前肢体姿势下左右手握持点与枪上握把的距离（厘米）
    gripGap() {
      const r = S.rig, p = r.pose, out = {};
      for (const [s, hole, grip] of [['R', [GRIP_HOLE[0], GRIP_HOLE[1], GRIP_HOLE[2]], GUN.gripR], ['L', [-GRIP_HOLE[0], GRIP_HOLE[1], GRIP_HOLE[2]], GUN.gripL]]) {
        p.point(B['hand' + s], _b.fromArray(hole), _a);
        _d.fromArray(grip).applyQuaternion(p.Q[B.weapon]).add(p.weaponPos);
        out[s] = +(_a.distanceTo(_d) * 100).toFixed(2);
      }
      return out;
    },
    revive() { S.rig.reset(); return true; },
    bench(frames = 120) {
      const rigs = Array.from({ length: 10 }, (_, i) => new SoldierRig(shared, i));
      rigs.forEach((r, i) => Object.assign(r.state, { speed: [0, 1.4, 4.5, 2][i % 4], moveYaw: i * 0.6, aim: i % 2, aimYaw: 0.3, crouch: i === 3 ? 1 : 0 }));
      for (let f = 0; f < 30; f++) for (const r of rigs) r.update(1 / 60);
      const t = performance.now();
      for (let f = 0; f < frames; f++) for (const r of rigs) r.update(1 / 60);
      return +((performance.now() - t) / frames).toFixed(4);
    },
    lineup() {
      for (let i = 1; i < SOLDIER_VARIANTS; i++) {
        const r = new SoldierRig(shared, i);
        r.root.position.x = i * 0.9;
        scene.add(r.root);
        extra.push(r);
      }
      return extra.length;
    },
    info: () => ({ ...rig.info, variants: shared.asset.variants.map((v) => v.tris), buildMs: +buildMs.toFixed(1) }),
  };
  window.__S = S;
  h.onFrame = (dt) => S.tick(dt);
  view(20, 8, 3.4, 0, 0.95, 0);
});
