'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { myStorefrontQuery } from '@tubutree/app-core/queries/storefront';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StorefrontBuilder } from '@/components/affiliate/storefront-builder';
import { TemplateSheet, errText } from '@/components/affiliate/storefront-sheets';
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
  const qc = useQueryClient();
  // retry: false để 404 (chưa có gian hàng) không bị thử lại; lỗi khác có nút Thử lại.
  const sfQ = useQuery({ ...myStorefrontQuery(coreHttp), enabled: phase === 'authenticated', retry: false });
  const [pickerOpen, setPickerOpen] = useState(false);

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
  if (sfQ.isError && !sfQ.data) {
    // Chỉ 404 = chưa có gian hàng → mời tạo. Lỗi mạng/500/401 → ErrorState có Thử lại (bấm Tạo lúc đó cũng sẽ lỗi).
    if (errorStatus(sfQ.error) === 404) {
      return (
        <Shell>
          <section aria-label={TITLE} className="rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600">
              <Sprout className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="mt-3 font-display text-base font-semibold text-stone-900">{TITLE}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Tạo gian hàng để chia sẻ sản phẩm bạn tâm đắc.</p>
            <button type="button" className={`${ui.btnPrimary} mt-4`} onClick={() => setPickerOpen(true)}>
              Tạo gian hàng
            </button>
          </section>
          <TemplateSheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onCreated={() => {
              setPickerOpen(false);
              void qc.invalidateQueries({ queryKey: myStorefrontQuery(coreHttp).queryKey });
            }}
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <ErrorState message={errText(sfQ.error)} onRetry={() => void sfQ.refetch()} />
      </Shell>
    );
  }
  return (
    <Shell>
      <StorefrontBuilder sf={sfQ.data!} />
    </Shell>
  );
}
