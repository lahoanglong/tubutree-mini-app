import { Recycle } from 'lucide-react';
import { recyclingPickupView, type RecyclingTone } from '@/lib/recycling';
import type { OrderDTO } from '@/lib/shop-client';

const TONE: Record<RecyclingTone, string> = {
  progress: 'border-leaf-200 bg-leaf-50 text-leaf-900',
  success: 'border-leaf-200 bg-leaf-50 text-leaf-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  muted: 'border-neutral-200 bg-neutral-50 text-neutral-700',
};

/**
 * Trạng thái thu gom vật liệu tái chế cho KHÁCH ở "Đơn hàng của tôi" — cùng nội dung recyclingPickupView
 * của miniapp: nói đúng việc hệ thống đã làm (chờ thanh toán / đã đặt lịch / CSKH sẽ liên hệ / đã huỷ).
 */
export function RecyclingStatus({ order }: { order: OrderDTO }) {
  if (!order.hasRecyclingPickup) return null;
  const v = recyclingPickupView(order);
  return (
    <div className={`mt-2 rounded-md border p-2.5 text-xs ${TONE[v.tone]}`} aria-label="Thu gom vật liệu tái chế">
      <div className="flex items-center gap-1.5 font-semibold">
        <Recycle className="h-3.5 w-3.5" aria-hidden /> Thu gom tái chế: {v.title}
      </div>
      <p className="mt-0.5 leading-relaxed">{v.detail}</p>
      {v.waybill && (
        <p className="mt-0.5">
          Mã vận đơn BestExpress: <span className="font-mono font-semibold">{v.waybill}</span>
        </p>
      )}
      {order.recyclingNote && <p className="mt-0.5 text-neutral-600">Bạn gửi kèm: {order.recyclingNote}</p>}
    </div>
  );
}
