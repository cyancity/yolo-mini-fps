// 雨夜天空和路面的量法。开发服务器上的游戏页里加载：await import('/dev/rain_measure.js?v=' + Date.now())
// __rm.setup('night') 进练习场并切时段（不存档）；__rm.shot(x, z, yaw, pitch, y) 摆机位渲染并返回亮度统计；
// __rm.col(px) 返回最近一次 shot 在第 px 列（画布像素）从中线往下的亮度分布
(() => {
  const d = window.__dbg;
  let last = null;
  const luma = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
  window.__rm = {
    async setup(tod) {
      if (!d.game.mode || d.game.state !== 'playing') d.play('range');
      d.god(true);
      d.game.applySetting('timeOfDay', tod);
      d.frame(60);
      d.camera.children[0].visible = false;
      d.freeze(true);
      return { tod: d.tod.name, rain: d.tod.rain, uRain: d.sky?.material?.uniforms?.uRain?.value, q: d.game.quality };
    },
    shot(x, z, yaw, pitch, y = 0, n = 10) {
      d.view(x, z, yaw, pitch, y);
      d.step(1 / 60);
      d.frame(n);
      const r = d.pipeline.renderer, gl = r.getContext();
      r.setRenderTarget(null);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const p = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
      last = { w, h, p };
      let sum = 0, dark = 0, low = 0, lowN = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const l = luma(p, (yy * w + xx) * 4);
        sum += l; if (l < 20) dark++;
        if (yy < h * 0.4) { low += l; lowN++; }
      }
      // 下部 40%（路面）每一列的平均亮度，找最亮的几列（灯的倒影）
      const cols = [];
      for (let xx = 0; xx < w; xx += 2) {
        let s = 0;
        for (let yy = 0; yy < h * 0.4; yy += 2) s += luma(p, (yy * w + xx) * 4);
        cols.push([xx, s / (h * 0.2)]);
      }
      const colMean = cols.reduce((a, c) => a + c[1], 0) / cols.length;
      const colSd = Math.sqrt(cols.reduce((a, c) => a + (c[1] - colMean) ** 2, 0) / cols.length);
      return { w, h, mean: +(sum / (w * h)).toFixed(2), dark: +(dark / (w * h) * 100).toFixed(1), lowMean: +(low / lowN).toFixed(2), colSd: +colSd.toFixed(2), top: cols.sort((a, b) => b[1] - a[1]).slice(0, 4).map((c) => [c[0], +c[1].toFixed(1)]) };
    },
    // 第 px 列，从画面中线往下（gl 行号从下往上），每 step 行取一次
    col(px, step = 12) {
      const { w, h, p } = last, out = [];
      for (let yy = Math.floor(h / 2); yy >= 0; yy -= step) {
        let s = 0;
        for (let dx = -2; dx <= 2; dx++) s += luma(p, (yy * w + Math.min(w - 1, Math.max(0, px + dx))) * 4);
        out.push(Math.round(s / 5));
      }
      return out.join(' ');
    },
    // 天空区域（上部 30%）的平均颜色
    sky() {
      const { w, h, p } = last; let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(h * 0.7); yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) { const i = (yy * w + xx) * 4; r += p[i]; g += p[i + 1]; b += p[i + 2]; n++; }
      return [r / n, g / n, b / n].map((v) => +v.toFixed(1));
    },
    programs() { return d.pipeline.renderer.info.programs.length; },
  };
})();
// A/B：__ab(true) 退回改前的样子（地面 uWetRain 0、不涨水，夜空不下雨并重烤），__ab(false) 是改后
(() => {
  const d = window.__dbg, g = d.level.ground, sky = d.sky;
  const orig = g.syncWet, shown = sky.rainShown;
  g.syncWet = function () { orig.call(this); if (window.__A) { this.uniforms.uWetRain.value = 0; this.uniforms.uPuddle.value = this.wet.puddle; } };
  window.__ab = (old) => { window.__A = old; sky.rainShown = old ? () => false : shown; sky.update(0); g.syncWet(); return sky.material.uniforms.uRain.value; };
})();
