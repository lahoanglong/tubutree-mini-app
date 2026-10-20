'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { bankPaymentHref, orderDetailHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel, type BankPanelState } from '../../bank-transfer-panel';

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
  const detail = orderDetailHref(code);

  // Không làm mới thì chi tiết/danh sách đơn đọc lại từ cache và còn hiện "Chờ thanh toán" ngay sau khi khách vừa thấy "Đã nhận thanh toán".
  const refreshOrders = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['order', code] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc, code]);
  const onPaid = useCallback(() => {
    setPaid(true);
    refreshOrders();
  }, [refreshOrders]);

  const showQr = !paid && !!code && phase === 'authenticated' && panelState === 'ready';

  let body: React.ReactNode;
  if (phase === 'loading') body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if (phase === 'guest' || !code) {
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
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      {showQr ? (
        <PageHeader
          title={TITLE}
          subtitle="Mở app ngân hàng / ví bất kỳ → quét mã VietQR bên dưới"
          subtitleClassName="md:text-sm"
          parentHref={detail}
          bleed={false}
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
