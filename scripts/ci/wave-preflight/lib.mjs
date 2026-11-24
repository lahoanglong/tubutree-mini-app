// Cây tệp và git cho wave-preflight. Mọi luật đọc tệp qua `ctx.head` (cây làm việc) và `ctx.base` (cây ở commit gốc của wave), nên spec thay
// được bằng cây trong bộ nhớ mà không cần repo git thật.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'www', '.turbo', 'coverage', '.git']);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Cây làm việc trên đĩa. `list(prefix)` trả đường dẫn tương đối gốc repo (dấu `/`). */
export function fsTree(root) {
  return {
    read(rel) {
      const p = join(root, rel);
      return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
    },
    list(prefix) {
      const dir = join(root, prefix);
      if (!existsSync(dir)) return [];
      return walk(dir).map((p) => relative(root, p).split(sep).join('/'));
    },
  };
}

/** Cây trong bộ nhớ `{ 'đường/dẫn': 'nội dung' }`, cho spec. */
export function memTree(files) {
  return {
    read: (rel) => (Object.hasOwn(files, rel) ? files[rel] : null),
    list: (prefix) => Object.keys(files).filter((f) => f.startsWith(`${prefix.replace(/\/$/, '')}/`)),
  };
}

const git = (root, args, input) =>
  execFileSync('git', args, { cwd: root, encoding: input === undefined ? 'utf8' : 'buffer', input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });

/**
 * Cây ở một commit. Đọc nhiều tệp bằng một tiến trình `git cat-file --batch` thay vì mỗi tệp một `git show`, để cả nghìn tệp vẫn dưới một giây.
 */
export function gitTree(root, ref) {
  const cache = new Map();
  const readMany = (rels) => {
    const want = rels.filter((r) => !cache.has(r));
    if (want.length > 0) {
      const out = git(root, ['cat-file', '--batch'], Buffer.from(want.map((r) => `${ref}:${r}\n`).join('')));
      let pos = 0;
      for (const rel of want) {
        const nl = out.indexOf(0x0a, pos);
        const header = out.subarray(pos, nl).toString('utf8');
        pos = nl + 1;
        if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
          cache.set(rel, null);
          continue;
        }
        const size = Number(header.split(' ')[2]);
        cache.set(rel, out.subarray(pos, pos + size).toString('utf8'));
        pos += size + 1;
      }
    }
    return new Map(rels.map((r) => [r, cache.get(r) ?? null]));
  };
  return {
    read: (rel) => readMany([rel]).get(rel) ?? null,
    readMany,
    list: (prefix) =>
      git(root, ['ls-tree', '-r', '--name-only', ref, '--', prefix])
        .split('\n')
        .filter(Boolean),
  };
}

/** Đọc nhiều tệp: dùng `readMany` của cây git nếu có, không thì đọc từng tệp. */
export const readMany = (tree, rels) => (tree.readMany ? tree.readMany(rels) : new Map(rels.map((r) => [r, tree.read(r)])));

/** Gốc so sánh: `--base` nếu có, không thì merge-base của HEAD với origin/main (nhánh wave và nhánh release đều tách từ main). */
export function resolveBase(root, explicit) {
  try {
    if (explicit) return git(root, ['rev-parse', '--verify', `${explicit}^{commit}`]).trim();
    return git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
  } catch {
    return null;
  }
}

/**
 * Tệp đổi so với gốc: commit của nhánh, thay đổi chưa commit và tệp mới chưa track. `--no-renames` để tệp đổi tên hiện cả đường dẫn cũ
 * (đọc bản gốc) lẫn mới (đọc bản hiện tại).
 */
export function changedFiles(root, base) {
  const diff = git(root, ['diff', '--name-only', '--no-renames', base, '--']).split('\n');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...diff, ...untracked].filter(Boolean))].sort();
}

/** Lấy đoạn từ chuỗi mở `start` tới chuỗi đóng đầu tiên sau đó (`\n};`, `\n];`). */
export function sliceBlock(text, start, close) {
  const i = text.indexOf(start);
  if (i < 0) return null;
  const j = text.indexOf(close, i);
  return j < 0 ? null : text.slice(i, j + close.length);
}

/** Mọi chuỗi trích dẫn đơn giản ('…', "…", `…` không có ${}) trong một đoạn mã. */
export const quotedStrings = (s) => [...s.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);

/** Số dòng (từ 1) của vị trí `index` trong `text`. */
export const lineOf = (text, index) => text.slice(0, index).split('\n').length;

let tsPromise;
/** typescript của repo; null khi chưa `pnpm install` (luật cần nó báo lỗi thay vì lặng lẽ bỏ qua). */
export function loadTypescript() {
  tsPromise ??= import('typescript').then((m) => m.default ?? m).catch(() => null);
  return tsPromise;
}
