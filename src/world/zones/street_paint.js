import { STENCIL_FONT } from '../labels.js';

// 地面标线和喷字（画进地面喷涂图，toPx 把世界 x,z 换成像素，ppm 是每米像素）
const WHITE = 'rgb(214,214,204)', YELLOW = 'rgb(212,168,30)';

export function paintStreet(c, toPx, ppm) {
  const line = (x0, z0, x1, z1, w, color, dash = null) => {
    const [ax, ay] = toPx(x0, z0), [bx, by] = toPx(x1, z1);
    c.save();
    c.strokeStyle = color; c.lineWidth = w * ppm; c.lineCap = 'butt';
    if (dash) c.setLineDash(dash.map((d) => d * ppm));
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    c.restore();
  };
  const rect = (x0, z0, x1, z1, w, color) => {
    line(x0, z0, x1, z0, w, color); line(x1, z0, x1, z1, w, color); line(x1, z1, x0, z1, w, color); line(x0, z1, x0, z0, w, color);
  };
  const text = (str, x, z, size, color, rot = 0, font = '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif') => {
    const [px, py] = toPx(x, z);
    c.save(); c.translate(px, py); c.rotate(rot);
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${size * ppm}px ${font}`;
    // 路面字沿行车方向拉长
    c.scale(1, 2.2); c.fillText(str, 0, 0); c.restore();
  };
  // 直行箭头，dir = -1 朝北（-Z），+1 朝南；dir = 0 时按 rot 转（-π/2 朝西）
  const arrow = (x, z, dir, rot = 0) => {
    const [px, py] = toPx(x, z);
    c.save(); c.translate(px, py); c.rotate(rot); c.scale(ppm, dir ? -ppm * dir : ppm); c.fillStyle = WHITE;
    c.beginPath();
    c.moveTo(-0.12, 2.2); c.lineTo(0.12, 2.2); c.lineTo(0.12, -0.6); c.lineTo(0.42, -0.6); c.lineTo(0, -2.4); c.lineTo(-0.42, -0.6); c.lineTo(-0.12, -0.6);
    c.closePath(); c.fill(); c.restore();
  };
  const hatch = (x0, z0, x1, z1, color, step = 0.9) => {
    const [ax, ay] = toPx(x0, z0), [bx, by] = toPx(x1, z1);
    c.save(); c.beginPath(); c.rect(ax, ay, bx - ax, by - ay); c.clip();
    for (let k = -(z1 - z0); k < x1 - x0; k += step) line(x0 + k, z0, x0 + k + (z1 - z0), z1, 0.12, color);
    c.restore();
    rect(x0, z0, x1, z1, 0.15, color);
  };

  // 中线（虚线），斑马线处断开
  line(33.0, -47.0, 33.0, -0.6, 0.13, WHITE, [2, 4]);
  line(33.0, 6.6, 33.0, 17.4, 0.13, WHITE, [2, 4]);
  // 东侧车位边线和车位框
  line(36.6, -47.0, 36.6, -0.6, 0.12, WHITE);
  line(36.6, 6.6, 36.6, 17.4, 0.12, WHITE);
  for (const [a, b] of [[-19.6, -13.2], [-13.2, -6.8], [8.8, 15.2]]) rect(36.65, a, 38.75, b, 0.1, WHITE);
  // 沿西侧墙根的黄色禁停双线
  for (const [x, a, b] of [[29.55, -19.8, -0.4], [29.55, 6.4, 17.6], [30.25, -32.7, -20.2], [30.65, -47.3, -43.3], [30.65, -36.7, -33.1]]) {
    line(x, a, x, b, 0.1, YELLOW); line(x + 0.18, a, x + 0.18, b, 0.1, YELLOW);
  }
  line(38.62, -47.3, 38.62, 17.6, 0.1, YELLOW);
  // 东门前的斑马线和两侧停止线
  for (let x = 29.7; x < 38.4; x += 0.9) {
    const [ax, ay] = toPx(x, 0.4), [bx, by] = toPx(x + 0.45, 5.6);
    c.fillStyle = WHITE; c.fillRect(ax, ay, bx - ax, by - ay);
  }
  line(33.1, -1.6, 36.5, -1.6, 0.25, WHITE);
  line(29.5, 7.6, 32.9, 7.6, 0.25, WHITE);
  // 卸货场门口的网格禁停区
  hatch(30.6, -42.8, 34.2, -37.2, YELLOW, 1.1);
  text('禁止停车', 35.4, -40, 0.7, YELLOW, -Math.PI / 2);
  // 行车方向箭头和"慢"字
  arrow(34.8, -20, -1); arrow(34.8, 13.2, -1);
  arrow(31.2, -9.5, 1); arrow(31.6, -45.2, 1);
  text('慢', 34.8, 9.6, 1.6, WHITE);
  text('慢', 31.2, -5.0, 1.6, WHITE, Math.PI);
  text('港前路', 34.8, -30, 1.0, WHITE);
  // 卸货场：仓库大门前的黄色斜纹、叉车停放框、消防通道
  hatch(19.5, -35.6, 24.5, -32.95, YELLOW);
  rect(14.5, -36.15, 18.8, -34.05, 0.12, YELLOW);
  text('叉车', 16.0, -36.9, 0.55, YELLOW, 0);
  line(8.6, -37.0, 14.0, -37.0, 0.15, YELLOW);
  // 字往东挪开，不被办公楼门口的台阶压住（台阶占 x 8.4..11）
  text('消防通道 禁止占用', 13.2, -38.0, 0.5, YELLOW);
  text('FIRE LANE', 13.2, -39.3, 0.42, YELLOW, 0, STENCIL_FONT);
  line(10.6, -41.8, 10.6, -46.6, 0.12, WHITE, [0.8, 0.6]);
  // 卸货场大门进来的白色引导箭头和限速：从门口往西开进来的车看，箭头朝西，字头朝西
  arrow(27.4, -40.0, 0, -Math.PI / 2);
  text('5', 24.0, -38.6, 0.9, WHITE, -Math.PI / 2);
  const [cx, cy] = toPx(24.0, -38.6);
  c.strokeStyle = WHITE; c.lineWidth = 0.12 * ppm; c.beginPath(); c.arc(cx, cy, 0.85 * ppm, 0, Math.PI * 2); c.stroke();
}
