'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { readClaimParam, readPendingClaim, savePendingClaim, withoutClaimParam } from '@/components/account/coupon-claim';

// Sheet + luồng nhận mã (~220 dòng) chỉ cần khi có `?claim=` hay mã đang chờ: tách khỏi First Load của mọi trang.
const CouponClaimGateInner = dynamic(() => import('./coupon-claim-gate-ui').then((m) => m.CouponClaimGateInner), { ssr: false });

/**
 * Nhận mã từ thẻ QR trong hộp hàng sàn (D2-03). Cổng này ở mọi trang và ngay lần mở đầu: link có `?claim=CODE` thì LƯU mã trên máy và xoá khỏi thanh địa chỉ
 * ngay lúc gắn (không chờ phần giao diện tải xong: khách bấm sang trang khác trước đó thì mã vẫn còn); máy còn mã chờ (khách vừa đăng nhập xong quay về) thì
 * cũng bật. Chỉ khi có mã mới tải phần giao diện và luồng nhận mã (`coupon-claim-gate-ui`), truyền mã vừa đọc sang đó.
 */
export function CouponClaimGate() {
  const [active, setActive] = useState<{ code: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const { search, hash } = window.location;
    const fromUrl = readClaimParam(search, hash);
    if (fromUrl) {
      void savePendingClaim(fromUrl);
      window.history.replaceState(window.history.state, '', withoutClaimParam(window.location.href));
      setActive({ code: fromUrl });
    } else {
      void readPendingClaim().then((code) => {
        if (alive && code) setActive({ code: null });
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  return active ? <CouponClaimGateInner initialCode={active.code} /> : null;
}
