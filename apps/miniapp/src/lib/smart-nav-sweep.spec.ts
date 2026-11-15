import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Trang con (giỏ, yêu thích, Giờ vàng, CTV, Đổi rác...) về một tab gốc phải đi qua `useSmartNavigate`: lùi thật khi tab đó
 * là trang ngay trước, thay mục khi đang ở tab gốc khác. `navigate('/browse')` trần luôn đẩy thêm một mục vào lịch sử nên
 * Giỏ → Duyệt → Giỏ → Duyệt chồng bản sao và nút Lùi quay vòng. Gọi có `replace:` tường minh vẫn hợp lệ.
 */
const ROOT_LITERAL = /['"`]\/(?:browse|game|offers|profile)?(?:\?[^'"`]*)?['"`]/;
const NAVIGATE_CALL = /\bnavigate\(([^\n]*)\)/;

/** Đối số đầu của lời gọi (tới dấu phẩy ngoài ngoặc đầu tiên): `state: { from: '/profile' }` ở đối số sau không tính là đích. */
function firstArg(args: string): string {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) return args.slice(0, i);
  }
  return args;
}

/** Mã đang chạy ngay trên một tab gốc (Trang chủ, Vườn Xanh, lưới Duyệt): đi sang tab khác từ đây là đổi tab, không phải trang con. */
const ROOT_TAB_FILES = [
  'pages/home.tsx',
  'pages/game.tsx',
  'components/home/',
  'components/catalog/brand-grid.tsx',
  'components/game/home-quiz-sheet.tsx',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/');
const isRootTabFile = (r: string) => ROOT_TAB_FILES.some((f) => (f.endsWith('/') ? r.startsWith(f) : r === f));

describe('điều hướng trang con về tab gốc (W165)', () => {
  it('danh sách miễn trừ chỉ trỏ tới tệp còn tồn tại', () => {
    for (const f of ROOT_TAB_FILES) expect(existsSync(join(SRC, f)), f).toBe(true);
  });

  it('không trang con nào gọi navigate(tab gốc) trần mà bỏ qua smartNavigate hoặc replace', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const r = rel(file);
      if (isRootTabFile(r)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const call = NAVIGATE_CALL.exec(line)?.[1];
        if (call === undefined) return;
        if (ROOT_LITERAL.test(firstArg(call)) && !/replace\s*:/.test(call)) offenders.push(`${r}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('Đổi rác mở Kho quà ở Hub Ưu đãi (tab rewards), không về trang /rewards cũ', () => {
    const src = readFileSync(join(SRC, 'pages/recycle.tsx'), 'utf8');
    expect(src).not.toMatch(/navigate\(\s*['"`]\/rewards['"`]/);
    expect(src).toContain("offersTabHref('/offers', 'rewards')");
  });
});
