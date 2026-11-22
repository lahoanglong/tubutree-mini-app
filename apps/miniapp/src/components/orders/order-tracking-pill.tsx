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

/**
 * Viên vận đơn ngay dưới thẻ trạng thái của Chi tiết đơn, cùng chỗ và cùng hình với viên tra cứu của web, để khách đang chờ hàng lấy mã mà không phải cuộn.
 * Mini App không mở trang hãng (chính sách Zalo 4.1) nên chạm viên là chép mã để dán vào ứng dụng của hãng; đây là nút chép DUY NHẤT của trang (khối Vận chuyển
 * chỉ còn in hãng và mã). Báo chép được/không ngay dưới viên (role=status), không bắn thông báo nổi.
 */
export function OrderTrackingPill({ code, partner }: OrderTrackingPillProps) {
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [announce, setAnnounce] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    // Chạm đúp trong cùng một khung hình: lần sau bỏ qua tới khi lần chép đầu xong.
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
  return (
    <div className="tubu-order-track" data-testid="order-tracking-pill">
      <button type="button" className="tubu-press touch-target tubu-order-track-pill" aria-label={fillCopy('order.shipping.copyAria', { code })} onClick={() => void copy()}>
        <Truck className="tubu-order-track-icon" aria-hidden="true" />
        <span className="tubu-order-track-code" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {code}
          {partner && <span className="tubu-order-track-partner"> · {partner}</span>}
        </span>
        <span className="tubu-order-track-action">{fillCopy('order.shipping.copy')}</span>
        <Copy className="tubu-order-track-icon" aria-hidden="true" />
      </button>
      <div role="status">
        {result && (
          <Text key={announce} variant="caption" tone={result === 'ok' ? 'success' : 'danger'} as="div">
            {result === 'ok' ? 'Đã sao chép mã vận đơn' : 'Không sao chép được — hãy chép mã thủ công.'}
          </Text>
        )}
      </div>
    </div>
  );
}
