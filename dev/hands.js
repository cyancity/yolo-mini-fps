// 手臂预览：左右手并排，握着的东西按 HOLDS 挂在掌心锚点上（有真的步枪、爪刀模型就用真的，没有就用替身）。
// 键盘 1~8 换姿势，Q/W/E/R 换视角，P 开关替身，A 开关锚点坐标轴。
// 控制台：__hands.pose('knife')、__hands.look('back', 'R', 0.4)、__hands.stats()；
// 调姿势用 __hands.fit（见文件后半）。
import { startHarness } from './harness.js';
import { buildArm, applyHold, HOLDS } from '../src/weapons/hands.js';
import { FINGERS } from '../src/weapons/hands_poses.js';
import { palmBottomY } from '../src/weapons/hands_glove.js';
import { rbox, box } from '../src/gfx/geo.js';

// 步枪上两个握点在枪的坐标里的位置（rifle.js 的 anchors.gripR / gripL），右手握点还绕 X 仰了 RAKE，顺着握把的后倾。
// HOLDS 里 pistolGrip、trigger、foregrip 的握持物坐标就是这两个握点的坐标
const GRIP_R = [0, -0.047, 0.0315], RAKE = -0.3, GRIP_L = [0, -0.062, -0.36];
const C = Math.cos(RAKE), S = Math.sin(RAKE);
// 枪的坐标 → 右手握点坐标；w = 0 换算方向
const onGrip = (v, w = 1) => { const y = v[1] - GRIP_R[1] * w, z = v[2] - GRIP_R[2] * w; return [v[0], y * C + z * S, -y * S + z * C]; };
// 握点附近的枪身，尺寸抄自 rifle_*.js，每块 [中心, 半尺寸, 圆角]。替身和距离场共用这份数据
const GRIP = [[0, -0.036, -0.0179], [0.0133, 0.056, 0.0188], 0.0095]; // 握把：握点坐标里它是直的
const GUN = [
  [[0, -0.0293, -0.025], [0.01175, 0.0113, 0.0405], 0.001], // 下机匣
  [[0, -0.039, 0.011], [0.01175, 0.009, 0.018], 0.001], // 握把接口
  [[0, -0.005, -0.095], [0.0128, 0.013, 0.095], 0.001], // 上机匣
  [[0, -0.064, -0.1], [0.0145, 0.023, 0.037], 0.002], // 弹匣井
  [[0, -0.0405, 0.03], [0.009, 0.0065, 0.008], 0.003], // 虎口护翼
];
const TRIGGER = [0, 1].map((k) => [[0, -0.052, -0.044 + k * 0.004], [0.0034, 0.0115, 0.0025], 0.001]); // 松开、扣到底
const GUARD = [[-0.006, -0.05], [-0.0105, -0.064], [-0.02, -0.0705], [-0.034, -0.0715], [-0.05, -0.0685], [-0.06, -0.06], [-0.064, -0.046]]; // 护圈中线 [z, y]
const FORE = [
  [[0, -0.0612, -0.36], [0.0128, 0.0328, 0.0152], 0.0105], // 垂直握把
  [[0, -0.0265, -0.36], [0.0105, 0.00325, 0.026], 0.001], // 夹座
  [[0, -0.001, -0.36], [0.021, 0.0225, 0.12], 0.012], // 护木
];

