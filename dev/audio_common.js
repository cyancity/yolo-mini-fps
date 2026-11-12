// 试听页和测量共用的东西：同一个引擎实例、一些放音的片段
import { AudioEngine, SURFACES } from '../src/audio/audio.js';

export const engine = new AudioEngine();
export const PER_SURFACE = ['footstep', 'land', 'slide', 'npcStep', 'magDrop'];
export const LONG = { ambThunder: 9, ambHorn: 6, ambClang: 5, droneExplode: 4.5, smokeBurst: 3.5, rifleShot: 3.5, npcShot: 3.5, waveStart: 3.5, waveClear: 3.5, playerDeath: 3.5, ambGull: 4, ambHalyard: 4 };

// 最吃总线的一刻：自己全自动连发，同时三个敌人开火，再炸一架无人机。near 时全部贴在参考距离以内（最响）
export function firefight(a, near = false) {
  const at = near ? [[3, -3], [-4, -2], [2, 5], [0, -6]] : [[9, -8], [-14, -14], [4, 30], [3, -9]];
  for (let i = 0; i < 12; i++) a.play('rifleShot', { delay: i * 0.092, volume: 0.9 });
  [0.15, 0.33, 0.52].forEach((delay, i) => a.play('npcShot', { position: { x: at[i][0], y: 1.6, z: at[i][1] }, delay }));
  a.play('droneExplode', { position: { x: at[3][0], y: 4, z: at[3][1] }, delay: 0.4 });
}

// 连着切枪：切出去、按回来交替，音高和音量照 weapons.js 里的两处调用
export function flick(a, rate = 12, seconds = 2) {
  for (let i = 0; i < rate * seconds; i++) a.play('weaponSwitch', i % 2 ? { delay: i / rate, volume: 0.5, pitch: 1.08 } : { delay: i / rate, volume: 0.55 });
}
