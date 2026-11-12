// 步枪的第一人称姿态和活动件：腰射 / 开镜 / 冲刺 / 滑铲 / 探头 / 喷气收枪 / 单手托枪 / 检视，掏枪收枪，
// 换弹时的左手和弹匣，枪机、扳机、快慢机
import * as THREE from 'three';
import { gripTweak } from './hands.js';
import { mixPose, addPose, applyPose, ease, gripTransform, makeGrip, setGrip } from './anim.js';
import { RIFLE_POSE, MAG_POSES, MAG_GONE, MAG_DROP_T, HAND, FINGERS, spline, handSegment, fingerBlend } from './rifle_reload.js';
import { RUN } from './rifle_act_run.js';
import { inspectPose } from './rifle_act_inspect.js';
import { EYE_RELIEF } from './rifle_optics.js';

// holder 相对相机的姿态 [x, y, z, 俯仰, 偏航, 滚转]（YXZ）；hip 以外都是叠在上面的偏移
export const RIFLE_POSES = {
  hip: [0.1, -0.122, -0.2, 0.012, 0.035, -0.05],
  // 冲刺的基础姿态在 rifle_act_run.js（RUN.carry），这里留个别名给旧代码读
  sprint: RUN.carry,
  // 滑铲（乘 player.slide）：枪往下沉、往左歪，只绕枪管轴转，不偏航不俯仰，枪口还指着准心那条线
  slide: [-0.012, -0.028, 0.018, 0, 0, 0.24],
  // 喷气（按 env.state.tuck 混过去，不是叠加：冲刺、开镜中喷气都落到同一个姿态）：枪收到胸前，枪口朝左下压着，
  // 瞄具还留在画面下方；dashLean 再乘 tuck × player.dashS，往喷的那一侧歪
  tuck: [0.09, -0.085, -0.19, -0.42, 0.55, 0.55],
  dashLean: [0.012, 0.004, 0, 0.02, -0.06, -0.22],
  // 左手去扔东西、右手单手托枪：枪口往下沉，往右歪一点
  throwSag: [0.01, -0.03, 0.02, -0.075, -0.025, -0.15],
  // 收到底的位置（画面外）：收枪、掏枪都在它和腰射之间滑
  lowered: [0.04, -0.26, 0.1, -0.85, 0.5, 0.45],
  // 举枪到位时枪口往上带一下再落回（乘 settle 曲线）
  settle: [0, 0.006, 0, 0.03, 0, 0],
  // 探头时镜头侧倾 0.19 × lean，枪绕光轴往回找这么多，开镜时转轴就是光轴，红点不动
  leanRoll: 0.06,
};
// 握把和护木握点的朝向（握持物坐标：+Y 沿握把向上，-Z 朝枪口）。
// 左手绕垂直握把转 -0.6：前臂朝左后方斜出去，不再顺着枪管压在弹匣上
export const RIFLE_TUNE = { gripR: [-0.3, 0, 0], gripL: [0, -0.6, 0] };
// 掏枪、收枪（从举着收到底）、收到底又取消举回来要多久；只收了一半的按比例更短，最短是 HOLSTER_MIN 倍。
// SNAP：喷气途中切过来不播掏枪，枪从略低处（收枪位置的 SNAP_DIP 倍）弹到位
export const DRAW_T = 0.55, HOLSTER_T = 0.26, RAISE_T = 0.3, HOLSTER_MIN = 0.35, SNAP_T = 0.1, SNAP_DIP = 0.3;
// 举枪到位的那一下：收枪程度 h 在 SETTLE_AT 附近时最明显
const SETTLE_AT = 0.07;
const settle = (h) => (h > 0 ? (h / SETTLE_AT) * Math.exp(1 - h / SETTLE_AT) : 0);
const SEMI = 1.2; // 快慢机 AUTO → SEMI 的转角
const BOLT_TRAVEL = 0.07, BOLT_SLAM = 0.05; // 枪机后坐行程；放枪机时冲回去用的秒数
// 握护木时左腕往下压这么多（弧度）：前臂斜着往下出画面，腰射和换弹收尾时断口都离画面下沿远一点
const WRIST_DROP = 0.35;

