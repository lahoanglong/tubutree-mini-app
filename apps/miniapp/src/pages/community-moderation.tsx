import { useState } from 'react';
import { Box, Page, Text, Button, Input, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Check, X, EyeOff } from 'lucide-react';
import {
  adminPendingPosts,
  adminApprovePost,
  adminRejectPost,
  adminReports,
  adminResolveReport,
  adminHidePost,
  listEvents,
  createEvent,
  closeEvent,
  pickEventWinner,
  type AdminPendingPost,
  type AdminReport,
  type FeedPostKind,
  type CommunityEvent,
  type CreateEventInput,
} from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { timeAgo } from '../utils/time-ago';
import { vi } from '../i18n/vi';
import { KIND_LABEL } from '../components/community/post-card';
import { ImageUpload } from '../components/image-upload';

// report.targetType thô "POST"/"COMMENT" → nhãn vi.
const TARGET_LABEL: Record<string, string> = {
  POST: vi.community.targetPost,
  COMMENT: vi.community.targetComment,
};

// input[type=datetime-local] thô — zmp-ui Input chỉ hỗ trợ type text/password/number.
const NATIVE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--neutral-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

export default function CommunityModerationPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') {
    return (
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>{vi.community.notAdmin}</Text>
        </Box>
      </Page>
    );
  }
  return <ModerationHub />;
}

type Tab = 'pending' | 'reports' | 'events';

function ModerationHub() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4} flex alignItems="center" style={{ gap: 8 }}>
        <ShieldCheck size={20} color="var(--leaf-700)" />
        <Text.Title size="small">{vi.community.moderation}</Text.Title>
      </Box>
      <Box px={4} flex style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="small" variant={tab === 'pending' ? undefined : 'secondary'} onClick={() => setTab('pending')}>
          {vi.community.tabPending}
        </Button>
        <Button size="small" variant={tab === 'reports' ? undefined : 'secondary'} onClick={() => setTab('reports')}>
          {vi.community.tabReports}
        </Button>
        <Button size="small" variant={tab === 'events' ? undefined : 'secondary'} onClick={() => setTab('events')}>
          {vi.community.events}
        </Button>
      </Box>
      <Box p={4}>
        {tab === 'pending' ? <PendingSection /> : tab === 'reports' ? <ReportsSection /> : <EventsSection />}
      </Box>
    </Page>
  );
}

function PendingSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const pendingQ = useQuery({ queryKey: ['admin-community-pending'], queryFn: adminPendingPosts });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-community-pending'] });

  const approveM = useMutation({
    mutationFn: (id: string) => adminApprovePost(id),
    onSuccess: () => {
      openSnackbar({ text: vi.community.approved, type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const rejectM = useMutation({
    mutationFn: (id: string) => adminRejectPost(id),
    onSuccess: () => {
      openSnackbar({ text: vi.community.rejected, type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (pendingQ.isLoading) return <Skeleton style={{ height: 120, borderRadius: 12 }} />;
  if (pendingQ.isError) return <ErrorState message={getErrorMessage(pendingQ.error)} onRetry={() => void pendingQ.refetch()} />;
  if (!pendingQ.data || pendingQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noPending} />;
  }

  return (
    <Box flex flexDirection="column" style={{ gap: 12 }}>
      {pendingQ.data.map((post) => (
        <PendingCard
          key={post.id}
          post={post}
          onApprove={() => approveM.mutate(post.id)}
          onReject={() => rejectM.mutate(post.id)}
          loading={
            (approveM.isPending && approveM.variables === post.id) ||
            (rejectM.isPending && rejectM.variables === post.id)
          }
        />
      ))}
    </Box>
  );
}

function PendingCard({
  post,
  onApprove,
  onReject,
  loading,
}: {
  post: AdminPendingPost;
  onApprove: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  return (
    <Box style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {KIND_LABEL[post.kind as FeedPostKind] ?? post.kind}{post.category ? ` · ${post.category}` : ''} · {post.author} · {timeAgo(post.createdAt)}
      </Text>
      {post.title && <Text bold style={{ marginTop: 4 }}>{post.title}</Text>}
      <Text
        size="small"
        style={{
          marginTop: 4,
          color: 'var(--neutral-900)',
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {post.body}
      </Text>
      {post.images[0] && (
        <img
          src={post.images[0]}
          alt=""
          loading="lazy"
          style={{ width: '100%', borderRadius: 'var(--radius-lg)', marginTop: 8, maxHeight: 200, objectFit: 'cover' }}
        />
      )}
      <Box flex style={{ gap: 8, marginTop: 10 }}>
        <Button
          size="small"
          prefixIcon={<Check size={15} />}
          disabled={loading}
          loading={loading}
          onClick={onApprove}
          style={{ flex: 1 }}
        >
          {vi.community.approve}
        </Button>
        <Button
          size="small"
          variant="secondary"
          prefixIcon={<X size={15} />}
          disabled={loading}
          loading={loading}
          style={{ flex: 1, color: 'var(--danger)' }}
          onClick={onReject}
        >
          {vi.community.reject}
        </Button>
      </Box>
    </Box>
  );
}

function ReportsSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const reportsQ = useQuery({ queryKey: ['admin-community-reports'], queryFn: adminReports });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-community-reports'] });

  const hideM = useMutation({
    mutationFn: (targetId: string) => adminHidePost(targetId),
    onSuccess: () => {
      openSnackbar({ text: vi.community.hideContent, type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const resolveM = useMutation({
    mutationFn: (id: string) => adminResolveReport(id),
    onSuccess: () => {
      openSnackbar({ text: vi.community.resolved, type: 'success' });
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (reportsQ.isLoading) return <Skeleton style={{ height: 120, borderRadius: 12 }} />;
  if (reportsQ.isError) return <ErrorState message={getErrorMessage(reportsQ.error)} onRetry={() => void reportsQ.refetch()} />;
  if (!reportsQ.data || reportsQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noReports} />;
  }

  return (
    <Box flex flexDirection="column" style={{ gap: 12 }}>
      {reportsQ.data.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          onHide={() => hideM.mutate(report.targetId)}
          onResolve={() => resolveM.mutate(report.id)}
          hideLoading={hideM.isPending && hideM.variables === report.targetId}
          resolveLoading={resolveM.isPending && resolveM.variables === report.id}
        />
      ))}
    </Box>
  );
}

function ReportCard({
  report,
  onHide,
  onResolve,
  hideLoading,
  resolveLoading,
}: {
  report: AdminReport;
  onHide: () => void;
  onResolve: () => void;
  hideLoading: boolean;
  resolveLoading: boolean;
}) {
  return (
    <Box style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {TARGET_LABEL[report.targetType] ?? report.targetType} · {report.targetId} · {timeAgo(report.createdAt)}
      </Text>
      <Text size="small" style={{ marginTop: 4 }}>{report.reason}</Text>
      <Box flex style={{ gap: 8, marginTop: 10 }}>
        {report.targetType === 'POST' && (
          <Button
            size="small"
            variant="secondary"
            prefixIcon={<EyeOff size={15} />}
            disabled={hideLoading}
            loading={hideLoading}
            style={{ flex: 1, color: 'var(--danger)' }}
            onClick={onHide}
          >
            {vi.community.hideContent}
          </Button>
        )}
        <Button size="small" prefixIcon={<Check size={15} />} disabled={resolveLoading} loading={resolveLoading} style={{ flex: 1 }} onClick={onResolve}>
          {vi.community.resolve}
        </Button>
      </Box>
    </Box>
  );
}

function EventsSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const eventsQ = useQuery({ queryKey: ['admin-community-events'], queryFn: listEvents });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-community-events'] });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [rewardXu, setRewardXu] = useState('0');

  const createM = useMutation({
    mutationFn: (dto: CreateEventInput) => createEvent(dto),
    onSuccess: () => {
      openSnackbar({ text: vi.community.eventCreated, type: 'success' });
      setTitle('');
      setDescription('');
      setCoverUrl('');
      setStartAt('');
      setEndAt('');
      setRewardXu('0');
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const canCreate = title.trim().length > 0 && startAt.length > 0 && endAt.length > 0 && !createM.isPending;

  const submitCreate = () => {
    if (!canCreate) return;
    createM.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      coverUrl: coverUrl || undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      rewardXu: Number(rewardXu) || 0,
    });
  };

  return (
    <Box flex flexDirection="column" style={{ gap: 16 }}>
      <Box flex flexDirection="column" style={{ gap: 10, background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
        <Text bold>{vi.community.createEvent}</Text>
        <Input
          placeholder={vi.community.eventTitlePlaceholder}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input.TextArea
          placeholder={vi.community.eventDescPlaceholder}
          value={description}
          rows={2}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <ImageUpload label={vi.community.eventCoverLabel} value={coverUrl} onChange={setCoverUrl} />
        <Box>
          <Text size="xSmall" bold style={{ marginBottom: 4 }}>
            {vi.community.eventStartLabel}
          </Text>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            style={NATIVE_INPUT_STYLE}
          />
        </Box>
        <Box>
          <Text size="xSmall" bold style={{ marginBottom: 4 }}>
            {vi.community.eventEnds}
          </Text>
          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            style={NATIVE_INPUT_STYLE}
          />
        </Box>
        <Input
          type="number"
          placeholder={vi.community.eventRewardLabel}
          value={rewardXu}
          onChange={(e) => setRewardXu(e.target.value)}
        />
        <Button fullWidth loading={createM.isPending} disabled={!canCreate} onClick={submitCreate}>
          {vi.community.createEvent}
        </Button>
      </Box>

      {eventsQ.isLoading ? (
        <Skeleton style={{ height: 120, borderRadius: 12 }} />
      ) : eventsQ.isError ? (
        <ErrorState message={getErrorMessage(eventsQ.error)} onRetry={() => void eventsQ.refetch()} />
      ) : !eventsQ.data || eventsQ.data.length === 0 ? (
        <EmptyState art="leaf" heading={vi.community.noEvents} />
      ) : (
        <Box flex flexDirection="column" style={{ gap: 12 }}>
          {eventsQ.data.map((event) => (
            <AdminEventCard key={event.id} event={event} onDone={invalidate} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function AdminEventCard({ event, onDone }: { event: CommunityEvent; onDone: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [winnerUserId, setWinnerUserId] = useState('');

  const closeM = useMutation({
    mutationFn: () => closeEvent(event.id),
    onSuccess: () => {
      openSnackbar({ text: vi.community.eventClosed, type: 'success' });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const winnerM = useMutation({
    mutationFn: () => pickEventWinner(event.id, winnerUserId.trim()),
    onSuccess: () => {
      openSnackbar({ text: vi.community.winnerPicked, type: 'success' });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Box style={{ background: 'var(--neutral-0)', borderRadius: 12, padding: 12 }}>
      <Text bold>{event.title}</Text>
      {event.description && (
        <Text size="small" style={{ marginTop: 4, color: 'var(--neutral-600)' }}>
          {event.description}
        </Text>
      )}
      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
        {vi.community.eventEnds}: {new Date(event.endAt).toLocaleDateString('vi-VN')} · 🎁 {event.rewardXu} TubuXu
      </Text>
      <Box flex style={{ gap: 8, marginTop: 10 }}>
        <Input
          placeholder={vi.community.winnerUserIdPlaceholder}
          value={winnerUserId}
          onChange={(e) => setWinnerUserId(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          loading={winnerM.isPending}
          disabled={!winnerUserId.trim() || winnerM.isPending}
          onClick={() => winnerM.mutate()}
        >
          {vi.community.pickWinner}
        </Button>
      </Box>
      <Button
        size="small"
        variant="secondary"
        fullWidth
        disabled={closeM.isPending}
        loading={closeM.isPending}
        style={{ marginTop: 8, color: 'var(--danger)' }}
        onClick={() => closeM.mutate()}
      >
        {vi.community.closeEvent}
      </Button>
    </Box>
  );
}
