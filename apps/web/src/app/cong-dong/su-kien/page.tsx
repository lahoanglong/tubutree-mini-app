'use client';

import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult, type UseQueryResult } from '@tanstack/react-query';
import { ChevronLeft, Gift } from 'lucide-react';
import type { CommunityEvent, FeedPage } from '@tubutree/app-core/api/feed';
import { communityEventsQuery, eventPostsQuery, feedCategoriesQuery } from '@tubutree/app-core/queries/feed';
import { PostCard } from '@/components/community/post-card';
import { PostComposer } from '@/components/community/post-composer';
import { safeMediaUrl } from '@/components/community/post-parts';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { miniBtnSecondary, miniCard } from '@/components/loyalty/mini-surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatCount } from '@/lib/checkout-points';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

const errorText = loadErrorText;
const formatPoints = (n: number) => `${formatCount(n)} điểm`;

/** Sự kiện đã qua endAt thì không nhận bài dự thi nữa. */
const isEventEnded = (event: Pick<CommunityEvent, 'endAt'>) => new Date(event.endAt).getTime() < Date.now();

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <PageHeader title="Sự kiện" backHref="/cong-dong" backLabel="Quay lại cộng đồng" />
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </main>
  );
}

function CardSkeletons({ height, columns = true }: { height: number; columns?: boolean }) {
  return (
    <div className={`grid gap-3 ${columns ? 'md:grid-cols-2' : ''}`} aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} height={height} rounded="rounded-card" />
      ))}
    </div>
  );
}

function EmptyCard({ heading, body }: { heading: string; body?: string }) {
  return (
    <section className={`${ui.card} p-8 text-center`}>
      <h2 className="font-display text-base font-semibold text-stone-900">{heading}</h2>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{body}</p>}
    </section>
  );
}

/** Hạn kết thúc + thưởng + nhãn đã kết thúc, dùng chung cho thẻ danh sách và trang chi tiết. */
function EventMeta({ event, rewardPrefix }: { event: CommunityEvent; rewardPrefix?: string }) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      <span className="text-stone-600">Kết thúc: {formatDate(event.endAt)}</span>
      {event.rewardPoints > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-forest-700">
          {rewardPrefix}
          <Gift className="h-3.5 w-3.5" aria-hidden="true" />
          {formatPoints(event.rewardPoints)}
        </span>
      )}
      {isEventEnded(event) && <span className="rounded-full bg-stone-100 px-2 py-0.5 font-semibold text-stone-700">Đã kết thúc</span>}
    </span>
  );
}

function Cover({ url }: { url: string | null }) {
  const src = safeMediaUrl(url);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className="block max-h-44 w-full object-cover" /> : null;
}

function EventsList({ eventsQ, onSelect }: { eventsQ: UseQueryResult<CommunityEvent[]>; onSelect: (e: CommunityEvent) => void }) {
  if (eventsQ.isLoading) return <CardSkeletons height={140} />;
  if (eventsQ.isError && !eventsQ.data) return <ErrorState message={errorText(eventsQ.error)} onRetry={() => void eventsQ.refetch()} />;
  if (!eventsQ.data || eventsQ.data.length === 0) return <EmptyCard heading="Chưa có sự kiện nào" />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {eventsQ.data.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onSelect(event)}
          className={`${miniCard} block min-h-11 w-full overflow-hidden text-left transition active:scale-[0.99]`}
        >
          <Cover url={event.coverUrl} />
          <span className="block p-3">
            <span className="block text-base font-semibold text-stone-900">{event.title}</span>
            {event.description && (
              <span className="mt-1 block text-sm text-stone-700" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {event.description}
              </span>
            )}
            <EventMeta event={event} />
          </span>
        </button>
      ))}
    </div>
  );
}

function EventEntries({
  event,
  entriesQ,
  onBack,
  onJoin,
}: {
  event: CommunityEvent;
  entriesQ: UseInfiniteQueryResult<InfiniteData<FeedPage>>;
  onBack: () => void;
  onJoin: () => void;
}) {
  const ended = isEventEnded(event);
  const entries = entriesQ.data?.pages.flatMap((pg) => pg.posts) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" onClick={onBack} className={ui.backLink}>
          <ChevronLeft className="mr-0.5 h-4 w-4" aria-hidden="true" />
          Sự kiện
        </button>
      </div>
      <div className={`${miniCard} overflow-hidden`}>
        <Cover url={event.coverUrl} />
        <div className="p-3">
          <h2 className="font-display text-lg font-semibold text-stone-900">{event.title}</h2>
          {event.description && <p className="mt-1.5 whitespace-pre-wrap text-sm text-stone-700">{event.description}</p>}
          <EventMeta event={event} rewardPrefix="Thưởng: " />
          <button type="button" disabled={ended} onClick={onJoin} className={`${ui.btnPrimary} mt-3.5 w-full md:w-auto`}>
            Đăng bài dự thi
          </button>
        </div>
      </div>

      <h2 className="mt-1 font-display text-lg font-semibold text-stone-900">Bài dự thi</h2>
      {entriesQ.isLoading ? (
        <CardSkeletons height={100} />
      ) : entriesQ.isError ? (
        <ErrorState message={errorText(entriesQ.error)} onRetry={() => void entriesQ.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyCard heading="Chưa có bài viết nào" body="Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!" />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          {entriesQ.hasNextPage && (
            <div className="flex justify-center pt-1">
              <button type="button" disabled={entriesQ.isFetchingNextPage} onClick={() => void entriesQ.fetchNextPage()} className={`${miniBtnSecondary} min-w-40`}>
                {entriesQ.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm bài dự thi'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Sự kiện cộng đồng (cùng nội dung với `community-events.tsx` của Mini App): chọn sự kiện xem bài dự thi và đăng bài dự thi; API yêu cầu đăng nhập. */
export default function CommunityEventsPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const [selected, setSelected] = useState<CommunityEvent | null>(null);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cats = useQuery({ ...feedCategoriesQuery(coreHttp), enabled: authed, staleTime: 60_000 });
  const eventsQ = useQuery({ ...communityEventsQuery(coreHttp), enabled: authed });
  const entriesQ = useInfiniteQuery({
    ...eventPostsQuery(coreHttp, selected?.id),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed && Boolean(selected),
  });

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
  if (!authed) {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem cộng đồng" returnTo="/cong-dong/su-kien" />
      </Shell>
    );
  }

  return (
    <Shell>
      {notice && (
        <p role="status" className="rounded-control bg-forest-50 px-3 py-2 text-sm text-forest-800">
          {notice}
        </p>
      )}
      {selected ? (
        <EventEntries
          event={selected}
          entriesQ={entriesQ}
          onBack={() => {
            setNotice(null);
            setSelected(null);
          }}
          onJoin={() => {
            setNotice(null);
            setComposing(true);
          }}
        />
      ) : (
        <EventsList eventsQ={eventsQ} onSelect={setSelected} />
      )}
      <PostComposer
        key={selected?.id ?? 'none'}
        open={composing}
        onClose={() => setComposing(false)}
        categories={cats.data ?? []}
        eventId={selected?.id}
        eventTitle={selected?.title}
        onPosted={(message) => {
          setComposing(false);
          setNotice(message);
          void entriesQ.refetch();
        }}
      />
    </Shell>
  );
}
