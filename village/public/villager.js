import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon, basic, blob, GEO, mesh, curvify, GRADIENT } from './gfx.js';

// どうぶつは島の住民用（プレイヤーは MOMO だけ）
export const SPECIES = [
  { key: 'cat', name: 'ねこ' },
  { key: 'dog', name: 'いぬ' },
  { key: 'rabbit', name: 'うさぎ' },
  { key: 'bear', name: 'くま' },
  { key: 'pig', name: 'ぶた' },
];
export const FUR = ['#f3d9a4', '#c98b4f', '#8a6448', '#f7f3ec', '#b3b1ba', '#f0a15a', '#f7bccb', '#a8cdef', '#5d5864', '#eed66e'];
export const SHIRT = ['#e85d5d', '#f2a541', '#f6d55c', '#7cc47f', '#4fb3bf', '#5b8def', '#9b7fd4', '#f28cb1', '#fdfdf8', '#6d6f78'];

function shade(hex, k) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * k, 0, 1));
  return '#' + c.getHexString();
}

// 胴体・頭・耳・しっぽを組み立てる。前は +z。
// しましまのシャツ（住民用）
const stripeCache = new Map();
function stripedShirt(base, stripe) {
  const key = base + stripe;
  if (!stripeCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 8, 64);
    g.fillStyle = stripe;
    for (let y = 4; y < 64; y += 12) g.fillRect(0, y, 8, 5);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    stripeCache.set(key, curvify(new THREE.MeshToonMaterial({ color: '#ffffff', map: tex, gradientMap: GRADIENT })));
  }
  return stripeCache.get(key);
}

