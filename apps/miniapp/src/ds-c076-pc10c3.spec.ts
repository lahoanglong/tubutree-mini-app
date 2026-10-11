import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PC-10c3 (C-076 lô 4b, C-113): component dùng chung đã di cư sang DS v2 không được quay lại
 * biến alias legacy của css/tokens.css, màu hex/rgb thô, emoji làm icon hay layout ZaUI.
 * Bộ regex alias cùng nguồn với scripts/uiux/static-scan.mjs (+ --shadow-card, --font-body của
 * guard 4b) để số đo của script và guard này không lệch nhau.
 *
 * Mỗi file được thêm vào danh sách TRƯỚC khi di cư (thấy đỏ), rồi mới sửa tới khi xanh.
 */
const FILES_PC10C3 = [
  'src/components/reviews-section.tsx',
  'src/components/onboarding.tsx',
  'src/components/product-card.tsx',
  'src/components/flash-sale.tsx',
  'src/components/checkout/voucher-sheet.tsx',
  'src/components/qr-code.tsx',
  'src/components/subscribe-sheet.tsx',
  'src/components/wishlist-heart.tsx',
  'src/components/pull-to-refresh.tsx',
  'src/components/ui/time-input.tsx',
  'src/components/ui/quantity-selector.tsx',
  'src/components/error-boundary.tsx',
  'src/components/geo-picker.tsx',
  'src/components/checkout/referral-code-box.tsx',
  'src/components/checkout/address-section.tsx',
  'src/components/avatar-crop-modal.tsx',
  'src/components/image-upload.tsx',
];

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

// Cùng định nghĩa với static-scan: hex 3-8 ký tự không dính chữ/số liền trước, và rgb()/rgba() bắt đầu bằng số.
const RAW_COLOR = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)|\brgba?\(\s*\d/;

// Emoji + ký hiệu dingbat/misc (★ ✓ ⚠ ♻...). Rộng hơn static-scan một chút (thêm khối 1F000-1F2FF, có cờ quốc gia).
const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿⭐⭕]/u;

/**
 * Từ zmp-ui chỉ còn lấy hook, Input/Select (chưa có bản DS: Select cho chọn địa giới), Avatar và
 * Sheet nền tối của cắt ảnh đại diện (BottomSheet DS nền sáng sẽ đổi thiết kế); layout/nút/chữ
 * dùng components/ui.
 */
const ZAUI_ALLOWED = new Set(['Page', 'Avatar', 'Input', 'Select', 'Sheet', 'useNavigate', 'useLocation', 'useSnackbar']);

const MINIAPP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(MINIAPP_ROOT + file, 'utf8');

/** Bỏ comment trước khi quét (comment giải thích "vì sao" được phép nhắc tên token cũ). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hits = (re: RegExp, source: string) =>
  code(source)
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
      ...(named ? named[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()) : []),
    ].filter(Boolean);
  });

describe('PC-10c3 — bộ so khớp tự kiểm', () => {
  it.each([
    'color: var(--neutral-400)',
    'background: var(--primary-50)',
    'color: var(--leaf-700)',
    'color: var(--sun-500)',
    'color: var(--danger)',
    'color: var(--danger, #f00)',
    'color: var(--warning)',
    'borderRadius: var(--radius-lg)',
    'borderRadius: var(--radius-full)',
    'boxShadow: var(--shadow-sm)',
    'boxShadow: var(--shadow-card)',
    'color: var(--clay-800)',
  ])('bắt alias legacy %s', (line) => {
    expect(LEGACY.test(line)).toBe(true);
  });

  it.each([
    'color: var(--color-text-secondary)',
    'background: var(--color-status-danger-bg)',
    'borderRadius: var(--radius-card)',
    'borderRadius: var(--radius-pill)',
    'boxShadow: var(--elevation-1)',
    'color: var(--clay-500)',
    'color: var(--color-rating)',
    'paddingBottom: var(--safe-bottom)',
  ])('không bắt tên v2 %s', (line) => {
    expect(LEGACY.test(line)).toBe(false);
  });

  it.each(['background: "#000"', "color: '#1f2a44'", 'background: rgba(255,255,255,0.3)', 'color: rgb(0, 0, 0)'])('bắt màu thô %s', (line) => {
    expect(RAW_COLOR.test(line)).toBe(true);
  });

  it.each(['color: var(--color-text-primary)', '&#39;', 'key="x#fff0"', 'rgb-input'])('không bắt %s', (line) => {
    expect(RAW_COLOR.test(line)).toBe(false);
  });

  it.each(['★', '✓ Đã mua', '⚠ Lỗi', '🎬 Có video', '🌿', '♻️', '🇻🇳'])('bắt emoji/ký hiệu %s', (s) => {
    expect(EMOJI.test(s)).toBe(true);
  });

  it.each(['Đã mua', 'Giảm -20%', '→ Tiếp', '· 12 đã bán', '—'])('không bắt chữ thường %s', (s) => {
    expect(EMOJI.test(s)).toBe(false);
  });

  it('bộ đọc import zmp-ui hiểu nhiều dòng, alias, type và namespace', () => {
    expect(zmpUiImports("import { Box, Text, useSnackbar } from 'zmp-ui';")).toEqual(['Box', 'Text', 'useSnackbar']);
    expect(zmpUiImports("import {\n  Sheet,\n  Text as T,\n  type Foo,\n} from 'zmp-ui';")).toEqual(['Sheet', 'Text', 'Foo']);
    expect(zmpUiImports("import * as Z from 'zmp-ui';")).toEqual(['* as Z']);
    expect(zmpUiImports("import { Text } from 'other';")).toEqual([]);
  });

  it('bỏ comment trước khi quét', () => {
    expect(hits(LEGACY, '// var(--neutral-400)\n/* var(--danger) */\nconst a = 1;')).toEqual([]);
    expect(hits(LEGACY, 'const s = "var(--neutral-400)";')).toHaveLength(1);
  });
});

describe('PC-10c3 — không dùng biến CSS legacy', () => {
  it.each(FILES_PC10C3)('%s', (file) => {
    expect(hits(LEGACY, read(file))).toEqual([]);
  });
});

describe('PC-10c3 — không có màu hex/rgb thô', () => {
  it.each(FILES_PC10C3)('%s', (file) => {
    expect(hits(RAW_COLOR, read(file))).toEqual([]);
  });
});

describe('PC-10c3 — không dùng emoji làm icon (C-113)', () => {
  it.each(FILES_PC10C3)('%s', (file) => {
    expect(hits(EMOJI, read(file))).toEqual([]);
  });
});

describe('PC-10c3 — chỉ lấy hook/Input/Avatar từ zmp-ui', () => {
  it.each(FILES_PC10C3)('%s', (file) => {
    expect(zmpUiImports(read(file)).filter((name) => !ZAUI_ALLOWED.has(name))).toEqual([]);
  });
});
