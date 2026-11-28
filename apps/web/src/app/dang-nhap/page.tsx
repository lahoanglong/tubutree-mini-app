'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { homeText } from '@/lib/home-text';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import tubuLogo2x from '@/assets/tubu-logo-login-2x.png';
import tubuLogo3x from '@/assets/tubu-logo-login.png';
import { useAuth } from '@/lib/auth-context';
import { DEFAULT_SUPPORT, getPublicSupport } from '@/lib/api';
import { loginFailureMessage, ZALO_UNAVAILABLE_NOTICE } from '@/lib/login-errors';
import { rememberReturnTo, safeReturnPath } from '@/lib/return-to';
import { routeTemplate, trackPurchase } from '@/lib/analytics';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { miniAppLink } from '@/lib/zalo-mini-app';
import { QrCode } from '@/components/ui/qr-code';
import { LoginSkeleton } from './login-skeleton';
import { EmailLoginForm } from './email-login-form';

/** Link giữa câu chữ nhỏ: hộp chạm 44px là hộp thật của link (dòng chứa link cao theo), không phải đệm inline tràn sang dòng và đoạn kề,
 * vì phần tràn đó bị dòng sau và nút phía trên giành mất khi chạm. Đệm dọc 13px của link inline chỉ ra ~41px với chữ 12px. */
const INLINE_LINK = 'inline-flex min-h-11 items-center font-medium text-forest-700 underline underline-offset-2';

