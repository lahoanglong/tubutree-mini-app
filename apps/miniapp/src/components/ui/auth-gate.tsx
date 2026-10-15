import type { ReactNode } from 'react';
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
  return <ErrorState message={vi.errors.sessionUnavailable} onRetry={() => void restore()} variant={variant} />;
}

/** Lời mời đăng nhập mặc định cho khách thật sự (đã đăng xuất / hết phiên). */
export function GuestPrompt() {
  const login = useAuthStore((s) => s.login);
  return (
    <EmptyState
      art="sprout"
      heading={vi.auth.guestHeading}
      body={vi.auth.loginHint}
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
