import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { freshCollectableCouponsQuery } from '@tubutree/app-core/queries/loyalty';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { claimCoupon } from '../services/coupon-claim';
import { getErrorMessage } from '../services/api';
import { coreHttp } from '../services/core-http';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { useNotify } from './use-notify';

/**
 * "Lưu mã" ở kho mã: nhận mã vào ví qua `POST /coupons/claim` (đường duy nhất, đã khoá theo mã ở máy chủ). Chưa đăng nhập thì mở
 * đăng nhập chứ không gọi máy chủ (khỏi 401); tài khoản khách chưa liên kết bị máy chủ từ chối và câu từ chối được báo nguyên văn.
 * Lỗi nào cũng tải lại kho, nhưng bằng `freshCollectableCouponsQuery` chứ không invalidate thường: route kho có `Cache-Control: public, max-age=15`
 * nên lần tải lại ngay sau lỗi dễ lấy đúng bản cũ trong cache trình duyệt, thẻ vẫn "Lưu mã" thêm chục giây và khách bấm ra cùng một lỗi.
 */
export function useClaimCoupon() {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  // Khoá đồng bộ: setState chưa kịp cập nhật giữa hai lần chạm sát nhau.
  const busy = useRef(false);

  const claim = useCallback(
    async (code: string): Promise<boolean> => {
      if (busy.current) return false;
      const auth = useAuthStore.getState();
      if (auth.status !== 'authenticated') {
        haptic('light');
        void auth.login();
        return false;
      }
      busy.current = true;
      setPendingCode(code);
      try {
        await claimCoupon(code);
        haptic('light');
        notify({ text: fillCopy('coupon.savedToast'), type: 'success' });
        // Ví trước, phần còn lại sau: nếu "đã nhận" (mine) về trước ví thì mã vừa lưu nháy "Đã dùng" cho tới khi ví về.
        await qc.invalidateQueries({ queryKey: ['coupons'], exact: true });
        await qc.invalidateQueries({ queryKey: ['coupons'], predicate: (q) => q.queryKey.length > 1 });
        return true;
      } catch (e) {
        notify({ text: getErrorMessage(e), type: 'error' });
        void qc.fetchQuery(freshCollectableCouponsQuery(coreHttp)).catch(() => undefined);
        void qc.invalidateQueries({ queryKey: ['coupons', 'collectable', 'mine'] });
        void qc.invalidateQueries({ queryKey: ['coupons'], exact: true });
        return false;
      } finally {
        busy.current = false;
        setPendingCode(null);
      }
    },
    [notify, qc],
  );

  return { claim, pendingCode };
}
