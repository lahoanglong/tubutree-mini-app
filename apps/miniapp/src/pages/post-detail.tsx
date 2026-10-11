import { useState } from 'react';
import { Input, Page, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Flag, Heart, Leaf, MessageCircle, Pencil, Pin, Sprout, Trash2 } from 'lucide-react';
import {
  getPost,
  getComments,
  addComment,
  setBestAnswer,
  deletePost,
  editPost,
  reactPost,
  reportContent,
  removeComment,
  adminPin,
  type FeedComment,
} from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { timeAgo } from '../utils/time-ago';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { IconButton } from '../components/ui/icon-button';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Heading, Text } from '../components/ui/text';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { RankBadge } from '../components/community/rank-badge';
import { KIND_ICON, KIND_LABEL } from '../components/community/post-card';

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';

  const [commentText, setCommentText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [reportTarget, setReportTarget] = useState<{ targetType: 'POST' | 'COMMENT'; targetId?: string } | null>(null);
  const [reportReason, setReportReason] = useState('');

  const post = useQuery({
    queryKey: ['community', id],
    queryFn: () => getPost(id!),
    enabled: authed && !!id,
  });
  const comments = useInfiniteQuery({
    queryKey: ['community', id, 'comments'],
    queryFn: ({ pageParam }) => getComments(id!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed && !!id,
  });

  // Root ['community'] là prefix của detail ['community', id], comments ['community', id, 'comments']
  // VÀ list ['community', category, sort] → 1 lần invalidate làm mới cả trang chi tiết lẫn thẻ ở /feed
  // (badge best-answer, tiêu đề sửa, số like/comment, bài đã xoá). Invalidation của React Query là
  // theo prefix nên ['community', id] KHÔNG khớp key list — bắt buộc invalidate ở gốc.
  const invalidateCommunity = () => qc.invalidateQueries({ queryKey: ['community'] });

  const react = useMutation({
    mutationFn: () => reactPost(id!),
    onSuccess: () => void invalidateCommunity(),
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const addCommentMut = useMutation({
    mutationFn: (body: string) => addComment(id!, body),
    onSuccess: () => {
      setCommentText('');
      void invalidateCommunity();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const markBest = useMutation({
    mutationFn: (commentId: string) => setBestAnswer(id!, commentId),
    onSuccess: () => {
      haptic('medium');
      void invalidateCommunity();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  // Tự gỡ bình luận của mình — trước đây không có đường nào (kể cả tác giả) để gỡ 1 bình luận.
  const removeCommentMut = useMutation({
    mutationFn: (commentId: string) => removeComment(commentId),
    onSuccess: () => {
      haptic('medium');
      void invalidateCommunity();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const editMut = useMutation({
    mutationFn: (patch: { title?: string; body: string }) => editPost(id!, patch),
    onSuccess: () => {
      setEditing(false);
      openSnackbar({ text: vi.common.save, type: 'success' });
      void invalidateCommunity();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const reportMut = useMutation({
    mutationFn: (target: { targetType: 'POST' | 'COMMENT'; targetId?: string }) =>
      reportContent(id!, { ...target, reason: reportReason.trim() }),
    onSuccess: () => {
      haptic('light');
      setReportTarget(null);
      setReportReason('');
      openSnackbar({ text: vi.community.reported, type: 'success' });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const pinMut = useMutation({
    mutationFn: () => adminPin(id!, !(post.data?.isPinned ?? false)),
    onSuccess: () => {
      haptic('medium');
      void invalidateCommunity();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deletePost(id!),
    onSuccess: () => {
      // Invalidate TRƯỚC khi rời trang để list /feed refetch (bỏ bài đã xoá) ngay.
      void invalidateCommunity();
      openSnackbar({ text: vi.community.deleted, type: 'success' });
      navigate('/feed');
    },
    onError: (e: unknown) => {
      setConfirmDelete(false);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (status === 'loading') {
    return <PostSkeleton />;
  }

  // BE yêu cầu JWT cho mọi route /feed/:id (kể cả GET) — chưa đăng nhập thì không có gì để xem.
  if (!authed) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <EmptyState art="sprout" heading={vi.community.loginToView} ctaLabel={vi.auth.loginCta} onCta={() => void login()} />
      </Page>
    );
  }

  if (post.isLoading) {
    return <PostSkeleton />;
  }

  if (post.isError || !post.data) {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <ErrorState message={getErrorMessage(post.error)} onRetry={() => void post.refetch()} />
      </Page>
    );
  }

  const p = post.data;
  const kindLabel = KIND_LABEL[p.kind];
  const KindIcon = KIND_ICON[p.kind];
  const canMarkBest = p.kind === 'QUESTION' && (p.isOwner || role === 'ADMIN');
  // BE sắp thuần theo thời gian để cursor phân trang ổn định (isAccepted là khoá THAY ĐỔI ĐƯỢC,
  // để trong orderBy sẽ khiến trang 2 lặp lại trang 1 khi chủ bài chọn best-answer giữa chừng).
  // Ghim câu trả lời hay nhất lên đầu ở đây.
  const allComments = comments.data?.pages.flatMap((pg) => pg.items) ?? [];
  const sortedComments = [
    ...allComments.filter((c) => c.isAccepted),
    ...allComments.filter((c) => !c.isAccepted),
  ];
  const needsEditTitle = p.kind === 'QUESTION' && editTitle.trim().length === 0;

  const openEdit = () => {
    setEditTitle(p.title ?? '');
    setEditBody(p.body);
    setEditing(true);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <PageHeader title={vi.community.title} />

      <div style={{ padding: 16, background: 'var(--color-bg-surface)' }}>
        {p.status === 'PENDING' && p.isOwner && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-control)',
              background: 'var(--color-status-warning-bg)',
              marginBottom: 10,
            }}
          >
            <Text variant="body-sm" as="div" style={{ color: 'var(--color-status-warning-fg)', fontWeight: 600 }}>
              {vi.community.pendingBadge}
            </Text>
          </div>
        )}
        {p.isPinned && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-control)',
              background: 'var(--color-bg-subtle)',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon icon={Pin} size="sm" tone="brand" />
            <Text variant="body-sm" tone="brand" style={{ fontWeight: 600 }}>
              {vi.community.pinned}
            </Text>
          </div>
        )}
        {role === 'ADMIN' && (
          <Button
            variant="secondary"
            icon={Pin}
            loading={pinMut.isPending}
            onPress={() => {
              haptic('light');
              pinMut.mutate();
            }}
            style={{ marginBottom: 10 }}
          >
            {p.isPinned ? vi.community.unpin : vi.community.pin}
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.avatar ? (
              <img src={p.avatar} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'var(--color-action-secondary-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon icon={Sprout} size="md" tone="brand" />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text variant="body-lg" style={{ fontWeight: 600 }}>{p.author}</Text>
                {p.badge === 'EXPERT' && <ExpertBadge />}
                <RankBadge level={p.authorLevel} />
              </div>
              <Text variant="caption" tone="tertiary" as="div">
                {timeAgo(p.createdAt)}
                {p.category ? ` · ${p.category.icon ?? ''} ${p.category.name}` : ''}
              </Text>
            </div>
          </div>
          {p.isOwner ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <IconButton
                icon={Pencil}
                label={vi.community.edit}
                onPress={() => {
                  haptic('light');
                  openEdit();
                }}
              />
              <IconButton
                icon={Trash2}
                label={vi.community.delete}
                onPress={() => {
                  haptic('light');
                  setConfirmDelete(true);
                }}
              />
            </div>
          ) : (
            <IconButton
              icon={Flag}
              label={vi.community.report}
              onPress={() => {
                haptic('light');
                setReportTarget({ targetType: 'POST' });
              }}
            />
          )}
        </div>

        {kindLabel && (
          <Text variant="label" tone="brand" as="div" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
            {KindIcon && <Icon icon={KindIcon} size="sm" tone="brand" />}
            {kindLabel}
          </Text>
        )}
        {p.kind === 'QUESTION' && p.title && (
          <Heading variant="title-sm" as="h2" style={{ marginTop: 4 }}>
            {p.title}
          </Heading>
        )}
        <Text variant="body-md" as="div" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{p.body}</Text>

        {p.images.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {p.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                loading="lazy"
                style={{ width: '100%', borderRadius: 'var(--radius-media)', objectFit: 'cover' }}
              />
            ))}
          </div>
        )}

        {p.productTags.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {p.productTags.map((pt) => (
              <div
                key={pt.slug}
                role="button"
                {...rowKeyboardProps()}
                className="tubu-press"
                onClick={() => navigate(`/product/${pt.slug}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  minHeight: 44,
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--color-border-subtle)',
                  marginBottom: 8,
                }}
              >
                {pt.thumbnail && (
                  <img src={pt.thumbnail} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: 'cover' }} />
                )}
                <div style={{ flex: 1 }}>
                  <Text
                    variant="body-sm"
                    as="div"
                    style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {pt.name}
                  </Text>
                  <Text variant="price-sm" tone="brand" as="div">
                    {formatVnd(pt.salePrice ?? pt.basePrice)}
                  </Text>
                </div>
              </div>
            ))}
            {(p.kind === 'SHOWCASE' || p.kind === 'QUESTION') && (
              <Button
                fullWidth
                size="lg"
                onPress={() => navigate(`/product/${p.productTags[0]!.slug}`)}
                style={{ marginTop: 4 }}
              >
                {p.kind === 'SHOWCASE' ? vi.community.buyThis : vi.community.viewSolution}
              </Button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 14 }}>
          <button
            type="button"
            aria-pressed={p.liked}
            aria-disabled={react.isPending || undefined}
            className="tubu-press"
            onClick={() => {
              // react.mutate() không có ô "loading"/"disabled" như Button — chặn double-tap thủ công,
              // nếu không mỗi lần chạm nhanh sẽ bắn nhiều request toggle like/unlike chồng nhau.
              if (react.isPending) return;
              haptic('light');
              react.mutate();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 44,
              minWidth: 44,
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              opacity: react.isPending ? 0.6 : 1,
            }}
          >
            <Icon icon={Heart} size="md" tone={p.liked ? 'brand' : 'muted'} style={p.liked ? { fill: 'var(--color-text-brand)' } : undefined} />
            <Text variant="body-lg" tone={p.liked ? 'brand' : 'secondary'}>
              {p.likeCount}
            </Text>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon icon={MessageCircle} size="md" tone="muted" />
            <Text variant="body-lg" tone="secondary">{p.commentCount}</Text>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>
        <Heading variant="title-sm" as="h2" style={{ marginBottom: 10 }}>
          {vi.community.answers} ({sortedComments.length})
        </Heading>

        {comments.isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{ padding: 12, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-canvas)', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Skeleton width={28} height={28} radius="50%" />
                  <Skeleton width="30%" height={12} />
                </div>
                <Skeleton width="90%" height={12} />
                <Skeleton width="60%" height={12} />
              </div>
            ))}
          </div>
        ) : comments.isError ? (
          <ErrorState message={getErrorMessage(comments.error)} onRetry={() => void comments.refetch()} />
        ) : sortedComments.length === 0 ? (
          <Text variant="body-sm" tone="tertiary" as="div">
            {vi.community.emptyBody}
          </Text>
        ) : (
          sortedComments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              canMarkBest={canMarkBest}
              onMarkBest={() => markBest.mutate(c.id)}
              markingPending={markBest.isPending && markBest.variables === c.id}
              onReport={() => {
                haptic('light');
                setReportTarget({ targetType: 'COMMENT', targetId: c.id });
              }}
              onRemove={() => {
                haptic('light');
                removeCommentMut.mutate(c.id);
              }}
              removing={removeCommentMut.isPending && removeCommentMut.variables === c.id}
            />
          ))
        )}
        {comments.hasNextPage && (
          <Button
            variant="secondary"
            loading={comments.isFetchingNextPage}
            onPress={() => comments.fetchNextPage()}
            style={{ marginTop: 10 }}
          >
            Xem thêm trả lời
          </Button>
        )}
      </div>

      {/* Ô thêm trả lời — cố định đáy màn hình */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--color-bg-surface)',
          boxShadow: 'var(--elevation-3)',
          padding: '10px 16px calc(10px + var(--safe-bottom))',
          display: 'flex',
          gap: 8,
        }}
      >
        <Input
          aria-label={vi.community.commentPlaceholder}
          placeholder={vi.community.commentPlaceholder}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          loading={addCommentMut.isPending}
          disabled={commentText.trim().length === 0}
          onPress={() => addCommentMut.mutate(commentText.trim())}
          style={{ flex: '0 0 auto' }}
        >
          {vi.community.send}
        </Button>
      </div>

      {/* Sheet sửa bài (chủ bài) */}
      <BottomSheet
        open={editing}
        onClose={() => setEditing(false)}
        title={vi.community.edit}
        footer={
          <Button
            fullWidth
            loading={editMut.isPending}
            disabled={needsEditTitle || editBody.trim().length === 0}
            onPress={() =>
              editMut.mutate({
                title: p.kind === 'QUESTION' ? editTitle.trim() : undefined,
                body: editBody.trim(),
              })
            }
          >
            {vi.common.save}
          </Button>
        }
      >
        {p.kind === 'QUESTION' && (
          <div style={{ marginTop: 12 }}>
            <Input
              aria-label={vi.community.titlePlaceholder}
              placeholder={vi.community.titlePlaceholder}
              value={editTitle}
              maxLength={160}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            {needsEditTitle && (
              <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
                {vi.community.needTitle}
              </Text>
            )}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Input.TextArea
            aria-label={vi.community.bodyPlaceholder}
            placeholder={vi.community.bodyPlaceholder}
            value={editBody}
            maxLength={5000}
            rows={5}
            onChange={(e) => setEditBody(e.target.value)}
          />
        </div>
      </BottomSheet>

      {/* Xác nhận xoá (thao tác không hoàn tác) */}
      <BottomSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={vi.community.confirmDelete}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Button fullWidth variant="secondary" onPress={() => setConfirmDelete(false)}>
            {vi.common.cancel}
          </Button>
          <Button fullWidth variant="danger" loading={deleteMut.isPending} onPress={() => deleteMut.mutate()}>
            {vi.community.delete}
          </Button>
        </div>
      </BottomSheet>

      {/* Sheet báo cáo bài/bình luận vi phạm */}
      <BottomSheet
        open={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          setReportReason('');
        }}
        title={vi.community.report}
        footer={
          <Button
            fullWidth
            variant="danger"
            loading={reportMut.isPending}
            onPress={() => reportTarget && reportMut.mutate(reportTarget)}
          >
            {vi.community.report}
          </Button>
        }
      >
        <Input.TextArea
          aria-label={vi.community.reportReason}
          placeholder={vi.community.reportReason}
          value={reportReason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReportReason(e.target.value)}
        />
      </BottomSheet>
    </Page>
  );
}

function ExpertBadge() {
  return (
    <Text variant="label" tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Icon icon={Leaf} size="sm" tone="brand" />
      {vi.community.expert}
    </Text>
  );
}

/** Skeleton match layout bài viết (avatar+tên, tiêu đề, vài dòng thân bài, ảnh) — dùng cho cả 2 trạng thái loading trước khi có dữ liệu bài viết. */
function PostSkeleton() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={vi.community.title} />
      <div style={{ padding: 16, background: 'var(--color-bg-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Skeleton width={40} height={40} radius="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="40%" height={13} />
            <Skeleton width="25%" height={11} />
          </div>
        </div>
        <Skeleton width="90%" height={16} />
        <Skeleton width="100%" height={13} />
        <Skeleton width="80%" height={13} />
        <Skeleton height={180} radius="var(--radius-media)" />
      </div>
    </Page>
  );
}

function CommentRow({
  comment,
  canMarkBest,
  onMarkBest,
  markingPending,
  onReport,
  onRemove,
  removing,
}: {
  comment: FeedComment;
  canMarkBest: boolean;
  onMarkBest: () => void;
  markingPending: boolean;
  onReport: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <div
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 'var(--radius-control)',
        background: comment.isAccepted ? 'var(--color-bg-subtle)' : 'var(--color-bg-canvas)',
        border: comment.isAccepted ? '1px solid var(--forest-300)' : '1px solid transparent',
      }}
    >
      {comment.isAccepted && (
        <Text variant="label" tone="brand" as="div" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon icon={CheckCircle2} size="sm" tone="brand" />
          {vi.community.bestAnswer}
        </Text>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {comment.avatar ? (
            <img src={comment.avatar} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--color-action-secondary-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon icon={Sprout} size="sm" tone="brand" />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text variant="body-sm" style={{ fontWeight: 600 }}>
                {comment.author}
              </Text>
              {comment.badge === 'EXPERT' && <ExpertBadge />}
              <RankBadge level={comment.authorLevel} />
            </div>
            <Text variant="caption" tone="tertiary" as="div">
              {timeAgo(comment.createdAt)}
            </Text>
          </div>
        </div>
        {comment.isOwner ? (
          <IconButton
            icon={Trash2}
            size="sm"
            label={vi.community.hideContent}
            style={{ opacity: removing ? 0.5 : 1 }}
            onPress={removing ? undefined : onRemove}
          />
        ) : (
          <IconButton icon={Flag} size="sm" label={vi.community.report} onPress={onReport} />
        )}
      </div>
      <Text variant="body-sm" as="div" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </Text>
      {canMarkBest && !comment.isAccepted && (
        <Button variant="secondary" loading={markingPending} onPress={onMarkBest} style={{ marginTop: 8 }}>
          {vi.community.markBest}
        </Button>
      )}
    </div>
  );
}
