'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { getFeed } from '@tubutree/app-core/api/feed';
import { feedPublicPreviewQuery } from '@tubutree/app-core/queries/feed';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { usePublicConfig } from '@/lib/use-public-config';
import { timeAgo } from '@/components/community/post-parts';
import { Card, Icon, ListRow, SectionHeader, Skeleton, Text } from '@/components/mini';

const PREVIEW_COUNT = 2;

// Mỗi dòng cao cố định: tiêu đề tối đa hai dòng (2 x 22) + dòng phụ (2 + 20) + đệm 12 mỗi phía = 90. Khung bao ngoài cao `COMMUNITY_HEIGHT` (tiêu đề khối + hai dòng + viền thẻ + 2px dư)
// dù có bài hay chưa, để bài về muộn không đẩy các thẻ sản phẩm phía dưới trong lưới Gợi ý.
const ROW_HEIGHT = 90;
const COMMUNITY_HEIGHT = `calc(var(--section-header-h) + ${PREVIEW_COUNT * ROW_HEIGHT + 4}px)`;

interface Row {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  commentCount: number;
  openable: boolean;
}

/**
 * Cộng đồng hỏi đáp, một trong hai thẻ chen trong lưới Gợi ý của Trang chủ (bản web của `community-preview.tsx` ở Mini App): hai bài mới nhất. Khách đã đăng nhập mở được bài;
 * khách chưa đăng nhập chỉ thấy phần xem trước công khai khi cờ bật, chỉ có nút "Xem tất cả". Không có bài hay lỗi thì ẩn. Bài còn đang tải thì giữ khung chờ đúng chiều cao `COMMUNITY_HEIGHT`.
 */
export function CommunityPreview() {
  const router = useRouter();
  const authed = useAuthPhase() === 'authenticated';
  const cfg = usePublicConfig();
  const feed = useQuery({ queryKey: ['community', 'home-preview'], queryFn: () => getFeed(coreHttp, { sort: 'new' }), enabled: authed, staleTime: 60_000, retry: false });
  const preview = useQuery({
    ...feedPublicPreviewQuery(coreHttp),
    enabled: !authed && cfg.communityPublicPreview === true,
    staleTime: 30_000,
    retry: false,
  });
  if (!isWebRouteReady('/cong-dong')) return null;
  const rows: Row[] = authed
    ? (feed.data?.posts ?? []).slice(0, PREVIEW_COUNT).map((p) => ({
        id: p.id,
        title: p.title || p.body,
        author: p.author,
        createdAt: p.createdAt,
        commentCount: p.commentCount,
        openable: true,
      }))
    : (preview.data?.posts ?? []).slice(0, PREVIEW_COUNT).map((p) => ({
        id: p.id,
        title: p.title || p.snippet,
        author: p.author,
        createdAt: p.createdAt,
        commentCount: p.commentCount,
        openable: false,
      }));
  const loading = authed ? feed.isLoading : cfg.isLoaded && cfg.communityPublicPreview === true && preview.isLoading;
  if (rows.length === 0) {
    return loading ? (
      <div data-testid="community-loading" aria-hidden="true" style={{ height: COMMUNITY_HEIGHT }}>
        <Skeleton height="100%" radius="var(--radius-card)" />
      </div>
    ) : null;
  }
  return (
    <section aria-label={homeCopy.community.title} style={{ height: COMMUNITY_HEIGHT }}>
      <SectionHeader title={homeCopy.community.title} action={{ label: homeCopy.community.seeAll, to: '/cong-dong' }} />
      <Card variant="outline" padding={0}>
        {rows.map((r, i) => (
          <ListRow
            key={r.id}
            icon={<Icon icon={MessageCircle} tone="brand" />}
            title={
              <Text variant="body-sm" style={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {r.title}
              </Text>
            }
            subtitle={`${r.author} · ${timeAgo(r.createdAt)} · ${r.commentCount > 0 ? homeCopy.community.comments(r.commentCount) : homeCopy.community.noComments}`}
            trailing={r.openable ? 'chevron' : undefined}
            onPress={r.openable ? () => router.push(`/cong-dong/${encodeURIComponent(r.id)}`) : undefined}
            style={{ height: ROW_HEIGHT, boxSizing: 'border-box', overflow: 'hidden', padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          />
        ))}
      </Card>
    </section>
  );
}
