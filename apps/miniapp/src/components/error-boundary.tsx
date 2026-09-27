import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trackEvent } from '../services/analytics';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Hash chuỗi đơn giản (không cần crypto mạnh) — chỉ để gom nhóm các lỗi giống nhau trong
 * analytics dài hạn mà KHÔNG lộ message lỗi thật (có thể chứa dữ liệu nhạy cảm) ra event log.
 * Ổn định (cùng input luôn ra cùng output) và ngắn gọn (base36).
 */
export function hashMessage(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Bắt lỗi render chưa xử lý ở BẤT KỲ trang con nào (~40 trang lazy-load) để tránh
 * màn hình trắng vĩnh viễn cho khách hàng thật trên Zalo (React unmount toàn cây khi
 * gặp lỗi render chưa bắt, và <App> của zmp-ui không tự bảo vệ khỏi việc này).
 *
 * BẮT BUỘC là class component: React chỉ hỗ trợ componentDidCatch/getDerivedStateFromError
 * ở class component, chưa có hook tương đương.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Lỗi render chưa bắt:', error, errorInfo);
    void trackEvent('client_error', 'miniapp', {
      kind: 'render',
      route: window.location.pathname,
      messageHash: hashMessage(error.message),
    });
  }

  private handleRetry = (): void => {
    // Thử reset để re-render lại cây con trước; nếu app vẫn kẹt (lỗi ở ngoài React,
    // state module-level hỏng...) reload là lưới an toàn cuối cùng.
    this.setState({ hasError: false });
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 16, color: '#1a1a1a', margin: 0 }}>
            Đã có lỗi xảy ra — Vui lòng thử lại
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '10px 28px',
              borderRadius: 8,
              border: 'none',
              background: '#16a34a',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Thử lại
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
