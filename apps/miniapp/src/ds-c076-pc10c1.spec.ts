import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * C-076 lô 3 (gói PC-10c1): ví, cộng đồng và các trang phụ đã chuyển sang DS v2 — không còn biến
 * alias legacy của css/tokens.css, không còn màu thô, không còn component ZaUI mà DS đã có bản thay.
 * Cùng bộ so khớp với ds-legacy-vars-4b.spec.ts + thêm hex/rgb thô (eslint tubu-ds/no-raw-color chỉ
 * bắt giá trị đứng riêng trong style, không bắt chuỗi gradient/viền ghép).
 * Mỗi mục của gói thêm file của mình vào FILES TRƯỚC khi chuyển đổi (đỏ), chuyển xong mới xanh.
 */
const FILES = [
  'src/pages/wallet.tsx',
  'src/pages/cashback.tsx',
  'src/components/community/product-picker.tsx',
  'src/components/community/post-card.tsx',
  'src/components/community/post-composer.tsx',
];

/** Trang (không phải component con) phải có đúng một tiêu đề trang — PageHeader hoặc <h1> riêng (C-114). */
const PAGE_FILES = FILES.filter((f) => f.startsWith('src/pages/'));

/** Chỉ những thứ DS chưa có bản thay mới được lấy từ ZaUI: khung trang, ô nhập, avatar, snackbar, điều hướng. */
const ZAUI_ALLOWED = new Set(['Page', 'Input', 'Avatar', 'useSnackbar', 'useNavigate', 'useLocation']);

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
const RAW_COLOR = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)|\brgba?\(\s*\d/;

const SRC_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(SRC_ROOT + file, 'utf8');

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hits = (source: string, re: RegExp) =>
  stripComments(source)
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}: ${l.trim()}`)
    .filter((l) => re.test(l));

/** Tên import (đã bỏ `as`) từ mọi `import ... from 'zmp-ui'`; default/namespace import trả về nguyên văn. */
const zmpUiImports = (source: string) =>
  [...source.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*['"]zmp-ui['"]/g)].flatMap((m) => {
    const clause = m[1]!.trim();
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    return [
      ...(rest ? [rest] : []),
      ...(named ? named[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!.trim()) : []),
    ].filter(Boolean);
  });

describe('PC-10c1 — bộ so khớp tự kiểm', () => {
  it.each([
    'color: var(--neutral-500)',
    'color: var(--leaf-700)',
    'color: var(--danger)',
    'background: var(--clay-200)',
    'borderRadius: var(--radius-xl)',
    'boxShadow: var(--shadow-sm)',
  ])('LEGACY bắt %s', (line) => {
    expect(LEGACY.test(line)).toBe(true);
  });

  it.each([
    'color: var(--color-text-primary)',
    'background: var(--clay-50)',
    'color: var(--clay-700)',
    'borderRadius: var(--radius-card)',
    'boxShadow: var(--elevation-1)',
    'background: linear-gradient(135deg, var(--forest-600), var(--forest-700))',
  ])('LEGACY không bắt tên v2 %s', (line) => {
    expect(LEGACY.test(line)).toBe(false);
  });

  it.each(["color: '#fff'", "background: 'rgba(255,255,255,0.85)'", "border: '1px solid #e5e5e5'", 'fill="#FF0000"'])(
    'RAW_COLOR bắt %s',
    (line) => {
      expect(RAW_COLOR.test(line)).toBe(true);
    },
  );

  it.each(["color: 'var(--color-text-inverse)'", "href: '#section'", 'a &#39;b&#39;'])('RAW_COLOR không bắt %s', (line) => {
    expect(RAW_COLOR.test(line)).toBe(false);
  });

  it('bộ đọc import zmp-ui hiểu nhiều dòng, alias, default và namespace', () => {
    expect(zmpUiImports("import { Page, useNavigate } from 'zmp-ui';")).toEqual(['Page', 'useNavigate']);
    expect(zmpUiImports("import {\n  Page,\n  Text as T,\n} from 'zmp-ui';")).toEqual(['Page', 'Text']);
    expect(zmpUiImports("import * as Z from 'zmp-ui';")).toEqual(['* as Z']);
    expect(zmpUiImports("import { Text } from 'other';")).toEqual([]);
  });
});

describe('PC-10c1 — không dùng biến CSS cũ', () => {
  it.each(FILES)('%s', (file) => {
    expect(hits(read(file), LEGACY)).toEqual([]);
  });
});

describe('PC-10c1 — không dùng màu thô (hex/rgb)', () => {
  it.each(FILES)('%s', (file) => {
    expect(hits(read(file), RAW_COLOR)).toEqual([]);
  });
});

describe('PC-10c1 — chỉ lấy từ ZaUI những gì DS chưa có', () => {
  it.each(FILES)('%s', (file) => {
    expect(zmpUiImports(read(file)).filter((name) => !ZAUI_ALLOWED.has(name))).toEqual([]);
  });
});

describe('PC-10c1 — mỗi trang có PageHeader hoặc h1 riêng (C-114)', () => {
  it.each(PAGE_FILES)('%s', (file) => {
    expect(/<PageHeader\b|<h1\b/.test(stripComments(read(file)))).toBe(true);
  });
});
