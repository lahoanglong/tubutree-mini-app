'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_HERO_HEIGHT, memberCardAriaLabel, memberCardView } from '@tubutree/app-core/home-layout';
import { givenName } from '@tubutree/app-core/person-name';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { pointsSummary } from '@/lib/checkout-points';
import { useCheckIn } from '@/lib/use-check-in';
import { usePublicConfig } from '@/lib/use-public-config';
import { Text, Icon, Skeleton } from '@/components/mini';

// Nền sáng, viền nhẹ, chữ rừng: thẻ thành viên là thông tin tài khoản nên không nặng hơn các khối hàng; nút "Điểm danh" là điểm màu duy nhất (HM-05).
const CARD_STYLE: CSSProperties = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text-brand)',
  borderRadius: 'var(--radius-card)',
  padding: '0 12px 0 16px',
  height: HOME_HERO_HEIGHT,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

/** Một thẻ thành viên gọn một dòng: cao cố định `HOME_HERO_HEIGHT`, bằng dải Quà khách mới, để đổi loại khách không làm trang nhảy. */
export function MemberCardSkeleton() {
  return (
    <div data-testid="member-card-loading" aria-hidden="true">
      <Skeleton height={HOME_HERO_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}

/**
 * Thẻ thành viên gọn một dòng ở đầu Trang chủ khách cũ, bản web của `components/home/member-card.tsx` ở Mini App: lời chào + hạng, Điểm Xanh
 * thật và nút Điểm danh. Chạm phần chữ mở trang Ưu đãi. Tổng quan lỗi thì dòng điểm báo lỗi kèm "Thử lại", thẻ vẫn giữ khung.
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
  const greeting = homeCopy.member.greeting(givenName(user.fullName) ?? homeCopy.member.greetingFallback);
  const loyaltyFailed = loyaltyQ.isError && !loyaltyQ.data;

  return (
    <section aria-label={homeCopy.member.cardLabel}>
      <div style={CARD_STYLE}>
        <Link
          href="/uu-dai"
          aria-label={memberCardAriaLabel(card, homeCopy.member.openLabel, greeting)}
          className="tubu-press"
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: 'inherit', minHeight: 44 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-sm" tone="brand" as="div" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{greeting}</span>
              {card.tierName && (
                <span style={{ flex: '0 0 auto' }}>
                  {'\u00A0· '}
                  <Icon icon={Leaf} size="sm" tone="brand" style={{ verticalAlign: '-3px', display: 'inline' }} /> {card.tierName}
                </span>
              )}
            </Text>
            {loyaltyFailed ? (
              <Text variant="caption" tone="secondary" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {homeCopy.member.tierFailed}
              </Text>
            ) : (
              <Text variant="label" tone="primary" as="div" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.pointsLabel}
                {card.valueLabel && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>{` ${card.valueLabel}`}</span>}
              </Text>
            )}
          </div>
          <Icon icon={ChevronRight} size="sm" tone="muted" />
        </Link>
        {loyaltyFailed && (
          <button
            type="button"
            className="tubu-press"
            onClick={() => void loyaltyQ.refetch()}
            style={{ flex: '0 0 auto', minHeight: 44, padding: '0 6px', border: 'none', background: 'transparent', color: 'var(--color-text-brand)', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
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
            background: 'var(--color-action-primary-bg)',
            color: 'var(--color-action-primary-fg)',
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
      {message && (
        <p role="status" style={{ margin: '8px 0 0', fontSize: 'var(--type-caption-size)', color: 'var(--color-text-secondary)' }}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/**
 * Mất mạng hay API tạm lỗi lúc khôi phục phiên của khách cũ: giữ khung thẻ thành viên và nói rõ, kèm "Thử lại", thay vì rút thẻ và đưa trang
 * về bố cục khách mới (bản web của dòng "Chưa tải được hạng và điểm" ở Mini App).
 */
export function MemberCardUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section aria-label={homeCopy.member.cardLabel}>
      <div style={CARD_STYLE}>
        <Text variant="body-sm" tone="brand" as="div" style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {homeCopy.member.offline}
        </Text>
        <button
          type="button"
          className="tubu-press"
          onClick={onRetry}
          style={{ flex: '0 0 auto', minWidth: 96, minHeight: 44, padding: '0 12px', border: 'none', borderRadius: 'var(--radius-control)', background: 'var(--color-action-secondary-bg)', color: 'var(--color-action-secondary-fg)', fontFamily: 'inherit', fontSize: 'var(--type-label-size)', fontWeight: 700, cursor: 'pointer' }}
        >
          {homeCopy.member.retry}
        </button>
      </div>
    </section>
  );
}
