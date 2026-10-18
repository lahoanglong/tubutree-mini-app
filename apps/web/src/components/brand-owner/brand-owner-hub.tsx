'use client';

import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { ownedBrandQuery } from '@tubutree/app-core/queries/brand-owner';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ownerLoadError } from '@/lib/brand-owner-view';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { StaffShell } from '@/components/staff/staff-shell';
import { ProfileTab } from './profile-tab';
import { SalesTab } from './sales-tab';
import { ViewBrandLink } from './view-brand-link';

const TITLE = 'Quản lý nhãn hàng';
const TABS = [
  { key: 'profile', label: 'Hồ sơ & khuyến mãi' },
  { key: 'sales', label: 'Doanh thu' },
] as const;
const TAB_KEYS = TABS.map((t) => t.key);

function Editor() {
  const [tab, setTab] = useTabParam(TAB_KEYS, 'profile');
  const q = useQuery({ ...ownedBrandQuery(coreHttp), retry: false });

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton height={140} rounded="rounded-card" />
      </div>
    );
  }
  if (!q.data) {
    if (errorStatus(q.error) === 404) {
      return (
        <section aria-label="Chưa có nhãn" className="rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
          <h2 className="font-display text-base font-semibold text-stone-900">Quản lý nhãn hàng</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Bạn chưa được cấp quyền quản lý nhãn nào. Liên hệ Tubu để trở thành đối tác nhãn.</p>
        </section>
      );
    }
    const denied = errorStatus(q.error) === 403;
    return <ErrorState message={ownerLoadError(q.error)} onRetry={denied ? undefined : () => void q.refetch()} />;
  }
  const brand = q.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
      <section aria-label="Thông tin nhãn đang quản lý" className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold text-stone-900">{brand.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {brand.isVerified ? (
            <Badge tone="success" icon={Check}>
              Chính hãng
            </Badge>
          ) : (
            <Badge>Chưa xác minh</Badge>
          )}
          <Badge tone={brand.isPublished ? 'success' : 'warning'}>{brand.isPublished ? 'Đang hiển thị' : 'Nháp (admin duyệt)'}</Badge>
          <span className="text-xs text-stone-600">{brand.followerCount} theo dõi</span>
        </div>
        <p className="text-xs text-stone-600">Bạn sửa được thông tin & khuyến mãi. Tên nhãn, chứng nhận, đăng/ẩn do Tubu duyệt.</p>
        <ViewBrandLink slug={brand.slug} published={brand.isPublished} />
      </section>

      <div className="min-w-0">
        <SegmentedTabs items={[...TABS]} value={tab} onChange={setTab} label="Mục quản lý nhãn" />
        <div className="mt-3">{tab === 'sales' ? <SalesTab /> : <ProfileTab key={brand.id} brand={brand} />}</div>
      </div>
    </div>
  );
}

/** Cổng vào: chưa đăng nhập, mất kết nối phiên thì dừng ở đây; không có kiểm vai trò, quyền do máy chủ quyết định. */
export function BrandOwnerHub() {
  const phase = useAuthPhase();
  let body: React.ReactNode;
  if (phase === 'loading') body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if (phase === 'guest') body = <LoginRequired message="Đăng nhập để quản lý nhãn hàng của bạn." returnTo="/chu-thuong-hieu" />;
  else body = <Editor />;
  return (
    <StaffShell title={TITLE}>
      <Suspense fallback={null}>{body}</Suspense>
    </StaffShell>
  );
}
