import { Page } from 'zmp-ui';
import { PageHeader } from './ui/page-header';
import { Skeleton } from './ui/skeleton';

/** Khung trang Đổi rác lúc chờ dữ liệu: có tiêu đề và khối chờ thay vì màn trắng. */
export function RecyclePageSkeleton() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Đổi rác lấy quà" />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={140} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
      </div>
    </Page>
  );
}
