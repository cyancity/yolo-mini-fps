// 原创 5.56 卡宾枪「KR-7」的程序化模型。
// 坐标：枪口朝 -Z，+Y 向上，+X 是抛壳口一侧；原点在枪管轴线上、上机匣后端面。单位米。
import * as THREE from 'three';
import { makeKit } from './rifle_kit.js';
import { makeMarkings } from './rifle_marks.js';
import { buildReceiver, buildChargingHandle, buildBolt, buildTrigger, buildSelector, PORT, PIVOT } from './rifle_receiver.js';
import { buildFront, MUZZLE_Z, FOREGRIP } from './rifle_front.js';
import { buildFurniture, buildMag, GRIP_WEB, MAG_TOP, MAG_HOLD } from './rifle_furniture.js';
import { buildIrons, SIGHT } from './rifle_optics.js';
import { buildLowerRiser, buildUpperRiser } from './rifle_risers.js';
import { buildSight, lensMaterials } from './rifle_sight.js';
import { buildLaser, LASER } from './rifle_lasermod.js';
import { buildStock } from './rifle_stock.js';

const AIM_BACK = 0.14; // 开镜到位时枪托一组顺着枪轴往后收多少

// 返回 { root, parts, anchors, sight, setAim }。活动件的原点和行程：
//   mag            匣口顶面中心；换弹时沿自身 -Y 抽出
//   chargingHandle 机匣后端面处的柄头中心；后拉 +Z 0.07
//   bolt           闭锁时的机头端面中心；后坐 +Z 0.08
//   trigger        扳机销；扣动是绕自身 X 轴转负角（约 -0.2）
//   selector       快慢机轴；rotation.x = 0 是 AUTO（拨杆朝前），+1.2 是 SEMI，+2.4 是 SAFE
// 锚点：sight 是光轴穿过镜片的点；laser 是镭射出光口，-Z 是光束方向（和枪管平行）；
// magHold 挂在弹匣上（左手捏弹匣的位置），boltCatch 是左手拍空仓挂机时掌心贴的位置
export function buildRifle(gear) {
  const root = new THREE.Group();
  root.name = 'rifle';
  const body = makeKit(gear, [0, 0, 0], { decal: gear.decal(makeMarkings()), ledR: gear.glow(0xff3a22, 3), ...lensMaterials(gear) });
  buildReceiver(body);
  buildFront(body);
  buildFurniture(body);
  buildIrons(body);
  buildLowerRiser(body);
  buildUpperRiser(body);
  buildLaser(body);
  buildSight(body);
  root.add(body.finish('rifle.body'));
  // 缓冲管和枪托单独一组，开镜时整组收走
  const rear = makeKit(gear, [0, 0, 0]);
  buildStock(rear);
  root.add(rear.finish('rifle.stock'));

  const part = (name, origin, build) => {
    const k = makeKit(gear, origin);
    build(k);
    root.add(k.finish('rifle.' + name));
    return k.group;
  };
  const parts = {
    mag: part('mag', MAG_TOP, buildMag),
    chargingHandle: part('chargingHandle', PIVOT.handle, buildChargingHandle),
    bolt: part('bolt', PIVOT.bolt, buildBolt),
    trigger: part('trigger', PIVOT.trigger, buildTrigger),
    selector: part('selector', PIVOT.selector, buildSelector),
  };

  const anchor = (name, [x, y, z], parent = root, rot = null) => {
    const o = new THREE.Object3D();
    o.name = 'rifle.' + name;
    o.position.set(x, y, z);
    if (rot) o.rotation.set(rot[0], rot[1], rot[2], 'YXZ');
    parent.add(o);
    return o;
  };
  const anchors = {
    muzzle: anchor('muzzle', [0, 0, MUZZLE_Z]),
    eject: anchor('eject', [0.0142, (PORT.yb + PORT.yt) / 2, (PORT.z0 + PORT.z1) / 2]),
    sight: anchor('sight', SIGHT.pos),
    laser: anchor('laser', LASER),
    gripR: anchor('gripR', GRIP_WEB),
    gripL: anchor('gripL', FOREGRIP),
    magHold: anchor('magHold', MAG_HOLD.pos, parts.mag, MAG_HOLD.rot),
    // 掌心朝 +X 拍在左侧拨片上，四指朝前上方
    boltCatch: anchor('boltCatch', [-0.0172, -0.012, -0.066], root, [0, -Math.PI / 2, -0.35]),
  };
  // ads 是开镜程度 0..1。开镜的眼位在机匣后端上方，枪托一组本来就在画面下沿以外；到位前的最后一小段
  // 再把它顺着枪轴往后收、到位后不画，后坐力把枪往上顶时也露不出来。收的时候它不在画面里，没有哪一帧是突然消失的
  const setAim = (ads) => {
    const t = Math.min(1, Math.max(0, (ads - 0.7) / 0.28)), s = t * t * (3 - 2 * t);
    rear.group.position.z = AIM_BACK * s;
    rear.group.visible = s < 1;
  };
  return { root, parts, anchors, sight: SIGHT, setAim };
}
