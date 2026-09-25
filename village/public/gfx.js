import * as THREE from 'three';

// 「転がる丸太」のように、手前と奥の地面がなだらかに下へ曲がって見える効果。
// すべてのマテリアルの頂点シェーダーで、カメラの注視点からの奥行きの二乗ぶん沈める。
export const CURVE = {
  uCurve: { value: 0.0055 },
  uCenterZ: { value: 0 },
};

export function curveY(z) {
  const d = z - CURVE.uCenterZ.value;
  return d * d * CURVE.uCurve.value;
}

const CURVE_CHUNK = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  vec4 cWorld = modelMatrix * mvPosition;
  float cDz = cWorld.z - uCenterZ;
  cWorld.y -= cDz * cDz * uCurve;
  mvPosition = viewMatrix * cWorld;
  gl_Position = projectionMatrix * mvPosition;
`;

export function curvify(material, extra) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCurve = CURVE.uCurve;
    shader.uniforms.uCenterZ = CURVE.uCenterZ;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCurve;\nuniform float uCenterZ;')
      .replace('#include <project_vertex>', CURVE_CHUNK);
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => 'curved' + (extra ? extra.name : '');
  return material;
}

// やわらかいセル調の陰影
function makeGradient() {
  const steps = [150, 190, 222, 245, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
export const GRADIENT = makeGradient();

const toonCache = new Map();
export function toon(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!toonCache.has(key)) {
    toonCache.set(key, curvify(new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...opts })));
  }
  return toonCache.get(key);
}
const basicCache = new Map();
export function basic(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!basicCache.has(key)) basicCache.set(key, curvify(new THREE.MeshBasicMaterial({ color, ...opts })));
  return basicCache.get(key);
}

// 足もとの丸いかげ
function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(40,50,20,0.42)');
  grd.addColorStop(0.6, 'rgba(40,50,20,0.25)');
  grd.addColorStop(1, 'rgba(40,50,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export const BLOB_MAT = curvify(new THREE.MeshBasicMaterial({
  map: makeBlobTexture(), transparent: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
}));
const BLOB_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function blob(size) {
  const m = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
  m.scale.set(size, 1, size);
  m.renderOrder = 1;
  return m;
}

export const GEO = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  blobby: new THREE.IcosahedronGeometry(1, 2),
  cone: new THREE.ConeGeometry(1, 1, 18),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  box: new THREE.BoxGeometry(1, 1, 1),
};

export function mesh(geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
