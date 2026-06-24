import { useState } from 'react';
import { Box, Page, Text, Button, Input, Spinner, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFeed,
  createPost,
  reactPost,
  getComments,
  addComment,
  type FeedPost,
  type FeedPostKind,
} from '../services/feed-api';
import { useAuthStore } from '../store/auth';

const KIND_BADGE: Record<FeedPostKind, string> = {
  MANUAL: '',
  HARVEST: '🌳 Thu hoạch',
  MILESTONE: '🌍 Mốc cộng đồng',
  SPECIES: '📒 Sưu tập loài',
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}

export default function FeedPage() {
  const status = useAuthStore((s) => s.status);
  const authed = status === 'authenticated';
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data: posts, isLoading } = useQuery({ queryKey: ['feed'], queryFn: getFeed, enabled: authed });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['feed'] });

  const postM = useMutation({
    mutationFn: () => createPost(draft.trim()),
    onSuccess: () => {
      setDraft('');
      openSnackbar({ text: 'Đã đăng bài 🌿', type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  const reactM = useMutation({
    mutationFn: (id: string) => reactPost(id),
    onSuccess: () => refresh(),
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  if (!authed || isLoading) {
    return (
      <Page>
        <Box flex justifyContent="center" p={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Text bold size="large">🌿 Bảng tin cộng đồng</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          Khoe thành tích xanh, cổ vũ nhau trồng cây 🌳
        </Text>
        <Box mt={2} flex style={{ gap: 8 }}>
          <Input
            placeholder="Chia sẻ điều xanh hôm nay…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
          />
          <Button
            size="small"
            disabled={!draft.trim() || postM.isPending}
            loading={postM.isPending}
            onClick={() => postM.mutate()}
            style={{ background: 'var(--leaf-600)' }}
          >
            Đăng
          </Button>
        </Box>
      </Box>

      {posts && posts.length > 0 ? (
        posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            onReact={() => reactM.mutate(p.id)}
            reacting={reactM.isPending && reactM.variables === p.id}
          />
        ))
      ) : (
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Text style={{ fontSize: 48 }}>🌱</Text>
          <Text style={{ color: 'var(--neutral-600)', marginTop: 8 }}>Chưa có bài viết nào</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
            Hãy là người đầu tiên chia sẻ thành tích xanh của bạn!
          </Text>
        </Box>
      )}
    </Page>
  );
}

function PostCard({ post, onReact, reacting }: { post: FeedPost; onReact: () => void; reacting: boolean }) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const badge = KIND_BADGE[post.kind];

  const { data: comments, isLoading } = useQuery({
    queryKey: ['feed', post.id, 'comments'],
    queryFn: () => getComments(post.id),
    enabled: open,
  });

  const commentM = useMutation({
    mutationFn: () => addComment(post.id, text.trim()),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['feed', post.id, 'comments'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Box flex alignItems="center" justifyContent="space-between">
        <Text size="small" bold>🌿 {post.author}</Text>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{timeAgo(post.createdAt)}</Text>
      </Box>
      {badge && (
        <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', marginTop: 2 }}>{badge}</Text>
      )}
      <Text size="small" style={{ marginTop: 6, color: 'var(--neutral-900)' }}>{post.body}</Text>

      <Box flex style={{ gap: 16, marginTop: 10 }}>
        <Text
          size="small"
          onClick={() => !reacting && onReact()}
          style={{ color: post.liked ? 'var(--leaf-700)' : 'var(--neutral-500)', cursor: 'pointer' }}
        >
          {post.liked ? '💚' : '🤍'} {post.likeCount}
        </Text>
        <Text
          size="small"
          onClick={() => setOpen((v) => !v)}
          style={{ color: 'var(--neutral-500)', cursor: 'pointer' }}
        >
          💬 {post.commentCount}
        </Text>
      </Box>

      {open && (
        <Box mt={3} style={{ borderTop: '1px solid var(--neutral-100)', paddingTop: 10 }}>
          {isLoading ? (
            <Spinner />
          ) : comments && comments.length > 0 ? (
            comments.map((c) => (
              <Box key={c.id} style={{ padding: '4px 0' }}>
                <Text size="xSmall" bold style={{ color: 'var(--neutral-700)' }}>
                  {c.author} <span style={{ color: 'var(--neutral-400)', fontWeight: 400 }}>· {timeAgo(c.createdAt)}</span>
                </Text>
                <Text size="small">{c.body}</Text>
              </Box>
            ))
          ) : (
            <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>Chưa có bình luận.</Text>
          )}
          <Box mt={2} flex style={{ gap: 8 }}>
            <Input
              placeholder="Viết bình luận…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
            />
            <Button
              size="small"
              disabled={!text.trim() || commentM.isPending}
              loading={commentM.isPending}
              onClick={() => commentM.mutate()}
            >
              Gửi
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
