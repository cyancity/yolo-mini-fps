import * as THREE from 'three';
import { SkinBuilder } from './soldier_skin.js';
import { buildBody } from './soldier_body.js';
import { buildHead } from './soldier_head.js';
import { buildGear } from './soldier_gear.js';
import { buildGun } from './soldier_gun.js';
import { createSoldierMaterials } from './soldier_mat.js';

// 士兵的可见网格。对外只有两个函数，骨架、动画、命中体都不认识这里面的东西：
//   buildSoldierAsset(mats)                      → asset：所有变体的几何和材质，建一次
//   attachSoldierMesh(asset, variant, skeleton, parent) → { meshes, setVisible(on), setDead(on), tris, drawCalls }
//   setDead(true) 换成没有轮廓光的尸体材质，复位时 setDead(false) 换回来
// 以后换成导入的蒙皮模型，只要照这两个函数的形状实现、把模型骨头对到 soldier_skeleton 的名字上。

export const VARIANTS = [
  { name: '头盔', head: 'helmet', pack: false },
  { name: '软帽背包', head: 'cap', pack: true },
  { name: '头盔背包', head: 'helmet', pack: true },
];

// 配色：[颜色, 粗糙度, 金属度, 自发光, 第四通道（soft 是迷彩强度，hard 是法线强度）]
const TINTS = [
  { shirt: 0x3a3d33, pants: 0x34372e, vest: 0x232423, pouch: 0x272826, helmet: 0x272926, pack: 0x272826 },
  { shirt: 0x383c2f, pants: 0x30342a, vest: 0x30342a, pouch: 0x2e3228, helmet: 0x33372b, pack: 0x2f3229 },
  { shirt: 0x34373a, pants: 0x2e3134, vest: 0x2a2a28, pouch: 0x292927, helmet: 0x2f302c, pack: 0x262624 },
];
const darker = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
// 敌方识别色，和无人机的橙色装甲一个色系。带一点自发光打底（不到泛光的阈值），背光处和夜里也不会黑成一团
const MARK = 0xff5a14, MARK_GLOW = 0.5;

function palette(i) {
  const t = TINTS[i];
  return {
    shirt: [t.shirt, 0.86, 0, 0, 1], shirtDark: [darker(t.shirt, 0.8), 0.88, 0, 0, 0.5],
    pants: [t.pants, 0.86, 0, 0, 1], pantsDark: [darker(t.pants, 0.85), 0.88, 0, 0, 0.8],
    balaclava: [0x1a1b1c, 0.95, 0, 0, 0.15], glove: [0x202122, 0.8, 0, 0, 0], knuckle: [0x111213, 0.6, 0, 0, 1],
    boot: [0x2b2925, 0.72, 0, 0, 0], lace: [0x141414, 0.8, 0, 0, 0.3], sole: [0x0d0d0d, 0.88, 0, 0, 1],
    vest: [t.vest, 0.82, 0, 0, 0], pouch: [t.pouch, 0.82, 0, 0, 0], webbing: [darker(t.vest, 0.75), 0.85, 0, 0, 0],
    strap: [0x1b1c1b, 0.85, 0, 0, 0], pack: [t.pack, 0.82, 0, 0, 0.25], cap: [t.helmet, 0.9, 0, 0, 0.4],
    helmet: [t.helmet, 0.62, 0, 0, 1], trim: [0x0f0f0f, 0.75, 0, 0, 0.5], rail: [0x1c1d1e, 0.45, 0.5, 0, 0.2],
    velcro: [darker(t.helmet, 0.7), 0.95, 0, 0, 1.5], kneepad: [0x1e1f1e, 0.55, 0, 0, 1],
    lens: [0x18222b, 0.05, 0.6, 0, 0], frame: [0x101010, 0.7, 0, 0, 0.6],
    ear: [0x1f2020, 0.55, 0, 0, 0.8], cushion: [0x0d0d0d, 0.9, 0, 0, 0], radio: [0x1b1c1c, 0.5, 0.2, 0, 0.5],
    mag: [0x161718, 0.6, 0, 0, 1],
    mark: [MARK, 0.72, 0, MARK_GLOW, 0], markHard: [MARK, 0.5, 0, MARK_GLOW, 0.4],
    plate: [MARK, 0.8, 0, MARK_GLOW * 0.7, 0.35],
    // 信号灯：很小，靠自发光倍数进泛光
    led: [0xff1a0a, 0.3, 0, 60, 0],
    // 识别灯条：颜色对着无人机的灯条（线性 5.5 : 1.25 : 0.3）。面积小得多，亮度给到三倍，远处才留得下一个亮点
    light: [0xff8342, 0.3, 0, 16, 0],
  };
}

// 倒地的身体离根节点最远 1.6 m 左右，包围球按这个放大，躺着也不会被视锥剔掉
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 2.7);
const IDENTITY = new THREE.Matrix4();

export function buildSoldierAsset(mats) {
  const materials = createSoldierMaterials(mats);
  const variants = VARIANTS.map((v, i) => {
    const sb = new SkinBuilder(), C = palette(i);
    buildBody(sb, C);
    buildHead(sb, C, v);
    buildGear(sb, C, v);
    buildGun(sb);
    const g = sb.build();
    for (const k of ['soft', 'hard']) g[k].boundingSphere = BOUNDS.clone();
    return { ...v, soft: g.soft, hard: g.hard, tris: g.tris };
  });
  return { materials, variants };
}

export function attachSoldierMesh(asset, variant, skeleton, parent) {
  const v = asset.variants[((variant % asset.variants.length) + asset.variants.length) % asset.variants.length];
  const meshes = ['soft', 'hard'].map((k) => {
    const m = new THREE.SkinnedMesh(v[k], asset.materials[k]);
    m.name = `soldier-${k}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.boundingSphere = BOUNDS;
    parent.add(m);
    m.bind(skeleton, IDENTITY);
    return m;
  });
  return {
    meshes, tris: v.tris, drawCalls: meshes.length,
    setVisible(on) { for (const m of meshes) m.visible = on; },
    setDead(on) {
      const set = on ? asset.materials.dead : asset.materials;
      if (set) meshes.forEach((m, i) => { m.material = set[i ? 'hard' : 'soft']; });
    },
  };
}
