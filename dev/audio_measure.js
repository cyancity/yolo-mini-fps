// 逐个音和整张表的离线测量（__audio.measureSound 等）
import { renderOffline, SOUND_NAMES, SURFACES } from '../src/audio/audio.js';
import { engine, PER_SURFACE, LONG } from './audio_common.js';
import { analyze } from './audio_dsp.js';

// 渲染 n 次取平均（每次的随机差异不同），峰值取最大。引擎已启用时量的是预渲染好的变体（实际播放的那条路），
// live 为 true 时强制现合成；indoor 是渲染时的室内程度
export async function measure(build, { n = 3, seconds = 2.5, raw = false, ambient = false, live = false, indoor = 0 } = {}) {
  const sum = { peak: 0, rms: 0, loud: 0, loudA: 0, dur: 0, centroid: 0, low: 0, mid: 0, high: 0 };
  const bank = !live && engine.bank.size ? engine.bank : undefined;
  for (let i = 0; i < n; i++) {
    const r = analyze(await renderOffline(build, { seconds, raw, ambient, bank, indoor }));
    for (const k in sum) sum[k] = k === 'peak' ? Math.max(sum[k], r[k]) : sum[k] + r[k] / n;
  }
  return sum;
}

export const measureSound = (name, { position, surface, pitch, volume, ...rest } = {}) =>
  measure((a) => a.play(name, { position, surface, pitch, volume }), { seconds: LONG[name] || 2.5, ...rest });

export const fmt = (r) => [r.peak.toFixed(3), r.rms.toFixed(4), r.loud.toFixed(3), r.loudA.toFixed(3), r.dur.toFixed(2), Math.round(r.centroid), [r.low, r.mid, r.high].map((v) => Math.round(v * 100)).join('/')];

// 每个音（带材质的每种材质一行）量一遍，返回 { 行名: 测量结果 }。names 不给就是全部
export async function measureAll({ names = SOUND_NAMES, ...rest } = {}) {
  const rows = {};
  for (const name of names) {
    for (const surface of PER_SURFACE.includes(name) ? SURFACES : [undefined]) {
      rows[surface ? `${name}:${surface}` : name] = await measureSound(name, { surface, ...rest });
    }
  }
  return rows;
}
