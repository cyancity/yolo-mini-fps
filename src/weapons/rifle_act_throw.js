// 左手扔烟雾弹：左手松开护木、从左下出画面，拿着罐子从左边抬上来，在左肩旁蓄力，过肩往准心方向甩出去，
// 跟一下再回到护木上。这段时间右手单手托着枪。左手的轨迹写在相机坐标里，每帧换算到枪坐标，
// 所以枪怎么晃（下沉、收枪）都不影响出手点
import * as THREE from 'three';
import { makeCanister } from '../game/smoke_model.js';
import { asViewModel } from '../gfx/materials.js';
import { spline } from './rifle_reload.js';
import { smooth, clamp01 } from './rifle_act_motion.js';

// release：罐子离手（游戏在这一刻把真的烟雾弹放出去）；total：左手回到护木；canOn：罐子出现在手里（这时手在画面外）
export const THROW = { release: 0.25, total: 0.65, canOn: 0.09, blendIn: 0.07, blendOut: 0.24 };
// 游戏放出烟雾弹的位置（相机坐标，米）：左 0.22、下 0.15、前 0.35。见 smoke.js 的 throw()
export const RELEASE_AT = [-0.22, -0.15, -0.35];
const VM_FOV = 55;

// 轨迹：[t, 罐子中心（相机坐标）, 张力, 手的朝向 [俯仰, 偏航, 滚转]（YXZ）, 手腕弯]。张力的意思同 rifle_reload.js 的 spline。
// 手的朝向以“四指朝前、掌心朝下、拇指朝右”为零：滚转 1.5 左右是拇指朝上、掌心朝右，罐子竖着握。
// 前臂（伸向肘）的方向 = 手的朝向再往下弯“手腕弯”这么多：俯仰 + 手腕弯为正，前臂就朝后下方出画面，
// 偏航为负，肘在左边。出手那一帧的位置运行时按当前视角填
export const THROW_KEYS = [
  [0.06, [-0.02, -0.36, -0.42], 1, [0, -0.6, 1.2], 0.3],
  [0.11, [-0.2, -0.37, -0.36], 1, [0.2, -0.3, 1.5], 0.35],
  [0.165, [-0.25, -0.17, -0.45], 1, [0.45, -0.31, 1.55], 0.4],
  [0.215, [-0.3, -0.02, -0.28], 0.6, [0.75, -0.49, 1.45], 0.3],
  [THROW.release, [0, 0, 0], 1, [0.25, -0.31, 1.45], 0.47],
  [0.31, [-0.08, -0.3, -0.5], 1, [-0.2, -0.51, 1.0], 0.8],
  [0.4, [-0.05, -0.36, -0.42], 1, [0, -0.58, 0.9], 0.45],
];
const REL = THROW_KEYS.findIndex((k) => k[0] === THROW.release);
// 罐子在掌心锚点坐标里的位置：罐轴顺着握把轴（小指 → 食指），离掌面一个半径多一点
const SEAT = [0, 0.008, -0.038];
// 手指：[t, 姿势, 比例]，手指 = 从 relaxed 朝这个姿势走这个比例；两帧之间线性过渡。
// 罐子比垂直握把粗，握罐子时只合拢到 foregrip 的一半
const GRIP = [
  [0, 'foregrip', 1], [0.05, 'foregrip', 0], [0.09, 'foregrip', 0], [0.13, 'foregrip', 0.45], [0.245, 'foregrip', 0.45],
  [0.29, 'flat', 0.6], [0.45, 'flat', 0], [0.58, 'foregrip', 1],
];

const _pos = [0, 0, 0];
const _rc = new THREE.Matrix4(), _ri = new THREE.Matrix4(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _gp = new THREE.Vector3(), _gq = new THREE.Quaternion(), _tq = new THREE.Quaternion();
const _wq = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1), _X = new THREE.Vector3(1, 0, 0);

export class OffhandThrow {
  constructor(env, rig) {
    this.env = env;
    this.rig = rig;
    this.t = -1;
    // 罐子：几何体和烟雾弹共用，材质换成第一人称投影的（和手套防滑面同一套着色器，不多编译）
    const L = rig.armL;
    this.seat = new THREE.Group();
    this.seat.position.fromArray(SEAT);
    L.anchors.palm.add(this.seat);
    this.can = new THREE.Group();
    this.can.name = 'rifle.offhandCan';
    const src = makeCanister(env.mats), nm = env.mats.tex?.polymer?.normalMap || null;
    const vm = (m) => (env.pipeline?.vmProjection ? asViewModel(m, env.pipeline.vmProjection) : m);
    const mats = [
      vm(new THREE.MeshStandardMaterial({ color: 0x3e4632, roughness: 0.62, normalMap: nm })),
      vm(new THREE.MeshStandardMaterial({ color: 0xc4ad55, roughness: 0.62, normalMap: nm })),
      env.gear.steel,
    ];
    src.children.forEach((c, i) => {
      const mesh = new THREE.Mesh(c.geometry, mats[i] || env.gear.steel);
      mesh.receiveShadow = true;
      this.can.add(mesh);
    });
    // 握片朝外（掌心那一面是罐身）
    this.can.rotation.y = Math.PI;
    this.can.visible = false;
    this.seat.add(this.can);
    // 罐子中心在左手 root 坐标里的位置：轨迹写的是罐子中心，换算成手的位置要减掉它
    L.root.updateWorldMatrix(true, true);
    _m.copy(L.root.matrixWorld).invert().multiply(this.seat.matrixWorld);
    this.center = new THREE.Vector3().setFromMatrixPosition(_m);
    this.relAt = new THREE.Vector3();
  }

