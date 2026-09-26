// Meshy などで作った .glb を、島で使えるように かるくする。
//
//   cd village/tools && npm install
//   node prep-model.mjs <入力.glb> <キー>          例：node prep-model.mjs ~/Downloads/hamster.glb komugi
//
// → village/public/models/<キー>.glb に書き出す（ポリゴンを へらし、絵を 1024px の WebP に して、いらないものを けずる）。
// オプション：--tris 12000（三角形の数のめやす）、--tex 1024（絵の大きさ）
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, resample, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); if (i < 0) return d; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const targetTris = opt('--tris', 12000);
const texSize = opt('--tex', 1024);
const [input, key] = args;
if (!input || !key || !/^[a-z0-9_-]+$/.test(key)) {
  console.error('つかいかた: node prep-model.mjs <入力.glb> <キー（英小文字）> [--tris 12000] [--tex 1024]');
  process.exit(1);
}
const output = path.join(here, '..', 'public', 'models', `${key}.glb`);

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const before = fs.statSync(input).size;
const trisBefore = countTris(doc);

await MeshoptSimplifier.ready;
await doc.transform(dedup(), flatten(), join(), weld());
if (trisBefore > targetTris) {
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: targetTris / trisBefore, error: 0.002 }));
}
// 島ではセル調で ぬりなおすので、色の絵（baseColor）だけ使う。ほかの絵（法線・金属っぽさ など）は けずる
for (const mat of doc.getRoot().listMaterials()) {
  mat.setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
}
await doc.transform(
  resample(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }),
);

fs.mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, doc);
// index.json に のせる（島は ここに のっているモデルだけ 読みこむ）
const indexFile = path.join(path.dirname(output), 'index.json');
let index = { models: [] };
try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* はじめて */ }
index.models = [...new Set([...(index.models || []), key])].sort();
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
const after = fs.statSync(output).size;
const kb = (b) => `${Math.round(b / 1024).toLocaleString()}KB`;
console.log(`${key}: 三角形 ${trisBefore.toLocaleString()} → ${countTris(doc).toLocaleString()}、ファイル ${kb(before)} → ${kb(after)}`);
console.log(`→ ${path.relative(process.cwd(), output)}`);
