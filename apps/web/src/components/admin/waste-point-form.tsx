'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  AdminWasteItemDTO,
  AdminWastePointDTO,
  WasteOpeningHours,
  WastePointKind,
  WastePointStatus,
  WastePointUpsertRequest,
  WasteWeekday,
} from '@tubutree/shared-types';
import { createWastePoint, updateWastePoint } from '@/lib/admin-client';
import { EMPTY_GEO, GeoPicker, type GeoValue } from '@/components/geo-picker';
import { WASTE_ITEM_STATUS_LABELS, WASTE_POINT_KIND_LABELS, WASTE_POINT_STATUS_LABELS } from '@/lib/waste-labels';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, Field, INPUT_CLASS, Notice } from './ui';

type Slot = { open: string; close: string };
type Hours = Partial<Record<WasteWeekday, Slot[]>>;

const WEEKDAYS: { key: WasteWeekday; label: string }[] = [
  { key: 'MON', label: 'Thứ 2' },
  { key: 'TUE', label: 'Thứ 3' },
  { key: 'WED', label: 'Thứ 4' },
  { key: 'THU', label: 'Thứ 5' },
  { key: 'FRI', label: 'Thứ 6' },
  { key: 'SAT', label: 'Thứ 7' },
  { key: 'SUN', label: 'Chủ nhật' },
];
const STATUSES = Object.keys(WASTE_POINT_STATUS_LABELS) as WastePointStatus[];

interface Form {
  kind: WastePointKind;
  name: string;
  addressLine: string;
  geo: GeoValue;
  lat: string;
  lng: string;
  phone: string;
  hours: Hours;
  status: WastePointStatus;
  quota: string;
  giftHandoverEnabled: boolean;
  note: string;
  itemIds: string[];
}

const str = (n: number | null) => (n === null ? '' : String(n));

function toForm(p: AdminWastePointDTO | null): Form {
  if (!p) {
    return {
      kind: 'PARTNER', name: '', addressLine: '', geo: { ...EMPTY_GEO }, lat: '', lng: '', phone: '', hours: {}, status: 'PENDING',
      quota: '', giftHandoverEnabled: false, note: '', itemIds: [],
    };
  }
  const hours: Hours = {};
  WEEKDAYS.forEach(({ key }) => {
    const slots = p.openingHours[key];
    if (slots && slots.length > 0) hours[key] = slots.map((s) => ({ open: s.open, close: s.close }));
  });
  return {
    kind: p.kind, name: p.name, addressLine: p.addressLine,
    geo: { province: p.provinceName, provinceCode: p.provinceCode, ward: p.communeName, wardCode: p.communeCode },
    lat: str(p.lat), lng: str(p.lng), phone: p.phone ?? '', hours, status: p.status, quota: str(p.monthlyQuotaPoints),
    giftHandoverEnabled: p.giftHandoverEnabled, note: p.note ?? '', itemIds: [...p.acceptedItemIds],
  };
}

const textOrNull = (s: string) => (s.trim() === '' ? null : s.trim());
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

function toHours(h: Hours): WasteOpeningHours {
  const out: WasteOpeningHours = {};
  WEEKDAYS.forEach(({ key }) => {
    const slots = h[key];
    if (slots) out[key] = slots.map((s) => ({ open: s.open, close: s.close }));
  });
  return out;
}

const hasError = (s: string, min: number, max: number) => {
  if (s.trim() === '') return false;
  const n = Number(s);
  return !Number.isFinite(n) || n < min || n > max;
};

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Nhập tên điểm';
  if (!f.addressLine.trim()) e.addressLine = 'Nhập địa chỉ';
  if (!f.geo.provinceCode) e.province = 'Chọn tỉnh/thành';
  if (!f.geo.wardCode) e.ward = 'Chọn phường/xã';
  if (hasError(f.lat, -90, 90)) e.lat = 'Vĩ độ từ -90 tới 90';
  if (hasError(f.lng, -180, 180)) e.lng = 'Kinh độ từ -180 tới 180';
  if (f.kind === 'PARTNER' && !(/^\d+$/.test(f.quota.trim()) && Number(f.quota) >= 1)) {
    e.quota = 'Nhập hạn mức điểm mỗi tháng cho đại lý (số nguyên từ 1)';
  }
  WEEKDAYS.forEach(({ key }) => {
    (f.hours[key] ?? []).forEach((s) => {
      if (e[`hours-${key}`]) return;
      if (!s.open || !s.close) e[`hours-${key}`] = 'Nhập giờ mở và giờ đóng';
      else if (s.close <= s.open) e[`hours-${key}`] = 'Giờ đóng phải sau giờ mở';
    });
  });
  return e;
}

