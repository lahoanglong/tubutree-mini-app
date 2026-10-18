import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { Check, Trophy } from 'lucide-react';
import { claimCtvMilestone, type CtvMilestoneItem, type CtvMilestonesResponse } from '../../services/affiliate-api';
import { getErrorMessage } from '../../services/api';
import { formatPoints, formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';
import { milestoneStatusText, monthLabel, revenueRuleText } from './milestone-copy';

interface ClaimTarget {
  id: string;
  month: string;
  title: string;
  points: number;
}

interface ClaimFailure {
  title: string;
  message: string;
}

const BOLD = { fontWeight: 600 } as const;

const toTargets = (items: CtvMilestoneItem[], month: string): ClaimTarget[] =>
  items.filter((m) => m.canClaim).map((m) => ({ id: m.id, month, title: m.title, points: m.rewardPoints }));

/**
 * Thưởng mốc doanh số tháng (Điểm Xanh): mỗi mốc một dòng gọn, và "Nhận tất cả" khi có từ hai mốc nhận được.
 * Nhận tất cả chỉ gọi lần lượt API nhận từng mốc sẵn có (không có API gộp), tháng trước trước vì hết hạn sớm hơn;
 * mốc nào lỗi thì báo đúng tên mốc, các mốc còn lại vẫn được nhận.
 */
export function MilestoneRewards({ data }: { data: CtvMilestonesResponse }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [failures, setFailures] = useState<ClaimFailure[]>([]);

  const prev = data.previousMonth;
  const targets = [...(prev ? toTargets(prev.milestones, prev.monthKey) : []), ...toTargets(data.milestones, data.monthKey)];

  // Thưởng cộng Điểm Xanh (lô thường): làm mới số điểm ở hub/Ví/Điểm Xanh (['loyalty']).
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['affiliate-milestones'] });
    void qc.invalidateQueries({ queryKey: ['loyalty'] });
  };

  const claimOne = useMutation({
    mutationFn: (t: ClaimTarget) => claimCtvMilestone(t.id, t.month),
    onMutate: () => setFailures([]),
    onSuccess: (res) => {
      haptic('heavy');
      openSnackbar({ text: res.message || 'Đã nhận thưởng mốc thành công!', type: 'success' });
      refresh();
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Lỗi "đã nhận"/"chưa đạt" → trạng thái trên máy đã cũ, tải lại để nút khớp backend.
      void qc.invalidateQueries({ queryKey: ['affiliate-milestones'] });
    },
  });

  const claimAll = useMutation({
    mutationFn: async (list: ClaimTarget[]) => {
      const failed: ClaimFailure[] = [];
      for (const t of list) {
        try {
          await claimCtvMilestone(t.id, t.month);
        } catch (e) {
          failed.push({ title: t.title, message: getErrorMessage(e) });
        }
      }
      return { total: list.length, failed };
    },
    onMutate: () => setFailures([]),
    onSuccess: ({ total, failed }) => {
      setFailures(failed);
      const done = total - failed.length;
      if (done > 0) haptic('heavy');
      if (failed.length === 0) openSnackbar({ text: `Đã nhận ${done} mốc thưởng.`, type: 'success' });
      else if (done === 0) openSnackbar({ text: 'Chưa nhận được mốc nào. Xem lý do bên dưới.', type: 'error' });
      else
        openSnackbar({
          text: `Đã nhận ${done}/${total} mốc. Có ${failed.length} mốc chưa nhận được, xem bên dưới.`,
          type: 'warning',
        });
      refresh();
    },
  });

  if (data.milestones.length === 0 && targets.length === 0) return null;

  const busy = claimOne.isPending || claimAll.isPending;
  const totalPoints = targets.reduce((s, t) => s + t.points, 0);

  const renderRow = (m: CtvMilestoneItem, month: string, revenue: number) => (
    <div
      key={`${month}:${m.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        padding: '8px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-sm" as="div" style={BOLD}>
          {m.title}
        </Text>
        <Text variant="caption" tone="tertiary" as="div">
          {milestoneStatusText(m, revenue)}
        </Text>
        {!m.achieved && (
          <div style={{ marginTop: 6 }}>
            <ProgressBar value={m.progressPct} max={100} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <Text variant="body-sm" tone="brand" style={BOLD}>
          +{formatPoints(m.rewardPoints)}
        </Text>
        {m.canClaim ? (
          <Button
            icon={Check}
            disabled={busy}
            loading={claimOne.isPending && claimOne.variables?.id === m.id && claimOne.variables?.month === month}
            onPress={() => claimOne.mutate({ id: m.id, month, title: m.title, points: m.rewardPoints })}
          >
            Nhận thưởng
          </Button>
        ) : m.claimed ? (
          <Badge size="sm">Đã nhận</Badge>
        ) : null}
      </div>
    </div>
  );

  return (
    <Card padding={16} style={{ margin: '0 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: 'var(--radius-control)',
            background: 'var(--color-action-secondary-bg)',
          }}
        >
          <Icon icon={Trophy} size="md" tone="brand" />
        </div>
        <div>
          <Text variant="body-sm" as="div" style={BOLD}>
            Thưởng mốc doanh số tháng
          </Text>
          <Text variant="caption" tone="tertiary" as="div">
            {monthLabel(data.monthKey)} · Đã chốt {formatVnd(data.currentRevenue)}
          </Text>
        </div>
      </div>

      <Text variant="caption" tone="tertiary" as="div" style={{ marginBottom: 4 }}>
        {revenueRuleText(data.holdDays)}
      </Text>
      {data.pendingRevenue > 0 && (
        <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 8 }}>
          Đang chờ chốt: <b>{formatVnd(data.pendingRevenue)}</b> (đơn chưa giao hoặc đang trong thời gian giữ đổi/trả — chưa tính vào mốc)
        </Text>
      )}

      {targets.length >= 2 && (
        <Button
          fullWidth
          icon={Check}
          loading={claimAll.isPending}
          disabled={claimOne.isPending}
          onPress={() => claimAll.mutate(targets)}
          style={{ marginBottom: 8 }}
        >
          {`Nhận tất cả (${targets.length} mốc, +${formatPoints(totalPoints)})`}
        </Button>
      )}

      {failures.length > 0 && (
        <div role="alert" style={{ marginBottom: 8 }}>
          {failures.map((f) => (
            <Text key={f.title} variant="caption" tone="danger" as="div">
              {f.title}: {f.message}
            </Text>
          ))}
        </div>
      )}

      {prev && (
        <div>
          <Text variant="caption" tone="brand" as="div" style={{ ...BOLD, marginTop: 8 }}>
            Thưởng {monthLabel(prev.monthKey)} chưa nhận — nhận trước khi hết {monthLabel(data.monthKey)}
          </Text>
          {prev.milestones.map((m) => renderRow(m, prev.monthKey, prev.revenue))}
        </div>
      )}
      <div>{data.milestones.map((m) => renderRow(m, data.monthKey, data.currentRevenue))}</div>
    </Card>
  );
}
