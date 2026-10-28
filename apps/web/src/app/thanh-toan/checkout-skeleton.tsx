'use client';

import { Skeleton } from '@/components/mini';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';

const BAND = `flex flex-col gap-2.5 p-4 ${ui.card} ${mini.band} max-md:mt-2`;

/**
 * Khung chờ của trang thanh toán, đúng thứ tự khối như trang thật (địa chỉ, sản phẩm, mã giảm, mã giới thiệu, thanh toán,
 * ghi chú, tóm tắt): các khối giữ chỗ cho tới khi có đủ giỏ, địa chỉ và báo giá, nên không khối nào bị đẩy xuống khi dữ liệu về.
 */
export function CheckoutSkeleton() {
  return (
    <div role="status" aria-label="Đang tải trang thanh toán" data-testid="checkout-skeleton" className="grid max-md:grid-cols-[minmax(0,1fr)] md:mx-auto md:max-w-2xl md:gap-4 lg:max-w-none">
      <div className={BAND}>
        <Skeleton width={140} height={14} />
        <Skeleton height={64} />
      </div>
      <div className={BAND}>
        <Skeleton width={120} height={14} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
      <div className={BAND}>
        <Skeleton height={44} />
      </div>
      <div className={BAND}>
        <Skeleton height={44} />
      </div>
      <div className={BAND}>
        <Skeleton width={170} height={14} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
      <div className={BAND}>
        <Skeleton width={110} height={14} />
        <Skeleton height={44} />
      </div>
      <div className={BAND}>
        <Skeleton width={150} height={14} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={20} />
      </div>
    </div>
  );
}
