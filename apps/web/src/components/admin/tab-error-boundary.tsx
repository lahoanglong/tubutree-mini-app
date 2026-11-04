'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '@/lib/error-report';
import { ui } from '@/lib/guest-ui';
import { claimAutoReload, isChunkLoadError, isOffline, reloadPage } from './chunk-load-error';

interface Props {
  children: ReactNode;
  tabLabel: string;
  /** Không truyền thì ẩn nút (đang ở Việc cần xử lý, hoặc tài khoản không được vào mục đó). */
  onGoHome?: () => void;
}

/**
 * Bọc riêng phần nội dung của từng tab: một tab ném lỗi thì menu và tiêu đề trang vẫn còn, chủ chuyển tab hoặc thử lại
 * được mà không phải sửa URL. Trang gắn `key` theo tab để đổi tab là bỏ trạng thái lỗi.
 */
export class TabErrorBoundary extends Component<Props, { failed: boolean; stale: 'update' | 'offline' | null }> {
  override state: { failed: boolean; stale: 'update' | 'offline' | null } = { failed: false, stale: null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, stale: isChunkLoadError(error) ? (isOffline() ? 'offline' : 'update') : null };
  }

  override componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) {
      if (!isOffline() && claimAutoReload()) reloadPage();
      return;
    }
    reportError(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.stale !== null) {
      return (
        <div role="alert" data-tab-stale className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center">
          <p className="text-sm text-stone-700">
            {this.state.stale === 'offline' ? 'Mất kết nối. Có mạng lại thì bấm Tải lại trang.' : 'Trang quản trị vừa được cập nhật. Tải lại trang để dùng tiếp.'}
          </p>
          <button type="button" onClick={reloadPage} className={`mt-4 ${ui.btnPrimary}`}>
            Tải lại trang
          </button>
        </div>
      );
    }
    return (
      <div role="alert" data-tab-error className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-card bg-warning-bg text-warning-fg">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-display text-lg font-semibold text-stone-900">Mục này đang gặp lỗi</h2>
        <p className="mt-1 text-sm text-stone-700">Mục &quot;{this.props.tabLabel}&quot; không hiện được. Các mục khác vẫn dùng bình thường.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => this.setState({ failed: false, stale: null })} className={ui.btnPrimary}>
            Thử lại
          </button>
          {this.props.onGoHome && (
            <button type="button" onClick={this.props.onGoHome} className={ui.btnSecondary}>
              Về Việc cần xử lý
            </button>
          )}
        </div>
      </div>
    );
  }
}
