import { CheckCircle2, Flag, Trash2 } from 'lucide-react';
import type { FeedComment } from '@tubutree/app-core/api/feed';
import { AuthorLine, Avatar, timeAgo } from '@/components/community/post-parts';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';

const ICON_BTN = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-700 hover:bg-stone-100';

/** Một câu trả lời: chủ bình luận ẩn được, người khác báo cáo được, chủ câu hỏi (hoặc ADMIN) chọn "hay nhất". */
export function CommentRow({
  comment,
  canMarkBest,
  onMarkBest,
  marking,
  onReport,
  onRemove,
  removing,
  error,
}: {
  comment: FeedComment;
  canMarkBest: boolean;
  onMarkBest: () => void;
  marking: boolean;
  onReport: () => void;
  onRemove: () => void;
  removing: boolean;
  error?: string | null;
}) {
  return (
    <li
      data-testid="comment-row"
      className={`rounded-control border p-3 ${comment.isAccepted ? 'border-forest-300 bg-forest-50' : 'border-transparent bg-stone-50'}`}
    >
      {comment.isAccepted && (
        <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-forest-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Câu trả lời hay nhất
        </div>
      )}
      <div className="flex items-center gap-2">
        <Avatar src={comment.avatar} size={28} />
        <AuthorLine name={comment.author} badge={comment.badge} level={comment.authorLevel} meta={timeAgo(comment.createdAt)} />
        {comment.isOwner ? (
          <button type="button" aria-label="Ẩn nội dung" disabled={removing} onClick={onRemove} className={`${ICON_BTN} disabled:opacity-50`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" aria-label="Báo cáo" onClick={onReport} className={ICON_BTN}>
            <Flag className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-stone-800">{comment.body}</p>
      {canMarkBest && !comment.isAccepted && (
        <button type="button" disabled={marking} onClick={onMarkBest} className={`${miniBtnSecondary} mt-2`}>
          Chọn hay nhất
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-control bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}
    </li>
  );
}
