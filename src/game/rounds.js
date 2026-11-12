// 轮次：沿 ROUTE 清完一圈（五个区域）算一轮，打完不停，直接进下一轮。每轮单独记一份成绩报给排行榜（board.js）：
// 用时、命中、掉血。敌人的人数和等级跟着目标序号涨（game.js 的 guards 和 level），所以轮次越高越难；
// 第 MISS_FROM 轮起步枪每打空一发，这一轮的用时加 MISS_PENALTY 秒
export const MISS_FROM = 2;
export const MISS_PENALTY = 0.3;

export class Rounds {
  constructor() {
    this.now = { round: 1, time: 0, penalty: 0, shots: 0, hits: 0, headshots: 0, kills: 0, damage: 0 };
    this.reset(0);
  }

  // time 是游戏时间（秒，暂停时不走）
  reset(time) {
    this.n = 1;
    this.at = time;
    this.shots = this.hits = this.headshots = this.kills = 0; // 这一轮开始时全局累计到多少
    this.damage = 0;
    this.done = [];
  }

  // 掉血：amount 是这一下实际扣掉的血量
  hurt(amount) { this.damage += amount; }

  // 当前这一轮到现在的成绩。run 是 RunStats（整局累计），kills 是整局击倒数。每帧都调，写进同一个对象
  live(time, run, kills) {
    const o = this.now;
    o.round = this.n;
    o.shots = run.shots - this.shots;
    o.hits = Math.min(run.hits - this.hits, o.shots);
    o.headshots = run.headshots - this.headshots;
    o.kills = kills - this.kills;
    o.damage = this.damage;
    o.penalty = this.n >= MISS_FROM ? (o.shots - o.hits) * MISS_PENALTY : 0;
    o.time = time - this.at + o.penalty;
    return o;
  }

  // 这一轮打完：记下成绩，下一轮从这一刻起算
  close(time, run, kills) {
    const r = { ...this.live(time, run, kills) };
    this.done.push(r);
    this.n++;
    this.at = time;
    this.shots = run.shots;
    this.hits = run.hits;
    this.headshots = run.headshots;
    this.kills = kills;
    this.damage = 0;
    return r;
  }
}
