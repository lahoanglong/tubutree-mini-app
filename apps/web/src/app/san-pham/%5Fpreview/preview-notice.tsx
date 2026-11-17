'use client';

import { ErrorState } from '@/components/ui/error-state';
import { PREVIEW_COPY, type PreviewProblem } from './preview-copy';

const reload = () => window.location.reload();

/** Trang xem trước không dựng được sản phẩm: nói lý do; MSS chưa trả được bản nháp thì có "Thử lại" (token còn hạn, tải lại là đủ). */
export function PreviewNotice({ problem }: { problem: PreviewProblem }) {
  const copy = PREVIEW_COPY[problem];
  return (
    <div data-testid="preview-notice" data-problem={problem} className="px-4 py-6">
      <ErrorState variant="inline" title={copy.title} message={copy.message} onRetry={problem === 'unavailable' ? reload : undefined} />
    </div>
  );
}
