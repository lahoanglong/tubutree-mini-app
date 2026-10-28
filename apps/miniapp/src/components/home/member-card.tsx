import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { ChevronRight, Leaf } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_HERO_HEIGHT, memberCardAriaLabel, memberCardView } from '@tubutree/app-core/home-layout';
import { useCheckIn } from '../../hooks/use-check-in';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { getLoyalty } from '../../services/account-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { pointsSummary } from '../../utils/points-lots';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const SECTION_PAD = '0 16px 12px';

export function MemberCardSkeleton() {
  return (
    <div data-testid="member-card-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
      <Skeleton height={HOME_HERO_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}

/**
 * Thẻ thành viên gọn một dòng ở đầu Trang chủ khách cũ: lời chào + hạng, Điểm Xanh thật và nút Điểm danh. Chạm vào phần chữ để mở
 * trang Ưu đãi (Điểm Xanh). Cao cố định `HOME_HERO_HEIGHT` (bằng dải Quà khách mới) để đổi loại khách không làm trang nhảy.
 * Số điểm lấy từ hồ sơ đăng nhập khi tổng quan chưa về; tổng quan lỗi thì dòng điểm báo lỗi kèm "Thử lại".
 */
export function MemberCard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const cfg = usePublicConfig();
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  const { view: checkInView, pending, checkIn } = useCheckIn(authed);
  if (!authed || !user) return null;

  const card = memberCardView({
    overview: loyaltyQ.data,
    pointsTotal: pointsSummary(loyaltyQ.data ?? user).total,
    vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem,
  });
  const greeting = homeCopy.member.greeting(user.fullName ?? vi.auth.greetingFallback);
  const loyaltyFailed = loyaltyQ.isError && !loyaltyQ.data;

  return (
    <section aria-label={homeCopy.member.cardLabel} style={{ padding: SECTION_PAD }}>
      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          color: 'var(--color-text-inverse)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--elevation-1)',
          padding: '0 12px 0 16px',
          height: HOME_HERO_HEIGHT,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          aria-label={memberCardAriaLabel(card, homeCopy.member.openLabel, greeting)}
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/offers');
          }}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-sm" tone="inverse" as="div" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{greeting}</span>
              {card.tierName && (
                <span style={{ flex: '0 0 auto' }}>
                  {' · '}
                  <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
                </span>
              )}
            </Text>
            {loyaltyFailed ? (
              <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {homeCopy.member.tierFailed}
              </Text>
            ) : (
              <Text variant="label" tone="inverse" as="div" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.pointsLabel}
                {card.valueLabel && <span style={{ fontWeight: 500, opacity: 0.9 }}>{` ${card.valueLabel}`}</span>}
              </Text>
            )}
          </div>
          <Icon icon={ChevronRight} size="sm" tone="inverse" />
        </button>
        {loyaltyFailed && (
          <button
            type="button"
            className="tubu-press"
            onClick={() => {
              haptic('light');
              void loyaltyQ.refetch();
            }}
            style={{ flex: '0 0 auto', minHeight: 44, padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-inverse)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
          >
            {homeCopy.member.retry}
          </button>
        )}
        <button
          type="button"
          className="tubu-press"
          disabled={!checkInView?.canCheckIn || pending}
          aria-busy={pending || undefined}
          onClick={checkIn}
          style={{
            flex: '0 0 auto',
            minWidth: 96,
            minHeight: 44,
            padding: '0 12px',
            border: 'none',
            borderRadius: 'var(--radius-control)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-action-secondary-fg)',
            fontFamily: 'inherit',
            fontSize: 'var(--type-label-size)',
            fontWeight: 700,
            cursor: checkInView?.canCheckIn ? 'pointer' : 'default',
            opacity: checkInView?.canCheckIn || pending ? 1 : 0.75,
          }}
        >
          {checkInView?.buttonLabel ?? homeCopy.member.checkInLoading}
        </button>
      </div>
    </section>
  );
}
