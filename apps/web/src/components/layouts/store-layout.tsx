import type { ReactNode } from 'react';

/**
 * Khuôn trang shop: điện thoại là một cột như Mini App (đầu shop, số liệu, phần giới thiệu thêm, tab dính, nội dung), không thêm khung nào; từ lg đầu shop
 * tràn khung `max-w-frame`, số liệu thành thẻ riêng ngay dưới và nội dung rộng đủ cho lưới 5-6 cột. Các ô bọc là `contents` ở khổ
 * nhỏ để thanh tab dính (`position: sticky`) vẫn tính theo cả trang chứ không theo ô bọc chỉ cao bằng nó.
 */
export function StoreLayout({ header, stats, intro, tabs, children }: { header: ReactNode; stats?: ReactNode; intro?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="store-layout" className="lg:flex lg:flex-col lg:gap-4">
      <div className="max-lg:contents">{header}</div>
      {stats && <div className="max-lg:contents lg:max-w-xl lg:overflow-hidden lg:rounded-card lg:border lg:border-stone-200 lg:bg-stone-0 lg:shadow-card">{stats}</div>}
      {intro && <div className="max-lg:contents">{intro}</div>}
      {tabs && <div className="max-lg:contents">{tabs}</div>}
      <div className="max-lg:contents">{children}</div>
    </div>
  );
}