const _pose = [0, 0, 0, 0, 0, 0], _ins = [0, 0, 0, 0, 0, 0], _rl = [0, 0, 0, 0, 0, 0], _mag = [0, 0, 0, 0, 0, 0];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1), _X = new THREE.Vector3(1, 0, 0), _Q0 = new THREE.Quaternion();
const _seg = { a: 'F', b: 'F', u: 0, via: null }, _fb = { a: 'foregrip', b: 'foregrip', u: 0 };

export class RifleRig {
  constructor(model, armR, armL) {
    const { anchors, parts, root } = model;
    this.model = model;
    this.armR = armR;
    this.armL = armL;
    root.add(armR.root, armL.root);
    armR.setPose('pistolGrip');
    armL.setPose('foregrip');
    anchors.gripR.rotation.set(...RIFLE_TUNE.gripR);
    anchors.gripL.rotation.set(...RIFLE_TUNE.gripL);
    // 左手的几个落点：护木和挂机拨片相对枪，弹匣那个相对弹匣（弹匣动，手跟着动）
    const gR = gripTransform(makeGrip(), armR.root, armR.anchors.palm, anchors.gripR, root, gripTweak('pistolGrip', 'R'));
    this.grips = {
      F: gripTransform(makeGrip(), armL.root, armL.anchors.palm, anchors.gripL, root, gripTweak('foregrip', 'L')),
      M: makeGrip(),
      B: gripTransform(makeGrip(), armL.root, armL.anchors.palm, anchors.boltCatch, root),
      b: makeGrip(),
    };
    this.onMag = gripTransform(makeGrip(), armL.root, armL.anchors.palm, anchors.magHold, parts.mag, gripTweak('pinch', 'L'));
    this.grips.b.p.copy(this.grips.B.p).add(_v.set(-0.03, 0.004, 0.004));
    this.grips.b.q.copy(this.grips.B.q);
    // P：空仓换弹时左手去画面外取新匣的位置，就是弹匣停在 MAG_GONE 时手捏它的地方（和那时的 M 重合，接上不跳）
    _q.setFromEuler(new THREE.Euler(MAG_GONE[3], MAG_GONE[4], MAG_GONE[5], 'YXZ'));
    _w.copy(parts.mag.position).add(_v.fromArray(MAG_GONE));
    this.grips.P = makeGrip();
    this.grips.P.q.copy(_q).multiply(this.onMag.q);
    this.grips.P.p.copy(this.onMag.p).applyQuaternion(_q).add(_w);
    setGrip(armR.root, gR);
    setGrip(armL.root, this.grips.F);
    // 腕关节：前臂组绕手腕转，算出“前臂方向往下压 WRIST_DROP”在手的坐标里是哪个转动
    const fwd = _v.copy(_Z).applyQuaternion(this.grips.F.q);
    const down = _w.set(0, -1, 0).addScaledVector(fwd, fwd.y).normalize();
    fwd.multiplyScalar(Math.cos(WRIST_DROP)).addScaledVector(down, Math.sin(WRIST_DROP));
    fwd.applyQuaternion(_q.copy(this.grips.F.q).invert());
    this.wristF = new THREE.Quaternion().setFromUnitVectors(_Z, fwd.normalize());
    armL.forearm.quaternion.copy(this.wristF);
    this.base = {
      mag: parts.mag.position.clone(), bolt: parts.bolt.position.clone(), handle: parts.chargingHandle.position.clone(),
      triggerX: parts.trigger.rotation.x, selectorX: parts.selector.rotation.x,
    };
    const s = anchors.sight.position;
    this.adsPose = [-s.x, -s.y, -EYE_RELIEF - s.z, 0, 0, 0];
    this.pivot = s.clone();
    this.fade = 0; // 换弹被打断时，残留的换弹姿态在几帧内收掉
    // 最近一次换弹走到哪、是哪种：被打断时手和弹匣停在这一刻，再跟着 fade 收回原位
    this.reloadT = 0;
    this.kind = 'tactical';
    this.poseL = 'foregrip';
    this.poseR = 'pistolGrip';
  }

