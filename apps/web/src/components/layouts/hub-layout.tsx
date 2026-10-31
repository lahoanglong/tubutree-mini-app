import type { ReactNode } from 'react';

export interface HubLayoutProps {
  /** Banner chiến dịch (chờ P11). Không có thì không vẽ khung và `aside` chiếm cả hàng. */
  banner?: ReactNode;
  /** Thẻ thành viên hoặc quà khách mới, cùng Việc cần làm. */
  aside: ReactNode;
  /** Mọi khối còn lại của trang, trải hết 12 cột bên dưới. */
  children: ReactNode;
}

/**
 * Khung lưới của các trang "hub" (Trang chủ) trên máy tính: từ lg là lưới 12 cột, `banner` 8 cột bên trái và `aside` 4 cột bên phải cùng hàng (không có banner
 * thì `aside` cả 12 cột), `children` 12 cột bên dưới. Dưới lg mọi khung bọc là `display: contents`: không thêm khung nào, các khối xếp liền như ở Mini App 375px.
 * Thứ tự DOM là thứ tự của Mini (`aside` → `banner` → `children`) nên điện thoại không cần đổi thứ tự bằng CSS; từ lg banner được đặt vào cột đầu bằng vị trí lưới.
 */
export function HubLayout({ banner, aside, children }: HubLayoutProps) {
  const hasBanner = banner !== undefined && banner !== null && banner !== false;
  return (
    <div data-testid="hub-layout" className="contents lg:grid lg:grid-cols-12 lg:gap-6">
      <div data-hub-part="aside" className={hasBanner ? 'contents lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:block' : 'contents lg:col-span-12 lg:block'}>
        {aside}
      </div>
      {hasBanner && (
        <div data-hub-part="banner" className="contents lg:col-span-8 lg:col-start-1 lg:row-start-1 lg:block">
          {banner}
        </div>
      )}
      <div data-hub-part="rest" className="contents lg:col-span-12 lg:block">
        {children}
      </div>
    </div>
  );
}
