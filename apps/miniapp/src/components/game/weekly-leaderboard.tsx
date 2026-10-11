import { Box, Text } from 'zmp-ui';
import type { LeaderRow } from '../../services/game-api';
import { GameCard } from './game-card';

export function WeeklyLeaderboard({ board }: { board: LeaderRow[] | undefined }) {
  return (
    <GameCard title="🏆 Bảng xếp hạng tuần">
      {board && board.length > 0 ? (
        <>
          {/* Podium top 3 */}
          <Box flex alignItems="flex-end" justifyContent="center" style={{ gap: 8, marginBottom: 12 }}>
            {[board[1], board[0], board[2]].map((r, idx) => {
              if (!r) return <Box key={idx} style={{ flex: 1 }} />;
              const isFirst = r.rank === 1;
              const h = isFirst ? 64 : r.rank === 2 ? 48 : 38;
              const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
              return (
                <Box key={r.rank} style={{ flex: 1, textAlign: 'center' }}>
                  <Text style={{ fontSize: isFirst ? 28 : 22 }}>{medal}</Text>
                  <Text size="xSmall" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.nickname}
                  </Text>
                  <Box
                    style={{
                      height: h,
                      borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                      background: isFirst ? 'var(--primary-600)' : 'var(--leaf-400)',
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--neutral-0)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    🌳{r.treesPlanted}
                  </Box>
                </Box>
              );
            })}
          </Box>
          {/* Hạng 4+ */}
          {board.slice(3).map((r) => (
            <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: '1px solid var(--neutral-100)' }}>
              <Text size="small">
                #{r.rank} {r.nickname}
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                🔥{r.streak} · 🌳{r.treesPlanted}
              </Text>
            </Box>
          ))}
        </>
      ) : (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          Chưa có dữ liệu xếp hạng.
        </Text>
      )}
    </GameCard>
  );
}
