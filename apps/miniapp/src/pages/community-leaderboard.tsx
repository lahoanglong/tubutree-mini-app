import { Page } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Medal, Sprout } from 'lucide-react';
import { getLeaderboard, type LeaderboardEntry } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { levelEmoji } from '../components/community/rank-badge';
import { vi } from '../i18n/vi';

const MEDAL: Record<number, { label: string; color: string }> = {
  1: { label: 'Huy chương vàng', color: 'var(--honey-500)' },
  2: { label: 'Huy chương bạc', color: 'var(--stone-450)' },
  3: { label: 'Huy chương đồng', color: 'var(--clay-600)' },
};

const PAGE_BG = { background: 'var(--color-bg-canvas)' } as const;

export default function CommunityLeaderboardPage() {
  const phase = useAuthPhase();
  const login = useAuthStore((s) => s.login);
  const authed = phase === 'authenticated';

  const board = useQuery({
    queryKey: ['community', 'leaderboard'],
    queryFn: getLeaderboard,
    enabled: authed,
  });

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (phase === 'loading') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.leaderboard} />
        <BoardSkeleton />
      </Page>
    );
  }


  // Mất kết nối lúc khôi phục phiên: không phải khách — nói đúng vậy + Thử lại, không mời đăng nhập lại.
  if (phase === 'unavailable') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.leaderboard} />
        <SessionUnavailable />
      </Page>
    );
  }

  // BE yêu cầu JWT cho /feed/leaderboard — chưa đăng nhập thì không có gì để xem.
  if (!authed) {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.leaderboard} />
        <EmptyState art="sprout" heading={vi.community.loginToView} ctaLabel={vi.auth.loginCta} onCta={() => void login()} />
      </Page>
    );
  }

  return (
    <Page style={{ ...PAGE_BG, paddingBottom: 40 }}>
      <PageHeader title={vi.community.leaderboard} />

      <div style={{ padding: 12 }}>
        {board.isLoading ? (
          <BoardSkeleton flush />
        ) : board.isError ? (
          <ErrorState message={getErrorMessage(board.error)} onRetry={() => void board.refetch()} />
        ) : !board.data || board.data.length === 0 ? (
          <EmptyState art="leaf" heading={vi.community.emptyHeading} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 4px' }}>
              <Text variant="caption" tone="tertiary" style={{ width: 28, textAlign: 'center' }}>
                {vi.community.rank}
              </Text>
              <div style={{ width: 36 }} />
              <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                {vi.community.member}
              </Text>
              <Text variant="caption" tone="tertiary">
                {vi.community.points}
              </Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {board.data.map((entry, i) => (
                <LeaderRow key={`${entry.author}-${i}`} rank={i + 1} entry={entry} />
              ))}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

function BoardSkeleton({ flush }: { flush?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: flush ? 0 : 12 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} height={56} radius="var(--radius-card)" />
      ))}
    </div>
  );
}

function LeaderRow({ rank, entry }: { rank: number; entry: LeaderboardEntry }) {
  return (
    <Card padding={12}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Text variant="body-md" style={{ width: 28, textAlign: 'center', fontWeight: 600 }}>
          {MEDAL[rank] ? (
            <Medal size={22} strokeWidth={1.75} role="img" aria-label={MEDAL[rank].label} color={MEDAL[rank].color} />
          ) : (
            `#${rank}`
          )}
        </Text>
        {entry.avatar ? (
          <img src={entry.avatar} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--color-action-secondary-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon icon={Sprout} size="sm" tone="brand" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {entry.author}
          </Text>
          <Text variant="caption" tone="brand" as="div">
            {levelEmoji(entry.level)} {entry.levelName}
          </Text>
        </div>
        <Text variant="body-sm" tone="brand" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {entry.reputation} {vi.community.points}
        </Text>
      </div>
    </Card>
  );
}
