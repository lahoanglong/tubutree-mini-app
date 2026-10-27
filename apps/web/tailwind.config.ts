import type { Config } from 'tailwindcss';
import stockColors from 'tailwindcss/colors';
import { tailwindPreset } from '@tubutree/design-tokens';

// Design System v2 (docs/superpowers/plans/2026-09-28-design-system-v2.md, Task 5) shares the
// `@tubutree/design-tokens` preset (forest-*/sage-*/stone-*/honey-*/terracotta-*, fonts, semantic
// radii) with apps/miniapp. Web khách (trang chủ, header/footer, thẻ sản phẩm...) đã chuyển sang các
// thang này (C-097, Q-25); danh sách file đã chuyển được khoá bởi src/ds-v2-guest.spec.ts.
//
// ─── LEGACY v1 WEB PALETTE — CHỈ CÒN CHO TRANG CHƯA CHUYỂN ─────────────────────────────────
// Trang khách còn lại và toàn bộ /admin, /merchant, /brand (gói PC-11/PD-1) vẫn dùng
// primary-/leaf-/sun-/neutral-. Removing this palette made 1,049 class uses across 36 files emit NO
// CSS (login + checkout CTAs became white text on a transparent background). The block below
// restores, VERBATIM from the merge-base (22e36d4), what web rendered in production before DS v2:
//   - custom primary/leaf/clay/sun/neutral hex;
//   - Tailwind's STOCK neutral shades web relied on implicitly (old `extend.neutral` merged
//     per-shade over the stock scale; the preset now sets `neutral: undefined`, which wipes the
//     stock scale — so the shades web still uses are re-added explicitly from tailwindcss/colors);
//   - old custom borderRadius sm/md/lg/xl.
// `extend` here merges AFTER the preset, so it wins over the preset's `neutral: undefined` and
// its clay-50/500/700 — nên trang đã chuyển KHÔNG dùng `clay-*` mà dùng `promo-*` bên dưới.
// Delete shade-by-shade as web pages migrate to DS v2; xoá cả khối khi trang cuối cùng chuyển xong.
// Shades web references that were ALSO undefined at the merge-base (primary-300/500/800,
// leaf-300/500/800, clay-800) are intentionally NOT invented here — parity with prod, not a
// redesign; see .superpowers/sdd/2026-09-28-design-system-v2/final-fix-report.md.
const legacyV1Colors = {
  primary: {
    50: '#FDF3E3',
    100: '#FBE4C4',
    200: '#F4C98A',
    400: '#EBA94A',
    // 600/700 darkened from #E08C1C/#B86A10 (2.65:1 / 4.11:1 with white) so the CTA label and the
    // orange text clear WCAG 1.4.3 (4.5:1); the logo orange stays in design-tokens as tubu-orange.
    600: '#A35A0B',
    700: '#8F4F08',
    900: '#5C3505',
  },
  leaf: {
    50: '#EEF7D9',
    100: '#DCEFBE',
    200: '#BBD98A',
    400: '#95D222',
    600: '#509018',
    700: '#3C6D12',
    900: '#1F3A09',
  },
  clay: { 50: '#FBF4ED', 200: '#EDD4BD', 500: '#C97B4A', 700: '#8C4F2A' },
  sun: { 300: '#FDD96E', 500: '#F4B400' },
  // Stock Tailwind green-700/800 shifted down one step: stock green-600 (#16A34A) under a white label is 3.3:1.
  green: { 600: '#15803D', 700: '#166534' },
  neutral: {
    // Stock Tailwind neutral (what web got implicitly before this branch).
    ...stockColors.neutral,
    // Old custom overrides (win over stock, exactly as the old extend did).
    0: '#FFFFFF',
    50: '#FAFAF8',
    100: '#F2F2EF',
    200: '#E5E5E0',
    400: '#6B6B64', // was #A8A8A0 (2.39:1 as text on white); also fills grey status pills with white labels
    600: '#5F5F58',
    900: '#1A1A17',
  },
};

// Màu khuyến mãi theo token --color-promo-* (tokens.css). Đọc thẳng từ orange (cam logo) của preset để không lệch
// hex, và đặt tên riêng vì `clay-*` của web bị khối legacy ghi đè (xem chú thích trên).
const presetOrange = (tailwindPreset.theme?.extend?.colors as unknown as { orange: Record<number, string> }).orange;
const promo = { fg: presetOrange[800]!, bg: presetOrange[50]!, solid: presetOrange[500]! };

// Màu trạng thái (lỗi/cảnh báo/thành công/thông tin) theo token --color-status-* của tokens.css. Preset không
// có tên cho nhóm này, và các thang `red/amber/green/emerald` của Tailwind không thuộc DS v2 nên trang
// đã chuyển dùng `danger/warning/success/info-{fg,bg}`. Là biến CSS nên không dùng được hậu tố độ trong suốt (`/40`).
const statusColors = {
  danger: { fg: 'var(--color-status-danger-fg)', bg: 'var(--color-status-danger-bg)' },
  warning: { fg: 'var(--color-status-warning-fg)', bg: 'var(--color-status-warning-bg)' },
  success: { fg: 'var(--color-status-success-fg)', bg: 'var(--color-status-success-bg)' },
  info: { fg: 'var(--color-status-info-fg)', bg: 'var(--color-status-info-bg)' },
};

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ...legacyV1Colors, promo, ...statusColors },
      // Chữ phụ của Mini App (--type-caption-*): 13px, không phải 12px của text-xs.
      fontSize: { caption: ['var(--type-caption-size)', { lineHeight: 'var(--type-caption-lh)' }] },
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
      // Bóng đổ ấm của DS v2 (tokens.css --elevation-*); cần tokens.css được nạp trong globals.css.
      boxShadow: { card: 'var(--elevation-1)', raised: 'var(--elevation-2)' },
      // Bề rộng khung trang máy tính (lib/page-frame.ts).
      maxWidth: { frame: '1200px' },
    },
  },
  plugins: [],
};

export default config;
