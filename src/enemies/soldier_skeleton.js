import * as THREE from 'three';

// 人形敌人的骨架。绑定姿势：直立、双臂垂在体侧。
// 所有骨头在绑定姿势下的轴都与模型轴平行（面朝 -Z，+X 是角色自己的右手边，原点在两脚之间的地面），
// 所以逆绑定矩阵只是一个平移，四肢的 IK 也可以假定“肢体沿 -Y、正面朝 -Z”。
// 以后换成导入的蒙皮模型时，只要把它的骨头按这里的名字对上，动画、命中体和接口都不用动。
export const LEN = { upperArm: 0.3, foreArm: 0.262, thigh: 0.44, shin: 0.395 };
export const SHOULDER = [0.192, 1.44, 0], HIP = [0.095, 0.94, 0];
export const ANKLE_H = 0.105; // 踝关节离鞋底的高度
// 脚掌：踝在原点，后跟、前掌（脚趾骨的转轴）、鞋尖的 z
export const FOOT = { heel: 0.072, ball: -0.135, tip: -0.212, ballY: 0.03 };
// 手骨（腕）本地坐标里，握拳时握持物的中心（右手；左手 x 取反）。握把、前握把就插在这里
export const GRIP_HOLE = [-0.032, -0.075, 0];
// 枪骨的绑定位置：枪的坐标原点（枪管轴线上、机匣后端）在绑定姿势下的模型坐标。只影响建模，动画里枪骨的姿态是算出来的
export const WEAPON_BIND = [0.085, 1.505, -0.31];

export const BONES = [];
export const B = {};
function def(name, parent, x, y, z) {
  B[name] = BONES.length;
  BONES.push({ name, parent: parent == null ? -1 : B[parent], pos: [x, y, z] });
}

def('pelvis', null, 0, 0.98, 0);
def('spine1', 'pelvis', 0, 1.09, 0.004);
def('spine2', 'spine1', 0, 1.27, 0.006);
def('neck', 'spine2', 0, 1.5, 0.012);
def('head', 'neck', 0, 1.6, 0);
// 头盔上的信号灯单独一根骨：阵亡时把它缩成 0，灯就灭了（材质是共享的，不能按个体改亮度）
def('led', 'head', 0, 1.79, 0.07);
for (const [s, sx] of [['L', -1], ['R', 1]]) {
  const sh = SHOULDER[0] * sx, hip = HIP[0] * sx;
  const elbowY = SHOULDER[1] - LEN.upperArm, wristY = elbowY - LEN.foreArm;
  const kneeY = HIP[1] - LEN.thigh;
  def('clav' + s, 'spine2', 0.03 * sx, 1.455, -0.012);
  def('upperArm' + s, 'clav' + s, sh, SHOULDER[1], 0);
  // 肘、膝各有一根辅助骨，只转关节弯曲角的一半：关节处的布料和护膝挂在它上面，弯到很深也不会塌
  def('elbow' + s, 'upperArm' + s, sh, elbowY, 0);
  def('foreArm' + s, 'upperArm' + s, sh, elbowY, 0);
  def('hand' + s, 'foreArm' + s, sh, wristY, 0);
  def('thigh' + s, 'pelvis', hip, HIP[1], 0);
  def('knee' + s, 'thigh' + s, hip, kneeY, 0);
  def('shin' + s, 'thigh' + s, hip, kneeY, 0);
  def('foot' + s, 'shin' + s, hip, ANKLE_H, 0);
  def('toe' + s, 'foot' + s, hip, FOOT.ballY, FOOT.ball);
}
// 枪直接挂在根节点下：瞄准时它的朝向是算出来的绝对方向，双手再用 IK 去够握把
def('weapon', null, ...WEAPON_BIND);

export const BONE_COUNT = BONES.length;
export const PARENT = BONES.map((b) => b.parent);

// 每根骨相对父骨的绑定偏移（模型轴向）
export const OFFSET = BONES.map((b) => {
  const p = b.parent < 0 ? [0, 0, 0] : BONES[b.parent].pos;
  return new THREE.Vector3(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
});

let inverses = null;
// 逆绑定矩阵，所有士兵共用
export function bindInverses() {
  inverses ??= BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.pos[0], -b.pos[1], -b.pos[2]));
  return inverses;
}

// 新建一套骨头。返回数组，顺序与 BONES 一致；没有父骨的（pelvis、weapon）由调用方挂到根节点下
export function createBones() {
  const bones = BONES.map((b, i) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.copy(OFFSET[i]);
    return bone;
  });
  BONES.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  return bones;
}

// 绑定坐标 → 某根骨的本地坐标（命中体、接触球、锚点都按绑定姿势下的模型坐标来写）
export function toBone(bone, x, y, z, out = new THREE.Vector3()) {
  const p = BONES[bone].pos;
  return out.set(x - p[0], y - p[1], z - p[2]);
}
