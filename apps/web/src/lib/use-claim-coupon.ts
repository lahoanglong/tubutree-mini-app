'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { claimCoupon } from '@tubutree/app-core/api/coupon-claim';
import { freshCollectableCouponsQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { loginHref } from '@/lib/return-to';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';

export interface ClaimNotice {
  code: string;
  text: string;
  error: boolean;
}

const OFFLINE_TEXT = 'Không kết nối được với Tubu Tree. Bạn thử lại sau ít phút nhé.';

/**
 * "Lưu mã" ở kho mã của web (cùng luật với `hooks/use-claim-coupon.ts` của Mini App): nhận mã vào ví qua `POST /coupons/claim`, đường
 * duy nhất và đã khoá theo mã ở máy chủ. Web không có snackbar nên câu báo trả ở `notice` để trang in một dòng `role="status"`/`role="alert"`.
 * Chưa đăng nhập thì chuyển tới đăng nhập kèm `returnTo` (đăng nhập xong quay lại đúng tab); phiên chưa khôi phục được thì báo mất mạng
 * chứ không mời đăng nhập lại; đang khôi phục thì bỏ qua. Máy chủ từ chối thì tải lại kho, nhưng bằng `freshCollectableCouponsQuery` chứ không invalidate
 * thường: route kho có `Cache-Control: public, max-age=15` nên lần tải lại ngay sau lỗi dễ lấy đúng bản cũ trong cache trình duyệt.
 */
export function useClaimCoupon(returnTo: string) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<ClaimNotice | null>(null);
  // Khoá đồng bộ: setState chưa kịp cập nhật giữa hai lần chạm sát nhau.
  const busy = useRef(false);

  const claim = useCallback(
    async (code: string): Promise<boolean> => {
      if (busy.current) return false;
      if (phase === 'loading') return false;
      if (phase === 'unavailable') {
        setNotice({ code, text: OFFLINE_TEXT, error: true });
        return false;
      }
      if (phase !== 'authenticated') {
        router.push(loginHref(returnTo));
        return false;
      }
      busy.current = true;
      setPendingCode(code);
      setNotice(null);
      try {
        await claimCoupon(coreHttp, code);
        setNotice({ code, text: fillCopy('coupon.savedToast'), error: false });
        // Ví trước, phần còn lại sau: nếu "đã nhận" (mine) về trước ví thì mã vừa lưu nháy "Đã dùng" cho tới khi ví về.
        // Khoá giữ tới khi cả hai về (có hạn 4 giây, kẻo mạng chậm giữ mọi thẻ lâu hơn lệnh đã xong): nhả sớm thì thẻ còn "Lưu mã" và chạm lại ra lỗi "đã nhận rồi".
        await settleWithin(
          (async () => {
            await qc.invalidateQueries({ queryKey: ['coupons'], exact: true });
            await qc.invalidateQueries({ queryKey: ['coupons'], predicate: (q) => q.queryKey.length > 1 });
          })(),
        );
        return true;
      } catch (e) {
        setNotice({ code, text: actionErrorText(e), error: true });
        // Chỉ khi máy chủ từ chối (hết lượt, đã nhận, không còn): thẻ đang hiện đã cũ nên tải lại và giữ khoá tới lúc đó (tối đa 4 giây), kẻo chạm lại ra đúng lỗi vừa báo.
        // Mất mạng, 401/403 và 5xx không nói gì về trạng thái thật của mã: không tải lại.
        if (serverRejectedState(e)) {
          await settleWithin(
            Promise.all([
              qc.fetchQuery(freshCollectableCouponsQuery(coreHttp)).catch(() => undefined),
              qc.invalidateQueries({ queryKey: ['coupons', 'collectable', 'mine'] }),
              qc.invalidateQueries({ queryKey: ['coupons'], exact: true }),
            ]),
          );
        }
        return false;
      } finally {
        busy.current = false;
        setPendingCode(null);
      }
    },
    [phase, qc, returnTo, router],
  );

  return { claim, pendingCode, notice };
}
