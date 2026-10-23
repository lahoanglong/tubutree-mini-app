'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type {
  AdminGiftRedemptionRowDTO, AdminWasteGiftDTO, CouponType, GiftRedemptionsQuery, WasteGiftKind, WasteGiftStatus, WasteGiftUpsertRequest, WasteVoucherSpec,
} from '@tubutree/shared-types';
import {
  cancelGiftRedemption, createWasteGift, fulfilGiftRedemption, listGiftRedemptions, listWasteGifts, reorderWasteGifts, updateWasteGift,
} from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { WASTE_GIFT_KIND_LABELS, WASTE_GIFT_REDEMPTION_STATUS_LABELS, WASTE_GIFT_STATUS_LABELS } from '@/lib/waste-labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_XS_PRIMARY,
  BTN_XS_SECONDARY,
  chipClass,
  FIELD_CLASS,
  FIELD_XS,
  Field,
  INPUT_CLASS,
  Notice,
  ScrollRegion,
  ToneBadge,
  LoadError,
} from './ui';
import type { WasteSeed } from './waste-tab';

const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-middle text-sm text-stone-800';
const STATUSES = Object.keys(WASTE_GIFT_STATUS_LABELS) as WasteGiftStatus[];
const CREATE_KINDS: WasteGiftKind[] = ['VOUCHER', 'SEED_PACK', 'GIFT'];
const VOUCHER_TYPES: { value: CouponType; label: string }[] = [
  { value: 'PERCENT', label: 'Giảm theo %' },
  { value: 'AMOUNT', label: 'Giảm số tiền' },
  { value: 'FREESHIP', label: 'Miễn phí vận chuyển' },
];
const POINTS_MAX = 2_000_000;

interface Form {
  kind: WasteGiftKind;
  name: string;
  description: string;
  label: string;
  pointsCost: string;
  status: WasteGiftStatus;
  imageUrl: string;
  stock: string;
  claimInstructions: string;
  voucherType: CouponType;
  voucherValue: string;
  voucherMinOrder: string;
  voucherMaxDiscount: string;
  voucherValidDays: string;
}

const EMPTY_FORM: Form = {
  kind: 'GIFT', name: '', description: '', label: '', pointsCost: '', status: 'HIDDEN', imageUrl: '', stock: '', claimInstructions: '',
  voucherType: 'PERCENT', voucherValue: '', voucherMinOrder: '', voucherMaxDiscount: '', voucherValidDays: '',
};

const str = (n: number | null) => (n === null ? '' : String(n));
const toForm = (g: AdminWasteGiftDTO): Form => ({
  kind: g.kind, name: g.name, description: g.description ?? '', label: g.label ?? '', pointsCost: String(g.pointsCost), status: g.status,
  imageUrl: g.imageUrl ?? '', stock: str(g.stock), claimInstructions: g.claimInstructions ?? '',
  voucherType: g.voucher?.type ?? 'PERCENT', voucherValue: g.voucher ? String(g.voucher.value) : '', voucherMinOrder: str(g.voucher?.minOrder ?? null),
  voucherMaxDiscount: str(g.voucher?.maxDiscount ?? null), voucherValidDays: g.voucher ? String(g.voucher.validDays) : '',
});

