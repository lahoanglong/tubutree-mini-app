'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Leaf, Star } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customerOrderNote, isSubscriptionOrder, openProductSlug } from '@tubutree/app-core/api/orders';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { orderDeliveryEtaLabel } from '@tubutree/app-core/shipping-eta';
import { orderActionPlan, orderHeadline, orderTrack, shippingEvents, type TrackOrder } from '@tubutree/app-core/commerce/order-tracking';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { serverNow } from '@tubutree/app-core/server-clock';
import { useAuth } from '@/lib/auth-context';
import { MD_DOWN, useMediaQuery } from '@/lib/use-media-query';
import { useCountdown } from '@/lib/use-countdown';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { ApiError } from '@/lib/client-api';
import { fetchMyRefunds, fetchMyReturns, fetchOrder, formatVnd, type OrderDetailDTO } from '@/lib/shop-client';
import {
  addressLine,
  buyerOrderStatusLabel,
  discountRows,
  orderPaymentStatusLabel,
  bankPaymentHref,
  orderDetailHref,
  orderPointsNote,
  orderStamp,
  orderStatusLabel,
  safeHttpUrl,
} from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { reviewHref } from '@/lib/reviews-client';
import { canPayNow } from '@/components/orders/order-rules';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel, type BankPanelState } from '../../../thanh-toan/bank-transfer-panel';
import { formatDateTime } from '@/lib/format-date';
import { formatCount } from '@/lib/checkout-points';
import { SupportContact } from '@/components/support-contact';
import { shippingEventLabel } from '@/lib/shipping-events';
import { OrderActions } from './order-actions';
import { OrderRefunds } from './order-refunds';
import { returnedByLine, remainingByLine, showsRefundPanel } from '@/lib/refund-rules';
import { OrderStatusHero } from '@/components/orders/order-status-hero';
import { OrderTrack } from '@/components/orders/order-track';
import { OrderShipping } from '@/components/orders/order-shipping';
import { mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { LineItemSkeleton, Skeleton } from '@/components/ui/skeleton';
import { PAGE_NARROW } from '@/lib/page-frame';
import { ProductThumb } from '@/components/mini';

// Phần dưới màn đầu (nhắc theo dõi OA, hoá đơn, đổi rác) tải sau để First Load của trang tăng ít nhất có thể.
const FollowOaPrompt = dynamic(() => import('./order-extras').then((m) => m.FollowOaPrompt), { ssr: false });
const OrderInvoice = dynamic(() => import('./order-extras').then((m) => m.OrderInvoice), { ssr: false });
const OrderWasteLink = dynamic(() => import('./order-extras').then((m) => m.OrderWasteLink), { ssr: false });

/** STATUS_COLOR của Mini App (utils/order-status.ts): dải trạng thái đầu trang chi tiết đơn. */
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: 'var(--color-status-warning-bg)', fg: 'var(--color-status-warning-fg)' },
  CONFIRMED: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  PACKED: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  SHIPPING: { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' },
  DELIVERED: { bg: 'var(--color-status-success-bg)', fg: 'var(--color-status-success-fg)' },
  RETURNED: { bg: 'var(--color-status-neutral-bg)', fg: 'var(--color-status-neutral-fg)' },
  CANCELLED: { bg: 'var(--color-status-danger-bg)', fg: 'var(--color-status-danger-fg)' },
};

/** vi.paymentMethod của Mini App: tên ngắn của phương thức ở dòng "Thanh toán" khối tiền. */
const PAYMENT_METHOD_NAME: Record<string, string> = {
  COD: 'Khi nhận hàng (COD)',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPay',
  XU: 'Điểm Xanh (xu cũ)',
  BANK_TRANSFER: 'Chuyển khoản',
  WALLET: 'Ví Tubu',
};

