import { Heart, MessageCircle, Sprout } from 'lucide-react';
import { apiMediaUrl } from '../../services/api';
import type { FeedPreviewItem } from '../../services/feed-api';
import { timeAgo } from '../../utils/time-ago';
import { vi } from '../../i18n/vi';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { ExpertBadge } from './author-line';
import { KIND_ICON, KIND_LABEL } from './post-card';

/**
 * Bài xem trước cho khách chưa đăng nhập: chỉ đọc, không có nút thích/bình luận/mở bài (các thao tác đó cần đăng nhập),
 * nên thẻ không tương tác; lối duy nhất đi tiếp là nút đăng nhập ở đầu danh sách.
 */
export function PublicPreviewList({ posts, onLogin }: { posts: FeedPreviewItem[]; onLogin: () => void }) {
  return (
    <div style={{ padding: '12px 12px 24px' }}>
      <Text variant="body-sm" tone="secondary" as="p" style={{ margin: 0 }}>
        {vi.community.previewLead}
      </Text>
      <div style={{ marginTop: 12 }}>
        <Button fullWidth onPress={onLogin}>
          {vi.auth.loginCta}
        </Button>
      </div>
      {posts.map((post) => {
        const label = KIND_LABEL[post.kind];
        const KindIcon = KIND_ICON[post.kind];
        return (
          <article
            key={post.id}
            data-testid="preview-card"
            style={{ marginTop: 12, padding: 16, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--color-action-secondary-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon icon={Sprout} size="sm" tone="brand" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-sm" as="div" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.author}
                </Text>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 6 }}>
                  {post.badge === 'EXPERT' && <ExpertBadge />}
                  <Text variant="caption" tone="tertiary">
                    {`${timeAgo(post.createdAt)}${post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}`}
                  </Text>
                </div>
              </div>
            </div>
            {label && (
              <Text variant="label" tone="brand" as="div" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                {KindIcon && <Icon icon={KindIcon} size="sm" tone="brand" />}
                {label}
              </Text>
            )}
            {post.title && (
              <Text variant="body-lg" as="div" style={{ marginTop: 2, fontWeight: 600 }}>
                {post.title}
              </Text>
            )}
            <Text variant="body-sm" as="div" style={{ marginTop: 4 }}>
              {post.snippet}
            </Text>
            {post.image && (
              <img
                src={apiMediaUrl(post.image)}
                alt=""
                loading="lazy"
                style={{ width: '100%', borderRadius: 'var(--radius-media)', marginTop: 8, maxHeight: 220, objectFit: 'cover' }}
              />
            )}
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              <Text variant="body-sm" tone="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon icon={Heart} size="sm" tone="muted" />
                {post.likeCount}
              </Text>
              <Text variant="body-sm" tone="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon icon={MessageCircle} size="sm" tone="muted" />
                {post.commentCount}
              </Text>
            </div>
          </article>
        );
      })}
    </div>
  );
}
