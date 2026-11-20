import { Copy, Share2 } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import { inviteLandingOn, inviteShareLink } from '@tubutree/app-core/commerce/invite-card';
import {
  ecoImpactHeadline,
  ecoImpactInviteLine,
  ecoImpactPointsLine,
  ecoImpactShareLead,
  ecoImpactShareText,
  type OrderEcoImpact,
} from '@tubutree/app-core/eco/order-impact';
import { greenCardCopy } from '@tubutree/app-core/referral/copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackEvent } from '../../services/analytics';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import { miniAppLink } from '../../utils/miniapp-link';
import { useActionLock, useShareWithFallback } from '../share-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';

/**
 * Thẻ "đơn này giảm bao nhiêu nhựa" ở Chi tiết đơn (cờ growth.referral_viral_enabled, chunk tải lười): số chai, Điểm Xanh của đơn và
 * một chạm gửi link mời qua Zalo. Trang chỉ vẽ khi máy chủ trả số lớn hơn 0. Cùng web (`web/src/components/orders/eco-impact-card.tsx`).
 */
export default function OrderEcoImpactCard({ impact }: { impact: OrderEcoImpact }) {
  const cfg = usePublicConfig();
  const lock = useActionLock();
  const share = useShareWithFallback();
  const { openSnackbar } = useSnackbar();
  const code = impact.referralCode;
  const points = ecoImpactPointsLine(impact);
  const link = () => inviteShareLink({ landing: inviteLandingOn(cfg), baseUrl: miniAppLink('/'), referralCode: code });
  const onShare = () =>
    void lock.run('share', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'share', surface: 'order' });
      await share(
        { title: fillCopy('invite.shareTitle'), description: ecoImpactShareLead(impact), path: `/?ref=${code}` },
        ecoImpactShareText(impact, link()),
      );
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'copy', surface: 'order' });
      const ok = await copyText(link());
      openSnackbar(
        ok
          ? { text: fillCopy('invite.copied'), type: 'success' }
          : { text: fillCopy('invite.copyFailed', { code }), type: 'info', duration: 4000 },
      );
    });
  return (
    <section data-testid="order-eco-impact" style={{ marginTop: 'var(--space-stack-sm)' }}>
      <Card padding={12}>
        <Heading variant="title-sm" as="h2">
          {ecoImpactHeadline(impact)}
        </Heading>
        {points && (
          <Text variant="body-sm" tone="brand" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
            {points}
          </Text>
        )}
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 'var(--space-inline-xs)' }}>
          {ecoImpactInviteLine(impact)}
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)', marginTop: 'var(--space-stack-sm)' }}>
          <Button fullWidth icon={Share2} loading={lock.active === 'share'} aria-disabled={lock.busy || undefined} onPress={onShare}>
            {fillCopy('invite.shareZalo')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            icon={Copy}
            loading={lock.active === 'copy'}
            aria-disabled={lock.busy || undefined}
            onPress={onCopy}
          >
            {greenCardCopy('copy')}
          </Button>
        </div>
      </Card>
    </section>
  );
}
