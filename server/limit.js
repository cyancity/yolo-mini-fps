// 按 IP 的滑动窗口限流。用上一个固定窗口的计数按剩余比例加权，近似滑动窗口：
// 每个 IP 只占一个小对象，不必记下每次请求的时间戳。

const MAX_KEYS = 20000;

// rules: { 桶名: { limit, windowMs } }
export function createLimiter(rules, { maxKeys = MAX_KEYS } = {}) {
  const buckets = new Map(Object.entries(rules).map(([k, r]) => [k, { ...r, map: new Map() }]));

  function sweep(b, now) {
    const slot = Math.floor(now / b.windowMs);
    // 两个窗口以前的计数已经不影响估算
    for (const [ip, e] of b.map) if (e.slot < slot - 1) b.map.delete(ip);
  }

  function hit(name, ip, now = Date.now()) {
    const b = buckets.get(name);
    const slot = Math.floor(now / b.windowMs);
    let e = b.map.get(ip);
    if (e) {
      b.map.delete(ip);
      if (e.slot !== slot) {
        e.prev = e.slot === slot - 1 ? e.cur : 0;
        e.cur = 0;
        e.slot = slot;
      }
    } else {
      if (b.map.size >= maxKeys) sweep(b, now);
      // 还满就丢最久没来过的（Map 按插入顺序，每次命中都挪到末尾）
      while (b.map.size >= maxKeys) b.map.delete(b.map.keys().next().value);
      e = { slot, cur: 0, prev: 0 };
    }
    b.map.set(ip, e);
    const into = (now - slot * b.windowMs) / b.windowMs;
    if (e.prev * (1 - into) + e.cur >= b.limit) return false;
    e.cur++;
    return true;
  }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const b of buckets.values()) sweep(b, now);
  }, 60_000);
  timer.unref();

  return { hit, size: () => [...buckets.values()].reduce((n, b) => n + b.map.size, 0) };
}
