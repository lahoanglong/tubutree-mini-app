import type { ReactNode } from 'react';

/**
 * Khuôn trang shop: điện thoại là một cột như Mini App (đầu shop, số liệu, phần giới thiệu thêm, tab dính, nội dung), không thêm khung nào.
 * Từ lg đầu shop là một thẻ lưới hai cột trong khung `max-w-frame`: bìa chiếm cả chiều cao cột trái, cột phải là avatar, tên, nút rồi số liệu
 * ngay dưới (`ShopHeader` đặt hai ô của nó vào lưới này bằng `lg:contents`), kế đó tab và nội dung rộng đủ cho lưới 5-6 cột. Các ô bọc là
 * `contents` ở khổ nhỏ để thanh tab dính (`position: sticky`) vẫn tính theo cả trang chứ không theo ô bọc chỉ cao bằng nó.
 */
export function StoreLayout({ header, stats, intro, tabs, children }: { header: ReactNode; stats?: ReactNode; intro?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="store-layout" className="lg:flex lg:flex-col lg:gap-4">
      <div
        data-testid="store-head"
        className="max-lg:contents lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[1fr_auto] lg:overflow-hidden lg:rounded-card lg:border lg:border-stone-200 lg:bg-stone-0 lg:shadow-card"
      >
        <div className="contents">{header}</div>
        {stats && <div className="contents lg:block lg:col-start-2 lg:row-start-2 lg:empty:hidden">{stats}</div>}
      </div>
      {intro && <div className="max-lg:contents">{intro}</div>}
      {tabs && <div className="max-lg:contents">{tabs}</div>}
      <div className="max-lg:contents">{children}</div>
    </div>
  );
}
