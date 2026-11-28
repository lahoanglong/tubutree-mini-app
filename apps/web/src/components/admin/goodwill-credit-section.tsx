'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { GOODWILL_GIFT_LABEL, GOODWILL_MAX_PER_GRANT, GOODWILL_REASON_MAX, GOODWILL_REASON_MIN, type GoodwillKind } from '@tubutree/shared-types';
import { grantGoodwillCredit, listGoodwillCredits } from '@/lib/admin-client';
import { actionErrorText } from '@/lib/admin-error-text';
import { formatCount } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import { newIdempotencyKey } from '@/lib/order-key-ring';
import { settleWithin } from '@/lib/settle-within';
import { formatVnd } from '@/lib/shop-client';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, LoadError, Notice } from './ui';

const BUSY_CLASS = 'aria-disabled:opacity-60';
const RECENT_SHOWN = 5;

const KIND_LABEL: Record<GoodwillKind, string> = { POINTS: 'Điểm Xanh', WALLET: 'Ví Tubu' };
export const goodwillAmountText = (kind: GoodwillKind, amount: number) => (kind === 'POINTS' ? `${formatCount(amount)} Điểm Xanh` : formatVnd(amount));

export interface GoodwillDraft {
  kind: GoodwillKind;
  amount: string;
  reason: string;
  orderCode: string;
}
const EMPTY: GoodwillDraft = { kind: 'POINTS', amount: '', reason: '', orderCode: '' };

/** Lỗi nhập bắt trước khi hỏi xác nhận; máy chủ kiểm lại cùng các trần này (DTO + dịch vụ). */
export function goodwillDraftError(d: GoodwillDraft, remainingToday: number): string | null {
  const amount = Number(d.amount);
  if (!/^\d+$/.test(d.amount) || amount < 1) return 'Nhập số tặng là số nguyên lớn hơn 0.';
  if (amount > GOODWILL_MAX_PER_GRANT) return `Mỗi lần tặng tối đa ${formatCount(GOODWILL_MAX_PER_GRANT)}.`;
  if (amount > remainingToday) return `Hôm nay bạn chỉ còn tặng được ${formatCount(Math.max(0, remainingToday))}.`;
  if (d.reason.trim().length < GOODWILL_REASON_MIN) return `Lý do cần ít nhất ${GOODWILL_REASON_MIN} ký tự.`;
  return null;
}

/**
 * "Tặng thiện chí" ở hồ sơ khách, chỉ ADMIN: Điểm Xanh (lô thường, hết hạn như điểm đơn hàng) hoặc tiền vào Ví Tubu.
 * Khách chỉ thấy dòng "Quà tặng từ Tubu Tree"; lý do nội bộ nằm ở nhật ký quản trị và danh sách dưới đây.
 * Khoá Idempotency-Key chỉ đổi khi lần gửi trước có kết quả chắc chắn: tặng xong, hoặc máy chủ từ chối 4xx (không ghi gì). Mất mạng hay 5xx
 * thì chưa biết sổ đã ghi chưa: khoá bị ghim (sửa số hay lý do rồi gửi vẫn dùng khoá cũ, máy chủ trả kết quả cũ hoặc 409, không cộng lần hai)
 * và danh sách lần tặng tải lại để thấy lần đó đã vào chưa.
 */
