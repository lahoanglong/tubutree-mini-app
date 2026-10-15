import { useState } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import { ChevronLeft, Gift } from 'lucide-react';
import { listEvents, eventPosts, getCategories, type CommunityEvent, type FeedPage } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { vi } from '../i18n/vi';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Heading, Text } from '../components/ui/text';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';
import { formatDate, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';

/** Sự kiện đã qua endAt → không nhận bài dự thi nữa. */
function isEventEnded(event: Pick<CommunityEvent, 'endAt'>): boolean {
  return new Date(event.endAt).getTime() < Date.now();
}

const PAGE_BG = { background: 'var(--color-bg-canvas)' } as const;

function CardSkeletons({ height, gap }: { height: number; gap: number }) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} height={height} radius="var(--radius-card)" />
      ))}
    </div>
  );
}

/** Hạn kết thúc + thưởng + nhãn đã kết thúc, dùng chung cho thẻ danh sách và trang chi tiết. */
function EventMeta({ event, rewardPrefix }: { event: CommunityEvent; rewardPrefix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
      <Text variant="caption" tone="tertiary">
        {vi.community.eventEnds}: {formatDate(event.endAt)}
      </Text>
      {event.rewardPoints > 0 && (
        <Text variant="caption" tone="brand" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {rewardPrefix}
          <Icon icon={Gift} size="sm" tone="brand" />
          {formatPoints(event.rewardPoints)}
        </Text>
      )}
      {isEventEnded(event) && (
        <Badge tone="neutral" size="sm">
          {vi.community.eventEnded}
        </Badge>
      )}
    </div>
  );
}

export default function CommunityEventsPage() {
  const phase = useAuthPhase();
  const login = useAuthStore((s) => s.login);
  const authed = phase === 'authenticated';
  const [selected, setSelected] = useState<CommunityEvent | null>(null);
  const [composing, setComposing] = useState(false);

  const cats = useQuery({ queryKey: ['community', 'categories'], queryFn: getCategories, enabled: authed, staleTime: 60_000 });
  const eventsQ = useQuery({ queryKey: ['community', 'events'], queryFn: listEvents, enabled: authed });
  const entriesQ = useInfiniteQuery({
    queryKey: ['community', 'event-posts', selected?.id],
    queryFn: ({ pageParam }) => eventPosts(selected!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed && Boolean(selected),
  });

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (phase === 'loading') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.events} />
        <CardSkeletons height={140} gap={12} />
      </Page>
    );
  }


  // Mất kết nối lúc khôi phục phiên: không phải khách — nói đúng vậy + Thử lại, không mời đăng nhập lại.
  if (phase === 'unavailable') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.events} />
        <SessionUnavailable />
      </Page>
    );
  }

  if (!authed) {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.events} />
        <EmptyState art="sprout" heading={vi.community.loginToView} ctaLabel={vi.auth.loginCta} onCta={() => void login()} />
      </Page>
    );
  }

  return (
    <Page style={{ ...PAGE_BG, paddingBottom: 40 }}>
      <PageHeader title={vi.community.events} />

      {selected ? (
        <EventEntries
          event={selected}
          entriesQ={entriesQ}
          onBack={() => setSelected(null)}
          onJoin={() => {
            haptic('light');
            setComposing(true);
          }}
        />
      ) : (
        <EventsList eventsQ={eventsQ} onSelect={setSelected} />
      )}

      <PostComposer
        visible={composing}
        onClose={() => setComposing(false)}
        categories={cats.data ?? []}
        eventId={selected?.id}
        eventTitle={selected?.title}
        onPosted={() => {
          setComposing(false);
          void entriesQ.refetch();
        }}
      />
    </Page>
  );
}

function EventsList({
  eventsQ,
  onSelect,
}: {
  eventsQ: UseQueryResult<CommunityEvent[]>;
  onSelect: (event: CommunityEvent) => void;
}) {
  if (eventsQ.isLoading) {
    return <CardSkeletons height={140} gap={12} />;
  }
  if (eventsQ.isError) {
    return <ErrorState message={getErrorMessage(eventsQ.error)} onRetry={() => void eventsQ.refetch()} />;
  }
  if (!eventsQ.data || eventsQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noEvents} />;
  }
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {eventsQ.data.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          onClick={() => {
            haptic('light');
            onSelect(event);
          }}
        />
      ))}
    </div>
  );
}

function EventCard({ event, onClick }: { event: CommunityEvent; onClick: () => void }) {
  return (
    <div
      role="button"
      {...rowKeyboardProps()}
      onClick={onClick}
      className="tubu-press"
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {event.coverUrl && (
        <img
          src={event.coverUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }}
        />
      )}
      <div style={{ padding: 12 }}>
        <Text variant="body-lg" as="div" style={{ fontWeight: 600 }}>
          {event.title}
        </Text>
        {event.description && (
          <Text
            variant="body-sm"
            tone="secondary"
            as="div"
            style={{
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {event.description}
          </Text>
        )}
        <EventMeta event={event} />
      </div>
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
  const navigate = useNavigate();
  const ended = isEventEnded(event);
  const entries = entriesQ.data?.pages.flatMap((pg) => pg.posts) ?? [];
  return (
    <div>
      <div style={{ padding: '12px 12px 0' }}>
        <Button
          variant="ghost"
          icon={ChevronLeft}
          onPress={() => {
            haptic('light');
            onBack();
          }}
        >
          {vi.community.events}
        </Button>

        <div
          style={{
            marginTop: 12,
            background: 'var(--color-bg-surface)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--elevation-1)',
            overflow: 'hidden',
          }}
        >
          {event.coverUrl && (
            <img
              src={event.coverUrl}
              alt=""
              loading="lazy"
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
            />
          )}
          <div style={{ padding: 12 }}>
            <Heading variant="title-md">{event.title}</Heading>
            {event.description && (
              <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 6 }}>
                {event.description}
              </Text>
            )}
            <EventMeta event={event} rewardPrefix={`${vi.community.eventReward}: `} />
            <Button fullWidth disabled={ended} onPress={onJoin} style={{ marginTop: 14 }}>
              {vi.community.joinEvent}
            </Button>
          </div>
        </div>

        <Heading variant="title-sm" as="h2" style={{ marginTop: 16, marginBottom: 4 }}>
          {vi.community.eventEntries}
        </Heading>
      </div>

      {entriesQ.isLoading ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={100} radius="var(--radius-card)" />
          ))}
        </div>
      ) : entriesQ.isError ? (
        <ErrorState message={getErrorMessage(entriesQ.error)} onRetry={() => void entriesQ.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState art="leaf" heading={vi.community.emptyHeading} body={vi.community.emptyBody} />
      ) : (
        <>
          {entries.map((post) => (
            <PostCard key={post.id} post={post} onClick={() => navigate(`/feed/${post.id}`)} />
          ))}
          {entriesQ.hasNextPage && (
            <div style={{ padding: 12 }}>
              <Button fullWidth variant="secondary" loading={entriesQ.isFetchingNextPage} onPress={() => entriesQ.fetchNextPage()}>
                Xem thêm bài dự thi
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
