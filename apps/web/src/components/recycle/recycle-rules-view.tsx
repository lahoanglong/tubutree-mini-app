'use client';

import { useQuery } from '@tanstack/react-query';
import { wasteRulesQuery } from '@tubutree/app-core/queries/waste';
import { coreHttp } from '@/lib/core-http';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/**
 * Thể lệ do admin soạn. `initialText` là bản server đã đọc lúc dựng trang (ISR): có thì hiện ngay, không gọi API; `undefined`
 * là server không đọc được, trình duyệt tự tải để trang không bị kẹt ở bản rỗng vì lỗi tạm.
 */
export function RecycleRulesView({ initialText }: { initialText?: string | null }) {
  const q = useQuery({
    ...wasteRulesQuery(coreHttp),
    ...(initialText !== undefined ? { initialData: { text: initialText } } : {}),
    staleTime: 5 * 60_000,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Thể lệ Đổi rác lấy quà" backHref="/doi-rac" backLabel="Đổi rác lấy quà" />
      {q.isPending ? (
        <div className="space-y-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} width="70%" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <div className="whitespace-pre-line text-base text-stone-900">{q.data.text ?? 'Thể lệ đang được cập nhật'}</div>
      )}
    </main>
  );
}