export function GoodwillCreditSection({ userId, customerName, orderCodes }: { userId: string; customerName: string; orderCodes: string[] }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState<GoodwillDraft | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const keyRef = useRef<{ sig: string; key: string; pinned: boolean } | null>(null);
  const listQ = useQuery({ queryKey: ['admin-goodwill-credits', userId], queryFn: () => listGoodwillCredits(userId) });
  // Khoá giữ tới khi sổ Ví/Điểm của hồ sơ và danh sách lần tặng cùng về: nhả sớm thì hạn mức hôm nay còn số cũ.
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['admin-user-detail', userId] }), qc.invalidateQueries({ queryKey: ['admin-goodwill-credits', userId] })]);
  const grant = useLockedMutation({
    mutationFn: ({ body, key }: { body: { kind: GoodwillKind; amount: number; reason: string; orderCode?: string }; key: string }) => grantGoodwillCredit(userId, body, key),
    onSuccess: (r) => {
      keyRef.current = null;
      setDraft(null);
      setMsg({
        tone: 'success',
        text: r.replayed
          ? `Lần tặng ${goodwillAmountText(r.kind, r.amount)} này đã ghi trước đó, không cộng thêm.`
          : `Đã tặng ${goodwillAmountText(r.kind, r.amount)}. Khách thấy dòng "${GOODWILL_GIFT_LABEL}".`,
      });
      return settleWithin(refresh());
    },
    onError: (e) => {
      const status = errorStatus(e);
      if (status !== undefined && status >= 400 && status < 500) {
        keyRef.current = null;
        setMsg({ tone: 'danger', text: actionErrorText(e) });
        return reloadWhenStale(e, refresh, true);
      }
      if (keyRef.current) keyRef.current.pinned = true;
      setMsg({
        tone: 'danger',
        text: `${actionErrorText(e)} Chưa rõ lần tặng đã ghi hay chưa: xem "Lần tặng gần nhất" bên dưới. Bấm lại vẫn dùng cùng mã chống trùng nên không cộng hai lần.`,
      });
      return settleWithin(refresh());
    },
  });

  const data = listQ.data;
  const remaining = data ? data.dailyCap - data.dailyUsed : 0;

  const submit = async (d: GoodwillDraft) => {
    if (grant.isPending || !data) return;
    const err = goodwillDraftError(d, remaining);
    if (err) {
      setMsg({ tone: 'danger', text: err });
      return;
    }
    setMsg(null);
    const body = { kind: d.kind, amount: Number(d.amount), reason: d.reason.trim(), ...(d.orderCode ? { orderCode: d.orderCode } : {}) };
    const ok = await confirm({
      title: `Tặng ${goodwillAmountText(body.kind, body.amount)}?`,
      message: `${customerName} nhận ngay vào ${KIND_LABEL[body.kind]}${body.orderCode ? ` (gắn đơn ${body.orderCode})` : ''} và thấy dòng "${GOODWILL_GIFT_LABEL}". Lý do chỉ lưu ở nhật ký quản trị. Không có nút hoàn tác.`,
      confirmLabel: 'Tặng',
    });
    if (!ok) return;
    const sig = JSON.stringify(body);
    if (!keyRef.current || (!keyRef.current.pinned && keyRef.current.sig !== sig)) keyRef.current = { sig, key: newIdempotencyKey(), pinned: false };
    grant.mutate({ body, key: keyRef.current.key });
  };

  let content: ReactNode;
  if (listQ.isPending) content = <p className="text-stone-500">Đang tải…</p>;
  else if (!data)
    content = (
      <LoadError onRetry={() => listQ.refetch()} retrying={listQ.isFetching}>
        Không tải được hạn mức tặng.
      </LoadError>
    );
  else
    content = (
      <>
        <p data-goodwill-quota className="text-xs tabular-nums text-stone-600">
          Hôm nay bạn đã tặng {formatCount(data.dailyUsed)}/{formatCount(data.dailyCap)} (điểm và đồng cộng chung). Mỗi lần tối đa {formatCount(data.perGrantMax)}.
        </p>
        {!draft && (
          <button
            type="button"
            className={`mt-2 ${BTN_SECONDARY}`}
            disabled={remaining <= 0}
            onClick={() => {
              setMsg(null);
              setDraft(EMPTY);
            }}
          >
            {remaining <= 0 ? 'Hết hạn mức hôm nay' : 'Tặng thiện chí'}
          </button>
        )}
        {draft && (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(draft);
            }}
          >
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="sr-only">Tặng gì</legend>
              {(['POINTS', 'WALLET'] as const).map((k) => (
                <label key={k} className="flex min-h-[44px] items-center gap-1.5 sm:min-h-0">
                  <input type="radio" name="goodwill-kind" value={k} checked={draft.kind === k} onChange={() => setDraft({ ...draft, kind: k })} />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <label className="block text-xs">
              <span className="font-medium text-stone-700">{draft.kind === 'POINTS' ? 'Số Điểm Xanh' : 'Số tiền (đ)'}</span>
              <input
                type="number"
                name="goodwill-amount"
                inputMode="numeric"
                min={1}
                max={Math.min(GOODWILL_MAX_PER_GRANT, Math.max(1, remaining))}
                step={1}
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value.trim() })}
                className={`mt-1 ${INPUT_CLASS}`}
              />
            </label>
            {orderCodes.length > 0 && (
              <label className="block text-xs">
                <span className="font-medium text-stone-700">Gắn đơn (tuỳ chọn)</span>
                <select name="goodwill-order" value={draft.orderCode} onChange={(e) => setDraft({ ...draft, orderCode: e.target.value })} className={`mt-1 ${INPUT_CLASS}`}>
                  <option value="">Không gắn đơn</option>
                  {orderCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs">
              <span className="font-medium text-stone-700">Lý do nội bộ (khách không thấy)</span>
              <textarea
                name="goodwill-reason"
                rows={2}
                maxLength={GOODWILL_REASON_MAX}
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="VD: giao trễ 3 ngày, khách đã chờ lâu"
                className={`mt-1 ${INPUT_CLASS}`}
              />
              <span className="mt-0.5 block text-right tabular-nums text-stone-500">
                {draft.reason.trim().length}/{GOODWILL_REASON_MAX} (ít nhất {GOODWILL_REASON_MIN})
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={`${BTN_PRIMARY} ${BUSY_CLASS}`} aria-busy={grant.isPending || undefined} aria-disabled={grant.isPending || undefined}>
                {grant.isPending ? 'Đang tặng…' : 'Tặng…'}
              </button>
              <button type="button" className={BTN_SECONDARY} disabled={grant.isPending} onClick={() => setDraft(null)}>
                Huỷ
              </button>
            </div>
          </form>
        )}
        {data.items.length > 0 && (
          <ul data-goodwill-recent className="mt-2 divide-y divide-stone-100" aria-label="Lần tặng gần nhất">
            {data.items.slice(0, RECENT_SHOWN).map((it) => (
              <li key={it.id} className="py-1.5">
                <span className="flex justify-between gap-x-2">
                  <span className="font-medium text-success-fg">+{goodwillAmountText(it.kind, it.amount)}</span>
                  <span className="shrink-0 text-xs text-stone-500">{formatDateTime(it.createdAt)}</span>
                </span>
                <span className="block break-words text-xs text-stone-600">
                  {it.actorName ?? 'Quản trị viên'}
                  {it.orderCode && ` · đơn ${it.orderCode}`} · {it.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );

  return (
    <section aria-label="Tặng thiện chí" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Tặng thiện chí</h3>
      <div className="mt-2 text-sm">
        {content}
        {msg && (
          <div className="mt-2">
            <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
              {msg.text}
            </Notice>
          </div>
        )}
      </div>
      {dialog}
    </section>
  );
}
