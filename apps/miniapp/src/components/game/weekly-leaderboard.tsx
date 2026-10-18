import { Trophy } from 'lucide-react';
import type { LeaderRow } from '../../services/game-api';
import { Text } from '../ui/text';
import { GameCard } from './game-card';

// API xếp theo chuỗi điểm danh dài nhất mọi thời gian (không reset theo tuần), nên nhãn và số trên bục là chuỗi ngày.
// Huy chương, 🌳 (cây đã trồng) và 🔥 (chuỗi ngày) là số liệu xếp hạng của game.
export function WeeklyLeaderboard({ board }: { board: LeaderRow[] | undefined }) {
  return (
    <GameCard title="Chuỗi điểm danh dài nhất" icon={Trophy}>
      {board && board.length > 0 ? (
        <>
          {/* Podium top 3. Khoá theo vị trí ô: khoá theo hạng va với khoá ô trống (idx) khi chỉ có 2 người (hạng 2 đứng ở ô 0). */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
            {[board[1], board[0], board[2]].map((r, idx) => {
              if (!r) return <div key={idx} style={{ flex: 1 }} />;
              const isFirst = r.rank === 1;
              const h = isFirst ? 64 : r.rank === 2 ? 48 : 40;
              const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
              return (
                <div key={idx} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <div style={{ fontSize: isFirst ? 28 : 22, lineHeight: 1.2 }}>{medal}</div>
                  <Text
                    variant="label"
                    as="div"
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {r.nickname}
                  </Text>
                  <div
                    style={{
                      height: h,
                      borderRadius: 'var(--radius-control) var(--radius-control) 0 0',
                      background: isFirst ? 'var(--forest-600)' : 'var(--forest-500)',
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-text-inverse)',
                      fontSize: 'var(--type-label-size)',
                      fontWeight: 700,
                    }}
                  >
                    🔥{r.streak}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Hạng 4+ */}
          {board.slice(3).map((r) => (
            <div
              key={r.rank}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 0',
                borderTop: '1px solid var(--color-border-subtle)',
              }}
            >
              <Text variant="body-sm">
                #{r.rank} {r.nickname}
              </Text>
              <Text variant="caption" tone="tertiary">
                🔥{r.streak} · 🌳{r.treesPlanted}
              </Text>
            </div>
          ))}
        </>
      ) : (
        <Text variant="body-sm" tone="tertiary" as="div">
          Chưa có dữ liệu xếp hạng.
        </Text>
      )}
    </GameCard>
  );
}
