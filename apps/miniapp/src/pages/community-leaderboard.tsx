import { Page } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { getLeaderboard, type LeaderboardEntry } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { levelEmoji } from '../components/community/rank-badge';
import { vi } from '../i18n/vi';

// Huy chương là nội dung xếp hạng (không phải icon điều hướng) nên giữ emoji.
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const PAGE_BG = { background: 'var(--color-bg-canvas)' } as const;

export default function CommunityLeaderboardPage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';

  const board = useQuery({
    queryKey: ['community', 'leaderboard'],
    queryFn: getLeaderboard,
    enabled: authed,
  });

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (status === 'loading') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.leaderboard} />
        <BoardSkeleton />
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
          {MEDAL[rank] ?? `#${rank}`}
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
