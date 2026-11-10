'use client';

import { ui } from '@/lib/guest-ui';
import { usePressLock } from '@/lib/use-press-lock';

/**
 * "Thử lại" cạnh dòng báo lỗi tải của thanh toán (địa chỉ, báo giá, giỏ). Khi truy vấn đã có số cũ, mỗi `refetch()` huỷ lần tải trước
 * rồi hỏi lại, mà dòng báo lỗi còn nguyên trong lúc tải nên khách không thấy gì xảy ra và chạm tiếp: nút khoá bằng ref tới khi
 * tải xong. Không `disabled` thật vì nút đang giữ focus (Chromium thả focus về body); `aria-disabled` đã làm mờ nút.
 */
export function InlineRetry({ onRetry }: { onRetry: () => PromiseLike<unknown> }) {
  const retry = usePressLock(onRetry);
  return (
    <button type="button" onClick={retry.press} aria-busy={retry.busy || undefined} aria-disabled={retry.busy || undefined} className={ui.btnText}>
      Thử lại
    </button>
  );
}
