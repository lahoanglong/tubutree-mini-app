'use client';

// Nguồn: apps/miniapp/src/components/referral/order-invite-nudge.tsx (cùng chữ, cùng test-id, cùng điều kiện hiện).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, Share2 } from 'lucide-react';
import { inviteLandingOn, inviteShareLink, inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { greenCardQuery, greenCardRewardLine } from '@tubutree/app-core/referral/green-card';
import { inviteShareOffer } from '@tubutree/app-core/referral/share-card';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Icon, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';
import { useActionLock } from '@/lib/use-action-lock';

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 'var(--space-inline-sm)',
  width: '100%',
  padding: 'var(--space-stack-sm) var(--space-inline-md)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-bg-surface)',
  textAlign: 'left',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

/**
 * Lời mời bạn ở màn Đặt hàng thành công (nơi gọi chỉ dựng khi cờ `growth.referral_viral_enabled` bật, dưới các nút chính): MỘT dòng chạm mở hộp chia sẻ của máy
 * (Web Share API) kèm link mời. Chỉ hiện khi `GET /me/green-card` báo tài khoản nhận thưởng đơn đầu (`inviteShareOffer`): CTV, chạm trần hay Admin tắt thưởng thì
 * không có dòng, không hứa. Máy không có hộp chia sẻ thì chép lời mời kèm link và báo; khách đóng hộp thì thôi. Mỗi lần bấm ghi `green_card_shared` (surface order).
 */
export function OrderInviteNudge() {
  const cfg = usePublicConfig();
  // Đơn vừa đặt có thể làm tài khoản chạm trần thưởng: đọc lại thẻ mỗi lần màn này mở, không hứa theo bản 60 giây trước.
  const card = useQuery({ ...greenCardQuery(coreHttp), refetchOnMount: 'always' }).data;
  const lock = useActionLock();
  const [msg, setMsg] = useState<string | null>(null);
  const offer = inviteShareOffer(card);
  if (!card || !offer) return null;
  const code = card.referralCode;
  const busy = lock.active === 'share';
  const onShare = () =>
    void lock.run('share', async () => {
      trackWebEvent('green_card_shared', { method: 'share', surface: 'order' });
      const origin = window.location.origin;
      const url = inviteShareLink({ landing: inviteLandingOn(cfg), baseUrl: origin, referralCode: code, landingOrigin: origin });
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: fillCopy('invite.shareTitle'), text: offer.message, url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(inviteShareText(url));
        setMsg(fillCopy('invite.copied'));
      } catch {
        setMsg(fillCopy('invite.copyFailed', { code }));
      }
    });
  return (
    <div>
      <button
        type="button"
        data-testid="order-invite-nudge"
        className="tubu-press"
        aria-busy={busy || undefined}
        aria-disabled={lock.busy || undefined}
        onClick={onShare}
        style={ROW_STYLE}
      >
        <Icon icon={Share2} size="sm" tone="brand" style={{ flex: 'none' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="span" numeric style={{ display: 'block', fontWeight: 600 }}>
            {greenCardRewardLine(card)}
          </Text>
          <Text variant="caption" tone="brand" as="span" style={{ display: 'block' }}>
            {fillCopy('invite.shareZalo')}
          </Text>
        </span>
        {busy ? (
          <Icon icon={Loader2} size="sm" tone="brand" className="motion-safe:animate-spin" style={{ flex: 'none' }} />
        ) : (
          <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flex: 'none' }} />
        )}
      </button>
      <p role="status" className={msg ? 'mt-1.5 text-caption' : 'sr-only'} style={msg ? { color: 'var(--color-text-secondary)' } : undefined}>
        {msg ?? ''}
      </p>
    </div>
  );
}
