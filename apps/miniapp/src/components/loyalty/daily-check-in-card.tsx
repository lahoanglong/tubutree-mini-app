import { lazy, Suspense, useId, useState } from 'react';
import { CalendarCheck, Check, ChevronDown, Gift, Sprout, type LucideIcon } from 'lucide-react';
import { checkInCopy, checkInDayIcon, checkInTodayLine, type CheckInDayIcon } from '@tubutree/app-core/daily-check-in-copy';
import { checkInDayAria, checkInRule } from '@tubutree/app-core/daily-check-in-guest-copy';
import { getLoadErrorMessage } from '../../services/api';
import { useCheckIn } from '../../hooks/use-check-in';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ErrorState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

// Chỉ khách vãng lai mới thấy: tách chunk để thẻ này (nằm trong entry) không phình.
const GuestPointsNote = lazy(() => import('./guest-points-note').then((m) => ({ default: m.GuestPointsNote })));

const DAY_ICON: Record<CheckInDayIcon, LucideIcon> = { check: Check, gift: Gift, sprout: Sprout };

/**
 * Bản gọn (Ưu đãi) đo ở 375px với phần thưởng thật của máy chủ (dòng "Nhận ..." một dòng): hàng đầu 48 + 7 ô 48 + dòng cuối 20 + đệm. Khung chờ giữ đúng chiều cao này,
 * cả lúc đã điểm danh (dòng cuối thành "đã điểm danh"). e2e `offers.miniapp.spec` đối chiếu khung chờ với thẻ thật; đổi bố cục thì đo lại và sửa số này.
 */
export const CHECK_IN_COMPACT_HEIGHT = 156;

/**
 * Khối điểm danh DUY NHẤT của Mini App (trang Điểm Xanh và tab Ưu đãi): một nút cộng cả Điểm Xanh và giọt nước.
 * Ô ngày chỉ có số ngày và biểu tượng, lưới `minmax(0, 1fr)` để 7 ô luôn nằm gọn trong thẻ ở 320px; nút nằm dòng riêng.
 * `compact` (Ưu đãi, nơi điểm danh chỉ là một khối trong trang dài): nút lên hàng tiêu đề, nút "Luật" (tên đọc "Luật điểm danh", aria-expanded) đứng cạnh "Ngày n/7" và mở đoạn luật ngay dưới hàng đó.
 * Tài khoản khách (`pointsBlocked`) thêm khối mời đăng nhập Zalo nên cao hơn khung chờ; chỉ nhóm đó, không tính vào `CHECK_IN_COMPACT_HEIGHT`.
 */
export function DailyCheckInCard({ authed, margin, compact = false }: { authed: boolean; margin?: string; compact?: boolean }) {
  const { status, statusQ, view, pending, checkIn } = useCheckIn(authed);
  const [ruleOpen, setRuleOpen] = useState(false);
  const ruleId = useId();
  const wrap = margin ? { margin } : undefined;

  if (statusQ.isLoading) return <div style={wrap}><Skeleton height={compact ? CHECK_IN_COMPACT_HEIGHT : 140} radius="var(--radius-card)" /></div>;
  if (statusQ.isError) {
    return (
      <Card style={wrap} padding={16}>
        <ErrorState variant="inline" title={checkInCopy.loadErrorTitle} message={getLoadErrorMessage(statusQ.error)} onRetry={() => void statusQ.refetch()} />
      </Card>
    );
  }
  if (!status || !view) return null;

  const today = checkInTodayLine(status);
  // Bản gọn luôn có một hàng dưới 7 ô ("Nhận ..." phần thưởng hôm nay, hoặc "đã điểm danh" khi xong): thẻ cao như nhau trước và sau khi điểm danh.
  const todayRow = checkInTodayLine(status, { short: true }) ?? (status.checkedInToday ? checkInCopy.alreadyDone : null);
  return (
    <div style={wrap} data-testid="daily-check-in">
      <Card padding={compact ? 12 : 16}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12 }}>
          {!compact && (
            <span style={{ width: 34, height: 34, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
              <Icon icon={CalendarCheck} tone="brand" />
            </span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <Heading variant="title-sm" as="h2" font="ui">
              {checkInCopy.title}
            </Heading>
            {compact ? (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12 }}>
                <Text variant="caption" tone="tertiary" as="span">
                  {checkInCopy.cycleDay(status.currentCycleDay)}
                </Text>
                <button
                  type="button"
                  className="tubu-press tubu-hit-44"
                  aria-label={checkInCopy.ruleToggle}
                  aria-expanded={ruleOpen}
                  aria-controls={ruleId}
                  onClick={() => setRuleOpen((o) => !o)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 24, padding: 0, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                >
                  {checkInCopy.ruleToggleLabel}
                  <ChevronDown size={14} aria-hidden="true" style={{ transform: ruleOpen ? 'rotate(180deg)' : undefined }} />
                </button>
              </div>
            ) : (
              <Text variant="caption" tone="tertiary" as="div">
                {checkInCopy.cycleDay(status.currentCycleDay)}
              </Text>
            )}
          </div>
          {/* Nút đệm 12px, bỏ min-width 120px của ZaUI (như thanh dính): "Đã điểm danh" hẹp lại để tiêu đề không gãy dòng ở 360px. */}
          {compact && (
            <Button disabled={!view.canCheckIn || pending} loading={pending} onPress={checkIn} style={{ flex: '0 0 auto', minWidth: 0, paddingLeft: 12, paddingRight: 12 }}>
              {view.buttonLabel}
            </Button>
          )}
        </div>

        {compact && (
          <div id={ruleId} hidden={!ruleOpen}>
            <Text variant="caption" tone="tertiary" as="div" style={{ marginBottom: 8 }}>
              {checkInRule(status)}
            </Text>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, textAlign: 'center' }}>
          {status.rewards.map((r) => (
            <div
              key={r.day}
              aria-label={checkInDayAria(status, r)}
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

        {compact ? (
          todayRow && (
            <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 8 }}>
              {todayRow}
            </Text>
          )
        ) : (
          today && (
            <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 10 }}>
              {today}
            </Text>
          )
        )}
        {status.pointsBlocked && (
          <Suspense fallback={null}>
            <GuestPointsNote margin="10px 0 0" />
          </Suspense>
        )}
        {!compact && (
          <Button fullWidth disabled={!view.canCheckIn || pending} loading={pending} onPress={checkIn} style={{ marginTop: 12 }}>
            {view.buttonLabel}
          </Button>
        )}
        {!compact && (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
            {checkInRule(status)}
          </Text>
        )}
      </Card>
    </div>
  );
}
