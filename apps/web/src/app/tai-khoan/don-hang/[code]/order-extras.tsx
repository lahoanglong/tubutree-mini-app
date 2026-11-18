'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INVOICE_ISSUE_FAILED } from '@tubutree/app-core/client-copy';
import Link from 'next/link';
import { ChevronRight, Recycle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { WASTE_QUERY_KEYS, getWasteRequestByOrder } from '@tubutree/app-core/api/waste';
import { returnPackagingQuery, wasteMeQuery } from '@tubutree/app-core/queries/waste';
import {
  SECOND_ORDER_METHOD,
  secondOrderInviteCopyFor,
  secondOrderInviteDecision,
  secondOrderInvitePath,
  secondOrderOrderGate,
} from '@tubutree/app-core/second-order-invite';
import { coreHttp } from '@/lib/core-http';
import { fetchOrdersPage, type OrderDetailDTO } from '@/lib/shop-client';
import { safeHttpUrl } from '@/lib/order-view';
import { getOaPromptState, setOaPromptState, shouldShowFollowOaPrompt } from '@/lib/oa-prompt';
import { isWebRouteReady } from '@/lib/route-map';
import { platformBridge } from '@/lib/platform-bridge';
import { trackRecycleStep } from '@/lib/recycle-funnel';
import { usePublicConfig } from '@/lib/use-public-config';
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
        <span className="text-stone-700">{INVOICE_STATUS_TEXT[o.invoiceStatus] ?? INVOICE_ISSUE_FAILED}</span>
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
 * Đơn đã giao: một thẻ mời giữ bao bì gửi kèm đơn kế tiếp (miễn ship 100%, tích Điểm Xanh). Luật hiện/ẩn ở app-core, gồm trần yêu cầu mở của W179;
 * chung với Mini App (`components/orders/second-order-invite.tsx`). Cả thẻ là một liên kết, không có CTA thứ hai trên trang.
 */
export function OrderSecondOrderInvite({ order: o, fallback }: { order: OrderDetailDTO; fallback?: ReactNode }) {
  // Cổng đơn đứng ngoài để đơn đang giao, đã huỷ hay quá 14 ngày không kéo thêm lời gọi /config/public nào.
  if (secondOrderOrderGate(o) !== null) return fallback ?? null;
  return <SecondOrderInviteCard order={o} fallback={fallback} />;
}

/** `fallback` thay chỗ thẻ khi đã biết chắc thẻ không hiện (cấu hình và /waste/me đã về), để trang không nhảy từ dòng thay thế sang thẻ. */
function SecondOrderInviteCard({ order: o, fallback }: { order: OrderDetailDTO; fallback?: ReactNode }) {
  const cfg = usePublicConfig();
  const ready = isWebRouteReady('/doi-rac/tao');
  // Chỉ hỏi /waste/me khi đơn đủ điều kiện và đường kèm đơn đang bật: đơn đang giao, đã kèm rác hay cổng đóng không tốn thêm lời gọi nào.
  const orderOk = ready && cfg.isLoaded && cfg.waste.pickup && secondOrderOrderGate(o) === null;
  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: orderOk });
  // Cờ `checkout.return_packaging_nudge_enabled`: thẻ nêu đúng bao bì của đơn, chạm vào thì màn tạo yêu cầu điền sẵn số lượng.
  const packQ = useQuery({ ...returnPackagingQuery(coreHttp, o.code), enabled: orderOk && cfg.returnPackagingNudgeEnabled === true, staleTime: 60_000 });
  const visible = ready && secondOrderInviteDecision({ order: o, cfgPickup: cfg.waste.pickup, me: meQ.data }).show;
  const packaging = packQ.data?.suggestion ?? null;
  const shown = useRef(false);
  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    trackRecycleStep('second_order_shown', SECOND_ORDER_METHOD);
  }, [visible]);
  if (!visible) return cfg.isLoaded && !meQ.isLoading ? (fallback ?? null) : null;
  // Chờ bao bì về rồi mới vẽ để chữ thẻ không đổi ngay dưới tay khách; lỗi thì giữ chữ cũ.
  if (packQ.isLoading) return null;
  const copy = secondOrderInviteCopyFor(packaging);
  return (
    <Link
      id="order-second-order-invite"
      href={secondOrderInvitePath('/doi-rac/tao', o.code, packaging !== null)}
      aria-label={copy.aria}
      onClick={() => trackRecycleStep('second_order_click', SECOND_ORDER_METHOD)}
      className={`mt-4 flex min-h-11 items-center gap-3 p-4 ${ui.card}`}
    >
      <Recycle className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{copy.title}</span>
        <span className="block text-xs text-stone-600 tabular-nums">{copy.subtitle}</span>
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
  // `busy` chỉ đúng sau lần vẽ kế: hai cú bấm cùng nhịp vẫn thấy false và mở trang OA hai lần.
  const busyRef = useRef(false);
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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const followed = await platformBridge.oa.follow().catch(() => false);
      await setOaPromptState(platformBridge.storage, { promptSeen: true, followed });
      setSeen(true);
      setNotice(followed ? 'Đã theo dõi Tubu Tree trên Zalo!' : 'Đã mở trang Tubu Tree trên Zalo, bấm "Quan tâm" để nhận cập nhật đơn.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const later = () => {
    if (busyRef.current) return;
    void setOaPromptState(platformBridge.storage, { promptSeen: true });
    setSeen(true);
  };

  return (
    <section aria-label="Theo dõi Zalo" className="mt-3 rounded-card border border-forest-200 bg-forest-50 p-3">
      <p className="text-sm font-semibold text-forest-800">Theo dõi Tubu Tree trên Zalo</p>
      <p className="mt-1 text-xs text-stone-700">Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {/* Nút đang giữ focus: bận thì aria-busy/aria-disabled, không `disabled` (Chromium thả focus về body). */}
        <button type="button" onClick={() => void follow()} aria-busy={busy || undefined} aria-disabled={busy || undefined} className={ui.btnPrimary}>
          {busy ? 'Đang mở…' : 'Theo dõi ngay'}
        </button>
        <button type="button" onClick={later} aria-disabled={busy || undefined} className={ui.btnText}>
          Để sau
        </button>
      </div>
    </section>
  );
}
