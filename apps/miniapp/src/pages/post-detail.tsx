import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, Spinner, useParams, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import {
  getPost,
  getComments,
  addComment,
  setBestAnswer,
  deletePost,
  editPost,
  reactPost,
  type FeedItem,
  type FeedComment,
} from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { timeAgo } from '../utils/time-ago';
import { formatVnd } from '../utils/format';
import { ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';

const KIND_LABEL: Partial<Record<FeedItem['kind'], string>> = {
  QUESTION: '❓ ' + vi.community.kindQuestion,
  SHOWCASE: '🌿 ' + vi.community.kindShowcase,
  TIP: '💡 ' + vi.community.kindTip,
  HARVEST: vi.community.kindHarvest,
  SPECIES: vi.community.kindSpecies,
  MILESTONE: vi.community.kindMilestone,
};

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

  const post = useQuery({
    queryKey: ['community', id],
    queryFn: () => getPost(id!),
    enabled: authed && !!id,
  });
  const comments = useQuery({
    queryKey: ['community', id, 'comments'],
    queryFn: () => getComments(id!),
    enabled: authed && !!id,
  });

  const react = useMutation({
    mutationFn: () => reactPost(id!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['community', id] }),
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const addCommentMut = useMutation({
    mutationFn: (body: string) => addComment(id!, body),
    onSuccess: () => {
      setCommentText('');
      void qc.invalidateQueries({ queryKey: ['community', id, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['community', id] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const markBest = useMutation({
    mutationFn: (commentId: string) => setBestAnswer(id!, commentId),
    onSuccess: () => {
      haptic('medium');
      void qc.invalidateQueries({ queryKey: ['community', id, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['community', id] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const editMut = useMutation({
    mutationFn: (patch: { title?: string; body: string }) => editPost(id!, patch),
    onSuccess: () => {
      setEditing(false);
      openSnackbar({ text: vi.common.save, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['community', id] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deletePost(id!),
    onSuccess: () => {
      openSnackbar({ text: vi.community.deleted, type: 'success' });
      navigate('/feed');
    },
    onError: (e: unknown) => {
      setConfirmDelete(false);
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    },
  });

  // Đang silent-login lúc mở app (restore chưa xong) → spinner thay vì chớp cổng đăng nhập.
  if (status === 'loading') {
    return (
      <Page className="page">
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  // BE yêu cầu JWT cho mọi route /feed/:id (kể cả GET) — chưa đăng nhập thì không có gì để xem.
  if (!authed) {
    return (
      <Page className="page">
        <Box style={{ textAlign: 'center', padding: 48 }}>
          <Text style={{ fontSize: 48 }}>🌿</Text>
          <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
          <Button style={{ marginTop: 12, background: 'var(--leaf-600)' }} onClick={() => void login()}>
            {vi.auth.loginCta}
          </Button>
        </Box>
      </Page>
    );
  }

  if (post.isLoading) {
    return (
      <Page className="page">
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (post.isError || !post.data) {
    return (
      <Page className="page">
        <ErrorState message={getErrorMessage(post.error)} onRetry={() => void post.refetch()} />
      </Page>
    );
  }

  const p = post.data;
  const kindLabel = KIND_LABEL[p.kind];
  const canMarkBest = p.kind === 'QUESTION' && (p.isOwner || role === 'ADMIN');
  const sortedComments = comments.data ?? [];
  const needsEditTitle = p.kind === 'QUESTION' && editTitle.trim().length === 0;

  const openEdit = () => {
    setEditTitle(p.title ?? '');
    setEditBody(p.body);
    setEditing(true);
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 100 }}>
      <Box p={4} style={{ background: 'var(--neutral-0)' }}>
        <Box flex alignItems="center" justifyContent="space-between">
          <Box flex alignItems="center" style={{ gap: 8 }}>
            {p.avatar ? (
              <img src={p.avatar} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <Box
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'var(--leaf-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text>🌱</Text>
              </Box>
            )}
            <Box>
              <Box flex alignItems="center" style={{ gap: 6 }}>
                <Text bold>{p.author}</Text>
                {p.badge === 'EXPERT' && (
                  <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                    🌿 {vi.community.expert}
                  </Text>
                )}
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                {timeAgo(p.createdAt)}
                {p.category ? ` · ${p.category.icon ?? ''} ${p.category.name}` : ''}
              </Text>
            </Box>
          </Box>
          {p.isOwner && (
            <Box flex style={{ gap: 14 }}>
              <Box
                role="button"
                aria-label={vi.community.edit}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  openEdit();
                }}
              >
                <Pencil size={18} color="var(--neutral-500)" strokeWidth={1.8} />
              </Box>
              <Box
                role="button"
                aria-label={vi.community.delete}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={18} color="var(--danger)" strokeWidth={1.8} />
              </Box>
            </Box>
          )}
        </Box>

        {kindLabel && (
          <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', marginTop: 10 }}>
            {kindLabel}
          </Text>
        )}
        {p.kind === 'QUESTION' && p.title && (
          <Text.Title size="small" style={{ marginTop: 4 }}>
            {p.title}
          </Text.Title>
        )}
        <Text style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: 'var(--neutral-900)' }}>{p.body}</Text>

        {p.images.length > 0 && (
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {p.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                loading="lazy"
                style={{ width: '100%', borderRadius: 'var(--radius-lg)', objectFit: 'cover' }}
              />
            ))}
          </Box>
        )}

        {p.productTags.length > 0 && (
          <Box style={{ marginTop: 12 }}>
            {p.productTags.map((pt) => (
              <Box
                key={pt.slug}
                role="button"
                className="tubu-press"
                onClick={() => navigate(`/product/${pt.slug}`)}
                flex
                alignItems="center"
                style={{
                  gap: 10,
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--neutral-100)',
                  marginBottom: 8,
                }}
              >
                {pt.thumbnail && (
                  <img src={pt.thumbnail} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: 'cover' }} />
                )}
                <Box style={{ flex: 1 }}>
                  <Text
                    size="small"
                    style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {pt.name}
                  </Text>
                  <Text size="small" bold style={{ color: 'var(--primary-700)' }}>
                    {formatVnd(pt.salePrice ?? pt.basePrice)}
                  </Text>
                </Box>
              </Box>
            ))}
            {(p.kind === 'SHOWCASE' || p.kind === 'QUESTION') && (
              <Button
                fullWidth
                onClick={() => navigate(`/product/${p.productTags[0]!.slug}`)}
                style={{ marginTop: 4, background: 'var(--primary-600)', fontWeight: 600, minHeight: 48 }}
              >
                {p.kind === 'SHOWCASE' ? vi.community.buyThis : vi.community.viewSolution}
              </Button>
            )}
          </Box>
        )}

        <Box flex alignItems="center" style={{ gap: 20, marginTop: 14 }}>
          <Box
            role="button"
            className="tubu-press"
            onClick={() => {
              haptic('light');
              react.mutate();
            }}
            flex
            alignItems="center"
            style={{ gap: 6 }}
          >
            <Text style={{ color: p.liked ? 'var(--leaf-700)' : 'var(--neutral-500)' }}>
              {p.liked ? '💚' : '🤍'} {p.likeCount}
            </Text>
          </Box>
          <Text style={{ color: 'var(--neutral-500)' }}>💬 {p.commentCount}</Text>
        </Box>
      </Box>

      <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="small" style={{ marginBottom: 10 }}>
          {vi.community.answers} ({sortedComments.length})
        </Text>

        {comments.isLoading ? (
          <Box flex justifyContent="center" p={4}>
            <Spinner />
          </Box>
        ) : comments.isError ? (
          <ErrorState message={getErrorMessage(comments.error)} onRetry={() => void comments.refetch()} />
        ) : sortedComments.length === 0 ? (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
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
            />
          ))
        )}
      </Box>

      {/* Ô thêm trả lời — cố định đáy màn hình */}
      <Box
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--neutral-0)',
          boxShadow: 'var(--shadow-lg)',
          padding: '10px 16px calc(10px + var(--safe-bottom))',
          display: 'flex',
          gap: 8,
        }}
      >
        <Input
          placeholder={vi.community.commentPlaceholder}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          loading={addCommentMut.isPending}
          disabled={commentText.trim().length === 0 || addCommentMut.isPending}
          onClick={() => addCommentMut.mutate(commentText.trim())}
          style={{ background: 'var(--primary-600)', minHeight: 44, flex: '0 0 auto' }}
        >
          {vi.community.send}
        </Button>
      </Box>

      {/* Sheet sửa bài (chủ bài) */}
      <Sheet visible={editing} onClose={() => setEditing(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large">
            {vi.community.edit}
          </Text>
          {p.kind === 'QUESTION' && (
            <Box mt={3}>
              <Input
                placeholder={vi.community.titlePlaceholder}
                value={editTitle}
                maxLength={160}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              {needsEditTitle && (
                <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
                  {vi.community.needTitle}
                </Text>
              )}
            </Box>
          )}
          <Box mt={3}>
            <Input.TextArea
              placeholder={vi.community.bodyPlaceholder}
              value={editBody}
              maxLength={5000}
              rows={5}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </Box>
          <Button
            fullWidth
            loading={editMut.isPending}
            disabled={needsEditTitle || editBody.trim().length === 0 || editMut.isPending}
            onClick={() =>
              editMut.mutate({
                title: p.kind === 'QUESTION' ? editTitle.trim() : undefined,
                body: editBody.trim(),
              })
            }
            style={{ marginTop: 16, background: 'var(--primary-600)' }}
          >
            {vi.common.save}
          </Button>
        </Box>
      </Sheet>

      {/* Xác nhận xoá (thao tác không hoàn tác) */}
      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} autoHeight>
        <Box p={5} style={{ textAlign: 'center' }}>
          <Text.Title size="small">{vi.community.confirmDelete}</Text.Title>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            <Button fullWidth variant="secondary" onClick={() => setConfirmDelete(false)}>
              {vi.common.cancel}
            </Button>
            <Button fullWidth loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} style={{ background: 'var(--danger)' }}>
              {vi.community.delete}
            </Button>
          </Box>
        </Box>
      </Sheet>
    </Page>
  );
}

function CommentRow({
  comment,
  canMarkBest,
  onMarkBest,
  markingPending,
}: {
  comment: FeedComment;
  canMarkBest: boolean;
  onMarkBest: () => void;
  markingPending: boolean;
}) {
  return (
    <Box
      p={3}
      mb={2}
      style={{
        borderRadius: 'var(--radius-md)',
        background: comment.isAccepted ? 'var(--leaf-50)' : 'var(--neutral-50)',
        border: comment.isAccepted ? '1px solid var(--leaf-300)' : '1px solid transparent',
      }}
    >
      {comment.isAccepted && (
        <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', marginBottom: 6, display: 'block' }}>
          ✅ {vi.community.bestAnswer}
        </Text>
      )}
      <Box flex alignItems="center" style={{ gap: 8 }}>
        {comment.avatar ? (
          <img src={comment.avatar} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <Box
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--leaf-200)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text size="xSmall">🌱</Text>
          </Box>
        )}
        <Box style={{ flex: 1 }}>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text size="small" bold>
              {comment.author}
            </Text>
            {comment.badge === 'EXPERT' && (
              <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                🌿 {vi.community.expert}
              </Text>
            )}
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {timeAgo(comment.createdAt)}
          </Text>
        </Box>
      </Box>
      <Text size="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </Text>
      {canMarkBest && !comment.isAccepted && (
        <Button size="small" variant="secondary" loading={markingPending} onClick={onMarkBest} style={{ marginTop: 8, minHeight: 36 }}>
          {vi.community.markBest}
        </Button>
      )}
    </Box>
  );
}
