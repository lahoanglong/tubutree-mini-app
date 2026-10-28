'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AdminWasteItemDTO, WasteItemStatus, WasteItemUpsertRequest } from '@tubutree/shared-types';
import { createWasteItem, getConfig, listWasteItems, reorderWasteItems, updateWasteItem } from '@/lib/admin-client';
import { configValue } from '@/lib/admin-config-forms';
import { formatCount } from '@/lib/checkout-points';
import { formatVnd } from '@/lib/format-vnd';
import { WASTE_ITEM_STATUS_LABELS } from '@/lib/waste-labels';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, FIELD_CLASS, FIELD_XS, Field, INPUT_CLASS, Notice, ScrollRegion, ToneBadge, LoadError } from './ui';

const DASH = '—';
const STATUSES = Object.keys(WASTE_ITEM_STATUS_LABELS) as WasteItemStatus[];
const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-middle text-sm text-stone-800';

interface Form {
  code: string;
  name: string;
  unitLabel: string;
  unitsPerPoint: string;
  pointsPerGroup: string;
  dropsPerUnit: string;
  dailyCapQty: string;
  monthlyCapQty: string;
  status: WasteItemStatus;
  prepInstructions: string;
  imageUrl: string;
  gramsPerUnit: string;
  hazardous: boolean;
}

const EMPTY_FORM: Form = {
  code: '', name: '', unitLabel: '', unitsPerPoint: '1', pointsPerGroup: '1000', dropsPerUnit: '0', dailyCapQty: '',
  monthlyCapQty: '', status: 'HIDDEN', prepInstructions: '', imageUrl: '', gramsPerUnit: '', hazardous: false,
};

const str = (n: number | null) => (n === null ? '' : String(n));
const toForm = (i: AdminWasteItemDTO): Form => ({
  code: i.code, name: i.name, unitLabel: i.unitLabel, unitsPerPoint: String(i.unitsPerPoint), pointsPerGroup: String(i.pointsPerGroup),
  dropsPerUnit: String(i.dropsPerUnit), dailyCapQty: str(i.dailyCapQty), monthlyCapQty: str(i.monthlyCapQty), status: i.status,
  prepInstructions: i.prepInstructions ?? '', imageUrl: i.imageUrl ?? '', gramsPerUnit: str(i.gramsPerUnit), hazardous: i.hazardous,
});

const isInt = (s: string, min: number) => /^\d+$/.test(s.trim()) && Number(s) >= min;
const blankOrInt = (s: string, min: number) => s.trim() === '' || isInt(s, min);
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim());

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (f.code.trim() === '') e.code = 'Nhập mã món';
  if (f.name.trim() === '') e.name = 'Nhập tên món';
  if (f.unitLabel.trim() === '') e.unitLabel = 'Nhập đơn vị';
  if (!isInt(f.unitsPerPoint, 1)) e.unitsPerPoint = 'Số đơn vị mỗi mức quy đổi là số nguyên từ 1';
  if (!isInt(f.pointsPerGroup, 1)) e.pointsPerGroup = 'Điểm mỗi mức quy đổi là số nguyên từ 1';
  if (!isInt(f.dropsPerUnit, 0)) e.dropsPerUnit = 'Giọt nước là số nguyên từ 0';
  if (!blankOrInt(f.dailyCapQty, 1)) e.dailyCapQty = 'Trần ngày là số nguyên từ 1 hoặc để trống';
  if (!blankOrInt(f.monthlyCapQty, 1)) e.monthlyCapQty = 'Trần tháng là số nguyên từ 1 hoặc để trống';
  if (!blankOrInt(f.gramsPerUnit, 1)) e.gramsPerUnit = 'Trọng lượng là số nguyên gram';
  return e;
}

function toBody(f: Form): WasteItemUpsertRequest {
  return {
    code: f.code.trim(), name: f.name.trim(), unitLabel: f.unitLabel.trim(), unitsPerPoint: Number(f.unitsPerPoint),
    pointsPerGroup: Number(f.pointsPerGroup), dropsPerUnit: Number(f.dropsPerUnit), dailyCapQty: intOrNull(f.dailyCapQty),
    monthlyCapQty: intOrNull(f.monthlyCapQty), status: f.status, prepInstructions: textOrNull(f.prepInstructions),
    imageUrl: textOrNull(f.imageUrl), gramsPerUnit: intOrNull(f.gramsPerUnit), hazardous: f.hazardous,
  };
}

function diffBody(full: WasteItemUpsertRequest, base: AdminWasteItemDTO): Partial<WasteItemUpsertRequest> {
  const out: Record<string, unknown> = {};
  (Object.keys(full) as (keyof WasteItemUpsertRequest)[]).forEach((k) => {
    if (JSON.stringify(full[k]) !== JSON.stringify(base[k as keyof AdminWasteItemDTO] ?? null)) out[k] = full[k];
  });
  if (out.hazardous === false) delete out.hazardous;
  return out as Partial<WasteItemUpsertRequest>;
}

