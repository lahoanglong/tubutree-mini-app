import type { QueryClient } from '@tanstack/react-query';
import { settleWithin } from './settle-within';

/**
 * Máy chủ từ chối lệnh áp/gỡ mã vì màn đã cũ (`serverRejectedState`: mã hết lượt, bị tắt, giỏ vừa đổi): đọc lại số xem trước từng mã, ví mã và báo giá cùng với giỏ
 * (`cartReloaded`, lời hứa tải lại của `cartWrite.fail(cmd, true)`), rồi chờ chúng về (tối đa `LOCK_REFRESH_WAIT_MS`). Trả nó ra từ `onError` thì TanStack Query đợi trước
 * `onSettled`, nên nút áp/gỡ giữ khoá tới lúc đó; nhả sớm thì chạm lần hai gửi lại đúng lệnh vừa bị từ chối trên số cũ. Giống `holdForCouponReload` của Mini App.
 *
 * Chỉ gọi khi lỗi là loại "màn đã cũ": mất mạng và 5xx hay đến đúng lúc máy chủ bận, lần tải lại cũng hỏng nên nhả khoá ngay.
 */
export function holdForCouponReload(qc: QueryClient, cartReloaded: Promise<void> | undefined): Promise<void> {
  return settleWithin(
    Promise.all([
      cartReloaded,
      qc.invalidateQueries({ queryKey: ['coupon-previews'] }),
      qc.invalidateQueries({ queryKey: ['my-coupons'] }),
      qc.invalidateQueries({ queryKey: ['quote'] }),
    ]),
  );
}
