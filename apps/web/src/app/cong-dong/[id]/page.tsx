'use client';

import { useRef, useState, type FormHTMLAttributes, type ReactNode } from 'react';
import { useStickyBarOffset } from '@/components/use-sticky-bar-offset';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Flag, Heart, MessageCircle, Pencil, Pin, Trash2 } from 'lucide-react';
import {
  addComment,
  adminPin,
  deletePost,
  editPost,
  reactPost,
  removeComment,
  reportContent,
  setBestAnswer,
} from '@tubutree/app-core/api/feed';
import { postCommentsQuery, postQuery } from '@tubutree/app-core/queries/feed';
import { AuthorLine, Avatar, KIND_ICON, KIND_LABEL, safeMediaUrl, timeAgo } from '@/components/community/post-parts';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { miniBleed, miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { TagPrice } from '@/components/community/tag-price';
import { ui } from '@/lib/guest-ui';
import { CommentRow } from './comment-row';
import { ConfirmDeleteSheet, EditPostSheet, ReportSheet } from './post-sheets';
import { PAGE_NARROW } from '@/lib/page-frame';
import { ProductThumb } from '@/components/mini';
import { actionErrorText, loadErrorText } from '@/lib/error-text';

const TITLE = 'Cộng đồng Vườn Tubu';
const ICON_BTN = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-700 hover:bg-stone-100';
const CLAMP1 = { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;

const errorText = loadErrorText;
const actErrText = actionErrorText;

type ReportTarget = { targetType: 'POST' | 'COMMENT'; targetId?: string };

// Ô trả lời fixed ở điện thoại: gắn has-sticky-bar để chân trang không bị che.
function ReplyBar(props: FormHTMLAttributes<HTMLFormElement>) {
  const ref = useRef<HTMLFormElement>(null);
  useStickyBarOffset(ref);
  return <form ref={ref} {...props} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className={`${PAGE_NARROW} py-6 max-md:pt-0`}>
      <PageHeader title={TITLE} backHref="/cong-dong" backLabel="Quay lại cộng đồng" />
      <div className="mt-4 flex flex-col gap-3 max-md:mt-0 max-md:gap-2">{children}</div>
    </main>
  );
}

function PostSkeleton() {
  return (
    <div className={`${ui.card} flex flex-col gap-2.5 p-4`} aria-hidden="true">
      <div className="flex items-center gap-2.5">
        <Skeleton width={40} height={40} rounded="rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton width="40%" height={13} />
          <Skeleton width="25%" height={11} />
        </div>
      </div>
      <Skeleton width="90%" height={16} />
      <Skeleton width="100%" height={13} />
      <Skeleton width="80%" height={13} />
      <Skeleton height={180} rounded="rounded-media" />
    </div>
  );
}

/** Chi tiết bài cộng đồng (cùng nội dung với `post-detail.tsx` của Mini App); API yêu cầu đăng nhập cho cả đọc bài lẫn bình luận. */
export default function PostDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const authed = phase === 'authenticated';

  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<{ commentId: string; message: string } | null>(null);
  // Lỗi của thao tác trong sheet/ô nhập hiện ngay tại chỗ: banner đầu trang nằm dưới lớp phủ của sheet hoặc ngoài màn hình khi đã cuộn.
  const [editError, setEditError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const post = useQuery({ ...postQuery(coreHttp, id), enabled: authed && !!id });
  const comments = useInfiniteQuery({
    ...postCommentsQuery(coreHttp, id),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed && !!id,
  });

  // Gốc ['community'] là tiền tố của bài ['community', id], bình luận ['community', id, 'comments'] và cả danh sách bảng tin:
  // một lần làm mới cập nhật trang này lẫn thẻ ở /cong-dong (huy hiệu hay nhất, tiêu đề sửa, số tim/bình luận, bài đã xoá).
  const refresh = () => qc.invalidateQueries({ queryKey: ['community'] });
  const onFail = (e: unknown) => {
    setNotice(null);
    setFailure(actErrText(e));
  };
  const ok = (message?: string) => {
    setFailure(null);
    setNotice(message ?? null);
    void refresh();
  };

  const openReport = (target: ReportTarget) => {
    setReportError(null);
    setReportTarget(target);
  };

  const react = useMutation({ mutationFn: () => reactPost(coreHttp, id), onSuccess: () => ok(), onError: onFail });
  const addCommentMut = useMutation({
    mutationFn: (body: string) => addComment(coreHttp, id, body),
    onSuccess: () => {
      setCommentText('');
      setReplyError(null);
      ok();
    },
    onError: (e) => setReplyError(actErrText(e)),
  });
  // Lỗi của thao tác trên một bình luận hiện ngay dưới bình luận đó: dải lỗi đầu trang nằm ngoài màn hình khi danh sách dài.
  const markBest = useMutation({
    mutationFn: (commentId: string) => setBestAnswer(coreHttp, id, commentId),
    onMutate: () => setCommentError(null),
    onSuccess: () => ok(),
    onError: (e, commentId) => setCommentError({ commentId, message: actErrText(e) }),
  });
  const removeCommentMut = useMutation({
    mutationFn: (commentId: string) => removeComment(coreHttp, commentId),
    onMutate: () => setCommentError(null),
    onSuccess: () => ok(),
    onError: (e, commentId) => setCommentError({ commentId, message: actErrText(e) }),
  });
  const editMut = useMutation({
    mutationFn: (patch: { title?: string; body: string }) => editPost(coreHttp, id, patch),
    onSuccess: () => {
      setEditing(false);
      setEditError(null);
      ok('Lưu');
    },
    onError: (e) => setEditError(actErrText(e)),
  });
  const reportMut = useMutation({
    mutationFn: (target: ReportTarget) => reportContent(coreHttp, id, { ...target, reason: reportReason.trim() }),
    onSuccess: () => {
      setReportTarget(null);
      setReportReason('');
      setReportError(null);
      ok('Đã gửi báo cáo, cảm ơn bạn 🌿');
    },
    onError: (e) => setReportError(actErrText(e)),
  });
  const pinMut = useMutation({ mutationFn: () => adminPin(coreHttp, id, !(post.data?.isPinned ?? false)), onSuccess: () => ok(), onError: onFail });
  const deleteMut = useMutation({
    mutationFn: () => deletePost(coreHttp, id),
    onSuccess: () => {
      void refresh();
      // Trang danh sách đọc cờ này để báo "Đã xoá bài" như snackbar của Mini App.
      router.push('/cong-dong?deleted=1');
    },
    onError: (e) => {
      setConfirmDelete(false);
      onFail(e);
    },
  });

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Shell>
        <SessionUnavailable />
      </Shell>
    );
  }
  if (!authed) {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem cộng đồng" returnTo={`/cong-dong/${id}`} />
      </Shell>
    );
  }
  if (post.isLoading) {
    return (
      <Shell>
        <PostSkeleton />
      </Shell>
    );
  }
  if (!post.data) {
    return (
      <Shell>
        <ErrorState message={errorText(post.error)} onRetry={() => void post.refetch()} />
      </Shell>
    );
  }

  const p = post.data;
  const kindLabel = KIND_LABEL[p.kind];
  const KindIcon = KIND_ICON[p.kind];
  const canMarkBest = p.kind === 'QUESTION' && (p.isOwner || isAdmin);
  // API sắp thuần theo thời gian để con trỏ phân trang ổn định (isAccepted đổi được, để trong orderBy thì trang 2 lặp trang 1
  // khi chủ bài chọn câu hay giữa chừng); ghim câu hay nhất lên đầu ở đây.
  const all = comments.data?.pages.flatMap((pg) => pg.items) ?? [];
  const sorted = [...all.filter((c) => c.isAccepted), ...all.filter((c) => !c.isAccepted)];
  const images = p.images.map((src) => safeMediaUrl(src)).filter((s): s is string => s !== null);
  const firstTag = p.productTags[0];

  return (
    <Shell>
      {notice && (
        <p role="status" className="rounded-control bg-forest-50 px-3 py-2 text-sm text-forest-800">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="rounded-control bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {failure}
        </p>
      )}

      <article className={`${ui.card} p-4 ${miniBleed}`}>
        {p.status === 'PENDING' && p.isOwner && (
          <div className="mb-2.5 flex items-center gap-1.5 rounded-control bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-fg">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Chờ duyệt
          </div>
        )}
        {p.isPinned && (
          <div className="mb-2.5 flex items-center gap-1.5 rounded-control bg-stone-100 px-3 py-2 text-sm font-semibold text-forest-700">
            <Pin className="h-4 w-4" aria-hidden="true" />
            Đã ghim
          </div>
        )}
        {isAdmin && (
          <button type="button" disabled={pinMut.isPending} onClick={() => pinMut.mutate()} className={`${miniBtnSecondary} mb-2.5`}>
            <Pin className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {p.isPinned ? 'Bỏ ghim' : 'Ghim'}
          </button>
        )}
        <div className="flex items-center gap-2">
          <Avatar src={p.avatar} size={40} />
          <AuthorLine
            name={p.author}
            badge={p.badge}
            level={p.authorLevel}
            meta={`${timeAgo(p.createdAt)}${p.category ? ` · ${p.category.icon ?? ''} ${p.category.name}` : ''}`}
          />
          {p.isOwner ? (
            <div className="flex shrink-0">
              <button
                type="button"
                aria-label="Sửa"
                onClick={() => {
                  setEditTitle(p.title ?? '');
                  setEditBody(p.body);
                  setEditError(null);
                  setEditing(true);
                }}
                className={ICON_BTN}
              >
                <Pencil className="h-5 w-5" aria-hidden="true" />
              </button>
              <button type="button" aria-label="Xoá" onClick={() => setConfirmDelete(true)} className={ICON_BTN}>
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button type="button" aria-label="Báo cáo" onClick={() => openReport({ targetType: 'POST' })} className={ICON_BTN}>
              <Flag className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {kindLabel && (
          <div className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-forest-700">
            {KindIcon && <KindIcon className="h-3.5 w-3.5" aria-hidden="true" />}
            {kindLabel}
          </div>
        )}
        {p.kind === 'QUESTION' && p.title && <h2 className="mt-1 font-display text-lg font-semibold text-stone-900 max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]">
            {p.title}
          </h2>}
        <p className="mt-2 whitespace-pre-wrap break-words text-base text-stone-800">{p.body}</p>

        {images.length > 0 && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" loading="lazy" className="w-full rounded-media object-cover" />
            ))}
          </div>
        )}

        {p.productTags.length > 0 && (
          <div className="mt-3">
            <div className="grid gap-2 md:grid-cols-2">
              {p.productTags.map((pt) => (
                <Link
                  key={pt.slug}
                  href={`/san-pham/${encodeURIComponent(pt.slug)}`}
                  className="flex min-h-11 items-center gap-2.5 rounded-control border border-stone-200 bg-stone-0 p-2.5"
                >
                  <ProductThumb src={safeMediaUrl(pt.thumbnail)} alt="" size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-stone-800" style={CLAMP1}>
                      {pt.name}
                    </span>
                    <TagPrice product={pt} className="block text-sm font-semibold text-forest-700" />
                  </span>
                </Link>
              ))}
            </div>
            {(p.kind === 'SHOWCASE' || p.kind === 'QUESTION') && firstTag && (
              <Link href={`/san-pham/${encodeURIComponent(firstTag.slug)}`} className={`${ui.btnPrimary} mt-2 w-full`}>
                {p.kind === 'SHOWCASE' ? 'Mua sản phẩm này' : 'Xem sản phẩm gợi ý'}
              </Link>
            )}
          </div>
        )}

        <div className="mt-3.5 flex items-center gap-5 text-stone-700">
          <button
            type="button"
            aria-pressed={p.liked}
            aria-disabled={react.isPending || undefined}
            onClick={() => {
              // Chặn chạm nhanh: mỗi lần chạm là một lời gọi bật/tắt tim, chồng nhau thì kết quả khó đoán.
              if (react.isPending) return;
              react.mutate();
            }}
            className={`inline-flex min-h-11 min-w-11 items-center gap-1.5 ${p.liked ? 'font-semibold text-forest-700' : ''} ${react.isPending ? 'opacity-60' : ''}`}
          >
            <Heart className="h-5 w-5" aria-hidden="true" style={p.liked ? { fill: 'currentColor' } : undefined} />
            <span className="sr-only">Lượt thích: </span>
            {p.likeCount}
          </button>
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Bình luận: </span>
            {p.commentCount}
          </span>
        </div>
      </article>

      <section aria-labelledby="answers-title" className={`${ui.card} p-4 ${miniBleed}`}>
        <h2 id="answers-title" className="mb-2.5 font-display text-lg font-semibold text-stone-900 max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]">
          Trả lời ({sorted.length})
        </h2>
        {comments.isLoading ? (
          <div className="flex flex-col gap-2.5" aria-hidden="true">
            {[0, 1].map((i) => (
              <Skeleton key={i} height={84} rounded="rounded-control" />
            ))}
          </div>
        ) : comments.isError ? (
          <ErrorState message={errorText(comments.error)} onRetry={() => void comments.refetch()} />
        ) : sorted.length === 0 ? (
          <p className="text-sm text-stone-600">Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                canMarkBest={canMarkBest}
                onMarkBest={() => markBest.mutate(c.id)}
                marking={markBest.isPending && markBest.variables === c.id}
                onReport={() => openReport({ targetType: 'COMMENT', targetId: c.id })}
                onRemove={() => removeCommentMut.mutate(c.id)}
                removing={removeCommentMut.isPending && removeCommentMut.variables === c.id}
                error={commentError?.commentId === c.id ? commentError.message : null}
              />
            ))}
          </ul>
        )}
        {comments.hasNextPage && (
          <button type="button" disabled={comments.isFetchingNextPage} onClick={() => void comments.fetchNextPage()} className={`${miniBtnSecondary} mt-2.5`}>
            {comments.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm trả lời'}
          </button>
        )}
      </section>

      <ReplyBar
        onSubmit={(e) => {
          e.preventDefault();
          const body = commentText.trim();
          if (body && !addCommentMut.isPending) {
            setReplyError(null);
            addCommentMut.mutate(body);
          }
        }}
        data-sticky-bar
        className="sticky bottom-0 -mx-4 flex flex-col gap-1.5 border-t border-stone-200 bg-stone-0 px-4 py-2.5 md:mx-0 md:rounded-card md:border max-md:fixed max-md:inset-x-0 max-md:z-30 max-md:mx-0 max-md:border-t-0 max-md:shadow-[var(--elevation-3)]"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {replyError && (
          <p role="alert" className={ui.error}>
            {replyError}
          </p>
        )}
        <div className="flex gap-2">
          <input
            aria-label="Viết trả lời…"
            placeholder="Viết trả lời…"
            value={commentText}
            maxLength={500}
            onChange={(e) => setCommentText(e.target.value)}
            className={`${ui.field} flex-1`}
          />
          <button type="submit" disabled={commentText.trim().length === 0 || addCommentMut.isPending} className={ui.btnPrimary}>
            Gửi
          </button>
        </div>
      </ReplyBar>

      <EditPostSheet
        open={editing}
        kind={p.kind}
        title={editTitle}
        body={editBody}
        onTitle={setEditTitle}
        onBody={setEditBody}
        onClose={() => setEditing(false)}
        saving={editMut.isPending}
        error={editError}
        onSave={() => editMut.mutate({ title: p.kind === 'QUESTION' ? editTitle.trim() : undefined, body: editBody.trim() })}
      />
      <ConfirmDeleteSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} deleting={deleteMut.isPending} onConfirm={() => deleteMut.mutate()} />
      <ReportSheet
        open={!!reportTarget}
        reason={reportReason}
        onReason={setReportReason}
        sending={reportMut.isPending}
        error={reportError}
        onClose={() => {
          setReportTarget(null);
          setReportReason('');
        }}
        onSubmit={() => reportTarget && reportMut.mutate(reportTarget)}
      />
    </Shell>
  );
}
