'use client';

import { couponUseCopy } from '@tubutree/app-core/coupon-use';
import { Button } from '@/components/mini';
import { useCouponUse } from '@/lib/use-coupon-use';

/** Đệm ngang hẹp: thẻ mã nằm trong hai lớp đệm, ở 320px hai nút với đệm mặc định rộng hơn chỗ có và đẩy cả trang tràn ngang. */
const TIGHT = { minWidth: 0, paddingInline: 8 } as const;

/** Hai nút của thẻ mã giảm giá (Sao chép, Dùng ngay) và dòng báo kết quả sao chép; dùng chung cho trang Điểm Xanh và Ưu đãi. */
export function CouponActions({ code }: { code: string }) {
  const { copy, use, notice } = useCouponUse();
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" fullWidth style={TIGHT} aria-label={couponUseCopy.copyAria(code)} onPress={() => copy(code)}>
          {couponUseCopy.copy}
        </Button>
        <Button fullWidth style={TIGHT} aria-label={couponUseCopy.useAria(code)} onPress={() => use(code)}>
          {couponUseCopy.use}
        </Button>
      </div>
      {notice && notice.code === code && (
        <p role={notice.error ? 'alert' : 'status'} className={`mt-1.5 text-caption ${notice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
