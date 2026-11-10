import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { Check } from 'lucide-react';
import { claimQuest, type QuestList as QuestData } from '../../services/storefront-api';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { formatPoints } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { vi } from '../../i18n/vi';
import { useLockedMutation } from '../game/use-locked-mutation';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { ProgressBar } from '../ui/progress-bar';
import { Text } from '../ui/text';

/** Chuỗi nhiệm vụ early-win thưởng Điểm Xanh, nằm trong sheet mở từ dải Hành trình. Nút nhận là nút phụ: màn dựng chỉ có một nút chính (thanh dính). */
export function QuestList({ data }: { data: QuestData }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  // Một lần nhận mỗi lúc cho cả danh sách (các nút khác đã bị `disabled` sau lần vẽ kế): ref chặn cú chạm thứ hai cùng nhịp, kể cả sang nhiệm vụ khác.
  const claimMut = useLockedMutation({
    mutationFn: (code: string) => claimQuest(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: `+${formatPoints(r.rewardPoints)} 🎉`, type: 'success' });
      // Trả Promise: khoá nhả sau khi danh sách tải lại, không thì nút "Nhận" sáng lại trên dữ liệu cũ và cú chạm kế hiện thêm lời báo điểm.
      return qc.invalidateQueries({ queryKey: ['storefront-quests'] });
    },
    // Máy chủ từ chối (nhiệm vụ đã nhận ở máy khác, chưa đạt...): tải lại danh sách rồi mới nhả khoá, kẻo nút "Nhận" còn sáng trên dữ liệu cũ. Mất mạng, quá hạn, 401, 5xx: nhả ngay, không tải lại.
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      return isStaleStateError(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['storefront-quests'] })) : undefined;
    },
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
