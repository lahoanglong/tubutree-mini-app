import { Trophy } from 'lucide-react';
import type { LeaderRow } from '@tubutree/app-core/api/game';
import { GameCard } from './game-card';

// API xếp theo chuỗi điểm danh dài nhất mọi thời gian (không reset theo tuần), nên nhãn và số trên bục là chuỗi ngày.
// Huy chương, 🌳 (cây đã trồng) và 🔥 (chuỗi ngày) là số liệu xếp hạng của game.
export function WeeklyLeaderboard({ board }: { board: LeaderRow[] | undefined }) {
  return (
    <GameCard title="Chuỗi điểm danh dài nhất" icon={Trophy}>
      {board && board.length > 0 ? (
        <>
          {/* Bục top 3. Khoá theo vị trí ô: khoá theo hạng va với khoá ô trống khi chỉ có 2 người (hạng 2 đứng ở ô 0). */}
          <div data-podium className="mb-3 flex items-end justify-center gap-2">
            {[board[1], board[0], board[2]].map((r, idx) => {
              if (!r) return <div key={idx} data-slot className="flex-1" />;
              const isFirst = r.rank === 1;
              const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
              const height = isFirst ? 'h-16' : r.rank === 2 ? 'h-12' : 'h-10';
              return (
                <div key={idx} data-slot className="min-w-0 flex-1 text-center">
                  <div className={`leading-tight ${isFirst ? 'text-3xl' : 'text-2xl'}`}>{medal}</div>
                  <div className="truncate text-xs font-semibold text-stone-900">{r.nickname}</div>
                  <div
                    className={`mt-1 flex items-center justify-center rounded-t-control text-xs font-bold text-stone-0 ${height} ${isFirst ? 'bg-forest-700' : 'bg-forest-600'}`}
                  >
                    🔥{r.streak}
                  </div>
                </div>
              );
            })}
          </div>
          {board.slice(3).map((r) => (
            <div key={r.rank} className="flex justify-between gap-2 border-t border-stone-200 py-1.5">
              <span className="min-w-0 truncate text-sm text-stone-900">
                #{r.rank} {r.nickname}
              </span>
              <span className="flex-none text-xs text-stone-600">
                🔥{r.streak} · 🌳{r.treesPlanted}
              </span>
            </div>
          ))}
        </>
      ) : (
        <p className="text-sm text-stone-600">Chưa có dữ liệu xếp hạng.</p>
      )}
    </GameCard>
  );
}
