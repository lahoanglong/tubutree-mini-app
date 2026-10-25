'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardView } from '@tubutree/app-core/home-layout';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { pointsSummary } from '@/lib/checkout-points';
import { useCheckIn } from '@/lib/use-check-in';
import { usePublicConfig } from '@/lib/use-public-config';
import { Heading, Text, Icon } from '@/components/mini';

const LINK_RESET = { display: 'block', width: '100%', textDecoration: 'none', color: 'inherit', minHeight: 44 } as const;
const BUTTON_BASE = {
  flex: 1,
  minWidth: 0,
  minHeight: 44,
  borderRadius: 'var(--radius-control)',
  fontFamily: 'inherit',
  fontSize: 'var(--type-label-size)',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
} as const;

/**
 * Thẻ thành viên ở đầu Trang chủ khách cũ, bản web của `components/home/member-card.tsx` ở Mini App: tên, hạng, Điểm Xanh thật,
 * tiến độ lên hạng và hai việc làm mỗi ngày (Điểm danh, Đổi quà). Chạm phần số mở trang Ưu đãi.
 */
export function MemberCard() {
  const { user } = useAuth();
  const authed = useAuthPhase() === 'authenticated';
  const cfg = usePublicConfig();
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const { view: checkInView, pending, checkIn, message } = useCheckIn(authed);
  if (!authed || !user) return null;

  const card = memberCardView({
    overview: loyaltyQ.data,
    pointsTotal: pointsSummary(loyaltyQ.data ?? user).total,
    vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem,
  });

  return (
    <section aria-label={homeCopy.member.cardLabel} className="pb-3 md:max-w-xl">
      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          color: 'var(--color-text-inverse)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--elevation-1)',
          padding: 16,
        }}
      >
        <Link href="/uu-dai" aria-label={homeCopy.member.openLabel} className="tubu-press" style={LINK_RESET}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {`${homeCopy.member.greeting(user.fullName ?? homeCopy.member.greetingFallback)} · `}
              <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
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
        </Link>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="tubu-press"
            disabled={!checkInView?.canCheckIn || pending}
            aria-busy={pending || undefined}
            onClick={checkIn}
            style={{
              ...BUTTON_BASE,
              border: 'none',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-action-secondary-fg)',
              cursor: checkInView?.canCheckIn ? 'pointer' : 'default',
              opacity: checkInView?.canCheckIn || pending ? 1 : 0.75,
            }}
          >
            {checkInView?.buttonLabel ?? homeCopy.member.checkInLoading}
          </button>
          <Link
            href="/kho-qua"
            className="tubu-press"
            style={{ ...BUTTON_BASE, border: '1px solid var(--color-text-inverse)', background: 'transparent', color: 'var(--color-text-inverse)' }}
          >
            {homeCopy.member.rewards}
          </Link>
        </div>
        {message && (
          <p role="status" style={{ margin: '10px 0 0', fontSize: 'var(--type-caption-size)', color: 'var(--color-text-inverse)' }}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
