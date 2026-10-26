import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { ChevronRight, Leaf } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardAriaLabel, memberCardView } from '@tubutree/app-core/home-layout';
import { useCheckIn } from '../../hooks/use-check-in';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { getLoyalty } from '../../services/account-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { pointsSummary } from '../../utils/points-lots';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

const SECTION_PAD = '0 16px 12px';

/** Chiều cao thẻ thành viên thật ở khổ 375px (đo bằng e2e): giữ chỗ lúc app chưa biết khách cũ hay mới. */
export const MEMBER_CARD_HEIGHT = 186;

export function MemberCardSkeleton() {
  return (
    <div data-testid="member-card-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
      <Skeleton height={MEMBER_CARD_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}

/**
 * Thẻ thành viên ở đầu Trang chủ khách cũ: tên, hạng, Điểm Xanh thật, tiến độ lên hạng và hai việc làm mỗi ngày
 * (Điểm danh, Đổi quà). Chạm vào phần số để mở trang Ưu đãi. Số điểm lấy từ hồ sơ đăng nhập khi tổng quan chưa về.
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
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };
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
          padding: 16,
        }}
      >
        <button
          type="button"
          aria-label={memberCardAriaLabel(card, homeCopy.member.openLabel, greeting)}
          className="tubu-press"
          onClick={() => go('/offers')}
          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.tierName ? `${greeting} · ` : greeting}
              {card.tierName && (
                <>
                  <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
                </>
              )}
            </Text>
            <Icon icon={ChevronRight} size="sm" tone="inverse" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <Heading variant="title-lg" as="div" tone="inverse" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {card.pointsLabel}
            </Heading>
            {card.valueLabel && (
              <Text variant="body-sm" tone="inverse" style={{ opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                {card.valueLabel}
              </Text>
            )}
          </div>
        </button>
        <div style={{ marginTop: 10 }}>
          <div
            role={loyaltyQ.data ? 'progressbar' : undefined}
            aria-label={loyaltyQ.data ? 'Tiến độ lên hạng kế' : undefined}
            aria-valuemin={loyaltyQ.data ? 0 : undefined}
            aria-valuemax={loyaltyQ.data ? 100 : undefined}
            aria-valuenow={loyaltyQ.data ? card.progressPct : undefined}
            aria-hidden={loyaltyQ.data ? undefined : true}
            style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)', overflow: 'hidden' }}
          >
            <div style={{ height: '100%', width: `${loyaltyQ.data ? card.progressPct : 0}%`, background: 'var(--color-text-inverse)', borderRadius: 'var(--radius-pill)' }} />
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {loyaltyQ.data ? (
              <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9 }}>
                {card.toGoLine ?? homeCopy.member.topTier}
              </Text>
            ) : loyaltyFailed ? (
              <>
                <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9, minWidth: 0 }}>
                  {homeCopy.member.tierFailed}
                </Text>
                <button
                  type="button"
                  className="tubu-press"
                  onClick={() => {
                    haptic('light');
                    void loyaltyQ.refetch();
                  }}
                  style={{ flex: '0 0 auto', minHeight: 44, margin: '-14px -6px', padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-inverse)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {homeCopy.member.retry}
                </button>
              </>
            ) : (
              <div aria-hidden="true" style={{ visibility: 'hidden' }}>
                <Text variant="caption" tone="inverse" as="div">
                  {homeCopy.member.progressSpacer}
                </Text>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="tubu-press"
            disabled={!checkInView?.canCheckIn || pending}
            aria-busy={pending || undefined}
            onClick={checkIn}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
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
          <button
            type="button"
            className="tubu-press"
            onClick={() => go('/rewards')}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              border: '1px solid var(--color-text-inverse)',
              borderRadius: 'var(--radius-control)',
              background: 'transparent',
              color: 'var(--color-text-inverse)',
              fontFamily: 'inherit',
              fontSize: 'var(--type-label-size)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {homeCopy.member.rewards}
          </button>
        </div>
      </div>
    </section>
  );
}
