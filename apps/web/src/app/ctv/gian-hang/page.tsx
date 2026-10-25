'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { myStorefrontQuery } from '@tubutree/app-core/queries/storefront';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StorefrontBuilder } from '@/components/affiliate/storefront-builder';
import { StorefrontSignupFlow } from '@/components/affiliate/storefront-signup';
import { errText } from '@/components/affiliate/storefront-sheets';
import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';

const TITLE = 'Gian hàng của tôi';

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <BackLink href="/ctv">
        ← Cộng tác viên
      </BackLink>
      <PageHeader title={TITLE} parentHref="/ctv" className="md:mt-1" />
      <div className="mt-4">{children}</div>
    </main>
  );
}

export default function CtvStorefrontPage() {
  const phase = useAuthPhase();
  // retry: false để 404 (chưa có gian hàng) không bị thử lại; lỗi khác có nút Thử lại.
  const sfQ = useQuery({ ...myStorefrontQuery(coreHttp), enabled: phase === 'authenticated', retry: false });
  const [fullEditor, setFullEditor] = useState(false);

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
  // Luồng 4 bước dành cho gian hàng chưa gửi duyệt; API cũ chưa trả `status` thì giữ trình dựng như trước.
  if (!sf || (sf.status === 'DRAFT' && !fullEditor)) {
    return (
      <Shell>
        <StorefrontSignupFlow sf={sf} onOpenEditor={() => setFullEditor(true)} />
      </Shell>
    );
  }
  return (
    <Shell>
      <StorefrontBuilder sf={sf} />
    </Shell>
  );
}
