'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminWasteEventDTO,
  WasteConfirmLineInput,
  WasteConfirmRequest,
  WasteReopenRequest,
  WasteRejectionReason,
  WasteRejectRequest,
  WasteRequestAdminDetailDTO,
  WasteShortfallReason,
} from '@tubutree/shared-types';
import {
  closeLostWasteRequest,
  confirmWasteRequest,
  getWasteRequest,
  listWasteUnmatched,
  rejectWasteRequest,
  reopenWasteRequest,
  reverseWasteRequest,
  setWasteRequestCost,
} from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import {
  WASTE_METHOD_LABELS,
  WASTE_REJECTION_REASON_LABELS,
  WASTE_REQUEST_STATUS_LABELS,
  WASTE_SHORTFALL_REASON_LABELS,
  wasteActorRoleLabel,
  wasteEventKindLabel,
  wasteEventMetaLines,
} from '@/lib/waste-labels';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, FIELD_CLASS, INPUT_CLASS, Notice, ScrollRegion } from './ui';
import { useConfirm } from './confirm-dialog';

const NOTE_MAX = 500;
const WEIGHT_ERROR = 'Cân nặng là số nguyên từ 1 tới 100000 gram';
const SHORTFALL_KEYS = Object.keys(WASTE_SHORTFALL_REASON_LABELS) as WasteShortfallReason[];
const REJECTION_KEYS = Object.keys(WASTE_REJECTION_REASON_LABELS) as WasteRejectionReason[];
const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-top text-sm text-stone-800';
const PANEL = 'space-y-3 rounded-control border border-stone-200 bg-stone-0 p-3';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Thao tác thất bại.');

/** Hiển thị thôi: điểm thật do máy chủ tính khi xác nhận (spec 5.1). */
export function wastePointsForLines(lines: { receivedQty: number; unitsPerPoint: number; pointsPerGroup: number }[]): number {
  return lines.reduce((sum, l) => sum + Math.floor(l.receivedQty / l.unitsPerPoint) * l.pointsPerGroup, 0);
}

const canCountRequest = (r: WasteRequestAdminDetailDTO) =>
  r.status === 'RECEIVED' || (r.method === 'DROP_OFF' && r.status === 'OPEN' && r.point?.kind === 'WAREHOUSE');

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-waste-request', id] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };
}

export function WasteRequestDetail({ id, isAdmin, onClose }: { id: string; isAdmin: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-waste-request', id], queryFn: () => getWasteRequest(id) });
  const r = q.data;
  // Held here, not in the blocks: a refetch moves the request to a status that unmounts them.
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <section data-request-detail={id} className="space-y-4 rounded-control border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">{r ? `Yêu cầu ${r.code}` : 'Yêu cầu'}</h2>
        <button type="button" className={BTN_XS_SECONDARY} onClick={onClose}>Đóng</button>
      </div>
      {q.isPending && <p className="text-sm text-stone-600">Đang tải…</p>}
      {q.isError && <Notice tone="danger" role="alert">{errText(q.error)}</Notice>}
      {r && (
        <>
          <Header r={r} isAdmin={isAdmin} />
          {canCountRequest(r) ? (
            <>
              <CountingBlock key={r.id} r={r} onFlash={setFlash} />
              <RejectBlock r={r} onFlash={setFlash} />
            </>
          ) : (
            <LinesTable r={r} />
          )}
          {flash && <Notice tone="success" role="status">{flash}</Notice>}
          {isAdmin && <AdminActions r={r} onFlash={setFlash} />}
          {isAdmin && r.events && <EventLog events={r.events} />}
        </>
      )}
    </section>
  );
}

