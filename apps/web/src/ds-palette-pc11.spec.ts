import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// C-097 (Q-25): admin/merchant/brand sang Design System v2. Danh sách là "bánh cóc": file nào đã chuyển thì
// không được quay lại palette v1/stock Tailwind, white/black thô, màu cứng hay emoji làm icon. Chuyển thêm
// file nào thì THÊM vào đây TRƯỚC khi sửa (thấy đỏ), sửa xong thấy xanh, commit spec + file chung một lần.
// Không kiểm cỡ chữ: admin tối ưu cho máy tính (Q-29) nên chữ 11px dày đặc của bảng được giữ nguyên.
// Ngoại lệ có chủ ý, static-scan vẫn đếm nhưng không phải icon/màu giao diện: `merchant/theme-colors.ts` là dữ liệu
// màu lưu ở Storefront.themeColor (không nằm trong MIGRATED); dấu ✓ trong <title> của generateMetadata brand (PARTIAL
// bên dưới); placeholder 🌿 của Content Kit ghi bằng escape \u{1F33F} vì là chữ mẫu cho CTV, không phải icon.
const MIGRATED = [
  'app/admin/layout.tsx',
  'app/merchant/layout.tsx',
  'app/merchant/page.tsx',
  'app/admin/page.tsx',
  'components/admin/ui.tsx',
  'components/admin/confirm-dialog.tsx',
  'components/admin/page-nav.tsx',
  'components/admin/search-picker.tsx',
  'components/admin/dealer-tier-select.tsx',
  'components/admin/config-item.tsx',
  'components/admin/invoice-filter-chips.tsx',
  'components/admin/evidence-images.tsx',
  'components/admin/ns1-card.tsx',
  'components/admin/loyalty-config-card.tsx',
  'components/admin/gomdon-config-card.tsx',
  'components/admin/order-status-actions.tsx',
  'components/admin/dealer-credit-panel.tsx',
  'components/admin/dealer-payment-panel.tsx',
  'components/admin/payout-admin-tab.tsx',
  'components/admin/dealer-claims-tab.tsx',
  'components/admin/order-detail-extras.tsx',
  'components/admin/recycling-panel.tsx',
  'components/admin/pos-credits-tab.tsx',
  'components/admin/pos-screen.tsx',
  'app/admin/pos/page.tsx',
  'components/admin/account-deletion-panel.tsx',
  'components/admin/merchant-products-tab.tsx',
  'components/admin/reviews-tab.tsx',
  'components/admin/subscriptions-tab.tsx',
  'components/admin/cashback-tab.tsx',
  'components/admin/customer-refunds-tab.tsx',
  'components/admin/customer-refund-paid-dialog.tsx',
  'lib/admin-pickers.ts',
  'app/admin/analytics-tab.tsx',
  'components/geo-picker.tsx',
  'components/admin/user-picker.tsx',
  'components/admin/product-picker.tsx',
  'components/admin/waste-tab.tsx',
  'lib/waste-labels.ts',
  'components/admin/waste-items-section.tsx',
  'components/admin/waste-point-form.tsx',
  'components/admin/waste-points-section.tsx',
  'components/admin/waste-point-detail.tsx',
  'components/admin/waste-requests-section.tsx',
  'components/admin/waste-request-detail.tsx',
  'components/admin/waste-gifts-section.tsx',
  'components/admin/waste-config-card.tsx',
];

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8');

const UTILITIES = 'bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration|placeholder';
const LEGACY_PALETTE = new RegExp(
  `\\b(?:${UTILITIES})-(?:primary|leaf|clay|sun|neutral|green|emerald|red|amber|blue|yellow|orange|rose|sky|indigo|violet|purple)-\\d{2,3}\\b`,
  'g',
);
// `white`/`black` thô của Tailwind không phải token: nền/chữ trắng là stone-0, lớp phủ tối là stone-900.
const RAW_WHITE_BLACK = new RegExp(`\\b(?:${UTILITIES})-(?:white|black)(?![\\w-])`, 'g');
// #rgb, #rgba, #rrggbb và #rrggbbaa (static-scan đếm cả dạng có kênh alpha).
const RAW_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/g;
// Dải của scripts/uiux/static-scan.mjs (cột emoji) cộng hình học ■-◿ và mũi tên/ký hiệu khối ⬀-⯿: ▲▼ cũng là icon
// ghép trong chữ nút nên phải đi qua lucide-react như emoji.
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿■-◿⬀-⯿]/gu;

// File lớn chuyển dần theo cụm tab: chỉ quét đoạn đã chuyển (từ đầu file tới dấu cắt), cộng phần đuôi dùng chung.
// Cụm tab sau chuyển xong thì dời `end` xuống; chuyển hết thì đưa cả file vào MIGRATED và xoá mục ở đây.
const PARTIAL: { file: string; end: string; tail?: string }[] = [
  // `generateMetadata` ghép dấu ✓ vào chuỗi tiêu đề tab/OG của nhãn chính hãng: đó là chữ trong <title> (không
  // chèn được SVG), không phải icon trong giao diện, nên chỉ phần giao diện từ BrandPage trở xuống bị quét.
  { file: 'app/brand/[slug]/page.tsx', end: 'export async function generateMetadata', tail: 'export default async function BrandPage' },
];

function partialText({ file, end, tail }: { file: string; end: string; tail?: string }): string {
  const src = read(file);
  const cut = src.indexOf(end);
  if (cut < 0) throw new Error(`không thấy dấu cắt "${end}" trong ${file}`);
  if (!tail) return src.slice(0, cut);
  const tailAt = src.indexOf(tail);
  if (tailAt < 0) throw new Error(`không thấy phần đuôi "${tail}" trong ${file}`);
  return src.slice(0, cut) + src.slice(tailAt);
}

function guard(getText: () => string) {
  it('không còn lớp palette v1/stock (primary/leaf/clay/sun/neutral/green/red/amber/blue...)', () => {
    expect(getText().match(LEGACY_PALETTE) ?? []).toEqual([]);
  });

  it('không dùng white/black thô của Tailwind — dùng stone-0/stone-900', () => {
    expect(getText().match(RAW_WHITE_BLACK) ?? []).toEqual([]);
  });

  it('không có màu cứng (hex/rgb/hsl) — màu đi qua token', () => {
    expect(getText().match(RAW_COLOR) ?? []).toEqual([]);
  });

  it('không dùng emoji/ký hiệu làm icon — dùng lucide-react', () => {
    expect(getText().match(EMOJI) ?? []).toEqual([]);
  });
}

describe.each(MIGRATED)('admin DS v2 — %s', (file) => guard(() => read(file)));

describe.each(PARTIAL)('admin DS v2 (phần đã chuyển) — $file', (p) => guard(() => partialText(p)));
