'use client';

import { useMemo, useRef, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelShift, copyWeek, createShifts, deleteShift, updateShift, type Shift, type ShiftItemInput, type ShiftStatus } from '@tubutree/app-core/api/shifts';
import { myShiftsQuery, shiftTemplatesQuery } from '@tubutree/app-core/queries/shifts';
import { coreHttp } from '@/lib/core-http';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
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
import { skin } from '@/components/pro-shared/mini-skin';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText, PeriodNav, staffLayout, useNotice } from './staff-shell';
import { useUploadBusy } from '@/lib/use-upload-busy';
import { TodayCard } from './today-card';
import { CancelSheet, QuickSheet, ShiftFormSheet, type CancelState, type QuickState, type ShiftFormState } from './shift-sheets';

const STATUS: Record<ShiftStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

const EMPTY_CANCEL: CancelState = { reason: '', emergency: false, evidence: '' };
const rowBtn = 'inline-flex min-h-11 items-center px-2 text-sm font-semibold disabled:opacity-50 aria-disabled:opacity-50';

// Mỗi lệnh mang tuần của chính nó trong biến: lệnh xong sau khi nhân viên đã đổi tuần vẫn làm mới đúng tuần đã gửi.
interface SaveVars {
  editId: string | null;
  workDate: string;
  startAt: string;
  endAt: string;
  templateId?: string;
  week: string;
}
interface DeleteVars {
  id: string;
  week: string;
}
interface QuickVars {
  items: ShiftItemInput[];
  week: string;
}
interface CopyVars {
  week: string;
}
interface CancelVars {
  id: string;
  reason: string;
  isEmergency: boolean;
  evidenceUrl?: string;
  week: string;
}
const SAVE_KEY = ['staff-shift-save'] as const;
const DELETE_KEY = ['staff-shift-delete'] as const;
const QUICK_KEY = ['staff-shift-quick'] as const;
const CANCEL_KEY = ['staff-shift-cancel'] as const;

