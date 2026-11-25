'use client';

import { BANK_QR_HINT } from '@tubutree/app-core/bank-payment-copy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { bankPaymentHref, orderDetailHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel, type BankPanelState } from '../../bank-transfer-panel';
import { PAGE_NARROW } from '@/lib/page-frame';
import { guestBankQr, guestSwitchToCod } from '@/lib/guest-checkout/api';
import { getBankQr, switchOrderToCod } from '@/lib/shop-client';
import { guestTrackHref, hashTrackingKey, savedGuestOrderKey } from '@/lib/guest-checkout/keys';

// Thẻ kết bạn Zalo chỉ hiện khi máy chủ bảo hiện: tải lười để màn QR không mang mã thẻ (và câu chữ của nó) khi thẻ ẩn.
const OrderZaloFriend = dynamic(() => import('@/components/checkout/order-zalo').then((m) => m.OrderZaloFriend), { ssr: false, loading: () => null });

const TITLE = 'Quét QR để chuyển khoản';
// Tên trang của Mini App khi chưa có QR để quét (đã trả, chưa đăng nhập).
const NEUTRAL_TITLE = 'Thanh toán chuyển khoản';

function readCode(raw: string | undefined): string {
  try {
    return decodeURIComponent(raw ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Màn VietQR riêng của đơn chuyển khoản, như `bank-payment.tsx` của Mini App: checkout chuyển sang đây ngay sau khi đặt,
 * "Xem đơn" và danh sách đơn cũng dẫn về đây. Dò trạng thái và khung QR do BankTransferPanel lo (dùng chung với chi tiết đơn).
 */
export default function BankPaymentPage() {
  const params = useParams<{ code: string }>();
  const code = readCode(params?.code);
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const [paid, setPaid] = useState(false);
  const [panelState, setPanelState] = useState<BankPanelState>('loading');
  // Đơn đặt không đăng nhập mở trang này bằng khoá theo dõi ở `#k=` (hoặc khoá đã lưu khi đặt trên trình duyệt này). Chưa đọc xong thì undefined.
  const [guestKey, setGuestKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setGuestKey(hashTrackingKey(window.location.hash) ?? (code ? savedGuestOrderKey(code) : null));
  }, [code]);
  const guestMode = phase === 'guest' && !!guestKey;
  const detail = guestMode ? guestTrackHref(code, guestKey!) : orderDetailHref(code);
  const fetchGuestQr = useCallback((c: string) => guestBankQr(c, guestKey!), [guestKey]);
  const router = useRouter();
  // Thẻ kết bạn Zalo: đọc bản bank-qr BankTransferPanel đang dò (cùng khoá cache), không request riêng. Chốt lần đầu máy chủ bảo hiện: lần dò
  // sau trả false (MSS vừa nhắn được như bạn bè) thì thẻ vẫn ở yên, không nhảy bố cục giữa lúc khách đang đọc.
  const qrCache = useQuery({
    queryKey: guestMode ? ['bank-qr', code, 'guest'] : ['bank-qr', code],
    queryFn: () => (guestMode ? fetchGuestQr : getBankQr)(code),
    enabled: false,
  });
  const zaloCardFor = useRef<string | null>(null);
  if (qrCache.data?.zaloFriendCard === true) zaloCardFor.current = code;
  const zaloCard = zaloCardFor.current === code && (paid || panelState === 'ready');

  // Không làm mới thì chi tiết/danh sách đơn đọc lại từ cache và còn hiện "Chờ thanh toán" ngay sau khi khách vừa thấy "Đã nhận thanh toán".
  const refreshOrders = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['order', code] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc, code]);
  const onPaid = useCallback(() => {
    setPaid(true);
    refreshOrders();
  }, [refreshOrders]);
  // Đổi sang trả tiền khi nhận: đơn không còn chờ chuyển khoản nên rời trang mã QR về đơn (như Mini App); máy chủ từ chối vì đơn vừa đổi thì
  // dò lại mã QR để khung hiện đúng trạng thái mới (đã trả, đã huỷ).
  const codSwitch = useMemo(
    () => ({
      run: () => (guestMode ? guestSwitchToCod(code, guestKey!) : switchOrderToCod(code)),
      onSettled: (result: 'switched' | 'stale') => {
        refreshOrders();
        void qc.invalidateQueries({ queryKey: ['guest-order', code] });
        if (result === 'switched') router.replace(detail);
        else void qc.invalidateQueries({ queryKey: ['bank-qr', code] });
      },
    }),
    [guestMode, code, guestKey, refreshOrders, qc, router, detail],
  );

  // Dải tiêu đề có `data-page-bleed` bỏ đệm 48px của nút lùi ở điện thoại: vẽ nó ngay khi còn chờ phiên hoặc chờ QR (trạng thái cuối thường gặp),
  // vẽ muộn lúc QR về thì cả trang nhảy lên 48px (CLS ~0,8 ở 390px).
  const showQr =
    !paid &&
    !!code &&
    (phase === 'loading' || ((phase === 'authenticated' || guestMode) && (panelState === 'loading' || panelState === 'ready')));

  let body: React.ReactNode;
  if (phase === 'loading' || (phase === 'guest' && guestKey === undefined)) body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if ((phase === 'guest' && !guestMode) || !code) {
    body = <LoginRequired message="Đăng nhập để thanh toán đơn hàng." returnTo={bankPaymentHref(code)} />;
  } else {
    body = (
      <div className="mx-auto max-w-md">
        <BankTransferPanel
          order={{ code, paymentMethod: 'BANK_TRANSFER' }}
          onPaid={onPaid}
          onState={setPanelState}
          showHeading={false}
          orderHref={detail}
          stickyCheck
          // Cùng khung chờ với lúc chờ phiên: hai bước chờ là một khối, cao gần bằng khung QR (CLS điện thoại).
          loadingFallback={<AuthLoading />}
          {...(guestMode ? { fetchQr: fetchGuestQr } : {})}
          codSwitch={codSwitch}
          paidFooter={
            <div className="mt-4 flex flex-col gap-2">
              <Link href={detail} onClick={refreshOrders} className={ui.btnPrimary}>
                Xem đơn hàng
              </Link>
              <Link href="/" className={ui.btnSecondary}>
                Về trang chủ
              </Link>
            </div>
          }
        />
        {!paid && panelState !== 'closed' && panelState !== 'error' && (
          <div className="mt-3 text-center max-md:mx-2 max-md:mt-2">
            <Link href={detail} className={`${ui.btnSecondary} ${mini.secondary} max-md:w-full`}>
              Để sau / Xem đơn hàng
            </Link>
          </div>
        )}
        {zaloCard && (
          <section
            data-testid="bank-zalo-friend"
            className={`mt-3 p-4 ${ui.card} ${mini.card} max-md:mx-2 max-md:mt-2 max-md:p-3`}
            aria-label="Zalo Tubu Tree"
          >
            <OrderZaloFriend code={code} from="bank_transfer" />
          </section>
        )}
      </div>
    );
  }

  return (
    <main className={`${PAGE_NARROW} py-6 max-md:px-0 max-md:py-0`}>
      {showQr ? (
        <PageHeader
          title={TITLE}
          subtitle={BANK_QR_HINT}
          subtitleClassName="md:text-sm"
          parentHref={detail}
        />
      ) : (
        // Mini App chỉ vẽ dải tiêu đề ở trạng thái QR; các trạng thái khác chỉ giữ h1 cho trình đọc và trang cha cho nút lùi.
        <>
          <h1 className="sr-only">{NEUTRAL_TITLE}</h1>
          <span hidden data-back-href={detail} />
        </>
      )}
      <div className="mt-2 max-md:pb-6">{body}</div>
    </main>
  );
}