const isInt = (s: string, min: number) => /^\d+$/.test(s.trim()) && Number(s) >= min;
const blankOrInt = (s: string, min: number) => s.trim() === '' || isInt(s, min);
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim());

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (f.name.trim() === '') e.name = 'Nhập tên quà';
  if (f.kind === 'TREE') return e;
  if (!isInt(f.pointsCost, 1) || Number(f.pointsCost) > POINTS_MAX) e.pointsCost = 'Giá điểm từ 1 tới 2.000.000';
  if (!blankOrInt(f.stock, 0)) e.stock = 'Tồn kho là số nguyên không âm (để trống nếu không giới hạn)';
  if (f.kind === 'VOUCHER') {
    if (f.voucherType === 'FREESHIP') {
      if (!blankOrInt(f.voucherValue, 0)) e.voucherValue = 'Giá trị mã là số nguyên không âm';
    } else if (!isInt(f.voucherValue, 1)) e.voucherValue = 'Giá trị mã là số nguyên từ 1';
    if (!blankOrInt(f.voucherMinOrder, 0)) e.voucherMinOrder = 'Đơn tối thiểu là số nguyên không âm hoặc để trống';
    if (!blankOrInt(f.voucherMaxDiscount, 1)) e.voucherMaxDiscount = 'Giảm tối đa là số nguyên từ 1 hoặc để trống';
    if (!isInt(f.voucherValidDays, 1)) e.voucherValidDays = 'Hạn dùng mã là số ngày nguyên từ 1';
  }
  return e;
}

const voucherOf = (f: Form): WasteVoucherSpec => ({
  type: f.voucherType, value: f.voucherValue.trim() === '' ? 0 : Number(f.voucherValue), minOrder: intOrNull(f.voucherMinOrder),
  maxDiscount: intOrNull(f.voucherMaxDiscount), validDays: Number(f.voucherValidDays),
});

type Body = WasteGiftUpsertRequest;

function toBody(f: Form): Body {
  const b: Body = {
    kind: f.kind, name: f.name.trim(), description: textOrNull(f.description), label: textOrNull(f.label), pointsCost: Number(f.pointsCost),
    status: f.status, imageUrl: textOrNull(f.imageUrl), stock: intOrNull(f.stock),
    claimInstructions: f.kind === 'VOUCHER' ? null : textOrNull(f.claimInstructions),
  };
  if (f.kind === 'VOUCHER') b.voucher = voucherOf(f);
  return b;
}

function diffBody(f: Form, base: AdminWasteGiftDTO): Partial<Body> {
  const out: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (f.name.trim() !== base.name) out.name = f.name.trim();
  if (!same(textOrNull(f.imageUrl), base.imageUrl)) out.imageUrl = textOrNull(f.imageUrl);
  if (f.status !== base.status) out.status = f.status;
  if (base.kind === 'TREE') return out as Partial<Body>;
  if (!same(textOrNull(f.description), base.description)) out.description = textOrNull(f.description);
  if (!same(textOrNull(f.label), base.label)) out.label = textOrNull(f.label);
  if (Number(f.pointsCost) !== base.pointsCost) out.pointsCost = Number(f.pointsCost);
  if (!same(intOrNull(f.stock), base.stock)) out.stock = intOrNull(f.stock);
  if (base.kind !== 'VOUCHER' && !same(textOrNull(f.claimInstructions), base.claimInstructions)) out.claimInstructions = textOrNull(f.claimInstructions);
  if (base.kind === 'VOUCHER' && !same(voucherOf(f), base.voucher)) out.voucher = voucherOf(f);
  return out as Partial<Body>;
}

function stockText(stock: number | null): string {
  if (stock === null) return 'Không giới hạn';
  return stock === 0 ? 'Hết hàng' : `Còn ${formatCount(stock)}`;
}

type QueueKey = 'ready' | 'overdue' | 'fulfilled' | 'cancelled';

export const WASTE_GIFT_QUEUE_FILTERS: readonly { key: QueueKey; label: string; query: GiftRedemptionsQuery; adminOnly: boolean }[] = [
  { key: 'ready', label: 'Chờ nhận', query: { status: 'READY' }, adminOnly: false },
  { key: 'overdue', label: 'Quá hạn nhận', query: { status: 'READY', overdue: true }, adminOnly: true },
  { key: 'fulfilled', label: 'Đã trao', query: { status: 'FULFILLED' }, adminOnly: true },
  { key: 'cancelled', label: 'Đã huỷ', query: { status: 'CANCELLED' }, adminOnly: true },
];

