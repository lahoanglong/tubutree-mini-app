import Link from 'next/link';
import { Heart, MessageCircle } from 'lucide-react';
import type { FeedPreviewItem } from '@tubutree/app-core/api/feed';
import { loginHref } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';
import { Avatar, ExpertBadge, KIND_ICON, KIND_LABEL, safeMediaUrl, timeAgo } from './post-parts';

/**
 * Bài xem trước cho khách chưa đăng nhập: chỉ đọc, không có nút thích/bình luận/mở bài (các thao tác đó cần đăng nhập),
 * nên thẻ không tương tác; lối duy nhất đi tiếp là nút đăng nhập ở đầu danh sách. Là server component để bài có sẵn trong HTML.
 */
export function PublicPreviewList({ posts }: { posts: FeedPreviewItem[] }) {
  return (
    <div>
      <p className="text-sm text-stone-700">Vài bài mới trong cộng đồng. Đăng nhập để đọc tiếp, thích và bình luận.</p>
      <Link href={loginHref('/cong-dong')} className={`${ui.btnPrimary} mt-3 w-full`}>
        Đăng nhập với Zalo
      </Link>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {posts.map((post) => {
          const KindIcon = KIND_ICON[post.kind];
          const image = safeMediaUrl(post.image);
          return (
            <article key={post.id} data-testid="preview-card" className={`${ui.card} p-4`}>
              <div className="flex items-center gap-2">
                <Avatar />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-stone-900">{post.author}</div>
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    {post.badge === 'EXPERT' && <ExpertBadge />}
                    <span className="text-xs text-stone-600">
                      {`${timeAgo(post.createdAt)}${post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-forest-700">
                <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {KIND_LABEL[post.kind]}
              </div>
              {post.title && <div className="mt-0.5 text-base font-semibold text-stone-900">{post.title}</div>}
              <div className="mt-1 text-sm text-stone-800">{post.snippet}</div>
              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="mt-2 max-h-56 w-full rounded-media object-cover" />
              )}
              <div className="mt-2.5 flex gap-4 text-sm text-stone-700">
                <span className="inline-flex items-center gap-1">
                  <Heart className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Lượt thích: </span>
                  {post.likeCount}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Bình luận: </span>
                  {post.commentCount}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
