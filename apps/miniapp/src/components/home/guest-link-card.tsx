import { useState } from 'react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';
import { isGuestUser } from '../coupon-claim-gate';

/** Thẻ mời tài khoản khách (chưa liên kết Zalo) liên kết Zalo để giữ điểm và nhận quà. Tài khoản thật không thấy thẻ này. */
export function GuestLinkCard({ title, body, cta }: { title: string; body: string; cta: string }) {
  const user = useAuthStore((s) => s.user);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  if (!authed || !user || !isGuestUser(user)) return null;
  const link = async () => {
    haptic('light');
    setState('busy');
    try {
      setState((await ensurePhone()) ? 'idle' : 'failed');
    } catch {
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
          {body}
        </Text>
        <div style={{ marginTop: 12 }}>
          <Button loading={state === 'busy'} onPress={link} style={{ minWidth: 0 }}>
            {cta}
          </Button>
          {state === 'failed' && (
            <Text variant="caption" tone="danger" as="p" style={{ marginTop: 6 }}>
              {homeCopy.guestGift.failed}
            </Text>
          )}
        </div>
      </Card>
    </section>
  );
}
