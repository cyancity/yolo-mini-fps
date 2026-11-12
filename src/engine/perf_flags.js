// 性能优化的总开关，默认全开。留着是为了前后对比：每一项都能单独关掉，看它省了多少、画面变没变。
//   网址加 ?perfoff=merge,shadow 关掉指定的几项，?perfoff=all 全关；
//   运行中改 __dbg.perf.mirror = false 这样的字段也行（merge 除外：合批是建关卡时做的，只在启动时读一次）。
// 量法见 dev/README.md 的「性能测量」。
const off = new Set((new URLSearchParams(globalThis.location?.search ?? '').get('perfoff') ?? '').split(',').filter(Boolean));
const on = (k) => !(off.has('all') || off.has(k));

export const PERF = {
  // 合批：只差颜色的漆面、同贴图的材质、发光片并成共用材质（差别走顶点属性），各分区的批次合并
  merge: on('merge'),
  // 倒影：看不到地面时整遍不画，刷新率封顶
  mirror: on('mirror'),
  // 阴影：按时间预算刷新，只刷投影范围里有东西在动的灯
  shadow: on('shadow'),
  // 体积雾：步进的步数跟着视线在雾里的长度走，近处的墙和地面不再走满 22 步
  fog: on('fog'),
  // 提交：室内补光的数组按程序缓存、场景矩阵一帧只算一次、不透明物体按程序排序、没有粒子时少一遍拷贝
  submit: on('submit'),
  // 帧率无关：弹簧和玩家动力学不随帧率变（以 60 帧时的手感为准）
  step: on('step'),
};
