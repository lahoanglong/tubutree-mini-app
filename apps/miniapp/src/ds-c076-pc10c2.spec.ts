import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * C-076 lô 4a, gói PC-10c2 (hồ sơ / cài đặt / nhân sự / admin): mỗi file trong danh sách phải sạch
 * alias legacy của css/tokens.css, không hex/rgb thô, không emoji làm icon chức năng và chỉ lấy từ
 * zmp-ui những thứ DS v2 chưa thay được (khung `Page`, hook, `Avatar` có ảnh dự phòng, `Input`).
 * Thêm file vào danh sách TRƯỚC khi di cư trang đó để thấy đỏ.
 */
const FILES = [
  'src/pages/profile.tsx',
  'src/pages/settings.tsx',
  'src/pages/edit-profile.tsx',
  'src/pages/about.tsx',
  'src/pages/not-found.tsx',
  'src/pages/wishlist.tsx',
  'src/pages/addresses.tsx',
  'src/pages/notifications.tsx',
  'src/pages/my-payroll.tsx',
  'src/pages/staff.tsx',
];

/**
 * C-113: trang đã di cư ở gói khác (order-detail: PC-3) hoặc đang ngoài lô này (bank-payment): gói chỉ gỡ
 * emoji làm icon, không đụng ZaUI/bố cục, nên chỉ kiểm emoji + legacy + hex/rgb thô.
 */
const EMOJI_ONLY_FILES = ['src/pages/bank-payment.tsx', 'src/pages/order-detail.tsx'];

/** Khung trang và hook điều hướng/thông báo: được phép ở mọi trang. */
const ZMP_UI_BASE = ['Page', 'useNavigate', 'useLocation', 'useParams', 'useSnackbar'];
/** Thêm theo từng file khi DS v2 chưa có bản thay (ghi lý do ở báo cáo PC-10c2). */
const ZMP_UI_EXTRA: Record<string, string[]> = {
  'src/pages/profile.tsx': ['Avatar'],
  'src/pages/edit-profile.tsx': ['Avatar', 'Input'],
  'src/pages/my-payroll.tsx': ['Input'],
  'src/pages/staff.tsx': ['Input'],
};

/** Emoji là NỘI DUNG (lời chúc, hạng...) thì được giữ; liệt kê file ở đây kèm lý do khi thật sự cần. */
const EMOJI_CONTENT_OK: string[] = [];

// Cùng bộ so khớp với spec 4b và scripts/uiux/static-scan.mjs.
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
const HEX = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)/;
const RGB = /\brgba?\(\s*\d/;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
// Biểu tượng chữ ngoài dải của static-scan (⌛ ⏳ ⭐): vẫn là icon vẽ bằng ký tự.
const EMOJI_SYMBOL = /[\u231A\u231B\u23E9-\u23FF\u2B50]/u;

const MINIAPP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(MINIAPP_ROOT + file, 'utf8');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hits = (source: string, re: RegExp) =>
  stripComments(source)
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}: ${l.trim()}`)
    .filter((l) => re.test(l));

/** Tên import (đã bỏ `as`/`type`) từ mọi `import ... from 'zmp-ui'`. */
const zmpUiImports = (source: string) =>
  [...source.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*['"]zmp-ui['"]/g)].flatMap((m) => {
    const clause = m[1]!.trim();
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    return [
      ...(rest ? [rest] : []),
      ...(named ? named[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()) : []),
    ].filter(Boolean);
  });

describe('PC-10c2 — bộ so khớp tự kiểm', () => {
  it('bắt alias legacy, hex, rgb, emoji', () => {
    expect(LEGACY.test('color: var(--neutral-500)')).toBe(true);
    expect(LEGACY.test('boxShadow: var(--shadow-card)')).toBe(true);
    expect(LEGACY.test('borderRadius: var(--radius-lg)')).toBe(true);
    expect(LEGACY.test('color: var(--color-text-primary)')).toBe(false);
    expect(LEGACY.test('borderRadius: var(--radius-card)')).toBe(false);
    expect(HEX.test("background: '#fff'")).toBe(true);
    expect(HEX.test('&#8203;')).toBe(false);
    expect(RGB.test("background: 'rgba(255,255,255,0.2)'")).toBe(true);
    expect(EMOJI.test('Đã cập nhật hồ sơ 🌿')).toBe(true);
    expect(EMOJI.test('Đã theo dõi ✓')).toBe(true);
    expect(EMOJI.test('Đã cập nhật hồ sơ')).toBe(false);
    expect(EMOJI_SYMBOL.test('⏳ Chờ')).toBe(true);
    expect(EMOJI_SYMBOL.test('Chờ xác nhận')).toBe(false);
  });

  it('bộ đọc import zmp-ui hiểu nhiều dòng, alias và import kiểu', () => {
    expect(zmpUiImports("import { Page, useNavigate } from 'zmp-ui';")).toEqual(['Page', 'useNavigate']);
    expect(zmpUiImports("import {\n  Page,\n  Text as T,\n  type Foo,\n} from 'zmp-ui';")).toEqual(['Page', 'Text', 'Foo']);
    expect(zmpUiImports("import { Text } from 'other';")).toEqual([]);
  });
});

describe('PC-10c2 — không biến CSS legacy', () => {
  it.each([...FILES, ...EMOJI_ONLY_FILES])('%s', (file) => {
    expect(hits(read(file), LEGACY)).toEqual([]);
  });
});

describe('PC-10c2 — không hex/rgb thô', () => {
  it.each([...FILES, ...EMOJI_ONLY_FILES])('%s', (file) => {
    expect([...hits(read(file), HEX), ...hits(read(file), RGB)]).toEqual([]);
  });
});

describe('PC-10c2 — không emoji làm icon', () => {
  it.each(FILES.filter((f) => !EMOJI_CONTENT_OK.includes(f)))('%s', (file) => {
    expect(hits(read(file), EMOJI)).toEqual([]);
  });
});

describe('PC-10c2 — C-113 gỡ emoji làm icon ở trang đã/ngoài lô', () => {
  it.each(EMOJI_ONLY_FILES)('%s', (file) => {
    expect([...hits(read(file), EMOJI), ...hits(read(file), EMOJI_SYMBOL)]).toEqual([]);
  });
});

describe('PC-10c2 — zmp-ui chỉ còn khung trang, hook và phần DS v2 chưa thay được', () => {
  it.each(FILES)('%s', (file) => {
    const allowed = new Set([...ZMP_UI_BASE, ...(ZMP_UI_EXTRA[file] ?? [])]);
    expect(zmpUiImports(read(file)).filter((name) => !allowed.has(name))).toEqual([]);
  });
});
