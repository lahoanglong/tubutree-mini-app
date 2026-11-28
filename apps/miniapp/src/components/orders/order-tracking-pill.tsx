import { useEffect, useRef, useState } from 'react';
import { Copy, Truck } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Text } from '../ui/text';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import '../../css/order-tracking-pill.css';

export interface OrderTrackingPillProps {
  /** Mã vận đơn của hãng. */
  code: string;
  partner?: string | null;
}

const COPIED_MS = 2000;
const FAILED_MS = 4000;

/** Nhãn đọc của nút chép mã: viên in cả hãng cạnh mã nên nói hãng (khách biết dán mã vào ứng dụng nào); chưa có hãng thì chỉ đọc mã. */
export const copyTrackingLabel = (code: string, partner?: string | null) =>
  partner ? fillCopy('order.shipping.copyAriaPartner', { code, partner }) : fillCopy('order.shipping.copyAria', { code });

/**
 * Chép mã vận đơn của viên: khoá chạm đúp trong cùng khung hình, kết quả tự tắt sau 2 giây (chép được) hoặc 4 giây (không chép được).
 * `announce` đổi mỗi lần để vùng báo đọc lại cả khi kết quả giống lần trước.
 */
export function useCopyTrackingCode(code: string) {
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [announce, setAnnounce] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    haptic('light');
    try {
      const ok = await copyText(code);
      clearTimeout(timer.current);
      setResult(ok ? 'ok' : 'fail');
      setAnnounce((n) => n + 1);
      timer.current = setTimeout(() => setResult(null), ok ? COPIED_MS : FAILED_MS);
    } finally {
      busy.current = false;
    }
  };
  return { copy, result, announce };
}

/** Vùng báo chép được/không ngay dưới nút (role=status luôn có mặt), không bắn thông báo nổi. */
export function CopyTrackingStatus({ result, announce }: { result: 'ok' | 'fail' | null; announce: number }) {
  return (
    <div role="status">
      {result && (
        <Text key={announce} variant="caption" tone={result === 'ok' ? 'success' : 'danger'} as="div">
          {result === 'ok' ? 'Đã sao chép mã vận đơn' : 'Không sao chép được — hãy chép mã thủ công.'}
        </Text>
      )}
    </div>
  );
}

/**
 * Viên mã vận đơn trong thẻ Vận chuyển của Chi tiết đơn (`OrderShipping`), cùng hình với viên của web. Mini App không mở trang hãng (chính sách Zalo 4.1)
 * nên chạm viên là chép mã để dán vào ứng dụng của hãng; đây là nút chép DUY NHẤT của trang, ở mọi trạng thái đơn có mã (kể cả đơn đã huỷ/hoàn, để đối chiếu).
 */
export function OrderTrackingPill({ code, partner }: OrderTrackingPillProps) {
  const { copy, result, announce } = useCopyTrackingCode(code);
  return (
    <div data-testid="order-tracking-pill">
      <button type="button" className="tubu-press touch-target tubu-order-track-pill" aria-label={copyTrackingLabel(code, partner)} onClick={() => void copy()}>
        <Truck className="tubu-order-track-icon" aria-hidden="true" />
        <span className="tubu-order-track-code" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {code}
          {partner && <span className="tubu-order-track-partner"> · {partner}</span>}
        </span>
        <span className="tubu-order-track-action">{fillCopy('order.shipping.copy')}</span>
        <Copy className="tubu-order-track-icon" aria-hidden="true" />
      </button>
      <CopyTrackingStatus result={result} announce={announce} />
    </div>
  );
}
