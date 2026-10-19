'use client';

import { useEffect } from 'react';
import { applyFontScale, readFontScale } from '@/components/account/font-scale';
import { CouponClaimGate } from '@/components/coupon-claim-gate';
import { OnboardingGate } from '@/components/onboarding-gate';

export { CouponClaimGate, OnboardingGate };

/** Áp cỡ chữ khách đã chọn ở Cài đặt cho mọi trang, giống Mini App áp lúc mở app. */
function FontScaleApplier() {
  useEffect(() => {
    let alive = true;
    void readFontScale().then((scale) => {
      if (alive && scale) applyFontScale(scale);
    });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}

/** Chỗ gắn các cổng mức ứng dụng (nhận mã giảm giá, giới thiệu lần đầu). */
export function AppGates() {
  return (
    <>
      <FontScaleApplier />
      <OnboardingGate />
      <CouponClaimGate />
    </>
  );
}
