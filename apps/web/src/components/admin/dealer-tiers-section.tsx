'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDealerTier,
  diffTier,
  emptyTierForm,
  formatTerms,
  formatTierPct,
  listDealerTierHistory,
  listDealerTiersForEdit,
  parseTierForm,
  tierToForm,
  updateDealerTier,
  type DealerTierRow,
  type TierFormInput,
  type TierValues,
} from '@/lib/dealer-accounts-client';
import { ApiError } from '@/lib/client-api';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, Field, INPUT_CLASS, LoadError, Notice, TOUCH_H } from './ui';

type Mode = { kind: 'create' } | { kind: 'edit'; id: string; baseline: TierValues };
interface SaveInput {
  creating: boolean;
  id: string;
  values: TierValues;
  baseline?: TierValues;
}
const baselineOf = (t: DealerTierRow): TierValues => ({
  name: t.name,
  minOrderVolume: t.minOrderVolume,
  discountPct: t.discountPct,
  creditLimit: t.creditLimit,
  paymentTerms: t.paymentTerms,
});

const INPUT = `${INPUT_CLASS} ${TOUCH_H}`;

/**
 * Bậc đại lý (chiết khấu, hạn mức công nợ, điều kiện thanh toán). Chỉ ADMIN sửa được: API chặn 403 với vai trò khác và kiểm
 * lại mọi luật (trần chiết khấu dealer.max_discount_pct, khoảng giá trị); form chỉ kiểm sớm để báo lỗi ngay. Mỗi lần
 * tạo/sửa được ghi vào lịch sử (ai, lúc nào, từ gì sang gì).
 */
