import { useState } from 'react';
import { checkInCopy } from '@tubutree/app-core/daily-check-in-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { getErrorMessage } from '../../services/api';
import { useAuthStore } from '../../store/auth';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

/**
 * Khách vãng lai điểm danh hoặc xem nhiệm vụ vẫn nhận giọt nước nhưng không nhận Điểm Xanh (API báo `pointsBlocked`): một câu
 * mời đăng nhập Zalo kèm nút. Đăng nhập nâng cấp tài khoản tại chỗ hoặc gộp vào tài khoản Zalo đã có, store/auth.ts tự làm mới điểm.
 */
export function GuestPointsNote({ margin }: { margin?: string }) {
  const ensurePhoneOrThrow = useAuthStore((s) => s.ensurePhoneOrThrow);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const login = async () => {
    setPending(true);
    setFailed(null);
    try {
      const phone = await ensurePhoneOrThrow();
      if (!phone) setFailed(gameNewbieCopy.guest.failed);
    } catch (err) {
      setFailed(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      role="note"
      data-testid="guest-points-note"
      style={{ margin, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <Text variant="body-sm" tone="secondary" as="div" style={{ fontWeight: 600 }}>
        {checkInCopy.guestPoints}
      </Text>
      {failed && (
        <div role="alert">
          <Text variant="caption" tone="danger" as="div">
            {failed}
          </Text>
        </div>
      )}
      <Button fullWidth variant="secondary" loading={pending} disabled={pending} onPress={() => void login()}>
        {fillCopy('zalo.link')}
      </Button>
    </div>
  );
}
