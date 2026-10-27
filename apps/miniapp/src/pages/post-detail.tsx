import { useState } from 'react';
import { Input, Page, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle2, Clock, Flag, MessageCircle, Pin, Sprout } from 'lucide-react';
import { getPost, getComments, reportContent, type FeedComment } from '../services/feed-api';
import { apiMediaUrl, getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { timeAgo } from '../utils/time-ago';
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
import { AuthorLine } from '../components/community/author-line';
import { KIND_ICON, KIND_LABEL } from '../components/community/post-card';
import { ProductThumb } from '../components/ui/product-thumb';
import { TagPrice } from '../components/community/tag-price';

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const phase = useAuthPhase();
  const login = useAuthStore((s) => s.login);
  const authed = phase === 'authenticated';

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

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (phase === 'loading') {
    return <PostSkeleton />;
  }


  // Mất kết nối lúc khôi phục phiên: không phải khách — nói đúng vậy + Thử lại, không mời đăng nhập lại.
  if (phase === 'unavailable') {
    return (
      <Page style={{ background: 'var(--color-bg-canvas)' }}>
        <PageHeader title={vi.community.title} />
        <SessionUnavailable />
      </Page>
    );
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

  if (!post.data) {
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
  // BE sắp thuần theo thời gian để cursor phân trang ổn định (isAccepted là khoá THAY ĐỔI ĐƯỢC,
  // để trong orderBy sẽ khiến trang 2 lặp lại trang 1 khi chủ bài chọn best-answer giữa chừng).
  // Ghim câu trả lời hay nhất lên đầu ở đây.
  const allComments = comments.data?.pages.flatMap((pg) => pg.items) ?? [];
  const sortedComments = [
    ...allComments.filter((c) => c.isAccepted),
    ...allComments.filter((c) => !c.isAccepted),
  ];
  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 24 }}>
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
            <Text
              variant="body-sm"
              as="div"
              style={{ color: 'var(--color-status-warning-fg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon icon={Clock} size="sm" tone="current" />
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
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
            <AuthorLine
              size="lg"
              name={p.author}
              badge={p.badge}
              level={p.authorLevel}
              meta={`${timeAgo(p.createdAt)}${p.category ? ` · ${p.category.icon ?? ''} ${p.category.name}` : ''}`}
            />
          </div>
          {!p.isOwner && (
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
                src={apiMediaUrl(src)}
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
                <ProductThumb src={pt.thumbnail} alt="" size={48} />
                <div style={{ flex: 1 }}>
                  <Text
                    variant="body-sm"
                    as="div"
                    style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {pt.name}
                  </Text>
                  <TagPrice product={pt} variant="price-sm" />
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
            {vi.community.noAnswers}
          </Text>
        ) : (
          sortedComments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              onReport={() => {
                haptic('light');
                setReportTarget({ targetType: 'COMMENT', targetId: c.id });
              }}
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

function CommentRow({ comment, onReport }: { comment: FeedComment; onReport: () => void }) {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
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
          <AuthorLine name={comment.author} badge={comment.badge} level={comment.authorLevel} meta={timeAgo(comment.createdAt)} />
        </div>
        {!comment.isOwner && <IconButton icon={Flag} size="sm" label={vi.community.report} onPress={onReport} />}
      </div>
      <Text variant="body-sm" as="div" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </Text>
    </div>
  );
}
