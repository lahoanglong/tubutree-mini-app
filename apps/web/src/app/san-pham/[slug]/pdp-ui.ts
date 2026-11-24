import { phoneBand } from '@/lib/phone-ui';

/**
 * Lớp chung của các khối trang sản phẩm. Module thường (không `'use client'`) để cả khối máy chủ (`pdp-origin-guide.tsx`) lẫn khối trình duyệt
 * (`pdp-sections.tsx` xuất lại) cùng đọc: hằng của module `'use client'` nhập vào thành phần máy chủ chỉ là tham chiếu máy khách, không phải chuỗi.
 */

/** Tiêu đề khối trong luồng mua (Q1): Inter 16/700, -0.01em ở mọi khổ, cùng số đo với `SectionTitle block` của Mini App. Fraunces chỉ cho tiêu đề trang. */
export const pdpSectionTitle =
  'font-ui text-[length:var(--type-title-sm-size)] font-bold leading-[var(--type-title-sm-lh)] tracking-[-0.01em] text-[var(--color-text-primary)]';

/** Dải trắng riêng của nửa dưới trang ở điện thoại: cách dải trên 8px, đệm 16px như Box p=4 mt=2 của Mini App. Máy tính giữ khoảng cách mt-8. */
export const pdpBand = `mt-8 ${phoneBand}`;
