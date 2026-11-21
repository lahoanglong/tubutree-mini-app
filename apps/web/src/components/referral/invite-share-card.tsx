'use client';

// Nguồn: apps/miniapp/src/components/referral/invite-share-card.tsx
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { greenCardQuery } from '@tubutree/app-core/referral/green-card';
import { inviteShareOffer, type InviteShareStat } from '@tubutree/app-core/referral/share-card';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Card, Heading, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { useActionLock } from '@/lib/use-action-lock';

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
 * Thẻ chia sẻ của khối "Mời bạn sống xanh" (Tài khoản). Lời mời đọc thưởng đơn đầu của máy chủ (`inviteShareOffer`), ô số tiến độ, mã, hai nút
 * chia sẻ / sao chép dùng chung một khoá (chạm đúp chỉ chạy một việc). Chia sẻ: hộp chia sẻ của máy (Web Share API) nhận lời mời kèm link; máy
 * không có hộp thì chép lời mời kèm link; khách đóng hộp thì thôi. Mỗi lần bấm ghi `green_card_shared` (surface account) cho Trung tâm tăng trưởng.
 */
export function InviteShareCard({ code, shareUrl, fallbackText, viral, stats, children }: InviteShareCardProps) {
  const card = useQuery({ ...greenCardQuery(coreHttp), enabled: viral }).data;
  const offer = viral ? inviteShareOffer(card) : null;
  const lock = useActionLock();
  const [msg, setMsg] = useState<string | null>(null);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(fillCopy('invite.copied'));
    } catch {
      setMsg(fillCopy('invite.copyFailed', { code }));
    }
  };
  const onShare = () =>
    void lock.run('share', async () => {
      trackWebEvent('green_card_shared', { method: 'share', surface: 'account' });
      const url = shareUrl(code);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: fillCopy('invite.shareTitle'), text: offer?.message ?? fallbackText, url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      await copyText(inviteShareText(url));
    });
  const onCopy = () =>
    void lock.run('copy', async () => {
      trackWebEvent('green_card_shared', { method: 'copy', surface: 'account' });
      await copyText(shareUrl(code));
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
        <p className="mt-2 text-caption tabular-nums text-[color:var(--color-action-secondary-fg)]">
          {fillCopy('invite.codeLabel')}: <strong>{code}</strong>
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <button type="button" aria-busy={lock.active === 'share' || undefined} aria-disabled={lock.busy || undefined} onClick={onShare} className={`${ui.btnPrimary} w-full gap-2`}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {fillCopy('invite.shareZalo')}
          </button>
          <button type="button" aria-busy={lock.active === 'copy' || undefined} aria-disabled={lock.busy || undefined} onClick={onCopy} className={`${ui.btnSecondary} w-full gap-2`}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {fillCopy('invite.copyLink')}
          </button>
        </div>
        <p role="status" className={msg ? 'mt-1.5 text-caption' : 'sr-only'} style={msg ? { color: 'var(--color-text-secondary)' } : undefined}>
          {msg ?? ''}
        </p>
      </Card>
    </div>
  );
}
