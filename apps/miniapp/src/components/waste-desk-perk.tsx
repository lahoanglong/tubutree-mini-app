import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CASH_WORDING_MESSAGE, findCashWording, type WasteDeskPointDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, getDeskPointReport, submitDeskPerk } from '../services/waste-api';
import { getErrorMessage } from '../services/api';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Field } from './ui/form';
import { Text } from './ui/text';
import { formatNumber, formatPoints } from '../utils/format';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;
const PERK_TITLE = 'Ưu đãi riêng của cửa hàng';

/** Tháng 'YYYY-MM' theo giờ VN, không phụ thuộc múi giờ máy. */
export function vnMonthKey(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}

export function WasteDeskPerk({ point }: { point: WasteDeskPointDTO }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const submit = useMutation({
    mutationFn: (v: string) => submitDeskPerk(point.id, { perkText: v.trim() }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã gửi, chờ Tubu duyệt', type: 'success' });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.desk });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const cashProblem = findCashWording(text) !== null;

  if (point.kind === 'WAREHOUSE') return null;

  return (
    <Card>
      <div style={{ ...COLUMN, gap: 6 }}>
        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{PERK_TITLE}</Text>
        <Text variant="body-sm" tone="secondary" as="div">Cửa hàng tự chịu, không liên quan Điểm Xanh</Text>
        <Text variant="body-md" as="div">{point.perkText ?? 'Chưa có ưu đãi'}</Text>
        {point.perkPendingText && (
          <Text variant="body-sm" tone="secondary" as="div">{`Đang chờ Tubu duyệt: ${point.perkPendingText}`}</Text>
        )}
        {point.myRole === 'OWNER' && (
          <div>
            <Button
              variant="secondary"
              onPress={() => {
                setText(point.perkPendingText ?? point.perkText ?? '');
                setOpen(true);
              }}
            >
              Chỉnh sửa
            </Button>
          </div>
        )}
      </div>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={PERK_TITLE}
        footer={
          <Button fullWidth disabled={text.trim() === '' || cashProblem} loading={submit.isPending} onPress={() => submit.mutate(text)}>
            Gửi duyệt
          </Button>
        }
      >
        <Field label="Nội dung ưu đãi">
          <Input maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {cashProblem && (
          <div role="alert" style={{ marginTop: 8 }}>
            <Text variant="caption" tone="danger" as="div">{CASH_WORDING_MESSAGE}</Text>
          </div>
        )}
      </BottomSheet>
    </Card>
  );
}

export function WasteDeskReport({ pointId }: { pointId: string }) {
  const month = vnMonthKey(new Date());
  const q = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.desk, 'report', pointId, month],
    queryFn: () => getDeskPointReport(pointId, month),
  });

  if (q.isError) {
    return (
      <Card>
        <div style={{ ...COLUMN, gap: 6 }}>
          <Text variant="body-md" as="div">Chưa tải được báo cáo</Text>
          <div>
            <Button variant="secondary" onPress={() => void q.refetch()}>Thử lại</Button>
          </div>
        </div>
      </Card>
    );
  }
  if (!q.data) return null;
  const r = q.data;
  return (
    <Card>
      <div style={{ ...COLUMN, gap: 4 }}>
        <Text variant="body-sm" tone="secondary" as="div">Báo cáo tháng này</Text>
        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{`${formatNumber(r.confirmations)} lượt xác nhận`}</Text>
        <Text variant="body-md" as="div">{`Tubu đã cộng ${formatPoints(r.pointsAwarded)} cho khách`}</Text>
        {r.units.map((u) => (
          <Text key={u.itemId} variant="body-sm" tone="secondary" as="div">{`${u.itemName}: ${formatNumber(u.qty)} ${u.unitLabel}`}</Text>
        ))}
      </div>
    </Card>
  );
}
