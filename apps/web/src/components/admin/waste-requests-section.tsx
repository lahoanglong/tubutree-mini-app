'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminWasteRequestQuery, AdminWasteRequestRowDTO, WasteMatchInput, WasteReceiveResultDTO } from '@tubutree/shared-types';
import { createWasteUnmatched, listWasteRequests, lookupWasteRequests, receiveWasteRequest } from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import {
  WASTE_CLOSE_REASON_LABELS,
  WASTE_METHOD_LABELS,
  WASTE_REQUEST_STATUS_LABELS,
  WASTE_UNMATCHED_REASON_LABELS,
} from '@/lib/waste-labels';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, chipClass, FIELD_CLASS, FIELD_XS, INPUT_CLASS, Notice, ScrollRegion, ToneBadge } from './ui';
import type { WasteSeed } from './waste-tab';

export type WasteQueuePreset = 'toCount' | 'inTransit' | 'customerBlocked' | 'orderNotDelivered' | 'expired' | 'transitOverdue' | 'orderMismatch';

export const WASTE_QUEUE_PRESETS: readonly { key: WasteQueuePreset; label: string; query: AdminWasteRequestQuery; adminOnly: boolean }[] = [
  { key: 'toCount', label: 'Kho cần đếm', query: { filter: 'TO_COUNT' }, adminOnly: false },
  { key: 'inTransit', label: 'Đang gửi về kho', query: { method: 'MAIL_IN', status: 'IN_TRANSIT' }, adminOnly: false },
  { key: 'customerBlocked', label: 'Chờ vì khách bị khoá', query: { filter: 'CUSTOMER_BLOCKED' }, adminOnly: false },
  { key: 'orderNotDelivered', label: 'Chờ vì đơn chưa giao', query: { filter: 'ORDER_NOT_DELIVERED' }, adminOnly: false },
  { key: 'expired', label: 'Hết hạn', query: { filter: 'EXPIRED' }, adminOnly: false },
  { key: 'transitOverdue', label: 'Gửi kho quá hạn xem lại', query: { filter: 'TRANSIT_OVERDUE' }, adminOnly: true },
  { key: 'orderMismatch', label: 'Mâu thuẫn với đơn', query: { filter: 'ORDER_MISMATCH' }, adminOnly: true },
];

const WAITING_LABELS = { CUSTOMER_BLOCKED: 'Chờ: khách bị khoá', ORDER_NOT_DELIVERED: 'Chờ: đơn chưa giao' } as const;
const METHOD_KEYS = Object.keys(WASTE_METHOD_LABELS) as (keyof typeof WASTE_METHOD_LABELS)[];
const STATUS_KEYS = Object.keys(WASTE_REQUEST_STATUS_LABELS) as (keyof typeof WASTE_REQUEST_STATUS_LABELS)[];
const TH = 'px-2 py-2 text-left text-xs font-medium text-stone-600';
const TD = 'px-2 py-2 align-top text-sm text-stone-800';
const WEIGHT_ERROR = 'Cân nặng là số nguyên từ 1 tới 100000 gram';

const initialPreset = (isAdmin: boolean, seed?: WasteSeed | null): WasteQueuePreset => {
  if (seed?.section !== 'requests') return 'toCount';
  const found = WASTE_QUEUE_PRESETS.find((p) => p.key === seed.preset);
  return found && (isAdmin || !found.adminOnly) ? found.key : 'toCount';
};

const canReceive = (r: AdminWasteRequestRowDTO) =>
  (r.method === 'MAIL_IN' || (r.method === 'PICKUP' && r.orderCode !== null)) && r.status !== 'CANCELLED';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Thao tác thất bại.');