export function DealerTiersSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-dealer-tiers', 'manage'], queryFn: listDealerTiersForEdit });
  const [mode, setMode] = useState<Mode | null>(null);
  const [form, setForm] = useState<TierFormInput>(emptyTierForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const histQ = useQuery({ queryKey: ['admin-dealer-tier-history'], queryFn: listDealerTierHistory, enabled: histOpen });

  const tiers = q.data?.tiers ?? [];
  const maxPct = q.data?.maxDiscountPct ?? 0;
  const creating = mode?.kind === 'create';

  const open = (m: Mode, f: TierFormInput) => {
    setMode(m);
    setForm(f);
    setErrors([]);
    setSaved(null);
    setStale(false);
  };
  const close = () => {
    setMode(null);
    setErrors([]);
    setStale(false);
  };
  /** Bỏ phần đang gõ, nạp giá trị hiện tại của bậc (sau khi người khác sửa) làm phiên bản mới để sửa tiếp. */
  const reload = async (id: string) => {
    const fresh = (await q.refetch()).data?.tiers.find((t) => t.id === id);
    if (fresh) open({ kind: 'edit', id, baseline: baselineOf(fresh) }, tierToForm(fresh));
  };
  const set = (k: keyof TierFormInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (v: SaveInput) =>
      v.creating ? createDealerTier({ id: v.id, ...v.values }) : updateDealerTier(v.id, v.values, v.baseline as TierValues),
    onSuccess: (_r, v) => {
      setSaved(`${v.creating ? 'Đã tạo' : 'Đã lưu'} bậc ${v.values.name}.`);
      setMode(null);
      setErrors([]);
      void qc.invalidateQueries({ queryKey: ['admin-dealer-tiers'] });
      void qc.invalidateQueries({ queryKey: ['admin-dealer-tier-history'] });
      void qc.invalidateQueries({ queryKey: ['admin-dealer-accounts'] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 409 && mode?.kind === 'edit') {
        setStale(true);
        setErrors(['Bậc này vừa được người khác sửa — tải lại.']);
        void qc.invalidateQueries({ queryKey: ['admin-dealer-tiers'] });
        return;
      }
      setErrors([e instanceof Error ? e.message : 'Lưu bậc thất bại.']);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode || inFlight.current || save.isPending) return;
    const parsed = parseTierForm(form, maxPct, creating);
    if ('errors' in parsed) {
      setErrors(parsed.errors);
      return;
    }
    const { id, ...values } = parsed.value;
    if (mode.kind === 'edit') {
      const before = tiers.find((t) => t.id === mode.id);
      const lines = diffTier(mode.baseline, values);
      if (lines.length === 0) {
        setErrors(['Không có thay đổi nào để lưu.']);
        return;
      }
      const ok = await confirm({
        title: 'Lưu thay đổi bậc đại lý',
        message:
          `Bậc ${before?.name ?? mode.id} (${before?.dealerCount ?? 0} đại lý) sẽ đổi:\n` +
          lines.map((l) => `• ${l}`).join('\n') +
          '\n\nÁp cho các đơn đại lý đặt SAU khi lưu; đơn đã đặt giữ nguyên.',
        confirmLabel: 'Lưu thay đổi',
      });
      if (!ok || inFlight.current || save.isPending) return;
    }
    inFlight.current = true;
    setErrors([]);
    save.mutate({ creating: mode.kind === 'create', id: mode.kind === 'edit' ? mode.id : id, values, baseline: mode.kind === 'edit' ? mode.baseline : undefined });
  };

  return (
    <section aria-label="Bậc đại lý" data-dealer-tiers className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Bậc đại lý</h2>
        {q.data && tiers.length > 0 && !mode && (
          <button type="button" className={BTN_SECONDARY} onClick={() => open({ kind: 'create' }, emptyTierForm())}>
            Thêm bậc
          </button>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-stone-500">Đang tải bậc đại lý…</p>}
      {q.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          Không tải được bậc đại lý{q.error instanceof Error && q.error.message ? ` (${q.error.message})` : ''}.{' '}
          <button type="button" className={`${BTN_LINK} text-sm`} onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      )}

      {q.data && (
        <p className="text-xs text-stone-600">
          Chiết khấu tối đa {q.data.maxDiscountPct}% (trần cấu hình, không bậc nào đặt cao hơn).
          {q.data.dealersWithoutTier > 0 && <> {q.data.dealersWithoutTier} đại lý chưa được gán bậc.</>}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success-fg">
          {saved}
        </p>
      )}

      {q.isSuccess && tiers.length === 0 && !mode && (
        <div data-dealer-tiers-empty className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-600">
          <p className="font-medium text-stone-800">Chưa có bậc đại lý nào.</p>
          <p className="mt-1 text-xs text-stone-500">Tạo bậc để đặt chiết khấu, hạn mức công nợ và điều kiện thanh toán cho từng nhóm đại lý.</p>
          <button type="button" className={`${BTN_PRIMARY} mt-3`} onClick={() => open({ kind: 'create' }, emptyTierForm())}>
            Tạo bậc đầu tiên
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {tiers.map((t) => (
          <TierItem key={t.id} tier={t} editing={mode?.kind === 'edit' && mode.id === t.id} onEdit={() => open({ kind: 'edit', id: t.id, baseline: baselineOf(t) }, tierToForm(t))} />
        ))}
      </ul>

      {mode && (
        <form onSubmit={onSubmit} noValidate aria-label={creating ? 'Tạo bậc đại lý' : 'Sửa bậc đại lý'} className="space-y-3 rounded-card border border-stone-300 bg-stone-0 p-3">
          <h3 className="text-sm font-semibold text-stone-900">{creating ? 'Tạo bậc đại lý' : `Sửa bậc ${mode.kind === 'edit' ? mode.id : ''}`}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mã bậc" hint={creating ? 'Chữ in hoa, số, gạch dưới; không đổi được sau khi tạo. Ví dụ DEALER_1.' : 'Không đổi được.'}>
              <input aria-label="Mã bậc" value={form.id} onChange={set('id')} readOnly={!creating} maxLength={32} className={INPUT} />
            </Field>
            <Field label="Tên bậc">
              <input aria-label="Tên bậc" value={form.name} onChange={set('name')} maxLength={60} className={INPUT} />
            </Field>
            <Field label="Doanh số tối thiểu (đ)" hint="Doanh số đã chốt để lên bậc này.">
              <input aria-label="Doanh số tối thiểu (đ)" inputMode="numeric" value={form.minOrderVolume} onChange={set('minOrderVolume')} className={INPUT} />
            </Field>
            <Field label="Chiết khấu (%)" hint={`30 nghĩa là 30%. Tối đa ${maxPct}%.`}>
              <input aria-label="Chiết khấu (%)" inputMode="decimal" value={form.discountPct} onChange={set('discountPct')} className={INPUT} />
            </Field>
            <Field label="Hạn mức công nợ (đ)" hint="0 là không cho ghi công nợ.">
              <input aria-label="Hạn mức công nợ (đ)" inputMode="numeric" value={form.creditLimit} onChange={set('creditLimit')} className={INPUT} />
            </Field>
            <Field label="Điều kiện thanh toán" hint="PREPAID (trả trước) hoặc NET 30 (công nợ 30 ngày). Để trống nếu chưa đặt.">
              <input aria-label="Điều kiện thanh toán" value={form.paymentTerms} onChange={set('paymentTerms')} placeholder="PREPAID hoặc NET 30" maxLength={10} className={INPUT} />
            </Field>
          </div>
          {errors.length > 0 && (
            <div role="alert">
              <Notice tone="danger">
                <ul className="list-disc space-y-0.5 pl-4">
                  {errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          )}
          {stale && mode.kind === 'edit' && (
            <button type="button" className={BTN_SMALL} onClick={() => void reload(mode.id)}>
              Tải lại giá trị mới
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={save.isPending} className={BTN_PRIMARY}>
              {save.isPending ? 'Đang lưu…' : 'Lưu bậc'}
            </button>
            <button type="button" onClick={close} disabled={save.isPending} className={BTN_SECONDARY}>
              Huỷ
            </button>
          </div>
        </form>
      )}

      <div>
        <button type="button" aria-expanded={histOpen} onClick={() => setHistOpen((v) => !v)} className={BTN_SMALL}>
          Lịch sử thay đổi bậc
        </button>
        {histOpen && (
          <div className="mt-2 space-y-2">
            {histQ.isLoading && <p className="text-sm text-stone-500">Đang tải lịch sử…</p>}
            {histQ.isError && <LoadError onRetry={() => void histQ.refetch()} retrying={histQ.isFetching}>Không tải được lịch sử bậc.</LoadError>}
            {histQ.isSuccess && histQ.data.length === 0 && <p className="text-sm text-stone-500">Chưa có thay đổi nào.</p>}
            <ul className="space-y-2">
              {histQ.data?.map((h) => (
                <li key={h.id} data-dealer-tier-history className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs text-stone-700">
                  <div className="font-medium text-stone-900">
                    {h.action === 'CREATE' ? 'Tạo' : 'Sửa'} bậc {h.tierId}
                  </div>
                  <div className="text-stone-500">
                    {h.changedBy.fullName ?? h.changedBy.phone ?? h.changedBy.id} · {formatDateTime(h.changedAt)}
                  </div>
                  <div className="mt-1 break-words">{diffTier(h.oldValue, h.newValue).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {dialog}
    </section>
  );
}

function TierItem({ tier: t, editing, onEdit }: { tier: DealerTierRow; editing: boolean; onEdit: () => void }) {
  return (
    <li data-dealer-tier className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-semibold text-stone-900">{t.name}</div>
          <div className="font-mono text-[11px] text-stone-500">{t.id}</div>
        </div>
        <button type="button" onClick={onEdit} disabled={editing} aria-label={`Sửa bậc ${t.name}`} className={BTN_SMALL}>
          Sửa
        </button>
      </div>
      <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-2">
        <div>
          <dt className="inline">Chiết khấu: </dt>
          <dd className="inline font-semibold text-stone-900">{formatTierPct(t.discountPct)}</dd>
        </div>
        <div>
          <dt className="inline">Hạn mức công nợ: </dt>
          <dd className="inline font-semibold text-stone-900">{formatVnd(t.creditLimit)}</dd>
        </div>
        <div>
          <dt className="inline">Doanh số tối thiểu: </dt>
          <dd className="inline">{formatVnd(t.minOrderVolume)}</dd>
        </div>
        <div>
          <dt className="inline">Điều kiện thanh toán: </dt>
          <dd className="inline">{formatTerms(t.paymentTerms)}</dd>
        </div>
      </dl>
      <div className="mt-1 text-xs text-stone-500">{t.dealerCount} đại lý đang ở bậc này</div>
    </li>
  );
}
