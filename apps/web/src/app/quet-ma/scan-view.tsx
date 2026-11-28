'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { extractClaimCode } from '@tubutree/app-core/claim-code';
import { MARKETPLACE_CLAIM_WEB_COPY as WEB } from '@tubutree/app-core/marketplace-claim-copy';
import { MARKETPLACE_SCAN_COPY, scanGuideCollapsed } from '@tubutree/app-core/marketplace-scan-guide';
import { meQuery } from '@tubutree/app-core/queries/account';
import { externalClaimsQuery } from '@tubutree/app-core/queries/external-points';
import { Card } from '@/components/mini/card';
import { Skeleton } from '@/components/mini/skeleton';
import { Text } from '@/components/mini/text';
import { SessionUnavailable } from '@/components/login-required';
import { ScanGuide } from '@/components/points/scan-guide';
import { PageHeader } from '@/components/ui/page-header';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { MINIAPP_KEEP_PARAMS, miniAppDeepLink } from '@/lib/mini-app-auto-open';
import { PAGE_NARROW } from '@/lib/page-frame';
import { loginHref, safeReturnPath } from '@/lib/return-to';
import { usePublicConfig } from '@/lib/use-public-config';
import { ClaimForm, PhoneEntry } from './claim-form';
import { CLAIM_HISTORY_PAGE_SIZE, ClaimHistory } from './claim-history';

/**
 * Tab giữa "Quét mã" của web (W42; W44 theo PO 27/11 10:29: quét và tích điểm làm được ngay trên web, không chỉ trong Mini App). Cùng hướng dẫn
 * 3 bước, cùng chữ, cùng API (`POST/GET /me/external-points/claims`) với Mini App `/points/scan`:
 * - Khách chưa đăng nhập: hướng dẫn + "Đăng nhập để tích điểm" (quay lại đúng trang, giữ nguồn `utm_*`/`card` của mã QR bỏ hộp) và lối phụ mở
 *   màn quét trong Tubu Tree trên Zalo.
 * - Đã đăng nhập: khung quét camera trình duyệt ngay đầu thẻ (W46, mọi máy, iPhone đọc bằng bộ đọc JS), lối chụp/chọn ảnh và nhập mã thủ công,
 *   thẻ kết quả, nút mua sắm và lịch sử tích điểm đơn sàn. Đã có đơn sàn trong lịch sử thì hướng dẫn 3 bước gập thành một dòng. Tài khoản chưa có
 *   SĐT (W45): nhập số ngay tại đây rồi quét. SĐT khớp đơn (hoặc 4 số cuối đúng) thì chờ cộng ngay, kể cả số tự gõ chưa xác minh (W59).
 * Cờ `loyalty.marketplace_claim_enabled` tắt: chỉ báo "sắp mở", không hứa tỉ lệ tích. Cấu hình chưa về: chỉ tiêu đề.
 */
const noSubscribe = () => () => undefined;

/** Tham số giữ lại khi đi đăng nhập rồi quay về: nguồn của link (giống link sang Mini App) và `code` điền sẵn. */
const RETURN_KEEP_PARAMS: readonly string[] = [...MINIAPP_KEEP_PARAMS, 'code'];

export function scanReturnPath(search: string): string {
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of RETURN_KEEP_PARAMS) {
    const value = from.get(key);
    if (value) kept.set(key, value);
  }
  const q = kept.toString();
  return `/quet-ma${q ? `?${q}` : ''}`;
}

/** Link đăng nhập quay lại màn quét; tham số nguồn quá dài (`safeReturnPath` từ chối) thì vẫn quay về `/quet-ma` trần chứ không rơi về Trang chủ. */
export function scanLoginHref(search: string): string {
  const back = scanReturnPath(search);
  return loginHref(safeReturnPath(back) ? back : '/quet-ma');
}

/** Mã vận đơn hợp lệ trong `?code=` (đã chuẩn hoá), hoặc null. */
const codeOf = (search: string): string | null => extractClaimCode(new URLSearchParams(search).get('code')).code ?? null;

