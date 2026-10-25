import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { ChevronRight, Leaf } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardView } from '@tubutree/app-core/home-layout';
import { useCheckIn } from '../../hooks/use-check-in';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { getLoyalty } from '../../services/account-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { pointsSummary } from '../../utils/points-lots';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';

const SECTION_PAD = '0 16px 12px';

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
          aria-label={homeCopy.member.openLabel}
          className="tubu-press"
          onClick={() => go('/offers')}
          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {`${homeCopy.member.greeting(user.fullName ?? vi.auth.greetingFallback)} · `}
              <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px' }} /> {card.tierName}
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
          {loyaltyQ.data && (
            <div style={{ marginTop: 10 }}>
              <div
                role="progressbar"
                aria-label="Tiến độ lên hạng kế"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={card.progressPct}
                style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', width: `${card.progressPct}%`, background: 'var(--color-text-inverse)', borderRadius: 'var(--radius-pill)' }} />
              </div>
              <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 4, opacity: 0.9 }}>
                {card.toGoLine ?? homeCopy.member.topTier}
              </Text>
            </div>
          )}
        </button>
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
