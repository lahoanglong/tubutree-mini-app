'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Check, ChevronRight, Gift, Leaf, PackageOpen, Recycle, Sprout, Users, type LucideIcon } from 'lucide-react';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { memberCardView } from '@tubutree/app-core/home-layout';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { pointsSummary } from '@/lib/checkout-points';
import { autoCouponName } from '@/lib/coupon-name';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { useCheckIn } from '@/lib/use-check-in';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Button, Card, EmptyState, Heading, Icon, ListRow, Skeleton, Text } from '@/components/mini';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

function IconTile({ icon }: { icon: LucideIcon }) {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
      <Icon icon={icon} tone="brand" />
    </span>
  );
}

function CouponCard({ coupon: c }: { coupon: CouponDTO }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: 12,
        background: 'var(--color-promo-bg)',
        borderRadius: 'var(--radius-control)',
        border: '1px dashed var(--clay-100)',
      }}
    >
      <div>
        <Text variant="body-sm" as="div" style={{ color: 'var(--color-promo-fg)', fontWeight: 700 }}>
          {couponLabel(c)}
        </Text>
        <Text variant="caption" tone="secondary" as="div">
          {autoCouponName(c.code) ?? `Mã ${c.code}`}
          {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
        </Text>
      </div>
      <Text variant="caption" tone="tertiary">
        HSD {formatDate(c.endAt)}
      </Text>
    </div>
  );
}

/**
 * Trang Ưu đãi (phương án A), bản web của `pages/offers.tsx` ở Mini App: thẻ Điểm Xanh và hạng, Điểm danh, Đổi quà và tiện ích,
 * Mã giảm giá của tôi. `?section=coupons` cuộn tới danh sách mã. Web không có "tích điểm đơn sàn" (chưa có route) nên dòng đó ẩn.
 */
