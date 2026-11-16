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
import { SectionHeader } from '../ui/section-header';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const PREVIEW_COUNT = 2;
// Mỗi dòng cao cố định (đệm 12 + tên MỘT dòng 22 + 2 + phụ đề 20 + đệm 12) và thẻ giữ chỗ đủ hai dòng, cộng viền 1px hai mép: khung chờ cao đúng bằng lúc có bài, nên thẻ về muộn
// không đẩy các thẻ sản phẩm phía dưới trong lưới Gợi ý.
const ROW_HEIGHT = 68;
const CARD_HEIGHT = PREVIEW_COUNT * ROW_HEIGHT + 2;

interface Row {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  commentCount: number;
  openable: boolean;
}

/**
 * Cộng đồng hỏi đáp, thẻ chen trong lưới Gợi ý của Trang chủ (lưới đã lo đệm ngang): hai bài mới nhất, chỉ đọc (Mini App không đăng bài, thích, bình luận). Khách đã
 * đăng nhập mở được bài; khách chưa đăng nhập chỉ thấy phần xem trước công khai khi cờ bật và chỉ có nút "Xem tất cả". Đang tải giữ khung chờ cao đúng bằng lúc có bài;
 * không có bài hay lỗi → ẩn.
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
  const loading = authed ? feed.isLoading : preview.isLoading;
  if (rows.length === 0 && !loading) return null;
  if (rows.length === 0) {
    return (
      <section aria-label={homeCopy.community.title} aria-busy="true" data-testid="community-preview-loading">
        <SectionHeader title={homeCopy.community.title} action={{ label: homeCopy.community.seeAll, to: '/feed' }} />
        <Skeleton height={CARD_HEIGHT} radius="var(--radius-card)" />
      </section>
    );
  }
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };
  return (
    <section aria-label={homeCopy.community.title}>
      <SectionHeader title={homeCopy.community.title} action={{ label: homeCopy.community.seeAll, to: '/feed' }} />
      <Card variant="outline" padding={0} style={{ minHeight: CARD_HEIGHT, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <ListRow
            key={r.id}
            icon={<Icon icon={MessageCircle} tone="brand" />}
            title={
              <Text variant="body-sm" as="div" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.title}
              </Text>
            }
            subtitle={
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {`${r.author} · ${timeAgo(r.createdAt)} · ${r.commentCount > 0 ? homeCopy.community.comments(r.commentCount) : homeCopy.community.noComments}`}
              </span>
            }
            trailing={r.openable ? 'chevron' : undefined}
            onPress={r.openable ? () => go(`/feed/${encodeURIComponent(r.id)}`) : undefined}
            style={{ height: ROW_HEIGHT, padding: 12, borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          />
        ))}
      </Card>
    </section>
  );
}
