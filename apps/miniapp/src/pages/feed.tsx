import { useEffect, useMemo, useState } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Plus, HelpCircle, Hash, Trophy, PartyPopper, X } from 'lucide-react';
import { getFeed, getCategories, type FeedSort } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { vi } from '../i18n/vi';
import { PullToRefresh } from '../components/pull-to-refresh';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Chip } from '../components/ui/chip';
import { Icon } from '../components/ui/icon';
import { IconButton } from '../components/ui/icon-button';
import { PageHeader } from '../components/ui/page-header';
import { ScrollRow } from '../components/ui/scroll-row';
import { SearchField } from '../components/ui/search-field';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';
import { haptic } from '../utils/haptic';
import { useDebounced } from '../utils/use-debounced';

const SORTS: { key: FeedSort; label: string }[] = [
  { key: 'new', label: vi.community.sortNew },
  { key: 'popular', label: vi.community.sortPopular },
];

export default function FeedPage() {
  const phase = useAuthPhase();
  const login = useAuthStore((s) => s.login);
  const authed = phase === 'authenticated';
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
  if (phase === 'loading') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={140} radius="var(--radius-card)" />
          ))}
        </div>
      </Page>
    );
  }


  // Mất kết nối lúc khôi phục phiên: không phải khách — nói đúng vậy + Thử lại, không mời đăng nhập lại.
  if (phase === 'unavailable') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <SessionUnavailable />
      </Page>
    );
  }

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated).
  if (!authed) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <EmptyState art="sprout" heading={vi.community.loginToView} ctaLabel={vi.auth.loginCta} onCta={() => void login()} />
      </Page>
    );
  }

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 80 }}>
      <PullToRefresh onRefresh={() => feed.refetch()} />

      <PageHeader title={vi.community.title} subtitle={vi.community.subtitle} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 12px 8px',
          background: 'var(--color-bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconButton
            icon={Trophy}
            label={vi.community.leaderboard}
            style={{ background: 'var(--color-bg-subtle)' }}
            onPress={() => {
              haptic('light');
              navigate('/feed/leaderboard');
            }}
          />
          <IconButton
            icon={PartyPopper}
            label={vi.community.events}
            style={{ background: 'var(--color-bg-subtle)' }}
            onPress={() => {
              haptic('light');
              navigate('/feed/events');
            }}
          />
        </div>
        <Button
          icon={Plus}
          onPress={() => {
            haptic('light');
            setComposing(true);
          }}
        >
          {vi.community.compose}
        </Button>
      </div>

      <div style={{ padding: '0 12px 8px', background: 'var(--color-bg-surface)' }}>
        <SearchField
          value={q}
          onChange={setQ}
          onSubmit={setQ}
          label={vi.community.search}
          clearLabel={vi.browse.clearSearch}
          placeholder={vi.community.searchPlaceholder}
        />
      </div>

      <ScrollRow
        label={vi.community.pickCategory}
        style={{ display: 'flex', gap: 8, padding: '4px 12px', background: 'var(--color-bg-surface)', minWidth: 0, maxWidth: '100%' }}
      >
        <Chip selected={!category} onPress={() => setCategory(undefined)}>
          {vi.community.tabAll}
        </Chip>
        {cats.data?.map((c) => (
          <Chip key={c.id} selected={category === c.slug} onPress={() => setCategory(c.slug)}>
            {`${c.icon ?? ''} ${c.name}`.trim()}
          </Chip>
        ))}
      </ScrollRow>

      <ScrollRow
        label={vi.browse.sortGroup}
        style={{ display: 'flex', gap: 8, padding: '4px 12px 6px', background: 'var(--color-bg-surface)', minWidth: 0, maxWidth: '100%' }}
      >
        {SORTS.map((s) => (
          <Chip key={s.key} selected={sort === s.key} onPress={() => setSort(s.key)}>
            {s.label}
          </Chip>
        ))}
        <Chip
          icon={HelpCircle}
          selected={unanswered}
          onPress={() => {
            haptic('light');
            setUnanswered((v) => !v);
          }}
        >
          {vi.community.unanswered}
        </Chip>
      </ScrollRow>

      {tag && (
        <div style={{ padding: '0 12px 8px', background: 'var(--color-bg-surface)' }}>
          <Chip
            selected
            size="sm"
            icon={Hash}
            ariaLabel={vi.community.clearTag}
            onPress={() => {
              haptic('light');
              setTag(undefined);
              setTagName(undefined);
              navigate('/feed', { replace: true });
            }}
          >
            {tagName ?? tag}
            <Icon icon={X} size="sm" tone="inverse" />
          </Chip>
        </div>
      )}

      {feed.isLoading ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={110} radius="var(--radius-card)" />
          ))}
        </div>
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
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
              <Button
                variant="secondary"
                loading={feed.isFetchingNextPage}
                onPress={() => feed.fetchNextPage()}
                style={{ minWidth: 160 }}
              >
                {vi.community.loadMore}
              </Button>
            </div>
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
