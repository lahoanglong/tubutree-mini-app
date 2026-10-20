'use client';

import type { ReactNode } from 'react';
import { Medal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { communityLeaderboardQuery } from '@tubutree/app-core/queries/feed';
import type { LeaderboardEntry } from '@tubutree/app-core/api/feed';
import { Avatar } from '@/components/community/post-parts';
import { levelEmoji } from '@/components/community/rank';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { MiniBar, miniCard } from '@/components/loyalty/mini-surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';

const MEDAL: Record<number, { label: string; color: string }> = {
  1: { label: 'Huy chương vàng', color: 'var(--honey-500)' },
  2: { label: 'Huy chương bạc', color: 'var(--stone-450)' },
  3: { label: 'Huy chương đồng', color: 'var(--clay-600)' },
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function Shell({ children }: { children: ReactNode }) {
  return (
    <main data-page-bleed className="mx-auto max-w-3xl px-4 py-6 max-md:pt-0">
      <MiniBar>
        <PageHeader title="Bảng xếp hạng" backHref="/cong-dong" backLabel="Quay lại cộng đồng" />
      </MiniBar>
      <div className="mt-4">{children}</div>
    </main>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} height={56} rounded="rounded-card" />
      ))}
    </div>
  );
}

function LeaderRow({ rank, entry }: { rank: number; entry: LeaderboardEntry }) {
  return (
    <li className={`${miniCard} flex items-center gap-2.5 p-3`}>
      <span className="w-7 text-center text-base font-semibold text-stone-900">
        {MEDAL[rank] ? <Medal size={22} strokeWidth={1.75} role="img" aria-label={MEDAL[rank].label} color={MEDAL[rank].color} /> : `#${rank}`}
      </span>
      <Avatar src={entry.avatar} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-stone-900">{entry.author}</div>
        <div className="text-xs text-forest-700">
          {levelEmoji(entry.level)} {entry.levelName}
        </div>
      </div>
      <span className="whitespace-nowrap text-sm font-semibold text-forest-700">{entry.reputation} điểm uy tín</span>
    </li>
  );
}

/** Bảng xếp hạng uy tín cộng đồng (cùng nội dung với `community-leaderboard.tsx` của Mini App); API yêu cầu đăng nhập. */
export default function LeaderboardPage() {
  const phase = useAuthPhase();
  const board = useQuery({ ...communityLeaderboardQuery(coreHttp), enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem cộng đồng" returnTo="/cong-dong/xep-hang" />
      </Shell>
    );
  }

  return (
    <Shell>
      {board.isLoading ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <ErrorState message={errorText(board.error)} onRetry={() => void board.refetch()} />
      ) : !board.data || board.data.length === 0 ? (
        <section className="rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
          <h2 className="font-display text-base font-semibold text-stone-900">Chưa có bài viết nào</h2>
        </section>
      ) : (
        <>
          <div className="flex items-center gap-2.5 px-3 pb-1 text-xs text-stone-600" aria-hidden="true">
            <div className="w-7 text-center">Hạng</div>
            <div className="w-9" />
            <div className="flex-1">Thành viên</div>
            <div>điểm uy tín</div>
          </div>
          <ol className="flex flex-col gap-2">
            {board.data.map((entry, i) => (
              <LeaderRow key={`${entry.author}-${i}`} rank={i + 1} entry={entry} />
            ))}
          </ol>
        </>
      )}
    </Shell>
  );
}