const conversion = (unitsPerPoint: number, unitLabel: string, pointsPerGroup: number) =>
  `${formatCount(unitsPerPoint)} ${unitLabel} = ${formatCount(pointsPerGroup)} điểm`;

function capLine(daily: number | null, monthly: number | null, unit: string): string {
  const parts: string[] = [];
  if (daily !== null) parts.push(`Tối đa ${formatCount(daily)} ${unit} mỗi ngày khi mang tới điểm`);
  if (monthly !== null) parts.push(`${formatCount(monthly)} ${unit} mỗi tháng`);
  return parts.join(' · ');
}

export function WasteItemsSection() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const items = useQuery({ queryKey: ['admin-waste-items'], queryFn: listWasteItems });
  const loyalty = useQuery({ queryKey: ['admin-config', 'loyalty'], queryFn: () => getConfig('loyalty') });
  const waste = useQuery({ queryKey: ['admin-config', 'waste'], queryFn: () => getConfig('waste') });
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string | null; form: Form } | null>(null);

  const sorted = [...(items.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const done = () => qc.invalidateQueries({ queryKey: ['admin-waste-items'] });
  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<WasteItemUpsertRequest> }) => updateWasteItem(id, body),
    onSuccess: () => { setErr(null); return done(); },
    onError,
  });
  const create = useMutation({
    mutationFn: (body: WasteItemUpsertRequest) => createWasteItem(body),
    onSuccess: () => { setErr(null); setPanel(null); return done(); },
    onError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderWasteItems(ids),
    onSuccess: () => { setErr(null); return done(); },
    onError,
  });

  const move = (idx: number, delta: -1 | 1) => {
    const ids = sorted.map((i) => i.id);
    const other = idx + delta;
    [ids[idx], ids[other]] = [ids[other]!, ids[idx]!];
    reorder.mutate(ids);
  };

  const editing = panel?.id ? sorted.find((i) => i.id === panel.id) ?? null : null;
  const errors = panel ? validate(panel.form) : {};
  const setForm = (p: Partial<Form>) => setPanel((cur) => (cur ? { ...cur, form: { ...cur.form, ...p } } : cur));

  const confirmEnableHazardous = () =>
    confirm({
      title: 'Bật món nguy hại',
      message:
        'Chỉ bật khi đã có đủ: hợp đồng với đơn vị có giấy phép xử lý chất thải nguy hại, văn bản trả lời của Sở NN&MT, và bản Mini App mới đã lên. Kho nhận ngay mọi món đang nhận; đại lý chỉ nhận khi điểm có món này. Chưa gắn món này cho điểm đại lý cho tới khi Sở trả lời về điểm đối tác.',
      confirmLabel: 'Bật nhận',
      tone: 'danger',
    });

  const save = async () => {
    if (!panel || Object.keys(errors).length > 0) return;
    const full = toBody(panel.form);
    if (editing) {
      const body = diffBody(full, editing);
      if (Object.keys(body).length === 0) return;
      if (body.hazardous === true) {
        const ok = await confirm({
          title: 'Đánh dấu món nguy hại',
          message: 'Không bỏ được cờ này sau khi lưu. Món này chỉ nhận khi khách mang tới điểm nhận, không gửi bưu điện hay thu kèm đơn.',
          confirmLabel: 'Đánh dấu nguy hại',
          tone: 'danger',
        });
        if (!ok) return;
      }
      const finalActive = (body.status ?? editing.status) === 'ACTIVE';
      const finalHazardous = (body.hazardous ?? editing.hazardous) === true;
      const enabling = finalActive && finalHazardous && (body.status === 'ACTIVE' || body.hazardous === true);
      if (enabling && !(await confirmEnableHazardous())) return;
      patch.mutate({ id: editing.id, body }, { onSuccess: () => setPanel(null) });
      return;
    }
    if (full.hazardous) {
      const ok = await confirm({
        title: 'Đánh dấu món nguy hại',
        message: 'Không bỏ được cờ này sau khi lưu. Món này chỉ nhận khi khách mang tới điểm nhận, không gửi bưu điện hay thu kèm đơn.',
        confirmLabel: 'Đánh dấu nguy hại',
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (full.status === 'ACTIVE' && full.hazardous && !(await confirmEnableHazardous())) return;
    create.mutate(full);
  };

  const vnd = configValue<number>(loyalty.data, 'loyalty.vnd_per_point_redeem', 1);
  const months = configValue<number>(loyalty.data, 'loyalty.point_expire_months', 12);
  const maxPct = configValue<number>(loyalty.data, 'loyalty.max_redeem_pct', 0.2);
  const mailMin = configValue<number>(waste.data, 'waste.mailin_min_points', 15000);

  const f = panel?.form;
  const previewUnit = f?.unitLabel.trim() || 'đơn vị';
  const previewCap = f ? capLine(intOrNull(blankOrInt(f.dailyCapQty, 1) ? f.dailyCapQty : ''), intOrNull(blankOrInt(f.monthlyCapQty, 1) ? f.monthlyCapQty : ''), previewUnit) : '';

  return (
    <section className="space-y-4" aria-label="Hàng nhận">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-stone-900">Hàng nhận</h3>
        <button type="button" className={BTN_PRIMARY} onClick={() => setPanel({ id: null, form: { ...EMPTY_FORM } })}>Thêm món</button>
      </div>
      <dl data-waste-params className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-700">
        <div>1 điểm = {formatVnd(vnd)}</div>
        <div>Hạn điểm {formatCount(months)} tháng</div>
        <div>Dùng tối đa {Math.round(maxPct * 100)}% giá trị đơn</div>
        <div>Gói gửi kho tối thiểu {formatCount(mailMin)} điểm</div>
      </dl>
      {items.isError && <LoadError onRetry={() => void items.refetch()} retrying={items.isFetching}>Không tải được danh sách món.</LoadError>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <ScrollRegion label="Bảng món nhận">
        <table className="w-full border-collapse max-sm:block sm:min-w-[820px]">
          <thead className="max-sm:hidden">
            <tr className="border-b border-stone-200">
              <th className={TH}>Thứ tự</th>
              <th className={TH}>Món</th>
              <th className={TH}>Quy đổi</th>
              <th className={TH}>Trần ngày (mang tới điểm)</th>
              <th className={TH}>Trần tháng</th>
              <th className={TH}>Giọt nước mỗi đơn vị</th>
              <th className={TH}>Gram mỗi đơn vị</th>
              <th className={TH}>Trạng thái</th>
              <th className={TH}>Sửa</th>
            </tr>
          </thead>
          <tbody className="max-sm:block max-sm:space-y-2">
            {sorted.map((i, idx) => (
              <tr key={i.id} data-item={i.id} className="border-b border-stone-100 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1 max-sm:rounded-control max-sm:border max-sm:border-stone-200 max-sm:p-3">
                <td className={`${TD} max-sm:order-5 max-sm:ml-auto max-sm:p-0`}>
                  <div className="flex gap-1">
                    <button type="button" className={BTN_XS_SECONDARY} aria-label={`Đưa ${i.name} lên`} disabled={idx === 0 || reorder.isPending || panel?.id === i.id} onClick={() => move(idx, -1)}>
                      <ChevronUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className={BTN_XS_SECONDARY} aria-label={`Đưa ${i.name} xuống`} disabled={idx === sorted.length - 1 || reorder.isPending || panel?.id === i.id} onClick={() => move(idx, 1)}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  </div>
                </td>
                <td className={`${TD} max-sm:order-1 max-sm:w-full max-sm:p-0`}>
                  <div className="font-medium">{i.name}</div>
                </td>
                <td className={`${TD} max-sm:order-2 max-sm:w-full max-sm:p-0 max-sm:text-stone-600`}>{conversion(i.unitsPerPoint, i.unitLabel, i.pointsPerGroup)}</td>
                <td className={`${TD} max-sm:hidden`}>{i.dailyCapQty === null ? DASH : formatCount(i.dailyCapQty)}</td>
                <td className={`${TD} max-sm:hidden`}>{i.monthlyCapQty === null ? DASH : formatCount(i.monthlyCapQty)}</td>
                <td className={`${TD} max-sm:hidden`}>{formatCount(i.dropsPerUnit)}</td>
                <td className={`${TD} max-sm:hidden`}>{i.gramsPerUnit === null ? DASH : `${formatCount(i.gramsPerUnit)} g`}</td>
                <td className={`${TD} whitespace-nowrap max-sm:order-3 max-sm:p-0`}>
                  <select
                    aria-label={`Trạng thái ${i.name}`}
                    className={FIELD_XS}
                    value={i.status}
                    disabled={panel?.id === i.id}
                    onChange={async (e) => {
                      const status = e.target.value as WasteItemStatus;
                      if (status === 'ACTIVE' && i.hazardous && i.status !== 'ACTIVE' && !(await confirmEnableHazardous())) return;
                      patch.mutate({ id: i.id, body: { status } });
                    }}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{WASTE_ITEM_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </td>
                <td className={`${TD} whitespace-nowrap max-sm:order-4 max-sm:p-0`}>
                  <button type="button" className={BTN_XS_SECONDARY} onClick={() => setPanel({ id: i.id, form: toForm(i) })}>Sửa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="text-xs text-stone-600">Thay đổi áp cho yêu cầu mới và cho yêu cầu khách sửa lại sau đó; yêu cầu chưa sửa giữ mức cũ.</p>

      {panel && f && (
        <div className="grid gap-4 rounded-control border border-stone-200 bg-stone-0 p-3 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-stone-900">{editing ? `Sửa món ${editing.name}` : 'Thêm món'}</h3>
            {editing?.hazardous && <Notice tone="warning">Đã đánh dấu nguy hại: không bỏ được cờ, món chỉ nhận khi khách mang tới điểm nhận.</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mã món"><input name="code" className={INPUT_CLASS} value={f.code} onChange={(e) => setForm({ code: e.target.value })} /></Field>
              <Field label="Tên món"><input name="name" className={INPUT_CLASS} value={f.name} onChange={(e) => setForm({ name: e.target.value })} /></Field>
              <Field label="Đơn vị"><input name="unitLabel" className={INPUT_CLASS} value={f.unitLabel} onChange={(e) => setForm({ unitLabel: e.target.value })} /></Field>
              <Field label="Số đơn vị mỗi mức quy đổi"><input name="unitsPerPoint" inputMode="numeric" className={INPUT_CLASS} value={f.unitsPerPoint} onChange={(e) => setForm({ unitsPerPoint: e.target.value })} /></Field>
              <Field label="Điểm mỗi mức quy đổi"><input name="pointsPerGroup" inputMode="numeric" className={INPUT_CLASS} value={f.pointsPerGroup} onChange={(e) => setForm({ pointsPerGroup: e.target.value })} /></Field>
              <Field label="Giọt nước mỗi đơn vị"><input name="dropsPerUnit" inputMode="numeric" className={INPUT_CLASS} value={f.dropsPerUnit} onChange={(e) => setForm({ dropsPerUnit: e.target.value })} /></Field>
              <Field label="Trần ngày (mang tới điểm), để trống nếu không giới hạn"><input name="dailyCapQty" inputMode="numeric" className={INPUT_CLASS} value={f.dailyCapQty} onChange={(e) => setForm({ dailyCapQty: e.target.value })} /></Field>
              <Field label="Trần tháng, để trống nếu không giới hạn"><input name="monthlyCapQty" inputMode="numeric" className={INPUT_CLASS} value={f.monthlyCapQty} onChange={(e) => setForm({ monthlyCapQty: e.target.value })} /></Field>
              <Field label="Trạng thái">
                <select name="status" className={`${FIELD_CLASS} w-full`} value={f.status} onChange={(e) => setForm({ status: e.target.value as WasteItemStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{WASTE_ITEM_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Gram mỗi đơn vị" hint="Chỉ nhập cho món có đầu ra thật: Tubu dùng lại để đóng gói hoặc giao cho bên thu mua có hợp đồng.">
                <input name="gramsPerUnit" inputMode="numeric" className={INPUT_CLASS} value={f.gramsPerUnit} onChange={(e) => setForm({ gramsPerUnit: e.target.value })} />
              </Field>
            </div>
            <Field label="Hướng dẫn chuẩn bị (không ghi số trần; câu trần do hệ thống dựng)">
              <textarea name="prepInstructions" rows={3} className={INPUT_CLASS} value={f.prepInstructions} onChange={(e) => setForm({ prepInstructions: e.target.value })} />
            </Field>
            <Field label="Ảnh (đường dẫn)"><input name="imageUrl" className={INPUT_CLASS} value={f.imageUrl} onChange={(e) => setForm({ imageUrl: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-xs text-stone-700">
              <input
                type="checkbox"
                name="hazardous"
                checked={f.hazardous}
                disabled={!!editing?.hazardous}
                onChange={(e) => setForm({ hazardous: e.target.checked })}
              />
              Món cần xử lý riêng, như pin (chỉ nhận tại điểm nhận, không bỏ được cờ sau khi lưu)
            </label>
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
          <div data-item-preview className={`h-fit space-y-1 rounded-control border border-stone-200 p-3 text-sm ${f.status === 'COMING_SOON' ? 'bg-stone-100 text-stone-500' : 'bg-stone-0 text-stone-800'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{f.name.trim() || 'Tên món'}</span>
              {f.status === 'COMING_SOON' && <ToneBadge tone="neutral">Sắp nhận</ToneBadge>}
            </div>
            <div>{isInt(f.unitsPerPoint, 1) && isInt(f.pointsPerGroup, 1) ? conversion(Number(f.unitsPerPoint), previewUnit, Number(f.pointsPerGroup)) : DASH}</div>
            {previewCap && <div className="text-xs">{previewCap}</div>}
            {f.prepInstructions.trim() && <div className="text-xs">{f.prepInstructions.trim()}</div>}
          </div>
        </div>
      )}
      {dialog}
    </section>
  );
}
