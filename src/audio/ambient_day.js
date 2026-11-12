// 分时段的环境声层和室内底噪。startAmbient 调这里的 dayNight / roomTone 往声底里加层；
// 海鸥和旗绳是偶发事件，引擎的定时器按时段随机触发（见 audio_world.js）。
import { rnd, pick } from './synth.js';

// 白天和夜里各一组闸门，开度由引擎的 setTimeOfDay 推（同雨声的 b.rain）。
// 白天：远处城市道路的车流（窄带的粉噪，有车经过时慢慢鼓起来）；夜里：高杆灯镇流器的嗡声，隔着半个堆场传过来
export function dayNight(b, dest) {
  const on = { dur: Infinity };
  const day = b.gain(0), night = b.gain(0);
  day.connect(dest);
  night.connect(dest);
  b.dest = day;
  for (const side of [-1, 1]) {
    const g = b.gain(0.17);
    b.wobble(g.gain, 0.25, 0.12, on); // 车一辆一辆过去，不是一条平的噪声
    const bp = b.filter('bandpass', side < 0 ? 320 : 410, 1.4);
    b.mod(bp.frequency, rnd(0.03, 0.06), 60, on);
    b.out(b.chain(b.noise('pink', { dur: Infinity, rate: side < 0 ? 0.77 : 0.83 }), bp, b.filter('lowpass', 900, 0), g), 1, side * 0.7);
  }
  b.out(b.chain(b.noise('brown', { dur: Infinity, rate: 0.6 }), b.filter('bandpass', 95, 1.2), b.gain(0.22))); // 重车的低频
  b.dest = night;
  const hum = b.gain(1);
  b.mod(hum.gain, 0.07, 0.25, on);
  for (const [k, level] of [[1, 0.012], [2, 0.016], [3, 0.01], [5, 0.005]]) b.chain(b.osc('sine', 100 * k * rnd(0.998, 1.002), on), b.gain(level), hum);
  b.out(hum, 1, 0.35);
  const buzz = b.gain(0.006);
  b.mod(buzz.gain, rnd(0.2, 0.5), 0.004, on);
  b.out(b.chain(b.osc('sawtooth', 100, on), b.filter('bandpass', 1900, 3), buzz), 1, -0.3);
  b.dest = dest;
  b.day = [day.gain];
  b.night = [night.gain];
}

// 室内底噪：通风管道的低频气流加一点很轻的高频嘶声。接在只有室内才推上来的 tone 总线上
export function roomTone(b, tone) {
  const on = { dur: Infinity }, dest = b.dest;
  b.dest = tone;
  const g = b.gain(0.14);
  b.mod(g.gain, 0.04, 0.025, on);
  b.out(b.chain(b.noise('brown', { dur: Infinity, rate: 0.8 }), b.filter('lowpass', 85, 0.7), g));
  b.out(b.chain(b.noise('pink', { dur: Infinity, rate: 0.95 }), b.filter('bandpass', 180, 1.5), b.gain(0.03)));
  b.out(b.chain(b.noise('white', { dur: Infinity }), b.filter('bandpass', 3200, 0.8), b.gain(0.0045)), 1, 0.2);
  b.out(b.chain(b.osc('sine', 120, on), b.gain(0.004)));
  b.dest = dest;
}

// 远处的海鸥：两三声往上挑再落下来的叫声。锯齿过两个带通当“嗓子”，音高带一点颤
export function gull(b, o) {
  const calls = 2 + ((Math.random() * 3) | 0), side = rnd(-0.8, 0.8), f0 = rnd(700, 900) * o.pitch;
  let at = 0;
  for (let i = 0; i < calls; i++) {
    const dur = rnd(0.18, 0.32), f = f0 * rnd(0.92, 1.08), top = f * rnd(1.6, 1.9);
    const s = b.osc('sawtooth', f, { at, dur });
    b.env(s.frequency, [[at, f], [at + dur * 0.35, top], [at + dur, f * 0.9]], true);
    b.mod(s.frequency, rnd(28, 40), f * 0.03, { at, dur });
    const g = b.gain(0);
    b.env(g.gain, [[at, 0], [at + 0.03, 0.5], [at + dur * 0.5, 0.35], [at + dur, 0]]);
    const voice = b.chain(s, b.filter('bandpass', 1800, 2.5), g);
    b.out(voice, 1, side);
    b.out(b.chain(voice, b.filter('bandpass', 3300, 4)), 0.5, side);
    at += dur + rnd(0.08, 0.3);
  }
}

// 旗绳和钢缆被风甩在旗杆上：几下又轻又亮的“叮”，忽快忽慢
export function halyard(b, o) {
  const n = 2 + ((Math.random() * 4) | 0), side = rnd(-0.7, 0.7), f = pick([1900, 2150, 2400]) * o.pitch;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const k = rnd(0.5, 1);
    b.burst('white', { freq: 3200, q: 2, peak: 0.25 * k, tau: 0.003, at, panTo: side });
    b.partials(f * rnd(0.97, 1.03), [1, 2.76, 5.4], { peak: 0.12 * k, tau: 0.09, at, panTo: side });
    at += rnd(0.15, 0.6);
  }
}
