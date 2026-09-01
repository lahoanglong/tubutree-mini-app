import { useEffect, useMemo, useState } from 'react';
import { Box, Page, Text, Button, Input, useLocation, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Plus, HelpCircle, Hash, Trophy, PartyPopper } from 'lucide-react';
import { getFeed, getCategories, type FeedSort } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { PullToRefresh } from '../components/pull-to-refresh';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';
import { haptic } from '../utils/haptic';
import { useDebounced } from '../utils/use-debounced';

const SORTS: { key: FeedSort; label: string }[] = [
  { key: 'new', label: vi.community.sortNew },
  { key: 'popular', label: vi.community.sortPopular },
];

export default function FeedPage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';
  const navigate = useNavigate();
  const location = useLocation();
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<FeedSort>('new');
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState('');
  const [unanswered, setUnanswered] = useState(false);
  const initialTag = useMemo(
    () => new URLSearchParams(location.search).get('tag') ?? undefined,
    [location.search],
  );
  const initialTagName = useMemo(
    () => new URLSearchParams(location.search).get('tagName') ?? undefined,
    [location.search],
  );
  const [tag, setTag] = useState<string | undefined>(initialTag);
  const [tagName, setTagName] = useState<string | undefined>(initialTagName);
  const dq = useDebounced(q, 300);

  // Tag-nav từ post-card (điều hướng /feed?tag=slug&tagName=...) khi trang đã mounted → đồng bộ lại state.
  useEffect(() => {
    setTag(initialTag);
    setTagName(initialTagName);
  }, [initialTag, initialTagName]);

  const cats = useQuery({ queryKey: ['community', 'categories'], queryFn: getCategories, enabled: authed, staleTime: 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ['community', category, sort, dq, unanswered, tag],
    queryFn: ({ pageParam }) =>
      getFeed({
        category,
        sort,
        cursor: pageParam as string | undefined,
        q: dq || undefined,
        unanswered: unanswered || undefined,
        tag,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const filtering = Boolean(dq || unanswered || tag);

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (status === 'loading') {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box p={3} flex flexDirection="column" style={{ gap: 12 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={140} radius="var(--radius-lg)" />
          ))}
        </Box>
      </Page>
    );
  }

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated).
  if (!authed) {
    return (
      <Page className="page">
        <Box style={{ textAlign: 'center', padding: 48 }}>
          <Text style={{ fontSize: 48 }}>🌿</Text>
          <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
          <Button style={{ marginTop: 12, background: 'var(--leaf-600)' }} onClick={() => void login()}>
            {vi.auth.loginCta}
          </Button>
        </Box>
      </Page>
    );
  }

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <PullToRefresh onRefresh={() => feed.refetch()} />

      <Box p={3} flex alignItems="center" justifyContent="space-between" style={{ background: 'var(--neutral-0)' }}>
        <Box>
          <Text bold size="large">{vi.community.title}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{vi.community.subtitle}</Text>
        </Box>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <Box
            role="button"
            aria-label={vi.community.leaderboard}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate('/feed/leaderboard');
            }}
            flex
            alignItems="center"
            justifyContent="center"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--leaf-50)',
              boxSizing: 'border-box',
            }}
          >
            <Trophy size={18} color="var(--leaf-700)" strokeWidth={1.8} />
          </Box>
          <Box
            role="button"
            aria-label={vi.community.events}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              navigate('/feed/events');
            }}
            flex
            alignItems="center"
            justifyContent="center"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--leaf-50)',
              boxSizing: 'border-box',
            }}
          >
            <PartyPopper size={18} color="var(--leaf-700)" strokeWidth={1.8} />
          </Box>
          <Box
            role="button"
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setComposing(true);
            }}
            flex
            alignItems="center"
            style={{
              gap: 4,
              background: 'var(--leaf-600)',
              color: 'var(--neutral-0)',
              borderRadius: 'var(--radius-full)',
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              minHeight: 40,
              boxSizing: 'border-box',
            }}
          >
            <Plus size={16} />
            {vi.community.compose}
          </Box>
        </Box>
      </Box>

      <Box p={3} pt={2} style={{ background: 'var(--neutral-0)' }}>
        <Input.Search
          aria-label={vi.community.search}
          placeholder={vi.community.searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          clearable
        />
      </Box>

      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, background: 'var(--neutral-0)' }}>
        <Chip label={vi.community.tabAll} active={!category} onClick={() => setCategory(undefined)} />
        {cats.data?.map((c) => (
          <Chip
            key={c.id}
            label={`${c.icon ?? ''} ${c.name}`.trim()}
            active={category === c.slug}
            onClick={() => setCategory(c.slug)}
          />
        ))}
      </Box>

      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, background: 'var(--neutral-0)' }}>
        {SORTS.map((s) => (
          <Chip key={s.key} label={s.label} active={sort === s.key} onClick={() => setSort(s.key)} />
        ))}
        <Chip
          label={
            <Box flex alignItems="center" style={{ gap: 4 }}>
              <HelpCircle size={14} />
              {vi.community.unanswered}
            </Box>
          }
          active={unanswered}
          onClick={() => {
            haptic('light');
            setUnanswered((v) => !v);
          }}
        />
      </Box>

      {tag && (
        <Box px={3} pb={2} style={{ background: 'var(--neutral-0)' }}>
          <Box
            role="button"
            aria-label={vi.community.clearTag}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setTag(undefined);
              setTagName(undefined);
              navigate('/feed', { replace: true });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--leaf-600)',
              color: 'var(--neutral-0)',
              borderRadius: 'var(--radius-full)',
              padding: '6px 12px',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <Hash size={12} />
            {tagName ?? tag} ✕
          </Box>
        </Box>
      )}

      {feed.isLoading ? (
        <Box p={3} flex flexDirection="column" style={{ gap: 12 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={110} radius="var(--radius-lg)" />
          ))}
        </Box>
      ) : feed.isError ? (
        <ErrorState message={getErrorMessage(feed.error)} onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        filtering ? (
          <EmptyState art="search" heading={vi.community.noResult} />
        ) : (
          <EmptyState art="leaf" heading={vi.community.emptyHeading} body={vi.community.emptyBody} />
        )
      ) : (
        <>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onClick={() => navigate(`/feed/${post.id}`)} />
          ))}
          {feed.hasNextPage && (
            <Box flex justifyContent="center" pt={4}>
              <Button
                variant="secondary"
                loading={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
                style={{ minWidth: 160 }}
              >
                {vi.community.loadMore}
              </Button>
            </Box>
          )}
        </>
      )}

      <PostComposer
        visible={composing}
        onClose={() => setComposing(false)}
        categories={cats.data ?? []}
        onPosted={() => {
          setComposing(false);
          void feed.refetch();
        }}
      />
    </Page>
  );
}

function Chip({ label, active, onClick }: { label: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <Box
      role="button"
      aria-pressed={active}
      className="tubu-press"
      onClick={onClick}
      style={{
        whiteSpace: 'nowrap',
        padding: '10px 14px',
        borderRadius: 'var(--radius-full)',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--primary-600)' : 'var(--neutral-0)',
        border: `1px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        color: active ? 'white' : 'var(--neutral-600)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        boxSizing: 'border-box',
        flex: '0 0 auto',
      }}
    >
      {label}
    </Box>
  );
}
