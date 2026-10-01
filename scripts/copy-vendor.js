// node_modules からブラウザ用ライブラリを public/vendor にコピーする（当日オフラインでも動くように同梱）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/matter-js/build/matter.min.js', 'public/vendor/matter.min.js'],
  ['node_modules/matter-js/LICENSE', 'public/vendor/LICENSE-matter-js.txt'],
  ['node_modules/jsqr/dist/jsQR.js', 'public/vendor/jsQR.js'],
  ['node_modules/jsqr/LICENSE', 'public/vendor/LICENSE-jsqr.txt'],
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(root, to));
  console.log(`copied ${from} -> ${to}`);
}
