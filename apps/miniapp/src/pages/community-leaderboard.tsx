import { Box, Page, Text, Button } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { getLeaderboard, type LeaderboardEntry } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { levelEmoji } from '../components/community/rank-badge';
import { vi } from '../i18n/vi';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

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
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={3} flex flexDirection="column" style={{ gap: 8 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={56} radius="var(--radius-md)" />
          ))}
        </Box>
      </Page>
    );
  }

  // BE yêu cầu JWT cho /feed/leaderboard — chưa đăng nhập thì không có gì để xem.
  if (!authed) {
    return (
      <Page className="page">
        <Box style={{ textAlign: 'center', padding: 48 }}>
          <Text style={{ fontSize: 48 }}>🏆</Text>
          <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
          <Button style={{ marginTop: 12, background: 'var(--leaf-600)' }} onClick={() => void login()}>
            {vi.auth.loginCta}
          </Button>
        </Box>
      </Page>
    );
  }

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 40 }}>
      <Box p={4} flex alignItems="center" style={{ gap: 8, background: 'var(--neutral-0)' }}>
        <Trophy size={20} color="var(--leaf-700)" />
        <Text.Title size="small">{vi.community.leaderboard}</Text.Title>
      </Box>

      <Box p={3}>
        {board.isLoading ? (
          <Box flex flexDirection="column" style={{ gap: 8 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={56} radius="var(--radius-md)" />
            ))}
          </Box>
        ) : board.isError ? (
          <ErrorState message={getErrorMessage(board.error)} onRetry={() => void board.refetch()} />
        ) : !board.data || board.data.length === 0 ? (
          <EmptyState art="leaf" heading={vi.community.emptyHeading} />
        ) : (
          <>
            <Box flex alignItems="center" px={3} pb={1} style={{ gap: 10 }}>
              <Text size="xSmall" style={{ width: 28, textAlign: 'center', color: 'var(--neutral-400)' }}>
                {vi.community.rank}
              </Text>
              <Box style={{ width: 36 }} />
              <Text size="xSmall" style={{ flex: 1, color: 'var(--neutral-400)' }}>
                {vi.community.member}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {vi.community.points}
              </Text>
            </Box>
            {board.data.map((entry, i) => <LeaderRow key={`${entry.author}-${i}`} rank={i + 1} entry={entry} />)}
          </>
        )}
      </Box>
    </Page>
  );
}

function LeaderRow({ rank, entry }: { rank: number; entry: LeaderboardEntry }) {
  return (
    <Box
      flex
      alignItems="center"
      p={3}
      mb={2}
      style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-md)', gap: 10 }}
    >
      <Text bold style={{ width: 28, textAlign: 'center' }}>
        {MEDAL[rank] ?? `#${rank}`}
      </Text>
      {entry.avatar ? (
        <img src={entry.avatar} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} />
      ) : (
        <Box
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--leaf-200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text size="small">🌱</Text>
        </Box>
      )}
      <Box style={{ flex: 1 }}>
        <Text size="small" bold>
          {entry.author}
        </Text>
        <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
          {levelEmoji(entry.level)} {entry.levelName}
        </Text>
      </Box>
      <Text size="small" bold style={{ color: 'var(--primary-700)', whiteSpace: 'nowrap' }}>
        {entry.reputation} {vi.community.points}
      </Text>
    </Box>
  );
}
