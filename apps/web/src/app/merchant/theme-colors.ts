// Màu chủ đạo gian hàng là DỮ LIỆU do đối tác chọn và lưu vào Storefront.themeColor (API ràng buộc `#rrggbb`,
// storefront.controller), không phải màu giao diện DS v2 nên không đi qua token. Tách khỏi page.tsx để bánh cóc
// ds-palette-pc11 (cấm hex trong file giao diện) vẫn quét được trang.
export const THEME_COLORS = [
  { label: 'Xanh Lá Tự Nhiên', hex: '#16a34a' },
  { label: 'Xanh Ngọc Lục Bảo', hex: '#0d9488' },
  { label: 'Cam Đất Mộc Mạc', hex: '#ea580c' },
  { label: 'Xanh Navy Hiện Đại', hex: '#1d4ed8' },
  { label: 'Tím Oải Hương', hex: '#7c3aed' },
  { label: 'Nâu Gỗ Trầm', hex: '#78350f' },
];

/** Khớp mặc định của API (Storefront.themeColor @default). */
export const DEFAULT_THEME_COLOR = THEME_COLORS[0]!.hex;
