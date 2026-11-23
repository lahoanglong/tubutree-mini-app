'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COD_SWITCH_DONE } from '@tubutree/app-core/bank-payment-copy';
import { buildOrderTimelineSteps, orderTimelineStamps } from '@tubutree/app-core/commerce/order-timeline';
import { CodSwitchAction } from '@/components/orders/cod-switch-action';
import { GuestReorderNoteBox } from '@/components/orders/guest-reorder-note';
import { OrderTimelineTracker } from '@/components/orders/order-timeline-tracker';
import { DesktopLines, MobileItems, NO_LINE_FIX, Row, type CheckoutLineView } from '@/components/checkout/checkout-lines';
import { AuthLoading } from '@/components/login-required';
import { PageHeader } from '@/components/ui/page-header';
import { mini } from '@/components/order-mobile/mobile-ui';
import { useAuthPhase } from '@/lib/auth-phase';
import { ApiError } from '@/lib/client-api';
import { copyText } from '@/lib/copy-text';
import { actionErrorText } from '@/lib/error-text';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { orderDetailHref, orderStatusLabel, paymentMethodLabel } from '@/lib/order-view';
import { loginHref } from '@/lib/return-to';
import { guestReorder, guestSwitchToCod, guestTrackOrder } from '@/lib/guest-checkout/api';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { useGuestOrderClaim } from '@/lib/guest-checkout/claim';
import { guestBankHref, guestTrackHref, hashTrackingKey, savedGuestOrderKey } from '@/lib/guest-checkout/keys';
import { useGuestCartFlag } from '@/lib/guest-cart/flag';
import { addReorderLines, saveGuestReorderNote, type GuestReorderNote } from '@/lib/guest-cart/reorder';

function readCode(raw: string | undefined): string {
  try {
    return decodeURIComponent(raw ?? '').trim();
  } catch {
    return '';
  }
}

/** Khoá ở phần `#k=` (đọc ở trình duyệt, không đi lên máy chủ); không có thì dùng khoá đã lưu khi đặt trên chính trình duyệt này. */
function useTrackingKey(code: string): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setKey(hashTrackingKey(window.location.hash) ?? (code ? savedGuestOrderKey(code) : null));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [code]);
  return key;
}

/**
 * Theo dõi đơn đặt không đăng nhập (`/don/<mã>#k=<khoá>`): trạng thái, món, tiền, SĐT che 4 số giữa, chỉ phường và tỉnh. Sai mã, sai khoá
 * hay đường dẫn hết hạn đều ra cùng một câu. Khách đăng nhập Zalo trên trình duyệt này thì đơn về tài khoản và trang dẫn sang Đơn của tôi.
 */
