import { useState } from 'react';
import { Page, Input, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, EyeOff, Gift, Trophy } from 'lucide-react';
import {
  adminPendingPosts,
  adminApprovePost,
  adminRejectPost,
  adminReports,
  adminResolveReport,
  adminHidePost,
  removeComment,
  adminEvents,
  adminEventParticipants,
  createEvent,
  closeEvent,
  pickEventWinner,
  type AdminPendingPost,
  type AdminReport,
  type AdminCommunityEvent,
  type FeedPostKind,
  type CreateEventInput,
} from '../services/feed-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Heading, Text } from '../components/ui/text';
import { formatDate, formatPoints } from '../utils/format';
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
  minHeight: 44,
  padding: '10px 12px',
  border: '1px solid var(--color-border-default)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--type-body-sm-size)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const PAGE_BG = { background: 'var(--color-bg-canvas)' } as const;

const LIST_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const ACTION_ROW_STYLE: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 10 };

export default function CommunityModerationPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') {
    return (
      <Page style={PAGE_BG}>
        <PageHeader title={vi.community.moderation} />
        <EmptyState art="box" heading={vi.community.notAdmin} />
      </Page>
    );
  }
  return <ModerationHub />;
}

type Tab = 'pending' | 'reports' | 'events';

function ModerationHub() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <Page style={{ ...PAGE_BG, paddingBottom: 96 }}>
      <PageHeader title={vi.community.moderation} />
      <div style={{ padding: '12px 16px 0' }}>
        <SegmentedTabs
          items={[
            { key: 'pending', label: vi.community.tabPending },
            { key: 'reports', label: vi.community.tabReports },
            { key: 'events', label: vi.community.events },
          ]}
          value={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>
      <div role="tabpanel" style={{ padding: 16 }}>
        {tab === 'pending' ? <PendingSection /> : tab === 'reports' ? <ReportsSection /> : <EventsSection />}
      </div>
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

  if (pendingQ.isLoading) return <Skeleton height={120} radius="var(--radius-card)" />;
  if (pendingQ.isError && !pendingQ.data) return <ErrorState message={getErrorMessage(pendingQ.error)} onRetry={() => void pendingQ.refetch()} />;
  if (!pendingQ.data || pendingQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noPending} />;
  }

  return (
    <div style={LIST_STYLE}>
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
    </div>
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
    <Card padding={12}>
      <Text variant="caption" tone="tertiary" as="div">
        {KIND_LABEL[post.kind as FeedPostKind] ?? post.kind}{post.category ? ` · ${post.category}` : ''} · {post.author} · {timeAgo(post.createdAt)}
      </Text>
      {post.title && (
        <Text variant="body-md" as="div" style={{ marginTop: 4, fontWeight: 600 }}>
          {post.title}
        </Text>
      )}
      <Text
        variant="body-sm"
        as="div"
        style={{
          marginTop: 4,
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
          style={{ width: '100%', borderRadius: 'var(--radius-media)', marginTop: 8, maxHeight: 200, objectFit: 'cover' }}
        />
      )}
      <div style={ACTION_ROW_STYLE}>
        <Button icon={Check} loading={loading} onPress={onApprove} style={{ flex: 1 }}>
          {vi.community.approve}
        </Button>
        <Button variant="danger" icon={X} loading={loading} onPress={onReject} style={{ flex: 1 }}>
          {vi.community.reject}
        </Button>
      </div>
    </Card>
  );
}

function ReportsSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const reportsQ = useQuery({ queryKey: ['admin-community-reports'], queryFn: adminReports });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-community-reports'] });

  // Bài và bình luận là 2 endpoint khác nhau — trước đây chỉ có đường cho bài nên nút ẩn
  // bị giấu hoàn toàn với báo cáo bình luận (bình luận vi phạm hiển thị vĩnh viễn).
  const hideM = useMutation({
    mutationFn: ({ targetId, targetType }: { targetId: string; targetType: string }) =>
      targetType === 'COMMENT' ? removeComment(targetId) : adminHidePost(targetId),
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

  if (reportsQ.isLoading) return <Skeleton height={120} radius="var(--radius-card)" />;
  if (reportsQ.isError && !reportsQ.data) return <ErrorState message={getErrorMessage(reportsQ.error)} onRetry={() => void reportsQ.refetch()} />;
  if (!reportsQ.data || reportsQ.data.length === 0) {
    return <EmptyState art="leaf" heading={vi.community.noReports} />;
  }

  return (
    <div style={LIST_STYLE}>
      {reportsQ.data.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          onHide={() => hideM.mutate({ targetId: report.targetId, targetType: report.targetType })}
          onResolve={() => resolveM.mutate(report.id)}
          hideLoading={hideM.isPending && hideM.variables?.targetId === report.targetId}
          resolveLoading={resolveM.isPending && resolveM.variables === report.id}
        />
      ))}
    </div>
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
    <Card padding={12}>
      <Text variant="caption" tone="tertiary" as="div">
        {TARGET_LABEL[report.targetType] ?? report.targetType}
        {report.target ? ` · ${report.target.author}` : ''} · {timeAgo(report.createdAt)}
      </Text>
      {/* Nội dung BỊ BÁO CÁO, không phải cuid: bấm "Ẩn nội dung" mà không nhìn thấy nội dung đó
          là gì thì rất dễ gỡ nhầm nội dung lành. */}
      {report.target ? (
        <div style={{ marginTop: 4, padding: 8, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}>
          {report.target.title && (
            <Text variant="caption" as="div" style={{ fontWeight: 600 }}>{report.target.title}</Text>
          )}
          <Text variant="caption" tone="secondary" as="div">{report.target.excerpt}</Text>
          {report.target.alreadyHandled && (
            <Text variant="caption" tone="brand" as="div" style={{ marginTop: 2 }}>
              Nội dung này đã được gỡ.
            </Text>
          )}
        </div>
      ) : (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>
          Nội dung không còn tồn tại.
        </Text>
      )}
      <Text variant="body-sm" as="div" style={{ marginTop: 6 }}>Lý do báo cáo: {report.reason}</Text>
      <div style={ACTION_ROW_STYLE}>
        <Button variant="danger" icon={EyeOff} loading={hideLoading} onPress={onHide} style={{ flex: 1 }}>
          {vi.community.hideContent}
        </Button>
        <Button icon={Check} loading={resolveLoading} onPress={onResolve} style={{ flex: 1 }}>
          {vi.community.resolve}
        </Button>
      </div>
    </Card>
  );
}

