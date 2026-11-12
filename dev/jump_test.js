// 跳跃实操。开发服务器上的游戏页里加载：await import('/dev/jump_test.js?v=' + Date.now())
// __jt 单次起跳，__scanRun 对一组矮件 16 个朝向逐个试跳，结果在 window.__scan
(() => {
  const D = __dbg, I = D.input, p = D.player;
  // yaw：0 朝 -z（北），90 朝 -x（西），180 朝 +z，-90 朝 +x
  window.__jt = async function (x, y, z, yaw, { sprint = true, jumpAt = [0], frames = 50, dashAt = -1 } = {}) {
    D.view(x, z, yaw, 0, y); p.sprintLatch = false; await D.frame(3);
    I.press('KeyW');
    if (sprint) { I.press('ShiftLeft'); await D.frame(1); I.release('ShiftLeft'); }
    let maxG = -1, maxY = -1;
    for (let f = 0; f < frames; f++) {
      if (jumpAt.includes(f)) I.press('Space');
      if (f === dashAt) I.press('KeyV');
      await D.frame(1);
      if (jumpAt.includes(f)) I.release('Space');
      if (f === dashAt) I.release('KeyV');
      if (p.grounded) maxG = Math.max(maxG, p.position.y);
      maxY = Math.max(maxY, p.position.y);
    }
    I.release('KeyW');
    for (let f = 0; f < 30; f++) await D.frame(1);
    const q = p.position;
    return { maxG: +maxG.toFixed(2), maxY: +maxY.toFixed(2), end: [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)] };
  };
  window.__scanRun = async (lows, opt, backs = [0, 0.35]) => {
    window.__scan = { done: false, res: {} };
    for (const [x, z, top] of lows) {
      let worst = { maxG: 0 };
      for (let s = 0; s < 16; s++) {
        const yaw = s * 22.5, a = (yaw * Math.PI) / 180;
        for (const back of backs) {
          const r = await __jt(x + Math.sin(a) * back, top ?? 1.1, z + Math.cos(a) * back, yaw, opt);
          if (r.maxG > worst.maxG) worst = { ...r, yaw, back };
          if (r.end[2] > 20.42 && z > 15) window.__scan.res['escape ' + x + ',' + z + ',' + yaw] = r;
        }
      }
      window.__scan.res[x + ',' + z] = worst;
    }
    window.__scan.done = true;
  };
})();
