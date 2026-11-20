'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { inviteLandingOn, inviteShareLink } from '@tubutree/app-core/commerce/invite-card';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
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
import { Button, Card, Heading, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { useActionLock } from '@/lib/use-action-lock';

/**
 * Thẻ "đơn này giảm bao nhiêu nhựa" ở Chi tiết đơn (cờ growth.referral_viral_enabled, chunk tải sau): số chai, Điểm Xanh của đơn và
 * một chạm gửi link mời. Trang chỉ vẽ khi máy chủ trả số lớn hơn 0. Cùng Mini App (`miniapp/src/components/orders/eco-impact-card.tsx`).
 */
export default function OrderEcoImpactCard({ impact }: { impact: OrderEcoImpact }) {
  const cfg = useQuery(publicConfigQuery(coreHttp)).data;
  const lock = useActionLock();
  const [msg, setMsg] = useState<string | null>(null);
  const code = impact.referralCode;
  const points = ecoImpactPointsLine(impact);
  const invite = ecoImpactInviteLine(impact);
  const link = () =>
    inviteShareLink({
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
      trackWebEvent('green_card_shared', { method: 'share', surface: 'order' });
      const url = link();
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: fillCopy('invite.shareTitle'), text: `${ecoImpactShareLead(impact)} ${invite}`, url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      await copy(ecoImpactShareText(impact, url));
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      trackWebEvent('green_card_shared', { method: 'copy', surface: 'order' });
      await copy(link());
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
          {invite}
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
        <p
          role="status"
          className={msg ? 'text-caption' : 'sr-only'}
          style={msg ? { marginTop: 'var(--space-stack-xs)', color: 'var(--color-text-secondary)' } : undefined}
        >
          {msg ?? ''}
        </p>
      </Card>
    </section>
  );
}
