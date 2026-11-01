import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { Check } from 'lucide-react';
import { claimQuest, type QuestList as QuestData } from '../../services/storefront-api';
import { getErrorMessage } from '../../services/api';
import { formatPoints } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';

/** Chuỗi nhiệm vụ early-win thưởng Điểm Xanh, nằm trong sheet mở từ dải Hành trình. Nút nhận là nút phụ: màn dựng chỉ có một nút chính (thanh dính). */
export function QuestList({ data }: { data: QuestData }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const claimMut = useMutation({
    mutationFn: (code: string) => claimQuest(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: `+${formatPoints(r.rewardPoints)} 🎉`, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['storefront-quests'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <div style={{ maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text variant="caption" tone="brand">Đã nhận {formatPoints(data.totalEarnedPoints)}</Text>
        <Text variant="caption" tone="tertiary">{data.level}/{data.levelMax}</Text>
      </div>
      {data.quests.map((q) => {
        // Guard chia-0: goal=0 (nhiệm vụ đã đạt sẵn) → 0/0=NaN hoặc x/0=Infinity → width lỗi. Đạt ngay = 100%.
        const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 100;
        return (
          <div key={q.code} style={{ padding: '8px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-sm" as="div" style={{ opacity: q.claimed ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {q.claimed && <Icon icon={Check} size="sm" tone="brand" />}
                  {q.title}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">{q.hint}</Text>
              </div>
              {q.claimed ? (
                <Badge tone="success" size="sm">Đã nhận</Badge>
              ) : q.done ? (
                <Button
                  variant="secondary"
                  loading={claimMut.isPending && claimMut.variables === q.code}
                  disabled={claimMut.isPending && claimMut.variables !== q.code}
                  onPress={() => claimMut.mutate(q.code)}
                >
                  {vi.storefront.claimQuest(formatPoints(q.rewardPoints))}
                </Button>
              ) : (
                <Text variant="caption" tone="tertiary" style={{ whiteSpace: 'nowrap' }}>{q.progress}/{q.goal}</Text>
              )}
            </div>
            <div style={{ marginTop: 6 }}>
              <ProgressBar value={pct} max={100} ariaLabel={`${q.title}: tiến độ nhiệm vụ`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