const initialQueueKey = (isAdmin: boolean, seed?: WasteSeed | null): QueueKey =>
  isAdmin && seed?.section === 'gifts' && seed.preset === 'overdue' ? 'overdue' : 'ready';

const CANCEL_REASON_MAX = 500;

export function WasteGiftsSection({ isAdmin, seed }: { isAdmin: boolean; seed?: WasteSeed | null }) {
  return (
    <div className="space-y-6">
      <GiftQueue isAdmin={isAdmin} seed={seed} />
      {isAdmin && <GiftCatalogue />}
    </div>
  );
}

type RowAction = { id: string; kind: 'fulfil' | 'cancel' };

function GiftQueue({ isAdmin, seed }: { isAdmin: boolean; seed?: WasteSeed | null }) {
  const qc = useQueryClient();
  const [filterKey, setFilterKey] = useState<QueueKey>(() => initialQueueKey(isAdmin, seed));
  const [action, setAction] = useState<RowAction | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filter = WASTE_GIFT_QUEUE_FILTERS.find((x) => x.key === filterKey && (isAdmin || !x.adminOnly)) ?? WASTE_GIFT_QUEUE_FILTERS[0]!;
  const queue = useQuery({ queryKey: ['admin-waste-gift-redemptions', filter.query], queryFn: () => listGiftRedemptions(filter.query) });
  const rows = queue.data ?? [];

  const close = () => { setAction(null); setCode(''); setReason(''); setRefund(null); };
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['admin-waste-gift-redemptions'] }),
    qc.invalidateQueries({ queryKey: ['admin-waste-gifts'] }),
    qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] }),
  ]);
  const onError = (e: unknown) => { setMsg(null); setErr(e instanceof Error ? e.message : 'Thao tác thất bại.'); };

  const fulfil = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => fulfilGiftRedemption(id, value),
    onSuccess: () => { setErr(null); setMsg('Đã trao quà.'); close(); return refresh(); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: ({ id, why, refundPoints }: { id: string; why: string; refundPoints: boolean }) => cancelGiftRedemption(id, { reason: why, refundPoints }),
    onSuccess: () => { setErr(null); setMsg('Đã huỷ quà.'); close(); return refresh(); },
    onError,
  });

  const open = (id: string, kind: RowAction['kind']) => { close(); setMsg(null); setErr(null); setAction({ id, kind }); };
  const cancelReady = reason.trim() !== '' && reason.trim().length <= CANCEL_REASON_MAX && refund !== null;

  return (
    <section className="space-y-3" aria-label="Quà chờ nhận">
      <h3 className="font-display text-base font-semibold text-stone-900">Quà chờ nhận</h3>
      {isAdmin && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc quà chờ nhận">
          {WASTE_GIFT_QUEUE_FILTERS.map((x) => (
            <button key={x.key} type="button" aria-pressed={filter.key === x.key} className={chipClass(filter.key === x.key)} onClick={() => { setFilterKey(x.key); close(); }}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      {queue.isError && <LoadError onRetry={() => void queue.refetch()} retrying={queue.isFetching}>Không tải được danh sách quà chờ nhận.</LoadError>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      {msg && <p role="status" className="text-sm text-success-fg">{msg}</p>}
      {queue.isSuccess && rows.length === 0 && <p className="text-sm text-stone-600">Không có quà nào trong hàng đợi này.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} data-redemption={r.id} className="space-y-2 rounded-control border border-stone-200 bg-stone-0 p-3 text-sm text-stone-800">
            <RedemptionSummary row={r} />
            {r.status === 'READY' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_XS_SECONDARY} aria-pressed={action?.id === r.id && action.kind === 'fulfil'} onClick={() => open(r.id, 'fulfil')}>Trao</button>
                {isAdmin && <button type="button" className={BTN_XS_SECONDARY} aria-pressed={action?.id === r.id && action.kind === 'cancel'} onClick={() => open(r.id, 'cancel')}>Huỷ</button>}
              </div>
            )}
            {action?.id === r.id && action.kind === 'fulfil' && (
              <div className="space-y-2">
                <Field label="Mã nhận quà QG-"><input name="fulfilCode" className={INPUT_CLASS} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <div className="flex gap-2">
                  <button type="button" className={BTN_XS_PRIMARY} disabled={code.trim() === '' || fulfil.isPending} onClick={() => fulfil.mutate({ id: r.id, value: code.trim() })}>Xác nhận trao</button>
                  <button type="button" className={BTN_XS_SECONDARY} onClick={close}>Đóng</button>
                </div>
              </div>
            )}
            {isAdmin && action?.id === r.id && action.kind === 'cancel' && (
              <div className="space-y-2">
                <Field label="Lý do huỷ">
                  <textarea name="cancelReason" rows={2} maxLength={CANCEL_REASON_MAX} className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <fieldset className="space-y-1 text-xs text-stone-700">
                  <legend className="font-medium">Hoàn điểm</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="refundPoints" value="true" checked={refund === true} onChange={() => setRefund(true)} />Hoàn điểm cho khách</label>
                  <label className="flex items-center gap-2"><input type="radio" name="refundPoints" value="false" checked={refund === false} onChange={() => setRefund(false)} />Không hoàn điểm</label>
                </fieldset>
                <p className="text-xs text-stone-600">
                  Chọn rõ có hoàn điểm hay không. Với khách bị khoá hoặc đã có yêu cầu bị thu hồi điểm, hoàn điểm trả lại phần lần thu hồi chưa lấy được.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={BTN_XS_PRIMARY} disabled={!cancelReady || cancel.isPending} onClick={() => cancel.mutate({ id: r.id, why: reason.trim(), refundPoints: refund === true })}>Xác nhận huỷ</button>
                  <button type="button" className={BTN_XS_SECONDARY} onClick={close}>Đóng</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RedemptionSummary({ row: r }: { row: AdminGiftRedemptionRowDTO }) {
  const codeText = r.code ? r.code : `QG-…${r.codeLast2 ?? ''}`;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-stone-900">{r.giftName}</span>
        <span className="text-xs text-stone-600">{WASTE_GIFT_KIND_LABELS[r.giftKind]}</span>
        <span className="text-xs text-stone-600">{formatCount(r.pointsCost)} điểm</span>
        <ToneBadge tone="neutral">{WASTE_GIFT_REDEMPTION_STATUS_LABELS[r.status]}</ToneBadge>
        {r.overdue && <ToneBadge tone="warning">Quá hạn nhận</ToneBadge>}
      </div>
      <div className="text-xs text-stone-700">{r.customerName}{r.customerPhone ? ` · ${r.customerPhone}` : ''}</div>
      <div className="text-xs text-stone-700">
        <span className="font-mono">{codeText}</span>
        {r.claimExpiresAt && ` · Hạn nhận ${formatDate(r.claimExpiresAt)}`}
      </div>
    </div>
  );
}

function GiftCatalogue() {
  const qc = useQueryClient();
  const gifts = useQuery({ queryKey: ['admin-waste-gifts'], queryFn: listWasteGifts });
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string | null; form: Form } | null>(null);

  const sorted = [...(gifts.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const done = () => qc.invalidateQueries({ queryKey: ['admin-waste-gifts'] });
  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Body> }) => updateWasteGift(id, body),
    onSuccess: () => { setErr(null); return done(); },
    onError,
  });
  const create = useMutation({
    mutationFn: (body: Body) => createWasteGift(body),
    onSuccess: () => { setErr(null); setPanel(null); return done(); },
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderWasteGifts(ids),
    onSuccess: () => { setErr(null); return done(); },
    onError,
  });

  const move = (idx: number, delta: -1 | 1) => {
    const ids = sorted.map((g) => g.id);
    const other = idx + delta;
    [ids[idx], ids[other]] = [ids[other]!, ids[idx]!];
    reorder.mutate(ids);
  };

  const editing = panel?.id ? sorted.find((g) => g.id === panel.id) ?? null : null;
  const errors = panel ? validate(panel.form) : {};
  const setForm = (p: Partial<Form>) => setPanel((cur) => (cur ? { ...cur, form: { ...cur.form, ...p } } : cur));

  const save = () => {
    if (!panel || Object.keys(errors).length > 0) return;
    if (editing) {
      const body = diffBody(panel.form, editing);
      if (Object.keys(body).length === 0) return;
      patch.mutate({ id: editing.id, body }, { onSuccess: () => setPanel(null) });
      return;
    }
    create.mutate(toBody(panel.form));
  };

  const f = panel?.form;
  const isTree = f?.kind === 'TREE';

  return (
    <section className="space-y-4" aria-label="Quà đổi điểm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-stone-900">Danh mục quà</h3>
        <button type="button" className={BTN_PRIMARY} onClick={() => setPanel({ id: null, form: { ...EMPTY_FORM } })}>Thêm quà</button>
      </div>
      {gifts.isError && <LoadError onRetry={() => void gifts.refetch()} retrying={gifts.isFetching}>Không tải được danh mục quà.</LoadError>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <ScrollRegion label="Bảng danh mục quà">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="border-b border-stone-200">
              <th className={TH}>Thứ tự</th>
              <th className={TH}>Tên</th>
              <th className={TH}>Loại</th>
              <th className={TH}>Giá</th>
              <th className={TH}>Tồn kho</th>
              <th className={TH}>Lượt đổi</th>
              <th className={TH}>Trạng thái</th>
              <th className={TH}>Sửa</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g, idx) => (
              <tr key={g.id} data-gift={g.id} className="border-b border-stone-100">
                <td className={TD}>
                  <div className="flex gap-1">
                    <button type="button" className={BTN_XS_SECONDARY} aria-label={`Đưa ${g.name} lên`} disabled={idx === 0 || reorder.isPending} onClick={() => move(idx, -1)}>
                      <ChevronUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className={BTN_XS_SECONDARY} aria-label={`Đưa ${g.name} xuống`} disabled={idx === sorted.length - 1 || reorder.isPending} onClick={() => move(idx, 1)}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  </div>
                </td>
                <td className={TD}>{g.name}</td>
                <td className={TD}>{WASTE_GIFT_KIND_LABELS[g.kind]}</td>
                <td className={TD}>{g.kind === 'TREE' ? (g.treePointsPrice === undefined ? '—' : `${formatCount(g.treePointsPrice)} điểm (giá Vườn Xanh)`) : `${formatCount(g.pointsCost)} điểm`}</td>
                <td className={TD}>{stockText(g.stock)}</td>
                <td className={TD}>
                  <div>{formatCount(g.redemptionCount)} lượt đổi</div>
                  {g.kind === 'TREE' && g.fundTreeTotal !== undefined && <div className="text-xs text-stone-600">Tổng số cây của quỹ (gồm cây thu hoạch trong game): {formatCount(g.fundTreeTotal)}</div>}
                </td>
                <td className={TD}>
                  <select
                    aria-label={`Trạng thái ${g.name}`}
                    className={FIELD_XS}
                    value={g.status}
                    onChange={(e) => patch.mutate({ id: g.id, body: { status: e.target.value as WasteGiftStatus } })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{WASTE_GIFT_STATUS_LABELS[s]}</option>)}
                  </select>
                </td>
                <td className={TD}>
                  <button type="button" className={BTN_XS_SECONDARY} onClick={() => setPanel({ id: g.id, form: toForm(g) })}>Sửa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>

      {panel && f && (
        <div className="space-y-3 rounded-control border border-stone-200 bg-stone-0 p-3">
          <h3 className="text-sm font-semibold text-stone-900">{editing ? `Sửa quà ${editing.name}` : 'Thêm quà'}</h3>
          {isTree && <Notice tone="info">Thẻ góp quỹ trồng cây: chỉ sửa tên, ảnh, thứ tự và ẩn/hiện.</Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && (
              <Field label="Loại quà">
                <select name="kind" className={`${FIELD_CLASS} w-full`} value={f.kind} onChange={(e) => setForm({ kind: e.target.value as WasteGiftKind })}>
                  {CREATE_KINDS.map((k) => <option key={k} value={k}>{WASTE_GIFT_KIND_LABELS[k]}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tên quà"><input name="name" className={INPUT_CLASS} value={f.name} onChange={(e) => setForm({ name: e.target.value })} /></Field>
            {!isTree && <Field label="Mô tả"><input name="description" className={INPUT_CLASS} value={f.description} onChange={(e) => setForm({ description: e.target.value })} /></Field>}
            {!isTree && <Field label="Nhãn"><input name="label" className={INPUT_CLASS} value={f.label} onChange={(e) => setForm({ label: e.target.value })} /></Field>}
            {!isTree && <Field label="Giá điểm"><input name="pointsCost" inputMode="numeric" className={INPUT_CLASS} value={f.pointsCost} onChange={(e) => setForm({ pointsCost: e.target.value })} /></Field>}
            <Field label="Trạng thái">
              <select name="status" className={`${FIELD_CLASS} w-full`} value={f.status} onChange={(e) => setForm({ status: e.target.value as WasteGiftStatus })}>
                {STATUSES.map((s) => <option key={s} value={s}>{WASTE_GIFT_STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Ảnh (đường dẫn)"><input name="imageUrl" className={INPUT_CLASS} value={f.imageUrl} onChange={(e) => setForm({ imageUrl: e.target.value })} /></Field>
            {!isTree && <Field label="Tồn kho, để trống nếu không giới hạn"><input name="stock" inputMode="numeric" className={INPUT_CLASS} value={f.stock} onChange={(e) => setForm({ stock: e.target.value })} /></Field>}
          </div>
          {!isTree && f.kind !== 'VOUCHER' && (
            <Field label="Hướng dẫn nhận quà">
              <textarea name="claimInstructions" rows={2} className={INPUT_CLASS} value={f.claimInstructions} onChange={(e) => setForm({ claimInstructions: e.target.value })} />
            </Field>
          )}
          {f.kind === 'VOUCHER' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kiểu giảm">
                <select name="voucherType" className={`${FIELD_CLASS} w-full`} value={f.voucherType} onChange={(e) => setForm({ voucherType: e.target.value as CouponType })}>
                  {VOUCHER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Giá trị giảm"><input name="voucherValue" inputMode="numeric" className={INPUT_CLASS} value={f.voucherValue} onChange={(e) => setForm({ voucherValue: e.target.value })} /></Field>
              <Field label="Đơn tối thiểu (đ), để trống nếu không có"><input name="voucherMinOrder" inputMode="numeric" className={INPUT_CLASS} value={f.voucherMinOrder} onChange={(e) => setForm({ voucherMinOrder: e.target.value })} /></Field>
              <Field label="Giảm tối đa (đ), để trống nếu không có"><input name="voucherMaxDiscount" inputMode="numeric" className={INPUT_CLASS} value={f.voucherMaxDiscount} onChange={(e) => setForm({ voucherMaxDiscount: e.target.value })} /></Field>
              <Field label="Hạn dùng (ngày)"><input name="voucherValidDays" inputMode="numeric" className={INPUT_CLASS} value={f.voucherValidDays} onChange={(e) => setForm({ voucherValidDays: e.target.value })} /></Field>
            </div>
          )}
          {Object.values(errors).length > 0 && (
            <ul className="space-y-0.5 text-xs text-danger-fg">
              {Object.values(errors).map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={Object.keys(errors).length > 0 || patch.isPending || create.isPending} onClick={save}>Lưu</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setPanel(null)}>Đóng</button>
          </div>
        </div>
      )}
    </section>
  );
}