/** Đích của mọi lệnh cùng loại đang bay (useLockedMutation chỉ giữ biến của lệnh sau cùng nên không dùng `variables`). */
function useBusyKeys<V>(mutationKey: readonly unknown[], keyOf: (v: V) => string) {
  return new Set(useMutationState({ filters: { mutationKey, status: 'pending' }, select: (m) => keyOf(m.state.variables as V) }));
}

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

  // Trả lời hứa làm mới để khoá giữ tới khi danh sách ca mới về, tối đa `settleWithin` (nhả sớm thì ca vừa xoá/huỷ còn nút và chạm lại được).
  // `refetchType: 'all'` vì tuần của lệnh có thể không còn được xem lúc xong; mặc định tuần đó chỉ bị đánh dấu cũ.
  const refresh = (week: string) => qc.invalidateQueries({ queryKey: ['my-shifts', week], refetchType: 'all' });
  // Lệnh bị từ chối (ca đã được duyệt hay xoá ở máy khác, bị chồng giờ: 400/404/409, xem `hasInput` bên dưới) thì danh sách đang hiện đã cũ: tải lại đúng tuần của lệnh
  // rồi mới nhả khoá. Lời lỗi đặt vào thông báo của trang trước, nên không mất khi ca biến mất khỏi danh sách.
  // `hasInput`: lệnh có ô người dùng nhập/chọn (giờ ca, đăng ký nhanh, lý do huỷ và ảnh) thì 400 là lỗi nhập liệu (giờ kết thúc không sau giờ bắt đầu, ca chồng giờ...):
  // hiện lỗi, không tải lại, chỉ 404/409 tải lại. Xoá ca và Chép tuần không có ô nhập nên 400 vẫn là ca đã đổi trạng thái.
  const failAndReload = (e: unknown, week: string, hasInput = false) => {
    notify({ text: errText(e), tone: 'error' });
    return reloadWhenStale(e, () => refresh(week), hasInput);
  };

  // Trạng thái bận lấy theo đích của từng lệnh (kể cả lúc lệnh đang làm mới danh sách). Nút MỞ tấm của đúng đích đó bị chặn, nên tấm
  // không bao giờ mở lại trong lúc đích còn bận (không kẹt "Đang gửi…" khi chưa gửi gì, không nạp dữ liệu cũ); đích khác không bị ảnh hưởng.
  const savingKeys = useBusyKeys<SaveVars>(SAVE_KEY, (v) => v.editId ?? '');
  const deletingIds = useBusyKeys<DeleteVars>(DELETE_KEY, (v) => v.id);
  const quickingWeeks = useBusyKeys<QuickVars>(QUICK_KEY, (v) => v.week);
  const cancelingIds = useBusyKeys<CancelVars>(CANCEL_KEY, (v) => v.id);
  const rowBusy = (id: string) => deletingIds.has(id) || savingKeys.has(id) || cancelingIds.has(id);
  const addBusy = savingKeys.has('');
  const quickBusy = quickingWeeks.has(mondayKey);

  // Sửa và Xoá cùng một ca loại trừ nhau (sheet sửa mở trên danh sách, nút Xoá của ca đó vẫn với tới được): khoá chung theo id ca bằng ref,
  // `isPending` chỉ đúng sau lần vẽ kế tiếp. Ca khác vẫn chạy song song; thêm ca mới chưa có id nên chỉ dựa vào khoá riêng của saveM.
  const shiftBusy = useRef(new Set<string>());
  const unlockShift = (id: string | null) => {
    if (id) shiftBusy.current.delete(id);
  };
  const lockShift = (id: string, run: () => void) => {
    if (shiftBusy.current.has(id)) return;
    shiftBusy.current.add(id);
    run();
  };

  // Thêm / sửa ca
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ShiftFormState>({ editId: null, day: mondayKey, tplId: null, custom: false, start: '08:00', end: '12:00' });
  const patchForm = (p: Partial<ShiftFormState>) => setForm((f) => ({ ...f, ...p }));
  const openAdd = (day: string) => {
    if (addBusy) return;
    clear();
    setForm({ editId: null, day, tplId: null, custom: false, start: '08:00', end: '12:00' });
    setFormOpen(true);
  };
  const openEdit = (s: Shift) => {
    if (rowBusy(s.id)) return;
    clear();
    setForm({ editId: s.id, day: s.workDate.slice(0, 10), tplId: null, custom: true, start: isoToVnHHMM(s.startAt), end: isoToVnHHMM(s.endAt) });
    setFormOpen(true);
  };
  const saveM = useLockedMutation(
    {
      mutationKey: SAVE_KEY,
      mutationFn: (v: SaveVars): Promise<unknown> =>
        v.editId
          ? updateShift(coreHttp, v.editId, { startAt: v.startAt, endAt: v.endAt })
          : createShifts(coreHttp, [{ workDate: v.workDate, startAt: v.startAt, endAt: v.endAt, templateId: v.templateId }]),
      onMutate: clear,
      onSuccess: (_data, v) => {
        notify({ text: v.editId ? 'Đã cập nhật ca.' : 'Đã gửi ca chờ duyệt.', tone: 'success' });
        setFormOpen(false);
        return settleWithin(refresh(v.week));
      },
      onError: (e, v) => failAndReload(e, v.week, true),
      onSettled: (_data, _error, v) => unlockShift(v.editId),
    },
    (v) => v.editId ?? '',
  );
  const submitForm = () => {
    const tpl = !form.custom && form.tplId ? templates.find((x) => x.id === form.tplId) : undefined;
    const start = tpl ? minToHHMM(tpl.startMin) : form.start;
    const end = tpl ? minToHHMM(tpl.endMin) : form.end;
    const v: SaveVars = {
      editId: form.editId,
      workDate: form.day,
      startAt: vnDateTimeISO(form.day, start),
      endAt: vnDateTimeISO(form.day, end),
      templateId: tpl?.id,
      week: mondayKey,
    };
    if (v.editId) lockShift(v.editId, () => saveM.mutate(v));
    else saveM.mutate(v);
  };

  const delM = useLockedMutation(
    {
      mutationKey: DELETE_KEY,
      mutationFn: (v: DeleteVars) => deleteShift(coreHttp, v.id),
      onMutate: clear,
      onSuccess: (_data, v) => {
        notify({ text: 'Đã xoá ca.', tone: 'success' });
        return settleWithin(refresh(v.week));
      },
      onError: (e, v) => failAndReload(e, v.week),
      onSettled: (_data, _error, v) => unlockShift(v.id),
    },
    (v) => v.id,
  );
  const formBusy = savingKeys.has(form.editId ?? '');

  // Đăng ký nhanh
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickState>({ tplId: null, start: '08:00', end: '17:00', days: new Set() });
  const patchQuick = (p: Partial<QuickState>) => setQuick((q) => ({ ...q, ...p }));
  const openQuick = () => {
    if (quickBusy) return;
    clear();
    // Mặc định T2–T6 (từ hôm nay trở đi), giống Mini App.
    setQuick({ tplId: null, start: '08:00', end: '17:00', days: new Set(dayKeys.slice(0, 5).filter((dk) => dk >= todayKey)) });
    setQuickOpen(true);
  };
  const quickM = useLockedMutation(
    {
      mutationKey: QUICK_KEY,
      mutationFn: (v: QuickVars) => createShifts(coreHttp, v.items),
      onMutate: clear,
      onSuccess: (r, v) => {
        notify({ text: `Đã đăng ký ${r.created} ca chờ duyệt.`, tone: 'success' });
        setQuickOpen(false);
        return settleWithin(refresh(v.week));
      },
      onError: (e, v) => failAndReload(e, v.week, true),
    },
    (v) => v.week,
  );
  const submitQuick = () => {
    const tpl = quick.tplId ? templates.find((x) => x.id === quick.tplId) : undefined;
    const start = tpl ? minToHHMM(tpl.startMin) : quick.start;
    const end = tpl ? minToHHMM(tpl.endMin) : quick.end;
    quickM.mutate({
      items: [...quick.days].sort().map((dk) => ({ workDate: dk, startAt: vnDateTimeISO(dk, start), endAt: vnDateTimeISO(dk, end), templateId: tpl?.id })),
      week: mondayKey,
    });
  };

  // Khoá chung mọi tuần: chép W-1 → W rồi sang tuần sau chép W → W+1 mà lệnh đầu chưa xong thì W+1 thiếu ca vừa chép vào W.
  const copyM = useLockedMutation({
    mutationFn: (v: CopyVars) => copyWeek(coreHttp, keyToUtcMidnightISO(addDaysKey(v.week, -7)), keyToUtcMidnightISO(v.week)),
    onMutate: clear,
    onSuccess: (r, v) => {
      notify(r.created > 0 ? { text: `Đã copy ${r.created} ca từ tuần trước.`, tone: 'success' } : { text: 'Tuần trước không có ca để copy.', tone: 'info' });
      return settleWithin(refresh(v.week));
    },
    onError: (e, v) => failAndReload(e, v.week),
  });
  const copyBusy = copyM.isPending;

  // Huỷ ca đã duyệt
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancel, setCancel] = useState<CancelState>(EMPTY_CANCEL);
  // Cờ nằm ở trang vì tấm huỷ ca gỡ nội dung khi đóng, còn ảnh về muộn vẫn ghi vào `cancel.evidence` của trang. Tắt "Đột xuất" gỡ ô ảnh
  // nhưng lượt tải đã chạy vẫn ghi ảnh khi xong, nên cờ không phụ thuộc "Đột xuất": nhả sớm thì tấm đóng được, mở ca khác và ảnh ca cũ rơi vào ca mới.
  const { busy: uploadBusy, onBusyChange: onEvidenceBusyChange } = useUploadBusy();
  const evidenceBusy = uploadBusy;
  const cancelM = useLockedMutation(
    {
      mutationKey: CANCEL_KEY,
      mutationFn: (v: CancelVars) => cancelShift(coreHttp, v.id, { reason: v.reason, isEmergency: v.isEmergency, evidenceUrl: v.evidenceUrl }),
      onMutate: clear,
      onSuccess: (r, v) => {
        notify(r.penalty ? { text: 'Đã huỷ ca — bị tính phạt 1h công.', tone: 'info' } : { text: 'Đã huỷ ca (không phạt).', tone: 'success' });
        // Chỉ đóng tấm của đúng ca vừa xong: huỷ ca A xong không được đóng tấm của ca B đang mở.
        setCancelId((cur) => (cur === v.id ? null : cur));
        return settleWithin(refresh(v.week));
      },
      onError: (e, v) => failAndReload(e, v.week, true),
    },
    (v) => v.id,
  );
  const cancelBusy = cancelId !== null && cancelingIds.has(cancelId);
  const openCancel = (id: string) => {
    if (rowBusy(id)) return;
    clear();
    setCancel(EMPTY_CANCEL);
    setCancelId(id);
  };
  const submitCancel = () => {
    if (!cancelId || evidenceBusy) return;
    // Ảnh còn trong state sau khi tắt "Đột xuất" không được đính vào huỷ không khẩn: API miễn phạt theo có/không có ảnh.
    const evidenceUrl = cancel.emergency ? cancel.evidence || undefined : undefined;
    cancelM.mutate({ id: cancelId, reason: cancel.reason.trim(), isEmergency: cancel.emergency, evidenceUrl, week: mondayKey });
  };

  return (
    <div className={staffLayout.root}>
      <div aria-live="polite" className={staffLayout.notice}>
        {noticeNode}
      </div>
      {/* Từ lg: cột bên gồm thẻ hôm nay, chuyển tuần và hai nút; cột chính là lịch tuần (hai cột ngày). Dưới lg hai khối này là `contents`. */}
      <div className={staffLayout.aside}>
        <TodayCard />

        <PeriodNav
          label={`${shortDayLabel(mondayKey)} – ${shortDayLabel(addDaysKey(mondayKey, 6))}`}
          prevLabel="Tuần trước"
          nextLabel="Tuần sau"
          onPrev={() => setMondayKey(addDaysKey(mondayKey, -7))}
          onNext={() => setMondayKey(addDaysKey(mondayKey, 7))}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-busy={quickBusy || undefined}
            aria-disabled={quickBusy || undefined}
            onClick={openQuick}
            className={`${ui.btnPrimary} min-w-[10rem] flex-1`}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Đăng ký ca
          </button>
          <button
            type="button"
            aria-label="Chép tuần trước"
            aria-busy={copyBusy || undefined}
            aria-disabled={copyBusy || undefined}
            onClick={() => copyM.mutate({ week: mondayKey })}
            className={`${skin.btnSecondary} min-w-[10rem] flex-1`}
          >
            <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Chép tuần
          </button>
        </div>
      </div>

      <div className={staffLayout.main}>
        {(tplQ.isLoading || shiftsQ.isLoading) && <Skeleton height={120} rounded="rounded-card" />}
        {shiftsQ.isError && <ErrorState message={errText(shiftsQ.error)} onRetry={() => shiftsQ.refetch()} />}

        {shiftsQ.data && (
          <div className="grid gap-3 md:grid-cols-2">
            {dayKeys.map((dk) => {
              const dayName = `${dowLabel(dk)} ${shortDayLabel(dk)}`;
              const shifts = byDay[dk] ?? [];
              return (
                <section key={dk} className={`p-3 ${skin.card}${dk === todayKey ? ' border-forest-600 max-md:!border-forest-600' : ''}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className={skin.cardTitle}>
                        {dowLabel(dk)} · {shortDayLabel(dk)}
                      </h2>
                      {dk === todayKey && (
                        <Badge tone="brand" size="sm">
                          Hôm nay
                        </Badge>
                      )}
                    </div>
                    {dk >= todayKey && (
                      <button
                        type="button"
                        aria-label={`Thêm ca ${dayName}`}
                        aria-busy={addBusy || undefined}
                        aria-disabled={addBusy || undefined}
                        onClick={() => openAdd(dk)}
                        className={`${rowBtn} text-forest-600`}
                      >
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
                          <div className="text-sm tabular-nums text-stone-900">
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
                            <button
                              type="button"
                              aria-label={`Sửa ca ${dayName}`}
                              aria-busy={rowBusy(s.id) || undefined}
                              aria-disabled={rowBusy(s.id) || undefined}
                              onClick={() => openEdit(s)}
                              className={`${rowBtn} text-forest-600`}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              aria-label={`Xoá ca ${dayName}`}
                              aria-busy={rowBusy(s.id) || undefined}
                              aria-disabled={rowBusy(s.id) || undefined}
                              onClick={() => lockShift(s.id, () => delM.mutate({ id: s.id, week: mondayKey }))}
                              className={`${rowBtn} text-danger-fg`}
                            >
                              Xoá
                            </button>
                          </div>
                        )}
                        {s.status === 'APPROVED' && (
                          <button
                            type="button"
                            aria-label={`Huỷ ca ${dayName}`}
                            aria-busy={rowBusy(s.id) || undefined}
                            aria-disabled={rowBusy(s.id) || undefined}
                            onClick={() => openCancel(s.id)}
                            className={`${rowBtn} text-danger-fg`}
                          >
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
      </div>

      <ShiftFormSheet open={formOpen} state={form} onChange={patchForm} templates={templates} pending={formBusy} onClose={() => setFormOpen(false)} onSubmit={submitForm} />
      <QuickSheet open={quickOpen} state={quick} onChange={patchQuick} templates={templates} dayKeys={dayKeys} todayKey={todayKey} pending={quickingWeeks.has(mondayKey)} onClose={() => setQuickOpen(false)} onSubmit={submitQuick} />
      <CancelSheet open={!!cancelId} state={cancel} onChange={(p) => setCancel((c) => ({ ...c, ...p }))} pending={cancelBusy} evidenceBusy={evidenceBusy} onEvidenceBusyChange={onEvidenceBusyChange} onClose={() => setCancelId(null)} onSubmit={submitCancel} />
    </div>
  );
}
