// 敌人杀伤力和公平感的数字集中在这里。士兵和无人机都读这一个对象，game.soldiers.tune 和 game.drones.tune 指向它，
// 控制台里改了立刻生效（新开的点射、新算的反应时间起用）。以后做难度选项就是整体换一组数。
// 手感目标见 soldiers_gun.js 顶上的注释，量法和复跑入口是 dev/tune_measure.js（用法写在它开头）。
// 下面的“波”就是敌人的 level（game.js 用区域目标的序号当 level，第 1 个目标是第 1 波）。
export const TUNE = {
  // ---- 血量：不随 level 涨。步枪打武装人员一发 36（rifle.js 的 DAMAGE_SOLDIER），部位倍率头 4、躯干 1、四肢 0.7
  // （soldiers.js 的 hit）：躯干 3 发、四肢 4 发、爆头 1 发；爪刀轻击 55、重击 140
  soldierHp: 100,

  // ---- 驻守（soldiers_guard.js）：区域目标的敌人守在自己的区域里，不上门找人
  guardNear: 12, // 离玩家不到这么远（米）的出生点不用；玩家看得见的也不用
  guardRoam: 4, // 站岗时在岗位周围这么多米内走动
  guardHear: 20, // 站岗的人只对这么近的枪声有反应（已经警觉的照常按 45 米听）
  guardSearch: 15, // 丢了玩家、搜索这么多秒还没找到就回岗位

  // ---- 开火名额（同时允许点射的士兵数）
  shooters1: 1, // 第 1 波
  shootersMid: 2, // 第 2 波到 shootersLateFrom 之前
  shootersLateFrom: 7, // 从这一波起用 shootersLate
  shootersLate: 3,
  pressureFrom: 3, // 从这一波起，玩家站在明处会多放一个人开火（加上以后不超过 shootersCap）
  pressureSeen: 2, // 至少这么多人同时看见玩家胸口才算“站在明处”
  pressureT: 2, // 连续站在明处这么多秒才多放一个
  shootersCap: 3, // 同时开火的上限：第 7 波起名额已经是 3 个，站在明处也不再多放
  tokenHold: 4.5, // 一个名额最多拿这么多秒就让出来
  tokenBursts: 3, // 打满这么多轮点射让出来
  tokenIdle: 2.5, // 拿到名额这么多秒一轮都没打出去（被队友挡、枪口对不上、蹲着）就让出来

  // ---- 交火站位
  keepDist: 8, // 换位选点离玩家最后出现处的最近距离（米）：更近的格子重罚，推到几米内能从掩体侧面看见人

  // ---- 交战分工（soldiers_roles.js）：突击手往前压、绕侧翼；其余是压制手，守在交战距离上的掩体后探头点射
  assault: [1, 1, 2, 2, 2, 3], // 每波的突击手人数（第 1 波起，之后都取最后一个）
  supportDist: [13, 18], // 压制手的交战距离（米，每人随机一个）：在这个距离上找能打到玩家最后位置的掩体
  supportHold: [4, 7], // 压制手蹲守多久没轮到名额就在附近换一处掩体（秒）
  supportShift: 40, // 换掩体时相对玩家的方位角最多变这么多（度）；离最初的方位也不超过这么多，不绕圈
  supportLost: 6, // 全队这么多秒没看见玩家，压制手的交战距离开始收
  supportCreep: 1, // 每秒收多少米，收到 keepDist 为止；重新看见就恢复
  supportSearch: 4, // 收到 keepDist 以后再这么多秒还没看见，转入搜索（突击手是 searchAfter，压制手晚得多）
  searchAfter: 11, // 突击手：全队这么多秒没看见玩家，去他最后出现的地方找（搜索状态）。躲好的掩体中位撑 12 秒以上靠它
  creepAfter: 2, // 全队这么多秒没看见玩家（躲到掩体后了）：掩体后的人蹲守计时按 creepRate 走，探头扑空不马上换位；
  creepRate: 0.5, // 突击手不再往前压，压到一半的就近找掩体停下（soldiers_tactics.js 的 combat）
  promoteAfter: 8, // 突击手全死以后过这么多秒，从压制手里挑离玩家最近的一个补上

  // ---- 反应时间（秒，看见到能开火）
  reactMin: 0.15, // 短暂丢失（不到 reacqLost）、看见的累计时间已经衰减到 0 时的下限（soldier_ai.js 的 reactionTime）
  reacqLost: 1, // 丢失视线超过这么久再看见，按“重新捕获”算，交火中也要等。第一次发现也算这种（lostT 初值 99），不随状态和波次变快
  reacqNear: 0.5, // 重新捕获的反应时间：贴脸时
  reacqFar: 0.9, // 重新捕获的反应时间：reacqDist 米及更远时
  reacqDist: 30,
  reacqJitter: [0.9, 1.15], // 重新捕获的随机系数（15~20 米约 0.6~0.86 秒）

  // ---- 首轮打偏（系统误差，单位米，往目标身上走）
  freshLost: 1.5, // 丢失视线超过这么久再看见，第一轮重新带大误差
  freshMove: 2.5, // 或者玩家挪了这么远
  errSide: [0.8, 1.5], // 第一轮的横向误差范围
  errUp: [-0.3, 0.6], // 第一轮的竖向误差范围
  errDecay: [1, 0.45, 0.25], // 第 1、2、3 轮以后的误差系数（中弹一次退回一级）
  errWalk: 0.8, // 一轮里每发误差乘这个数：打出去是往人身上“走”的

  // ---- 散布（弧度，高斯近似的标准差）
  spreadBase: 0.02, // 基础散布
  spreadSelfMove: 0.03, // 自己跑动（满速 3 m/s）
  spreadTarget: 0.02, // 玩家跑动（按 6.3 m/s 归一）
  spreadShot: 0.0025, // 一轮里每多打一发
  spreadDist: 0.00018, // 每米距离
  trackLag: [0.18, 0.34], // 跟枪滞后（秒）：瞄准点落在玩家速度方向的后面这么久，每轮随机一次
  levelStep: 0.02, // 每波精度提高（散布系数减少），反应时间也按它缩短
  levelFloor: 0.75, // 等级带来的精度和点射间隔加成的下限（系数最低到这里）

  // ---- 点射节奏
  burstMin: 3, // 一轮最少几发
  burstMax: 5, // 一轮最多几发
  burstGap: [0.7, 1.1], // 两轮之间的间隔（秒，再乘等级系数）
  coolStep: 0.02, // 每波间隔缩短的比例

  // ---- 伤害（玩家 100 血）
  soldierDmg: [6, 8], // 士兵每发
  soldierDmgStep: 0.03, // 每波加成
  soldierDmgCap: 1.25, // 加成封顶倍率
  droneDmg: [3, 5], // 无人机每发

  // ---- 无人机
  droneFrom: 4, // 从第几个区域目标起配无人机（只有露天区域配，哪些区域见 drones.js 的 HOME）
  droneTwoFrom: 9, // 从第几个目标起一次两架，之前一架
  droneForget: 6, // 守区域的无人机这么多秒看不见玩家就回区域上空巡逻，不追出去
  droneAlert: 4, // 挨打以后这么多秒内知道开枪的人在哪
  droneJinkGap: [2.2, 4], // 两次横移闪避之间隔多久（秒）；预警和点射时不闪
  droneAttackersFrom: 99, // 从这一级起同时可以有 2 架在预警或点射，之前 1 架（现在最多两架，一直只放一架开火）
  droneWarn: 0.7, // 开火前的预警（秒）
  droneErr: 0.04, // 每轮点射的随机瞄准误差（每米距离多少米，整轮共用一个偏移：整轮打中或整轮擦过）
  droneErrMin: 0.42, // 瞄准误差的下限（米）：无人机自己选的悬停距离只有 7~15 米，只按距离算近处几乎发发命中
  droneErrMove: 0.6, // 玩家跑动（按 6.3 m/s 归一）时整轮的瞄准误差再放大这么多
  droneSpreadMove: 1.5, // 玩家跑动时每发的散布再放大这么多：一轮扫过去时跑进弹道的人不会被整轮打中
  droneCool: 3, // 同一架两次点射的间隔再乘几倍（乘 drone_nav 的 cooldown）
  droneInterval: 1.8, // 全队相邻两次点射的最小间隔再乘几倍（乘 drone_nav 的 interval）：架数多时总火力由它封顶
  droneLeave: 40, // 连续这么多秒看不见玩家就撤离（爬高飞出地图后回收，不算击杀）：玩家躲进无人机进不去的地方时这个区域照样能清完。守区域的要先见过玩家才开始算
  droneLead: 0.8, // 提前量再打几折（乘 drone_nav 的 lead）：横移的人更难打
  droneLag: 1.6, // 瞄准点跟随的时间常数再乘几倍（乘 drone_nav 的 lag）
};
