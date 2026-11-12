// 枪身刻字：全部画进一张图集，贴花四边形各取一格
import { canvasTexture, xf } from '../gfx/geo.js';
import { decalQuad } from './rifle_kit.js';

const TEX_W = 1024, TEX_H = 512;
const CELL = {
  main: [0, 0, 560, 330], safe: [580, 4, 150, 56], semi: [580, 64, 150, 56], auto: [580, 124, 150, 56],
  cal: [580, 190, 420, 56], logo: [580, 256, 260, 180], optic: [0, 340, 300, 70], laser: [0, 420, 300, 84],
  up: [320, 340, 150, 70], bat: [320, 420, 230, 60],
};
const FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif';

export function makeMarkings() {
  return canvasTexture(TEX_W, TEX_H, (ctx) => {
    ctx.fillStyle = 'rgba(208, 212, 216, 0.92)';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.textBaseline = 'middle';
    const text = (str, x, y, px, weight = 600, align = 'left') => {
      ctx.font = `${weight} ${px}px ${FONT}`;
      ctx.textAlign = align;
      ctx.fillText(str, x, y);
    };
    const centered = (name, str, px, weight) => {
      const [x, y, w, h] = CELL[name];
      text(str, x + w / 2, y + h / 2 + px * 0.06, px, weight, 'center');
    };
    text('KR-7', 6, 68, 122, 700);
    ctx.fillRect(6, 134, 330, 5);
    text('CAL 5.56', 6, 178, 50);
    text('DZ ARMORY', 6, 234, 50);
    text('SN 0481', 6, 290, 50);
    // 序列号旁的点阵码，纯装饰
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        if (i === 0 || j === 8 || (i * 7 + j * 13 + i * j) % 3 === 0) ctx.fillRect(400 + i * 15, 164 + j * 15, 13, 13);
      }
    }
    centered('safe', 'SAFE', 46);
    centered('semi', 'SEMI', 46);
    centered('auto', 'AUTO', 46);
    centered('cal', '5.56x45  1:7  MP', 40, 500);
    const [lx, ly] = CELL.logo;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(lx + 130, ly + 8);
    ctx.lineTo(lx + 236, ly + 72);
    ctx.lineTo(lx + 130, ly + 136);
    ctx.lineTo(lx + 24, ly + 72);
    ctx.closePath();
    ctx.stroke();
    text('DZ', lx + 130, ly + 76, 62, 700, 'center');
    text('ARMORY', lx + 130, ly + 160, 30, 600, 'center');
    // 瞄具侧面只印红点规格，不印厂牌
    centered('optic', '4 MRAD DOT', 40);
    centered('up', 'UP ▲', 44);
    centered('bat', 'CR2032  3V', 34, 500);
    const [ax, ay] = CELL.laser;
    text('DZ-LM1', ax + 6, ay + 24, 40, 700);
    text('LASER  CLASS 3R', ax + 6, ay + 64, 26, 500);
  });
}

const size = (name, h) => [(h * CELL[name][2]) / CELL[name][3], h];
const quad = (name, h) => decalQuad(...size(name, h), CELL[name], TEX_W, TEX_H);

// 贴在侧面：x 的正负决定朝左还是朝右，两侧文字都从左往右读
export function markSide(k, name, h, x, y, z) {
  const s = Math.sign(x);
  k.decal(quad(name, h), xf(x + s * 0.00015, y, z, 0, (s * Math.PI) / 2, 0));
}

// 贴在顶面，字头朝枪口，射手从后面看是正的
export const markTop = (k, name, h, x, y, z) => k.decal(quad(name, h), xf(x, y + 0.00015, z, -Math.PI / 2, 0, 0));

// 任意朝向：四边形默认朝 +Z、字头朝 +Y，由调用方给矩阵
export const mark = (k, name, h, matrix) => k.decal(quad(name, h), matrix);
