import { Recycle } from 'lucide-react';
import { recyclingPickupView, type RecyclingTone } from '@/lib/recycling';
import type { OrderDTO } from '@/lib/shop-client';

const TONE: Record<RecyclingTone, string> = {
  progress: 'border-forest-200 bg-forest-50 text-forest-800',
  success: 'border-forest-200 bg-forest-50 text-forest-800',
  warning: 'border-warning-fg bg-warning-bg text-warning-fg',
  muted: 'border-stone-200 bg-stone-50 text-stone-700',
};

/**
 * Trạng thái thu gom vật liệu tái chế cho KHÁCH ở "Đơn hàng của tôi" — cùng nội dung recyclingPickupView
 * của miniapp: nói đúng việc hệ thống đã làm (chờ thanh toán / đã đặt lịch / CSKH sẽ liên hệ / đã huỷ;
 * đơn đã giao hoặc đã được xử lý tay thì chỉ nhắc nhắn Zalo OA, không hứa CSKH gọi). API trả đủ cột của
 * Order (gồm shippingCode/shippingPartner) nên truyền nguyên object đơn.
 */
export function RecyclingStatus({ order }: { order: OrderDTO }) {
  if (!order.hasRecyclingPickup) return null;
  const v = recyclingPickupView(order);
  return (
    <div className={`mt-2 rounded-control border p-3 text-xs ${TONE[v.tone]}`} aria-label="Thu gom vật liệu tái chế">
      <div className="flex items-center gap-1.5 font-semibold">
        <Recycle className="h-3.5 w-3.5" aria-hidden="true" /> Thu gom tái chế: {v.title}
      </div>
      <p className="mt-0.5 leading-relaxed">{v.detail}</p>
      {v.waybill && (
        <p className="mt-0.5">
          Mã vận đơn BestExpress: <span className="font-mono font-semibold">{v.waybill}</span>
        </p>
      )}
      {order.recyclingNote && <p className="mt-0.5 text-stone-600">Bạn gửi kèm: {order.recyclingNote}</p>}
    </div>
  );
}
