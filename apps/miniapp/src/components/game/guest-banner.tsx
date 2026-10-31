import { useState } from 'react';
import { getErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/auth';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

const t = gameNewbieCopy.guest;

/**
 * Tài khoản khách của Mini App (chưa gắn SĐT, zaloId `guest_…`): nói rõ đang chơi thử và cho đăng nhập Zalo ngay.
 * Đăng nhập ở đây nâng cấp tài khoản tại chỗ hoặc gộp vào tài khoản Zalo đã có; store/auth.ts tự làm mới game và điểm khi danh tính đổi.
 */
export function GuestBanner() {
  const user = useAuthStore((s) => s.user);
  const ensurePhoneOrThrow = useAuthStore((s) => s.ensurePhoneOrThrow);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!user || user.phone || !user.zaloId?.startsWith('guest_')) return null;
  const login = async () => {
    setPending(true);
    setFailed(null);
    try {
      const phone = await ensurePhoneOrThrow();
      if (!phone) setFailed(t.failed);
    } catch (err) {
      setFailed(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      role="note"
      data-testid="guest-banner"
      style={{ padding: 12, background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-card)', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <Text variant="body-sm" tone="warning" as="div" style={{ fontWeight: 600 }}>
        {t.banner}
      </Text>
      <Text variant="caption" tone="warning" as="div">
        {t.note}
      </Text>
      {failed && (
        <div role="alert">
          <Text variant="caption" tone="danger" as="div">
            {failed}
          </Text>
        </div>
      )}
      <Button fullWidth loading={pending} disabled={pending} onPress={() => void login()}>
        {t.cta}
      </Button>
    </div>
  );
}
