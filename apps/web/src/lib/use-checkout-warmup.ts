'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { loadCheckoutPanels } from '@/components/checkout/checkout-panels-load';
import { shippingEstimateAmount, shippingEstimateQuery } from '@/components/checkout/shipping-estimate-query';
import { getAddresses } from '@/lib/shop-client';

/** Sổ địa chỉ đọc sẵn từ giỏ còn được dùng ngay khi mở Thanh toán trong chừng này; màn Thanh toán vẫn tự đọc lại ngầm như cũ. */
export const WARM_ADDRESSES_MS = 30_000;

function onIdle(run: () => void): void {
  const w = window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 300);
}

/**
 * Giỏ → Thanh toán nhanh hơn. Gắn ref trả về vào các nút đi tới Thanh toán (nút Thanh toán khi giỏ đặt được, nút "bỏ món hết rồi thanh toán"
 * khi có món hết). Nút đầu tiên vào khung nhìn thì lúc trình duyệt rảnh: tải sẵn mã trang `/thanh-toan` và chunk các khối tải lười của nó
 * (form địa chỉ cho khách chưa có sổ, màn đặt xong), đọc sẵn sổ địa chỉ (`['addresses']`, Thanh toán chờ nó mới chọn được địa chỉ và hỏi báo
 * giá) và làm mới nếu đã cũ đúng khoá phí giao ước tính mà Thanh toán đọc khi chưa có địa chỉ (giỏ đọc cùng khoá cho dòng phí của nó;
 * `estimateBase`: tiền hàng kiện Tubu đang chọn, null khi có hàng gian hàng tự giao). Mỗi lần mở giỏ chạy một lần; trình duyệt không có
 * IntersectionObserver thì không làm gì (Thanh toán tự tải như cũ). Chỉ đọc: không gọi báo giá, không ghi gì. Khách rời giỏ trước nhịp rảnh
 * thì lần làm nóng vẫn chạy (chỉ đọc, vô hại).
 */
export function useCheckoutWarmup(estimateBase: number | null): (el: HTMLElement | null) => (() => void) | undefined {
  const router = useRouter();
  const qc = useQueryClient();
  const base = useRef(estimateBase);
  base.current = estimateBase;
  const state = useRef<{ io: IntersectionObserver | null; done: boolean }>({ io: null, done: false });

  return useCallback(
    (el: HTMLElement | null) => {
      const s = state.current;
      if (!el || s.done || typeof IntersectionObserver === 'undefined') return undefined;
      const warm = () => {
        try {
          router.prefetch('/thanh-toan');
        } catch {
          // Tải sẵn chỉ để nhanh hơn; hỏng thì trang vẫn tải lúc chuyển.
        }
        void loadCheckoutPanels();
        void qc.prefetchQuery({ queryKey: ['addresses'], queryFn: getAddresses, staleTime: WARM_ADDRESSES_MS });
        const amount = shippingEstimateAmount(base.current);
        if (amount > 0) void qc.prefetchQuery({ ...shippingEstimateQuery(amount), retry: false });
      };
      s.io ??= new IntersectionObserver((entries) => {
        if (s.done || !entries.some((e) => e.isIntersecting)) return;
        s.done = true;
        s.io?.disconnect();
        onIdle(warm);
      });
      const io = s.io;
      io.observe(el);
      return () => io.unobserve(el);
    },
    [router, qc],
  );
}
