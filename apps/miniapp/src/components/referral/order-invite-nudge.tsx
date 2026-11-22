import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, Share2 } from 'lucide-react';
import { inviteLandingOn, inviteShareLink, inviteShareText } from '@tubutree/app-core/commerce/invite-card';
import { greenCardQuery, greenCardRewardLine } from '@tubutree/app-core/referral/green-card';
import { inviteShareOffer } from '@tubutree/app-core/referral/share-card';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackEvent } from '../../services/analytics';
import { coreHttp } from '../../services/core-http';
import { haptic } from '../../utils/haptic';
import { miniAppLink } from '../../utils/miniapp-link';
import { useActionLock, useShareWithFallback } from '../share-sheet';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

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
 * Lời mời bạn ở màn Đặt hàng thành công (cờ `growth.referral_viral_enabled`, chunk tải lười, nằm dưới các nút chính): MỘT dòng chạm mở hộp chia sẻ Zalo
 * kèm link mời. Chỉ hiện khi `GET /me/green-card` báo tài khoản nhận thưởng đơn đầu (`earnsPoints`, thưởng > 0): CTV, chạm trần hay Admin tắt
 * thưởng thì không có dòng, không hứa. Zalo từ chối thì chép lời mời kèm link và báo; khách huỷ thì thôi. Mỗi lần bấm ghi `green_card_shared`
 * (surface order, như thẻ nhựa đã giảm ở Chi tiết đơn).
 */
export default function OrderInviteNudge() {
  const cfg = usePublicConfig();
  // Đơn vừa đặt có thể làm tài khoản chạm trần thưởng: đọc lại thẻ mỗi lần màn này mở, không hứa theo bản 60 giây trước.
  const card = useQuery({ ...greenCardQuery(coreHttp), refetchOnMount: 'always' }).data;
  const lock = useActionLock();
  const share = useShareWithFallback();
  const offer = inviteShareOffer(card);
  if (!card || !offer) return null;
  const code = card.referralCode;
  const busy = lock.active === 'share';
  const onShare = () =>
    void lock.run('share', async () => {
      haptic('light');
      trackEvent('green_card_shared', 'miniapp', { method: 'share', surface: 'order' });
      const link = inviteShareLink({ landing: inviteLandingOn(cfg), baseUrl: miniAppLink('/'), referralCode: code });
      await share({ title: fillCopy('invite.shareTitle'), description: offer.message, path: `/?ref=${code}` }, inviteShareText(link));
    });
  return (
    <button
      type="button"
      data-testid="order-invite-nudge"
      className="tubu-press touch-target"
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
        <Icon icon={Loader2} size="sm" tone="brand" className="ptr-spin" style={{ flex: 'none' }} />
      ) : (
        <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flex: 'none' }} />
      )}
    </button>
  );
}
