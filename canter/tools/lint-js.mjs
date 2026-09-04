// ブラウザ側の JavaScript に構文の誤りがないか調べる。
// （ビルド工程を持たないぶん、これだけは手元で確認できるようにしておく）

import { readdirSync, statSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = new URL('../public/assets/js/', import.meta.url).pathname;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
});

const files = walk(root);
const work = mkdtempSync(join(tmpdir(), 'canter-lint-'));
let bad = 0;

for (const file of files) {
  const copy = join(work, basename(file, '.js') + '.mjs');
  copyFileSync(file, copy);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.error(`✗ ${file.replace(root, '')}`);
    console.error(String(e.stderr).split('\n').slice(0, 8).join('\n'));
  }
}

rmSync(work, { recursive: true, force: true });
console.log(bad === 0 ? `✓ JavaScript OK (${files.length}件)` : `✗ ${bad}件にエラー`);
process.exit(bad === 0 ? 0 : 1);
