'use client';

import { Suspense, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { sectionIdFromSearch } from '@tubutree/app-core/commerce/storefront-builder';
import { myStorefrontQuery } from '@tubutree/app-core/queries/storefront';
import { shouldStartSignupWizard } from '@tubutree/app-core/storefront-signup';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { BUILDER_HEAD_SLOT, StorefrontBuilder } from '@/components/affiliate/storefront-builder';
import { StorefrontSignupFlow } from '@/components/affiliate/storefront-signup';
import { errText } from '@/components/affiliate/storefront-sheets';
import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';

const TITLE = 'Gian hàng của tôi';

/**
 * Khung trang. `detail` = đang mở trang chi tiết một khối (`?khoi=`): ở điện thoại dải đầu của khối (nút "Gian hàng của tôi", ⋯, tên khối) là dải đầu duy nhất, như Mini App,
 * nên dải tiêu đề của trang không chiếm thêm một hàng. h1 "Gian hàng của tôi" vẫn nằm trong cây truy cập (chỉ ẩn bằng sr-only dưới md) nên trang luôn có đúng một h1;
 * khung bỏ đệm đỉnh để dải đầu của khối bắt đầu từ mép trên, chừa chỗ cho nút lùi nổi bằng lề trái của chính nó.
 */
function Shell({ children, detail = false, builder = false }: { children: ReactNode; detail?: boolean; builder?: boolean }) {
  // `builder`: hàng tiêu đề có ô cho "Xem trước" và nút chính từ lg (trình dựng gắn nút vào đây; điện thoại dùng thanh dính đáy).
  const slot = builder ? <div id={BUILDER_HEAD_SLOT} data-testid={BUILDER_HEAD_SLOT} className="hidden shrink-0 items-center gap-2 lg:flex" /> : undefined;
  const header = <PageHeader title={TITLE} parentHref="/ctv" className="md:mt-1" actions={slot} />;
  return (
    <main className={`${PAGE_WIDE} py-6${detail ? ' max-md:pt-0' : ''}`}>
      <BackLink href="/ctv">
        ← Cộng tác viên
      </BackLink>
      {detail ? <div className="max-md:sr-only">{header}</div> : header}
      <div className={detail ? 'mt-4 max-md:mt-0' : 'mt-4'}>{children}</div>
    </main>
  );
}

function CtvStorefront() {
  const phase = useAuthPhase();
  const params = useSearchParams();
  // retry: false để 404 (chưa có gian hàng) không bị thử lại; lỗi khác có nút Thử lại.
  const sfQ = useQuery({ ...myStorefrontQuery(coreHttp), enabled: phase === 'authenticated', retry: false });
  const [fullEditor, setFullEditor] = useState(false);
  // Quyết định vào luồng 4 bước đúng một lần, lúc dữ liệu về: giữa chừng (đã tạo, còn nháp) không bị đá sang trình dựng.
  const wizardRef = useRef<boolean | null>(null);

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để dựng gian hàng của bạn." returnTo="/ctv/gian-hang" />
      </Shell>
    );
  }
  if (sfQ.isLoading) {
    return (
      <Shell>
        <Skeleton height={120} />
      </Shell>
    );
  }
  // Chỉ 404 = chưa có gian hàng → vào luồng đăng ký. Lỗi mạng/500/401 → ErrorState có Thử lại (bấm Bắt đầu lúc đó cũng sẽ lỗi).
  const notFound = sfQ.isError && !sfQ.data && errorStatus(sfQ.error) === 404;
  if (sfQ.isError && !sfQ.data && !notFound) {
    return (
      <Shell>
        <ErrorState message={errText(sfQ.error)} onRetry={() => void sfQ.refetch()} />
      </Shell>
    );
  }
  const sf = sfQ.data ?? null;
  // Luồng 4 bước dành cho gian hàng mới hoặc còn phải qua duyệt; đã duyệt (hoặc cờ duyệt tắt) mà bị gỡ thì vào thẳng trình dựng để đăng lại.
  wizardRef.current ??= shouldStartSignupWizard(sf);
  if (!sf || (wizardRef.current && sf.status === 'DRAFT' && !fullEditor)) {
    return (
      <Shell>
        <StorefrontSignupFlow sf={sf} onOpenEditor={() => setFullEditor(true)} />
      </Shell>
    );
  }
  // Cùng điều kiện với trình dựng: id trên địa chỉ phải là một khối còn tồn tại, không thì trình dựng vẽ danh sách và trang cần dải tiêu đề của nó.
  const khoi = sectionIdFromSearch(params?.toString() ?? '');
  const detail = khoi !== null && sf.collections.some((c) => c.id === khoi);
  return (
    <Shell detail={detail} builder>
      <Suspense fallback={<Skeleton height={120} />}>
        <StorefrontBuilder sf={sf} />
      </Suspense>
    </Shell>
  );
}

// Trang đọc ?khoi= trên địa chỉ (useSearchParams) để biết có đang ở trang chi tiết khối: build tĩnh bắt buộc có Suspense bao ngoài.
export default function CtvStorefrontPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <AuthLoading />
        </Shell>
      }
    >
      <CtvStorefront />
    </Suspense>
  );
}
