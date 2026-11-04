'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { readClaimParam, readPendingClaim } from '@/components/account/coupon-claim';

// Sheet + luồng nhận mã (~220 dòng) chỉ cần khi có `?claim=` hay mã đang chờ: tách khỏi First Load của mọi trang.
const CouponClaimGateInner = dynamic(() => import('./coupon-claim-gate-ui').then((m) => m.CouponClaimGateInner), { ssr: false });

/**
 * Nhận mã từ thẻ QR trong hộp hàng sàn (D2-03). Cổng này chỉ nhận diện, ở mọi trang và ngay lần mở đầu: link có `?claim=CODE` hay máy còn mã chờ
 * (khách vừa đăng nhập xong quay về) thì mới tải phần giao diện và luồng nhận mã (`coupon-claim-gate-ui`). Nhận diện không ghi gì: việc lưu mã,
 * xoá khỏi thanh địa chỉ và nhận vào ví do phần giao diện làm ngay khi tải xong, đúng luật cũ.
 */
export function CouponClaimGate() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let alive = true;
    const { search, hash } = window.location;
    if (readClaimParam(search, hash)) {
      setActive(true);
    } else {
      void readPendingClaim().then((code) => {
        if (alive && code) setActive(true);
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  return active ? <CouponClaimGateInner /> : null;
}