  // 整枪姿态。r 是 Rifle（读它的状态），player 给滑铲、探头、喷气和步子
  pose(r, player, dt) {
    const a = r.ads * r.ads * (3 - 2 * r.ads), hip = 1 - a;
    mixPose(_pose, RIFLE_POSES.hip, this.adsPose, a);
    // 冲刺姿态随开镜退掉的程度：rifle.js 的 runK 是二阶跟随，从冲刺、滑铲（冲刺姿态还没退完）开镜那一帧枪不猛转
    const kr = r.runK ? Math.min(1, Math.max(0, r.runK.x)) : hip;
    const run = r.run, rw = run ? run.weight * kr : 0;
    if (rw > 0) {
      mixPose(_pose, _pose, RUN.carry, rw);
      run.add(_pose, kr);
    }
    addPose(_pose, RIFLE_POSES.slide, (player.slide || 0) * hip);
    const tuck = r.tuck ? r.tuck.x : 0;
    if (tuck > 1e-4) {
      mixPose(_pose, _pose, RIFLE_POSES.tuck, Math.min(1, tuck));
      addPose(_pose, RIFLE_POSES.dashLean, tuck * (player.dashS || 0));
    }
    const sag = r.offhand ? r.offhand.sag : 0;
    if (sag > 0) addPose(_pose, RIFLE_POSES.throwSag, sag);
    if (r.inspectT >= 0) addPose(_pose, this.inspect(r.inspectT));
    r.carry?.add(_pose);
    // 掏枪收枪：h = 0 举着，1 收到底。取消、再收都只是改 h 的目标，姿态始终连续
    const h = r.down ? r.down.x : 0;
    if (h !== 0) addPose(_pose, RIFLE_POSES.lowered, h);
    const up = r.raiseW ? r.raiseW.x : 0;
    if (up > 1e-3) addPose(_pose, RIFLE_POSES.settle, up * settle(h));
    if (r.reloading) {
      spline(RIFLE_POSE[r.reloadEmpty ? 'empty' : 'tactical'], r.reloadT, _rl);
      this.fade = 1;
    } else {
      this.fade = Math.max(0, this.fade - dt * 6);
    }
    if (this.fade > 0) addPose(_pose, _rl, this.fade * this.fade * (3 - 2 * this.fade));
    const hd = r.holder;
    applyPose(hd, _pose);
    // 绕光轴（过瞄具后窗中心、沿镜头视线）回滚，探头时枪不跟着镜头歪到底
    const roll = RIFLE_POSES.leanRoll * player.lean;
    if (Math.abs(roll) > 1e-5) {
      _v.copy(this.pivot).applyQuaternion(hd.quaternion).add(hd.position);
      _q.setFromAxisAngle(_Z, roll);
      hd.position.sub(_v).applyQuaternion(_q).add(_v);
      hd.quaternion.premultiply(_q);
    }
    if (rw > 0) {
      run.calm(hd, r.env?.vm, player, r.ads, 1);
      run.shoulder(hd, kr);
    }
    // 视图模型在空中、落地时会让枪绕镜头点一下头（viewmodel.js 里竖直速度和落地冲击那两项俯仰）：
    // 反着转回去，枪只往下沉、枪口线不动，跳跃和落地时激光点和准心都稳
    const vm = r.env?.vm;
    if (vm?.lag) {
      const nod = (vm.lag.x[3] * 0.002 - (player.landImpulse || 0) * 0.012) * (1 - 0.86 * r.ads);
      if (Math.abs(nod) > 1e-6) {
        _q.setFromAxisAngle(_X, -nod);
        hd.position.applyQuaternion(_q);
        hd.quaternion.premultiply(_q);
      }
    }
  }

  // 检视姿态（单独拿出来，被打断时 rifle.js 要把这一刻的量交给 Carry）
  inspect(t) { return inspectPose(t, _ins); }

