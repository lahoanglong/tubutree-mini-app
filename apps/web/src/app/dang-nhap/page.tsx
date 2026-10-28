'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { homeText } from '@/lib/home-text';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import tubuLogo from '@/assets/tubu-logo.png';
import { useAuth } from '@/lib/auth-context';
import { DEFAULT_SUPPORT, getPublicSupport } from '@/lib/api';
import { loginFailureMessage } from '@/lib/login-errors';
import { rememberReturnTo, safeReturnPath } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { miniAppLink } from '@/lib/zalo-mini-app';
import { QrCode } from '@/components/ui/qr-code';
import { LoginSkeleton } from './login-skeleton';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));
  const { status, startZaloLogin, zaloLoginConfigured } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `=== false`: chỉ báo "chưa cấu hình" khi biết chắc; context cũ không có cờ vẫn cho bấm.
  const unavailable = zaloLoginConfigured === false;
  const supportQ = useQuery({
    queryKey: ['public-support'],
    queryFn: getPublicSupport,
    staleTime: 5 * 60_000,
    enabled: unavailable,
  });
  const support = supportQ.data ?? DEFAULT_SUPPORT;
  // Cùng cache với Trang chủ; lỗi hay thiếu số thì không hứa gì (không có số dự phòng), nút đăng nhập vẫn dùng bình thường.
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, retry: false });
  const welcome = cfgQ.data?.newCustomer?.welcomeVoucher;
  const benefit =
    welcome && welcome.amount > 0
      ? `${homeText.newGift.title}: ${homeText.newGift.voucherAmount(formatVnd(welcome.amount))}${welcome.minOrder > 0 ? `, ${homeText.newGift.voucherMinOrder(formatVnd(welcome.minOrder)).toLowerCase()}` : ''}.`
      : null;
  const miniAppUrl = miniAppLink(returnTo);

  useEffect(() => {
    if (status === 'authenticated') router.replace(returnTo ?? '/');
  }, [status, router, returnTo]);

  const onLogin = async () => {
    setError(null);
    setBusy(true);
    // Ghi (hoặc xoá) trước khi rời trang: callback đọc lại sau vòng chuyển hướng Zalo.
    rememberReturnTo(returnTo);
    try {
      await startZaloLogin();
    } catch (e) {
      console.error('[dang-nhap] không bắt đầu được đăng nhập Zalo', e);
      setError(loginFailureMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <Image src={tubuLogo} alt="Tubu Tree" width={160} height={58} priority className="h-[58px] w-[160px] object-contain" />
      <h1 className="mt-5 font-display text-2xl font-semibold text-forest-800">Đăng nhập</h1>
      <p className="mt-2 text-stone-700">
        Đăng nhập để mua sắm, tích Điểm Xanh và đồng bộ giỏ hàng với Zalo Mini App.
      </p>
      {benefit && (
        <p data-testid="login-benefit" className="mt-3 rounded-control bg-forest-50 px-3 py-2 text-sm font-medium text-forest-800">
          {benefit}
        </p>
      )}

      {unavailable ? (
        <>
          <p role="status" className="mt-6 text-sm font-medium text-stone-800">
            Đăng nhập Zalo trên web đang tạm ngưng. Bạn vẫn mua sắm được trong Zalo.
          </p>
          <a href={miniAppUrl} className={`${ui.btnPrimary} mt-4 w-full`}>
            Mở Tubu Tree trên Zalo
          </a>
          <div className="mt-5 hidden flex-col items-center gap-2 md:flex" data-testid="login-qr">
            <QrCode value={miniAppUrl} size={160} alt="Mã QR mở Tubu Tree trên Zalo" />
            <p className="text-xs text-stone-600">Hoặc quét mã này bằng Zalo trên điện thoại.</p>
          </div>
          <p className="mt-4 text-xs text-stone-600">Cần hỗ trợ đặt hàng? Gọi hotline {formatPhoneDisplay(support.hotline)}.</p>
        </>
      ) : (
        <>
          <button type="button" onClick={onLogin} disabled={busy} className={`${ui.btnPrimary} mt-8 w-full`}>
            {busy ? 'Đang chuyển tới Zalo…' : 'Đăng nhập với Zalo'}
          </button>

          {error && (
            <p role="alert" className={`mt-4 ${ui.error}`}>
              {error}
            </p>
          )}

          <a href={miniAppUrl} className={`${ui.btnSecondary} mt-3 w-full`}>
            Mở trên Zalo
          </a>
          <p className="mt-2 text-xs text-stone-600">Đã dùng Zalo? Mở Mini App Tubu Tree để mua sắm mà không cần đăng nhập lại.</p>
        </>
      )}

      {!unavailable && (
        <p className="mt-3 text-xs text-stone-600">
          Bằng việc đăng nhập, bạn đồng ý với{' '}
          <Link href="/chinh-sach/dieu-khoan" className="tubu-inline-link font-medium text-forest-700 underline underline-offset-2">
            Điều khoản
          </Link>{' '}
          và{' '}
          <Link href="/chinh-sach/bao-mat" className="tubu-inline-link font-medium text-forest-700 underline underline-offset-2">
            Chính sách bảo mật
          </Link>
          .
        </p>
      )}

      <Link href="/" className={`${ui.backLink} mt-4 text-stone-600 hover:text-stone-900`}>
        {unavailable ? 'Tiếp tục xem sản phẩm' : 'Quay lại trang chủ'}
      </Link>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginInner />
    </Suspense>
  );
}
