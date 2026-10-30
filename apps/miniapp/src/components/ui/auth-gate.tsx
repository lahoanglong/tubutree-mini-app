import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { useAuthPhase, type AuthPhase } from '../../hooks/use-auth-phase';
import { vi } from '../../i18n/vi';
import { LineItemSkeleton } from './skeleton';
import { EmptyState, ErrorState } from './empty-state';

/**
 * Mất kết nối lúc khôi phục phiên: nói đúng chuyện đó và cho thử lại. Không bao giờ vẽ màn "trống" hay lời mời đăng nhập —
 * khách vẫn có đơn, giỏ, điểm; chỉ là app chưa nói chuyện được với máy chủ.
 */
export function SessionUnavailable({ variant }: { variant?: 'page' | 'inline' }) {
  const restore = useAuthStore((s) => s.restore);
  const error = useAuthStore((s) => s.error);
  // Bị giới hạn tốc độ thì biểu tượng, tiêu đề và lời nói đúng chuyện đó, khớp màn web (login-required.tsx); mất mạng giữ lỗi tải chung.
  if (error === vi.errors.sessionRateLimited) {
    return (
      <ErrorState icon={Clock} title={vi.errors.sessionRateLimitedTitle} message={vi.errors.sessionRateLimitedBody} onRetry={() => void restore()} variant={variant} />
    );
  }
  return <ErrorState message={error ?? vi.errors.sessionUnavailable} onRetry={() => void restore()} variant={variant} />;
}

/**
 * Lời máy chủ khi tài khoản bị khoá: login()/restore() bỏ phiên, về 'idle' và đặt lời đó ở `error`. Màn mời đăng nhập phải đọc
 * lời này, nếu không khách bấm đăng nhập mãi mà không biết vì sao không vào được. Khách đăng xuất bình thường thì null.
 */
export function useBlockedMessage(): string | null {
  return useAuthStore((s) => (s.status === 'idle' ? (s.error ?? null) : null));
}

/** Lời mời đăng nhập mặc định cho khách thật sự (đã đăng xuất / hết phiên). Tài khoản bị khoá thì thay lời mời bằng lời máy chủ. */
export function GuestPrompt() {
  const login = useAuthStore((s) => s.login);
  const blocked = useBlockedMessage();
  return (
    <EmptyState
      art="sprout"
      heading={vi.auth.guestHeading}
      body={blocked ?? vi.auth.loginHint}
      ctaLabel={vi.auth.loginCta}
      onCta={() => void login()}
    />
  );
}

function DefaultLoading() {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LineItemSkeleton />
      <LineItemSkeleton />
      <LineItemSkeleton />
    </div>
  );
}

/**
 * Màn cho mọi pha CHƯA đăng nhập xong: khung chờ (đang khôi phục), mất kết nối + Thử lại (không khôi phục được), hoặc lời mời
 * đăng nhập (khách thật sự). Dùng trực tiếp ở trang rẽ nhánh bằng early return; trang khác dùng AuthGate.
 */
export function AuthPhaseView({ phase, loading, guest }: { phase: Exclude<AuthPhase, 'authenticated'>; loading?: ReactNode; guest?: ReactNode }) {
  if (phase === 'loading') return <>{loading ?? <DefaultLoading />}</>;
  if (phase === 'unavailable') return <SessionUnavailable />;
  return <>{guest ?? <GuestPrompt />}</>;
}

/**
 * Cổng cho mọi màn cần đăng nhập: chỉ dựng `children` khi đã đăng nhập, còn lại xem AuthPhaseView. Màn nào chỉ đọc
 * `status === 'authenticated'` rồi tự rẽ nhánh sẽ để trạng thái lỗi rơi vào nhánh "rỗng" — dùng cổng này thay vì tự rẽ.
 */
export function AuthGate({ loading, guest, children }: { loading?: ReactNode; guest?: ReactNode; children: ReactNode }) {
  const phase = useAuthPhase();
  if (phase === 'authenticated') return <>{children}</>;
  return <AuthPhaseView phase={phase} loading={loading} guest={guest} />;
}
