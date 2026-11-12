import * as THREE from 'three';
import { SkinGeo } from './hands_skin.js';
import { buildGlove, palmBottomY } from './hands_glove.js';
import { buildForearm } from './hands_sleeve.js';
import { FINGERS, PALM_AT, POSES, HOLDS } from './hands_poses.js';

export { HOLDS };

const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

// 第一人称手臂：蒙皮战术手套 + 迷彩袖。
// 右手中立位：腕在原点，四指朝 −Z，掌心朝 −Y，拇指在 −X；左手是沿 X 的镜像，接口相同。
export function buildArm(gear, side = 'R') {
  const left = side === 'L', sx = left ? -1 : 1;
  const root = new THREE.Group(), hand = new THREE.Group(), forearm = new THREE.Group();
  root.name = `arm${side}`;
  root.add(forearm, hand);

  // 骨架：hand 自己当 0 号骨，每根手指三节。镜像靠坐标和转角反号，层级里不出现负缩放，
  // 这样锚点的世界矩阵始终是正常的右手系
  const bones = [hand], chains = [], rest = [];
  for (const F of FINGERS) {
    const chain = [0, F.len[0], F.len[1]].map((len, k) => {
      const b = new THREE.Bone();
      if (k) b.position.set(0, 0, -len); else b.position.set(F.mcp[0] * sx, F.mcp[1], F.mcp[2]);
      return b;
    });
    const q = new THREE.Quaternion().setFromEuler(_e.set(F.rest[0], F.rest[1] * sx, F.rest[2] * sx, 'YXZ'));
    chain[0].quaternion.copy(q);
    hand.add(chain[0]);
    chain[0].add(chain[1]);
    chain[1].add(chain[2]);
    bones.push(...chain);
    chains.push(chain);
    rest.push(q);
  }

  const sg = new SkinGeo();
  buildGlove(sg);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mats = { glove: gear.glove, grip: gear.gloveGrip, polymer: gear.polymer };
  for (const [key, geo] of sg.build(left)) {
    const mesh = new THREE.SkinnedMesh(geo, mats[key]);
    // 包围球按绑定姿势算，握拳后不准
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    hand.add(mesh);
    mesh.bind(skeleton);
  }
  buildForearm(gear, side, forearm);

  // 掌心锚点：+Y 小指 → 食指（握把轴），−Z 掌心法线（朝握着的东西）
  const palm = new THREE.Object3D(), indexTip = new THREE.Object3D();
  palm.position.set(PALM_AT[0] * sx, palmBottomY(PALM_AT[0], PALM_AT[1]), PALM_AT[1]);
  palm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -sx), new THREE.Vector3(-sx, 0, 0), new THREE.Vector3(0, 1, 0)));
  hand.add(palm);
  // 食指指肚中心，跟着远节走：−Z 朝指尖，−Y 是指肚朝外的法线
  const I = FINGERS[1];
  indexTip.position.set(0, -I.rad[3] * 0.95, -(I.len[2] - 0.009));
  chains[1][2].add(indexTip);

  const cur = FINGERS.map(() => [0, 0, 0, 0, 0]);
  const apply = (f) => {
    const c = cur[f], ch = chains[f];
    ch[0].quaternion.copy(rest[f]).multiply(_q.setFromEuler(_e.set(-c[0], c[3] * sx, c[4] * sx, 'YXZ')));
    ch[1].rotation.x = -c[1];
    ch[2].rotation.x = -c[2];
  };
  // 预览页的自动合拢要读骨骼
  root.userData.rig = { chains, cur };

  return {
    root, hand, forearm,
    anchors: { palm, indexTip },
    poses: Object.keys(POSES),
    // t = 1 直接摆到位；t < 1 从当前姿势朝目标走 t 的比例（每帧调用就是指数趋近）
    setPose(name, t = 1) {
      const p = POSES[name];
      if (!p) return;
      for (let f = 0; f < 5; f++) {
        for (let k = 0; k < 5; k++) cur[f][k] = t >= 1 ? p[f][k] : cur[f][k] + (p[f][k] - cur[f][k]) * t;
        apply(f);
      }
    },
    // finger：0 拇指 … 4 小指；curls = [掌指, 近节, 远节]，朝掌心卷为正；
    // spread 为正朝拇指一侧摆（拇指是离开掌面）；twist 绕指轴自转，一般只有拇指用
    setCurl(finger, curls, spread = cur[finger][3], twist = cur[finger][4]) {
      const c = cur[finger];
      c[0] = curls[0]; c[1] = curls[1]; c[2] = curls[2]; c[3] = spread; c[4] = twist;
      apply(finger);
    },
  };
}

// 手里拿着的东西（刀）：把 obj 挂到 anchors.palm 下面再调这个，obj 的局部坐标就是握持物坐标
export function applyHold(obj, pose, side = 'R') {
  const h = HOLDS[pose], sx = side === 'L' ? -1 : 1;
  obj.position.set(h.p[0] * sx, h.p[1], h.p[2]);
  obj.rotation.set(h.r[0], h.r[1] * sx, h.r[2] * sx, 'YXZ');
  return obj;
}

// 手去握固定在别处的东西（枪）：握持物锚点 → 掌心锚点的变换，可直接当 anim.js 里 gripTransform 的 tweak
export function gripTweak(pose, side = 'R', out = new THREE.Matrix4()) {
  const h = HOLDS[pose], sx = side === 'L' ? -1 : 1;
  if (!h) return out.identity();
  _q.setFromEuler(_e.set(h.r[0], h.r[1] * sx, h.r[2] * sx, 'YXZ'));
  return out.compose(_p.set(h.p[0] * sx, h.p[1], h.p[2]), _q, _s).invert();
}