  // 活动件和左手
  parts(r, dt, pulling) {
    const { parts } = this.model, b = this.base;
    // 枪机：开火时一来一回；空仓挂住时停在后面；放枪机时猛地冲回去
    r.boltT = Math.max(0, r.boltT - dt * 16);
    r.boltDrop = Math.max(0, r.boltDrop - dt / BOLT_SLAM);
    const open = r.locked ? 1 : Math.max(Math.sin(Math.min(1, r.boltT) * Math.PI), r.boltDrop * r.boltDrop);
    parts.bolt.position.copy(b.bolt).z += BOLT_TRAVEL * open;
    parts.chargingHandle.position.copy(b.handle);
    parts.trigger.rotation.x = b.triggerX + (pulling ? -0.22 : 0);
    // 快慢机：selT 从 0 到 1，拨杆从另一档转到当前档
    r.selT = Math.min(1, r.selT + dt * 7);
    const to = r.auto ? 0 : SEMI, from = SEMI - to;
    parts.selector.rotation.x = b.selectorX + from + (to - from) * ease.out(r.selT);
    const pr = pulling ? 'trigger' : 'pistolGrip';
    if (pr !== this.poseR) { this.poseR = pr; this.armR.setPose(pr); }

    // 换弹中 w = 1；被打断（收枪）后 w 跟着 fade 落到 0，弹匣和左手从打断那一刻的位置收回去，不瞬移
    if (r.reloading) { this.reloadT = r.reloadT; this.kind = r.reloadEmpty ? 'empty' : 'tactical'; }
    const w = r.reloading ? 1 : ease.smooth(this.fade);
    // 弹匣：换弹时沿表走，其余时间插在井里
    const mag = parts.mag;
    if (w > 0) {
      spline(MAG_POSES[this.kind], this.reloadT, _mag);
      for (let i = 0; i < 6; i++) _mag[i] *= w;
    } else _mag.fill(0);
    // 空仓换弹在旧匣脱落后、新匣入匣前被打断：旧匣已经在地上，井一直空着，直到下一次换弹过了脱落时刻按表把新匣送回来。
    // 这段时间弹匣停在 GONE 并藏起来（冲刺姿态下 GONE 会进画面）；只切网格的 visible，不动材质和灯
    const empty = r.magGone && !(r.reloading && this.kind === 'empty' && this.reloadT >= MAG_DROP_T);
    if (empty) for (let i = 0; i < 6; i++) _mag[i] = MAG_GONE[i];
    if (mag.visible === empty) mag.visible = !empty;
    mag.position.set(b.mag.x + _mag[0], b.mag.y + _mag[1], b.mag.z + _mag[2]);
    mag.rotation.set(_mag[3], _mag[4], _mag[5], 'YXZ');
    this.leftHand(w);
  }

  leftHand(w) {
    const L = this.armL, g = this.grips;
    if (w <= 0) {
      setGrip(L.root, g.F);
      L.forearm.quaternion.copy(this.wristF);
      if (this.poseL !== 'foregrip') { this.poseL = 'foregrip'; L.setPose('foregrip'); }
      return;
    }
    const kind = this.kind, t = this.reloadT;
    // 弹匣上的落点换算到枪坐标
    const mag = this.model.parts.mag;
    g.M.q.copy(mag.quaternion).multiply(this.onMag.q);
    g.M.p.copy(this.onMag.p).applyQuaternion(mag.quaternion).add(mag.position);
    handSegment(HAND[kind], t, _seg);
    const A = g[_seg.a], B = g[_seg.b], u = _seg.u;
    L.root.position.copy(A.p).lerp(_w.copy(B.p), u);
    if (_seg.via && _seg.a !== _seg.b) L.root.position.addScaledVector(_v.fromArray(_seg.via), Math.sin(Math.PI * u));
    L.root.quaternion.copy(A.q).slerp(B.q, u);
    const onF = (_seg.a === 'F' ? 1 - u : 0) + (_seg.b === 'F' ? u : 0);
    L.forearm.quaternion.copy(_Q0).slerp(this.wristF, Math.min(1, onF));
    fingerBlend(FINGERS[kind], t, _fb);
    L.setPose(_fb.a);
    if (_fb.u > 0) L.setPose(_fb.b, _fb.u);
    if (w < 1) {
      L.root.position.lerp(g.F.p, 1 - w);
      L.root.quaternion.slerp(g.F.q, 1 - w);
      L.forearm.quaternion.slerp(this.wristF, 1 - w);
      L.setPose('foregrip', 1 - w);
    }
    this.poseL = '';
  }
}

