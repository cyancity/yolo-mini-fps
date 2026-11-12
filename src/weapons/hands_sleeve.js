import { Batch, xf, box, rbox, cyl } from '../gfx/geo.js';
import { SkinGeo, lerp, smooth } from './hands_skin.js';
import { TILE } from './hands_glove.js';

// 前臂沿 +Z 伸向肘。截面是椭圆，接缝放在臂下；rows = [z, rx, ry, cy]
function tube(fg, mat, rows, nu, tile, wrinkle = null) {
  fg.grid(mat, nu, rows.length - 1, (i, j) => {
    const [z, rx, ry, cy = -0.001] = rows[j], th = (i / nu) * Math.PI * 2 - Math.PI / 2;
    const w = wrinkle ? wrinkle(th, z) : 0;
    return { p: [(rx + w) * Math.cos(th), cy + (ry + w) * Math.sin(th), z], skin: [0, 1] };
  }, tile, true);
}

// 手套筒口的椭圆半径：腕部最细，往前臂渐粗
const cuffR = (z) => [lerp(0.0312, 0.0355, smooth(z / 0.07)), lerp(0.0226, 0.0295, smooth(z / 0.07))];
// 在筒口外面套一圈带子
const band = (z0, z1, t) => [[z0, 0], [z0 + 0.0008, t], [z1 - 0.0008, t], [z1, 0]].map(([z, d]) => {
  const [rx, ry] = cuffR(z);
  return [z, rx + d, ry + d];
});

const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };

// 七段数码：读数方向 −Z（朝手），字顶朝 −X，戴在左腕上自己看是正的
function digits(batch, mat, text, x0, y, z0) {
  const w = 0.0038, h = 0.0084, t = 0.0009;
  const at = { a: [h, w / 2, 1], g: [h / 2, w / 2, 1], d: [0, w / 2, 1], f: [h * 0.75, 0, 0], b: [h * 0.75, w, 0], e: [h * 0.25, 0, 0], c: [h * 0.25, w, 0] };
  let u = 0;
  for (const ch of text) {
    if (ch === ':') {
      for (const k of [0.3, 0.7]) batch.add(mat, box(t, 0.0003, t), xf(x0 - h * k, y, z0 - u));
      u += 0.0026;
      continue;
    }
    for (const s of SEG[ch]) {
      const [up, along, flat] = at[s];
      batch.add(mat, box(flat ? t : h / 2 - t, 0.0003, flat ? w - t : t), xf(x0 - up, y, z0 - u - along));
    }
    u += w + 0.0018;
  }
}

function watch(batch, fg, gear) {
  const z = 0.041, top = -0.001 + cuffR(z)[1];
  tube(fg, 'black', band(z - 0.0115, z + 0.0115, 0.0018), 28, 0.06);
  batch.add(gear.polymer, rbox(0.038, 0.0105, 0.042, 0.005, 3), xf(0, top + 0.0034, z), { tile: TILE.polymer });
  batch.add(gear.black, rbox(0.033, 0.0024, 0.036, 0.0012), xf(0, top + 0.0092, z), { tile: 0.06 });
  batch.add(gear.polymer, rbox(0.0365, 0.0016, 0.0395, 0.0008), xf(0, top + 0.0088, z), { tile: TILE.polymer });
  // 表冠一侧朝手
  for (const dx of [-0.009, 0.009]) {
    batch.add(gear.polymer, cyl(0.0021, 0.0021, 0.0042, 10), xf(dx, top + 0.004, z - 0.0215, Math.PI / 2), { tile: TILE.polymer });
  }
  const glow = gear.glow(0x52ff9c, 0.9);
  digits(batch, glow, '20:47', 0.0035, top + 0.0105, z + 0.0115);
  batch.add(glow, box(0.0008, 0.0003, 0.022), xf(0.0075, top + 0.0105, z));
}

