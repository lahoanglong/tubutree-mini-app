'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveShift,
  bulkApproveShifts,
  createTemplate,
  deleteTemplate,
  rejectShift,
  type AdminShift,
} from '@tubutree/app-core/api/shifts';
import { adminShiftsQuery, adminShiftTemplatesQuery } from '@tubutree/app-core/queries/shifts';
import { invalidateInbox } from '@/lib/admin-client';
import { coreHttp } from '@/lib/core-http';
import { usePressLock } from '@/lib/use-press-lock';
import { addDaysKey, dowLabel, hhmmToMin, isoToVnHHMM, keyToUtcMidnightISO, mondayKeyOf, minToHHMM, shortDayLabel, vnDateTimeISO } from '@/lib/week';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { Sheet } from '@/components/ui/sheet';
import { errText, PeriodNav } from '@/components/staff/staff-shell';
import { useConfirm } from './confirm-dialog';
import { BTN_LINK, BTN_LINK_DANGER, BTN_PRIMARY, BTN_SECONDARY, Field, INPUT_CLASS, Notice, ToneBadge } from './ui';
import type { Tone } from '@/lib/recycling';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Ca chuẩn kết thúc cuối ngày (endMin 1440) hợp lệ ở máy chủ và Mini App; chỉ ô giờ ca chuẩn nhận 24:00.
const TEMPLATE_END_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

// Khoá của "Duyệt tất cả" trong sổ khoá ca; id ca là chuỗi do máy chủ cấp nên không bao giờ trùng dấu sao.
const BULK_KEY = '*';

