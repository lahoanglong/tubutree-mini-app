'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CASH_WORDING_MESSAGE, findCashWording, type WasteDeskPointDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, submitDeskPerk } from '@tubutree/app-core/api/waste';
import { deskPointReportQuery } from '@tubutree/app-core/queries/waste';
import { friendlyError as errText } from '@/lib/friendly-error';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { formatPoints } from './recycle-labels';

const PERK_TITLE = 'Ưu đãi riêng của cửa hàng';
const CARD = `flex flex-col gap-1.5 p-4 max-md:gap-1 max-md:p-3 ${skin.card}`;

/** Tháng 'YYYY-MM' theo giờ VN, không phụ thuộc múi giờ máy. */
export function vnMonthKey(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
}

export function WasteDeskPerk({ point }: { point: WasteDeskPointDTO }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const submit = useMutation({
    mutationFn: (v: string) => submitDeskPerk(coreHttp, point.id, { perkText: v.trim() }),
    onSuccess: () => {
      setSent(true);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.desk });
    },
  });

  const cashProblem = findCashWording(text) !== null;

  if (point.kind === 'WAREHOUSE') return null;

  return (
    <section aria-label={PERK_TITLE} className={CARD}>
      <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{PERK_TITLE}</p>
      <p className="text-sm text-stone-600">Cửa hàng tự chịu, không liên quan Điểm Xanh</p>
      <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{point.perkText ?? 'Chưa có ưu đãi'}</p>
      {point.perkPendingText && <p className="text-sm text-stone-600">{`Đang chờ Tubu duyệt: ${point.perkPendingText}`}</p>}
      {sent && (
        <p role="status" className="text-sm font-semibold text-success-fg">
          Đã gửi, chờ Tubu duyệt
        </p>
      )}
      {point.myRole === 'OWNER' && (
        <div>
          <button
            type="button"
            className={skin.btnSecondary}
            onClick={() => {
              setText(point.perkPendingText ?? point.perkText ?? '');
              setSent(false);
              submit.reset();
              setOpen(true);
            }}
          >
            Chỉnh sửa
          </button>
        </div>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={PERK_TITLE}
        footer={
          <button
            type="button"
            className={`${ui.btnPrimary} w-full`}
            disabled={text.trim() === '' || cashProblem || submit.isPending}
            onClick={() => submit.mutate(text)}
          >
            Gửi duyệt
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <Field label="Nội dung ưu đãi">
            <input maxLength={200} value={text} onChange={(e) => setText(e.target.value)} className={ui.field} />
          </Field>
          {cashProblem && (
            <p role="alert" className={ui.error}>
              {CASH_WORDING_MESSAGE}
            </p>
          )}
          {submit.isError && (
            <p role="alert" className={ui.error}>
              {errText(submit.error)}
            </p>
          )}
        </div>
      </Sheet>
    </section>
  );
}

export function WasteDeskReport({ pointId }: { pointId: string }) {
  const month = vnMonthKey(new Date());
  const q = useQuery(deskPointReportQuery(coreHttp, pointId, month));

  if (q.isError) {
    return (
      <section aria-label="Báo cáo tháng này" className={CARD}>
        <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">Chưa tải được báo cáo</p>
        <div>
          <button type="button" className={skin.btnSecondary} onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </div>
      </section>
    );
  }
  if (!q.data) return null;
  const r = q.data;
  return (
    <section aria-label="Báo cáo tháng này" className={CARD}>
      <p className="text-sm text-stone-600">Báo cáo tháng này</p>
      <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{`${formatCount(r.confirmations)} lượt xác nhận`}</p>
      <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{`Tubu đã cộng ${formatPoints(r.pointsAwarded)} cho khách`}</p>
      {r.units.map((u) => (
        <p key={u.itemId} className="text-sm text-stone-600">{`${u.itemName}: ${formatCount(u.qty)} ${u.unitLabel}`}</p>
      ))}
    </section>
  );
}
