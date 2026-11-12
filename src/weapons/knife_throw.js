// 持刀时左手扔烟雾弹。刀这一套平时只有右手，左手只在扔的这一下从画面左下进来，扔完从下面出去。
// 抬手、蓄力、出手的轨迹和握罐子的手指直接用步枪那一套（rifle_act_throw.js），
// 这里只给它一只平时停在画面外的左手：步枪的左手从护木出发，这只手从 REST 出发，也回到 REST
import * as THREE from 'three';
import { buildArm } from './hands.js';
import { OffhandThrow, THROW, THROW_KEYS } from './rifle_act_throw.js';

export { THROW };

// 左手停着的地方：轨迹最后一帧再往下 4 厘米（相机坐标里罐子中心的位置、手的朝向、手腕弯），整只手在画面底边以下
const LAST = THROW_KEYS[THROW_KEYS.length - 1];
const REST_DROP = 0.04;

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _X = new THREE.Vector3(1, 0, 0);

export class KnifeToss {
  // holder：刀的 holder，左手挂在它下面（和刀一起进视图模型的图层），每帧按相机坐标重新摆，不跟着刀挥
  constructor(env, holder) {
    this.holder = holder;
    this.arm = buildArm(env.gear, 'L');
    this.arm.root.visible = false;
    holder.add(this.arm.root);
    this.act = new OffhandThrow(env, { armL: this.arm, model: { root: holder }, poseL: '' });
    this.restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(LAST[3][0], LAST[3][1], LAST[3][2], 'YXZ'));
    this.restP = new THREE.Vector3(LAST[1][0], LAST[1][1] - REST_DROP, LAST[1][2])
      .sub(this.act.center.clone().applyQuaternion(this.restQ));
    this.restWrist = new THREE.Quaternion().setFromAxisAngle(_X, LAST[4]);
  }

  get active() { return this.act.active; }

  // 扔的时候身子跟着拧一下的程度（0..1），给持刀的右手用
  get sag() { return this.act.sag; }

  start() { this.act.start(); }

  stop() {
    this.act.stop();
    this.arm.root.visible = false;
  }

  update(dt) {
    this.act.update(dt);
    if (!this.act.active) this.arm.root.visible = false;
  }

  // 相机和刀的姿态都更新完之后调用
  late(camera) {
    const L = this.arm;
    L.root.visible = this.act.active;
    if (!this.act.active) return;
    // 先把手摆回 REST（换算到 holder 坐标），OffhandThrow 从这里过渡到轨迹、扔完再过渡回来
    this.holder.updateWorldMatrix(true, false);
    _m.multiplyMatrices(camera.matrixWorldInverse, this.holder.matrixWorld).invert();
    _m.multiply(_mRest.compose(this.restP, this.restQ, _one));
    _m.decompose(L.root.position, L.root.quaternion, _s);
    L.forearm.quaternion.copy(this.restWrist);
    this.act.late(camera);
  }
}

const _mRest = new THREE.Matrix4();