type Redirecting = 'zalo' | 'google' | null;

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));
  // Zalo trả -14029 (ứng dụng chưa được duyệt): trang nhận mã đưa khách về đây kèm cờ này.
  const zaloPending = params.get('zalo_unavailable') === '1';
  const { status, startZaloLogin, startGoogleLogin, zaloLoginConfigured } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<Redirecting>(null);
  // Cùng cache với Trang chủ; lỗi hay thiếu số thì không hứa gì (không có số dự phòng), các nút đăng nhập vẫn dùng bình thường.
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, retry: false });
  const cfg = cfgQ.data;
  // `=== false`/`=== true`: ô Email chỉ ẩn khi API nói chắc là chưa bật (API cũ hay cấu hình lỗi vẫn hiện, API trả lời rõ khi bấm);
  // nút Google chỉ hiện khi API nói chắc là đã có khoá. Context cũ không có cờ Zalo vẫn cho bấm.
  const emailOn = cfg?.emailLoginConfigured !== false;
  const googleOn = cfg?.googleLoginConfigured === true;
  const zaloOn = zaloLoginConfigured !== false && !zaloPending;
  const unavailable = !emailOn && !googleOn && !zaloOn;
  const supportQ = useQuery({
    queryKey: ['public-support'],
    queryFn: getPublicSupport,
    staleTime: 5 * 60_000,
    enabled: unavailable,
  });
  const support = supportQ.data ?? DEFAULT_SUPPORT;
  const welcome = cfg?.newCustomer?.welcomeVoucher;
  const benefit =
    welcome && welcome.amount > 0
      ? `${homeText.newGift.title}: ${homeText.newGift.voucherAmount(formatVnd(welcome.amount))}${welcome.minOrder > 0 ? `, ${homeText.newGift.voucherMinOrder(formatVnd(welcome.minOrder)).toLowerCase()}` : ''}.`
      : null;
  const miniAppUrl = miniAppLink(returnTo);
  const loginTracked = useRef(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace(returnTo ?? '/');
  }, [status, router, returnTo]);

  // Khách bấm lùi từ trang Zalo/Google về: trình duyệt dựng lại trang từ bộ nhớ đệm, nút không được kẹt ở "Đang chuyển…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const trackStart = () => {
    if (loginTracked.current) return;
    loginTracked.current = true;
    trackPurchase('login_started', { from: routeTemplate(returnTo ?? '/') });
  };

  // Ghi (hoặc xoá) nơi quay lại trước khi rời trang: trang nhận mã đọc lại sau vòng chuyển hướng Zalo/Google.
  const leaveFor = async (provider: Exclude<Redirecting, null>, go: () => void | Promise<void>) => {
    trackStart();
    setError(null);
    setRedirecting(provider);
    rememberReturnTo(returnTo);
    try {
      await go();
    } catch (e) {
      console.error(`[dang-nhap] không bắt đầu được đăng nhập ${provider}`, e);
      setError(loginFailureMessage(e));
      setRedirecting(null);
    }
  };

  const onEmailLoggedIn = () => trackPurchase('login_completed', { from: routeTemplate(returnTo ?? '/') });

  // Một nút chính: Email khi có, không thì Zalo, không nữa thì Google.
  const zaloClass = emailOn ? ui.btnSecondary : ui.btnPrimary;
  const googleClass = emailOn || zaloOn ? ui.btnSecondary : ui.btnPrimary;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      {/* Máy 2x tải bản 320px, máy 3x bản 480px (next/image không sinh srcset vì `images.unoptimized`). Không `priority`: thẻ preload chỉ trỏ được một
          bản nên máy 3x sẽ tải cả hai; ảnh có sẵn trong HTML đầu nên vẫn được tải sớm. */}
      <picture className="contents">
        <source srcSet={`${tubuLogo2x.src} 2x, ${tubuLogo3x.src} 3x`} />
        <Image src={tubuLogo2x} alt="Tubu Tree" width={160} height={58} loading="eager" fetchPriority="high" className="h-[58px] w-[160px] object-contain" />
      </picture>
      <h1 className="mt-5 font-display text-2xl font-semibold text-forest-800">Đăng nhập</h1>
      <p className="mt-2 text-stone-700">Mua sắm, tích Điểm Xanh và theo dõi đơn hàng.</p>
      {benefit && (
        <p data-testid="login-benefit" className="mt-3 rounded-control bg-forest-50 px-3 py-2 text-sm font-medium text-forest-800">
          {benefit}
        </p>
      )}

      {unavailable ? (
        <>
          <p role="status" className="mt-6 text-sm font-medium text-stone-800">
            Đăng nhập trên web đang tạm ngưng. Bạn vẫn mua sắm được trong Zalo.
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
          {zaloPending && emailOn && (
            <p role="status" data-testid="zalo-unavailable" className="mt-5 w-full rounded-control bg-info-bg px-3 py-2 text-left text-sm font-medium text-info-fg">
              {ZALO_UNAVAILABLE_NOTICE}
            </p>
          )}
          {emailOn && (
            <div className="mt-6 w-full">
              <EmailLoginForm onStart={trackStart} onLoggedIn={onEmailLoggedIn} />
            </div>
          )}
          {(zaloOn || googleOn) && (
            <>
              {emailOn && (
                <div className="mt-5 flex w-full items-center gap-3 text-xs text-stone-600">
                  <span aria-hidden="true" className="h-px flex-1 bg-stone-200" />
                  hoặc
                  <span aria-hidden="true" className="h-px flex-1 bg-stone-200" />
                </div>
              )}
              <div className={`${emailOn ? 'mt-4' : 'mt-8'} flex w-full flex-col gap-3`}>
                {zaloOn && (
                  <button type="button" onClick={() => void leaveFor('zalo', startZaloLogin)} disabled={redirecting !== null} className={`${zaloClass} w-full`}>
                    {redirecting === 'zalo' ? 'Đang chuyển tới Zalo…' : 'Đăng nhập với Zalo'}
                  </button>
                )}
                {googleOn && (
                  <button type="button" onClick={() => void leaveFor('google', startGoogleLogin)} disabled={redirecting !== null} className={`${googleClass} w-full`}>
                    {redirecting === 'google' ? 'Đang chuyển tới Google…' : 'Đăng nhập với Google'}
                  </button>
                )}
              </div>
            </>
          )}

          {error && (
            <p role="alert" className={`mt-4 ${ui.error}`}>
              {error}
            </p>
          )}

          <div className="mt-3">
            {/* Mini App chưa phát hành (bản thử) nên khi Zalo đang chờ duyệt, khách ngoài danh sách thử cũng không mở được: không đưa vào ngõ cụt thứ hai. */}
            {!zaloPending && (
              <p className="text-xs text-stone-600">
                Đã dùng Tubu Tree trên Zalo?{' '}
                <a href={miniAppUrl} className={INLINE_LINK}>
                  Mở trên Zalo
                </a>
              </p>
            )}
            <p className="text-xs text-stone-600">
              Bằng việc đăng nhập, bạn đồng ý với{' '}
              <Link href="/chinh-sach/dieu-khoan" className={INLINE_LINK}>
                Điều khoản
              </Link>{' '}
              và{' '}
              <Link href="/chinh-sach/bao-mat" className={INLINE_LINK}>
                Chính sách bảo mật
              </Link>
              .
            </p>
          </div>
        </>
      )}

      <Link href="/" className={`${ui.backLink} mt-1 text-stone-600 hover:text-stone-900`}>
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