export default function OrderDetailPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code ?? '';
  const phase = useAuthPhase();
  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  // Điện thoại theo Mini App: đơn chờ chuyển khoản chỉ có dải hạn + nút "Thanh toán ngay" sang trang QR; khung QR nhúng chỉ từ md.
  const isPhone = useMediaQuery(MD_DOWN);
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), enabled: phase === 'authenticated' });
  const orderQ = useQuery({
    queryKey: ['order', code],
    queryFn: () => fetchOrder(code),
    enabled: phase === 'authenticated' && !!code,
    // 404 là câu trả lời dứt khoát (đơn không tồn tại/của người khác): thử lại chỉ làm khách chờ thêm.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
  // Cùng khoá với khối thao tác (OrderActions): yêu cầu trả đã duyệt để đánh dấu dòng đã trả và gộp khoản hoàn vào dòng yêu cầu.
  const orderStatus = orderQ.data?.status;
  const returnsQ = useQuery({
    queryKey: ['my-returns'],
    queryFn: fetchMyReturns,
    enabled: phase === 'authenticated' && (orderStatus === 'DELIVERED' || orderStatus === 'RETURNED'),
    retry: 0,
  });
  // Tiền về thì đơn hết "chờ thanh toán" và `canPayNow` thành false ngay lượt tải lại, nên nếu chỉ dựa vào nó khung
  // "Đã nhận thanh toán" bị gỡ ngay sau khi vừa hiện. Ghi nhớ trong trang tới khi khách rời trang.
  const [paidNotice, setPaidNotice] = useState(false);
  // Khung QR đã dựng lúc còn hạn thì giữ tới khi rời trang (như trang chuyển khoản của Mini App): qua hạn giữa chừng mà
  // gỡ khung là mất lần dò thấy tiền về của khách vừa chuyển sát giờ.
  const [qrShown, setQrShown] = useState(false);
  if (!qrShown && orderQ.data && canPayNow(orderQ.data)) setQrShown(true);
  // Dòng nhắc "quét mã" theo đúng trạng thái khung QR, không theo trạng thái đơn đã lưu đệm: khung đóng (đơn bị huỷ, hết hạn
  // theo giờ máy chủ) thì đơn cũng phải tải lại để trạng thái và dòng nhắc cùng đổi.
  const [panelState, setPanelState] = useState<BankPanelState>('loading');
  const onPanelState = useCallback(
    (state: BankPanelState) => {
      setPanelState(state);
      if (state === 'closed') void qc.invalidateQueries({ queryKey: ['order', code] });
    },
    [qc, code],
  );
  const refreshOrder = useCallback(() => {
    setPaidNotice(true);
    void qc.invalidateQueries({ queryKey: ['order', code] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc, code]);

  // Đếm ngược theo giờ máy chủ chỉ khi đơn còn chờ khách chuyển khoản; hook phải đứng trước các return sớm.
  const deadlineLeft = useCountdown(
    orderQ.data?.status === 'PENDING_PAYMENT' && !orderQ.data.manualHandling ? (orderQ.data.paymentDeadline ?? null) : null,
  );

  if (phase === 'loading') {
    return (
      <Shell title="Chi tiết đơn hàng">
        <AuthLoading />
      </Shell>
    );
  }

  if (phase === 'unavailable') {
    return (
      <Shell title="Chi tiết đơn hàng">
        <SessionUnavailable />
      </Shell>
    );
  }

  if (phase === 'guest') {
    return (
      <Shell title="Chi tiết đơn hàng">
        <LoginRequired message="Đăng nhập để xem đơn hàng của bạn." returnTo={orderDetailHref(code)} />
      </Shell>
    );
  }

  if (orderQ.isLoading) {
    return (
      <Shell title="Chi tiết đơn hàng">
        <div role="status" aria-label="Đang tải đơn hàng" className="flex flex-col gap-2.5 p-4 md:p-0">
          <Skeleton height={64} rounded="rounded-card" />
          <LineItemSkeleton />
          <Skeleton height={120} rounded="rounded-card" />
        </div>
      </Shell>
    );
  }

  if (orderQ.isError || !orderQ.data) {
    // API trả 404 cho cả đơn không tồn tại lẫn đơn của người khác: không phân biệt để không lộ mã đơn.
    const notFound = orderQ.error instanceof ApiError && orderQ.error.status === 404;
    return (
      <Shell title="Chi tiết đơn hàng">
        {notFound ? (
          <ErrorState
            title="Không tìm thấy"
            message="Không tìm thấy đơn hàng này."
            retryLabel="Về trang chủ"
            onRetry={() => router.push('/')}
          />
        ) : (
          <ErrorState message={loadErrorText(orderQ.error)} onRetry={() => void orderQ.refetch()} />
        )}
      </Shell>
    );
  }

  const o = orderQ.data;
  const orderReturns = o.id ? (returnsQ.data ?? []).filter((r) => r.orderId === o.id) : [];
  const stamp = orderStamp(o);
  const etaLabel = orderDeliveryEtaLabel(cfgQ.data?.shippingEta, o);
  const pointsReversed = orderReturns.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + (r.pointsReversed ?? 0), 0);
  const pointsNote = orderPointsNote(o.status, o.pointsEarned ?? 0, pointsReversed, o.pointsReturnReversed);
  const returnDays = cfgQ.data?.returnWindowDays ?? 7;
  const ctx = {
    now: serverNow(),
    userId: user?.id,
    etaLabel,
    returnDays,
    deadlineLeft,
    pendingReturn: orderReturns.some((r) => r.status === 'REQUESTED'),
    returnableLeft: [...remainingByLine(o.items.filter((it): it is typeof it & { id: string } => !!it.id), orderReturns).values()].some((q) => q > 0),
  };
  const trackOrder: TrackOrder = o;
  const headline = orderHeadline(trackOrder, ctx);
  const plan = orderActionPlan(trackOrder, ctx);
  const trackView = orderTrack(trackOrder, { etaLabel });
  const payNote = plan.primary === 'pay' && deadlineLeft ? fillCopy('order.action.payLeft', { t: deadlineLeft }) : null;
  const tracking = safeHttpUrl(o.trackingLink);
  const showPayPanel = !isPhone && (canPayNow(o) || (qrShown && canPayNow(o, 0)) || paidNotice);
  const returnedQty = returnedByLine(
    o.items.filter((it): it is typeof it & { id: string } => !!it.id),
    orderReturns,
  );
  return (
    <Shell title="Chi tiết đơn hàng" subtitle={o.code}>
      <div data-testid="order-layout" className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-x-6">
        <div data-testid="order-main" className="contents lg:flex lg:min-w-0 lg:flex-col">
          <div className="order-1 md:overflow-hidden md:rounded-card">
            <OrderStatusHero headline={headline} statusLabel={buyerOrderStatusLabel(o)} stamp={stamp} tone={STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!} />
          </div>
      {showPayPanel && (
        <div id="order-pay-panel" className="order-2 mt-2 max-md:px-4">
          {canPayNow(o) && panelState === 'ready' && (
            <p className="rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
              Quét mã bên dưới để thanh toán, hệ thống tự xác nhận khi nhận được tiền.
            </p>
          )}
          <BankTransferPanel order={o} onPaid={refreshOrder} onState={onPanelState} />
        </div>
      )}

          <div className="order-3 max-md:px-4 max-md:empty:hidden"><FollowOaPrompt /></div>
          {trackView && (
            <section aria-labelledby="order-track-title" className={`order-4 mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
              <h2 id="order-track-title" className={`${ui.sectionTitle} ${mini.sectionLabel} mb-3`}>
                Hành trình đơn hàng
              </h2>
              <OrderTrack track={trackView} now={ctx.now} />
            </section>
          )}
          {(o.shippingPartner || o.shippingCode || tracking || (!trackView && !!o.shippingHistory?.length)) && (
            <section className={`order-5 mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
              <OrderShipping
                partner={o.shippingPartner}
                code={o.shippingCode}
                status={shippingEventLabel(o.shippingStatus)}
                trackingHref={tracking}
                events={trackView ? undefined : shippingEvents(o.shippingHistory)}
              />
            </section>
          )}
      <section className={`order-6 mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
        <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Sản phẩm</h2>
        <ul className="mt-2 divide-y divide-stone-200">
          {o.items.map((it, i) => {
            // Sản phẩm đã gỡ thì trang sản phẩm trả 404: dòng vẫn hiện, chỉ không dẫn đi đâu.
            const slug = openProductSlug(it);
            const rowBody = (
              <>
                <span className="flex-none md:hidden">
                  <ProductThumb src={it.thumbnail} alt="" size={48} />
                </span>
                <span className="flex-none max-md:hidden">
                  <ProductThumb src={it.thumbnail} alt="" size={56} />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Điện thoại: một dòng gọn "tên · phân loại ×SL" như Mini App. */}
                  <div data-testid="mini-line" className="text-sm text-stone-900 md:hidden">
                    {it.productName}
                    {it.variationName ? ` · ${it.variationName}` : ''}{' '}
                    <span className="text-xs text-[color:var(--color-text-tertiary)]">×{it.quantity}</span>
                  </div>
                  <div className="text-sm font-medium text-stone-900 max-md:hidden">{it.productName}</div>
                  {it.variationName && <div className="text-xs text-stone-600 max-md:hidden">{it.variationName}</div>}
                  <div className="mt-0.5 text-xs text-stone-600 max-md:hidden">
                    {formatVnd(it.unitPrice)} × {it.quantity}
                  </div>
                </div>
              </>
            );
            return (
              <li key={`${it.productName}-${it.variationName}-${i}`} className="py-3 max-md:py-1.5">
                <div className="flex items-center justify-between gap-3">
                  {/* Chạm vào món để mở lại trang sản phẩm. */}
                  {slug ? (
                    <Link href={`/san-pham/${slug}`} aria-label={`Xem sản phẩm ${it.productName}`} className="tubu-press flex min-h-12 min-w-0 flex-1 items-center gap-3">
                      {rowBody}
                    </Link>
                  ) : (
                    <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3">{rowBody}</div>
                  )}
                  <div className="flex-none text-sm font-semibold text-stone-900 max-md:font-normal">{formatVnd(it.total)}</div>
                </div>
                <div className="md:ml-[68px]">
                  {(it.backorderedQty ?? 0) > 0 && (
                    <div className="mt-0.5 inline-block rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
                      Đặt trước {it.backorderedQty}/{it.quantity} — chờ hàng về
                    </div>
                  )}
                  {it.id && returnedQty.has(it.id) && (
                    <div className="mt-0.5 text-xs font-medium text-promo-fg">
                      Đã duyệt trả {returnedQty.get(it.id)}/{it.quantity}
                    </div>
                  )}
                  {/* Mỗi lần mua một đánh giá: dòng đã đánh giá ở đơn này thì mở sửa đúng đánh giá đó. */}
                  {o.status === 'DELIVERED' && slug && (it.reviewId || it.reviewable !== false) && (
                    <Link
                      href={reviewHref(slug, o.id)}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest-700 underline max-md:min-h-0 max-md:py-1 max-md:text-xs max-md:text-[color:var(--color-text-brand)] max-md:no-underline"
                    >
                      <Star className="h-4 w-4" aria-hidden="true" />
                      {it.reviewId ? 'Sửa đánh giá' : 'Viết đánh giá'}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

        </div>
        <div data-testid="order-side" className="contents lg:flex lg:min-w-0 lg:flex-col">
      <section className={`order-7 mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
        <h2 className={`${ui.sectionTitle} max-md:sr-only`}>Thanh toán</h2>
        <div className="mt-2 space-y-1 text-sm max-md:mt-0 max-md:space-y-2">
          <Row label="Tạm tính" value={formatVnd(o.subtotal)} />
          {/* Order.discount là tổng mã + combo + giảm hạng + Điểm Xanh: mỗi khoản một dòng, cùng cách tách với Mini App. */}
          {discountRows(o).map((r) => (
            <Row key={r.label} label={r.label} value={`-${formatVnd(r.amount)}`} positive />
          ))}
          {(o.pointsUsed ?? 0) > 0 && !o.pointsDiscount && (
            <Row label="Điểm Xanh đã dùng" value={`${formatCount(o.pointsUsed ?? 0)} điểm`} />
          )}
          <Row label="Phí vận chuyển" value={o.shippingFee === 0 ? 'Miễn phí' : formatVnd(o.shippingFee)} valueTone={o.shippingFee === 0 ? 'success' : undefined} />
          <div className="flex justify-between border-t border-stone-200 pt-2 font-bold text-stone-900 max-md:border-t-0 max-md:pt-0 max-md:text-base">
            <span>Tổng cộng</span>
            <span>{formatVnd(o.total)}</span>
          </div>
          <Row label="Thanh toán" value={PAYMENT_METHOD_NAME[o.paymentMethod] ?? o.paymentMethod} />
          {o.paymentStatus && (
            <div className="max-md:hidden">
              <PaymentStatusRow order={o} />
            </div>
          )}
          {pointsNote && (
            <p className={`mt-1 flex items-center gap-1 text-xs ${pointsNote.tone === 'success' ? 'text-success-fg' : 'text-stone-700'}`}>
              <Leaf className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              {pointsNote.text}
            </p>
          )}
        </div>
      </section>

      {o.fulfilment?.kind === 'MERCHANT' && (
        <p className="mt-2 text-sm text-stone-700 order-8 max-md:px-4">
          Giao bởi <span className="font-semibold text-stone-900">{o.fulfilment.name}</span> (gian hàng đối tác tự đóng gói và giao)
          {o.fulfilment.phone && (
            <>
              {' '}· Liên hệ gian hàng: <span className="font-semibold text-stone-900">{o.fulfilment.phone}</span>
            </>
          )}
        </p>
      )}
      {(o.siblings?.length ?? 0) > 0 && (
        <section aria-label="Đơn cùng lần đặt" className={`mt-3 p-3 text-sm order-8 max-md:mx-4 ${ui.card}`}>
          <p className="text-stone-700">Lần đặt này được tách theo nơi giao, các đơn còn lại:</p>
          <ul className="mt-1 space-y-1">
            {o.siblings!.map((sb) => (
              <li key={sb.code} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <Link href={orderDetailHref(sb.code)} className="inline-flex min-h-11 items-center font-semibold text-forest-700 underline">
                    {sb.code}
                  </Link>{' '}
                  · {sb.fulfillerName} giao · {orderStatusLabel(sb.status)}
                </span>
                <span className="font-semibold text-stone-900">{formatVnd(sb.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

          <div className="order-9 max-md:px-4 max-md:empty:hidden">
            {o.id && showsRefundPanel(o) && <OrderRefunds orderId={o.id} returnRequestIds={new Set(orderReturns.map((r) => r.id))} />}
          </div>
          <div className="order-10 max-md:px-4 max-md:empty:hidden">
            <OrderInvoice order={o} />
            <OrderWasteLink order={o} />
          </div>
          <div className="order-11">
            <AddressSection order={o} />
          </div>
      {customerOrderNote(o) ? (
        <section className={`mt-4 p-4 order-[12] max-md:mt-2 ${ui.card} ${mini.band}`}>
          <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Ghi chú</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-stone-700">{customerOrderNote(o)}</p>
        </section>
      ) : (
        // Ghi chú cố định của hệ thống không phải lời khách viết: thay bằng nhãn.
        isSubscriptionOrder(o) && (
          <section className={`mt-4 p-4 order-[12] max-md:mt-2 ${ui.card} ${mini.band}`}>
            <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Đơn định kỳ</h2>
            <p className="mt-2 text-sm text-stone-700">Đơn này tự đặt theo lịch bạn đã chọn.</p>
          </section>
        )
      )}

          <div className="order-[13] lg:order-first">
            <OrderActions order={o} plan={plan} note={payNote} />
          </div>
          <div className="order-[14] mt-4 px-4 md:px-0">
            <SupportContact orderCode={o.code} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

function AddressSection({ order: o }: { order: OrderDetailDTO }) {
  const addr = o.shippingAddress;
  const line = addressLine(addr);
  const contact = [addr?.recipient, addr?.phone].filter(Boolean).join(' · ');
  // Đơn đại lý giao theo hợp đồng nên snapshot chỉ có `note`; không dựng khối rỗng.
  if (!contact && !line && !addr?.note) return null;

  return (
    <section className={`mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
      <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Địa chỉ giao hàng</h2>
      <div className="mt-2 space-y-1 text-sm">
        {contact && <p className="font-medium text-stone-900">{contact}</p>}
        {line && <p className="text-stone-700">{line}</p>}
        {!contact && !line && addr?.note && <p className="text-stone-700">{addr.note}</p>}
      </div>
    </section>
  );
}

/** Cùng khoá với khối Hoàn tiền: đơn REFUNDED còn khoản chuyển khoản chưa xong thì "Đang hoàn tiền". Mini App không có dòng này nên chỉ hiện ở máy tính. */
function PaymentStatusRow({ order: o }: { order: OrderDetailDTO }) {
  const refunds = useQuery({
    queryKey: ['my-refunds', o.id],
    queryFn: () => fetchMyRefunds(o.id!),
    enabled: !!o.id && o.paymentStatus === 'REFUNDED',
    retry: 0,
  });
  return <Row label="Tình trạng" value={orderPaymentStatusLabel(o, refunds.data)} />;
}

function Row({ label, value, positive, valueTone }: { label: string; value: string; positive?: boolean; valueTone?: 'success' }) {
  return (
    <div className={`flex justify-between gap-3 ${positive ? 'text-success-fg' : 'text-stone-900'}`}>
      <span className={positive ? '' : 'text-stone-600 max-md:text-[color:var(--color-text-tertiary)]'}>{label}</span>
      <span className={`text-right max-md:font-semibold ${valueTone === 'success' ? 'text-success-fg' : ''}`}>{value}</span>
    </div>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className={`${PAGE_NARROW} py-6 max-md:px-0 max-md:py-0 lg:max-w-none`}>
      <PageHeader title={title} subtitle={subtitle} subtitleClassName="md:text-sm" backHref="/tai-khoan" backLabel="Đơn hàng của tôi" />
      <div className="mt-3 max-md:mt-0 max-md:flex max-md:flex-col max-md:pb-6">{children}</div>
    </main>
  );
}