export default function GuestOrderPage() {
  const params = useParams<{ code: string }>();
  const code = readCode(params?.code);
  const key = useTrackingKey(code);
  const phase = useAuthPhase();
  const claimed = useGuestOrderClaim(phase === 'authenticated');
  const guestCart = useGuestCartFlag();
  const qc = useQueryClient();
  const [codSwitched, setCodSwitched] = useState(false);
  const q = useQuery({
    queryKey: ['guest-order', code, key],
    queryFn: () => guestTrackOrder(code, key!),
    enabled: !!code && !!key,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: 60_000,
  });
  const o = q.data;

  let body: React.ReactNode;
  if (key === undefined || (q.isPending && !!key)) body = <AuthLoading />;
  else if (!key || (q.isError && q.error instanceof ApiError && q.error.status === 404)) {
    body = (
      <div data-testid="guest-order-not-found" className="py-12 text-center">
        <p className="text-[color:var(--color-text-secondary)]">{guestCopy('notFound')}</p>
        {/* Mất đường dẫn hay đường dẫn hết hạn: tra lại bằng mã đơn (điền sẵn) + SĐT đặt hàng. */}
        <div className="mt-4 flex flex-col items-center gap-2">
          <Link href={code ? `/don?ma=${encodeURIComponent(code)}` : '/don'} data-testid="guest-order-lookup-link" className={ui.btnPrimary}>
            {guestCopy('lookupFromNotFound')}
          </Link>
          <Link href="/" className={ui.btnSecondary}>
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  } else if (q.isError || !o) {
    body = (
      <p role="alert" className={`py-12 text-center ${ui.error}`}>
        Chưa tải được đơn hàng.{' '}
        <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">
          Thử lại
        </button>
      </p>
    );
  } else {
    const steps = buildOrderTimelineSteps(o.status, orderTimelineStamps(o));
    const items: CheckoutLineView[] = o.items.map((it, i) => ({
      id: `${i}`,
      productName: it.isGift ? `${it.productName} (quà 0đ)` : it.productName,
      variationName: it.variationName ?? '',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.total,
      thumbnail: null,
    }));
    const awaitingTransfer = o.paymentMethod === 'BANK_TRANSFER' && o.status === 'PENDING_PAYMENT' && o.paymentStatus !== 'PAID';
    // Mua lại vào giỏ khách: chỉ khi chưa đăng nhập (đã đăng nhập thì Mua lại nằm ở Đơn của tôi) và giỏ khách đang bật.
    const canReorder = (o.status === 'DELIVERED' || o.status === 'CANCELLED') && phase === 'guest' && guestCart.enabled;
    body = (
      <div className="space-y-2 md:space-y-3">
        {claimed !== null && claimed > 0 && (
          <p role="status" data-testid="guest-order-claimed" className="flex flex-wrap items-center gap-x-1 rounded-control bg-success-bg px-3 py-1 text-sm text-success-fg">
            {guestCopy('claimed')}
            <Link href={orderDetailHref(o.code)} className="inline-flex min-h-11 items-center font-semibold underline">
              {guestCopy('claimedLink')}
            </Link>
          </p>
        )}
        <section className={`p-4 ${ui.card} ${mini.band}`} aria-labelledby="guest-order-status">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="guest-order-status" className={`${ui.sectionTitle} ${mini.sectionLabel}`}>
              {orderStatusLabel(o.status)}
            </h2>
            <span className="text-caption tabular-nums text-[color:var(--color-text-tertiary)]">{o.code}</span>
          </div>
          <div className="mt-3">
            <OrderTimelineTracker steps={steps} />
          </div>
          {awaitingTransfer && key && (
            <Link href={guestBankHref(o.code, key)} className={`mt-3 w-full ${ui.btnPrimary}`}>
              Mở mã QR chuyển khoản
            </Link>
          )}
          {o.codSwitchable && !codSwitched && (
            <CodSwitchAction
              total={o.total}
              switchToCod={() => guestSwitchToCod(o.code, key)}
              onSettled={(result) => {
                if (result === 'switched') setCodSwitched(true);
                void q.refetch();
                void qc.invalidateQueries({ queryKey: ['bank-qr', o.code] });
              }}
              className="mt-2"
            />
          )}
          {codSwitched && (
            <p role="status" data-testid="cod-switch-done" className="mt-3 rounded-control bg-success-bg px-3 py-2 text-sm text-success-fg">
              {COD_SWITCH_DONE}
            </p>
          )}
          {canReorder && <GuestReorderButton code={o.code} trackingKey={key} />}
        </section>

        <section className={`p-4 ${ui.card} ${mini.band}`} aria-label="Sản phẩm trong đơn">
          <MobileItems items={items} shipments={null} splitNote={null} fix={NO_LINE_FIX} />
          <DesktopLines items={items} shipments={null} fix={NO_LINE_FIX} />
          <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-2">
            <Row label="Tạm tính" value={formatVnd(o.subtotal)} />
            {o.discount > 0 && <Row label="Giảm giá" value={`-${formatVnd(o.discount)}`} green />}
            <Row label="Phí vận chuyển" value={o.shippingFee === 0 ? 'Miễn phí' : formatVnd(o.shippingFee)} valueGreen={o.shippingFee === 0} />
            <Row label="Thanh toán" value={paymentMethodLabel(o.paymentMethod)} />
          </div>
          <div className="mt-3 flex justify-between border-t border-[var(--color-border-subtle)] pt-3 font-bold text-[color:var(--color-text-primary)]">
            <span>Tổng cộng</span>
            <span className="tabular-nums">{formatVnd(o.total)}</span>
          </div>
        </section>

        <section className={`p-4 ${ui.card} ${mini.band}`} aria-label="Giao hàng">
          <Row label={guestCopy('receiver')} value={<span data-testid="guest-order-phone">{o.phoneMasked}</span>} />
          <Row label={guestCopy('area')} value={[o.area.ward, o.area.province].filter(Boolean).join(', ')} />
        </section>

        <section className={`p-4 ${ui.card} ${mini.band} space-y-3`}>
          <CopyTrackLink code={o.code} trackingKey={key} />
          {o.expiresAt && <p className="text-caption text-[color:var(--color-text-tertiary)]">{guestCopy('expires', { date: formatDate(o.expiresAt) })}</p>}
          {phase !== 'authenticated' && (
            <p className="text-sm">
              <Link href={loginHref(`/don/${encodeURIComponent(o.code)}`)} data-testid="guest-order-claim-link" className="flex min-h-11 items-center font-semibold text-[color:var(--color-text-brand)] underline">
                {guestCopy('claimLink')}
              </Link>
            </p>
          )}
          <p className="text-caption text-[color:var(--color-text-secondary)]">{guestCopy('placedNote')}</p>
        </section>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl md:px-6 md:py-6">
      <PageHeader title={guestCopy('trackTitle')} />
      <div className="mt-2 pb-6 md:pb-0">{body}</div>
    </main>
  );
}

/**
 * "Mua lại đơn này": máy chủ trả các món còn bán (kẹp theo tồn kho), trình duyệt thêm vào giỏ khách rồi sang /gio-hang, nơi báo món bị bỏ.
 * Không món nào vào giỏ thì ở lại trang và báo ngay dưới nút.
 */
function GuestReorderButton({ code, trackingKey }: { code: string; trackingKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ note: GuestReorderNote } | { error: string } | null>(null);
  // Ref: hai cú chạm cùng khung hình chưa kịp vẽ lại thì state `busy` còn cũ, món sẽ bị cộng hai lần.
  const pending = useRef(false);

  const run = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult(null);
    try {
      const out = addReorderLines(await guestReorder(code, trackingKey));
      if (out.kind === 'added') {
        if (out.note) saveGuestReorderNote(out.note);
        router.push('/gio-hang');
        return;
      }
      setResult(out.kind === 'none' ? { note: out.note } : { error: guestCopy('reorderFailed') });
    } catch (e) {
      setResult({ error: actionErrorText(e) });
    }
    pending.current = false;
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-2">
      <button type="button" data-testid="guest-reorder" disabled={busy} onClick={() => void run()} className={`${ui.btnPrimary} w-full`}>
        {guestCopy(busy ? 'reorderBusy' : 'reorderCta')}
      </button>
      {result && 'note' in result && <GuestReorderNoteBox note={result.note} title={guestCopy('reorderNone')} testId="guest-reorder-none" />}
      {result && 'error' in result && (
        <p role="alert" data-testid="guest-reorder-error" className={`text-center text-sm ${ui.error}`}>
          {result.error}
        </p>
      )}
    </div>
  );
}

/**
 * Chép đường dẫn theo dõi đầy đủ (có phần #k=) dựng từ mã và khoá, không chép URL đang mở: quay về từ đăng nhập thì URL không còn #k=
 * (khoá lấy từ bộ nhớ trình duyệt), chép nguyên URL đó sang máy khác sẽ không mở được đơn. Chép lỗi thì nói cách giữ.
 */
function CopyTrackLink({ code, trackingKey }: { code: string; trackingKey: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), state === 'done' ? 2000 : 4000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div>
      <button
        type="button"
        data-testid="guest-order-copy-link"
        onClick={async () => setState((await copyText(`${window.location.origin}${guestTrackHref(code, trackingKey)}`)) ? 'done' : 'fail')}
        className={`${ui.btnSecondary} w-full gap-2`}
      >
        {state === 'done' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {guestCopy(state === 'done' ? 'copied' : 'copyLink')}
      </button>
      <p aria-live="polite" className={state === 'fail' ? 'mt-1 text-caption text-danger-fg' : 'sr-only'}>
        {state === 'fail' ? guestCopy('copyFailed') : state === 'done' ? guestCopy('copied') : ''}
      </p>
    </div>
  );
}