function Header({ r, isAdmin }: { r: WasteRequestAdminDetailDTO; isAdmin: boolean }) {
  const tracking = [r.carrier, r.trackingCode].filter((x): x is string => x !== null && x !== '').join(' · ');
  const rows: [string, string | null][] = [
    ['Cách giao', WASTE_METHOD_LABELS[r.method]],
    ['Trạng thái', WASTE_REQUEST_STATUS_LABELS[r.status]],
    ['Khách', [r.customerName, r.customerPhone].filter((x): x is string => x !== null && x !== '').join(' · ')],
    ['Điểm nhận', r.point?.name ?? r.pointName],
    ['Vận đơn', tracking || null],
    ['Đơn kèm', r.orderCode],
    ['Tạo lúc', formatDateTime(r.createdAt)],
    ['Gửi đi lúc', r.inTransitAt ? formatDateTime(r.inTransitAt) : null],
    ['Kho nhận lúc', r.receivedAt ? formatDateTime(r.receivedAt) : null],
    ['Hoàn tất lúc', r.completedAt ? formatDateTime(r.completedAt) : null],
    ['Điểm đã cộng', r.pointsAwarded !== null ? `${formatCount(r.pointsAwarded)} điểm` : null],
    [
      'Đã thu hồi',
      isAdmin && r.reversedPoints !== null
        ? `${formatCount(r.reversedPoints)} điểm${r.reversalShortfallPoints ? `, không thu được ${formatCount(r.reversalShortfallPoints)} điểm` : ''}`
        : null,
    ],
    ['Lý do từ chối', r.rejectionReason ? `${WASTE_REJECTION_REASON_LABELS[r.rejectionReason]}${r.rejectionNote ? `: ${r.rejectionNote}` : ''}` : null],
    ['Cân nặng thực nhận', r.receivedWeightGrams !== null ? `${formatCount(r.receivedWeightGrams)} gram` : null],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rows
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-36 shrink-0 text-xs font-medium text-stone-600">{k}</dt>
            <dd className="min-w-0 break-words text-stone-900">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function LinesTable({ r }: { r: WasteRequestAdminDetailDTO }) {
  return (
    <ScrollRegion label="Các dòng hàng của yêu cầu">
      <table className="w-full min-w-[480px] border-collapse">
        <thead>
          <tr className="border-b border-stone-200">
            <th className={TH}>Loại hàng</th>
            <th className={TH}>Khách khai</th>
            <th className={TH}>Thực nhận</th>
            <th className={TH}>Lý do thiếu</th>
            <th className={TH}>Điểm</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.itemId} className="border-b border-stone-100">
              <td className={TD}>{l.itemName}</td>
              <td className={TD}>{`${formatCount(l.declaredQty)} ${l.unitLabel}`}</td>
              <td className={TD}>{l.receivedQty !== null ? `${formatCount(l.receivedQty)} ${l.unitLabel}` : '—'}</td>
              <td className={TD}>{l.shortfallReason ? WASTE_SHORTFALL_REASON_LABELS[l.shortfallReason] : '—'}</td>
              <td className={TD}>{l.pointsAwarded !== null ? formatCount(l.pointsAwarded) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

const parseQty = (raw: string, max: number): number | null => {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
};

function CountingBlock({ r, onFlash }: { r: WasteRequestAdminDetailDTO; onFlash: (m: string | null) => void }) {
  const refresh = useRefresh(r.id);
  const { confirm, dialog } = useConfirm();
  // The server takes a hazardous item only as 0 with WRONG_TYPE (waste-confirm-lines), so those lines start there and stay locked.
  const [received, setReceived] = useState<Record<string, string>>(() => Object.fromEntries(r.lines.map((l) => [l.itemId, l.hazardous ? '0' : String(l.declaredQty)])));
  // Last valid count per line, so the points line never shows NaN while a field is mid-edit.
  const [lastValid, setLastValid] = useState<Record<string, number>>(() => Object.fromEntries(r.lines.map((l) => [l.itemId, l.hazardous ? 0 : l.declaredQty])));
  const [reasons, setReasons] = useState<Record<string, WasteShortfallReason | ''>>(() =>
    Object.fromEntries(r.lines.filter((l) => l.hazardous).map((l) => [l.itemId, 'WRONG_TYPE' as const])),
  );
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const inFlight = useRef(false);

  const save = useMutation({
    mutationFn: (body: WasteConfirmRequest) => confirmWasteRequest(r.id, body),
    onSuccess: (res) => {
      setResult(res.pointsAwarded);
      onFlash(`Đã cộng ${formatCount(res.pointsAwarded)} điểm cho khách.`);
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  // Hazardous comes from the live request: a refetch can flip it after the state initialisers ran.
  const parsed = r.lines.map((l) => ({ line: l, qty: l.hazardous ? 0 : parseQty(received[l.itemId] ?? '', l.declaredQty) }));
  const anyInvalid = parsed.some((p) => p.qty === null);
  const shortLines = parsed.filter((p) => p.qty !== null && p.qty < p.line.declaredQty);
  const missingReason = shortLines.some((p) => !p.line.hazardous && !reasons[p.line.itemId]);
  const weightTrim = weight.trim();
  const weightValid = weightTrim === '' || (/^\d+$/.test(weightTrim) && Number(weightTrim) >= 1 && Number(weightTrim) <= 100000);
  const total = wastePointsForLines(r.lines.map((l) => ({ receivedQty: l.hazardous ? 0 : (lastValid[l.itemId] ?? l.declaredQty), unitsPerPoint: l.unitsPerPoint, pointsPerGroup: l.pointsPerGroup })));
  const ready = !anyInvalid && !missingReason && weightValid && result === null;

  const setQty = (itemId: string, declaredQty: number, raw: string) => {
    setReceived((prev) => ({ ...prev, [itemId]: raw }));
    const n = parseQty(raw, declaredQty);
    if (n !== null) setLastValid((prev) => ({ ...prev, [itemId]: n }));
  };

  const submit = async () => {
    if (inFlight.current || save.isPending || !ready) return;
    inFlight.current = true;
    const ok = await confirm({ title: 'Xác nhận số đếm', message: `Cộng ${formatCount(total)} điểm cho khách?`, confirmLabel: 'Cộng điểm' });
    if (!ok) {
      inFlight.current = false;
      return;
    }
    setErr(null);
    onFlash(null);
    const lines: WasteConfirmLineInput[] = parsed.map(({ line, qty }) => {
      if (line.hazardous) return { itemId: line.itemId, declaredQty: line.declaredQty, receivedQty: 0, shortfallReason: 'WRONG_TYPE' };
      const reason = reasons[line.itemId];
      return qty! < line.declaredQty && reason
        ? { itemId: line.itemId, declaredQty: line.declaredQty, receivedQty: qty!, shortfallReason: reason }
        : { itemId: line.itemId, declaredQty: line.declaredQty, receivedQty: qty! };
    });
    const body: WasteConfirmRequest = { lines };
    if (weightTrim !== '') body.receivedWeightGrams = Number(weightTrim);
    save.mutate(body);
  };

  return (
    <div data-counting className={PANEL}>
      <h3 className="text-sm font-semibold text-stone-900">Đếm hàng thực nhận</h3>
      <div className="overflow-x-auto">
        <table data-counting-lines className="w-full min-w-[560px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className={`${TH} w-48`}>Loại hàng</th>
              <th className={`${TH} w-36`}>Khách khai</th>
              <th className={`${TH} w-28`}>Thực nhận</th>
              <th className={TH}>Lý do thiếu</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => {
              const qty = l.hazardous ? 0 : parseQty(received[l.itemId] ?? '', l.declaredQty);
              const reasonValue = l.hazardous ? 'WRONG_TYPE' : (reasons[l.itemId] ?? '');
              const isShort = qty !== null && qty < l.declaredQty;
              return (
                <tr key={l.itemId} className="border-b border-stone-100">
                  <td className={`${TD} font-medium text-stone-900`}>{l.itemName}</td>
                  <td className={`${TD} text-xs text-stone-600`}>{`Khách khai ${formatCount(l.declaredQty)} ${l.unitLabel}`}</td>
                  <td className={TD}>
                    <input
                      name={`received-${l.itemId}`}
                      type="text"
                      inputMode="numeric"
                      aria-label={`Thực nhận ${l.itemName}`}
                      className={`${FIELD_CLASS} w-24`}
                      value={l.hazardous ? '0' : (received[l.itemId] ?? '')}
                      disabled={l.hazardous}
                      onChange={(e) => setQty(l.itemId, l.declaredQty, e.target.value)}
                    />
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isShort && (
                        <select
                          name={`shortfall-${l.itemId}`}
                          aria-label={`Lý do thiếu ${l.itemName}`}
                          className={FIELD_CLASS}
                          value={reasonValue}
                          disabled={l.hazardous}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [l.itemId]: e.target.value as WasteShortfallReason | '' }))}
                        >
                          <option value="">Chọn lý do</option>
                          {SHORTFALL_KEYS.map((k) => <option key={k} value={k}>{WASTE_SHORTFALL_REASON_LABELS[k]}</option>)}
                        </select>
                      )}
                      {l.hazardous && <span className="text-xs text-danger-fg">Không nhận món này</span>}
                      {qty === null && <span className="text-xs text-danger-fg">{`Số thực nhận từ 0 tới ${formatCount(l.declaredQty)}`}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="block text-xs">
        <span className="block font-medium text-stone-700">Cân nặng thực nhận (gram, tuỳ chọn)</span>
        <input
          name="receivedWeightGrams"
          type="text"
          inputMode="numeric"
          className={`${INPUT_CLASS} mt-1 max-w-xs`}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      {!weightValid && <Notice tone="danger" role="alert">{WEIGHT_ERROR}</Notice>}
      <p className="text-sm font-medium text-stone-900">{`Điểm sẽ cộng: ${formatCount(total)}`}</p>
      {!anyInvalid && missingReason && <p className="text-xs text-stone-600">Chọn lý do cho dòng nhận thiếu</p>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <button type="button" className={BTN_PRIMARY} disabled={!ready || save.isPending} onClick={() => void submit()}>
        Xác nhận số đếm
      </button>
      {dialog}
    </div>
  );
}

function RejectBlock({ r, onFlash }: { r: WasteRequestAdminDetailDTO; onFlash: (m: string | null) => void }) {
  const refresh = useRefresh(r.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<WasteRejectionReason | ''>('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reject = useMutation({
    mutationFn: (body: WasteRejectRequest) => rejectWasteRequest(r.id, body),
    onSuccess: () => {
      setDone(true);
      onFlash('Đã từ chối yêu cầu.');
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const noteTrim = note.trim();
  const needsNote = reason === 'OTHER' && noteTrim === '';
  const ready = reason !== '' && !needsNote && !done;

  const submit = () => {
    if (inFlight.current || reject.isPending || !ready) return;
    inFlight.current = true;
    setErr(null);
    onFlash(null);
    const body: WasteRejectRequest = { rejectionReason: reason as WasteRejectionReason };
    if (noteTrim !== '') body.rejectionNote = noteTrim;
    reject.mutate(body);
  };

  if (!open) {
    return (
      <div>
        <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(true)}>Từ chối cả yêu cầu</button>
      </div>
    );
  }
  return (
    <div data-reject-panel className={PANEL}>
      <h3 className="text-sm font-semibold text-stone-900">Từ chối cả yêu cầu</h3>
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Lý do</span>
        <select
          name="rejectionReason"
          className={`${INPUT_CLASS} mt-1`}
          value={reason}
          onChange={(e) => setReason(e.target.value as WasteRejectionReason | '')}
        >
          <option value="">Chọn lý do</option>
          {REJECTION_KEYS.map((k) => <option key={k} value={k}>{WASTE_REJECTION_REASON_LABELS[k]}</option>)}
        </select>
      </label>
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Ghi chú</span>
        <textarea
          name="rejectionNote"
          rows={2}
          maxLength={NOTE_MAX}
          className={`${INPUT_CLASS} mt-1`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {needsNote && <p className="text-xs text-danger-fg">Ghi chú bắt buộc khi chọn Khác</p>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={!ready || reject.isPending} onClick={submit}>Xác nhận từ chối</button>
        <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(false)}>Huỷ</button>
      </div>
    </div>
  );
}

const canReverse = (r: WasteRequestAdminDetailDTO) => r.status === 'COMPLETED';
const canCloseLost = (r: WasteRequestAdminDetailDTO) =>
  (r.method === 'MAIL_IN' && r.status === 'IN_TRANSIT') || ((r.method === 'MAIL_IN' || r.method === 'PICKUP') && r.status === 'RECEIVED');
const canReopen = (r: WasteRequestAdminDetailDTO) =>
  r.status === 'EXPIRED' && (r.method === 'MAIL_IN' || (r.method === 'PICKUP' && r.orderId !== null));

function AdminActions({ r, onFlash }: { r: WasteRequestAdminDetailDTO; onFlash: (m: string | null) => void }) {
  const qc = useQueryClient();
  const refresh = useRefresh(r.id);
  const { ask, dialog } = useConfirm();
  const [reopening, setReopening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const inFlight = useRef(false);

  const onError = (e: unknown) => setErr(errText(e));
  const onSettled = () => {
    inFlight.current = false;
  };
  const reverse = useMutation({
    mutationFn: (reason: string) => reverseWasteRequest(r.id, { reason }),
    onSuccess: (res) => {
      onFlash(
        `Đã thu hồi ${formatCount(res.pointsTaken)} điểm.${res.shortfallPoints > 0 ? ` Còn ${formatCount(res.shortfallPoints)} điểm không thu được vì khách đã tiêu.` : ''}`,
      );
      refresh();
    },
    onError,
    onSettled,
  });
  const closeLost = useMutation({
    mutationFn: (reason: string) => closeLostWasteRequest(r.id, { reason }),
    onSuccess: () => {
      onFlash('Đã đóng yêu cầu vì thất lạc.');
      refresh();
    },
    onError,
    onSettled,
  });
  const reopen = useMutation({
    mutationFn: (body: WasteReopenRequest) => reopenWasteRequest(r.id, body),
    onSuccess: () => {
      setReopening(false);
      onFlash('Đã mở lại yêu cầu.');
      refresh();
      void qc.invalidateQueries({ queryKey: ['admin-waste-unmatched'] });
    },
    onError,
    onSettled,
  });
  const askReason = async (title: string, message: string, confirmLabel: string, run: (reason: string) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const reason = await ask({ title, message, confirmLabel, tone: 'danger', input: { label: 'Lý do', required: true, maxLength: NOTE_MAX } });
    if (!reason) {
      inFlight.current = false;
      return;
    }
    setErr(null);
    onFlash(null);
    run(reason);
  };
  const submitReopen = (body: WasteReopenRequest) => {
    if (inFlight.current || reopen.isPending) return;
    inFlight.current = true;
    setErr(null);
    onFlash(null);
    reopen.mutate(body);
  };

  const showCost = r.method !== 'DROP_OFF';
  if (!canReverse(r) && !canCloseLost(r) && !canReopen(r) && !showCost) return null;

  return (
    <div data-admin-actions className="space-y-3 border-t border-stone-200 pt-4">
      <h3 className="text-sm font-semibold text-stone-900">Thao tác của admin</h3>
      <div className="flex flex-wrap gap-2">
        {canReverse(r) && (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={reverse.isPending}
            onClick={() => void askReason('Thu hồi điểm', 'Chỉ thu được phần điểm khách chưa tiêu (10.3).', 'Thu hồi', reverse.mutate)}
          >
            Thu hồi điểm
          </button>
        )}
        {canCloseLost(r) && (
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={closeLost.isPending}
            onClick={() => void askReason('Đóng vì thất lạc', 'Yêu cầu sẽ đóng vì thất lạc và không được cộng điểm.', 'Đóng yêu cầu', closeLost.mutate)}
          >
            Đóng vì thất lạc
          </button>
        )}
        {canReopen(r) && (
          <button type="button" className={BTN_SECONDARY} aria-pressed={reopening} onClick={() => setReopening((v) => !v)}>
            Mở lại yêu cầu
          </button>
        )}
      </div>
      {reopening && <ReopenPanel requestId={r.id} busy={reopen.isPending} onSubmit={submitReopen} onCancel={() => setReopening(false)} />}
      {showCost && <CostForm key={r.carrierCostVnd ?? 'none'} r={r} onFlash={onFlash} onDone={refresh} />}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      {dialog}
    </div>
  );
}

function ReopenPanel({ requestId, busy, onSubmit, onCancel }: { requestId: string; busy: boolean; onSubmit: (b: WasteReopenRequest) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [unmatchedId, setUnmatchedId] = useState('');
  const unmatched = useQuery({ queryKey: ['admin-waste-unmatched', 'OPEN'], queryFn: () => listWasteUnmatched('OPEN') });
  // Server mở lại nhận mọi kiện OPEN: kiện ghi tay không có relatedRequestId, kiện quét theo mã của yêu cầu khác mang id yêu cầu đó, nên vẫn phải chọn được.
  const open = (unmatched.data ?? []).filter((u) => u.status === 'OPEN');
  const options = [...open.filter((u) => u.relatedRequestId === requestId), ...open.filter((u) => u.relatedRequestId !== requestId)];
  const reasonTrim = reason.trim();

  const submit = () => {
    if (reasonTrim === '') return;
    onSubmit(unmatchedId ? { reason: reasonTrim, unmatchedId } : { reason: reasonTrim });
  };

  return (
    <div data-reopen-panel className={PANEL}>
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Lý do mở lại *</span>
        <textarea
          name="reopenReason"
          rows={2}
          maxLength={NOTE_MAX}
          className={`${INPUT_CLASS} mt-1`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Gắn kiện không rõ chủ</span>
        <select name="reopenUnmatchedId" className={`${INPUT_CLASS} mt-1`} value={unmatchedId} onChange={(e) => setUnmatchedId(e.target.value)}>
          <option value="">Không gắn kiện</option>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {[
                u.description,
                [u.carrier, u.trackingCode].filter((x): x is string => x !== null && x !== '').join(' ') || null,
                formatDateTime(u.receivedAt),
                u.relatedRequestId === requestId ? 'liên quan tới yêu cầu này' : null,
              ]
                .filter((x): x is string => x !== null)
                .join(' · ')}
            </option>
          ))}
        </select>
      </label>
      {unmatched.isError && <Notice tone="danger" role="alert">{errText(unmatched.error)}</Notice>}
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={reasonTrim === '' || busy} onClick={submit}>Xác nhận mở lại</button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}

function CostForm({ r, onFlash, onDone }: { r: WasteRequestAdminDetailDTO; onFlash: (m: string | null) => void; onDone: () => void }) {
  const [cost, setCost] = useState(r.carrierCostVnd !== null ? String(r.carrierCostVnd) : '');
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const save = useMutation({
    mutationFn: (carrierCostVnd: number) => setWasteRequestCost(r.id, { carrierCostVnd }),
    onSuccess: () => {
      onFlash('Đã lưu phí ship.');
      onDone();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const trim = cost.trim();
  const valid = /^\d+$/.test(trim) && Number.isSafeInteger(Number(trim));
  const submit = () => {
    if (inFlight.current || save.isPending || !valid) return;
    inFlight.current = true;
    setErr(null);
    onFlash(null);
    save.mutate(Number(trim));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs">
          <span className="font-medium text-stone-700">Phí ship (đồng)</span>
          <input
            name="carrierCostVnd"
            type="text"
            inputMode="numeric"
            className={`${FIELD_CLASS} mt-1 block w-40`}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <button type="button" className={BTN_SECONDARY} disabled={!valid || save.isPending} onClick={submit}>Lưu phí ship</button>
      </div>
      {trim !== '' && !valid && <p className="text-xs text-danger-fg">Phí ship là số nguyên không âm</p>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
    </div>
  );
}

function EventLog({ events }: { events: AdminWasteEventDTO[] }) {
  return (
    <div className="space-y-2 border-t border-stone-200 pt-4">
      <h3 className="text-sm font-semibold text-stone-900">Nhật ký sự kiện</h3>
      <ul data-request-events className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="space-y-1 text-xs text-stone-700">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{formatDateTime(e.createdAt)}</span>
              <span className="font-medium text-stone-900">{wasteEventKindLabel(e.kind)}</span>
              <span>{wasteActorRoleLabel(e.actorRole)}</span>
            </div>
            {wasteEventMetaLines(e.meta).length > 0 && (
              <ul className="list-disc pl-5">
                {wasteEventMetaLines(e.meta).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