const solid = (THREE, mat, [c, h, r]) => {
  const m = new THREE.Mesh(rbox(h[0] * 2, h[1] * 2, h[2] * 2, r, 3), mat);
  m.position.set(...c);
  return m;
};
// 挂在握点坐标下面的一个组，往里面放东西用枪的坐标
const gunAt = (THREE, grip, rake = 0) => {
  const g = new THREE.Group();
  g.rotation.x = -rake;
  g.position.set(-grip[0], -grip[1], -grip[2]).applyEuler(g.rotation);
  return g;
};
// 替身都画在握持物自己的坐标里：+Y 沿握把向上，−Z 朝前
const PROPS = {
  pistolGrip(g, THREE, mat, pull = 0) {
    const gun = gunAt(THREE, GRIP_R, RAKE);
    g.add(solid(THREE, mat, GRIP), gun);
    for (const b of [...GUN, TRIGGER[pull]]) gun.add(solid(THREE, mat, b));
    for (let i = 0; i + 1 < GUARD.length; i++) {
      const [az, ay] = GUARD[i], [bz, by] = GUARD[i + 1], m = new THREE.Mesh(box(0.012, 0.0036, Math.hypot(bz - az, by - ay)), mat);
      m.position.set(0, (ay + by) / 2, (az + bz) / 2);
      m.rotation.x = Math.atan2(ay - by, bz - az);
      gun.add(m);
    }
  },
  trigger(g, THREE, mat) { PROPS.pistolGrip(g, THREE, mat, 1); },
  foregrip(g, THREE, mat) {
    const gun = gunAt(THREE, GRIP_L);
    g.add(gun);
    for (const b of FORE) gun.add(solid(THREE, mat, b));
  },
  // 尺寸和坐标照 knife_model.js：原点在握柄中心，X 是厚度，指环在 +Y 端，刀身朝 −Z 弯
  knife(g, THREE, mat) {
    const handle = new THREE.Mesh(rbox(0.0158, 0.074, 0.0302, 0.005, 4), mat);
    handle.position.set(0, -0.003, -0.0006);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.003, 10, 32), mat);
    ring.rotation.y = Math.PI / 2;
    ring.scale.z = 0.63;
    ring.position.set(0, 0.0525, -0.0063);
    g.add(handle, ring);
  },
  pinch(g, THREE, mat) {
    g.add(new THREE.Mesh(rbox(0.025, 0.13, 0.065, 0.003), mat));
  },
};

