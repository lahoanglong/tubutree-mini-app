'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { HelpCircle, Hash, PartyPopper, Plus, Search, Trophy, X, type LucideIcon } from 'lucide-react';
import type { FeedPreviewItem, FeedSort } from '@tubutree/app-core/api/feed';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { feedCategoriesQuery, feedListQuery, feedPublicPreviewQuery } from '@tubutree/app-core/queries/feed';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { CommunityChannels } from '@/components/community/community-channels';
import { PostCard } from '@/components/community/post-card';
import { PostComposer } from '@/components/community/post-composer';
import { PublicPreviewList } from '@/components/community/public-preview-list';
import { useDebounced } from '@/components/community/use-debounced';
import { LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { isWebRouteReady } from '@/lib/route-map';
import { FeedShell } from './feed-shell';

const SORTS: { key: FeedSort; label: string }[] = [
  { key: 'new', label: 'Mới nhất' },
  { key: 'popular', label: 'Nổi bật' },
];

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function Chip({ selected, onClick, icon: Icon, label, children, pressed = true }: { selected: boolean; onClick: () => void; icon?: LucideIcon; label?: string; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed ? selected : undefined}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${
        selected ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50'
      }`}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

function ListSkeleton({ count, height, testId }: { count: number; height: number; testId?: string }) {
  return (
    <div data-testid={testId} className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} rounded="rounded-card" />
      ))}
    </div>
  );
}

/**
 * Bảng tin cộng đồng (cùng nội dung với `feed.tsx` của Mini App). Khách thấy bản xem trước công khai khi cờ
 * community.public_preview bật (server nạp sẵn vào HTML, lỗi thì trình duyệt tự tải); đã đăng nhập thì tải bảng tin ở trình duyệt.
 */
export function FeedView({ initialPreview, initialConfig }: { initialPreview?: FeedPreviewItem[]; initialConfig?: PublicConfig }) {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const router = useRouter();
  const params = useSearchParams();
  const urlTag = params.get('tag') ?? undefined;
  const urlTagName = params.get('tagName') ?? undefined;

  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<FeedSort>('new');
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [unanswered, setUnanswered] = useState(false);
  const [tag, setTag] = useState<string | undefined>(urlTag);
  const [tagName, setTagName] = useState<string | undefined>(urlTagName);
  const dq = useDebounced(q, 300);

  // Bấm hashtag ở thẻ bài đổi URL khi trang đã mở: đồng bộ lại bộ lọc theo URL.
  useEffect(() => {
    setTag(urlTag);
    setTagName(urlTagName);
  }, [urlTag, urlTagName]);

  const config = useQuery({ ...publicConfigQuery(coreHttp), ...(initialConfig ? { initialData: initialConfig } : {}), staleTime: 60_000 });
  const cats = useQuery({ ...feedCategoriesQuery(coreHttp), enabled: authed, staleTime: 60_000 });
  const feed = useInfiniteQuery({
    ...feedListQuery(coreHttp, { category, sort, dq, unanswered, tag }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const previewOn = phase === 'guest' && config.data?.communityPublicPreview === true;
  const preview = useQuery({
    ...feedPublicPreviewQuery(coreHttp),
    ...(initialPreview ? { initialData: { posts: initialPreview } } : {}),
    enabled: previewOn,
    // Nội dung người dùng tự viết, API cache 60 giây: bộ nhớ đệm trình duyệt không giữ lâu hơn để bài đã gỡ biến mất nhanh.
    staleTime: 30_000,
    retry: false,
  });
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const filtering = Boolean(dq || unanswered || tag);

  if (phase === 'loading') {
    return (
      <FeedShell>
        <ListSkeleton count={3} height={140} />
      </FeedShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <FeedShell>
        <SessionUnavailable />
      </FeedShell>
    );
  }

  if (!authed) {
    const settling = config.isPending || (previewOn && preview.isPending && preview.fetchStatus !== 'idle');
    if (settling) {
      return (
        <FeedShell>
          <ListSkeleton count={3} height={140} testId="feed-preview-loading" />
        </FeedShell>
      );
    }
    // Xem trước lỗi hoặc chưa có bài nào thì về cổng đăng nhập: khách chưa đăng nhập không cần thấy lỗi của phần phụ này.
    if (previewOn && preview.data && preview.data.posts.length > 0) {
      return (
        <FeedShell subtitle>
          <CommunityChannels {...(initialConfig ? { initialConfig } : {})} />
          <PublicPreviewList posts={preview.data.posts} />
        </FeedShell>
      );
    }
    return (
      <FeedShell>
        <CommunityChannels {...(initialConfig ? { initialConfig } : {})} />
        <LoginRequired message="Đăng nhập để xem cộng đồng" returnTo="/cong-dong" />
      </FeedShell>
    );
  }

  const openComposer = () => {
    setNotice(null);
    setComposing(true);
  };
  const iconLink = 'inline-flex h-11 w-11 items-center justify-center rounded-control bg-stone-100 text-stone-800 hover:bg-stone-200';

  return (
    <FeedShell subtitle>
      <CommunityChannels {...(initialConfig ? { initialConfig } : {})} />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isWebRouteReady('/cong-dong/xep-hang') && (
            <Link href="/cong-dong/xep-hang" aria-label="Bảng xếp hạng" className={iconLink}>
              <Trophy className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}
          {isWebRouteReady('/cong-dong/su-kien') && (
            <Link href="/cong-dong/su-kien" aria-label="Sự kiện" className={iconLink}>
              <PartyPopper className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}
        </div>
        <button type="button" onClick={openComposer} className={ui.btnPrimary}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Đăng bài
        </button>
      </div>

      {notice && (
        <p role="status" className="rounded-control bg-forest-50 px-3 py-2 text-sm text-forest-800">
          {notice}
        </p>
      )}

      <form role="search" aria-label="Tìm kiếm" onSubmit={(e) => e.preventDefault()} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
        <input
          type="search"
          aria-label="Tìm kiếm"
          placeholder="Tìm câu hỏi, mẹo, bài viết…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${ui.field} pl-9 pr-11`}
        />
        {q && (
          <button type="button" aria-label="Xoá từ khoá" onClick={() => setQ('')} className="absolute right-0 top-0 inline-flex h-11 min-h-11 w-11 items-center justify-center text-stone-700">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>

      <div role="group" aria-label="Chọn danh mục" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        <Chip selected={!category} onClick={() => setCategory(undefined)}>
          Tất cả
        </Chip>
        {cats.data?.map((c) => (
          <Chip key={c.id} selected={category === c.slug} onClick={() => setCategory(c.slug)}>
            {`${c.icon ?? ''} ${c.name}`.trim()}
          </Chip>
        ))}
      </div>

      <div role="group" aria-label="Sắp xếp" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {SORTS.map((s) => (
          <Chip key={s.key} selected={sort === s.key} onClick={() => setSort(s.key)}>
            {s.label}
          </Chip>
        ))}
        <Chip icon={HelpCircle} selected={unanswered} onClick={() => setUnanswered((v) => !v)}>
          Chưa trả lời
        </Chip>
      </div>

      {tag && (
        <div>
          <Chip
            selected
            pressed={false}
            icon={Hash}
            label="Bỏ lọc thẻ"
            onClick={() => {
              setTag(undefined);
              setTagName(undefined);
              router.replace('/cong-dong');
            }}
          >
            {tagName ?? tag}
            <X className="h-4 w-4" aria-hidden="true" />
          </Chip>
        </div>
      )}

      {feed.isLoading ? (
        <ListSkeleton count={4} height={110} />
      ) : feed.isError ? (
        <ErrorState message={errorText(feed.error)} onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        filtering ? (
          <p className="py-10 text-center text-stone-700">Không tìm thấy bài phù hợp</p>
        ) : (
          <section aria-label="Chưa có bài viết nào" className="rounded-card border border-stone-200 bg-stone-0 p-8 text-center shadow-card">
            <h2 className="font-display text-base font-semibold text-stone-900">Chưa có bài viết nào</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!</p>
            <button type="button" onClick={openComposer} className={`${ui.btnPrimary} mt-4`}>
              Đăng bài đầu tiên
            </button>
          </section>
        )
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          {feed.hasNextPage && (
            <div className="flex justify-center pt-2">
              <button type="button" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} className={`${ui.btnSecondary} min-w-40`}>
                {feed.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
              </button>
            </div>
          )}
        </>
      )}

      <PostComposer
        open={composing}
        onClose={() => setComposing(false)}
        categories={cats.data ?? []}
        onPosted={(message) => {
          setComposing(false);
          setNotice(message);
          void feed.refetch();
        }}
      />
    </FeedShell>
  );
}
