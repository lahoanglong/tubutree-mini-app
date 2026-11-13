import type { ReactNode } from 'react';

/**
 * Khuôn trang shop: điện thoại là một cột như Mini App (đầu shop, số liệu, phần giới thiệu thêm, tab dính, nội dung), không thêm khung nào.
 * Từ md đầu shop là một thẻ lưới hai cột trong khung `max-w-frame`: bìa chiếm cả chiều cao cột trái, cột phải là avatar, tên, nút rồi số liệu
 * ngay dưới (`ShopHeader` đặt hai ô của nó vào lưới này bằng `md:contents`), kế đó tab và nội dung rộng đủ cho lưới 5-6 cột. Các ô bọc là
 * `contents` ở khổ nhỏ để thanh tab dính (`position: sticky`) vẫn tính theo cả trang chứ không theo ô bọc chỉ cao bằng nó.
 */
export function StoreLayout({ header, stats, intro, tabs, children }: { header: ReactNode; stats?: ReactNode; intro?: ReactNode; tabs?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="store-layout" className="md:flex md:flex-col md:gap-4">
      <div
        data-testid="store-head"
        className="contents md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:grid-rows-[1fr_auto] md:overflow-hidden md:rounded-card md:border md:border-stone-200 md:bg-stone-0 md:shadow-card"
      >
        <div className="contents">{header}</div>
        {stats && <div className="contents md:block md:col-start-2 md:row-start-2 md:empty:hidden">{stats}</div>}
      </div>
      {intro && <div className="contents md:block">{intro}</div>}
      {tabs && <div className="contents md:block">{tabs}</div>}
      <div className="contents md:block">{children}</div>
    </div>
  );
}
