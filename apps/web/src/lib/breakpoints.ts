/**
 * Điểm gãy `md:` và `lg:` của Tailwind dưới dạng truy vấn media. Tách khỏi `use-media-query.ts` (mô-đun 'use client') để mã máy chủ (script ở
 * `<head>` của `app/layout.tsx`) đọc được giá trị thật: hằng số xuất từ mô-đun 'use client' sang thành phần máy chủ chỉ là tham chiếu client.
 */
const MD_WIDTH = 768;
const LG_WIDTH = 1024;
/** Cùng điểm gãy `md:` và `lg:` của Tailwind; dùng khi một thành phần phải đổi chỗ theo khổ màn thay vì ẩn/hiện bằng lớp. */
export const MD_UP = `(min-width: ${MD_WIDTH}px)`;
/** Phần bù của `MD_UP` (dưới điểm gãy `md:`): 767.98 để màn rộng đúng 767.5px không rơi vào khe giữa hai truy vấn. */
export const MD_DOWN = `(max-width: ${MD_WIDTH - 0.02}px)`;
export const LG_UP = `(min-width: ${LG_WIDTH}px)`;
