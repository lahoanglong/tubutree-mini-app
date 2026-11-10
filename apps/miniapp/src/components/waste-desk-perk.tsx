import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLockedMutation } from './game/use-locked-mutation';
import { cashWordingMessage, findCashWording, type WasteDeskPointDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, getDeskPointReport, submitDeskPerk } from '../services/waste-api';
import { getErrorMessage, isStaleStateError } from '../services/api';
import { settleWithin } from '../utils/settle-within';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Field } from './ui/form';
import { Text } from './ui/text';
import { formatNumber, formatPoints } from '../utils/format';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;
const PERK_TITLE = 'Ưu đãi riêng của cửa hàng';
const REPORT_TITLE = 'Báo cáo tháng này';

/** Tháng 'YYYY-MM' theo giờ VN, không phụ thuộc múi giờ máy. */
export function vnMonthKey(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}

export function WasteDeskPerk({ point }: { point: WasteDeskPointDTO }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const submit = useLockedMutation({
    mutationFn: (v: string) => submitDeskPerk(point.id, { perkText: v.trim() }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã gửi, chờ Tubu duyệt', type: 'success' });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.desk });
    },
    // Trả Promise: sheet giữ bận tới khi thẻ điểm tải lại xong (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm gửi lại trên ưu đãi cũ. Lỗi tạm thì nhả ngay.
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      if (!isStaleStateError(e)) return undefined;
      return settleWithin(qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.desk }));
    },
  });
  const busy = submit.isPending;

  const cashProblem = findCashWording(text) !== null;

  if (point.kind === 'WAREHOUSE') return null;

  return (
    <section aria-label={PERK_TITLE}>
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
                  if (open || busy) return;
                  setText(point.perkPendingText ?? point.perkText ?? '');
                  submit.reset();
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
          dismissible={!busy}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          title={PERK_TITLE}
          footer={
            <Button
              fullWidth
              disabled={text.trim() === '' || cashProblem}
              loading={busy}
              onPress={() => {
                if (busy || text.trim() === '' || cashProblem) return;
                submit.mutate(text);
              }}
            >
              Gửi duyệt
            </Button>
          }
        >
          <Field label="Nội dung ưu đãi">
            <Input
              maxLength={200}
              value={text}
              disabled={busy}
              onChange={(e) => {
                if (busy) return;
                submit.reset();
                setText(e.target.value);
              }}
            />
          </Field>
          {cashProblem && (
            <div role="alert" style={{ marginTop: 8 }}>
              <Text variant="caption" tone="danger" as="div">{cashWordingMessage(text)}</Text>
            </div>
          )}
          {submit.isError && (
            <div role="alert" style={{ marginTop: 'var(--space-stack-sm)' }}>
              <Text variant="caption" tone="danger" as="div">{getErrorMessage(submit.error)}</Text>
            </div>
          )}
        </BottomSheet>
      </Card>
    </section>
  );
}

export function WasteDeskReport({ pointId }: { pointId: string }) {
  const month = vnMonthKey(new Date());
  const q = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.desk, 'report', pointId, month],
    queryFn: () => getDeskPointReport(pointId, month),
  });

  if (q.isError || (!q.data && q.errorUpdateCount > 0)) {
    return (
      <section aria-label={REPORT_TITLE}>
        <Card>
          <div style={{ ...COLUMN, gap: 6 }}>
            <div role="alert">
              <Text variant="body-md" as="div">Chưa tải được báo cáo</Text>
            </div>
            <div>
              <Button
                variant="secondary"
                loading={q.isFetching}
                onPress={() => (q.isFetching ? undefined : q.refetch())}
              >
                Thử lại
              </Button>
            </div>
          </div>
        </Card>
      </section>
    );
  }
  if (!q.data) return null;
  const r = q.data;
  return (
    <section aria-label={REPORT_TITLE}>
      <Card>
        <div style={{ ...COLUMN, gap: 4 }}>
          <Text variant="body-sm" tone="secondary" as="div">{REPORT_TITLE}</Text>
          <Text variant="body-md" as="div" numeric style={{ fontWeight: 600 }}>{`${formatNumber(r.confirmations)} lượt xác nhận`}</Text>
          <Text variant="body-md" as="div" numeric>{`Tubu đã cộng ${formatPoints(r.pointsAwarded)} cho khách`}</Text>
          {r.units.map((u) => (
            <Text key={u.itemId} variant="body-sm" tone="secondary" as="div" numeric>{`${u.itemName}: ${formatNumber(u.qty)} ${u.unitLabel}`}</Text>
          ))}
        </div>
      </Card>
    </section>
  );
}
