import Link from 'next/link';
import { CheckCircle2, Hash, Heart, MessageCircle } from 'lucide-react';
import type { FeedItem } from '@tubutree/app-core/api/feed';
import { formatVnd } from '@/lib/format-vnd';
import { AuthorLine, Avatar, KIND_ICON, KIND_LABEL, safeMediaUrl, timeAgo } from './post-parts';
import { dedupeTagsAgainstProducts } from './post-tags';

const CLAMP3 = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;
const CLAMP1 = { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;

// ::after của liên kết mở bài phủ cả thẻ nên chạm đâu cũng mở bài; thẻ sản phẩm và hashtag là anh em của nó, nổi lên bằng z-10.
const STRETCHED = 'block min-h-11 py-2.5 -my-2.5 after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-forest-600';

/** Thẻ bài đăng của bảng tin: vỏ không tương tác, liên kết thật bọc tiêu đề (bài không tiêu đề thì bọc nội dung). */
export function PostCard({ post }: { post: FeedItem }) {
  const label = KIND_LABEL[post.kind];
  const KindIcon = KIND_ICON[post.kind];
  const tags = dedupeTagsAgainstProducts(post.tags, post.productTags);
  const cover = safeMediaUrl(post.images[0]);
  const href = `/cong-dong/${encodeURIComponent(post.id)}`;
  const extra = (post.imageCount ?? 1) - 1;
  return (
    <article data-testid="post-card" className="relative isolate rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex items-center gap-2">
        <Avatar src={post.avatar} />
        <AuthorLine
          name={post.author}
          badge={post.badge}
          level={post.authorLevel}
          meta={`${timeAgo(post.createdAt)}${post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}`}
        />
      </div>
      {label && (
        <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-forest-700">
          {KindIcon && <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
        </div>
      )}
      {post.title ? (
        <>
          <Link href={href} className={`${STRETCHED} mt-0.5 text-base font-semibold text-stone-900`}>
            {post.title}
          </Link>
          <p className="text-sm text-stone-800" style={CLAMP3}>
            {post.body}
          </p>
        </>
      ) : (
        <Link href={href} className={`${STRETCHED} mt-1 text-sm text-stone-800`} style={CLAMP3}>
          {post.body}
        </Link>
      )}
      {cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" loading="lazy" className="mt-2 max-h-56 w-full rounded-media object-cover" />
          {extra > 0 && <div className="mt-1 text-xs text-stone-600">{`+${extra} ảnh nữa`}</div>}
        </>
      )}
      {post.productTags.length > 0 && (
        <div className="relative z-10 mt-2 flex gap-2 overflow-x-auto">
          {post.productTags.map((p) => (
            <Link
              key={p.slug}
              href={`/san-pham/${encodeURIComponent(p.slug)}`}
              className="flex min-h-11 max-w-[200px] shrink-0 items-center gap-1.5 rounded-control border border-stone-200 bg-stone-0 p-1.5"
            >
              {p.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={safeMediaUrl(p.thumbnail) ?? undefined} alt="" width={28} height={28} className="rounded-md object-cover" />
              )}
              <span className="min-w-0">
                <span className="block text-xs text-stone-800" style={CLAMP1}>
                  {p.name}
                </span>
                <span className="block text-xs font-semibold text-forest-700">{formatVnd(p.salePrice ?? p.basePrice)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Link
              key={t.slug}
              href={`/cong-dong?tag=${encodeURIComponent(t.slug)}&tagName=${encodeURIComponent(t.name)}`}
              className="relative z-10 inline-flex min-h-11 max-w-[60%] items-center gap-1 rounded-full bg-stone-100 px-3 text-xs font-medium text-forest-700"
            >
              <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{t.name}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex gap-4 text-sm text-stone-700">
        <span className={`inline-flex items-center gap-1 ${post.liked ? 'font-semibold text-forest-700' : ''}`}>
          <Heart className="h-4 w-4" aria-hidden="true" style={post.liked ? { fill: 'currentColor' } : undefined} />
          <span className="sr-only">Lượt thích: </span>
          {post.likeCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Bình luận: </span>
          {post.commentCount}
        </span>
        {post.kind === 'QUESTION' && post.bestCommentId && (
          <span className="inline-flex items-center gap-1 font-semibold text-forest-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Đã có câu trả lời hay
          </span>
        )}
      </div>
    </article>
  );
}
