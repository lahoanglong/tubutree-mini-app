'use client';

import type { ShiftTemplate } from '@tubutree/app-core/api/shifts';
import { dowLabel, minToHHMM, shortDayLabel } from '@/lib/week';
import { ui } from '@/lib/guest-ui';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { EvidenceUpload } from '@/components/evidence-upload';

export const TIME_RE = /^\d{1,2}:\d{2}$/;

const chip = (on: boolean) => (on ? ui.btnPrimary : ui.btnSecondary);

function TimePair({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <Field label="Bắt đầu">
          <input type="time" className={ui.field} value={start} onChange={(e) => onStart(e.target.value)} />
        </Field>
      </div>
      <div className="flex-1">
        <Field label="Kết thúc">
          <input type="time" className={ui.field} value={end} onChange={(e) => onEnd(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function TemplateChips({ templates, isOn, onPick, extra }: { templates: ShiftTemplate[]; isOn: (t: ShiftTemplate) => boolean; onPick: (t: ShiftTemplate) => void; extra?: React.ReactNode }) {
  return (
    <div role="group" aria-label="Ca chuẩn" className="flex flex-wrap gap-2">
      {templates.map((t) => (
        <button key={t.id} type="button" aria-pressed={isOn(t)} onClick={() => onPick(t)} className={chip(isOn(t))}>
          {t.name} ({minToHHMM(t.startMin)}–{minToHHMM(t.endMin)})
        </button>
      ))}
      {extra}
    </div>
  );
}

export interface ShiftFormState {
  editId: string | null;
  day: string;
  tplId: string | null;
  custom: boolean;
  start: string;
  end: string;
}

/** Thêm ca (chọn ca chuẩn hoặc "Giờ khác") hoặc sửa giờ ca chờ duyệt. */
export function ShiftFormSheet({
  open,
  state,
  onChange,
  templates,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: ShiftFormState;
  onChange: (patch: Partial<ShiftFormState>) => void;
  templates: ShiftTemplate[];
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { editId, day, tplId, custom, start, end } = state;
  const showTimes = custom || !!editId || templates.length === 0;
  const invalid = !custom && !editId && templates.length > 0 ? !tplId : !TIME_RE.test(start) || !TIME_RE.test(end);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${editId ? 'Sửa ca' : 'Thêm ca'} · ${dowLabel(day)} ${shortDayLabel(day)}`}
      footer={
        <button type="button" disabled={pending || invalid} onClick={onSubmit} className={`${ui.btnPrimary} w-full`}>
          {pending ? 'Đang gửi...' : editId ? 'Lưu' : 'Gửi duyệt'}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {!editId && templates.length > 0 && (
          <>
            <p className="text-xs text-stone-600">Chọn ca chuẩn</p>
            <TemplateChips
              templates={templates}
              isOn={(t) => !custom && tplId === t.id}
              onPick={(t) => onChange({ custom: false, tplId: t.id })}
              extra={
                <button type="button" aria-pressed={custom} onClick={() => onChange({ custom: true })} className={chip(custom)}>
                  Giờ khác
                </button>
              }
            />
          </>
        )}
        {showTimes && <TimePair start={start} end={end} onStart={(v) => onChange({ start: v })} onEnd={(v) => onChange({ end: v })} />}
      </div>
    </Sheet>
  );
}

export interface QuickState {
  tplId: string | null;
  start: string;
  end: string;
  days: Set<string>;
}

/** Đăng ký nhanh: một khung giờ áp cho nhiều ngày trong tuần đang xem. */
export function QuickSheet({
  open,
  state,
  onChange,
  templates,
  dayKeys,
  todayKey,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: QuickState;
  onChange: (patch: Partial<QuickState>) => void;
  templates: ShiftTemplate[];
  dayKeys: string[];
  todayKey: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { tplId, start, end, days } = state;
  const toggle = (dk: string) => {
    const next = new Set(days);
    if (next.has(dk)) next.delete(dk);
    else next.add(dk);
    onChange({ days: next });
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Đăng ký nhanh cả tuần"
      footer={
        <button
          type="button"
          disabled={pending || days.size === 0 || (!tplId && (!TIME_RE.test(start) || !TIME_RE.test(end)))}
          onClick={onSubmit}
          className={`${ui.btnPrimary} w-full`}
        >
          Gửi duyệt {days.size > 0 ? `(${days.size} ngày)` : ''}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {templates.length > 0 && (
          <TemplateChips templates={templates} isOn={(t) => tplId === t.id} onPick={(t) => onChange({ tplId: tplId === t.id ? null : t.id })} />
        )}
        {!tplId && <TimePair start={start} end={end} onStart={(v) => onChange({ start: v })} onEnd={(v) => onChange({ end: v })} />}
        <p className="text-xs text-stone-600">Chọn ngày áp dụng</p>
        <div role="group" aria-label="Ngày áp dụng" className="flex flex-wrap gap-1.5">
          {dayKeys.map((dk) => (
            <button key={dk} type="button" disabled={dk < todayKey} aria-pressed={days.has(dk)} onClick={() => toggle(dk)} className={chip(days.has(dk))}>
              {dowLabel(dk)} {shortDayLabel(dk)}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export interface CancelState {
  reason: string;
  emergency: boolean;
  evidence: string;
}

/** Huỷ ca đã duyệt: lý do bắt buộc; đột xuất thì phải kèm ảnh chứng cứ. */
export function CancelSheet({
  open,
  state,
  onChange,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: CancelState;
  onChange: (patch: Partial<CancelState>) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { reason, emergency, evidence } = state;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Huỷ ca đã duyệt"
      footer={
        <button type="button" disabled={pending || reason.trim().length === 0 || (emergency && !evidence)} onClick={onSubmit} className={`${ui.btnPrimary} w-full`}>
          {pending ? 'Đang huỷ...' : 'Xác nhận huỷ'}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-stone-600">Huỷ trước 3 ngày: miễn phạt. Trễ hơn: phạt 1h công (trừ đột xuất có chứng cứ, tối đa 3 lần/tháng).</p>
        <Field label="Lý do huỷ">
          <textarea className={`${ui.field} py-2`} rows={3} maxLength={500} placeholder="Lý do huỷ" value={reason} onChange={(e) => onChange({ reason: e.target.value })} />
        </Field>
        <button
          type="button"
          role="switch"
          aria-checked={emergency}
          onClick={() => onChange({ emergency: !emergency })}
          className="flex min-h-11 w-full items-center justify-between text-left text-sm text-stone-900"
        >
          <span>Đột xuất (có chứng cứ)</span>
          <span aria-hidden="true" className={`relative h-[26px] w-11 flex-none rounded-full transition-colors ${emergency ? 'bg-forest-600' : 'bg-stone-450'}`}>
            <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-stone-0 shadow-card transition-all ${emergency ? 'left-[21px]' : 'left-[3px]'}`} />
          </span>
        </button>
        {emergency && (
          <EvidenceUpload
            label="Ảnh chứng cứ"
            hint="bắt buộc"
            max={1}
            value={evidence ? [evidence] : []}
            onChange={(v) => onChange({ evidence: v[0] ?? '' })}
          />
        )}
      </div>
    </Sheet>
  );
}