function buildAnimal(body, look) {
  const sp = look.s;
  const fur = look.furHex || FUR[look.f] || FUR[0];
  const shirt = look.shirtHex || SHIRT[look.c] || SHIRT[0];
  const furM = toon(fur);
  const furDark = toon(shade(fur, 0.82));
  const light = toon(sp === 'pig' ? shade(fur, 1.12) : '#fff8ec');
  const shirtM = look.stripe ? stripedShirt(shirt, look.stripe) : toon(shirt);
  const sleeveM = toon(shirt);
  const inner = toon('#f6a6b8');
  const black = basic('#2b2320');
  const white = basic('#ffffff');

  // 足
  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.12 * s, 0.3, 0);
    pivot.add(mesh(GEO.sphereLo, furM, 0, -0.16, 0.02, 0.1, 0.17, 0.11));
    pivot.add(mesh(GEO.sphereLo, furDark, 0, -0.27, 0.06, 0.1, 0.05, 0.13));
    body.add(pivot);
    return pivot;
  });
  // 胴（シャツ）
  body.add(mesh(GEO.sphere, shirtM, 0, 0.47, 0, 0.3, 0.27, 0.26));
  body.add(mesh(GEO.cyl, sleeveM, 0, 0.36, 0, 0.3, 0.1, 0.26));
  // 腕
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.28 * s, 0.6, 0);
    pivot.rotation.z = 0.55 * s;
    pivot.add(mesh(GEO.sphereLo, sleeveM, 0, -0.08, 0, 0.085, 0.11, 0.085));
    pivot.add(mesh(GEO.sphereLo, furM, 0, -0.2, 0, 0.075, 0.08, 0.075));
    body.add(pivot);
    return pivot;
  });

  // 頭
  const head = new THREE.Group();
  head.position.y = 1.08;
  body.add(head);
  head.add(mesh(GEO.sphere, furM, 0, 0, 0, 0.5, 0.45, 0.46));

  // 目（白いハイライト付き）
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Group();
    e.position.set(0.17 * s, 0.03, 0.4);
    e.rotation.y = 0.28 * s;
    e.add(mesh(GEO.sphereLo, black, 0, 0, 0, 0.068, 0.088, 0.04));
    e.add(mesh(GEO.sphereLo, white, 0.018, 0.03, 0.03, 0.022, 0.024, 0.01));
    head.add(e);
    return e;
  });
  // ほっぺ
  for (const s of [-1, 1]) {
    const b = mesh(GEO.sphereLo, toon('#ff9fae'), 0.29 * s, -0.1, 0.33, 0.075, 0.045, 0.03);
    b.rotation.y = 0.65 * s;
    head.add(b);
  }
  // 口
  const mouth = mesh(GEO.sphereLo, basic('#7a3b3b'), 0, -0.16, 0.44, 0.045, 0.012, 0.02);
  head.add(mouth);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.4, -0.24);
  body.add(tailPivot);

  if (sp === 'cat') {
    for (const s of [-1, 1]) {
      const ear = mesh(GEO.cone, furM, 0.27 * s, 0.4, -0.02, 0.15, 0.24, 0.1);
      ear.rotation.z = -0.35 * s;
      head.add(ear);
      const earIn = mesh(GEO.cone, inner, 0.26 * s, 0.38, 0.03, 0.09, 0.16, 0.05);
      earIn.rotation.z = -0.35 * s;
      head.add(earIn);
    }
    head.add(mesh(GEO.sphereLo, inner, 0, -0.07, 0.46, 0.04, 0.03, 0.02));
    const tail = mesh(GEO.sphereLo, furM, 0, 0.18, -0.05, 0.05, 0.26, 0.05);
    tail.rotation.x = -0.5;
    tailPivot.add(tail);
    tailPivot.add(mesh(GEO.sphereLo, furDark, 0, 0.42, -0.19, 0.06, 0.07, 0.06));
  } else if (sp === 'dog') {
    for (const s of [-1, 1]) {
      const ear = mesh(GEO.sphereLo, furDark, 0.43 * s, 0.05, -0.02, 0.1, 0.24, 0.13);
      ear.rotation.z = 0.28 * s;
      head.add(ear);
    }
    head.add(mesh(GEO.sphereLo, light, 0, -0.11, 0.38, 0.17, 0.12, 0.12));
    head.add(mesh(GEO.sphereLo, black, 0, -0.06, 0.5, 0.055, 0.04, 0.04));
    const tail = mesh(GEO.sphereLo, furM, 0, 0.12, -0.05, 0.06, 0.16, 0.06);
    tail.rotation.x = -0.9;
    tailPivot.add(tail);
    mouth.position.set(0, -0.19, 0.47);
  } else if (sp === 'rabbit') {
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(0.15 * s, 0.34, -0.04);
      ear.rotation.z = -0.12 * s;
      ear.add(mesh(GEO.sphereLo, furM, 0, 0.3, 0, 0.1, 0.34, 0.07));
      ear.add(mesh(GEO.sphereLo, inner, 0, 0.3, 0.035, 0.055, 0.27, 0.04));
      head.add(ear);
    }
    head.add(mesh(GEO.sphereLo, inner, 0, -0.07, 0.46, 0.035, 0.028, 0.02));
    tailPivot.add(mesh(GEO.sphereLo, light, 0, -0.02, 0, 0.1));
  } else if (sp === 'bear') {
    for (const s of [-1, 1]) {
      head.add(mesh(GEO.sphereLo, furM, 0.32 * s, 0.33, -0.04, 0.13, 0.13, 0.08));
      head.add(mesh(GEO.sphereLo, furDark, 0.32 * s, 0.33, 0.0, 0.07, 0.07, 0.06));
    }
    head.add(mesh(GEO.sphereLo, light, 0, -0.1, 0.38, 0.15, 0.11, 0.11));
    head.add(mesh(GEO.sphereLo, black, 0, -0.05, 0.49, 0.05, 0.035, 0.03));
    tailPivot.add(mesh(GEO.sphereLo, furM, 0, -0.02, 0, 0.08));
    mouth.position.set(0, -0.18, 0.47);
  } else if (sp === 'hamster') {
    // まるい耳・白い口もと・ふくらんだほっぺ
    for (const s of [-1, 1]) {
      head.add(mesh(GEO.sphereLo, furM, 0.3 * s, 0.34, -0.06, 0.12, 0.12, 0.07));
      head.add(mesh(GEO.sphereLo, inner, 0.3 * s, 0.34, -0.01, 0.075, 0.075, 0.04));
      head.add(mesh(GEO.sphereLo, light, 0.22 * s, -0.17, 0.3, 0.17, 0.13, 0.13));
    }
    head.add(mesh(GEO.sphereLo, light, 0, -0.1, 0.36, 0.14, 0.11, 0.1));
    head.add(mesh(GEO.sphereLo, inner, 0, -0.04, 0.46, 0.04, 0.03, 0.025));
    head.add(mesh(GEO.sphereLo, furDark, 0, 0.3, 0.3, 0.12, 0.05, 0.08));
    tailPivot.add(mesh(GEO.sphereLo, furM, 0, -0.04, 0, 0.06));
    mouth.position.set(0, -0.14, 0.45);
  } else if (sp === 'pig') {
    for (const s of [-1, 1]) {
      const ear = mesh(GEO.cone, furDark, 0.27 * s, 0.37, 0.05, 0.12, 0.18, 0.07);
      ear.rotation.set(0.45, 0, -0.5 * s);
      head.add(ear);
    }
    const snout = mesh(GEO.cyl, light, 0, -0.07, 0.45, 0.13, 0.09, 0.1);
    snout.rotation.x = Math.PI / 2;
    head.add(snout);
    for (const s of [-1, 1]) head.add(mesh(GEO.sphereLo, toon(shade(fur, 0.6)), 0.045 * s, -0.07, 0.5, 0.025, 0.035, 0.01));
    const tail = mesh(GEO.sphereLo, furM, 0, 0.05, -0.02, 0.04, 0.09, 0.04);
    tail.rotation.x = -1.2;
    tailPivot.add(tail);
    mouth.position.set(0, -0.2, 0.43);
  }

  return { legs, arms, head, eyes, mouth, tailPivot, mouthRest: 0.012, mouthOpen: 0.05, scale: 1, hip: 0.3, lieShift: 0, handY: -0.22 };
}

