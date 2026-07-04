import { useState } from 'react';
import { Box, Page, Text, Button, Spinner, useNavigate } from 'zmp-ui';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getFeed, getCategories, type FeedSort } from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { PullToRefresh } from '../components/pull-to-refresh';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';
import { haptic } from '../utils/haptic';

const SORTS: { key: FeedSort; label: string }[] = [
  { key: 'new', label: vi.community.sortNew },
  { key: 'popular', label: vi.community.sortPopular },
];

export default function FeedPage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';
  const navigate = useNavigate();
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<FeedSort>('new');
  const [composing, setComposing] = useState(false);

  const cats = useQuery({ queryKey: ['community', 'categories'], queryFn: getCategories, enabled: authed, staleTime: 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ['community', category, sort],
    queryFn: ({ pageParam }) => getFeed({ category, sort, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

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
            color: '#fff',
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

      <Box px={3} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 10, paddingBottom: 8, background: 'var(--neutral-0)' }}>
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
      </Box>

      {feed.isLoading ? (
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      ) : feed.isError ? (
        <ErrorState message={getErrorMessage(feed.error)} onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState art="leaf" heading={vi.community.emptyHeading} body={vi.community.emptyBody} />
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

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
