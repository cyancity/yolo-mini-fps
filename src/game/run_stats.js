// 本局战绩：开枪、命中、爆头击倒、存活时间和死因。暂停菜单和阵亡结算都用它（game.stats()）
export class RunStats {
  constructor() { this.reset(0); }

  // time 是游戏时间（秒，暂停时不走）
  reset(time) {
    this.start = time;
    this.end = null;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.death = null;
  }

  shot() { this.shots++; }
  hit() { this.hits++; }
  kill(headshot) { if (headshot) this.headshots++; }

  // lastHit：player.lastHit，{ kind, dist }；敌人没传 kind 时没有死因
  died(time, lastHit) {
    this.end = time;
    this.death = lastHit?.kind ? { kind: lastHit.kind, dist: lastHit.dist } : null;
  }

  snapshot(time) {
    return {
      shots: this.shots,
      hits: Math.min(this.hits, this.shots),
      headshots: this.headshots,
      time: (this.end ?? time) - this.start,
      death: this.death,
    };
  }
}
