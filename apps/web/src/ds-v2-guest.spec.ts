import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../tailwind.config';

// C-097 (Q-25): web khách đồng bộ sang Design System v2 (packages/design-tokens). Danh sách dưới đây
// là "bánh cóc": file nào đã chuyển thì không được quay lại palette v1 (cam/lá/neutral), chữ <12px
// hay màu hex cứng. Chuyển thêm trang nào thì THÊM vào danh sách. Không thêm /admin, /merchant,
// /brand (thuộc gói PC-11/PD-1, vẫn dùng khối legacy trong tailwind.config.ts).
const MIGRATED = [
  'app/page.tsx',
  'app/layout.tsx',
  'app/globals.css',
  'components/site-header.tsx',
  'components/site-footer.tsx',
  'components/site-search.tsx',
  'components/product-card.tsx',
  'components/add-to-cart.tsx',
  'components/copy-button.tsx',
  'components/coupon-box.tsx',
  'components/geo-picker.tsx',
  'components/recycling-checkout.tsx',
  'components/recycling-status.tsx',
  'lib/guest-ui.ts',
  'app/san-pham/[slug]/page.tsx',
  'app/gio-hang/page.tsx',
  'app/thanh-toan/page.tsx',
  'app/thanh-toan/bank-transfer-panel.tsx',
  'app/tai-khoan/page.tsx',
  'app/tai-khoan/don-hang/[code]/page.tsx',
  'app/s/[slug]/page.tsx',
  'app/dang-nhap/page.tsx',
  'app/dang-nhap/callback/page.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'app/not-found.tsx',
  'app/loading.tsx',
];

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8');

const UTILITIES = 'bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration|placeholder';
const LEGACY_PALETTE = new RegExp(`\\b(?:${UTILITIES})-(?:primary|leaf|clay|sun|neutral|green|emerald|red|amber|blue|yellow|orange|rose|sky)-\\d{2,3}\\b`, 'g');
// `white`/`black` thô của Tailwind không phải token: nền/chữ trắng là stone-0, lớp phủ tối là stone-900.
const RAW_WHITE_BLACK = new RegExp(`\\b(?:${UTILITIES})-(?:white|black)(?![\\w-])`, 'g');
const TINY_TEXT = /\btext-\[(\d+(?:\.\d+)?)px\]/g;
const RAW_HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

describe.each(MIGRATED)('web khách DS v2 — %s', (file) => {
  it('không còn lớp palette v1 (primary/leaf/clay/sun/neutral/green...)', () => {
    expect(read(file).match(LEGACY_PALETTE) ?? []).toEqual([]);
  });

  it('không dùng white/black thô của Tailwind — dùng stone-0/stone-900', () => {
    expect(read(file).match(RAW_WHITE_BLACK) ?? []).toEqual([]);
  });

  it('không có chữ nhỏ hơn 12px (C-116)', () => {
    const tiny = [...read(file).matchAll(TINY_TEXT)].filter((m) => Number(m[1]) < 12).map((m) => m[0]);
    expect(tiny).toEqual([]);
  });

  it('không có hex cứng — màu đi qua token (globals.css chỉ được đọc token)', () => {
    expect(read(file).match(RAW_HEX) ?? []).toEqual([]);
  });
});

describe('web khách DS v2 — nền tảng', () => {
  it('globals.css nạp tokens.css và lấy nền/chữ gốc từ token ngữ nghĩa', () => {
    const css = read('app/globals.css');
    expect(css).toContain("@import '@tubutree/design-tokens/src/tokens.css'");
    expect(css).toContain('var(--color-bg-canvas)');
    expect(css).toContain('var(--color-text-primary)');
  });

  it('trang chủ dùng Fraunces (font-display) cho tiêu đề h1', () => {
    expect(read('app/page.tsx')).toMatch(/<h1[^>]*font-display/);
  });

  // Khối legacy ghi đè clay-50/500/700 của preset bằng hex v1, nên `clay-*` trên web không phải màu DS v2.
  // Giá khuyến mãi phải đi qua tên ngữ nghĩa `promo-*` để luôn ra clay v2 (token --color-promo-*).
  it('tailwind.config.ts có màu ngữ nghĩa promo-* lấy từ clay DS v2, không bị khối legacy ghi đè', () => {
    const colors = (config.theme?.extend as { colors: Record<string, Record<string, string>> }).colors;
    expect(colors.promo).toEqual({ fg: '#7E4222', bg: '#FAF1EA', solid: '#9C532C' });
  });

  it('tailwind.config.ts có bóng đổ theo token elevation của DS v2', () => {
    const shadows = (config.theme?.extend as { boxShadow: Record<string, string> }).boxShadow;
    expect(shadows).toMatchObject({ card: 'var(--elevation-1)', raised: 'var(--elevation-2)' });
  });

  // Trang đã chuyển không còn red/amber/green thô của Tailwind (nằm ngoài DS v2): lỗi/cảnh báo/thành công
  // đi qua màu ngữ nghĩa theo token --color-status-*.
  it('tailwind.config.ts có màu trạng thái danger/warning/success/info trỏ vào token --color-status-*', () => {
    const colors = (config.theme?.extend as { colors: Record<string, Record<string, string>> }).colors;
    for (const name of ['danger', 'warning', 'success', 'info']) {
      expect(colors[name]).toEqual({
        fg: `var(--color-status-${name}-fg)`,
        bg: `var(--color-status-${name}-bg)`,
      });
    }
  });
});
