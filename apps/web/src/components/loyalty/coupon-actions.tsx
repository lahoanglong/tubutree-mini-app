'use client';

import { couponUseCopy } from '@tubutree/app-core/coupon-use';
import { Button } from '@/components/mini';
import { useCouponUse } from '@/lib/use-coupon-use';

/** Hai nút của thẻ mã giảm giá (Sao chép, Dùng ngay) và dòng báo kết quả sao chép; dùng chung cho trang Điểm Xanh và Ưu đãi. */
export function CouponActions({ code }: { code: string }) {
  const { copy, use, notice } = useCouponUse();
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" fullWidth aria-label={couponUseCopy.copyAria(code)} onPress={() => copy(code)}>
          {couponUseCopy.copy}
        </Button>
        <Button fullWidth aria-label={couponUseCopy.useAria(code)} onPress={() => use(code)}>
          {couponUseCopy.use}
        </Button>
      </div>
      {notice && notice.code === code && (
        <p role={notice.error ? 'alert' : 'status'} className={`mt-1.5 text-xs ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
