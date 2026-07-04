import { useState } from 'react';
import { Box, Page, Text, Button, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Check, X, EyeOff } from 'lucide-react';
import {
  adminPendingPosts,
  adminApprovePost,
  adminRejectPost,
  adminReports,
  adminResolveReport,
  adminHidePost,
  type AdminPendingPost,
  type AdminReport,
  type FeedPostKind,
} from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { timeAgo } from '../utils/time-ago';
import { vi } from '../i18n/vi';
import { KIND_LABEL } from '../components/community/post-card';

// report.targetType thô "POST"/"COMMENT" → nhãn vi.
const TARGET_LABEL: Record<string, string> = {
  POST: vi.community.targetPost,
  COMMENT: vi.community.targetComment,
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

type Tab = 'pending' | 'reports';

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
      </Box>
      <Box p={4}>{tab === 'pending' ? <PendingSection /> : <ReportsSection />}</Box>
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
          loading={loading}
          style={{ flex: 1, color: 'var(--danger, #d64545)' }}
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
            loading={hideLoading}
            style={{ flex: 1, color: 'var(--danger, #d64545)' }}
            onClick={onHide}
          >
            {vi.community.hideContent}
          </Button>
        )}
        <Button size="small" prefixIcon={<Check size={15} />} loading={resolveLoading} style={{ flex: 1 }} onClick={onResolve}>
          {vi.community.resolve}
        </Button>
      </Box>
    </Box>
  );
}
