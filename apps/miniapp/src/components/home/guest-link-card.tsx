import { useState } from 'react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { getErrorMessage } from '../../services/api';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';
import { isGuestUser } from '../../utils/guest-user';

/**
 * Thẻ mời ở khối cần tài khoản. Hai đối tượng, một thẻ: tài khoản khách (đã vào bằng khách, chưa liên kết Zalo) liên kết Zalo để giữ điểm và nhận quà;
 * người chưa đăng nhập (pha `guest`) đăng nhập Zalo. Tài khoản thật không thấy thẻ này; đang khôi phục phiên hay mất mạng (`loading`, `unavailable`) cũng không,
 * vì người đó có thể đang có phiên. Tài khoản bị khoá thì thay lời mời bằng lời máy chủ.
 */
export function GuestLinkCard({ title, body, cta }: { title: string; body: string; cta: string }) {
  const phase = useAuthPhase();
  const user = useAuthStore((s) => s.user);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const ensurePhoneOrThrow = useAuthStore((s) => s.ensurePhoneOrThrow);
  const blocked = useAuthStore((s) => (s.status === 'idle' ? (s.error ?? null) : null));
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [failure, setFailure] = useState<string>(homeCopy.guestGift.failed);
  const visitor = phase === 'guest';
  if (!visitor && (!authed || !user || !isGuestUser(user))) return null;
  const link = async () => {
    haptic('light');
    setState('busy');
    try {
      if (visitor) {
        await useAuthStore.getState().login();
        setState('idle');
        return;
      }
      const phone = await ensurePhoneOrThrow();
      // null = khách từ chối sheet số điện thoại: không phải lỗi của máy chủ nên giữ câu chung.
      setFailure(homeCopy.guestGift.failed);
      setState(phone ? 'idle' : 'failed');
    } catch (err) {
      setFailure(getErrorMessage(err));
      setState('failed');
    }
  };
  return (
    <section aria-label={title} style={{ padding: '12px 16px 0' }}>
      <Card variant="flat" padding={16}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
        <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
          {visitor ? (blocked ?? body) : body}
        </Text>
        <div style={{ marginTop: 12 }}>
          <Button loading={state === 'busy'} onPress={link} style={{ minWidth: 0 }}>
            {cta}
          </Button>
          {state === 'failed' && (
            <Text variant="caption" tone="danger" as="p" style={{ marginTop: 6 }}>
              {failure}
            </Text>
          )}
        </div>
      </Card>
    </section>
  );
}
