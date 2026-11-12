import * as THREE from 'three';
import { indoorAt } from './lighting.js';

const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _box = new THREE.Box3();

// 这个网格有没有落在室内的部分。合批的网格顶点已经是世界坐标，每个三角形看一个顶点就够
function meshIndoor(mesh, phys) {
  const pos = mesh.geometry?.attributes?.position;
  if (!pos) return false;
  const step = Math.max(3, Math.floor(pos.count / 6000) * 3);
  for (let i = 0; i < pos.count; i += step) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (indoorAt(_v.x, _v.y, _v.z)) return true;
  }
  // 单独放的小东西（集装箱里那根灯管）：头顶三米之内有遮挡也算室内
  if (!phys) return false;
  _box.setFromObject(mesh);
  _box.getSize(_v);
  if (Math.max(_v.x, _v.z) > 3) return false;
  _box.getCenter(_c);
  return phys.ceilingHeight(_c.x, _c.z, 0.05, _c.y) - _c.y < 3;
}

// 找出关卡里所有发光材质（灯面、招牌、亮着的窗），分「室内 / 室外」两档：
// 白天室外的灯面和招牌压到几乎不亮，屋里的照常。同一个材质实例室内外都在用的（仓库里外同一种灯）算室内。
// 调的是 emissive 颜色，不是 emissiveIntensity：后者留给各分区的 update 做闪烁。
// 要在关卡建完、游戏对象（武器、敌人）进场之前调用，这样只会收到关卡自己的材质
export function collectGlows(scene, phys) {
  const byMat = new Map();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.emissive || !(m.emissiveIntensity > 0) || m.emissive.r + m.emissive.g + m.emissive.b <= 0) continue;
      byMat.set(m, (byMat.get(m) || false) || meshIndoor(o, phys));
    }
  });
  return [...byMat].map(([mat, indoor]) => ({ mat, base: mat.emissive.clone(), indoor }));
}

// 远处的灯火（港区、高架上的车灯）是一个个发光的点，白天整个藏起来
export function collectCityLights(scene) {
  const out = [];
  scene.traverse((o) => { if (o.isPoints && o.material?.isPointsMaterial && o.material.vertexColors) out.push(o); });
  return out;
}

// 按时段给发光材质调亮度
export function scaleGlows(glows, outdoor, indoor) {
  for (const g of glows) g.mat.emissive.copy(g.base).multiplyScalar(g.indoor ? indoor : outdoor);
}
