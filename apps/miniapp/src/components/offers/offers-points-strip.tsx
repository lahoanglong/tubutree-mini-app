import { ChevronRight, Leaf } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardAriaLabel } from '@tubutree/app-core/home-layout';
import { offersMemberCard } from '@tubutree/app-core/member-card-grace';
import type { LoyaltyOverview } from '../../services/account-api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { pointsSummary } from '../../utils/points-lots';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';

export type PointsStripQuery = Pick<UseQueryResult<LoyaltyOverview>, 'data' | 'isError' | 'refetch'>;

/**
 * Dải Điểm Xanh gọn của Ưu đãi (Q10): hạng, điểm, thanh tiến độ, và cả khối bấm được tới `/loyalty` (một nút, không dòng "Chi tiết" thứ hai).
 * Trong hạn giữ hạng thì dòng dưới thẻ nói chuyện giữ hạng, nên thanh tiến độ lên hạng kế không vẽ (tránh bị đọc thành tiến độ giữ hạng).
 * Chưa có số hạng thì không đoán hạng: giữ chỗ thanh tiến độ, lỗi thì báo tại chỗ và "Thử lại".
 */
export function OffersPointsStrip({ loyalty }: { loyalty: PointsStripQuery }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const cfg = usePublicConfig();
  const card = user
    ? offersMemberCard({ overview: loyalty.data, pointsTotal: pointsSummary(loyalty.data ?? user).total, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem })
    : null;
  const showProgress = !!loyalty.data && !card?.inGrace;

  return (
    <section aria-label={homeCopy.offers.pointsTitle} style={{ padding: '12px 16px 0' }}>
      <div
        style={{
          padding: '12px 16px',
          color: 'var(--color-text-inverse)',
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--elevation-1)',
        }}
      >
        <button
          type="button"
          aria-label={card ? memberCardAriaLabel(card, homeCopy.offers.pointsDetail) : homeCopy.offers.pointsDetail}
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/loyalty');
          }}
          style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', minHeight: 44 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600 }}>
              {card?.tierName ? (
                <>
                  <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
                </>
              ) : null}
            </Text>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Text variant="caption" tone="inverse">
                {homeCopy.offers.pointsDetail}
              </Text>
              <Icon icon={ChevronRight} size="sm" tone="inverse" />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            <Heading variant="title-md" as="div" tone="inverse" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {card?.pointsLabel}
            </Heading>
            {card?.valueLabel && (
              <Text variant="body-sm" tone="inverse" style={{ opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                {card.valueLabel}
              </Text>
            )}
          </div>
        </button>
        <div style={{ marginTop: 6 }}>
          <div
            role={showProgress ? 'progressbar' : undefined}
            aria-label={showProgress ? 'Tiến độ lên hạng kế' : undefined}
            aria-valuemin={showProgress ? 0 : undefined}
            aria-valuemax={showProgress ? 100 : undefined}
            aria-valuenow={showProgress && card ? card.progressPct : undefined}
            aria-hidden={showProgress ? undefined : true}
            style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)', overflow: 'hidden', visibility: card?.inGrace ? 'hidden' : undefined }}
          >
            <div style={{ height: '100%', width: `${loyalty.data && card ? card.progressPct : 0}%`, background: 'var(--color-text-inverse)', borderRadius: 'var(--radius-pill)' }} />
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {loyalty.data && card ? (
              <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9 }}>
                {card.toGoLine ?? homeCopy.member.topTier}
              </Text>
            ) : loyalty.isError ? (
              <>
                <Text variant="caption" tone="inverse" as="div" style={{ opacity: 0.9, minWidth: 0 }}>
                  {homeCopy.member.tierFailed}
                </Text>
                <button
                  type="button"
                  className="tubu-press"
                  onClick={() => {
                    haptic('light');
                    void loyalty.refetch();
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
      </div>
    </section>
  );
}
