import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cyl, box, scaleUV, xf } from '../gfx/geo.js';

// 烟雾弹罐体：橄榄色圆罐、一道浅色识别环、引信座和贴着罐身的保险握片。
// 原点在罐体中心，罐轴沿 +Y。几何体几颗共用，每颗三个网格（罐身、色环、金属件）
export const CAN = { r: 0.031, h: 0.118 };

let shared = null;

function geometries() {
  if (shared) return shared;
  const { r, h } = CAN;
  // 涂装贴图按集装箱的幅面做的，罐子这么小只取贴图里的一小块，磨损才不会糊成大斑
  const body = scaleUV(cyl(r, r, h, 20), 0.12, 0.06);
  const band = scaleUV(cyl(r + 0.0012, r + 0.0012, 0.02, 20, true), 0.12, 0.02);
  band.translate(0, h * 0.18, 0);
  // 引信座 + 握片（竖条贴着罐身，上端折过来压在引信座上）
  const parts = [
    [cyl(0.016, 0.019, 0.022, 12), xf(0, h / 2 + 0.011, 0)],
    [cyl(0.006, 0.006, 0.01, 8), xf(0, h / 2 + 0.026, 0)],
    [box(0.013, 0.104, 0.0032), xf(0, -0.004, r + 0.0026, 0.05, 0, 0)],
    [box(0.013, 0.0032, 0.036), xf(0, h / 2 + 0.023, r - 0.014, -0.18, 0, 0)],
  ].map(([g, m]) => {
    const out = (g.index ? g.toNonIndexed() : g).applyMatrix4(m);
    if (out !== g) g.dispose();
    return out;
  });
  const metal = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  shared = { body, band, metal };
  return shared;
}

export function makeCanister(mats) {
  const geo = geometries();
  const body = mats.paint(0x3e4632, { wear: 0.25, dirt: 0.35, rough: 0.6 });
  const band = mats.paint(0xc4ad55, { wear: 0.2, dirt: 0.3, rough: 0.55 });
  const group = new THREE.Group();
  group.name = 'smokeGrenade';
  for (const [g, m] of [[geo.body, body], [geo.band, band], [geo.metal, mats.steelDark]]) {
    const mesh = new THREE.Mesh(g, m);
    // 这么小的东西不投影，省得每盏投影灯多画几次
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.visible = false;
  return group;
}
