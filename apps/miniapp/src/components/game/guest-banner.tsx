import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../store/auth';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

const t = vi.game.newbie.guest;

/**
 * Tài khoản khách của Mini App (chưa gắn SĐT, zaloId `guest_…`): nói rõ đang chơi thử và cho đăng nhập Zalo ngay.
 * Đăng nhập ở đây nâng cấp tài khoản tại chỗ hoặc gộp vào tài khoản Zalo đã có, rồi tải lại game và điểm.
 */
export function GuestBanner() {
  const user = useAuthStore((s) => s.user);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!user || user.phone || !user.zaloId?.startsWith('guest_')) return null;
  const login = async () => {
    setPending(true);
    setFailed(false);
    try {
      const phone = await ensurePhone();
      if (!phone) {
        setFailed(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['game'] });
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
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
            {t.failed}
          </Text>
        </div>
      )}
      <Button fullWidth loading={pending} disabled={pending} onPress={() => void login()}>
        {t.cta}
      </Button>
    </div>
  );
}