function EventsSection() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [view, setView] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const eventsQ = useQuery({ queryKey: ['admin-community-events', view], queryFn: () => adminEvents(view) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-community-events'] });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [rewardPoints, setRewardPoints] = useState('0');

  const createM = useMutation({
    mutationFn: (dto: CreateEventInput) => createEvent(dto),
    onSuccess: () => {
      openSnackbar({ text: vi.community.eventCreated, type: 'success' });
      setTitle('');
      setDescription('');
      setCoverUrl('');
      setStartAt('');
      setEndAt('');
      setRewardPoints('0');
      invalidate();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const filled = title.trim().length > 0 && startAt.length > 0 && endAt.length > 0;
  const canCreate = filled && !createM.isPending;

  const submitCreate = () => {
    if (!canCreate) return;
    createM.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      coverUrl: coverUrl || undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      rewardPoints: Number(rewardPoints) || 0,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card padding={12}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Heading variant="title-sm" as="h2">{vi.community.createEvent}</Heading>
          <Input
            aria-label={vi.community.eventTitlePlaceholder}
            placeholder={vi.community.eventTitlePlaceholder}
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input.TextArea
            aria-label={vi.community.eventDescPlaceholder}
            placeholder={vi.community.eventDescPlaceholder}
            value={description}
            rows={2}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
          <ImageUpload label={vi.community.eventCoverLabel} value={coverUrl} onChange={setCoverUrl} />
          <Field label={vi.community.eventStartLabel}>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              style={NATIVE_INPUT_STYLE}
            />
          </Field>
          <Field label={vi.community.eventEnds}>
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              style={NATIVE_INPUT_STYLE}
            />
          </Field>
          <Input
            type="number"
            aria-label={vi.community.eventRewardLabel}
            placeholder={vi.community.eventRewardLabel}
            value={rewardPoints}
            onChange={(e) => setRewardPoints(e.target.value)}
          />
          <Text variant="caption" tone="tertiary" as="div">{vi.community.eventRewardHint}</Text>
          <Button fullWidth loading={createM.isPending} disabled={!filled} onPress={submitCreate}>
            {vi.community.createEvent}
          </Button>
        </div>
      </Card>

      <SegmentedTabs
        items={[
          { key: 'OPEN', label: vi.community.eventsOpen },
          { key: 'CLOSED', label: vi.community.eventsClosed },
        ]}
        value={view}
        onChange={(key) => setView(key as 'OPEN' | 'CLOSED')}
      />

      {eventsQ.isLoading ? (
        <Skeleton height={120} radius="var(--radius-card)" />
      ) : eventsQ.isError ? (
        <ErrorState message={getErrorMessage(eventsQ.error)} onRetry={() => void eventsQ.refetch()} />
      ) : !eventsQ.data || eventsQ.data.length === 0 ? (
        <EmptyState art="leaf" heading={view === 'OPEN' ? vi.community.noEvents : vi.community.noClosedEvents} />
      ) : (
        <div style={LIST_STYLE}>
          {eventsQ.data.map((event) =>
            view === 'OPEN' ? (
              <AdminEventCard key={event.id} event={event} onDone={invalidate} />
            ) : (
              <ClosedEventCard key={event.id} event={event} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ClosedEventCard({ event }: { event: AdminCommunityEvent }) {
  return (
    <Card padding={12}>
      <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{event.title}</Text>
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {vi.community.eventEnds}: {formatDate(event.endAt)} ·
        <Icon icon={Gift} size="sm" tone="muted" />
        {formatPoints(event.rewardPoints)}
      </Text>
      {event.winner ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <Avatar size={32} src={event.winner.avatar ?? undefined} />
          <div style={{ minWidth: 0 }}>
            <Text variant="caption" tone="tertiary" as="div">{vi.community.winnerIs}</Text>
            <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{event.winner.name}</Text>
          </div>
        </div>
      ) : (
        <Text variant="body-sm" tone="tertiary" as="div" style={{ marginTop: 8 }}>{vi.community.noWinner}</Text>
      )}
    </Card>
  );
}

function AdminEventCard({ event, onDone }: { event: AdminCommunityEvent; onDone: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const participantsQ = useQuery({
    queryKey: ['admin-community-event-participants', event.id],
    queryFn: () => adminEventParticipants(event.id),
    enabled: choosing,
  });
  const participants = participantsQ.data ?? [];
  const chosen = participants.find((p) => p.userId === selected) ?? null;

  const closeM = useMutation({
    mutationFn: () => closeEvent(event.id),
    onSuccess: () => {
      openSnackbar({ text: vi.community.eventClosed, type: 'success' });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const winnerM = useMutation({
    mutationFn: (userId: string) => pickEventWinner(event.id, userId),
    onSuccess: () => {
      openSnackbar({ text: vi.community.winnerPicked, type: 'success' });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Card padding={12}>
      <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{event.title}</Text>
      {event.description && (
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
          {event.description}
        </Text>
      )}
      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {vi.community.eventEnds}: {formatDate(event.endAt)} ·
        <Icon icon={Gift} size="sm" tone="muted" />
        {formatPoints(event.rewardPoints)}
      </Text>

      {choosing ? (
        <div style={{ marginTop: 10 }}>
          <Text variant="label" as="div">{vi.community.chooseWinner}</Text>
          {participantsQ.isLoading ? (
            <Skeleton height={56} radius="var(--radius-card)" style={{ marginTop: 8 }} />
          ) : participantsQ.isError ? (
            <ErrorState message={getErrorMessage(participantsQ.error)} onRetry={() => void participantsQ.refetch()} />
          ) : participants.length === 0 ? (
            <Text variant="body-sm" tone="tertiary" as="div" style={{ marginTop: 8 }}>{vi.community.noParticipants}</Text>
          ) : (
            <div role="radiogroup" aria-label={vi.community.chooseWinner} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {participants.map((p) => {
                const active = p.userId === selected;
                return (
                  <button
                    key={p.userId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(p.userId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 56,
                      padding: '8px 10px',
                      textAlign: 'left',
                      font: 'inherit',
                      cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--color-action-primary-bg)' : 'var(--color-border-default)'}`,
                      borderRadius: 'var(--radius-control)',
                      background: active ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    <Avatar size={36} src={p.avatar ?? undefined} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{p.name}</Text>
                      <Text variant="caption" tone="tertiary" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.postTitle}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="div">
                        {vi.community.participantPosts(p.postCount)} · {timeAgo(p.postedAt)}
                      </Text>
                    </span>
                    {active && <Icon icon={Check} size="sm" tone="brand" />}
                  </button>
                );
              })}
            </div>
          )}
          <div style={ACTION_ROW_STYLE}>
            <Button
              fullWidth
              icon={Trophy}
              loading={winnerM.isPending}
              disabled={!chosen}
              onPress={() => chosen && winnerM.mutate(chosen.userId)}
            >
              {chosen ? vi.community.confirmWinner(chosen.name) : vi.community.pickWinner}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" fullWidth icon={Trophy} onPress={() => setChoosing(true)} style={{ marginTop: 10 }}>
          {vi.community.pickWinner}
        </Button>
      )}
      <Button variant="danger" fullWidth loading={closeM.isPending} onPress={() => closeM.mutate()} style={{ marginTop: 8 }}>
        {vi.community.closeEvent}
      </Button>
    </Card>
  );
}
