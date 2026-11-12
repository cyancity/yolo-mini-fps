import * as THREE from 'three';
import { corrugated } from '../gfx/geo.js';

// 所有喷字、标牌都画进同一张图集，贴花合并成一个网格
export class LabelAtlas {
  constructor(width = 4096, height = 2048) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.x = 2;
    this.y = 2;
    this.rowH = 0;
    this.cache = new Map();
    this.material = new THREE.MeshStandardMaterial({
      transparent: true, depthWrite: false, roughness: 0.55, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
  }

  // draw(ctx, w, h) 在区域内作画；返回 UV 矩形 [u0, v0, u1, v1]
  add(w, h, draw) {
    if (this.x + w + 2 > this.width) { this.x = 2; this.y += this.rowH + 4; this.rowH = 0; }
    if (this.y + h + 2 > this.height) { console.warn('[labels] 图集放不下了'); return [0, 0, 0.01, 0.01]; }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    draw(ctx, w, h);
    ctx.restore();
    const sw = this.width, sh = this.height;
    const rect = [this.x / sw, 1 - (this.y + h) / sh, (this.x + w) / sw, 1 - this.y / sh];
    this.x += w + 4;
    this.rowH = Math.max(this.rowH, h);
    return rect;
  }

  // 同一个 key 只画一次（公司名、铭牌这类重复用的标签）
  cached(key, w, h, draw) {
    if (!this.cache.has(key)) this.cache.set(key, this.add(w, h, draw));
    return this.cache.get(key);
  }

  finish() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    this.material.map = t;
    this.material.needsUpdate = true;
  }
}

function remapUV(geo, rect, w, h, tile) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = (uv.getX(i) * tile) / w, v = (uv.getY(i) * tile) / h;
    uv.setXY(i, rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
  }
  return geo;
}

// 平面贴花，原点在左下角，朝 +Z
export function decalQuad(w, h, rect) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(w / 2, h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  }
  return g;
}

// 贴在波纹板上的贴花：用同一套波纹轮廓，宽度取整到波距
export function decalCorrugated(w, h, rect, pitch, depth) {
  const n = Math.max(1, Math.round(w / pitch));
  const g = corrugated(n * pitch, h, { pitch, depth, tile: 1 });
  return remapUV(g, rect, n * pitch, h, 1);
}

// 作旧：随机擦掉一些小块，像掉漆
export function distress(ctx, w, h, rand, amount = 0.5) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const n = Math.floor((w * h) / 900 * amount);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.6;
    const r = 1 + rand() * rand() * 7;
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, r, r * (0.4 + rand()), rand() * 3.14, 0, 6.283);
    ctx.fill();
  }
  ctx.restore();
}

// mulberry32，Tommy Ettinger，公有领域
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STENCIL_FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';
