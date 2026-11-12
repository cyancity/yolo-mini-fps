import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { aabb, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { warnSign, poster } from './street_decals.js';

// 围墙上的二级、三级细节：刷漆墙裙、线管和接线盒、压顶下的雨水流痕、零星的标牌和小广告。
const G = { tile: TILE.galv }, P = { tile: TILE.paint };

// 雨水流痕：一张图，各处按不同宽高拉伸复用
function stainRect(ctx) {
  return ctx.atlas.cached('street|stain', 128, 256, (c, w, h) => {
    for (let i = 0; i < 22; i++) {
      const x = ctx.rand() * w, sw = 3 + ctx.rand() * 14, len = h * (0.3 + ctx.rand() * 0.7);
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(22,20,16,${0.35 + ctx.rand() * 0.3})`); g.addColorStop(1, 'rgba(22,20,16,0)');
      c.fillStyle = g; c.fillRect(x, 0, sw, len);
    }
  });
}

function stains(ctx, face, pts) {
  const r = stainRect(ctx);
  for (const [x, z, w, h] of pts) decal(ctx, r, w, h, x, 4.45 - h / 2, z, face, { off: 0.004 });
}

// 卸货场北墙内侧：灰色墙裙 + 黄线，沿墙一根线管串起三盏灯，配电箱
function courtNorth(ctx, S) {
  const { batch, mats } = ctx;
  const z = -47.6;
  aabb(ctx, S.renderGrey, 8.4, 30.0, 0, 1.15, z, z + 0.02, { tile: TILE.render });
  aabb(ctx, S.bollard, 8.4, 30.0, 1.15, 1.22, z, z + 0.025, { tile: TILE.paint });
  batch.add(mats.galv, cylBetween(9.0, 3.05, z + 0.06, 29.4, 3.05, z + 0.06, 0.025, 6), null, G);
  for (let x = 9.5; x < 29.4; x += 1.6) batch.add(mats.steelDark, box(0.05, 0.08, 0.06), xf(x, 3.05, z + 0.03), G);
  for (const x of [13.0, 19.3, 25.5]) {
    batch.add(S.box, rb(0.18, 0.18, 0.1, 0.01), xf(x - 0.35, 3.05, z + 0.06), P);
    batch.add(mats.galv, cylBetween(x - 0.35, 3.14, z + 0.06, x - 0.35, x === 19.3 ? 3.95 : 3.3, z + 0.06, 0.018, 6), null, G);
  }
  // 配电箱和下来的线管
  batch.add(S.box, rb(0.7, 0.9, 0.22, 0.015), xf(23.9, 1.75, z + 0.11), P);
  batch.add(mats.galv, rb(0.03, 0.12, 0.05, 0.006), xf(24.15, 1.7, z + 0.235), G);
  batch.add(mats.galv, cylBetween(23.7, 2.2, z + 0.06, 23.7, 3.05, z + 0.06, 0.02, 6), null, G);
  decal(ctx, warnSign(ctx, 'power', '配电箱 闲人勿动', 'ELECTRICAL · AUTHORIZED ONLY', { w: 256, h: 128 }), 0.42, 0.21, 23.9, 1.95, z + 0.222, 's');
  // 出水口和下面的青苔印
  for (const x of [11.0, 21.0]) batch.add(mats.concreteDark, cyl(0.06, 0.06, 0.25, 8), xf(x, 0.25, z + 0.1, Math.PI / 2, 0, 0), { tile: TILE.conc });
  stains(ctx, 's', [[10.5, z, 1.4, 2.4], [14.8, z, 0.9, 1.6], [18.0, z, 1.6, 2.9], [21.2, z, 1.1, 1.8], [27.9, z, 1.3, 2.2]]);
}

// 堆场墙和卸货场东墙的街面：流痕、门边的标牌、几张小广告
function streetFaces(ctx, S) {
  const { batch, mats } = ctx;
  const yx = 29.3, cx = 30.4;
  stains(ctx, 'e', [[yx, -18.4, 1.5, 2.6], [yx, -11.8, 1.0, 1.7], [yx, -7.6, 1.8, 3.0], [yx, -1.6, 0.8, 1.5], [yx, 13.2, 1.2, 2.2], [yx, 19.2, 1.4, 2.5]]);
  stains(ctx, 'e', [[cx, -35.2, 1.6, 2.7], [cx, -34.0, 0.9, 1.4], [cx, -44.3, 1.0, 1.9]]);
  decal(ctx, warnSign(ctx, 'loading', '卸货区 车辆慢行', 'LOADING BAY · DEAD SLOW', { w: 384, h: 160 }), 1.2, 0.5, cx, 3.2, -35.6, 'e');
  for (let i = 0; i < 3; i++) decal(ctx, poster(ctx, i + 1), 0.4, 0.55, cx, 1.45 + (i % 2) * 0.1, -33.6 - i * 0.46, 'e');
  // 堆场墙顶上的探照灯（不亮）和监控
  for (const z of [-12, 12.6]) {
    batch.add(mats.steelDark, cylBetween(yx - 0.1, 4.4, z, yx + 0.35, 4.75, z, 0.025, 6), null, G);
    batch.add(mats.plasticBlack, rb(0.3, 0.12, 0.12, 0.02), xf(yx + 0.45, 4.7, z, 0, 0, -0.35), { tile: TILE.plastic });
  }
}

export function dressWalls(ctx, S) {
  courtNorth(ctx, S);
  streetFaces(ctx, S);
}
