'use client';

import { CalendarCheck, Check, Gift, Sprout, type LucideIcon } from 'lucide-react';
import { checkInCopy, checkInDayIcon, checkInTodayLine, type CheckInDayIcon } from '@tubutree/app-core/daily-check-in-copy';
import { useCheckIn } from '@/lib/use-check-in';
import { ErrorState } from '@/components/ui/error-state';
import { Button, Card, Heading, Icon, Skeleton, Text } from '@/components/mini';

const DAY_ICON: Record<CheckInDayIcon, LucideIcon> = { check: Check, gift: Gift, sprout: Sprout };

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/**
 * Khối điểm danh DUY NHẤT của web (trang Điểm Xanh và Ưu đãi), cùng bố cục với Mini App: một nút cộng cả Điểm Xanh và giọt
 * nước, nút ở dòng riêng, ô ngày chỉ có số ngày và biểu tượng, lưới `minmax(0, 1fr)` để 7 ô gọn trong thẻ ở 320px.
 */
export function DailyCheckInCard({ authed }: { authed: boolean }) {
  const { status, statusQ, view, pending, checkIn, message } = useCheckIn(authed);

  if (statusQ.isLoading) return <Skeleton height={140} radius="var(--radius-card)" />;
  if (statusQ.isError) {
    return (
      <Card padding={16}>
        <ErrorState variant="inline" message={checkInCopy.loadError(errText(statusQ.error))} onRetry={() => void statusQ.refetch()} />
      </Card>
    );
  }
  if (!status || !view) return null;

  const today = checkInTodayLine(status);
  return (
    <div data-testid="daily-check-in">
      <Card padding={16}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Icon icon={CalendarCheck} tone="brand" />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Heading variant="title-sm" as="h2">
              {checkInCopy.title}
            </Heading>
            <Text variant="caption" tone="tertiary" as="div">
              {checkInCopy.cycleDay(status.currentCycleDay)}
            </Text>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, textAlign: 'center' }}>
          {status.rewards.map((r) => (
            <div
              key={r.day}
              aria-label={checkInCopy.dayAria(r.day, r.points, r.claimed)}
              style={{
                padding: '6px 0',
                borderRadius: 'var(--radius-control)',
                background: r.claimed ? 'var(--color-bg-subtle)' : r.isToday ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-canvas)',
                border: r.isToday
                  ? '1px solid var(--color-border-selected)'
                  : r.claimed
                    ? '1px solid var(--color-action-secondary-border)'
                    : '1px solid transparent',
              }}
            >
              <Text variant="label" tone={r.claimed ? 'brand' : 'tertiary'} as="div" style={{ fontWeight: 400 }}>
                N{r.day}
              </Text>
              <div style={{ marginTop: 2, display: 'flex', justifyContent: 'center' }}>
                <Icon icon={DAY_ICON[checkInDayIcon(r.day, r.claimed)]} size="sm" tone={r.claimed ? 'brand' : 'muted'} />
              </div>
            </div>
          ))}
        </div>

        {today && (
          <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 10 }}>
            {today}
          </Text>
        )}
        <Button fullWidth disabled={!view.canCheckIn || pending} loading={pending} onPress={checkIn} style={{ marginTop: 12 }}>
          {view.buttonLabel}
        </Button>
        {message && (
          <p role={message.error ? 'alert' : 'status'} className={`mt-2 text-sm ${message.error ? 'text-danger-fg' : 'text-stone-700'}`}>
            {message.text}
          </p>
        )}
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          {checkInCopy.rule}
        </Text>
      </Card>
    </div>
  );
}
