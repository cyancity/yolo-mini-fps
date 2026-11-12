// 键鼠输入。down = 当前按住，pressed = 本帧刚按下（endFrame 时清掉）。

// 留给浏览器的键：Esc（退出鼠标锁定，页面本来也拦不住）和 F12（开发者工具）
const KEEP = new Set(['Escape', 'F12']);
// 自动进全屏只在锁得住键盘的浏览器里做（Chrome、Edge）。内嵌在桌面程序里的网页锁不住宿主的快捷键，也不该替宿主把窗口铺满
const CAN_LOCK_KEYS = !!navigator.keyboard?.lock && !/Electron|Claude\//i.test(navigator.userAgent);
// 全屏时锁给页面的键。Esc 不锁，按一下照常退出全屏和鼠标锁定
const LOCK_CODES = [
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => `Key${c}`),
  ...[...'0123456789'].map((c) => `Digit${c}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'Tab', 'Space', 'Enter', 'Backspace', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backslash',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'Delete',
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.hit = new Set();
    this.seq = []; // 本帧刚按下的键，按先后排（同一个键一帧里按两次就出现两次）
    this.released = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.fake = false; // 调试/自动化：不需要指针锁定也接受注入的输入
    this.wantFullscreen = false; // 设置里的「全屏」：开始、继续时进全屏。F11 也改它
    this.onFullscreenWant = null;
    this.onLockChange = null;

    // 游戏进行中所有按键都自己吃掉。页面没处理的按键会回到浏览器（或内嵌网页的宿主程序）手里被当成快捷键：
    // 空格滚屏、Tab 换焦点、F5 刷新掉整局，Shift+W、E 这类单键和组合键触发宿主自己的功能
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F11') {
        e.preventDefault();
        if (!e.repeat) this.toggleFullscreen();
        return;
      }
      if (!this.active) return;
      if (!KEEP.has(e.code)) e.preventDefault();
      if (!e.repeat) this.press(e.code);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (this.active && !KEEP.has(e.code)) e.preventDefault();
      this.release(e.code);
    }, true);
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      // 中键的自动滚动、侧键的前进后退也是浏览器的快捷操作
      if (e.button > 0) e.preventDefault();
      this.press(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => {
      if (this.locked && e.button > 0) e.preventDefault();
      this.release(`Mouse${e.button}`);
    });
    document.addEventListener('auxclick', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault(); // Ctrl + 滚轮会缩放页面
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('fullscreenchange', () => {
      // 全屏时把键盘也锁给页面：Ctrl+W、Ctrl+T、Ctrl+N 这类浏览器保留的快捷键只有这样才拦得住
      const kb = navigator.keyboard;
      if (kb?.lock) {
        if (document.fullscreenElement) kb.lock(LOCK_CODES).catch(() => {});
        else kb.unlock();
      }
      // 本该全屏的时候全屏没了（按了 Esc）：一并放开鼠标，游戏随之暂停。不然 Ctrl 蹲着往前走就是 Ctrl+W
      if (!document.fullscreenElement && this.wantFullscreen && this.locked) this.unlock();
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  get active() { return this.locked || this.fake; }

  // F11：由页面自己进全屏。浏览器自带的 F11 全屏锁不了键盘
  async toggleFullscreen() {
    const on = !document.fullscreenElement;
    this.wantFullscreen = on;
    this.onFullscreenWant?.(on);
    try {
      if (on) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else await document.exitFullscreen();
    } catch {
      // 宿主不允许全屏
      this.wantFullscreen = false;
      this.onFullscreenWant?.(false);
    }
  }

  // 设置里开关「全屏」：开的话下次开始或继续时进，关的话立刻退
  setFullscreen(on) {
    this.wantFullscreen = on;
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  async lock() {
    // 按 Esc 暂停会连全屏一起退出，继续时一并恢复
    if (this.wantFullscreen && CAN_LOCK_KEYS && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    try {
      // 关闭系统鼠标加速，瞄准手感更稳；不支持的浏览器退回普通锁定
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { await this.canvas.requestPointerLock(); } catch { /* 用户取消或被浏览器拒绝 */ }
    }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  press(code) {
    if (!this.keys.has(code)) { this.hit.add(code); this.seq.push(code); }
    this.keys.add(code);
  }
  release(code) { if (this.keys.delete(code)) this.released.add(code); }
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.hit.has(code); }
  wasReleased(code) { return this.released.has(code); }

  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }

  endFrame() {
    this.hit.clear();
    this.seq.length = 0;
    this.released.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