  get active() { return this.t >= 0; }

  start() { this.t = 0; }

  stop() {
    this.t = -1;
    this.can.visible = false;
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= THROW.total) this.stop();
  }

  // 右手单手托枪的程度：左手一离开就沉下去，左手回来前缓过来
  get sag() {
    const t = this.t;
    return t < 0 ? 0 : smooth(t / 0.12) * (1 - smooth((t - 0.42) / 0.2));
  }

  // 左手离开护木的程度（0 = 握着）
  get off() {
    const t = this.t;
    return t < 0 ? 0 : Math.min(smooth(t / THROW.blendIn), smooth((THROW.total - t) / THROW.blendOut));
  }

  // 出手点（相机坐标）：真烟雾弹在世界里放在 RELEASE_AT，视图模型的 FOV 比世界窄，
  // 沿视线往远处推 s 倍，屏幕上的位置和罐子的大小都和真的对上
  releasePoint(camera, out) {
    const vmFov = this.env.pipeline?.vmFov || VM_FOV;
    const s = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(vmFov * 0.5));
    return out.set(RELEASE_AT[0], RELEASE_AT[1], RELEASE_AT[2] * s);
  }

  // 相机和骨架都更新完之后调用：rig.parts 已经把左手摆在护木（或换弹淡出的位置）上，这里从那儿接过来
  late(camera) {
    const t = this.t, L = this.rig.armL;
    if (t < 0) return;
    this.can.visible = t >= THROW.canOn && t < THROW.release;
    const root = this.rig.model.root;
    root.updateWorldMatrix(true, false);
    _rc.multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
    _ri.copy(_rc).invert();
    // 握着护木时手在相机坐标里的位置
    _m.compose(L.root.position, L.root.quaternion, _one).premultiply(_rc);
    _m.decompose(_gp, _gq, _s);
    _wq.copy(L.forearm.quaternion);
    // 轨迹上的罐子中心和手的朝向
    this.releasePoint(camera, this.relAt);
    const rel = THROW_KEYS[REL][1];
    rel[0] = this.relAt.x; rel[1] = this.relAt.y; rel[2] = this.relAt.z;
    spline(THROW_KEYS, t, _pos);
    const bend = this.rotAt(t, _tq);
    _p.fromArray(_pos).sub(_s.copy(this.center).applyQuaternion(_tq));
    // 从护木过渡到轨迹、再从轨迹回到护木
    const w = this.off;
    _p.lerpVectors(_gp, _p, w);
    _q.slerpQuaternions(_gq, _tq, w);
    _m.compose(_p, _q, _one).premultiply(_ri);
    _m.decompose(L.root.position, L.root.quaternion, _s);
    // 手腕：握护木时的弯法过渡到轨迹上的弯法
    L.forearm.quaternion.copy(_wq).slerp(_tq.setFromAxisAngle(_X, bend), w);
    this.fingers(t);
    this.rig.poseL = ''; // 扔完由 rig 重新摆回握护木的手指
  }

  // 手的朝向：在相邻两帧之间按两头慢的曲线转过去。返回这一刻的手腕弯
  rotAt(t, out) {
    const K = THROW_KEYS;
    let i = 0;
    while (i < K.length - 1 && t >= K[i + 1][0]) i++;
    const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
    const u = b === a || t <= a[0] ? 0 : smooth((t - a[0]) / (b[0] - a[0]));
    out.setFromEuler(_e.set(a[3][0], a[3][1], a[3][2], 'YXZ'));
    if (u > 0) out.slerp(_q.setFromEuler(_e.set(b[3][0], b[3][1], b[3][2], 'YXZ')), u);
    return a[4] + (b[4] - a[4]) * u;
  }

  fingers(t) {
    const L = this.rig.armL;
    let i = 0;
    while (i < GRIP.length - 1 && t >= GRIP[i + 1][0]) i++;
    const a = GRIP[i], b = GRIP[Math.min(i + 1, GRIP.length - 1)];
    const u = b === a ? 0 : clamp01((t - a[0]) / (b[0] - a[0]));
    // 目标 = relaxed + (A − relaxed)·ma·(1 − u) + (B − relaxed)·mb·u。setPose(name, k) 是从当前朝 name 走 k，
    // 依次摆 relaxed、走 A 的 x、走 B 的 y，取 y = mb·u、x = ma·(1 − u)/(1 − y) 正好是这个
    const y = b[2] * u, x = y < 1 ? (a[2] * (1 - u)) / (1 - y) : 0;
    L.setPose('relaxed');
    if (x > 0) L.setPose(a[1], Math.min(1, x));
    if (y > 0) L.setPose(b[1], y);
  }
}
