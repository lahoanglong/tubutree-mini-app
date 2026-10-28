import { Component, Suspense, useCallback, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { trackEvent } from '../services/analytics';
import { vi } from '../i18n/vi';
import { hashMessage } from './error-boundary';
import { ErrorState } from './ui/empty-state';
import { LineItemSkeleton, ProductGridSkeleton, Skeleton } from './ui/skeleton';

export type RouteSkeletonKind = 'grid' | 'detail' | 'list';

/** Khung chờ theo hình màn: lưới SP (Danh mục), ảnh + chữ (Chi tiết SP), danh sách dòng (Giỏ, Đơn, ...). */
export function RouteSkeleton({ kind = 'list' }: { kind?: RouteSkeletonKind }) {
  return (
    <div role="status" aria-busy="true" aria-label={vi.common.loading} style={{ minHeight: '100vh', background: 'var(--color-bg-canvas)' }}>
      {kind === 'grid' && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={40} radius="var(--radius-pill, 20px)" />
          <ProductGridSkeleton count={6} />
        </div>
      )}
      {kind === 'detail' && (
        <div>
          <Skeleton height="auto" radius="0" style={{ aspectRatio: '1 / 1' }} />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width="85%" height={20} />
            <Skeleton width={120} height={24} />
            <Skeleton width="60%" height={14} />
            <Skeleton height={44} radius="var(--radius-control)" style={{ marginTop: 8 }} />
          </div>
        </div>
      )}
      {kind === 'list' && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width="45%" height={22} />
          <LineItemSkeleton />
          <LineItemSkeleton />
          <LineItemSkeleton />
        </div>
      )}
    </div>
  );
}

interface BoundaryProps {
  resetKey: string;
  attempt: number;
  onRetry: () => void;
  children: ReactNode;
}

/**
 * Lỗi render của MỘT màn không làm sập cả app: thanh đáy và các màn khác vẫn dùng được. Đổi route (resetKey) hoặc bấm
 * Thử lại thì dựng lại màn; tải lại cả app chỉ là lưới cuối của ErrorBoundary ngoài cùng.
 */
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|Unable to preload CSS|error loading dynamically/i;

class RouteBoundary extends Component<BoundaryProps, { failedKey: string | null; chunk: boolean }> {
  override state = { failedKey: null as string | null, chunk: false };

  static getDerivedStateFromError(error: unknown): { failedKey: string; chunk: boolean } {
    return { failedKey: '*', chunk: CHUNK_ERROR.test(error instanceof Error ? `${error.name} ${error.message}` : String(error)) };
  }

  override componentDidCatch(error: Error): void {
    this.setState({ failedKey: this.props.resetKey });
    console.error('[RouteBoundary] Lỗi render:', error);
    void trackEvent('client_error', 'miniapp', {
      kind: 'render',
      route: this.props.resetKey,
      messageHash: hashMessage(error instanceof Error ? error.message : String(error)),
    });
  }

  override componentDidUpdate(prev: BoundaryProps): void {
    if (this.state.failedKey !== null && (prev.attempt !== this.props.attempt || prev.resetKey !== this.props.resetKey)) {
      this.setState({ failedKey: null, chunk: false });
    }
  }

  override render(): ReactNode {
    if (this.state.failedKey !== null) {
      // React.lazy giữ lời hứa tải mã đã hỏng: dựng lại màn không bao giờ tải lại được, chỉ tải lại app mới lấy lại mã.
      return <ErrorState message={vi.errors.generic} onRetry={this.state.chunk ? () => window.location.reload() : this.props.onRetry} />;
    }
    return this.props.children;
  }
}

/** Bọc một màn: lỗi render có nút Thử lại (dựng lại + tải lại dữ liệu đang hiển thị), chờ mã màn thì hiện khung chờ đúng hình. */
export function RouteShell({ children, skeleton = 'list' }: { children: ReactNode; skeleton?: RouteSkeletonKind }) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    void queryClient.refetchQueries({ type: 'active', predicate: (q) => q.state.status === 'error' });
    setAttempt((n) => n + 1);
  }, [queryClient]);
  return (
    <RouteBoundary resetKey={pathname} attempt={attempt} onRetry={retry}>
      <Suspense fallback={<RouteSkeleton kind={skeleton} />}>{children}</Suspense>
    </RouteBoundary>
  );
}


/** Thành phần phụ tải sau (cổng chào, nhận mã): lỗi của nó, kể cả không tải được mã, không được làm sập màn đang xem. */
export class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('[SilentBoundary] Lỗi thành phần phụ:', error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