export function WasteRequestsSection({ isAdmin, seed }: { isAdmin: boolean; seed?: WasteSeed | null }) {
  const [preset, setPreset] = useState<WasteQueuePreset | null>(() => initialPreset(isAdmin, seed));
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const presets = WASTE_QUEUE_PRESETS.filter((p) => isAdmin || !p.adminOnly);

  const query: AdminWasteRequestQuery = (() => {
    const chosen = presets.find((p) => p.key === preset);
    if (chosen) return chosen.query;
    const q: AdminWasteRequestQuery = {};
    if (method) q.method = method as AdminWasteRequestQuery['method'];
    if (status) q.status = status as AdminWasteRequestQuery['status'];
    return q;
  })();

  const queue = useInfiniteQuery({
    queryKey: ['admin-waste-requests', query],
    queryFn: ({ pageParam }) => listWasteRequests(pageParam ? { ...query, cursor: pageParam } : query),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const lookup = useMutation({ mutationFn: (c: string) => lookupWasteRequests(c) });

  const queueRows = (queue.data?.pages ?? []).flatMap((p) => p.rows);
  const lookupRows = lookup.data ?? [];
  const receiving = receivingId ? ([...lookupRows, ...queueRows].find((r) => r.id === receivingId) ?? null) : null;

  const choosePreset = (key: WasteQueuePreset) => {
    setPreset(key);
    setMethod('');
    setStatus('');
  };
  const chooseMethod = (v: string) => {
    setPreset(null);
    setMethod(v);
  };
  const chooseStatus = (v: string) => {
    setPreset(null);
    setStatus(v);
  };
  const submitLookup = () => {
    const c = code.trim();
    if (c && !lookup.isPending) lookup.mutate(c);
  };

  return (
    <section className="space-y-4" aria-label="Yêu cầu đổi rác">
      <h3 className="font-display text-base font-semibold text-stone-900">Yêu cầu</h3>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitLookup();
        }}
      >
        <input
          type="text"
          className={`${FIELD_CLASS} w-72 max-w-full`}
          aria-label="Mã yêu cầu, mã đơn hoặc mã vận đơn"
          placeholder="Mã yêu cầu, mã đơn hoặc mã vận đơn"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className={BTN_PRIMARY} disabled={lookup.isPending || !code.trim()}>Tra</button>
      </form>
      {lookup.isError && <Notice tone="danger" role="alert">{errText(lookup.error)}</Notice>}
      {lookup.isSuccess && (
        <div data-lookup-results className="space-y-2">
          <h4 className="text-sm font-semibold text-stone-900">Kết quả tra mã</h4>
          <RequestTable label="Kết quả tra mã" rows={lookupRows} receivingId={receivingId} onReceive={setReceivingId} />
        </div>
      )}

      {receiving && (
        <ReceivePanel key={receiving.id} row={receiving} onClose={() => setReceivingId(null)} />
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Hàng đợi yêu cầu">
        {presets.map((p) => (
          <button key={p.key} type="button" aria-pressed={preset === p.key} className={chipClass(preset === p.key)} onClick={() => choosePreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={FIELD_XS} aria-label="Cách giao" value={method} onChange={(e) => chooseMethod(e.target.value)}>
          <option value="">Mọi cách giao</option>
          {METHOD_KEYS.map((m) => <option key={m} value={m}>{WASTE_METHOD_LABELS[m]}</option>)}
        </select>
        <select className={FIELD_XS} aria-label="Trạng thái" value={status} onChange={(e) => chooseStatus(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{WASTE_REQUEST_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {queue.isError && <Notice tone="danger" role="alert">Không tải được danh sách yêu cầu.</Notice>}
      <RequestTable label="Danh sách yêu cầu" rows={queueRows} receivingId={receivingId} onReceive={setReceivingId} />
      {queue.isSuccess && queueRows.length === 0 && <p className="text-sm text-stone-600">Không có yêu cầu nào trong hàng đợi này.</p>}
      {queue.hasNextPage && (
        <button type="button" className={BTN_SECONDARY} disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>
          Tải thêm
        </button>
      )}
    </section>
  );
}

function RequestTable({
  label,
  rows,
  receivingId,
  onReceive,
}: {
  label: string;
  rows: AdminWasteRequestRowDTO[];
  receivingId: string | null;
  onReceive: (id: string) => void;
}) {
  return (
    <ScrollRegion label={label}>
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="border-b border-stone-200">
            <th className={TH}>Mã</th>
            <th className={TH}>Cách giao · trạng thái</th>
            <th className={TH}>Điểm nhận</th>
            <th className={TH}>Khách</th>
            <th className={TH}>Vận đơn · đơn</th>
            <th className={TH}>Điểm</th>
            <th className={TH}>Tạo lúc</th>
            <th className={TH}>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tracking = [r.carrier, r.trackingCode].filter((x): x is string => x !== null && x !== '').join(' · ');
            return (
              <tr key={r.id} data-request={r.id} className="border-b border-stone-100">
                <td className={`${TD} font-medium text-stone-900`}>{r.code}</td>
                <td className={TD}>
                  <div>{WASTE_METHOD_LABELS[r.method]}</div>
                  <div className="text-xs text-stone-600">
                    {WASTE_REQUEST_STATUS_LABELS[r.status]}
                    {r.closeReason ? ` · ${WASTE_CLOSE_REASON_LABELS[r.closeReason]}` : ''}
                  </div>
                  {r.waitingReason && <div className="text-xs text-warning-fg">{WAITING_LABELS[r.waitingReason]}</div>}
                </td>
                <td className={TD}>{r.pointName}</td>
                <td className={TD}>
                  <div>{r.customerName}</div>
                  {r.customerPhone !== null && <div className="text-xs text-stone-600">{r.customerPhone}</div>}
                </td>
                <td className={TD}>
                  {tracking && <div>{tracking}</div>}
                  {r.orderCode && <div className="text-xs text-stone-600">{r.orderCode}</div>}
                  {r.trackingConflict && <ToneBadge tone="warning">Trùng mã vận đơn</ToneBadge>}
                </td>
                <td className={TD}>
                  {r.pointsAwarded !== null ? `${formatCount(r.pointsAwarded)} điểm đã cộng` : `${formatCount(r.estimatedPoints)} điểm ước tính`}
                </td>
                <td className={TD}>{formatDateTime(r.createdAt)}</td>
                <td className={TD}>
                  {canReceive(r) && (
                    <button type="button" className={BTN_XS_SECONDARY} aria-pressed={receivingId === r.id} onClick={() => onReceive(r.id)}>
                      Nhận kiện
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function ReceivePanel({ row, onClose }: { row: AdminWasteRequestRowDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const isMail = row.method === 'MAIL_IN';
  const [parcelCode, setParcelCode] = useState('');
  const [phoneMatchConfirmed, setPhoneMatchConfirmed] = useState(false);
  const [parcelTracking, setParcelTracking] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<WasteReceiveResultDTO | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const receiveInFlight = useRef(false);
  const unmatchedInFlight = useRef(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-unmatched'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };

  const receive = useMutation({
    mutationFn: (body: Parameters<typeof receiveWasteRequest>[1]) => receiveWasteRequest(row.id, body),
    onSuccess: (r) => {
      setResult(r);
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      receiveInFlight.current = false;
    },
  });
  const record = useMutation({
    mutationFn: () =>
      createWasteUnmatched({
        ...(row.carrier ? { carrier: row.carrier } : {}),
        ...(row.trackingCode ? { trackingCode: row.trackingCode } : {}),
        description: `Kiện thứ hai mang mã ${row.code}`,
      }),
    onSuccess: () => {
      setRecorded(true);
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      unmatchedInFlight.current = false;
    },
  });

  const weightTrim = weight.trim();
  const weightValid = weightTrim === '' || (/^\d+$/.test(weightTrim) && Number(weightTrim) >= 1 && Number(weightTrim) <= 100000);
  const code = parcelCode.trim();
  const hasMatch = code !== '' || phoneMatchConfirmed;
  const ready = weightValid && (!isMail || hasMatch);

  const submit = () => {
    if (receiveInFlight.current || receive.isPending || !ready) return;
    receiveInFlight.current = true;
    setErr(null);
    setResult(null);
    const body: Parameters<typeof receiveWasteRequest>[1] = {};
    if (isMail) {
      const match: WasteMatchInput = code !== '' ? { parcelCode: code } : { phoneMatchConfirmed: true };
      const tracking = parcelTracking.trim();
      if (tracking !== '') match.parcelTracking = tracking;
      body.match = match;
    }
    if (weightTrim !== '') body.receivedWeightGrams = Number(weightTrim);
    receive.mutate(body);
  };
  const submitUnmatched = () => {
    if (unmatchedInFlight.current || record.isPending || recorded) return;
    unmatchedInFlight.current = true;
    setErr(null);
    record.mutate();
  };

  return (
    <div data-receive-panel className="space-y-3 rounded-control border border-stone-200 bg-stone-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">{`Nhận kiện ${row.code}`}</h4>
        <button type="button" className={BTN_XS_SECONDARY} onClick={onClose}>Đóng</button>
      </div>
      {isMail && (
        <>
          <label className="block text-xs">
            <span className="font-medium text-stone-700">Mã TR- trên kiện</span>
            <input name="parcelCode" type="text" className={`${INPUT_CLASS} mt-1`} value={parcelCode} onChange={(e) => setParcelCode(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-sm text-stone-800">
            <input
              name="phoneMatchConfirmed"
              type="checkbox"
              className="mt-1"
              checked={phoneMatchConfirmed}
              onChange={(e) => setPhoneMatchConfirmed(e.target.checked)}
            />
            <span>Không có mã TR-, số điện thoại người gửi trên nhãn khớp số đã che</span>
          </label>
          <label className="block text-xs">
            <span className="font-medium text-stone-700">Mã vận đơn trên kiện (nếu có)</span>
            <input
              name="parcelTracking"
              type="text"
              maxLength={64}
              className={`${INPUT_CLASS} mt-1`}
              value={parcelTracking}
              onChange={(e) => setParcelTracking(e.target.value)}
            />
          </label>
        </>
      )}
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Cân nặng thực nhận (gram, tuỳ chọn)</span>
        <input
          name="receivedWeightGrams"
          type="text"
          inputMode="numeric"
          className={`${INPUT_CLASS} mt-1`}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      {!weightValid && <Notice tone="danger" role="alert">{WEIGHT_ERROR}</Notice>}
      {isMail && !hasMatch && <p className="text-xs text-stone-600">Nhập mã TR- trên kiện hoặc tick đối chiếu số điện thoại</p>}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      {result === null && (
        <button type="button" className={BTN_PRIMARY} disabled={!ready || receive.isPending} onClick={submit}>
          Xác nhận đã nhận kiện
        </button>
      )}
      {result?.outcome === 'RECEIVED' && (
        <Notice tone="success" role="status">{`Đã nhận kiện lúc ${formatDateTime(result.receivedAt).slice(0, 5)}. Mở màn đếm để đếm số thực nhận.`}</Notice>
      )}
      {result?.outcome === 'UNMATCHED' && (
        <Notice tone="warning" role="status">{`${WASTE_UNMATCHED_REASON_LABELS[result.reason]}: kiện đã chuyển vào hàng không rõ chủ`}</Notice>
      )}
      {result?.outcome === 'ALREADY_RECEIVED' && (
        <div className="space-y-2">
          <Notice tone="warning" role="status">
            {`Kiện này đã được nhận lúc ${formatDateTime(result.receivedAt).slice(0, 5)}. Nếu đây là kiện khác, hãy ghi vào hàng không rõ chủ.`}
          </Notice>
          {recorded ? (
            <Notice tone="success" role="status">Đã ghi vào hàng không rõ chủ.</Notice>
          ) : (
            <button type="button" className={BTN_SECONDARY} disabled={record.isPending} onClick={submitUnmatched}>
              Ghi vào hàng không rõ chủ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
