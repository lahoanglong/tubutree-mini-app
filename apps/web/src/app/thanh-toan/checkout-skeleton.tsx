'use client';

import { Skeleton } from '@/components/mini';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';

const BAND = `flex flex-col gap-2.5 p-4 ${ui.card} ${mini.band} max-md:mt-2`;
// Từ lg trang thật có hai cột: cột trái là các khối nhập liệu, cột phải là MỘT khung "Đơn hàng" (sản phẩm + tóm tắt). Khối sản phẩm và tóm tắt
// nên ẩn khỏi cột trái và nhường chỗ cho khung giả bên phải; các khối còn lại ghim cột 1 để không rơi sang cột 2 theo thứ tự tự xếp.
const LEFT = `${BAND} lg:col-start-1`;
const ORDER_PART = `${BAND} lg:hidden`;

/**
 * Khung chờ của trang thanh toán, đúng thứ tự khối như trang thật (địa chỉ, sản phẩm, mã giảm, mã giới thiệu, thanh toán,
 * ghi chú, tóm tắt) và cùng lưới với trang thật (một cột tới md, từ lg cột phải 22,5rem = 360px): các khối giữ chỗ cho tới khi có đủ
 * giỏ, địa chỉ và báo giá, nên không khối nào bị đẩy xuống hay sang cột khác khi dữ liệu về.
 */
export function CheckoutSkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải trang thanh toán"
      data-testid="checkout-skeleton"
      className="grid max-md:grid-cols-[minmax(0,1fr)] md:mx-auto md:max-w-2xl md:gap-6 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:gap-y-4"
    >
      <div className={LEFT}>
        <Skeleton width={140} height={14} />
        <Skeleton height={64} />
      </div>
      <div className={ORDER_PART}>
        <Skeleton width={120} height={14} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
      <div className={LEFT}>
        <Skeleton height={44} />
      </div>
      <div className={LEFT}>
        <Skeleton height={44} />
      </div>
      <div className={LEFT}>
        <Skeleton width={170} height={14} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
      <div className={LEFT}>
        <Skeleton width={110} height={14} />
        <Skeleton height={44} />
      </div>
      <div className={ORDER_PART}>
        <Skeleton width={150} height={14} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={20} />
      </div>
      <div
        data-testid="checkout-skeleton-aside"
        aria-hidden="true"
        className={`hidden flex-col gap-2.5 p-4 ${ui.card} lg:col-start-2 lg:row-span-5 lg:row-start-1 lg:flex lg:self-start`}
      >
        <Skeleton width={110} height={20} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={20} />
        <Skeleton height={44} />
      </div>
    </div>
  );
}