// ---------- MOMO（テレビ頭のロボット） ----------
export const MOMO_ACCENT = ['#8fcfbd', '#f4a7b2', '#f3cf62', '#9cc8ef', '#b9a6e6', '#f2a36b', '#a8d67a', '#e4e6e2', '#7b828c', '#ef8f8f'];
const RB = new Map();
function rbox(w, h, d, r) {
  const k = [w, h, d, r].join();
  if (!RB.has(k)) RB.set(k, new RoundedBoxGeometry(w, h, d, 3, r));
  return RB.get(k);
}
function buildMomo(body, look) {
  const accent = toon(look.furHex || MOMO_ACCENT[look.f] || MOMO_ACCENT[0]);
  const shell = toon('#e8ebe8');
  const joint = toon('#4a5058');
  const sole = toon('#f0a58f');
  const screen = toon('#1f2a2e');
  const glow = basic('#9ff0da');
  const blush = basic('#f59aa9');

  // 足：黒い関節・色のついた もも・白いすね・白い くつ（うらは もも色）
  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.13 * s, 0.37, 0);
    pivot.add(mesh(GEO.sphereLo, joint, 0, 0, 0, 0.075));
    pivot.add(mesh(GEO.sphereLo, accent, 0, -0.1, 0, 0.085, 0.1, 0.085));
    pivot.add(mesh(rbox(0.17, 0.13, 0.17, 0.05), shell, 0, -0.22, 0.005));
    pivot.add(mesh(rbox(0.19, 0.08, 0.26, 0.035), shell, 0, -0.315, 0.04));
    pivot.add(mesh(rbox(0.2, 0.035, 0.27, 0.015), sole, 0, -0.355, 0.04));
    body.add(pivot);
    return pivot;
  });
  // 胴：白い箱と色の帯、胸のパネル
  body.add(mesh(rbox(0.48, 0.36, 0.36, 0.08), shell, 0, 0.6, 0));
  body.add(mesh(rbox(0.5, 0.11, 0.38, 0.05), accent, 0, 0.44, 0));
  body.add(mesh(rbox(0.22, 0.1, 0.03, 0.02), screen, 0.04, 0.63, 0.18));
  for (let k = 0; k < 3; k++) body.add(mesh(rbox(0.045, 0.05, 0.02, 0.01), toon('#e9f4f0'), -0.025 + k * 0.06, 0.63, 0.196));
  body.add(mesh(GEO.sphereLo, toon('#f0a58f'), -0.14, 0.655, 0.18, 0.025, 0.025, 0.012));
  body.add(mesh(GEO.sphereLo, accent, -0.14, 0.6, 0.18, 0.025, 0.025, 0.012));
  body.add(mesh(GEO.cyl, joint, 0, 0.82, 0, 0.09, 0.08, 0.09));
  // 腕
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.3 * s, 0.7, 0);
    pivot.rotation.z = 0.35 * s;
    pivot.add(mesh(GEO.sphereLo, joint, 0, 0, 0, 0.07));
    pivot.add(mesh(GEO.sphereLo, accent, 0, -0.09, 0, 0.065, 0.085, 0.065));
    pivot.add(mesh(GEO.sphereLo, shell, 0, -0.19, 0, 0.07, 0.065, 0.07));
    pivot.add(mesh(GEO.sphereLo, shell, 0, -0.28, 0.01, 0.065, 0.06, 0.06));
    for (const f of [-1, 1]) pivot.add(mesh(GEO.sphereLo, shell, 0.03 * f, -0.33, 0.02, 0.022, 0.035, 0.022));
    body.add(pivot);
    return pivot;
  });
  // 頭：角の丸い箱と、黒い画面の顔
  const head = new THREE.Group();
  head.position.y = 1.14;
  body.add(head);
  head.add(mesh(rbox(0.82, 0.6, 0.58, 0.14), shell, 0, 0, 0));
  head.add(mesh(rbox(0.64, 0.42, 0.04, 0.08), screen, 0, -0.01, 0.285));
  const arcGeo = new THREE.TorusGeometry(0.055, 0.017, 6, 16, Math.PI);
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Group();
    e.position.set(0.14 * s, 0.03, 0.31);
    e.add(new THREE.Mesh(arcGeo, glow)); // ∩ のにっこり目
    head.add(e);
    return e;
  });
  for (const s of [-1, 1]) head.add(mesh(rbox(0.07, 0.035, 0.01, 0.012), blush, 0.23 * s, -0.04, 0.308));
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.06, 0.31);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.019, 6, 18, Math.PI), glow);
  smile.rotation.z = Math.PI; // U のかたち
  mouth.add(smile);
  head.add(mouth);
  // 耳のパーツ
  for (const s of [-1, 1]) {
    const rim = mesh(GEO.cyl, joint, 0.41 * s, 0.02, 0, 0.12, 0.04, 0.12);
    rim.rotation.z = Math.PI / 2;
    head.add(rim);
    const ear = mesh(GEO.cyl, accent, 0.44 * s, 0.02, 0, 0.1, 0.06, 0.1);
    ear.rotation.z = Math.PI / 2;
    head.add(ear);
  }
  // アンテナ
  head.add(mesh(GEO.cyl, joint, 0, 0.4, 0, 0.012, 0.22, 0.012));
  head.add(mesh(GEO.sphereLo, toon('#f0a58f'), 0, 0.53, 0, 0.05));
  const tailPivot = new THREE.Group();
  body.add(tailPivot);
  return { legs, arms, head, eyes, mouth, tailPivot, mouthRest: 1, mouthOpen: 0.8, scale: 1.1, hip: 0.37, lieShift: 0.4, handY: -0.31 };
}

