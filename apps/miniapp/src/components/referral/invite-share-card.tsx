import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import { inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { greenCardQuery } from '@tubutree/app-core/referral/green-card';
import { inviteShareOffer, type InviteShareStat } from '@tubutree/app-core/referral/share-card';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackEvent } from '../../services/analytics';
import { coreHttp } from '../../services/core-http';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import { useActionLock, useShareWithFallback } from '../share-sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';

export interface InviteShareCardProps {
  code: string;
  shareUrl: (code: string) => string;
  /** Lời gửi kèm link khi không có lời mời thưởng đơn đầu (cờ viral tắt, CTV, chạm trần): lời mời mã chào mừng của khối. */
  fallbackText: string;
  /** Cờ `growth.referral_viral_enabled`: tắt thì không gọi `/me/green-card`, không có lời mời thưởng. */
  viral: boolean;
  stats: readonly InviteShareStat[];
  /** Dòng tiến độ / mốc của khối mời, đặt giữa ô số và mã. */
  children?: ReactNode;
}

const STATS_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',
  gap: 'var(--space-inline-sm)',
  margin: 'var(--space-stack-sm) 0 0',
  fontVariantNumeric: 'tabular-nums',
} as const;

/**
 * Thẻ chia sẻ của khối "Mời bạn sống xanh" (Cá nhân). Lời mời đọc thưởng đơn đầu của máy chủ (`inviteShareOffer`), ô số tiến độ, mã, hai nút
 * chia sẻ Zalo / sao chép dùng chung một khoá. Chia sẻ mở hộp chia sẻ Zalo (Mini App mở thẳng `/?ref=`); Zalo từ chối thì chép lời mời kèm link
 * và báo, khách huỷ thì thôi. Mỗi lần bấm ghi `green_card_shared` (surface account). Cùng web `components/referral/invite-share-card.tsx`.
 */
export function InviteShareCard({ code, shareUrl, fallbackText, viral, stats, children }: InviteShareCardProps) {
  const card = useQuery({ ...greenCardQuery(coreHttp), enabled: viral }).data;
  const offer = viral ? inviteShareOffer(card) : null;
  const lock = useActionLock();
  const share = useShareWithFallback();
  const { openSnackbar } = useSnackbar();

  const onShare = () =>
    void lock.run('share', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'share', surface: 'account' });
      await share(
        { title: fillCopy('invite.shareTitle'), description: offer?.message ?? fallbackText, path: `/?ref=${code}` },
        inviteShareText(shareUrl(code)),
      );
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'copy', surface: 'account' });
      const ok = await copyText(shareUrl(code));
      openSnackbar(
        ok
          ? { text: fillCopy('invite.copied'), type: 'success' }
          : { text: fillCopy('invite.copyFailed', { code }), type: 'info', duration: 4000 },
      );
    });

  return (
    <div data-testid="invite-share-card" style={{ marginTop: 'var(--space-stack-sm)' }}>
      <Card variant="outline" padding={12}>
        {offer && (
          <>
            <Heading variant="title-sm" as="h3" font="ui">
              {offer.title}
            </Heading>
            <Text variant="body-sm" tone="brand" as="p" numeric style={{ marginTop: 'var(--space-inline-xs)' }} data-testid="invite-share-offer">
              {offer.line}
            </Text>
          </>
        )}
        {stats.length > 0 && (
          <dl data-testid="invite-share-stats" style={STATS_STYLE}>
            {stats.map((s) => (
              <div key={s.key} style={{ display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-end', gap: 'var(--space-inline-xs)', padding: 'var(--space-inline-sm)', borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)' }}>
                <Text variant="caption" tone="secondary" as="dt">
                  {s.label}
                </Text>
                <Text variant="price-sm" as="dd" numeric>
                  {s.value}
                </Text>
              </div>
            ))}
          </dl>
        )}
        {children}
        <Text variant="caption" as="p" numeric style={{ marginTop: 'var(--space-stack-sm)', color: 'var(--color-action-secondary-fg)' }}>
          {fillCopy('invite.codeLabel')}: <strong>{code}</strong>
        </Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-stack-sm)', marginTop: 'var(--space-stack-sm)' }}>
          <Button fullWidth icon={Share2} loading={lock.active === 'share'} aria-disabled={lock.busy || undefined} onPress={onShare}>
            {fillCopy('invite.shareZalo')}
          </Button>
          <Button fullWidth variant="secondary" icon={Copy} loading={lock.active === 'copy'} aria-disabled={lock.busy || undefined} onPress={onCopy}>
            {fillCopy('invite.copyLink')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