// 和替身同尺寸的距离场（握持物坐标），拟合姿势时当碰撞体
const box2 = (x, z, hx, hz, r) => {
  const qx = Math.abs(x) - hx + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
};
const box3 = (p, c, h, r) => {
  const qx = Math.abs(p.x - c[0]) - h[0] + r, qy = Math.abs(p.y - c[1]) - h[1] + r, qz = Math.abs(p.z - c[2]) - h[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
const near = (g, list) => { let d = Infinity; for (const b of list) d = Math.min(d, box3(g, b[0], b[1], b[2])); return d; };
const guardGap = (g) => {
  let d = Infinity;
  for (let i = 0; i + 1 < GUARD.length; i++) {
    const [az, ay] = GUARD[i], dz = GUARD[i + 1][0] - az, dy = GUARD[i + 1][1] - ay;
    const t = Math.min(1, Math.max(0, ((g.z - az) * dz + (g.y - ay) * dy) / (dz * dz + dy * dy)));
    d = Math.min(d, Math.hypot(g.z - az - dz * t, g.y - ay - dy * t));
  }
  return Math.max(d - 0.0018, Math.abs(g.x) - 0.006);
};
const _g = { x: 0, y: 0, z: 0 };
const rifleGrip = (pull) => (p) => {
  _g.x = p.x; _g.y = GRIP_R[1] + p.y * C - p.z * S; _g.z = GRIP_R[2] + p.y * S + p.z * C;
  return Math.min(box3(p, GRIP[0], GRIP[1], GRIP[2]), near(_g, GUN), guardGap(_g), near(_g, [TRIGGER[pull]]));
};
const SDF = {
  pistolGrip: rifleGrip(0),
  trigger: rifleGrip(1),
  foregrip: (p) => { _g.x = p.x + GRIP_L[0]; _g.y = p.y + GRIP_L[1]; _g.z = p.z + GRIP_L[2]; return near(_g, FORE); },
  knife: (p) => Math.min(box3(p, [0, -0.003, -0.0006], [0.0079, 0.037, 0.0151], 0.005),
    box2(Math.hypot(p.y - 0.0525, p.z + 0.0063) - 0.0155, p.x, 0.003, 0.0019, 0.0008)),
  pinch: (p) => box3(p, [0, 0, 0], [0.0125, 0.065, 0.0325], 0.003),
};

// knifeOpen 没有自己的摆位，手里还是那把刀
const propOf = (pose) => (pose === 'knifeOpen' ? 'knife' : pose);
const VIEWS = { back: [0, 62], palm: [0, -62], side: [90, 8], thumb: [-90, 8], front: [180, 25], fp: [0, 28] };

// 各姿势的拟合配方（握持物坐标）。wrap：要贴上去的手指，lim[f] = [下限, 上限] 限制那根手指的关节范围
// （[掌指, 近节, 远节, 外展]）；index.pad：食指指肚要按到的点和指肚朝向（扳机；不扣的时候搭在护圈外、弹匣井侧面）；
// thumb.tip：拇指尖球心的落点，pad：指肚朝向，dir：远节指向；thumb.over = [手指, 第几个球]：改成搭在
// 那根手指的指背上（球的编号见 balls，0~4 近节、5~9 中节、10~12 远节）
// 握枪时拇指贴在下机匣左侧、快慢机后面，指尖朝前（枪的坐标换到握点坐标）
const THUMB_REST = { tip: onGrip([-0.0222, -0.031, -0.008]), dir: onGrip([0, 0, -1], 0), pad: [1, 0, 0] };
const RECIPES = {
  pistolGrip: { wrap: [2, 3, 4], index: { pad: onGrip([0.0145, -0.05, -0.079]), normal: [-1, 0, 0], lim: [[0, 0.03, 0.02, -0.1], [0.8, 0.2, 0.15, 0.45]] }, thumb: THUMB_REST },
  trigger: { wrap: [2, 3, 4], index: { pad: onGrip([0, -0.052, -0.0425]), normal: onGrip([0, 0, 1], 0) }, thumb: THUMB_REST },
  foregrip: { wrap: [1, 2, 3, 4], thumb: { over: [1, 9] } },
  knife: { wrap: [1, 2, 3, 4], lim: { 1: [[1.35, 0.8, 0.3], [1.75, 1.95, 1.3]] }, thumb: { over: [2, 9] } },
  pinch: { wrap: [1, 2, 3, 4], lim: { 1: [[0.6, 0.1, 0.06], [1.65, 0.3, 0.2]], 2: [[0.6, 0.1, 0.06], [1.65, 0.3, 0.2]], 3: [[0.6, 0.1, 0.06], [1.65, 0.3, 0.2]], 4: [[0.5, 0.1, 0.06], [1.65, 0.6, 0.35]] }, thumb: { tip: [-0.0223, 0.02, -0.028], dir: [0, 0, -1], pad: [1, 0, 0] } },
};

// 姿势拟合：把手指取成一串球，在关节角里搜“贴着握持物、不穿进去”的解。只对右手算，左手是镜像。
function makeFit(THREE, arm, holderOf, rehold) {
  const rig = arm.root.userData.rig, v = new THREE.Vector3(), TOL = 0.0006;
  const balls = (f) => {
    const F = FINGERS[f], out = [];
    for (let k = 0; k < 3; k++) {
      for (const t of k < 2 ? [0.2, 0.4, 0.6, 0.8, 1] : [0.25, 0.5, 1 - F.rad[3] / F.len[2]]) {
        out.push({ p: new THREE.Vector3(0, 0, -t * F.len[k]).applyMatrix4(rig.chains[f][k].matrixWorld), r: (F.rad[k] + (F.rad[k + 1] - F.rad[k]) * t) * 0.95, k });
      }
    }
    return out;
  };
  const set = (f, c) => { arm.setCurl(f, c, c[3] || 0, c[4] || 0); rig.chains[f][0].updateMatrixWorld(true); };
  const pen = (g) => (g < -TOL ? 80e6 * (g + TOL) ** 2 : 0);
  const fit = {
    balls, set, SDF,
    // 掌面（含鱼际）对握持物的最小间隙，毫米；负数 = 握持物压进手掌的深度
    palmGap(pose) {
      const holder = holderOf(pose);
      let min = Infinity;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 12; j++) {
        const x = -0.036 + 0.0078 * i, z = -0.095 + 0.0075 * j;
        arm.hand.localToWorld(v.set(x, palmBottomY(x, z), z));
        min = Math.min(min, SDF[pose](holder.worldToLocal(v)));
      }
      return +(min * 1000).toFixed(2);
    },
    // 某根手指摆成 c 时的代价：att = 各节贴合权重，others = 别的手指的球（只罚穿透），
    // extra(balls, toObj, c) 追加项，toObj 把世界坐标换到握持物坐标
    cost(f, c, pose, { att = [1, 1, 1], others = [], palm = f > 0, extra = null } = {}) {
      set(f, c);
      const holder = holderOf(pose), bs = balls(f);
      let sum = 0;
      for (const b of bs) {
        const g = SDF[pose](holder.worldToLocal(v.copy(b.p))) - b.r;
        sum += pen(g) + att[b.k] * 1e6 * Math.max(g, -TOL) ** 2;
        if (palm && b.k > 0) {
          arm.hand.worldToLocal(v.copy(b.p));
          if (Math.abs(v.x - 0.003) < 0.04 && v.z > -0.098 && v.z < 0 && v.y < 0.005) sum += pen(palmBottomY(v.x, v.z) - v.y - b.r);
        }
        for (const o of others) sum += pen(b.p.distanceTo(o.p) - b.r - o.r);
      }
      return sum + (extra ? extra(bs, (p) => holder.worldToLocal(v.copy(p)), c) : 0);
    },
    // 固定种子的随机撒点 + 逐轴细化。五个自由度的拇指光靠撒点容易卡在局部解，
    // 所以 hints 里的起点和撒点里最好的那个各自细化，取最后代价最低的
    search(fn, lo, hi, n = 3000, hints = []) {
      let seed = 12345, top = null, tc = Infinity;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < n; i++) {
        const c = lo.map((l, k) => l + rnd() * (hi[k] - l)), val = fn(c);
        if (val < tc) { tc = val; top = c; }
      }
      let best = null, bc = Infinity;
      for (const start of [top, ...hints]) {
        let cur = start.slice(), cc = fn(cur);
        for (let step = 0.06; step > 0.002; step *= 0.6) {
          for (let again = true; again;) {
            again = false;
            for (let k = 0; k < cur.length; k++) for (const d of [-step, step]) {
              const c = cur.slice();
              c[k] = Math.min(hi[k], Math.max(lo[k], c[k] + d));
              const val = fn(c);
              if (val < cc - 1e-9) { cc = val; cur = c; again = true; }
            }
          }
        }
        if (cc < bc) { bc = cc; best = cur; }
      }
      return { c: best.map((x) => +x.toFixed(3)), cost: +bc.toFixed(2) };
    },
    // 沿掌心法线推握持物，直到它压进掌面 depth 毫米（先碰到的多半是鱼际）；改了摆位先调它
    seat(pose, depth = 0.8) {
      const h = HOLDS[pose];
      let lo = h.p[2] - 0.02, hi = h.p[2] + 0.02;
      for (let i = 0; i < 14; i++) {
        h.p[2] = (lo + hi) / 2;
        rehold();
        if (fit.palmGap(pose) > -depth) lo = h.p[2]; else hi = h.p[2];
      }
      return +h.p[2].toFixed(4);
    },
    // 四指包握：每根手指各自搜 [掌指, 近节, 远节]
    wrap(pose, fingers, lim = {}) {
      const out = {};
      for (const f of fingers) {
        const [lo, hi] = lim[f] || [[0, 0, 0], [1.65, 1.95, 1.3]];
        out[f] = fit.search((c) => fit.cost(f, c, pose) + 40 * (c[2] - 0.6 * c[1]) ** 2, lo, hi);
        set(f, out[f].c);
      }
      return out;
    },
    // 食指指肚按到扳机上：位置对准，指肚朝后
    index(pose, { pad, normal, lim = [[0, 0, 0, -0.25], [1.2, 1.9, 1, 0.3]] }, others) {
      const tip = arm.anchors.indexTip, want = new THREE.Vector3(...pad), n = new THREE.Vector3(), q = new THREE.Quaternion();
      const holder = holderOf(pose), hq = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
      const r = fit.search((c) => fit.cost(1, c, pose, { att: [0, 0, 0], others, extra: () => {
        const p = holder.worldToLocal(tip.getWorldPosition(v));
        n.set(0, -1, 0).applyQuaternion(tip.getWorldQuaternion(q)).applyQuaternion(hq);
        return 3e6 * p.distanceToSquared(want) + 300 * (1 - n.x * normal[0] - n.y * normal[1] - n.z * normal[2]) ** 2;
      } }) + 15 * (c[2] - 0.3 * c[1]) ** 2, lim[0], lim[1], 8000);
      set(1, r.c);
      return r;
    },
    // 拇指：指尖落到目标点，指肚朝 pad（搭在手指上时压向那节指背），远节朝 dir，不穿握持物和别的手指
    thumb(pose, { tip, over, dir, pad }, others) {
      const holder = holderOf(pose), want = new THREE.Vector3(), d = new THREE.Vector3();
      const bone = rig.chains[0][2], bq = new THREE.Quaternion(), hq = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
      const face = new THREE.Vector3(), n = new THREE.Vector3();
      if (over) {
        // 搭在那根手指某个球的指背上：沿那一节的指背方向垫出一个拇指半径，指肚朝回压
        const b = balls(over[0])[over[1]];
        face.set(0, 1, 0).applyQuaternion(rig.chains[over[0]][b.k].getWorldQuaternion(bq));
        holder.worldToLocal(want.copy(b.p).addScaledVector(face, b.r + FINGERS[0].rad[3]));
        face.negate().applyQuaternion(hq);
      } else {
        want.set(...tip);
        face.set(...pad);
      }
      const lo = [-0.4, -0.2, -0.1, -0.3, -1.3], hi = [1, 0.9, 1.2, 1.5, 1.3];
      const hints = [[0.6, 0.3, 0.3, 1.3, 1.15], [0.48, 0.9, 0.63, 1.08, 1.14], [0.3, 0.5, 0.5, 0.8, 0.6]];
      if (dir) {
        // 再加一个算出来的起点：整根拇指伸直朝 dir、指肚朝 pad 时腕掌关节该转多少
        const toHand = arm.hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(holder.getWorldQuaternion(bq));
        const z = new THREE.Vector3(...dir).negate().applyQuaternion(toHand).normalize();
        const y = face.clone().negate().applyQuaternion(toHand);
        y.addScaledVector(z, -y.dot(z)).normalize();
        const F = FINGERS[0], rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(F.rest[0], F.rest[1], F.rest[2], 'YXZ'));
        const e = new THREE.Euler().setFromQuaternion(rest.invert().multiply(
          bq.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z))), 'YXZ');
        hints.push([-e.x, 0, 0, e.y, e.z].map((x, k) => Math.min(hi[k], Math.max(lo[k], x))));
      }
      const r = fit.search((c) => fit.cost(0, c, pose, { att: over ? [0, 0.15, 0] : [0, 0.3, 0.6], others, palm: false, extra: (bs, toObj) => {
        const end = toObj(bs[bs.length - 1].p).clone();
        d.subVectors(end, toObj(bs[bs.length - 3].p)).normalize();
        n.set(0, -1, 0).applyQuaternion(bone.getWorldQuaternion(bq)).applyQuaternion(hq);
        return 3e6 * end.distanceToSquared(want) + 120 * (1 - n.dot(face)) ** 2
          + (dir ? 150 * (1 - d.x * dir[0] - d.y * dir[1] - d.z * dir[2]) ** 2 : 0);
      } }) + 8 * c[4] * c[4], lo, hi, 12000, hints);
      set(0, r.c);
      return r;
    },
    // 按配方把一个姿势从头拟合一遍，返回可以贴进 POSES 的一行和各项代价
    solve(pose, patch = {}) {
      const R = { ...RECIPES[pose], ...patch }, cost = {};
      arm.setPose('flat');
      arm.root.updateMatrixWorld(true);
      Object.assign(cost, fit.wrap(pose, R.wrap, R.lim));
      const fingers = () => [1, 2, 3, 4].flatMap((f) => balls(f));
      if (R.index) cost[1] = fit.index(pose, R.index, balls(2));
      cost[0] = fit.thumb(pose, R.thumb, fingers());
      return { row: fit.dump(), cost: Object.values(cost).map((r) => Math.round(r.cost)), gaps: fit.gaps(pose), palm: fit.palmGap(pose) };
    },
    // 当前姿势（右手）转成 POSES 里的一行
    dump() { return JSON.stringify(rig.cur.map((c) => c.map((x) => +x.toFixed(3)))); },
    // 各手指对握持物的最小间隙（负数 = 穿进去的深度），单位毫米
    gaps(pose) {
      arm.root.updateMatrixWorld(true);
      const holder = holderOf(pose);
      return FINGERS.map((_, f) => +(Math.min(...balls(f).map((b) => SDF[pose](holder.worldToLocal(v.copy(b.p))) - b.r)) * 1000).toFixed(1));
    },
  };
  return fit;
}

