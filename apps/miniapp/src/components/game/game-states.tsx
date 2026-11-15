import { Skeleton } from '../ui/skeleton';
import { Card } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Heading, Text } from '../ui/text';
import { useBlockedMessage } from '../ui/auth-gate';
import { vi } from '../../i18n/vi';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

export function GameSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={160} radius="var(--radius-card)" />
      <Skeleton height={44} radius="var(--radius-control)" />
      <Skeleton height={56} radius="var(--radius-card)" />
      <Skeleton height={140} radius="var(--radius-card)" />
    </div>
  );
}

const MINI_STAGES = [
  { num: '01', name: 'Hạt mầm', note: 'Gieo hạt giống bản địa' },
  { num: '02', name: 'Cây non', note: 'Điểm danh & hứng sương' },
  { num: '03', name: 'Đơm hoa', note: 'Giải đố & tưới nước' },
  { num: '04', name: 'Thu hoạch', note: 'Nhận Điểm Xanh & quà 0đ' },
] as const;

export function GameLoginGate({ onLogin }: { onLogin: () => void }) {
  // Tài khoản bị khoá: nói lý do ngay trên cổng như feed/cộng đồng, không chỉ trong thanh báo sau khi bấm.
  const blocked = useBlockedMessage();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
      <EmptyState art="sprout" heading={gameNewbieCopy.loginToView} body={blocked ?? undefined} ctaLabel={vi.auth.loginCta} onCta={onLogin} />
      <div style={{ padding: '0 var(--space-inset-page)' }}>
        <Card variant="outline">
          <Heading variant="title-sm" font="ui">
            4 chặng trồng cây — nhận quà 0đ & góp rừng thật
          </Heading>
          <div
            style={{
              marginTop: 'var(--space-inline-sm)',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--space-inline-sm)',
            }}
          >
            {MINI_STAGES.map((s) => (
              <div
                key={s.num}
                style={{
                  padding: 'var(--space-inline-sm)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <Text variant="label" tone="brand" as="div">
                  CHẶNG {s.num} · {s.name}
                </Text>
                <Text variant="caption" tone="secondary" as="p">
                  {s.note}
                </Text>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
