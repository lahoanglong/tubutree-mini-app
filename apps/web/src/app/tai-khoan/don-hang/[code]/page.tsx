'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Leaf, ExternalLink, Star } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { ApiError } from '@/lib/client-api';
import { DEFAULT_SUPPORT, getPublicSupport } from '@/lib/api';
import { fetchMyRefunds, fetchMyReturns, fetchOrder, formatVnd, type OrderDetailDTO } from '@/lib/shop-client';
import {
  addressLine,
  buyerOrderStatusLabel,
  canCancelOrder,
  discountRows,
  orderPaymentStatusLabel,
  isHandedToCarrier,
  orderDetailHref,
  orderPointsNote,
  orderStamp,
  orderStatusLabel,
  orderStatusTone,
  safeHttpUrl,
} from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { reviewHref } from '@/lib/reviews-client';
import { canPayNow } from '@/components/orders/order-rules';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel, type BankPanelState } from '../../../thanh-toan/bank-transfer-panel';
import { formatDateTime } from '@/lib/format-date';
import { formatCount } from '@/lib/checkout-points';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { journeyEvents, shippingEventLabel } from '@/lib/shipping-events';
import { OrderActions } from './order-actions';
import { OrderRefunds } from './order-refunds';
import { returnedByLine, showsPaymentDeadline, showsRefundPanel } from '@/lib/refund-rules';
import { OrderTimeline } from './order-timeline';
import { FollowOaPrompt, OrderInvoice, OrderWasteLink } from './order-extras';
import { CopyShippingCode } from './copy-shipping-code';
import { TitleBand, mini } from '@/components/order-mobile/mobile-ui';

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
  // Lỗi/đang tải thì rơi về hotline mặc định: kênh liên hệ không được biến mất vì API cấu hình chậm.
  const supportQ = useQuery({ queryKey: ['public-support'], queryFn: getPublicSupport, staleTime: 5 * 60_000 });
  const support = supportQ.data ?? DEFAULT_SUPPORT;
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
        <p className="py-16 text-center text-stone-600 max-md:px-4">Đang tải đơn hàng…</p>
      </Shell>
    );
  }

  if (orderQ.isError || !orderQ.data) {
    // API trả 404 cho cả đơn không tồn tại lẫn đơn của người khác — không phân biệt để không lộ mã đơn.
    const notFound = orderQ.error instanceof ApiError && orderQ.error.status === 404;
    return (
      <Shell title={notFound ? 'Không tìm thấy đơn hàng' : 'Không tải được đơn hàng'}>
        <div className="py-12 text-center">
          <p className="text-stone-700">
            {notFound ? 'Đơn hàng này không tồn tại hoặc không thuộc tài khoản của bạn.' : 'Không tải được đơn hàng, vui lòng thử lại.'}
          </p>
          {!notFound && (
            <button type="button" onClick={() => void orderQ.refetch()} className={`${ui.btnPrimary} mt-4`}>
              Thử lại
            </button>
          )}
        </div>
      </Shell>
    );
  }

  const o = orderQ.data;
  const orderReturns = o.id ? (returnsQ.data ?? []).filter((r) => r.orderId === o.id) : [];
  const stamp = orderStamp(o);
  const pointsReversed = orderReturns.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + (r.pointsReversed ?? 0), 0);
  const pointsNote = orderPointsNote(o.status, o.pointsEarned ?? 0, pointsReversed, o.pointsReturnReversed);
  const cancelClosed = !canCancelOrder(o, user?.id) && isHandedToCarrier(o);
  const showPayPanel = canPayNow(o) || (qrShown && canPayNow(o, 0)) || paidNotice;
  const returnedQty = returnedByLine(
    o.items.filter((it): it is typeof it & { id: string } => !!it.id),
    orderReturns,
  );
  return (
    <Shell title="Chi tiết đơn hàng" subtitle={o.code}>
      <div
        data-testid="status-hero"
        style={{ '--hero-bg': (STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!).bg, '--hero-fg': (STATUS_COLOR[o.status] ?? STATUS_COLOR.CONFIRMED!).fg } as React.CSSProperties}
        className="max-md:bg-[var(--hero-bg)] max-md:p-4 max-md:text-[color:var(--hero-fg)]"
      >
        <div className="flex flex-wrap items-center gap-2 max-md:flex-col-reverse max-md:items-start max-md:gap-0">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${orderStatusTone(o.status)} max-md:bg-transparent max-md:p-0 max-md:text-base max-md:font-semibold max-md:text-[color:inherit]`}
          >
            {buyerOrderStatusLabel(o)}
          </span>
          <span className="text-sm text-stone-600 max-md:text-xs max-md:text-[color:inherit]">
            {stamp.label} {formatDateTime(stamp.at)}
          </span>
        </div>
        {o.manualHandling ? (
          <p className="mt-2 text-sm text-stone-700 max-md:mt-1 max-md:text-xs max-md:text-[color:inherit]">
            Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.
          </p>
        ) : (
          !showPayPanel &&
          showsPaymentDeadline({ status: o.status, paymentStatus: o.paymentStatus ?? '', paymentDeadline: o.paymentDeadline }) && (
            <p className="mt-2 text-sm font-medium text-warning-fg max-md:mt-1 max-md:text-xs max-md:font-normal max-md:text-[color:inherit]">
              Thanh toán trước <b>{formatDateTime(o.paymentDeadline!)}</b> — quá hạn đơn sẽ tự huỷ.
            </p>
          )
        )}
      </div>

      {o.fulfilment?.kind === 'MERCHANT' && (
        <p className="mt-2 text-sm text-stone-700 max-md:px-4">
          Giao bởi <span className="font-semibold text-stone-900">{o.fulfilment.name}</span> (gian hàng đối tác tự đóng gói và giao)
          {o.fulfilment.phone && (
            <>
              {' '}· Liên hệ gian hàng: <span className="font-semibold text-stone-900">{o.fulfilment.phone}</span>
            </>
          )}
        </p>
      )}
      {(o.siblings?.length ?? 0) > 0 && (
        <section aria-label="Đơn cùng lần đặt" className={`mt-3 p-3 text-sm max-md:mx-4 ${ui.card}`}>
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

      {showPayPanel && (
        <div className="mt-2 max-md:px-4">
          {canPayNow(o) && panelState === 'ready' && (
            <p className="rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
              Đơn đang chờ bạn chuyển khoản. Quét mã bên dưới để thanh toán, hệ thống tự xác nhận khi nhận được tiền.
            </p>
          )}
          <BankTransferPanel order={o} onPaid={refreshOrder} onState={onPanelState} />
        </div>
      )}

      <div className="max-md:px-4 max-md:empty:hidden"><FollowOaPrompt /></div>
      <OrderTimeline status={o.status} paymentMethod={o.paymentMethod} />
      <OrderActions order={o} userId={user?.id} />
      {cancelClosed && (
        <p className="mt-3 text-sm text-stone-700 max-md:px-4">
          Đơn đã giao cho đơn vị vận chuyển nên không huỷ được. Khi nhận hàng, bạn có thể gửi yêu cầu đổi/trả.
        </p>
      )}
      <div className="max-md:px-4 max-md:empty:hidden">
        {o.id && showsRefundPanel(o) && <OrderRefunds orderId={o.id} returnRequestIds={new Set(orderReturns.map((r) => r.id))} />}
      </div>

      <section className={`mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
        <h2 className={`${ui.sectionTitle} ${mini.sectionLabel}`}>Sản phẩm</h2>
        <ul className="mt-2 divide-y divide-stone-200">
          {o.items.map((it, i) => (
            <li key={`${it.productName}-${it.variationName}-${i}`} className="flex gap-3 py-3 max-md:py-1.5">
              <div className="flex h-14 w-14 flex-none max-md:hidden items-center justify-center overflow-hidden rounded-control bg-forest-50">
                {it.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {/* Điện thoại: một dòng gọn "tên · phân loại ×SL" như Mini App, không ảnh. */}
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
                {o.status === 'DELIVERED' && it.productSlug && (it.reviewId || it.reviewable !== false) && (
                  <Link
                    href={reviewHref(it.productSlug, o.id)}
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest-700 underline max-md:min-h-0 max-md:py-1 max-md:text-xs max-md:text-[color:var(--color-text-brand)] max-md:no-underline"
                  >
                    <Star className="h-4 w-4" aria-hidden="true" />
                    {it.reviewId ? 'Sửa đánh giá' : 'Viết đánh giá'}
                  </Link>
                )}
              </div>
              <div className="flex-none text-sm font-semibold text-stone-900 max-md:font-normal">{formatVnd(it.total)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
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
          <Row label="Phí vận chuyển" value={o.shippingFee === 0 ? 'Miễn phí' : formatVnd(o.shippingFee)} />
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

      <div className="max-md:px-4 max-md:empty:hidden">
        <OrderInvoice order={o} />
        <OrderWasteLink order={o} />
      </div>
      <DeliverySection order={o} />

      {o.note && (
        <section className={`mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
          <h2 className={ui.sectionTitle}>Ghi chú</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-stone-700">{o.note}</p>
        </section>
      )}

      <p className="mt-6 px-4 text-sm text-stone-600 md:px-0">
        Cần hủy hoặc đổi đơn? Gọi hotline {formatPhoneDisplay(support.hotline)} hoặc email {support.email}
        {support.zaloOaName ? `, hoặc nhắn Zalo OA ${support.zaloOaName}` : ''} để được hỗ trợ.
      </p>
    </Shell>
  );
}

function DeliverySection({ order: o }: { order: OrderDetailDTO }) {
  const addr = o.shippingAddress;
  const line = addressLine(addr);
  const contact = [addr?.recipient, addr?.phone].filter(Boolean).join(' · ');
  const tracking = safeHttpUrl(o.trackingLink);
  const journey = journeyEvents(o.shippingHistory);
  const hasShipping = !!(o.shippingPartner || o.shippingCode || tracking || journey.length > 0);
  // Đơn đại lý giao theo hợp đồng nên snapshot chỉ có `note`; không dựng khối rỗng.
  if (!contact && !line && !addr?.note && !hasShipping) return null;

  return (
    <section className={`mt-4 p-4 max-md:mt-2 ${ui.card} ${mini.band}`}>
      <h2 className={ui.sectionTitle}>Giao hàng</h2>
      <div className="mt-2 space-y-1 text-sm">
        {contact && <p className="font-medium text-stone-900">{contact}</p>}
        {line && <p className="text-stone-700">{line}</p>}
        {!contact && !line && addr?.note && <p className="text-stone-700">{addr.note}</p>}
        {o.shippingPartner && <Row label="Đơn vị vận chuyển" value={o.shippingPartner} />}
        {o.shippingCode && (
          <div className="flex items-center justify-between gap-3">
            <Row label="Mã vận đơn" value={o.shippingCode} />
            <CopyShippingCode code={o.shippingCode} />
          </div>
        )}
        {shippingEventLabel(o.shippingStatus) && (
          <p className="text-xs font-medium text-success-fg">{shippingEventLabel(o.shippingStatus)}</p>
        )}
        {tracking && (
          <a
            href={tracking}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest-700 underline"
          >
            Tra cứu hành trình
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
      {journey.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold text-stone-900">Hành trình vận chuyển</h3>
          <ol className="mt-2 text-sm">
            {journey.map((ev, i) => (
              <li key={`${ev.at ?? ''}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 flex-none rounded-full ${i === 0 ? 'bg-forest-600' : 'bg-stone-300'}`} />
                  {i < journey.length - 1 && <span aria-hidden="true" className="my-0.5 w-0.5 flex-1 bg-stone-200" />}
                </div>
                <div className={`min-w-0 ${i < journey.length - 1 ? 'pb-3' : ''}`}>
                  <p className={i === 0 ? 'font-semibold text-stone-900' : 'text-stone-700'}>
                    {shippingEventLabel(ev.status) ?? (ev.code ? `Đã gán mã vận đơn ${ev.code}` : '—')}
                  </p>
                  {ev.at && <p className="text-xs text-stone-600">{formatDateTime(ev.at)}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
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

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${positive ? 'text-success-fg' : 'text-stone-900'}`}>
      <span className={positive ? '' : 'text-stone-600 max-md:text-[color:var(--color-text-tertiary)]'}>{label}</span>
      <span className="text-right max-md:font-semibold">{value}</span>
    </div>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      <TitleBand title={title} subtitle={subtitle} backHref="/tai-khoan" backLabel="Đơn hàng của tôi" className="md:px-0" />
      <div className="mt-3 max-md:mt-0 max-md:pb-6">{children}</div>
    </main>
  );
}