// 前臂组：手套筒口（腕在里面转）、魔术贴腕带、迷彩袖子和袖口；左腕多一块表
export function buildForearm(gear, side, group) {
  const left = side === 'L', sx = left ? -1 : 1;
  const fg = new SkinGeo(), batch = new Batch();
  const zs = left ? 0.06 : 0.046;

  // 手套筒口：口沿往里卷出厚度，掌根像球窝一样塞在里面
  const cuff = [[-0.001, 0.0278, 0.0196], [-0.005, 0.03, 0.0214], [-0.0062, 0.0312, 0.0226], [-0.005, 0.0321, 0.0235]];
  for (const z of [0, 0.006, 0.014, 0.025, 0.04, zs + 0.012]) {
    const [rx, ry] = cuffR(z), k = 1 - 0.03 * Math.exp(-(((z - 0.006) / 0.006) ** 2));
    cuff.push([z, rx * k, ry * k]);
  }
  tube(fg, 'glove', cuff, 28, TILE.glove);
  // 筒口里面垫一片黑：手腕弯到头露缝时看到的是暗处而不是穿帮
  batch.add(gear.black, cyl(1, 1, 0.001, 24), xf(0, -0.001, 0.004, Math.PI / 2, 0, 0, 0.0295, 1, 0.0212));

  // 魔术贴腕带和拉片
  tube(fg, 'black', band(0.007, 0.023, 0.0013), 28, 0.06);
  const [bx, by] = cuffR(0.015), a = 2.25;
  const tab = (w, h, d, r, lift, dz, mat, tile) => batch.add(mat, rbox(w, h, d, r),
    xf(sx * (bx + lift) * Math.cos(a), -0.001 + (by + lift) * Math.sin(a), 0.015 + dz, 0, 0, sx * (a - Math.PI / 2)), { tile });
  tab(0.024, 0.0032, 0.0135, 0.0012, 0.0022, 0, gear.polymer, TILE.polymer);
  for (const dz of [-0.0036, 0, 0.0036]) tab(0.019, 0.0012, 0.0016, 0.0005, 0.0042, dz, gear.black, 0.06);

  // 袖子：袖口一圈硬边，往后是越靠袖口越密的堆褶
  const ph = left ? 1.7 : 0;
  const body = (z) => {
    const t = smooth((z - zs) / 0.26);
    return [z, lerp(0.0385, 0.054, t), lerp(0.033, 0.05, t), -0.001 - 0.004 * smooth((z - zs) / 0.2)];
  };
  const hem = (dz, d) => { const [rx, ry] = cuffR(zs + dz); return [zs + dz, rx + d, ry + d]; };
  const rows = [hem(0.004, -0.0004), hem(0.0008, 0.0016), hem(0, 0.0028), hem(0.0015, 0.0036), hem(0.026, 0.0038), hem(0.0285, 0.003)];
  for (let z = zs + 0.033; z < 0.336; z += 0.005) rows.push(body(z));
  rows.push([0.34, 0.05, 0.046, -0.005], [0.343, 0.03, 0.028, -0.005], [0.344, 0.0001, 0.0001, -0.005]);
  tube(fg, 'sleeve', rows, 30, TILE.sleeve, (th, z) => {
    if (z < zs + 0.03 || z > 0.338) return 0;
    const amp = (0.0016 + 0.0026 * Math.exp(-(z - zs) / 0.07)) * smooth((z - zs - 0.03) / 0.012);
    return amp * (0.55 * Math.sin(z * 95 + ph + 1.9 * Math.sin(th + 0.6) + 0.8 * Math.sin(2 * th))
      + 0.3 * Math.sin(z * 160 - 2.3 * Math.sin(th - 1.1 + ph)) + 0.25 * Math.sin(3 * th + z * 40 + ph));
  });
  // 袖口调节袢
  const b = 1.05, [hx, hy] = cuffR(zs + 0.0145);
  batch.add(gear.sleeve, rbox(0.03, 0.0026, 0.02, 0.001),
    xf(sx * (hx + 0.0042) * Math.cos(b), -0.001 + (hy + 0.0042) * Math.sin(b), zs + 0.0145, 0, 0, sx * (b - Math.PI / 2)), { tile: TILE.sleeve });

  if (left) watch(batch, fg, gear);
  const mats = { glove: gear.glove, black: gear.black, sleeve: gear.sleeve };
  for (const [key, geo] of fg.build()) batch.add(mats[key], geo);
  return batch.build(group, { cast: false, receive: true });
}
