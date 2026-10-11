import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * C-076 lô 2, gói PC-10b (affiliate, dealer, storefront, brand): file đã di cư sang DS v2 không được
 * quay lại alias legacy trong css/tokens.css, không có màu thô (hex/rgb/hsl) ngoài chỗ được phép,
 * không dùng ký tự chữ làm icon chức năng, và không dùng Box/Text/Button của ZaUI.
 *
 * Mỗi file thêm vào danh sách TRƯỚC khi di cư (spec đỏ), di cư xong thì xanh, cùng một commit.
 * Mỗi file một dòng để lượt khác thêm file mà không đụng dòng của nhau.
 *
 * Màu nhận diện riêng (dealer, nhãn) nằm ở css/*.css của chính trang, không nằm trong .tsx nên
 * không cần ngoại lệ ở đây.
 */
const FILES_PC10B = [
  'src/pages/affiliate.tsx',
  'src/components/affiliate/ctv-order-sheet.tsx',
  'src/components/affiliate/choice-card.tsx',
  'src/pages/dealer.tsx',
  'src/components/storefront-context-bar.tsx',
  'src/components/share-sheet.tsx',
];

/** Còn Sheet/Input vì components/ui chưa có bản thay; Page/hook điều hướng và snackbar là của runtime. */
const ZAUI_ALLOWED = new Set(['Page', 'Sheet', 'Input', 'useSnackbar', 'useNavigate', 'useLocation']);

/** Mỗi TRANG phải có đúng một h1: PageHeader (h1 thật) ở mọi nhánh render. */
const PAGES_WITH_PAGE_HEADER = [
  'src/pages/affiliate.tsx',
  'src/pages/dealer.tsx',
];

// Giữ đồng bộ với scripts/uiux/static-scan.mjs (LEGACY) và ds-legacy-vars-4b.spec.ts.
const LEGACY = new RegExp(
  [
    String.raw`var\(--(neutral|primary|leaf|sun)-\d+[,)]`,
    String.raw`var\(--(success|warning|danger|info)(-bg)?[,)]`,
    String.raw`var\(--clay-(200|800)[,)]`,
    String.raw`var\(--radius-(sm|md|lg|xl|full)[,)]`,
    String.raw`var\(--shadow-(xs|sm|md|lg|card)[,)]`,
    String.raw`var\(--dealer-`,
    String.raw`var\(--font-body[,)]`,
  ].join('|'),
);

const HEX = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)/;
const FUNC_COLOR = /\b(?:rgba?|hsla?)\(\s*\d/;
/** Dấu chữ dùng làm icon chức năng: phải là Icon của DS (emoji là NỘI DUNG thì được giữ). */
const FUNCTIONAL_GLYPH = /[⚠✓✔✕✖✗]/u;

const MINIAPP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(MINIAPP_ROOT + file, 'utf8');

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hits = (source: string, re: RegExp) =>
  stripComments(source)
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}: ${l.trim()}`)
    .filter((l) => re.test(l));

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

describe('PC-10b — bộ so khớp tự kiểm', () => {
  it.each([
    'color: var(--neutral-500)',
    'background: var(--primary-50)',
    'color: var(--leaf-700)',
    'color: var(--sun-500)',
    'color: var(--danger)',
    'color: var(--danger, #f00)',
    'background: var(--info-bg)',
    'borderRadius: var(--radius-lg)',
    'boxShadow: var(--shadow-card)',
    'color: var(--dealer-ink)',
    'fontFamily: var(--font-body)',
  ])('bắt alias legacy: %s', (line) => {
    expect(LEGACY.test(line)).toBe(true);
  });

  it.each([
    'color: var(--color-text-primary)',
    'color: var(--color-status-danger-fg)',
    'borderRadius: var(--radius-card)',
    'borderRadius: var(--radius-pill)',
    'boxShadow: var(--elevation-1)',
    'color: var(--color-dealer-ink)',
    'fontFamily: var(--font-ui)',
  ])('không bắt tên v2: %s', (line) => {
    expect(LEGACY.test(line)).toBe(false);
  });

  it('bắt màu thô nhưng không bắt token hay màu có cả tên', () => {
    expect(HEX.test("color: '#fff'")).toBe(true);
    expect(HEX.test("background: '#E08C1C'")).toBe(true);
    expect(FUNC_COLOR.test("color: 'rgba(255,255,255,0.8)'")).toBe(true);
    expect(FUNC_COLOR.test("boxShadow: '0 4px 12px rgba(0,0,0,0.1)'")).toBe(true);
    expect(HEX.test("color: 'var(--color-text-inverse)'")).toBe(false);
    expect(HEX.test('const href = "#top-section-link-x"')).toBe(false);
  });

  it('bộ đọc import zmp-ui hiểu nhiều dòng và alias', () => {
    expect(zmpUiImports("import { Page, useNavigate } from 'zmp-ui';")).toEqual(['Page', 'useNavigate']);
    expect(zmpUiImports("import {\n  Box,\n  Text as T,\n} from 'zmp-ui';")).toEqual(['Box', 'Text']);
    expect(zmpUiImports("import { Text } from 'other';")).toEqual([]);
  });
});

describe('PC-10b — không dùng biến CSS legacy', () => {
  it.each(FILES_PC10B)('%s', (file) => {
    expect(hits(read(file), LEGACY)).toEqual([]);
  });
});

describe('PC-10b — không có màu thô (hex/rgb/hsl)', () => {
  it.each(FILES_PC10B)('%s', (file) => {
    expect(hits(read(file), HEX)).toEqual([]);
    expect(hits(read(file), FUNC_COLOR)).toEqual([]);
  });
});

describe('PC-10b — icon chức năng dùng Icon của DS, không dùng ký tự chữ', () => {
  it.each(FILES_PC10B)('%s', (file) => {
    expect(hits(read(file), FUNCTIONAL_GLYPH)).toEqual([]);
  });
});

describe('PC-10b — không dùng Box/Text/Button của ZaUI', () => {
  it.each(FILES_PC10B)('%s', (file) => {
    expect(zmpUiImports(read(file)).filter((name) => !ZAUI_ALLOWED.has(name))).toEqual([]);
  });
});

describe('PC-10b — mỗi trang có tiêu đề h1 qua PageHeader', () => {
  it.each(PAGES_WITH_PAGE_HEADER)('%s', (file) => {
    const source = stripComments(read(file));
    expect(source).toMatch(/import\s*\{[^}]*\bPageHeader\b[^}]*\}\s*from\s*'[^']*components\/ui\/page-header'/);
    expect(source).not.toMatch(/<h1[\s>]/);
  });
});