export default function OffersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const { user } = useAuth();
  const cfg = usePublicConfig();
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const { status: checkInStatus, statusQ: checkInQ, view: checkInView, pending, checkIn, message } = useCheckIn(authed);
  const couponsRef = useRef<HTMLElement>(null);
  const wantsCoupons = params?.get('section') === 'coupons';
  const couponsReady = couponsQ.isSuccess || couponsQ.isError;

  useEffect(() => {
    if (wantsCoupons && couponsReady) couponsRef.current?.scrollIntoView?.({ block: 'start' });
  }, [wantsCoupons, couponsReady]);

  const card = user
    ? memberCardView({ overview: loyaltyQ.data, pointsTotal: pointsSummary(loyaltyQ.data ?? user).total, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem })
    : null;
  const coupons = couponsQ.data ?? [];

  const shortcuts: { icon: LucideIcon; title: string; subtitle: string; to: string; show: boolean }[] = [
    { icon: Gift, title: homeCopy.offers.rewardsTitle, subtitle: homeCopy.offers.rewardsHint, to: '/kho-qua', show: true },
    { icon: PackageOpen, title: homeCopy.offers.myRewards, subtitle: homeCopy.offers.myRewardsHint, to: '/kho-qua/cua-toi', show: true },
    { icon: Recycle, title: 'Đổi rác lấy quà', subtitle: homeCopy.offers.recycleHint, to: '/doi-rac', show: cfg.isLoaded && cfg.waste.enabled },
    { icon: Users, title: 'Mua chung nhóm', subtitle: homeCopy.offers.groupBuyHint, to: '/mua-chung', show: true },
    { icon: Sprout, title: 'Vườn Xanh', subtitle: 'Chăm cây nhận quà', to: '/vuon-xanh', show: true },
  ];

  let body: React.ReactNode;
  if (phase === 'loading') body = <AuthLoading />;
  else if (phase === 'unavailable') body = <SessionUnavailable />;
  else if (!authed) body = <LoginRequired message={`${homeCopy.offers.loginTitle}. ${homeCopy.offers.loginBody}`} returnTo="/uu-dai" />;
  else
    body = (
      <div className="flex flex-col gap-3 md:max-w-xl">
        <section aria-label={homeCopy.offers.pointsTitle}>
          <button
            type="button"
            aria-label={homeCopy.offers.pointsDetail}
            className="tubu-press"
            onClick={() => router.push('/tai-khoan/diem-xanh')}
            style={{
              display: 'block',
              width: '100%',
              padding: 16,
              border: 'none',
              textAlign: 'left',
              fontFamily: 'inherit',
              cursor: 'pointer',
              color: 'var(--color-text-inverse)',
              background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--elevation-1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="body-sm" tone="inverse" style={{ fontWeight: 600 }}>
                <Icon icon={Leaf} size="sm" tone="inverse" style={{ verticalAlign: '-3px' }} /> {card?.tierName}
              </Text>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Text variant="caption" tone="inverse">
                  {homeCopy.offers.pointsDetail}
                </Text>
                <Icon icon={ChevronRight} size="sm" tone="inverse" />
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Heading variant="title-lg" as="div" tone="inverse" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {card?.pointsLabel}
              </Heading>
              {card?.valueLabel && (
                <Text variant="body-sm" tone="inverse" style={{ opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                  {card.valueLabel}
                </Text>
              )}
            </div>
            {loyaltyQ.data && card && (
              <div style={{ marginTop: 10 }}>
                <div role="progressbar" aria-label="Tiến độ lên hạng kế" aria-valuemin={0} aria-valuemax={100} aria-valuenow={card.progressPct} style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--color-text-inverse) 28%, transparent)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${card.progressPct}%`, background: 'var(--color-text-inverse)', borderRadius: 'var(--radius-pill)' }} />
                </div>
                <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 4, opacity: 0.9 }}>
                  {card.toGoLine ?? homeCopy.member.topTier}
                </Text>
              </div>
            )}
          </button>
        </section>

        <section aria-label={homeCopy.offers.checkInTitle}>
          {checkInQ.isLoading ? (
            <Skeleton height={112} radius="var(--radius-card)" />
          ) : checkInQ.isError ? (
            <Card padding={16}>
              <ErrorState message={`Chưa tải được lịch điểm danh: ${errText(checkInQ.error)}`} onRetry={() => void checkInQ.refetch()} />
            </Card>
          ) : checkInStatus && checkInView ? (
            <Card padding={16}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <IconTile icon={CalendarCheck} />
                  <div style={{ minWidth: 0 }}>
                    <Heading variant="title-sm" as="h2">
                      {homeCopy.offers.checkInTitle}
                    </Heading>
                    <Text variant="caption" tone="tertiary" as="div">
                      {homeCopy.offers.streak(checkInStatus.streakDays)}
                    </Text>
                  </div>
                </div>
                <Button disabled={!checkInView.canCheckIn || pending} loading={pending} onPress={checkIn} style={{ flexShrink: 0 }}>
                  {checkInView.buttonLabel}
                </Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center', marginTop: 12 }}>
                {checkInStatus.rewards.map((r) => (
                  <div
                    key={r.day}
                    style={{
                      padding: '6px 2px',
                      borderRadius: 'var(--radius-control)',
                      background: r.claimed ? 'var(--color-bg-subtle)' : r.isToday ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-canvas)',
                      border: r.isToday ? '1px solid var(--color-border-selected)' : '1px solid transparent',
                    }}
                  >
                    <Text variant="caption" tone="tertiary" as="div">
                      N{r.day}
                    </Text>
                    <Text variant="label" tone={r.claimed ? 'brand' : 'primary'} as="div">
                      {r.claimed ? <Icon icon={Check} size="sm" tone="brand" /> : `+${r.points.toLocaleString('vi-VN')}`}
                    </Text>
                  </div>
                ))}
              </div>
              {message && (
                <p role="status" className={`mt-2 text-sm ${message.error ? 'text-danger-fg' : 'text-stone-700'}`}>
                  {message.text}
                </p>
              )}
            </Card>
          ) : null}
        </section>

        <section aria-label={homeCopy.offers.rewardsTitle}>
          <Card variant="outline" padding={0} style={{ overflow: 'hidden' }}>
            {shortcuts
              .filter((s) => s.show)
              .map((s, i) => (
                <ListRow
                  key={s.to}
                  icon={<IconTile icon={s.icon} />}
                  title={s.title}
                  subtitle={s.subtitle}
                  trailing="chevron"
                  onPress={() => router.push(s.to)}
                  style={{ padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                />
              ))}
          </Card>
        </section>

        <section id="coupons" ref={couponsRef} aria-label={homeCopy.offers.couponsTitle} style={{ paddingTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Heading variant="title-sm" as="h2">
              {homeCopy.offers.couponsTitle}
            </Heading>
            {coupons.length > 0 && (
              <Text variant="caption" tone="tertiary">
                {homeCopy.offers.couponsCount(coupons.length)}
              </Text>
            )}
          </div>
          {couponsQ.isLoading ? (
            <Skeleton height={64} />
          ) : couponsQ.isError ? (
            <ErrorState message={`Chưa tải được mã giảm giá: ${errText(couponsQ.error)}`} onRetry={() => void couponsQ.refetch()} />
          ) : coupons.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {coupons.map((c) => (
                <CouponCard key={c.code} coupon={c} />
              ))}
            </div>
          ) : (
            <EmptyState variant="inline" art="leaf" heading={homeCopy.offers.couponsEmptyHeading} body={homeCopy.offers.couponsEmptyBody} />
          )}
        </section>
      </div>
    );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:pt-0">
      <PageHeader title={homeCopy.offers.title} />
      <div className="mt-3">{body}</div>
    </main>
  );
}
