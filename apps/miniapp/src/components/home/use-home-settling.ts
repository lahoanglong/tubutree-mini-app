import { useEffect, useRef, useState } from 'react';
import { HOME_SETTLE_MAX_MS, homeSettling, type HomeKindState } from '@tubutree/app-core/home-layout';

/**
 * Còn giữ khung chờ chung cho các khối dưới thẻ thành viên không (xem `homeSettling`). Đã nhả thì không giữ lại nữa: làm mới nền
 * (poll Giờ vàng, kéo để làm mới) không được đổi cả trang về khung chờ.
 */
export function useHomeSettling(
  kind: HomeKindState,
  dataPending: boolean,
  /** Khôi phục phiên thất bại (mất mạng, API tạm lỗi): không còn gì để chờ, nhả ngay để các khối tự hiện lỗi kèm "Thử lại" thay vì trắng 4,5 giây. */
  sessionFailed = false,
): boolean {
  // Web dựng khung hình đầu giống HTML server (khách vãng lai) rồi mới biết có phiên cũ chưa nhớ loại khách, nên tính cả lần "chưa biết" đến sau.
  const sawUnknown = useRef(false);
  if (kind === 'unknown') sawUnknown.current = true;
  const startedUnknown = sawUnknown.current;
  const [released, setReleased] = useState(false);
  const settling = !sessionFailed && !released && homeSettling({ startedUnknown, kind, dataPending });
  useEffect(() => {
    if (startedUnknown && !settling) setReleased(true);
  }, [startedUnknown, settling]);
  useEffect(() => {
    if (!startedUnknown) return;
    const t = setTimeout(() => setReleased(true), HOME_SETTLE_MAX_MS);
    return () => clearTimeout(t);
  }, [startedUnknown]);
  return settling;
}
