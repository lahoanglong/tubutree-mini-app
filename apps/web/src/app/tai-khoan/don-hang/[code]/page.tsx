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
import { fetchMyRefunds, fetchOrder, formatVnd, type OrderDetailDTO } from '@/lib/shop-client';
import {
  addressLine,
  buyerOrderStatusLabel,
  canPayAgain,
  discountRows,
  orderPaymentStatusLabel,
  orderDetailHref,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  safeHttpUrl,
} from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { reviewHref } from '@/lib/reviews-client';
import { RecyclingStatus } from '@/components/recycling-status';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel } from '../../../thanh-toan/bank-transfer-panel';
import { formatDateTime } from '@/lib/format-date';
import { journeyEvents, shippingEventLabel } from '@/lib/shipping-events';
import { OrderActions } from './order-actions';
import { OrderRefunds } from './order-refunds';
import { showsPaymentDeadline, showsRefundPanel } from '@/lib/refund-rules';
import { OrderTimeline } from './order-timeline';

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
  // Lỗi/đang tải thì rơi về hotline mặc định: kênh liên hệ không được biến mất vì API cấu hình chậm.
  const supportQ = useQuery({ queryKey: ['public-support'], queryFn: getPublicSupport, staleTime: 5 * 60_000 });
  const support = supportQ.data ?? DEFAULT_SUPPORT;
  // Tiền về thì đơn hết "chờ thanh toán" và `canPayAgain` thành false ngay lượt tải lại, nên nếu chỉ dựa vào nó khung
  // "Đã nhận thanh toán" bị gỡ ngay sau khi vừa hiện. Ghi nhớ trong trang tới khi khách rời trang.
  const [paidNotice, setPaidNotice] = useState(false);
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
        <p className="py-16 text-center text-stone-600">Đang tải đơn hàng…</p>
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
  return (
    <Shell title={`Đơn hàng #${o.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${orderStatusTone(o.status)}`}>
          {buyerOrderStatusLabel(o)}
        </span>
        <span className="text-sm text-stone-600">Đặt lúc {formatDateTime(o.createdAt)}</span>
      </div>
      {o.manualHandling ? (
        <p className="mt-2 text-sm text-stone-700">Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.</p>
      ) : (
        !canPayAgain(o) &&
        showsPaymentDeadline({ status: o.status, paymentStatus: o.paymentStatus ?? '', paymentDeadline: o.paymentDeadline }) && (
          <p className="mt-2 text-sm font-medium text-warning-fg">
            Thanh toán trước <b>{formatDateTime(o.paymentDeadline!)}</b> — quá hạn đơn sẽ tự huỷ.
          </p>
        )
      )}

      {o.fulfilment?.kind === 'MERCHANT' && (
        <p className="mt-2 text-sm text-stone-700">
          Giao bởi <span className="font-semibold text-stone-900">{o.fulfilment.name}</span> (gian hàng đối tác tự đóng gói và giao)
          {o.fulfilment.phone && (
            <>
              {' '}· Liên hệ gian hàng: <span className="font-semibold text-stone-900">{o.fulfilment.phone}</span>
            </>
          )}
        </p>
      )}
      {(o.siblings?.length ?? 0) > 0 && (
        <section aria-label="Đơn cùng lần đặt" className={`mt-3 p-3 text-sm ${ui.card}`}>
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

      {(canPayAgain(o) || paidNotice) && (
        <div className="mt-2">
          {canPayAgain(o) && (
            <p className="rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
              Đơn đang chờ bạn chuyển khoản. Quét mã bên dưới để thanh toán, hệ thống tự xác nhận khi nhận được tiền.
            </p>
          )}
          <BankTransferPanel order={o} onPaid={refreshOrder} />
        </div>
      )}

      <OrderTimeline status={o.status} />
      <OrderActions order={o} userId={user?.id} />
      {o.id && showsRefundPanel(o) && <OrderRefunds orderId={o.id} />}

      <section className={`mt-4 p-4 ${ui.card}`}>
        <h2 className={ui.sectionTitle}>Sản phẩm</h2>
        <ul className="mt-2 divide-y divide-stone-200">
          {o.items.map((it, i) => (
            <li key={`${it.productName}-${it.variationName}-${i}`} className="flex gap-3 py-3">
              <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-control bg-forest-50">
                {it.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Leaf className="h-5 w-5 text-forest-600" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-stone-900">{it.productName}</div>
                {it.variationName && <div className="text-xs text-stone-600">{it.variationName}</div>}
                <div className="mt-0.5 text-xs text-stone-600">
                  {formatVnd(it.unitPrice)} × {it.quantity}
                </div>
                {/* Mỗi lần mua một đánh giá: dòng đã đánh giá ở đơn này thì mở sửa đúng đánh giá đó. */}
                {o.status === 'DELIVERED' && it.productSlug && (it.reviewId || it.reviewable !== false) && (
                  <Link
                    href={reviewHref(it.productSlug, o.id)}
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest-700 underline"
                  >
                    <Star className="h-4 w-4" aria-hidden="true" />
                    {it.reviewId ? 'Sửa đánh giá' : 'Viết đánh giá'}
                  </Link>
                )}
              </div>
              <div className="flex-none text-sm font-semibold text-stone-900">{formatVnd(it.total)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`mt-4 p-4 ${ui.card}`}>
        <h2 className={ui.sectionTitle}>Thanh toán</h2>
        <div className="mt-2 space-y-1 text-sm">
          <Row label="Tạm tính" value={formatVnd(o.subtotal)} />
          {/* Order.discount là tổng mã + combo + giảm hạng + Điểm Xanh: mỗi khoản một dòng, cùng cách tách với Mini App. */}
          {discountRows(o).map((r) => (
            <Row key={r.label} label={r.label} value={`-${formatVnd(r.amount)}`} positive />
          ))}
          <Row label="Phí vận chuyển" value={o.shippingFee === 0 ? 'Miễn phí' : formatVnd(o.shippingFee)} />
          <div className="flex justify-between border-t border-stone-200 pt-2 font-bold text-stone-900">
            <span>Tổng cộng</span>
            <span>{formatVnd(o.total)}</span>
          </div>
          <Row label="Phương thức" value={paymentMethodLabel(o.paymentMethod)} />
          {o.paymentStatus && <PaymentStatusRow order={o} />}
        </div>
      </section>

      <DeliverySection order={o} />
      <RecyclingStatus order={o} />

      {o.note && (
        <section className={`mt-4 p-4 ${ui.card}`}>
          <h2 className={ui.sectionTitle}>Ghi chú</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-stone-700">{o.note}</p>
        </section>
      )}

      <p className="mt-6 text-sm text-stone-600">
        Cần hủy hoặc đổi đơn? Gọi hotline {support.hotline} hoặc email {support.email}
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
    <section className={`mt-4 p-4 ${ui.card}`}>
      <h2 className={ui.sectionTitle}>Giao hàng</h2>
      <div className="mt-2 space-y-1 text-sm">
        {contact && <p className="font-medium text-stone-900">{contact}</p>}
        {line && <p className="text-stone-700">{line}</p>}
        {!contact && !line && addr?.note && <p className="text-stone-700">{addr.note}</p>}
        {o.shippingPartner && <Row label="Đơn vị vận chuyển" value={o.shippingPartner} />}
        {o.shippingCode && <Row label="Mã vận đơn" value={o.shippingCode} />}
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

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${positive ? 'text-success-fg' : 'text-stone-900'}`}>
      <span className={positive ? '' : 'text-stone-600'}>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/tai-khoan" className={ui.backLink}>
        ← Đơn hàng của tôi
      </Link>
      <h1 className={`mt-1 break-words ${ui.pageTitle}`}>{title}</h1>
      <div className="mt-3">{children}</div>
    </main>
  );
}

/** Cùng khoá với khối Hoàn tiền: đơn REFUNDED còn khoản chuyển khoản chưa xong thì "Đang hoàn tiền". */
function PaymentStatusRow({ order: o }: { order: OrderDetailDTO }) {
  const refunds = useQuery({
    queryKey: ['my-refunds', o.id],
    queryFn: () => fetchMyRefunds(o.id!),
    enabled: !!o.id && o.paymentStatus === 'REFUNDED',
    retry: 0,
  });
  return <Row label="Tình trạng" value={orderPaymentStatusLabel(o, refunds.data)} />;
}
