import * as THREE from 'three';
import { xf, box, rbox } from '../../gfx/geo.js';
import { decalQuad } from '../labels.js';

// 街道分区共用的小工具：轴对齐块、贴花、下垂的电缆。

// 圆角盒默认只细分一级（每个 108 个三角形；two 级是 300 个），远处看不出差别
export const rb = (w, h, d, r = 0.012, seg = 1) => rbox(w, h, d, r, seg);

// 轴对齐的块（x0..x1、y0..y1、z0..z1）。给 surface 就同时登记碰撞体，返回它
export function aabb(ctx, mat, x0, x1, y0, y1, z0, z1, { tile = 3, r = 0, seg = 1, surface = null, playerOnly = false } = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  ctx.batch.add(mat, r > 0 ? rb(w, h, d, r, seg) : box(w, h, d), xf((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), tile ? { tile } : {});
  if (!surface) return null;
  const c = ctx.phys.addBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, w / 2, h / 2, d / 2, 0, surface);
  if (playerOnly) c.playerOnly = true;
  return c;
}

// 只登记碰撞体
export function collider(ctx, x0, x1, y0, y1, z0, z1, surface = 'concrete', playerOnly = false) {
  const c = ctx.phys.addBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0, surface);
  if (playerOnly) c.playerOnly = true;
  return c;
}

// 贴花朝向：w 朝 -X（贴在街东侧门面上），e 朝 +X，n 朝 -Z，s 朝 +Z。值是 [偏航, 右方向 x, 右方向 z, 法线 x, 法线 z]
const FACES = {
  w: [-Math.PI / 2, 0, 1, -1, 0],
  e: [Math.PI / 2, 0, -1, 1, 0],
  s: [0, 1, 0, 0, 1],
  n: [Math.PI, -1, 0, 0, -1],
};

// 以中心点放一张贴花（mat 默认是标签图集的材质）
export function decal(ctx, rect, w, h, cx, cy, cz, face, { off = 0.006, mat = null, batch = null } = {}) {
  const [ry, rx, rz, nx, nz] = FACES[face];
  const x = cx - rx * (w / 2) + nx * off, z = cz - rz * (w / 2) + nz * off;
  (batch || ctx.decals).add(mat || ctx.atlas.material, decalQuad(w, h, rect), xf(x, cy - h / 2, z, 0, ry, 0));
}

// 两点之间下垂的电缆，sag 是中点下垂量。电缆用不封口的四棱管，省一半三角形
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
function tube(ax, ay, az, bx, by, bz, r) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  const g = new THREE.CylinderGeometry(r, r, _a.distanceTo(_b), 4, 1, true);
  _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _one));
}

export function cable(ctx, mat, a, b, sag, r = 0.012, n = 8) {
  let px = a[0], py = a[1], pz = a[2];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    const y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
    ctx.batch.add(mat, tube(px, py, pz, x, y, z, r), null, { tile: 1.2 });
    px = x; py = y; pz = z;
  }
}
