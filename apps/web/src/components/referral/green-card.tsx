'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import {
  inviteLandingOn,
  inviteShareLink,
  inviteShareText,
} from '@tubutree/app-core/commerce/invite-card';
import { shareDescription, welcomeOfferOf } from '@tubutree/app-core/commerce/share-offer';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import {
  greenCardQuery,
  greenCardRewardLine,
  greenCardStats,
} from '@tubutree/app-core/referral/green-card';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button, Card, Heading, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { useActionLock } from '@/lib/use-action-lock';

/**
 * Thẻ thành tích Sổ tay Xanh (cờ growth.referral_viral_enabled, chunk tải sau). `actions`: ở Sổ tay Xanh thẻ có nút chia sẻ và sao chép
 * link mời; ở khối "Mời bạn sống xanh" của Tài khoản chỉ một dòng số và thưởng, vì khối đó đã có hai nút cùng việc. Cùng Mini App
 * (`miniapp/src/components/referral/green-card.tsx`); chưa có số hoặc lỗi thì không vẽ gì.
 */
export default function GreenCardBlock({ actions }: { actions: boolean }) {
  const q = useQuery(greenCardQuery(coreHttp));
  const cfg = useQuery(publicConfigQuery(coreHttp)).data;
  const lock = useActionLock();
  const [msg, setMsg] = useState<string | null>(null);
  const card = q.data;
  if (!card) return null;
  const stats = greenCardStats(card);
  const reward = greenCardRewardLine(card);
  if (!actions) {
    return (
      <Text
        variant="caption"
        tone="brand"
        as="p"
        style={{ marginTop: 'var(--space-stack-xs)' }}
        data-testid="green-card-stats"
      >
        {stats}. {reward}
      </Text>
    );
  }
  const code = card.referralCode;
  const url = inviteShareLink({
    landing: inviteLandingOn(cfg),
    baseUrl: window.location.origin,
    referralCode: code,
    landingOrigin: window.location.origin,
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(fillCopy('invite.copied'));
    } catch {
      setMsg(fillCopy('invite.copyFailed', { code }));
    }
  };
  const onShare = () =>
    void lock.run('share', async () => {
      trackWebEvent('green_card_shared', { method: 'share' });
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: fillCopy('invite.shareTitle'),
            text: shareDescription(null, welcomeOfferOf(cfg)),
            url,
          });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      await copy(inviteShareText(url));
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      trackWebEvent('green_card_shared', { method: 'copy' });
      await copy(url);
    });
  return (
    <section data-testid="green-card">
      <Card padding={12}>
        <Heading variant="title-sm" as="h2">
          {fillCopy('greenCard.title')}
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
          {reward}
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
            {fillCopy('greenCard.copy')}
          </Button>
        </div>
        <p
          role="status"
          className={msg ? 'text-caption' : 'sr-only'}
          style={
            msg
              ? { marginTop: 'var(--space-stack-xs)', color: 'var(--color-text-secondary)' }
              : undefined
          }
        >
          {msg ?? ''}
        </p>
      </Card>
    </section>
  );
}