function toBody(f: Form): WastePointUpsertRequest {
  const warehouse = f.kind === 'WAREHOUSE';
  return {
    kind: f.kind,
    name: f.name.trim(),
    addressLine: f.addressLine.trim(),
    provinceCode: f.geo.provinceCode,
    provinceName: f.geo.province,
    communeCode: f.geo.wardCode,
    communeName: f.geo.ward,
    lat: numOrNull(f.lat),
    lng: numOrNull(f.lng),
    phone: textOrNull(f.phone),
    openingHours: toHours(f.hours),
    status: warehouse ? 'ACTIVE' : f.status,
    monthlyQuotaPoints: warehouse ? null : Number(f.quota),
    giftHandoverEnabled: warehouse ? f.giftHandoverEnabled : false,
    note: textOrNull(f.note),
    itemIds: [...f.itemIds],
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffBody(full: WastePointUpsertRequest, base: AdminWastePointDTO, f: Form, initial: Form): Partial<WastePointUpsertRequest> {
  const out: Partial<WastePointUpsertRequest> = {};
  const set = <K extends keyof WastePointUpsertRequest>(k: K, changed: boolean) => {
    if (changed) out[k] = full[k];
  };
  set('name', full.name !== base.name);
  set('addressLine', full.addressLine !== base.addressLine);
  set('provinceCode', full.provinceCode !== base.provinceCode);
  set('provinceName', full.provinceName !== base.provinceName);
  set('communeCode', full.communeCode !== base.communeCode);
  set('communeName', full.communeName !== base.communeName);
  set('lat', full.lat !== base.lat);
  set('lng', full.lng !== base.lng);
  set('phone', full.phone !== (base.phone ?? null));
  set('openingHours', !sameJson(full.openingHours, toHours(initial.hours)));
  set('note', full.note !== (base.note ?? null));
  set('itemIds', !sameJson([...(full.itemIds ?? [])].sort(), [...base.acceptedItemIds].sort()));
  if (base.kind === 'PARTNER') {
    set('status', f.status !== base.status);
    set('monthlyQuotaPoints', full.monthlyQuotaPoints !== base.monthlyQuotaPoints);
  } else {
    set('giftHandoverEnabled', full.giftHandoverEnabled !== base.giftHandoverEnabled);
  }
  return out;
}

export function WastePointForm({
  point,
  items,
  warehouseExists,
  onSaved,
  onCancel,
}: {
  point: AdminWastePointDTO | null;
  items: AdminWasteItemDTO[];
  warehouseExists: boolean;
  onSaved: (p: AdminWastePointDTO) => void;
  onCancel: () => void;
}) {
  const [initial] = useState(() => toForm(point));
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF((cur) => ({ ...cur, ...p }));
  const errors = validate(f);
  const warehouse = f.kind === 'WAREHOUSE';

  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : 'Thao tác thất bại.');
  const create = useMutation({
    mutationFn: (body: WastePointUpsertRequest) => createWastePoint(body),
    onSuccess: (p) => { setErr(null); onSaved(p); },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<WastePointUpsertRequest> }) => updateWastePoint(id, body),
    onSuccess: (p) => { setErr(null); onSaved(p); },
    onError,
  });

  const save = () => {
    if (Object.keys(errors).length > 0) return;
    const full = toBody(f);
    if (point) {
      const body = diffBody(full, point, f, initial);
      if (Object.keys(body).length === 0) return;
      update.mutate({ id: point.id, body });
      return;
    }
    create.mutate(full);
  };

  const setSlot = (day: WasteWeekday, idx: number, p: Partial<Slot>) =>
    set({ hours: { ...f.hours, [day]: (f.hours[day] ?? []).map((s, i) => (i === idx ? { ...s, ...p } : s)) } });
  const toggleDay = (day: WasteWeekday, on: boolean) => {
    const next = { ...f.hours };
    if (on) next[day] = [{ open: '', close: '' }];
    else delete next[day];
    set({ hours: next });
  };
  const toggleItem = (id: string, on: boolean) =>
    set({ itemIds: on ? [...f.itemIds, id] : f.itemIds.filter((x) => x !== id) });

  const busy = create.isPending || update.isPending;
  const disableKind = (k: WastePointKind) => !!point || (k === 'WAREHOUSE' && warehouseExists);

  return (
    <div className="space-y-4 rounded-control border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-sm font-semibold text-stone-900">{point ? `Sửa điểm ${point.name}` : 'Đăng ký điểm nhận'}</h3>
      {err && <Notice tone="danger" role="alert">{err}</Notice>}

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-stone-700">Loại điểm</legend>
        <div className="flex flex-wrap gap-4 text-sm text-stone-800">
          {(['PARTNER', 'WAREHOUSE'] as WastePointKind[]).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={f.kind === k}
                disabled={disableKind(k)}
                onChange={() => set({ kind: k, status: k === 'WAREHOUSE' ? 'ACTIVE' : 'PENDING' })}
              />
              {WASTE_POINT_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {!point && warehouseExists && <p className="text-[11px] text-stone-500">Đã có kho Tubu (chỉ một kho)</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên điểm"><input name="name" className={INPUT_CLASS} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Địa chỉ"><input name="addressLine" className={INPUT_CLASS} value={f.addressLine} onChange={(e) => set({ addressLine: e.target.value })} /></Field>
        <GeoPicker value={f.geo} onChange={(geo) => set({ geo })} />
        <Field label="Vĩ độ" hint={errors.lat}><input name="lat" inputMode="decimal" className={INPUT_CLASS} value={f.lat} onChange={(e) => set({ lat: e.target.value })} /></Field>
        <Field label="Kinh độ" hint={errors.lng}><input name="lng" inputMode="decimal" className={INPUT_CLASS} value={f.lng} onChange={(e) => set({ lng: e.target.value })} /></Field>
        <Field label="Số điện thoại"><input name="phone" inputMode="tel" className={INPUT_CLASS} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      </div>

      <section className="space-y-2" aria-label="Giờ mở cửa">
        <h3 className="text-xs font-medium text-stone-700">Giờ mở cửa</h3>
        {WEEKDAYS.map(({ key, label }) => {
          const slots = f.hours[key];
          return (
            <div key={key} data-weekday={key} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
                <span className="w-20 shrink-0">{label}</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" aria-label={`${label} mở cửa`} checked={!!slots} onChange={(e) => toggleDay(key, e.target.checked)} />
                  Mở cửa
                </label>
                {slots?.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <input type="time" aria-label={`${label} giờ mở ${i + 1}`} className={INPUT_CLASS} value={s.open} onChange={(e) => setSlot(key, i, { open: e.target.value })} />
                    <span aria-hidden="true">–</span>
                    <input type="time" aria-label={`${label} giờ đóng ${i + 1}`} className={INPUT_CLASS} value={s.close} onChange={(e) => setSlot(key, i, { close: e.target.value })} />
                  </span>
                ))}
                {slots && (
                  <button type="button" className={BTN_XS_SECONDARY} onClick={() => set({ hours: { ...f.hours, [key]: [...slots, { open: '', close: '' }] } })}>
                    Thêm khung giờ
                  </button>
                )}
              </div>
              {errors[`hours-${key}`] && <p className="text-[11px] text-danger-fg">{errors[`hours-${key}`]}</p>}
            </div>
          );
        })}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Trạng thái" hint={warehouse ? 'Kho luôn Đang nhận; muốn dừng nhận mới thì tắt waste.enabled hoặc cờ waste.lane_*' : undefined}>
          <select
            name="status"
            className={INPUT_CLASS}
            value={warehouse ? 'ACTIVE' : f.status}
            disabled={warehouse}
            onChange={(e) => set({ status: e.target.value as WastePointStatus })}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{WASTE_POINT_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        {!warehouse && (
          <div>
            <Field label="Hạn mức điểm mỗi tháng" hint="Đề xuất 100.000 điểm cho điểm mới, 300.000 cho điểm đã chạy ổn">
              <input name="monthlyQuotaPoints" inputMode="numeric" className={INPUT_CLASS} value={f.quota} onChange={(e) => set({ quota: e.target.value })} />
            </Field>
            {errors.quota && <p className="mt-0.5 text-[11px] text-danger-fg">{errors.quota}</p>}
          </div>
        )}
        {warehouse && (
          <label className="flex items-center gap-1.5 text-sm text-stone-800">
            <input type="checkbox" name="giftHandoverEnabled" checked={f.giftHandoverEnabled} onChange={(e) => set({ giftHandoverEnabled: e.target.checked })} />
            Trao quà tại điểm này
          </label>
        )}
        <Field label="Ghi chú nội bộ"><input name="note" className={INPUT_CLASS} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-stone-700">Món điểm nhận</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {items.map((i) => (
            <label key={i.id} className="flex items-center gap-1.5 text-sm text-stone-800">
              <input type="checkbox" aria-label={i.name} checked={f.itemIds.includes(i.id)} onChange={(e) => toggleItem(i.id, e.target.checked)} />
              <span>{i.name}</span>
              <span className="text-[11px] text-stone-500">{WASTE_ITEM_STATUS_LABELS[i.status]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy || Object.keys(errors).length > 0} onClick={save}>
          {point ? 'Lưu điểm' : 'Đăng ký điểm'}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}