startHarness(async ({ THREE, scene, gear, view, sky, camera }) => {
  // 夜空太暗，看不清深色手套的轮廓，换成中灰背景
  sky.mesh.visible = false;
  scene.background = new THREE.Color(0x4a4f57);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.15 });
  const arms = {}, holders = [], axes = [];
  for (const side of ['R', 'L']) {
    const sx = side === 'L' ? -1 : 1, arm = (arms[side] = buildArm(gear, side));
    arm.root.position.x = 0.11 * sx;
    scene.add(arm.root);
    for (const name of Object.keys(HOLDS)) {
      const g = new THREE.Group();
      g.name = name;
      g.userData = { prop: true, sx };
      PROPS[name](g, THREE, mat);
      arm.anchors.palm.add(g);
      holders.push(g);
    }
    for (const a of [arm.anchors.palm, arm.anchors.indexTip]) {
      const ax = new THREE.AxesHelper(0.03);
      ax.visible = false;
      a.add(ax);
      axes.push(ax);
    }
  }

  // 有真模型就换掉替身：爪刀的原点就是握持锚点，步枪按两个握点摆。这些文件归别的模块，加载不了就继续用替身；?real=0 强制用替身
  if (new URLSearchParams(location.search).get('real') !== '0') {
    try {
      const [{ buildKarambit }, { buildRifle }] = await Promise.all([import('../src/weapons/knife_model.js'), import('../src/weapons/rifle_model.js')]);
      const rifle = buildRifle(gear).root;
      const real = (name) => {
        if (name === 'knife') return buildKarambit(gear).root;
        const gun = name === 'foregrip' ? gunAt(THREE, GRIP_L) : gunAt(THREE, GRIP_R, RAKE), copy = rifle.clone();
        if (name === 'trigger') copy.getObjectByName('rifle.trigger').rotation.x -= 0.22;
        gun.add(copy);
        return gun;
      };
      for (const g of holders) if (g.name !== 'pinch') { const r = real(g.name); g.clear(); g.add(r); }
    } catch (e) { console.warn('真模型没加载上，用替身', e); }
  }

  const state = { pose: 'flat', props: true };
  const api = {
    arms, THREE, HOLDS,
    pose(name) {
      state.pose = name;
      for (const s in arms) arms[s].setPose(name);
      for (const g of holders) g.visible = state.props && g.name === propOf(name);
    },
    // 改握持物相对掌心的摆位（右手数值，左手自动镜像）；不带参数就是按 HOLDS 重新摆
    hold(name, p, r) {
      if (name) { if (p) HOLDS[name].p = p; if (r) HOLDS[name].r = r; }
      for (const g of holders) applyHold(g, g.name, g.userData.sx < 0 ? 'L' : 'R').updateMatrixWorld(true);
    },
    props(on) { state.props = on; for (const g of holders) g.visible = on && g.name === propOf(state.pose); },
    axes(on) { for (const a of axes) a.visible = on; },
    // 视角名，或直接给 [偏航, 俯仰]；side 给了就只对准那只手
    look(name = 'back', side = null, dist = side ? 0.42 : 0.78, tz = -0.05, ty = 0) {
      const a = VIEWS[name] || name;
      camera.up.set(0, 1, 0);
      view(a[0], a[1], dist, side ? (side === 'L' ? -0.11 : 0.11) : 0, ty, tz);
    },
    // 在握持物坐标里摆相机（+Y 向上、−Z 朝枪口），dir 是从握持物指向相机的方向：
    // aim('pistolGrip', [-0.3, 0.45, 1]) 就是持枪时自己眼睛的大致位置
    aim(pose, dir = [-0.3, 0.45, 1], dist = 0.36, side = 'R', lift = 0.02) {
      const sx = side === 'L' ? -1 : 1, g = holders.find((h) => h.name === propOf(pose) && h.userData.sx === sx);
      arms[side].root.updateMatrixWorld(true);
      const q = g.getWorldQuaternion(new THREE.Quaternion());
      const at = g.localToWorld(new THREE.Vector3(0, lift, 0));
      camera.up.set(0, 1, 0).applyQuaternion(q);
      camera.position.set(dir[0] * sx, dir[1], dir[2]).normalize().multiplyScalar(dist).applyQuaternion(q).add(at);
      camera.lookAt(at);
    },
    // 截图用：一步摆好姿势和视角，顺手关掉别的模块报错弹出的 vite 浮层
    shot(pose, name, side, dist, tz, ty) {
      document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove());
      if (pose) api.pose(pose);
      api.look(name, side, dist, tz, ty);
      return `${innerWidth}x${innerHeight}`;
    },
    stats() {
      const out = {};
      for (const s in arms) {
        let meshes = 0, tris = 0;
        const count = (o) => {
          if (o.userData.prop) return;
          if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
          o.children.forEach(count);
        };
        count(arms[s].root);
        out[s] = { meshes, tris };
      }
      return out;
    },
  };
  api.hold();
  api.fit = makeFit(THREE, arms.R, (pose) => holders.find((g) => g.name === pose && g.userData.sx === 1), () => api.hold());
  window.__hands = api;

  // 状态都能从地址栏恢复（别的模块一改，vite 会整页刷新）：
  // ?pose=knife&side=R&view=palm&dist=0.4 或 &aim=-0.3,0.45,1,0.34；调姿势时再加
  // &hold=px,py,pz,rx,ry,rz 临时改摆位、&solve=1 现场拟合（结果在 __hands.solved）、&over=1,9 改拇指落点
  const q = new URLSearchParams(location.search), nums = (k) => q.get(k)?.split(',').map(Number);
  const pose = q.get('pose') || 'flat', side = q.get('side'), hold = nums('hold'), aim = nums('aim');
  if (hold) api.hold(pose, hold.slice(0, 3), hold.slice(3, 6));
  api.pose(pose);
  if (q.get('solve')) api.solved = api.fit.solve(pose, nums('over') ? { thumb: { over: nums('over') } } : {});
  if (aim) api.aim(pose, aim.slice(0, 3), aim[3] || 0.36, side || 'R');
  else api.look(q.get('view') || 'back', side, nums('dist')?.[0]);
  addEventListener('keydown', (e) => {
    const names = arms.R.poses, i = Number(e.key) - 1;
    if (names[i]) api.pose(names[i]);
    const name = { q: 'back', w: 'palm', e: 'side', r: 'front' }[e.key];
    if (name) api.look(name);
    if (e.key === 'p') api.props(!state.props);
    if (e.key === 'a') api.axes(!axes[0].visible);
  });
});
