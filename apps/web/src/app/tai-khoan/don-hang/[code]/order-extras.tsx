'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Recycle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { WASTE_QUERY_KEYS, getWasteRequestByOrder } from '@tubutree/app-core/api/waste';
import { coreHttp } from '@/lib/core-http';
import { fetchOrdersPage, type OrderDetailDTO } from '@/lib/shop-client';
import { safeHttpUrl } from '@/lib/order-view';
import { getOaPromptState, setOaPromptState, shouldShowFollowOaPrompt } from '@/lib/oa-prompt';
import { isWebRouteReady } from '@/lib/route-map';
import { platformBridge } from '@/lib/platform-bridge';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';

const INVOICE_STATUS_TEXT: Record<string, string> = {
  ISSUED: 'Đã phát hành',
  REQUESTED: 'Đang xử lý',
};

/** Hoá đơn VAT: chỉ khi khách đã yêu cầu; link PDF của nhà phát hành chỉ mở khi là http(s). */
export function OrderInvoice({ order: o }: { order: OrderDetailDTO }) {
  if (!o.invoiceStatus || o.invoiceStatus === 'NOT_REQUESTED') return null;
  const url = safeHttpUrl(o.invoiceUrl);
  return (
    <section className={`mt-4 p-4 ${ui.card}`}>
      <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Hoá đơn VAT</h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-stone-700">{INVOICE_STATUS_TEXT[o.invoiceStatus] ?? 'Phát hành lỗi — vui lòng liên hệ hỗ trợ'}</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={ui.btnSecondary}>
            Tải PDF
          </a>
        )}
      </div>
    </section>
  );
}

/** Phiếu thu rác kèm đơn: chỉ dẫn khi trang phiếu của web đã có (route còn pending thì không có đích để tới). */
export function OrderWasteLink({ order: o }: { order: OrderDetailDTO }) {
  const ready = isWebRouteReady('/doi-rac/yeu-cau/x');
  const q = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'by-order', o.id],
    queryFn: () => getWasteRequestByOrder(coreHttp, o.id!),
    enabled: !!o.hasRecyclingPickup && !!o.id && ready,
    retry: (n, e) => errorStatus(e) !== 404 && n < 2,
  });
  if (!ready || !q.data) return null;
  return (
    <Link
      id="order-waste-request"
      href={`/doi-rac/yeu-cau/${encodeURIComponent(q.data.id)}`}
      className={`mt-4 flex min-h-11 items-center gap-3 p-4 ${ui.card}`}
    >
      <Recycle className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">Yêu cầu thu rác {q.data.code}</span>
        <span className="block text-xs text-stone-600">Xem tiến độ thu rác kèm đơn</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
    </Link>
  );
}

/**
 * Mời theo dõi Zalo OA sau đơn đầu tiên (đúng lúc thiện chí cao nhất, không hỏi lúc mở trang nguội).
 * Web không đọc được trạng thái theo dõi: nút mở trang OA để khách tự bấm "Quan tâm", rồi coi như đã hỏi.
 */
export function FollowOaPrompt() {
  const hasOA = platformBridge.oa.available;
  // Mặc định seen=true để không nháy thẻ rồi ẩn trong lúc chờ đọc cờ đã lưu trên máy.
  const [seen, setSeen] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!hasOA) return;
    let alive = true;
    void getOaPromptState(platformBridge.storage).then((s) => {
      if (!alive) return;
      setSeen(s.promptSeen);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [hasOA]);

  // Chỉ cần biết TỔNG số đơn để suy ra đây có phải đơn đầu tiên; chỉ hỏi khi còn khả năng hiện thẻ.
  const totalQ = useQuery({
    queryKey: ['orders-total-for-oa-prompt'],
    queryFn: () => fetchOrdersPage(1),
    enabled: hasOA && ready && !seen,
  });

  if (notice) {
    return (
      <p role="status" className="mt-3 text-sm font-medium text-success-fg">
        {notice}
      </p>
    );
  }
  if (!shouldShowFollowOaPrompt({ hasOA, promptSeen: seen, ordersTotal: totalQ.data?.meta.total })) return null;

  const follow = async () => {
    setBusy(true);
    const followed = await platformBridge.oa.follow().catch(() => false);
    await setOaPromptState(platformBridge.storage, { promptSeen: true, followed });
    setBusy(false);
    setSeen(true);
    setNotice(followed ? 'Đã theo dõi Tubu Tree trên Zalo!' : 'Đã mở trang Tubu Tree trên Zalo, bấm "Quan tâm" để nhận cập nhật đơn.');
  };
  const later = () => {
    void setOaPromptState(platformBridge.storage, { promptSeen: true });
    setSeen(true);
  };

  return (
    <section aria-label="Theo dõi Zalo" className="mt-3 rounded-card border border-forest-200 bg-forest-50 p-3">
      <p className="text-sm font-semibold text-forest-800">Theo dõi Tubu Tree trên Zalo</p>
      <p className="mt-1 text-xs text-stone-700">Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void follow()} disabled={busy} className={ui.btnPrimary}>
          {busy ? 'Đang mở…' : 'Theo dõi ngay'}
        </button>
        <button type="button" onClick={later} disabled={busy} className={ui.btnText}>
          Để sau
        </button>
      </div>
    </section>
  );
}
