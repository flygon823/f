// Meshy AI などで作った 立体モデル（.glb）を読みこんで、島の見た目（セル調・地面といっしょに曲がる）にそろえる。
// public/models/<key>.glb を置いて public/models/index.json に のせると、その住民は自動で モデルに さしかわる
// （tools/prep-model.mjs が 両方やってくれる）。のっていなければ 手づくりの体のまま。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { curvify, GRADIENT } from './gfx.js';

// height：島での背の高さ（MOMO は だいたい 1.5）。yaw：モデルの前が +z を向いていないときの回転（ラジアン）
export const MODEL_SPECS = {
  komugi: { file: 'models/komugi.glb', height: 1.25, yaw: 0 },
  momiji: { file: 'models/momiji.glb', height: 1.4, yaw: 0 },
  chapu: { file: 'models/chapu.glb', height: 1.35, yaw: 0 },
};

const loader = new GLTFLoader();
const cache = new Map(); // key -> Promise<THREE.Object3D | null>
let available = null;    // index.json に のっている モデルの キー
const listModels = () => (available ||= fetch('models/index.json')
  .then((r) => (r.ok ? r.json() : { models: [] }))
  .then((j) => new Set(Array.isArray(j.models) ? j.models : []))
  .catch(() => new Set()));

// セル調のマテリアルに かえる（色の絵はそのまま使う）
function toonify(mat) {
  const m = new THREE.MeshToonMaterial({
    color: mat.map ? 0xffffff : (mat.color || new THREE.Color(0xffffff)),
    map: mat.map || null,
    gradientMap: GRADIENT,
    transparent: !!mat.transparent,
    alphaTest: mat.alphaTest || 0,
    side: mat.side,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  return curvify(m);
}

function prepare(scene, spec) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); // 法線がないと 光が当たらず まっ黒になる
    o.material = Array.isArray(o.material) ? o.material.map(toonify) : toonify(o.material);
    o.frustumCulled = false; // 地面を曲げるシェーダーで 位置が ずれるので、画面外判定はしない
  });
  scene.rotation.y = spec.yaw || 0;
  scene.updateMatrixWorld(true);
  // 足もとを 0、まん中を 原点にして、背の高さを そろえる
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const k = spec.height / Math.max(size.y, 1e-6);
  const holder = new THREE.Group();
  scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.add(scene);
  holder.scale.setScalar(k);
  const out = new THREE.Group();
  out.add(holder);
  return out;
}

// 読みこめたら モデル（毎回 あたらしいコピー）、なければ null
export async function loadModel(key) {
  const spec = MODEL_SPECS[key];
  if (!spec) return null;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        if (!(await listModels()).has(key)) return null;
        const gltf = await loader.loadAsync(spec.file);
        return prepare(gltf.scene, spec);
      } catch (e) {
        console.warn(`[model] ${key} を読みこめませんでした`, e);
        return null;
      }
    })());
  }
  const base = await cache.get(key);
  return base ? base.clone(true) : null;
}