const SHIFT_STATUS: Record<AdminShift['status'], { label: string; tone: Tone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

/** Duyệt ca tuần: duyệt, chỉnh giờ rồi duyệt, từ chối kèm lý do, duyệt hàng loạt ca chờ, và quản lý ca chuẩn. */
export function ShiftApprovalTab() {
  const qc = useQueryClient();
  const { ask, confirm, dialog } = useConfirm();
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const fromISO = keyToUtcMidnightISO(mondayKey);
  const toISO = `${addDaysKey(mondayKey, 6)}T23:59:59.999Z`;
  const shiftsQ = useQuery(adminShiftsQuery(coreHttp, mondayKey, fromISO, toISO));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [adjust, setAdjust] = useState<{ id: string; dayKey: string } | null>(null);
  const [adjStart, setAdjStart] = useState('08:00');
  const [adjEnd, setAdjEnd] = useState('12:00');
  const [tplOpen, setTplOpen] = useState(false);
  // Trả lời hứa làm mới để khoá của ca giữ tới khi danh sách ca mới về: nhả sớm thì nút "Duyệt" của ca vừa duyệt còn hiện và bấm lại được.
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-shifts', mondayKey] }), invalidateInbox(qc)]);
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: errText(e) });

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; shifts: AdminShift[] }>();
    for (const s of shiftsQ.data ?? []) {
      const entry = map.get(s.staffId) ?? { name: s.staff.fullName ?? s.staff.phone ?? 'NV', shifts: [] };
      entry.shifts.push(s);
      map.set(s.staffId, entry);
    }
    return [...map.values()];
  }, [shiftsQ.data]);
  const pendingIds = useMemo(() => (shiftsQ.data ?? []).filter((s) => s.status === 'PENDING').map((s) => s.id), [shiftsQ.data]);

  // Duyệt và từ chối cùng một ca loại trừ nhau, còn "Duyệt tất cả" đụng mọi ca chờ: chung một sổ khoá ref (`isPending` chỉ đúng sau lần vẽ kế tiếp).
  // Ca khác nhau vẫn chạy song song; mỗi mutation nhả khoá của mình ở `onSettled`, thành công lẫn lỗi.
  // Trạng thái bận lấy thẳng từ sổ khoá (`isPending`/`variables` của useMutation chỉ theo cú gọi SAU CÙNG nên ca A còn chạy mà B xong trước thì A hiện như rảnh);
  // sổ là ref nên mỗi lần xin/nhả khoá tăng `tick` để vẽ lại.
  const acting = useRef(new Set<string>());
  const [, setTick] = useState(0);
  const releaseShift = (_data: unknown, _error: unknown, v: { id: string }) => {
    acting.current.delete(v.id);
    setTick((n) => n + 1);
  };
  const releaseBulk = () => {
    acting.current.delete(BULK_KEY);
    setTick((n) => n + 1);
  };
  const held = (key: string) => (key === BULK_KEY ? acting.current.size > 0 : acting.current.has(key) || acting.current.has(BULK_KEY));
  const exclusive = (key: string, run: () => void) => {
    if (held(key)) return;
    acting.current.add(key);
    setTick((n) => n + 1);
    run();
  };

  const approveM = useLockedMutation(
    {
      onSettled: releaseShift,
      mutationFn: (v: { id: string; approvedStart?: string; approvedEnd?: string }) =>
        approveShift(coreHttp, v.id, v.approvedStart ? { approvedStart: v.approvedStart, approvedEnd: v.approvedEnd } : undefined),
      onSuccess: () => {
        setMsg({ tone: 'success', text: 'Đã duyệt ca.' });
        setAdjust(null);
        return invalidate();
      },
      onError: fail,
    },
    (v) => v.id,
  );
  const rejectM = useLockedMutation(
    {
      onSettled: releaseShift,
      mutationFn: (v: { id: string; reason: string }) => rejectShift(coreHttp, v.id, v.reason),
      onSuccess: () => {
        setMsg({ tone: 'success', text: 'Đã từ chối ca.' });
        return invalidate();
      },
      onError: fail,
    },
    (v) => v.id,
  );
  const bulkM = useLockedMutation({
    onSettled: releaseBulk,
    mutationFn: (ids: string[]) => bulkApproveShifts(coreHttp, ids),
    onSuccess: (r) => {
      setMsg({ tone: 'success', text: `Đã duyệt ${r.approved} ca.` });
      return invalidate();
    },
    onError: fail,
  });
  const retryShifts = usePressLock(() => shiftsQ.refetch());
  const adjustBusy = !!adjust && held(adjust.id);

  const openAdjust = (s: AdminShift) => {
    setAdjust({ id: s.id, dayKey: s.workDate.slice(0, 10) });
    setAdjStart(isoToVnHHMM(s.startAt));
    setAdjEnd(isoToVnHHMM(s.endAt));
  };

  const askBulkApprove = async () => {
    if (held(BULK_KEY)) return;
    // Danh sách tự làm mới khi hộp đang mở: duyệt đúng những ca đã nêu trong câu hỏi, không lấy lại danh sách lúc bấm.
    const ids = [...pendingIds];
    const ok = await confirm({
      title: 'Duyệt tất cả ca chờ?',
      message: `Duyệt ${ids.length} ca đang chờ của tuần này? Các ca cần từ chối hoặc chỉnh giờ nên xử lý riêng trước.`,
      confirmLabel: `Duyệt ${ids.length} ca`,
    });
    if (ok) exclusive(BULK_KEY, () => bulkM.mutate(ids));
  };

  const askReject = async (s: AdminShift, who: string) => {
    if (held(s.id)) return;
    const reason = await ask({
      title: 'Từ chối ca',
      message: `Ca của ${who} ngày ${shortDayLabel(s.workDate.slice(0, 10))} sẽ bị từ chối và nhân viên thấy lý do.`,
      confirmLabel: 'Xác nhận từ chối',
      tone: 'danger',
      input: { label: 'Lý do', placeholder: 'Lý do', required: true, maxLength: 300 },
    });
    if (reason) exclusive(s.id, () => rejectM.mutate({ id: s.id, reason }));
  };

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Duyệt ca</h2>
        <button type="button" onClick={() => setTplOpen(true)} className={BTN_SECONDARY}>
          Ca chuẩn
        </button>
      </div>
      <PeriodNav
        label={`${shortDayLabel(mondayKey)} – ${shortDayLabel(addDaysKey(mondayKey, 6))}`}
        prevLabel="Tuần trước"
        nextLabel="Tuần sau"
        onPrev={() => setMondayKey(addDaysKey(mondayKey, -7))}
        onNext={() => setMondayKey(addDaysKey(mondayKey, 7))}
      />
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
      {pendingIds.length > 0 && (
        <button
          type="button"
          aria-busy={acting.current.size > 0 || undefined}
          aria-disabled={acting.current.size > 0 || undefined}
          onClick={() => void askBulkApprove()}
          className={BTN_PRIMARY}
        >
          Duyệt tất cả ({pendingIds.length})
        </button>
      )}

      {shiftsQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {shiftsQ.isError && (
        <div role="alert" className="text-sm text-danger-fg">
          {errText(shiftsQ.error)}{' '}
          <button type="button" onClick={retryShifts.press} aria-busy={retryShifts.busy || undefined} aria-disabled={retryShifts.busy || undefined} className="font-medium underline">
            Thử lại
          </button>
        </div>
      )}
      {shiftsQ.data && grouped.length === 0 && <p className="text-sm text-stone-500">Không có ca nào trong tuần này</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {grouped.map((g) => (
          <section key={g.name} aria-label={g.name} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <h3 className="mb-1 text-sm font-semibold text-stone-900">{g.name}</h3>
            {g.shifts.map((s) => {
              const dayKey = s.workDate.slice(0, 10);
              const dayName = `${dowLabel(dayKey)} ${shortDayLabel(dayKey)}`;
              const st = SHIFT_STATUS[s.status];
              const busy = held(s.id);
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 py-2">
                  <div className="min-w-0 text-sm">
                    <div>
                      {dayName} · {isoToVnHHMM(s.approvedStart ?? s.startAt)}–{isoToVnHHMM(s.approvedEnd ?? s.endAt)}
                    </div>
                    <div className="mt-0.5">
                      <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                    </div>
                  </div>
                  {s.status === 'PENDING' && (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" aria-label={`Chỉnh giờ ${g.name} ${dayName}`} onClick={() => openAdjust(s)} className={BTN_LINK}>
                        Chỉnh giờ
                      </button>
                      <button
                        type="button"
                        aria-label={`Duyệt ca ${g.name} ${dayName}`}
                        aria-busy={busy || undefined}
                        aria-disabled={busy || undefined}
                        onClick={() => exclusive(s.id, () => approveM.mutate({ id: s.id }))}
                        className={BTN_LINK}
                      >
                        Duyệt
                      </button>
                      <button
                        type="button"
                        aria-label={`Từ chối ca ${g.name} ${dayName}`}
                        aria-busy={busy || undefined}
                        aria-disabled={busy || undefined}
                        onClick={() => void askReject(s, g.name)}
                        className={BTN_LINK_DANGER}
                      >
                        Từ chối
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <Sheet
        open={!!adjust}
        onClose={() => setAdjust(null)}
        dismissible={!adjustBusy}
        title="Chỉnh giờ & duyệt"
        footer={
          <button
            type="button"
            disabled={!TIME_RE.test(adjStart) || !TIME_RE.test(adjEnd)}
            aria-busy={adjustBusy || undefined}
            aria-disabled={adjustBusy || undefined}
            onClick={() =>
              adjust &&
              exclusive(adjust.id, () =>
                approveM.mutate({
                  id: adjust.id,
                  approvedStart: vnDateTimeISO(adjust.dayKey, adjStart),
                  approvedEnd: vnDateTimeISO(adjust.dayKey, adjEnd),
                }),
              )
            }
            className={`${BTN_PRIMARY} w-full`}
          >
            Duyệt với giờ đã chỉnh
          </button>
        }
      >
        <div className="flex gap-2">
          <div className="flex-1">
            <Field label="Bắt đầu">
              <input type="time" value={adjStart} onChange={(e) => setAdjStart(e.target.value)} className={INPUT_CLASS} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Kết thúc">
              <input type="time" value={adjEnd} onChange={(e) => setAdjEnd(e.target.value)} className={INPUT_CLASS} />
            </Field>
          </div>
        </div>
      </Sheet>

      <TemplateSheet open={tplOpen} onClose={() => setTplOpen(false)} />
    </div>
  );
}

function TemplateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const tplQ = useQuery({ ...adminShiftTemplatesQuery(coreHttp), enabled: open });
  const [name, setName] = useState('');
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('12:00');
  const [err, setErr] = useState<string | null>(null);
  // Nhân viên đăng ký ca bằng danh sách này nên làm mới cả hai khoá; trả lời hứa để khoá giữ tới khi danh sách mới về.
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-templates'] }), qc.invalidateQueries({ queryKey: ['shift-templates'] })]);
  // Chữ khách gõ thêm trong lúc gửi không bị xoá khi thành công: chỉ xoá nếu ô vẫn đúng chữ đã gửi.
  const addM = useLockedMutation({
    mutationFn: (v: { name: string }) => createTemplate(coreHttp, { name: v.name.trim(), startMin: hhmmToMin(start), endMin: hhmmToMin(end) }),
    onSuccess: (_data, v) => {
      setErr(null);
      setName((cur) => (cur === v.name ? '' : cur));
      return refresh();
    },
    onError: (e) => setErr(errText(e)),
  });
  const delM = useLockedMutation({
    mutationFn: (id: string) => deleteTemplate(coreHttp, id),
    onSuccess: () => {
      setErr(null);
      return refresh();
    },
    onError: (e) => setErr(errText(e)),
  });
  const sending = addM.isPending || delM.isPending;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissible={!sending}
      title="Ca chuẩn"
      footer={
        <button
          type="button"
          disabled={!name.trim() || !TIME_RE.test(start) || !TEMPLATE_END_RE.test(end)}
          aria-busy={addM.isPending || undefined}
          aria-disabled={addM.isPending || undefined}
          onClick={() => addM.mutate({ name })}
          className={`${BTN_PRIMARY} w-full`}
        >
          Thêm ca chuẩn
        </button>
      }
    >
      <div className="space-y-3">
        {err && <p role="alert" className="text-sm text-danger-fg">{err}</p>}
        {tplQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
        {tplQ.data?.length === 0 && <p className="text-sm text-stone-500">Chưa có ca chuẩn.</p>}
        {(tplQ.data ?? []).map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {t.name} · {minToHHMM(t.startMin)}–{minToHHMM(t.endMin)}
            </span>
            <button
              type="button"
              aria-label={`Xoá ca chuẩn ${t.name}`}
              aria-busy={(delM.isPending && delM.variables === t.id) || undefined}
              aria-disabled={delM.isPending || undefined}
              onClick={() => delM.mutate(t.id)}
              className={BTN_LINK_DANGER}
            >
              Xoá
            </button>
          </div>
        ))}
        <div className="space-y-2 border-t border-stone-200 pt-3">
          <Field label="Tên ca">
            <input placeholder="Tên ca (VD Ca sáng)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
          </Field>
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="Bắt đầu">
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT_CLASS} />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Kết thúc">
                <input type="text" inputMode="numeric" pattern="([01]\d|2[0-3]):[0-5]\d|24:00" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT_CLASS} />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
