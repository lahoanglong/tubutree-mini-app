import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { MessageCircle } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { usePublicConfig } from '../../hooks/use-public-config';
import { getFeed, getFeedPublicPreview } from '../../services/feed-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { timeAgo } from '../../utils/time-ago';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Heading, Text } from '../ui/text';

const PREVIEW_COUNT = 2;

interface Row {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  commentCount: number;
  openable: boolean;
}

/**
 * Cộng đồng hỏi đáp ở Trang chủ: hai bài mới nhất, chỉ đọc (Mini App không đăng bài, thích, bình luận). Khách đã đăng nhập mở được
 * bài; khách chưa đăng nhập chỉ thấy phần xem trước công khai khi cờ bật và chỉ có nút "Xem tất cả". Không có bài hay lỗi → ẩn.
 */
export function CommunityPreview() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const cfg = usePublicConfig();
  const feed = useQuery({ queryKey: ['community', 'home-preview'], queryFn: () => getFeed({ sort: 'new' }), enabled: authed, staleTime: 60_000, retry: false });
  const preview = useQuery({
    queryKey: ['community', 'public-preview'],
    queryFn: getFeedPublicPreview,
    enabled: !authed && cfg.communityPublicPreview === true,
    staleTime: 30_000,
    retry: false,
  });
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
  if (rows.length === 0) return null;
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };
  return (
    <section aria-label={homeCopy.community.title} style={{ padding: '8px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }}>
        <Heading variant="title-sm" as="h2">
          {homeCopy.community.title}
        </Heading>
        <button
          type="button"
          className="tubu-press"
          onClick={() => go('/feed')}
          style={{ minHeight: 44, padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Text variant="label" tone="brand">
            {homeCopy.community.seeAll}
          </Text>
        </button>
      </div>
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
            onPress={r.openable ? () => go(`/feed/${encodeURIComponent(r.id)}`) : undefined}
            style={{ padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          />
        ))}
      </Card>
    </section>
  );
}
