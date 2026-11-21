import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import {
  inviteLandingOn,
  inviteShareLink,
  inviteShareText,
} from '@tubutree/app-core/commerce/invite-card';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import {
  greenCardQuery,
  greenCardRewardLine,
  greenCardStats,
} from '@tubutree/app-core/referral/green-card';
import { greenCardCopy } from '@tubutree/app-core/referral/copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackEvent } from '../../services/analytics';
import { coreHttp } from '../../services/core-http';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import { miniAppLink } from '../../utils/miniapp-link';
import { useActionLock, useShareWithFallback } from '../share-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';

/**
 * Thẻ thành tích Sổ tay Xanh (cờ growth.referral_viral_enabled, chunk tải lười). `actions`: ở Sổ tay Xanh thẻ có nút chia sẻ Zalo và sao
 * chép link mời; ở khối "Mời bạn sống xanh" của Cá nhân chỉ một dòng số, vì thẻ chia sẻ của khối đó đã nêu thưởng và có hai nút cùng việc.
 * Chưa có số hoặc lỗi thì không vẽ gì (cùng `web/components/referral/green-card.tsx`).
 */
export default function GreenCardBlock({ actions }: { actions: boolean }) {
  const q = useQuery(greenCardQuery(coreHttp));
  const cfg = usePublicConfig();
  const lock = useActionLock();
  const share = useShareWithFallback();
  const { openSnackbar } = useSnackbar();
  const card = q.data;
  if (!card) return null;
  const stats = greenCardStats(card);
  if (!actions) {
    return (
      <Text
        variant="caption"
        tone="brand"
        as="p"
        style={{ marginTop: 'var(--space-stack-xs)' }}
        data-testid="green-card-stats"
      >
        {stats}
      </Text>
    );
  }
  const code = card.referralCode;
  const url = inviteShareLink({
    landing: inviteLandingOn(cfg),
    baseUrl: miniAppLink('/'),
    referralCode: code,
  });
  const onShare = () =>
    void lock.run('share', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'share' });
      await share(
        {
          title: fillCopy('invite.shareTitle'),
          description: shareDescription(null, welcomeOfferOf(cfg)),
          path: `/?ref=${code}`,
        },
        inviteShareText(url),
      );
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'copy' });
      const ok = await copyText(url);
      openSnackbar(
        ok
          ? { text: fillCopy('invite.copied'), type: 'success' }
          : { text: fillCopy('invite.copyFailed', { code }), type: 'info', duration: 4000 },
      );
    });
  return (
    <section data-testid="green-card">
      <Card padding={12}>
        <Heading variant="title-sm" as="h2">
          {greenCardCopy('title')}
        </Heading>
        <Text variant="body-sm" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
          {stats}
        </Text>
        <Text
          variant="caption"
          tone="secondary"
          as="p"
          style={{ marginTop: 'var(--space-inline-xs)' }}
        >
          {greenCardRewardLine(card)}
        </Text>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-stack-sm)',
            marginTop: 'var(--space-stack-sm)',
          }}
        >
          <Button
            fullWidth
            icon={Share2}
            loading={lock.active === 'share'}
            aria-disabled={lock.busy || undefined}
            onPress={onShare}
          >
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
