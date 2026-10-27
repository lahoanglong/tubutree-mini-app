import { useId } from 'react';
import { useNavigate } from 'zmp-ui';
import { BookMarked, CheckCircle2, Globe, Hash, HelpCircle, Leaf, Lightbulb, MessageCircle, PenLine, TreeDeciduous } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiMediaUrl } from '../../services/api';
import type { FeedItem } from '../../services/feed-api';
import { timeAgo } from '../../utils/time-ago';
import { vi } from '../../i18n/vi';
import { Chip } from '../ui/chip';
import { InitialsAvatar } from '../ui/initials-avatar';
import { Icon } from '../ui/icon';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { STRETCHED_LINK_CLASS, STRETCHED_LINK_RESET, stretchedLinkHit44 } from '../ui/stretched-link';
import { Text } from '../ui/text';
import { AuthorLine } from './author-line';
import { dedupeTagsAgainstProducts } from './post-tags';
import { ProductThumb } from '../ui/product-thumb';
import { TagPrice } from './tag-price';

// Xuất để dùng lại ở community-moderation.tsx (localize post.kind thô "QUESTION"/"TIP"...).
export const KIND_LABEL: Partial<Record<FeedItem['kind'], string>> = {
  QUESTION: vi.community.kindQuestion,
  SHOWCASE: vi.community.kindShowcase,
  TIP: vi.community.kindTip,
  HARVEST: vi.community.kindHarvest,
  SPECIES: vi.community.kindSpecies,
  MILESTONE: vi.community.kindMilestone,
  MANUAL: vi.community.kindManual,
};

export const KIND_ICON: Partial<Record<FeedItem['kind'], LucideIcon>> = {
  QUESTION: HelpCircle,
  SHOWCASE: Leaf,
  TIP: Lightbulb,
  HARVEST: TreeDeciduous,
  SPECIES: BookMarked,
  MILESTONE: Globe,
  MANUAL: PenLine,
};

const CLAMP = (lines: number) =>
  ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) as const;

/**
 * Thẻ bài đăng. Vỏ KHÔNG tương tác: nút mở bài là nút thật bọc tiêu đề (bài không tiêu đề thì bọc nội dung),
 * `::after` của nó phủ cả thẻ (cùng cách ProductTile/OrderCard) nên chạm đâu trên thẻ cũng mở bài. Thẻ sản phẩm
 * gắn kèm và hashtag là anh em của nó, nổi lên bằng z-index. Trước đây vỏ là `role="button"` chứa các nút này
 * nên trình đọc màn hình không tới được chúng (axe nested-interactive, 4 thẻ ở /feed).
 */
export default function PostCard({ post, onClick }: { post: FeedItem; onClick: () => void }) {
  const navigate = useNavigate();
  const label = KIND_LABEL[post.kind];
  const KindIcon = KIND_ICON[post.kind];
  const bodyId = useId();
  const tags = dedupeTagsAgainstProducts(post.tags, post.productTags);
  return (
    <div
      data-testid="post-card"
      className="tubu-press"
      style={{ position: 'relative', isolation: 'isolate', padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <InitialsAvatar name={post.author} size={32} />
        <AuthorLine
          name={post.author}
          badge={post.badge}
          level={post.authorLevel}
          meta={`${timeAgo(post.createdAt)}${post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}`}
        />
      </div>
      {label && (
        <Text variant="label" tone="brand" as="div" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          {KindIcon && <Icon icon={KindIcon} size="sm" tone="brand" />}
          {label}
        </Text>
      )}
      {post.title ? (
        <>
          <div style={{ marginTop: 2 }}>
            <button
              type="button"
              className={STRETCHED_LINK_CLASS}
              data-flat=""
              aria-describedby={bodyId}
              onClick={onClick}
              style={{ ...STRETCHED_LINK_RESET, ...stretchedLinkHit44(24), display: 'block', width: '100%' }}
            >
              <Text variant="body-lg" as="span" style={{ display: 'block', fontWeight: 600 }}>
                {post.title}
              </Text>
            </button>
          </div>
          <div id={bodyId} style={{ marginTop: 4 }}>
            <Text variant="body-sm" as="div" style={CLAMP(3)}>{post.body}</Text>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            className={STRETCHED_LINK_CLASS}
            data-flat=""
            onClick={onClick}
            style={{ ...STRETCHED_LINK_RESET, ...stretchedLinkHit44(22), display: 'block', width: '100%' }}
          >
            <Text variant="body-sm" as="span" style={CLAMP(3)}>
              {post.body}
            </Text>
          </button>
        </div>
      )}
      {post.images[0] && (
        <>
          <img src={apiMediaUrl(post.images[0])} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-media)', marginTop: 8, maxHeight: 220, objectFit: 'cover' }} />
          {(post.imageCount ?? 1) > 1 && (
            <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4 }}>
              {`+${(post.imageCount ?? 1) - 1} ảnh nữa`}
            </Text>
          )}
        </>
      )}
      {post.productTags.length > 0 && (
        // Cả hàng nổi trên lớp phủ (không riêng từng thẻ) để vuốt ngang bắt đầu ở khoảng trống giữa hai thẻ vẫn cuộn được hàng.
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
          {post.productTags.map((p) => (
            <div
              key={p.slug}
              role="button"
              {...rowKeyboardProps()}
              className="tubu-press"
              onClick={() => navigate(`/product/${p.slug}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 6,
                minHeight: 44,
                boxSizing: 'border-box',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--color-border-subtle)',
                flex: '0 0 auto',
                maxWidth: 200,
              }}
            >
              <ProductThumb src={p.thumbnail} alt="" size={28} />
              <div>
                <Text variant="caption" as="div" style={CLAMP(1)}>{p.name}</Text>
                <TagPrice product={p} variant="label" />
              </div>
            </div>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {tags.map((t) => (
            <span key={t.slug} style={{ position: 'relative', zIndex: 1, display: 'inline-flex', maxWidth: '60%' }}>
              <Chip
                size="sm"
                icon={Hash}
                style={{ maxWidth: '100%' }}
                onPress={() => navigate(`/feed?tag=${encodeURIComponent(t.slug)}&tagName=${encodeURIComponent(t.name)}`)}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
              </Chip>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <Text variant="body-sm" tone="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon icon={MessageCircle} size="sm" tone="muted" />
          {post.commentCount}
        </Text>
        {post.kind === 'QUESTION' && post.bestCommentId && (
          <Text variant="body-sm" tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon icon={CheckCircle2} size="sm" tone="brand" />
            {vi.community.hasBestAnswer}
          </Text>
        )}
      </div>
    </div>
  );
}