export function makeVillager(look) {
  const root = new THREE.Group();
  const shadow = blob(1.15);
  shadow.position.y = 0.03;
  root.add(shadow);

  // すわる・ねころぶときは posePivot ごと傾ける
  const posePivot = new THREE.Group();
  root.add(posePivot);
  const body = new THREE.Group();
  posePivot.add(body);

  const parts = look.s === 'momo' ? buildMomo(body, look) : buildAnimal(body, look);
  const { legs, arms, head, eyes, mouth, tailPivot } = parts;
  posePivot.scale.setScalar(parts.scale);

  // ピッケル（ふるときだけ手に出す）
  const pickaxe = new THREE.Group();
  pickaxe.position.set(0, parts.handY, 0.02);
  pickaxe.add(mesh(GEO.cyl, toon('#9c6b3e'), 0, 0, 0.3, 0.03, 0.72, 0.03).rotateX(Math.PI / 2));
  const pickHead = new THREE.Group();
  pickHead.position.set(0, 0, 0.64);
  pickHead.add(mesh(GEO.box, toon('#8d96a3'), 0, 0, 0, 0.07, 0.34, 0.09));
  for (const sy of [-1, 1]) {
    const tip = mesh(GEO.cone, toon('#b8c0cb'), 0, sy * 0.28, -0.04, 0.05, 0.2, 0.05);
    tip.rotation.x = sy > 0 ? -0.35 : Math.PI + 0.35;
    pickHead.add(tip);
  }
  pickaxe.add(pickHead);
  pickaxe.visible = false;
  arms[1].add(pickaxe);

  const st = {
    pose: 'stand',
    swingT: 0,
    phase: 0, walk: 0, blinkT: 2 + Math.random() * 3, talkT: 0, hopT: 0, waveT: 0, shakeT: 0, t: Math.random() * 10,
  };

  function update(dt, speed) {
    st.t += dt;
    const moving = speed > 0.3;
    st.walk += ((moving ? 1 : 0) - st.walk) * Math.min(1, dt * 10);
    st.phase += dt * (moving ? 5 + speed * 1.35 : 0);
    const w = st.walk;
    const sw = Math.sin(st.phase);
    const run = THREE.MathUtils.clamp((speed - 4.5) / 3, 0, 1);

    legs[0].rotation.x = sw * 0.75 * w;
    legs[1].rotation.x = -sw * 0.75 * w;
    arms[0].rotation.x = -sw * (0.6 + run * 0.4) * w;
    arms[1].rotation.x = sw * (0.6 + run * 0.4) * w;
    arms[0].rotation.z = -0.55;
    arms[1].rotation.z = 0.55;

    let y = Math.abs(Math.sin(st.phase)) * (0.07 + run * 0.05) * w;
    const breathe = Math.sin(st.t * 2.2) * 0.012 * (1 - w);
    body.scale.set(1 - breathe, 1 + breathe, 1 - breathe);
    head.rotation.z = Math.sin(st.phase) * 0.06 * w;
    head.rotation.x = run * 0.12 * w;
    body.rotation.x = run * 0.12 * w;
    tailPivot.rotation.y = Math.sin(st.t * (moving ? 12 : 3)) * (moving ? 0.5 : 0.2);

    // まばたき
    st.blinkT -= dt;
    const blink = st.blinkT < 0.12 ? 0.12 : 1;
    if (st.blinkT < 0) st.blinkT = 2 + Math.random() * 4;
    for (const e of eyes) e.scale.y = blink;

    // おしゃべり
    if (st.talkT > 0) {
      st.talkT -= dt;
      mouth.scale.y = parts.mouthRest + Math.abs(Math.sin(st.t * 18)) * parts.mouthOpen;
      head.rotation.x += Math.sin(st.t * 9) * 0.05;
    } else {
      mouth.scale.y = parts.mouthRest;
    }
    // ぴょん（リアクション）
    if (st.hopT > 0) {
      st.hopT = Math.max(0, st.hopT - dt);
      const p = 1 - st.hopT / 0.5;
      y += Math.sin(p * Math.PI) * 0.35;
    }
    // 手をふる
    if (st.waveT > 0) {
      st.waveT = Math.max(0, st.waveT - dt);
      arms[1].rotation.z = 2.5 + Math.sin(st.t * 14) * 0.35;
      arms[1].rotation.x = 0;
    }
    // 木をゆする
    if (st.shakeT > 0) {
      st.shakeT = Math.max(0, st.shakeT - dt);
      for (const a of arms) { a.rotation.x = -1.35 + Math.sin(st.t * 30) * 0.15; }
      arms[0].rotation.z = -0.25; arms[1].rotation.z = 0.25;
    }
    // ピッケルをふる：ふりかぶって、ふりおろす
    if (st.swingT > 0) {
      st.swingT = Math.max(0, st.swingT - dt);
      const p = 1 - st.swingT / 0.42;
      const a = p < 0.45 ? -2.7 * (p / 0.45) : -2.7 + 3.3 * Math.min(1, (p - 0.45) / 0.25);
      arms[1].rotation.x = a;
      arms[1].rotation.z = 0.15;
      arms[0].rotation.x = a * 0.6;
      body.rotation.x = p > 0.45 ? 0.15 : -0.05;
      pickaxe.visible = true;
    } else {
      pickaxe.visible = false;
    }
    body.position.y = y;

    // すわる・ねころぶ
    shadow.visible = st.pose === 'stand';
    posePivot.rotation.x = st.pose === 'lie' ? -Math.PI / 2 : 0;
    if (st.pose === 'sit') {
      legs[0].rotation.x = legs[1].rotation.x = -1.45;
      arms[0].rotation.x = arms[1].rotation.x = -0.35;
      body.position.y = 0;
    } else if (st.pose === 'lie') {
      legs[0].rotation.x = legs[1].rotation.x = 0;
      arms[0].rotation.x = arms[1].rotation.x = 0;
      arms[0].rotation.z = -0.25; arms[1].rotation.z = 0.25;
      body.position.y = 0;
      head.rotation.set(0, 0, Math.sin(st.t * 0.8) * 0.06);
      // ねむっている目
      if (st.talkT <= 0) for (const e of eyes) e.scale.y = 0.12;
    }
  }

  return {
    root,
    head,
    update,
    talk(sec) { st.talkT = Math.max(st.talkT, sec); },
    hop() { st.hopT = 0.5; },
    wave() { st.waveT = 1.6; },
    shake() { st.shakeT = 0.6; },
    swing() { st.swingT = 0.42; },
    setPose(p) { st.pose = p; },
    get pose() { return st.pose; },
    lieShift: parts.lieShift, // ねころぶとき、頭がベッドの板にぶつからないよう足もと側へずらす量
    hip: parts.hip * parts.scale, // すわったときの腰の高さ（体の大きさ 1 のとき）
  };
}
