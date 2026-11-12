import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeAOMaterial, makeBlurMaterial } from './post_ao.js';
import { makeFogMaterial, updateFogLights, FOG_STEP_LEN } from './post_fog.js';
import { makeCompositeMaterial, makeTAAMaterial, makeCopyMaterial } from './post_taa.js';
import { makeBloomDownMaterial, makeBloomUpMaterial, makeFinalMaterial } from './post_final.js';
import { PERF } from './perf_flags.js';

const HALTON = [
  [1 / 2, 1 / 3], [1 / 4, 2 / 3], [3 / 4, 1 / 9], [1 / 8, 4 / 9],
  [5 / 8, 7 / 9], [3 / 8, 2 / 9], [7 / 8, 5 / 9], [1 / 16, 8 / 9],
].map(([x, y]) => [x - 0.5, y - 0.5]);
const BLOOM_LEVELS = 6;

// 帧流程：阴影 → 水面镜像 → 主场景(HDR+深度) → AO/体积雾(半分辨率) → 合成 → TAA
//        → 特效层(TAA 之后，保持锐利) → 泛光 → 输出
export class Pipeline {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;

    this.settings = { scale: 1, maxPixelRatio: 1, taa: true, ao: true, fog: true };
    this.quad = new FullScreenQuad();
    this.mat = {
      ao: makeAOMaterial(), blur: makeBlurMaterial(), fog: makeFogMaterial(),
      composite: makeCompositeMaterial(), taa: makeTAAMaterial(), copy: makeCopyMaterial(),
      down: makeBloomDownMaterial(), up: makeBloomUpMaterial(), final: makeFinalMaterial(),
    };
    this.final = this.mat.final.uniforms;
    this.fogLights = [];
    this.vmProjection = { value: new THREE.Matrix4() };
    this.vmFov = 55;
    this.fxUniforms = {
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.03 },
      uFar: { value: 600 },
    };
    this.frame = 0;
    this.time = 0;
    this.historyValid = false;
    this.debugView = null;
    this.size = new THREE.Vector2(1, 1);
    this.jitter = new THREE.Vector2();
    this.m = {
      proj: new THREE.Matrix4(), invProj: new THREE.Matrix4(), viewProj: new THREE.Matrix4(),
      invViewProj: new THREE.Matrix4(), prevViewProj: new THREE.Matrix4(),
    };
    this.rt = null;
  }

  resize(cssW, cssH) {
    const pr = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(cssW, cssH, false);
    const w = Math.max(2, Math.round(cssW * pr * this.settings.scale));
    const h = Math.max(2, Math.round(cssH * pr * this.settings.scale));
    if (this.rt && w === this.size.x && h === this.size.y) return;
    this.size.set(w, h);
    this.disposeTargets();
    const make = (tw, th, extra = {}) => new THREE.WebGLRenderTarget(tw, th, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, ...extra,
    });
    const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const rt = {
      scene: make(w, h, { depthBuffer: true, depthTexture: depth }),
      ao: make(hw, hh), aoBlur: make(hw, hh), fog: make(hw, hh), fogBlur: make(hw, hh),
      comp: make(w, h), history: [make(w, h), make(w, h)], post: make(w, h),
      down: [], up: [],
    };
    let bw = hw, bh = hh;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      rt.down.push(make(bw, bh));
      if (i < BLOOM_LEVELS - 1) rt.up.push(make(bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    this.rt = rt;
    this.historyValid = false;
    this.fxUniforms.tDepth.value = depth;
    this.fxUniforms.uResolution.value.set(w, h);
  }

  disposeTargets() {
    if (!this.rt) return;
    const all = [this.rt.scene, this.rt.ao, this.rt.aoBlur, this.rt.fog, this.rt.fogBlur, this.rt.comp,
      this.rt.post, ...this.rt.history, ...this.rt.down, ...this.rt.up];
    for (const t of all) { t.depthTexture?.dispose(); t.dispose(); }
    this.rt = null;
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  // frame: { scene, fxScene, camera, dt, beforeMain(renderer) }
  render(frame) {
    const { scene, fxScene, camera, dt } = frame;
    const r = this.renderer, rt = this.rt, m = this.m, mat = this.mat;
    const w = this.size.x, h = this.size.y;
    const st = this.settings;
    this.time += dt;
    this.frame++;
    r.info.reset();

    camera.updateMatrixWorld();
    m.proj.copy(camera.projectionMatrix);
    m.viewProj.multiplyMatrices(m.proj, camera.matrixWorldInverse);
    m.invViewProj.copy(m.viewProj).invert();
    this.fxUniforms.uNear.value = camera.near;
    this.fxUniforms.uFar.value = camera.far;

    frame.beforeMain?.(r);

    // 亚像素抖动：世界和视图模型两套投影加同一个偏移
    const j = st.taa ? HALTON[this.frame % HALTON.length] : [0, 0];
    this.jitter.set((j[0] * 2) / w, (j[1] * 2) / h);
    const vm = this.vmProjection.value;
    const top = camera.near * Math.tan(THREE.MathUtils.degToRad(this.vmFov * 0.5));
    const right = top * camera.aspect;
    vm.makePerspective(-right, right, top, -top, camera.near, camera.far);
    vm.elements[8] -= this.jitter.x;
    vm.elements[9] -= this.jitter.y;
    camera.projectionMatrix.elements[8] -= this.jitter.x;
    camera.projectionMatrix.elements[9] -= this.jitter.y;
    m.invProj.copy(camera.projectionMatrix).invert();
    camera.projectionMatrixInverse.copy(m.invProj);

    r.setRenderTarget(rt.scene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(scene, camera);

    camera.projectionMatrix.copy(m.proj);
    camera.projectionMatrixInverse.copy(m.proj).invert();

    const depth = rt.scene.depthTexture;
    const fm = this.frame % 64;
    const halfTexel = mat.composite.uniforms.uHalfTexel.value.set(1 / rt.ao.width, 1 / rt.ao.height);

    if (st.ao) {
      const u = mat.ao.uniforms;
      u.tDepth.value = depth;
      u.uInvProj.value.copy(m.invProj);
      u.uTexel.value.set(1 / w, 1 / h);
      u.uProjScale.value = m.proj.elements[5] * 0.5;
      u.uAspect.value = camera.aspect;
      u.uFrame.value = fm;
      this.pass(mat.ao, rt.ao);
      mat.blur.uniforms.tInput.value = rt.ao.texture;
      mat.blur.uniforms.uTexel.value.copy(halfTexel);
      mat.blur.uniforms.uSpread.value = 1;
      this.pass(mat.blur, rt.aoBlur);
    }
    if (st.fog) {
      const u = mat.fog.uniforms;
      updateFogLights(mat.fog, this.fogLights, camera);
      u.tDepth.value = depth;
      u.uInvProj.value.copy(m.invProj);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      u.uFrame.value = fm;
      u.uTime.value = this.time;
      u.uStepLen.value = PERF.fog ? FOG_STEP_LEN : 0;
      this.pass(mat.fog, rt.fog);
      mat.blur.uniforms.tInput.value = rt.fog.texture;
      mat.blur.uniforms.uTexel.value.copy(halfTexel);
      mat.blur.uniforms.uSpread.value = 1.5;
      this.pass(mat.blur, rt.fogBlur);
    }

    {
      const u = mat.composite.uniforms;
      u.tScene.value = rt.scene.texture;
      u.tAO.value = rt.aoBlur.texture;
      u.tFog.value = rt.fogBlur.texture;
      u.tDepth.value = depth;
      u.uInvProj.value.copy(m.invProj);
      u.uAOStrength.value = st.ao ? 0.9 : 0;
      u.uFogStrength.value = st.fog ? 1 : 0;
      this.pass(mat.composite, rt.comp);
    }

    let resolved = rt.comp;
    if (st.taa) {
      const cur = rt.history[this.frame & 1], prev = rt.history[(this.frame + 1) & 1];
      const u = mat.taa.uniforms;
      u.tCurrent.value = rt.comp.texture;
      u.tHistory.value = prev.texture;
      u.tDepth.value = depth;
      u.uInvViewProj.value.copy(m.invViewProj);
      u.uPrevViewProj.value.copy(m.prevViewProj);
      u.uJitter.value.copy(this.jitter);
      u.uTexel.value.set(1 / w, 1 / h);
      u.uReset.value = this.historyValid ? 0 : 1;
      this.pass(mat.taa, cur);
      this.historyValid = true;
      resolved = cur;
    }
    m.prevViewProj.copy(m.viewProj);

    mat.copy.uniforms.tInput.value = resolved.texture;
    this.pass(mat.copy, rt.post);
    if (fxScene) r.render(fxScene, camera);

    // 泛光金字塔
    let src = rt.post;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const u = mat.down.uniforms;
      u.tInput.value = src.texture;
      u.uTexel.value.set(1 / src.width, 1 / src.height);
      u.uKaris.value = i === 0 ? 1 : 0;
      this.pass(mat.down, rt.down[i]);
      src = rt.down[i];
    }
    let acc = rt.down[BLOOM_LEVELS - 1];
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const u = mat.up.uniforms;
      u.tInput.value = acc.texture;
      u.tBase.value = rt.down[i].texture;
      u.uTexel.value.set(1 / acc.width, 1 / acc.height);
      this.pass(mat.up, rt.up[i]);
      acc = rt.up[i];
    }

    const f = this.final;
    f.tColor.value = this.debugTexture() || rt.post.texture;
    f.tBloom.value = acc.texture;
    f.tDepth.value = depth;
    f.uTexel.value.set(1 / w, 1 / h);
    f.uAspect.value = camera.aspect;
    f.uTime.value = this.time;
    this.pass(mat.final, null);
  }

  debugTexture() {
    const rt = this.rt;
    switch (this.debugView) {
      case 'ao': return rt.aoBlur.texture;
      case 'fog': return rt.fogBlur.texture;
      case 'scene': return rt.scene.texture;
      case 'comp': return rt.comp.texture;
      default: return null;
    }
  }
}
