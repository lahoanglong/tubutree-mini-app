'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { bankPaymentHref, orderDetailHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { BankTransferPanel } from '../../bank-transfer-panel';

const TITLE = 'Thanh toán chuyển khoản';

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
        {!paid && (
          <div className="mt-3 text-center">
            <Link href={detail} className={ui.btnSecondary}>
              Để sau / Xem đơn hàng
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className={ui.pageTitle}>{TITLE}</h1>
      {!paid && code && phase === 'authenticated' && (
        <p className="mt-1 text-sm text-stone-600">Mở app ngân hàng / ví bất kỳ để quét mã VietQR bên dưới.</p>
      )}
      <div className="mt-2">{body}</div>
    </main>
  );
}
