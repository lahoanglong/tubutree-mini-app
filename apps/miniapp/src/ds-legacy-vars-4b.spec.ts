import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Dự án 4b: file mới/viết lại không dùng bất kỳ họ biến alias legacy nào trong css/tokens.css
 * (spec §1 tiêu chí 5, §11). Rộng hơn guard 4a (giữ nguyên, chỉ cấm --neutral/--primary/--leaf):
 * thêm --sun-*, --success/--warning/--danger/--info(-bg), --clay-200/800, --radius-sm/md/lg/xl/full,
 * --shadow-*, --dealer-*, --font-body. Tên v2 (--radius-card/control/media/pill, --elevation-*,
 * --color-*, --font-ui) KHÔNG bị chặn.
 *
 * Chỉ liệt kê file 4b tạo/viết lại VÀ sạch hôm nay. Cố ý không có:
 *  - components/wishlist-heart.tsx  (còn --neutral/--danger/--shadow-* + hex thô từ trước 4b)
 *  - pages/product-detail.tsx       (trang chưa migrate, 4b chỉ thêm 1 lời gọi record-recently-viewed)
 * Plan 4c/4d thêm file của mình vào danh sách.
 */
const FILES_4B = [
  'src/pages/home.tsx',
  'src/pages/browse.tsx',
  'src/components/ui/search-field.tsx',
  'src/components/ui/chip.tsx',
  'src/components/ui/list-row.tsx',
  'src/components/ui/product-tile.tsx',
  'src/components/catalog/catalog-grid.tsx',
  'src/components/catalog/category-grid.tsx',
  'src/components/catalog/sort-chips.tsx',
  'src/components/catalog/result-header.tsx',
  'src/components/catalog/filter-sheet.tsx',
  'src/components/catalog/suggest-list.tsx',
  'src/components/catalog/recently-viewed-rail.tsx',
  'src/components/home/home-header.tsx',
  'src/components/home/home-section.tsx',
  'src/components/home/order-strip.tsx',
  'src/components/home/home-extras.tsx',
  'src/components/reorder/purchased-rail.tsx',
];

/**
 * Trang chủ/Danh mục và component home/catalog mới: chỉ được lấy `Page`/`useNavigate` từ zmp-ui
 * (không Box/Text/Input/Button...). Cố ý KHÔNG gồm components/flash-sale.tsx (còn ZaUI có chủ đích).
 */
const FILES_NO_ZAUI_LAYOUT = [
  'src/pages/home.tsx',
  'src/pages/browse.tsx',
  'src/components/catalog/catalog-grid.tsx',
  'src/components/catalog/category-grid.tsx',
  'src/components/catalog/sort-chips.tsx',
  'src/components/catalog/result-header.tsx',
  'src/components/catalog/filter-sheet.tsx',
  'src/components/catalog/suggest-list.tsx',
  'src/components/catalog/recently-viewed-rail.tsx',
  'src/components/home/home-header.tsx',
  'src/components/home/home-section.tsx',
  'src/components/home/order-strip.tsx',
  'src/components/home/home-extras.tsx',
];

// Kết thúc bằng [,)] để bắt cả dạng có fallback `var(--danger, #f00)`.
const LEGACY = new RegExp(
  [
    String.raw`var\(--(neutral|primary|leaf|sun)-`,
    String.raw`var\(--(success|warning|danger|info)(-bg)?[,)]`,
    String.raw`var\(--clay-(200|800)[,)]`,
    String.raw`var\(--radius-(sm|md|lg|xl|full)[,)]`,
    String.raw`var\(--shadow-(xs|sm|md|lg|card)[,)]`,
    String.raw`var\(--dealer-`,
    String.raw`var\(--font-body[,)]`,
  ].join('|'),
);

// Đường dẫn tính từ vị trí file spec (apps/miniapp/src/..) nên chạy đúng từ bất kỳ cwd nào.
const MINIAPP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(MINIAPP_ROOT + file, 'utf8');

const legacyHits = (source: string) =>
  source
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}: ${l.trim()}`)
    .filter((l) => LEGACY.test(l));

/** Tên import (đã bỏ `as`) từ mọi `import ... from 'zmp-ui'`; default/namespace import trả về nguyên văn. */
const zmpUiImports = (source: string) =>
  [...source.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*['"]zmp-ui['"]/g)].flatMap((m) => {
    const clause = m[1]!.trim();
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    return [
      ...(rest ? [rest] : []), // default hoặc `* as ns`
      ...(named ? named[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!.trim()) : []),
    ].filter(Boolean);
  });

describe('4b — bộ so khớp tự kiểm', () => {
  it.each([
    'color: var(--neutral-500)',
    'color: var(--primary-600)',
    'color: var(--leaf-700)',
    'color: var(--sun-500)',
    'color: var(--danger)',
    'color: var(--danger, #f00)',
    'background: var(--success-bg)',
    'color: var(--warning)',
    'color: var(--info)',
    'color: var(--clay-200)',
    'color: var(--clay-800)',
    'borderRadius: var(--radius-sm)',
    'borderRadius: var(--radius-md)',
    'borderRadius: var(--radius-lg)',
    'borderRadius: var(--radius-xl)',
    'borderRadius: var(--radius-full)',
    'boxShadow: var(--shadow-xs)',
    'boxShadow: var(--shadow-card)',
    'color: var(--dealer-ink)',
    'fontFamily: var(--font-body)',
  ])('bắt %s', (line) => {
    expect(LEGACY.test(line)).toBe(true);
  });

  it.each([
    'color: var(--color-text-primary)',
    'color: var(--color-status-danger-fg)',
    'background: var(--color-status-success-bg)',
    'borderRadius: var(--radius-card)',
    'borderRadius: var(--radius-control)',
    'borderRadius: var(--radius-media)',
    'borderRadius: var(--radius-pill)',
    'boxShadow: var(--elevation-1)',
    'color: var(--clay-500)',
    'fontFamily: var(--font-ui)',
    'paddingTop: var(--safe-top)',
  ])('không bắt tên v2 %s', (line) => {
    expect(LEGACY.test(line)).toBe(false);
  });

  it('bộ đọc import zmp-ui hiểu nhiều dòng, alias, default và namespace', () => {
    expect(zmpUiImports("import { Page, useNavigate } from 'zmp-ui';")).toEqual(['Page', 'useNavigate']);
    expect(zmpUiImports("import {\n  Page,\n  Text as T,\n} from 'zmp-ui';")).toEqual(['Page', 'Text']);
    expect(zmpUiImports("import * as Z from 'zmp-ui';")).toEqual(['* as Z']);
    expect(zmpUiImports("import Zmp, { Box } from 'zmp-ui';")).toEqual(['Zmp', 'Box']);
    expect(zmpUiImports("import { Text } from 'other';")).toEqual([]);
  });
});

describe('4b — không dùng biến CSS cũ', () => {
  it.each(FILES_4B)('%s', (file) => {
    expect(legacyHits(read(file))).toEqual([]);
  });
});

describe('4b — Trang chủ, Danh mục và component home/catalog không dùng Box/Text/Input/Button của ZaUI', () => {
  const ALLOWED = new Set(['Page', 'useNavigate']);
  it.each(FILES_NO_ZAUI_LAYOUT)('%s', (file) => {
    expect(zmpUiImports(read(file)).filter((name) => !ALLOWED.has(name))).toEqual([]);
  });
});
