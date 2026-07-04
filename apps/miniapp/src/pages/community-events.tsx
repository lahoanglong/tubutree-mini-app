import { useState } from 'react';
import { Box, Page, Text, Button, Spinner, useNavigate } from 'zmp-ui';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { PartyPopper, ChevronLeft } from 'lucide-react';
import { listEvents, eventPosts, getCategories, type CommunityEvent, type FeedItem } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';
import { haptic } from '../utils/haptic';

/** "10/07/2026" — đủ dùng cho hạn sự kiện, không cần giờ phút. */
function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Sự kiện đã qua endAt → không nhận bài dự thi nữa. */
function isEventEnded(event: Pick<CommunityEvent, 'endAt'>): boolean {
  return new Date(event.endAt).getTime() < Date.now();
}

export default function CommunityEventsPage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';
  const [selected, setSelected] = useState<CommunityEvent | null>(null);
  const [composing, setComposing] = useState(false);

  const cats = useQuery({ queryKey: ['community', 'categories'], queryFn: getCategories, enabled: authed, staleTime: 60_000 });
  const eventsQ = useQuery({ queryKey: ['community', 'events'], queryFn: listEvents, enabled: authed });
  const entriesQ = useQuery({
    queryKey: ['community', 'event-posts', selected?.id],
    queryFn: () => eventPosts(selected!.id),
    enabled: authed && Boolean(selected),
  });

  // Đang silent-login lúc mở app (restore chưa xong) → spinner thay vì chớp cổng đăng nhập.
  if (status === 'loading') {
    return (
      <Page className="page">
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (!authed) {
    return (
      <Page className="page">
        <Box style={{ textAlign: 'center', padding: 48 }}>
          <Text style={{ fontSize: 48 }}>🎉</Text>
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
        <PartyPopper size={20} color="var(--leaf-700)" />
        <Text.Title size="small">{vi.community.events}</Text.Title>
      </Box>

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
    return (
      <Box p={3} flex flexDirection="column" style={{ gap: 12 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} height={140} radius="var(--radius-lg)" />
        ))}
      </Box>
    );
  }
  if (eventsQ.isError) {
    return <ErrorState message={getErrorMessage(eventsQ.error)} onRetry={() => void eventsQ.refetch()} />;
  }
  if (!eventsQ.data || eventsQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noEvents} />;
  }
  return (
    <Box p={3} flex flexDirection="column" style={{ gap: 12 }}>
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
    </Box>
  );
}

function EventCard({ event, onClick }: { event: CommunityEvent; onClick: () => void }) {
  const ended = isEventEnded(event);
  return (
    <Box
      onClick={onClick}
      className="tubu-press"
      style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer' }}
    >
      {event.coverUrl && (
        <img
          src={event.coverUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }}
        />
      )}
      <Box p={3}>
        <Text bold>{event.title}</Text>
        {event.description && (
          <Text
            size="small"
            style={{
              marginTop: 4,
              color: 'var(--neutral-600)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {event.description}
          </Text>
        )}
        <Box flex alignItems="center" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {vi.community.eventEnds}: {formatEventDate(event.endAt)}
          </Text>
          {event.rewardXu > 0 && (
            <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
              🎁 {event.rewardXu} TubuXu
            </Text>
          )}
          {ended && (
            <Text
              size="xSmall"
              bold
              style={{ color: 'var(--neutral-500)', background: 'var(--neutral-100)', borderRadius: 'var(--radius-full)', padding: '2px 8px' }}
            >
              {vi.community.eventEnded}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function EventEntries({
  event,
  entriesQ,
  onBack,
  onJoin,
}: {
  event: CommunityEvent;
  entriesQ: UseQueryResult<FeedItem[]>;
  onBack: () => void;
  onJoin: () => void;
}) {
  const navigate = useNavigate();
  const ended = isEventEnded(event);
  return (
    <Box>
      <Box px={3} pt={3}>
        <Box
          role="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            onBack();
          }}
          flex
          alignItems="center"
          style={{ gap: 4, color: 'var(--leaf-700)' }}
        >
          <ChevronLeft size={16} />
          <Text size="small">{vi.community.events}</Text>
        </Box>

        <Box mt={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {event.coverUrl && (
            <img
              src={event.coverUrl}
              alt=""
              loading="lazy"
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
            />
          )}
          <Box p={3}>
            <Text bold size="large">
              {event.title}
            </Text>
            {event.description && (
              <Text size="small" style={{ marginTop: 6, color: 'var(--neutral-600)' }}>
                {event.description}
              </Text>
            )}
            <Box flex alignItems="center" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {vi.community.eventEnds}: {formatEventDate(event.endAt)}
              </Text>
              {event.rewardXu > 0 && (
                <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>
                  {vi.community.eventReward}: 🎁 {event.rewardXu} TubuXu
                </Text>
              )}
              {ended && (
                <Text
                  size="xSmall"
                  bold
                  style={{ color: 'var(--neutral-500)', background: 'var(--neutral-100)', borderRadius: 'var(--radius-full)', padding: '2px 8px' }}
                >
                  {vi.community.eventEnded}
                </Text>
              )}
            </Box>
            <Button fullWidth disabled={ended} style={{ marginTop: 14, background: 'var(--leaf-600)' }} onClick={onJoin}>
              {vi.community.joinEvent}
            </Button>
          </Box>
        </Box>

        <Text bold size="small" style={{ marginTop: 16, marginBottom: 4 }}>
          {vi.community.eventEntries}
        </Text>
      </Box>

      {entriesQ.isLoading ? (
        <Box p={3} flex flexDirection="column" style={{ gap: 8 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={100} radius="var(--radius-md)" />
          ))}
        </Box>
      ) : entriesQ.isError ? (
        <ErrorState message={getErrorMessage(entriesQ.error)} onRetry={() => void entriesQ.refetch()} />
      ) : !entriesQ.data || entriesQ.data.length === 0 ? (
        <EmptyState art="leaf" heading={vi.community.emptyHeading} body={vi.community.emptyBody} />
      ) : (
        entriesQ.data.map((post) => (
          <PostCard key={post.id} post={post} onClick={() => navigate(`/feed/${post.id}`)} />
        ))
      )}
    </Box>
  );
}
