// 成绩和查询参数的校验。只认 JSON 里的真数字，字符串 "1" 不算整数。

const TODS = new Set(['night', 'afternoon', 'day']);
export const SORTS = ['time', 'acc', 'damage'];

// 控制字符、格式字符（零宽、方向控制）、孤立代理项，外加几个显示成空白的韩文填充符
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\u115F\u1160\u3164\uFFA0]/gu;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const cents = (x) => Math.round(x * 100) / 100;

// 合法返回归一化后的名字，否则 null
export function normalizeName(v) {
  if (typeof v !== 'string' || v.length > 256) return null;
  const s = v.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  const n = [...s].length;
  return n >= 1 && n <= 12 ? s : null;
}

// 返回 { error } 或 { value }，value 里的小数已取两位
export function checkRound(b) {
  const name = normalizeName(b.name);
  if (name === null) return { error: 'name' };
  if (!isInt(b.round, 1, 50)) return { error: 'round' };
  if (!isNum(b.time, 30, 7200)) return { error: 'time' };
  if (!isNum(b.penalty, 0, b.time)) return { error: 'penalty' };
  if (!isInt(b.shots, 0, 100000)) return { error: 'shots' };
  if (!isInt(b.hits, 0, b.shots)) return { error: 'hits' };
  if (!isInt(b.kills, 10, 500)) return { error: 'kills' };
  if (!isInt(b.headshots, 0, b.kills)) return { error: 'headshots' };
  if (!isNum(b.damage, 0, 100000)) return { error: 'damage' };
  if (typeof b.tod !== 'string' || !TODS.has(b.tod)) return { error: 'tod' };
  const time = cents(b.time);
  return {
    value: {
      name,
      round: b.round,
      time,
      // 两者分别取整后罚时可能比用时多出 0.01
      penalty: Math.min(cents(b.penalty), time),
      shots: b.shots,
      hits: b.hits,
      headshots: b.headshots,
      kills: b.kills,
      damage: cents(b.damage),
      tod: b.tod,
    },
  };
}

function intParam(raw, fallback, lo, hi) {
  if (raw === null) return fallback;
  if (!/^\d{1,4}$/.test(raw)) return NaN;
  const n = Number(raw);
  return n >= lo && n <= hi ? n : NaN;
}

// params 是 URLSearchParams
export function checkBoardQuery(params) {
  const round = intParam(params.get('round'), 1, 1, 50);
  if (Number.isNaN(round)) return { error: 'round' };
  const sort = params.get('sort') ?? 'time';
  if (!SORTS.includes(sort)) return { error: 'sort' };
  const limit = intParam(params.get('limit'), 50, 1, 100);
  if (Number.isNaN(limit)) return { error: 'limit' };
  return { value: { round, sort, limit } };
}
