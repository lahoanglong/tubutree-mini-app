'use client';

import { useMemo, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelShift, copyWeek, createShifts, deleteShift, updateShift, type Shift, type ShiftStatus } from '@tubutree/app-core/api/shifts';
import { myShiftsQuery, shiftTemplatesQuery } from '@tubutree/app-core/queries/shifts';
import { coreHttp } from '@/lib/core-http';
import {
  addDaysKey,
  dowLabel,
  isoToVnHHMM,
  keyToUtcMidnightISO,
  minToHHMM,
  mondayKeyOf,
  shortDayLabel,
  vnDateKey,
  vnDateTimeISO,
  weekDayKeys,
} from '@/lib/week';
import { ui } from '@/lib/guest-ui';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText, PeriodNav, useNotice } from './staff-shell';
import { TodayCard } from './today-card';
import { CancelSheet, QuickSheet, ShiftFormSheet, type CancelState, type QuickState, type ShiftFormState } from './shift-sheets';

const STATUS: Record<ShiftStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

const EMPTY_CANCEL: CancelState = { reason: '', emergency: false, evidence: '' };
const rowBtn = 'inline-flex min-h-11 items-center px-2 text-sm font-semibold disabled:opacity-50';

/** Thẻ hôm nay, lịch tuần của nhân viên và ba khung thao tác (thêm/sửa, đăng ký nhanh, huỷ). */
export function StaffHub() {
  const qc = useQueryClient();
  const { node: noticeNode, notify, clear } = useNotice();
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const dayKeys = useMemo(() => weekDayKeys(mondayKey), [mondayKey]);
  const todayKey = vnDateKey(new Date());
  const fromISO = keyToUtcMidnightISO(mondayKey);
  const toISO = `${addDaysKey(mondayKey, 6)}T23:59:59.999Z`;

  const tplQ = useQuery(shiftTemplatesQuery(coreHttp));
  const shiftsQ = useQuery(myShiftsQuery(coreHttp, mondayKey, fromISO, toISO));
  const templates = tplQ.data ?? [];

  const byDay = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const s of shiftsQ.data ?? []) (map[s.workDate.slice(0, 10)] ??= []).push(s);
    return map;
  }, [shiftsQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-shifts', mondayKey] });
  const fail = (e: unknown) => notify({ text: errText(e), tone: 'error' });

  // Thêm / sửa ca
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ShiftFormState>({ editId: null, day: mondayKey, tplId: null, custom: false, start: '08:00', end: '12:00' });
  const patchForm = (p: Partial<ShiftFormState>) => setForm((f) => ({ ...f, ...p }));
  const openAdd = (day: string) => {
    clear();
    setForm({ editId: null, day, tplId: null, custom: false, start: '08:00', end: '12:00' });
    setFormOpen(true);
  };
  const openEdit = (s: Shift) => {
    clear();
    setForm({ editId: s.id, day: s.workDate.slice(0, 10), tplId: null, custom: true, start: isoToVnHHMM(s.startAt), end: isoToVnHHMM(s.endAt) });
    setFormOpen(true);
  };
  const saveM = useMutation({
    mutationFn: async () => {
      const tpl = !form.custom && form.tplId ? templates.find((x) => x.id === form.tplId) : undefined;
      const start = tpl ? minToHHMM(tpl.startMin) : form.start;
      const end = tpl ? minToHHMM(tpl.endMin) : form.end;
      const startAt = vnDateTimeISO(form.day, start);
      const endAt = vnDateTimeISO(form.day, end);
      if (form.editId) return updateShift(coreHttp, form.editId, { startAt, endAt });
      return createShifts(coreHttp, [{ workDate: form.day, startAt, endAt, templateId: tpl?.id }]);
    },
    onSuccess: () => {
      notify({ text: form.editId ? 'Đã cập nhật ca.' : 'Đã gửi ca chờ duyệt.', tone: 'success' });
      setFormOpen(false);
      void invalidate();
    },
    onError: fail,
  });

  const delM = useMutation({
    mutationFn: (id: string) => deleteShift(coreHttp, id),
    onSuccess: () => {
      notify({ text: 'Đã xoá ca.', tone: 'success' });
      void invalidate();
    },
    onError: fail,
  });

  // Đăng ký nhanh
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickState>({ tplId: null, start: '08:00', end: '17:00', days: new Set() });
  const patchQuick = (p: Partial<QuickState>) => setQuick((q) => ({ ...q, ...p }));
  const openQuick = () => {
    clear();
    // Mặc định T2–T6 (từ hôm nay trở đi), giống Mini App.
    setQuick({ tplId: null, start: '08:00', end: '17:00', days: new Set(dayKeys.slice(0, 5).filter((dk) => dk >= todayKey)) });
    setQuickOpen(true);
  };
  const quickM = useMutation({
    mutationFn: () => {
      const tpl = quick.tplId ? templates.find((x) => x.id === quick.tplId) : undefined;
      const start = tpl ? minToHHMM(tpl.startMin) : quick.start;
      const end = tpl ? minToHHMM(tpl.endMin) : quick.end;
      return createShifts(
        coreHttp,
        [...quick.days].sort().map((dk) => ({ workDate: dk, startAt: vnDateTimeISO(dk, start), endAt: vnDateTimeISO(dk, end), templateId: tpl?.id })),
      );
    },
    onSuccess: (r) => {
      notify({ text: `Đã đăng ký ${r.created} ca chờ duyệt.`, tone: 'success' });
      setQuickOpen(false);
      void invalidate();
    },
    onError: fail,
  });

  const copyM = useMutation({
    mutationFn: () => copyWeek(coreHttp, keyToUtcMidnightISO(addDaysKey(mondayKey, -7)), keyToUtcMidnightISO(mondayKey)),
    onSuccess: (r) => {
      notify(r.created > 0 ? { text: `Đã copy ${r.created} ca từ tuần trước.`, tone: 'success' } : { text: 'Tuần trước không có ca để copy.', tone: 'info' });
      void invalidate();
    },
    onError: fail,
  });

  // Huỷ ca đã duyệt
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancel, setCancel] = useState<CancelState>(EMPTY_CANCEL);
  const cancelM = useMutation({
    mutationFn: () =>
      cancelShift(coreHttp, cancelId as string, {
        reason: cancel.reason.trim(),
        isEmergency: cancel.emergency,
        evidenceUrl: cancel.evidence || undefined,
      }),
    onSuccess: (r) => {
      notify(r.penalty ? { text: 'Đã huỷ ca — bị tính phạt 1h công.', tone: 'info' } : { text: 'Đã huỷ ca (không phạt).', tone: 'success' });
      setCancelId(null);
      setCancel(EMPTY_CANCEL);
      void invalidate();
    },
    onError: fail,
  });

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div aria-live="polite">{noticeNode}</div>
      <TodayCard />

      <PeriodNav
        label={`${shortDayLabel(mondayKey)} – ${shortDayLabel(addDaysKey(mondayKey, 6))}`}
        prevLabel="Tuần trước"
        nextLabel="Tuần sau"
        onPrev={() => setMondayKey(addDaysKey(mondayKey, -7))}
        onNext={() => setMondayKey(addDaysKey(mondayKey, 7))}
      />

      <div className="flex gap-2">
        <button type="button" onClick={openQuick} className={`${ui.btnPrimary} flex-1`}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Đăng ký nhanh
        </button>
        <button type="button" disabled={copyM.isPending} onClick={() => { clear(); copyM.mutate(); }} className={`${ui.btnSecondary} flex-1`}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Copy tuần trước
        </button>
      </div>

      {(tplQ.isLoading || shiftsQ.isLoading) && <Skeleton height={120} rounded="rounded-card" />}
      {shiftsQ.isError && <ErrorState message={errText(shiftsQ.error)} onRetry={() => void shiftsQ.refetch()} />}

      {shiftsQ.data && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {dayKeys.map((dk) => {
            const dayName = `${dowLabel(dk)} ${shortDayLabel(dk)}`;
            const shifts = byDay[dk] ?? [];
            return (
              <section key={dk} className={`p-3 ${ui.card}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h2 className={ui.sectionTitle}>
                    {dowLabel(dk)} · {shortDayLabel(dk)}
                  </h2>
                  {dk >= todayKey && (
                    <button type="button" aria-label={`Thêm ca ${dayName}`} onClick={() => openAdd(dk)} className={`${rowBtn} text-forest-600`}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                      Thêm
                    </button>
                  )}
                </div>
                {shifts.length === 0 && <p className="text-xs text-stone-600">Chưa đăng ký ca.</p>}
                {shifts.map((s) => {
                  const st = STATUS[s.status];
                  const adjusted = !!s.approvedStart || !!s.approvedEnd;
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 border-t border-stone-200 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-stone-900">
                          {isoToVnHHMM(s.approvedStart ?? s.startAt)} – {isoToVnHHMM(s.approvedEnd ?? s.endAt)}
                          {adjusted && <span className="text-xs text-stone-600"> (đã chỉnh)</span>}
                        </div>
                        <div className="mt-0.5">
                          <Badge tone={st.tone} size="sm">
                            {st.label}
                            {s.status === 'CANCELLED' && s.cancelPenalty ? ' · phạt 1h' : ''}
                          </Badge>
                        </div>
                        {s.status === 'REJECTED' && s.rejectReason && <p className="mt-0.5 text-xs text-stone-700">Lý do: {s.rejectReason}</p>}
                      </div>
                      {s.status === 'PENDING' && (
                        <div className="flex gap-1">
                          <button type="button" aria-label={`Sửa ca ${dayName}`} onClick={() => openEdit(s)} className={`${rowBtn} text-forest-600`}>
                            Sửa
                          </button>
                          <button type="button" aria-label={`Xoá ca ${dayName}`} disabled={delM.isPending} onClick={() => { clear(); delM.mutate(s.id); }} className={`${rowBtn} text-danger-fg`}>
                            Xoá
                          </button>
                        </div>
                      )}
                      {s.status === 'APPROVED' && (
                        <button type="button" aria-label={`Huỷ ca ${dayName}`} onClick={() => { clear(); setCancel(EMPTY_CANCEL); setCancelId(s.id); }} className={`${rowBtn} text-danger-fg`}>
                          Huỷ ca
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <ShiftFormSheet open={formOpen} state={form} onChange={patchForm} templates={templates} pending={saveM.isPending} onClose={() => setFormOpen(false)} onSubmit={() => saveM.mutate()} />
      <QuickSheet open={quickOpen} state={quick} onChange={patchQuick} templates={templates} dayKeys={dayKeys} todayKey={todayKey} pending={quickM.isPending} onClose={() => setQuickOpen(false)} onSubmit={() => quickM.mutate()} />
      <CancelSheet open={!!cancelId} state={cancel} onChange={(p) => setCancel((c) => ({ ...c, ...p }))} pending={cancelM.isPending} onClose={() => setCancelId(null)} onSubmit={() => cancelM.mutate()} />
    </div>
  );
}
