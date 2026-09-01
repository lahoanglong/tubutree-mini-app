import { Box, Text, useNavigate } from 'zmp-ui';
import { Hash } from 'lucide-react';
import type { FeedItem } from '../../services/feed-api';
import { timeAgo } from '../../utils/time-ago';
import { formatVnd } from '../../utils/format';
import { vi } from '../../i18n/vi';
import { RankBadge } from './rank-badge';

// Xuất để dùng lại ở community-moderation.tsx (localize post.kind thô "QUESTION"/"TIP"...).
export const KIND_LABEL: Partial<Record<FeedItem['kind'], string>> = {
  QUESTION: '❓ ' + vi.community.kindQuestion,
  SHOWCASE: '🌿 ' + vi.community.kindShowcase,
  TIP: '💡 ' + vi.community.kindTip,
  HARVEST: vi.community.kindHarvest,
  SPECIES: vi.community.kindSpecies,
  MILESTONE: vi.community.kindMilestone,
  MANUAL: vi.community.kindManual,
};

export default function PostCard({ post, onClick }: { post: FeedItem; onClick: () => void }) {
  const navigate = useNavigate();
  const label = KIND_LABEL[post.kind];
  return (
    <Box onClick={onClick} className="tubu-press" p={4} mt={2} style={{ background: 'var(--neutral-0)', cursor: 'pointer' }}>
      <Box flex alignItems="center" style={{ gap: 8 }}>
        {post.avatar
          ? <img src={post.avatar} alt="" width={32} height={32} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          : <Box style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--leaf-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Text size="small">🌱</Text></Box>}
        <Box style={{ flex: 1 }}>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text size="small" bold>{post.author}</Text>
            {post.badge === 'EXPERT' && <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>🌿 {vi.community.expert}</Text>}
            <RankBadge level={post.authorLevel} />
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {timeAgo(post.createdAt)}{post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}
          </Text>
        </Box>
      </Box>
      {label && <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', marginTop: 6 }}>{label}</Text>}
      {post.title && <Text bold style={{ marginTop: 2 }}>{post.title}</Text>}
      <Text size="small" style={{ marginTop: 4, color: 'var(--neutral-900)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.body}</Text>
      {post.images[0] && (
        <img src={post.images[0]} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-lg)', marginTop: 8, maxHeight: 220, objectFit: 'cover' }} />
      )}
      {post.productTags.length > 0 && (
        <Box flex style={{ gap: 8, marginTop: 8, overflowX: 'auto' }}>
          {post.productTags.map((p) => (
            <Box key={p.slug} onClick={(e) => { e.stopPropagation(); navigate(`/product/${p.slug}`); }}
              flex alignItems="center" style={{ gap: 6, padding: 6, borderRadius: 'var(--radius-md)', border: '1px solid var(--neutral-100)', flex: '0 0 auto', maxWidth: 200 }}>
              {p.thumbnail && <img src={p.thumbnail} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover' }} />}
              <Box><Text size="xSmall" style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</Text>
              <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>{formatVnd(p.salePrice ?? p.basePrice)}</Text></Box>
            </Box>
          ))}
        </Box>
      )}
      {post.tags.length > 0 && (
        <Box flex style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {post.tags.map((t) => (
            <Box
              key={t.slug}
              role="button"
              className="tubu-press"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/feed?tag=${encodeURIComponent(t.slug)}&tagName=${encodeURIComponent(t.name)}`);
              }}
              flex
              alignItems="center"
              style={{
                gap: 2,
                padding: '4px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--leaf-100)',
                color: 'var(--leaf-700)',
                fontSize: 12,
              }}
            >
              <Hash size={11} />
              <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>{t.name}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flex style={{ gap: 16, marginTop: 10 }}>
        <Text size="small" style={{ color: post.liked ? 'var(--leaf-700)' : 'var(--neutral-500)' }}>{post.liked ? '💚' : '🤍'} {post.likeCount}</Text>
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>💬 {post.commentCount}</Text>
        {post.kind === 'QUESTION' && post.bestCommentId && <Text size="small" style={{ color: 'var(--leaf-700)' }}>✅ {vi.community.hasBestAnswer}</Text>}
      </Box>
    </Box>
  );
}
