import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// C-097 (Q-25): admin/merchant/brand sang Design System v2. Danh sách là "bánh cóc": file nào đã chuyển thì
// không được quay lại palette v1/stock Tailwind, white/black thô, màu cứng hay emoji làm icon. Chuyển thêm
// file nào thì THÊM vào đây TRƯỚC khi sửa (thấy đỏ), sửa xong thấy xanh, commit spec + file chung một lần.
// Không kiểm cỡ chữ: admin tối ưu cho máy tính (Q-29) nên chữ 11px dày đặc của bảng được giữ nguyên.
const MIGRATED = [
  'app/admin/layout.tsx',
  'components/admin/ui.tsx',
  'components/admin/confirm-dialog.tsx',
  'components/admin/page-nav.tsx',
  'components/admin/search-picker.tsx',
  'components/admin/dealer-tier-select.tsx',
  'components/admin/config-item.tsx',
  'components/admin/invoice-filter-chips.tsx',
  'components/admin/evidence-images.tsx',
  'components/admin/ns1-card.tsx',
];

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8');

const UTILITIES = 'bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration|placeholder';
const LEGACY_PALETTE = new RegExp(
  `\\b(?:${UTILITIES})-(?:primary|leaf|clay|sun|neutral|green|emerald|red|amber|blue|yellow|orange|rose|sky|indigo|violet|purple)-\\d{2,3}\\b`,
  'g',
);
// `white`/`black` thô của Tailwind không phải token: nền/chữ trắng là stone-0, lớp phủ tối là stone-900.
const RAW_WHITE_BLACK = new RegExp(`\\b(?:${UTILITIES})-(?:white|black)(?![\\w-])`, 'g');
const RAW_COLOR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(/g;
// Cùng dải ký tự với scripts/uiux/static-scan.mjs (cột emoji).
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/gu;

describe.each(MIGRATED)('admin DS v2 — %s', (file) => {
  it('không còn lớp palette v1/stock (primary/leaf/clay/sun/neutral/green/red/amber/blue...)', () => {
    expect(read(file).match(LEGACY_PALETTE) ?? []).toEqual([]);
  });

  it('không dùng white/black thô của Tailwind — dùng stone-0/stone-900', () => {
    expect(read(file).match(RAW_WHITE_BLACK) ?? []).toEqual([]);
  });

  it('không có màu cứng (hex/rgb/hsl) — màu đi qua token', () => {
    expect(read(file).match(RAW_COLOR) ?? []).toEqual([]);
  });

  it('không dùng emoji/ký hiệu làm icon — dùng lucide-react', () => {
    expect(read(file).match(EMOJI) ?? []).toEqual([]);
  });
});
