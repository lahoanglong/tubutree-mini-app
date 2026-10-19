/**
 * Màu chủ đạo gian hàng CTV. Đây là DỮ LIỆU gửi lên API (`themeColor`), không phải style: DTO
 * `PATCH /storefront/me` chỉ nhận `#rrggbb` và trang công khai dùng nguyên chuỗi này để tô gian hàng,
 * nên không thể thay bằng tham chiếu token CSS. Hex chỉ được phép nằm ở bảng này, không rải trong .tsx.
 */
export const STOREFRONT_THEME_COLORS = [
  { code: '#16a34a', label: 'Xanh lá' },
  { code: '#0d9488', label: 'Ngọc' },
  { code: '#2563eb', label: 'Xanh dương' },
  { code: '#7c3aed', label: 'Tím' },
  { code: '#ea580c', label: 'Đất nung' },
] as const;

/** Khớp mặc định `'#16a34a'` của `getPublicBySlug` phía API. */
export const DEFAULT_STOREFRONT_THEME_COLOR: string = STOREFRONT_THEME_COLORS[0].code;