/**
 * Link mở màn quét trong Tubu Tree trên Zalo: giữ nguồn như mọi link sang Mini App và mang theo mã điền sẵn (Mini `/points/scan` đọc `?code=`),
 * để khách sang Zalo không phải quét hay gõ lại mã. Chỉ màn quét mang `code`, nên không thêm vào `MINIAPP_KEEP_PARAMS` chung.
 */
export function scanMiniLink(search: string): string {
  const link = miniAppDeepLink('/quet-ma', search);
  const code = codeOf(search);
  return code ? `${link}${link.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}` : link;
}

function Loading() {
  return (
    <div className="mt-4" data-testid="scan-loading">
      <Skeleton height={160} radius="var(--radius-card)" />
    </div>
  );
}

function GuestCard({ search }: { search: string }) {
  return (
    <div className="mt-4">
      <Card variant="raised" padding={16}>
        <div data-testid="scan-login">
          <Text variant="body-sm" tone="secondary" as="p">
            {WEB.loginWhy}
          </Text>
          <Link href={scanLoginHref(search)} className={`${ui.btnPrimary} mt-3 w-full`}>
            {WEB.loginCta}
          </Link>
          <a href={scanMiniLink(search)} className="mt-2 flex min-h-11 items-center justify-center text-sm font-medium text-forest-700 underline underline-offset-2">
            {WEB.openMiniAlt}
          </a>
        </div>
      </Card>
    </div>
  );
}

function AuthedScan({ search }: { search: string }) {
  const meQ = useQuery(meQuery(coreHttp));
  const verifyHref = scanMiniLink(search);
  const codeParam = new URLSearchParams(search).get('code');
  const initialCode = codeOf(search) ?? '';
  const codeParamRejected = !!codeParam?.trim() && !initialCode;
  if (meQ.isPending) return <Loading />;
  // Lỗi tải hồ sơ: vẫn cho gửi mã, máy chủ là nơi quyết điều kiện SĐT.
  const noPhone = meQ.isSuccess && !meQ.data?.phone;
  return (
    <>
      {noPhone ? <PhoneEntry verifyHref={verifyHref} /> : <ClaimForm initialCode={initialCode} codeParamRejected={codeParamRejected} verifyHref={verifyHref} />}
      <ClaimHistory />
    </>
  );
}

export function ScanView() {
  const cfg = usePublicConfig();
  const phase = useAuthPhase();
  // Máy chủ dựng không có query; trình duyệt đọc lại sau khi hydrate nên không lệch HTML.
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => '');
  const enabled = cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true;
  // Cùng khoá trang 1 với `ClaimHistory` nên không gọi API thêm lần nào.
  const historyQ = useQuery({ ...externalClaimsQuery(coreHttp, 1, CLAIM_HISTORY_PAGE_SIZE), enabled: enabled && phase === 'authenticated' });
  const guideCollapsed = phase === 'guest' || phase === 'unavailable' ? false : scanGuideCollapsed(historyQ.data);
  return (
    <main className={`${PAGE_NARROW} pb-6 pt-0 md:pt-6`}>
      <PageHeader title="Tích điểm đơn sàn" />
      {enabled && (
        <>
          <ScanGuide marketplaceEarnPct={cfg.loyalty?.marketplaceEarnPct} collapsed={guideCollapsed} />
          {phase === 'loading' && <Loading />}
          {phase === 'unavailable' && <SessionUnavailable />}
          {phase === 'guest' && <GuestCard search={search} />}
          {phase === 'authenticated' && <AuthedScan search={search} />}
        </>
      )}
      {cfg.isLoaded && !enabled && (
        <section role="status" data-testid="scan-soon" className="py-10 text-center">
          <h2 className="font-semibold text-stone-900">{MARKETPLACE_SCAN_COPY.soonTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-stone-700">{MARKETPLACE_SCAN_COPY.webSoonBody}</p>
        </section>
      )}
    </main>
  );
}
