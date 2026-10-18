'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminWasteRequestQuery,
  AdminWasteRequestRowDTO,
  WasteMatchInput,
  WasteReceiveResultDTO,
  WasteUnmatchedDTO,
  WasteUnmatchedResolveRequest,
  WasteUnmatchedStatus,
} from '@tubutree/shared-types';
import {
  createWasteUnmatched,
  listWasteRequests,
  listWasteUnmatched,
  lookupWasteRequests,
  receiveWasteRequest,
  resolveWasteUnmatched,
} from '@/lib/admin-client';
import { formatCount } from '@/lib/checkout-points';
import { formatDateTime } from '@/lib/format-date';
import {
  WASTE_CLOSE_REASON_LABELS,
  WASTE_METHOD_LABELS,
  WASTE_REQUEST_STATUS_LABELS,
  WASTE_UNMATCHED_REASON_LABELS,
} from '@/lib/waste-labels';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_XS_SECONDARY, chipClass, FIELD_CLASS, FIELD_XS, INPUT_CLASS, Notice, ScrollRegion, ToneBadge } from './ui';
import { useConfirm } from './confirm-dialog';
import type { WasteSeed } from './waste-tab';
import { WasteRequestDetail } from './waste-request-detail';

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

const startsOnUnmatched = (seed?: WasteSeed | null) => seed?.section === 'requests' && seed.preset === 'unmatched';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Thao tác thất bại.');

const CUSTOMER_CHIP_LABEL = 'Yêu cầu của khách đang xem';

export function WasteRequestsSection({ isAdmin, seed, initialUserId }: { isAdmin: boolean; seed?: WasteSeed | null; initialUserId?: string | null }) {
  const customerId = isAdmin && initialUserId ? initialUserId : null;
  const [customerOn, setCustomerOn] = useState(customerId !== null);
  const [view, setView] = useState<'queue' | 'unmatched'>(() => (!customerId && startsOnUnmatched(seed) ? 'unmatched' : 'queue'));
  const [preset, setPreset] = useState<WasteQueuePreset | null>(() => (customerId ? null : initialPreset(isAdmin, seed)));
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [receiving, setReceiving] = useState<AdminWasteRequestRowDTO | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const presets = WASTE_QUEUE_PRESETS.filter((p) => isAdmin || !p.adminOnly);
  const staffPresets = presets.filter((p) => !p.adminOnly);
  const adminPresets = presets.filter((p) => p.adminOnly);

  const query: AdminWasteRequestQuery = (() => {
    if (customerOn && customerId) return { userId: customerId };
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
    enabled: view === 'queue',
  });
  const lookup = useMutation({ mutationFn: (c: string) => lookupWasteRequests(c) });

  const queueRows = (queue.data?.pages ?? []).flatMap((p) => p.rows);
  const lookupRows = lookup.data ?? [];

  const choosePreset = (key: WasteQueuePreset) => {
    setCustomerOn(false);
    setView('queue');
    setPreset(key);
    setMethod('');
    setStatus('');
  };
  const chooseMethod = (v: string) => {
    setCustomerOn(false);
    setPreset(null);
    setMethod(v);
  };
  const chooseStatus = (v: string) => {
    setCustomerOn(false);
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
          <RequestTable label="Kết quả tra mã" rows={lookupRows} receivingId={receiving?.id ?? null} onReceive={setReceiving} openId={openId} onOpen={setOpenId} />
        </div>
      )}

      {receiving && (
        <ReceivePanel key={receiving.id} row={receiving} onClose={() => setReceiving(null)} />
      )}

      {openId && <WasteRequestDetail key={openId} id={openId} isAdmin={isAdmin} onClose={() => setOpenId(null)} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Hàng đợi yêu cầu">
        {customerId && <PresetChip label={CUSTOMER_CHIP_LABEL} pressed={view === 'queue' && customerOn} onClick={() => { setView('queue'); setCustomerOn(true); setPreset(null); setMethod(''); setStatus(''); }} />}
        {staffPresets.map((p) => <PresetChip key={p.key} label={p.label} pressed={view === 'queue' && !customerOn && preset === p.key} onClick={() => choosePreset(p.key)} />)}
        <PresetChip label="Hàng không rõ chủ" pressed={view === 'unmatched'} onClick={() => setView('unmatched')} />
        {adminPresets.map((p) => <PresetChip key={p.key} label={p.label} pressed={view === 'queue' && !customerOn && preset === p.key} onClick={() => choosePreset(p.key)} />)}
      </div>

      {view === 'unmatched' ? (
        <UnmatchedView isAdmin={isAdmin} />
      ) : (
        <>
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
          <RequestTable label="Danh sách yêu cầu" rows={queueRows} receivingId={receiving?.id ?? null} onReceive={setReceiving} openId={openId} onOpen={setOpenId} />
          {queue.isSuccess && queueRows.length === 0 && <p className="text-sm text-stone-600">Không có yêu cầu nào trong hàng đợi này.</p>}
          {queue.hasNextPage && (
            <button type="button" className={BTN_SECONDARY} disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>
              Tải thêm
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PresetChip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} className={chipClass(pressed)} onClick={onClick}>
      {label}
    </button>
  );
}

function RequestTable({
  label,
  rows,
  receivingId,
  onReceive,
  openId,
  onOpen,
}: {
  label: string;
  rows: AdminWasteRequestRowDTO[];
  receivingId: string | null;
  onReceive: (row: AdminWasteRequestRowDTO) => void;
  openId: string | null;
  onOpen: (id: string) => void;
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
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className={BTN_XS_SECONDARY} aria-pressed={openId === r.id} onClick={() => onOpen(r.id)}>
                      Mở
                    </button>
                    {canReceive(r) && (
                      <button type="button" className={BTN_XS_SECONDARY} aria-pressed={receivingId === r.id} onClick={() => onReceive(r)}>
                        Nhận kiện
                      </button>
                    )}
                  </div>
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
    const match: WasteMatchInput = {};
    if (code !== '') match.parcelCode = code;
    else if (isMail) match.phoneMatchConfirmed = true;
    const tracking = parcelTracking.trim();
    if (isMail && tracking !== '') match.parcelTracking = tracking;
    if (Object.keys(match).length > 0) body.match = match;
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
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Mã TR- trên kiện</span>
        <input name="parcelCode" type="text" className={`${INPUT_CLASS} mt-1`} value={parcelCode} onChange={(e) => setParcelCode(e.target.value)} />
      </label>
      {isMail && (
        <>
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

const DESCRIPTION_MAX = 200;
const NOTE_MAX = 500;
const TR_CONFLICT_ADMIN_ONLY = 'Chỉ admin khớp được kiện này';

function UnmatchedView({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [status, setStatus] = useState<WasteUnmatchedStatus>('OPEN');
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // React Query re-renders only after a zero-delay timer, so a second synchronous click still sees the button enabled.
  const createInFlight = useRef(false);
  const resolveInFlight = useRef(false);

  const list = useQuery({
    queryKey: ['admin-waste-unmatched', status],
    queryFn: () => (status === 'OPEN' ? listWasteUnmatched() : listWasteUnmatched(status)),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-waste-unmatched'] });
    void qc.invalidateQueries({ queryKey: ['admin-waste-requests'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };

  const create = useMutation({
    mutationFn: createWasteUnmatched,
    onSuccess: () => {
      setCarrier('');
      setTrackingCode('');
      setDescription('');
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      createInFlight.current = false;
    },
  });
  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: WasteUnmatchedResolveRequest }) => resolveWasteUnmatched(id, body),
    onSuccess: () => {
      setMatchingId(null);
      refresh();
    },
    onError: (e) => setErr(errText(e)),
    onSettled: () => {
      resolveInFlight.current = false;
    },
  });

  const descTrim = description.trim();
  const descTooLong = descTrim.length > DESCRIPTION_MAX;
  const canCreate = descTrim !== '' && !descTooLong;

  const submitCreate = () => {
    if (createInFlight.current || create.isPending || !canCreate) return;
    createInFlight.current = true;
    setErr(null);
    const body: Parameters<typeof createWasteUnmatched>[0] = { description: descTrim };
    if (carrier.trim() !== '') body.carrier = carrier.trim();
    if (trackingCode.trim() !== '') body.trackingCode = trackingCode.trim();
    create.mutate(body);
  };
  const submitResolve = (id: string, body: WasteUnmatchedResolveRequest) => {
    if (resolveInFlight.current || resolve.isPending) return;
    resolveInFlight.current = true;
    setErr(null);
    resolve.mutate({ id, body });
  };
  const closeParcel = async (id: string) => {
    const note = await ask({
      title: 'Đóng kiện không rõ chủ',
      message: 'Kiện sẽ rời hàng đợi.',
      confirmLabel: 'Đóng kiện',
      input: { label: 'Ghi chú', required: true, maxLength: NOTE_MAX },
    });
    if (note) submitResolve(id, { action: 'CLOSE', note });
  };

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <form
        data-unmatched-form
        className="space-y-3 rounded-control border border-stone-200 bg-stone-0 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submitCreate();
        }}
      >
        <h4 className="text-sm font-semibold text-stone-900">Ghi kiện không rõ chủ</h4>
        <p className="text-xs text-stone-600">Chỉ mô tả kiện, không ghi tên hay số điện thoại người gửi.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-medium text-stone-700">Hãng vận chuyển (tuỳ chọn)</span>
            <input name="carrier" type="text" className={`${INPUT_CLASS} mt-1`} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-stone-700">Mã vận đơn (tuỳ chọn)</span>
            <input name="trackingCode" type="text" className={`${INPUT_CLASS} mt-1`} value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} />
          </label>
        </div>
        <label className="block text-xs">
          <span className="font-medium text-stone-700">Mô tả kiện</span>
          <input name="description" type="text" className={`${INPUT_CLASS} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {descTooLong && <p className="text-xs text-danger-fg">{`Mô tả tối đa ${DESCRIPTION_MAX} ký tự`}</p>}
        <button type="submit" className={BTN_PRIMARY} disabled={!canCreate || create.isPending}>Ghi kiện</button>
      </form>

      {err && <Notice tone="danger" role="alert">{err}</Notice>}

      <label className="flex items-center gap-2 text-sm text-stone-800">
        <input
          name="showResolved"
          type="checkbox"
          checked={status === 'RESOLVED'}
          onChange={(e) => {
            setMatchingId(null);
            setStatus(e.target.checked ? 'RESOLVED' : 'OPEN');
          }}
        />
        <span>Xem kiện đã xử lý</span>
      </label>

      {list.isError && <Notice tone="danger" role="alert">Không tải được danh sách kiện không rõ chủ.</Notice>}
      {list.isSuccess && rows.length === 0 && (
        <p className="text-sm text-stone-600">{status === 'OPEN' ? 'Không có kiện nào đang chờ xử lý.' : 'Chưa có kiện nào đã xử lý.'}</p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <UnmatchedRow
            key={r.id}
            row={r}
            isAdmin={isAdmin}
            matching={matchingId === r.id}
            busy={resolve.isPending}
            onMatch={() => setMatchingId(matchingId === r.id ? null : r.id)}
            onClose={() => void closeParcel(r.id)}
            onSubmitMatch={(requestId, note) => submitResolve(r.id, { action: 'MATCH', requestId, note })}
          />
        ))}
      </ul>
      {dialog}
    </div>
  );
}

function UnmatchedRow({
  row,
  isAdmin,
  matching,
  busy,
  onMatch,
  onClose,
  onSubmitMatch,
}: {
  row: WasteUnmatchedDTO;
  isAdmin: boolean;
  matching: boolean;
  busy: boolean;
  onMatch: () => void;
  onClose: () => void;
  onSubmitMatch: (requestId: string, note: string) => void;
}) {
  const tracking = [row.carrier, row.trackingCode].filter((x): x is string => x !== null && x !== '').join(' · ');
  const open = row.status === 'OPEN';
  const adminOnly = row.reason === 'TR_TRACKING_CONFLICT' && !isAdmin;
  return (
    <li data-unmatched={row.id} className="space-y-2 rounded-control border border-stone-200 bg-stone-0 p-3 text-sm text-stone-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-stone-900">{formatDateTime(row.receivedAt)}</span>
        {tracking && <span>{tracking}</span>}
      </div>
      <div>{row.description}</div>
      <div className="text-xs text-stone-600">{WASTE_UNMATCHED_REASON_LABELS[row.reason]}</div>
      {!open && (
        <div className="text-xs text-stone-600">
          {row.resolvedAt ? `Đã xử lý lúc ${formatDateTime(row.resolvedAt)}` : 'Đã xử lý'}
          {row.resolveNote ? ` · ${row.resolveNote}` : ''}
        </div>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {adminOnly ? (
            <span className="text-xs text-stone-600">{TR_CONFLICT_ADMIN_ONLY}</span>
          ) : (
            <button type="button" className={BTN_XS_SECONDARY} aria-pressed={matching} onClick={onMatch}>Khớp yêu cầu</button>
          )}
          <button type="button" className={BTN_XS_SECONDARY} disabled={busy} onClick={onClose}>Đóng</button>
        </div>
      )}
      {open && matching && !adminOnly && <MatchPanel busy={busy} onSubmit={onSubmitMatch} />}
    </li>
  );
}

function MatchPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (requestId: string, note: string) => void }) {
  const [code, setCode] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const lookup = useMutation({
    mutationFn: (c: string) => lookupWasteRequests(c),
    onMutate: () => setPicked(null),
  });
  const found = lookup.data ?? [];
  const noteTrim = note.trim();
  const ready = picked !== null && noteTrim !== '' && !busy;

  const submitLookup = () => {
    const c = code.trim();
    if (c && !lookup.isPending) lookup.mutate(c);
  };

  return (
    <div data-match-panel className="space-y-3 rounded-control border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <input
          name="matchCode"
          type="text"
          className={`${FIELD_CLASS} w-72 max-w-full`}
          aria-label="Mã yêu cầu, mã đơn hoặc mã vận đơn để khớp"
          placeholder="Mã yêu cầu, mã đơn hoặc mã vận đơn"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitLookup();
            }
          }}
        />
        <button type="button" className={BTN_SECONDARY} disabled={lookup.isPending || !code.trim()} onClick={submitLookup}>Tra</button>
      </div>
      {lookup.isError && <Notice tone="danger" role="alert">{errText(lookup.error)}</Notice>}
      {lookup.isSuccess && (
        <fieldset data-match-results className="space-y-1">
          <legend className="text-xs font-medium text-stone-700">Chọn yêu cầu của kiện này</legend>
          {found.map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-sm text-stone-800">
              <input type="radio" name="matchRequest" className="mt-1" value={r.id} checked={picked === r.id} onChange={() => setPicked(r.id)} />
              <span>
                {`${r.code} · ${WASTE_METHOD_LABELS[r.method]} · ${WASTE_REQUEST_STATUS_LABELS[r.status]} · ${r.customerName}`}
                {r.customerPhone !== null ? ` · ${r.customerPhone}` : ''}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="block text-xs">
        <span className="font-medium text-stone-700">Ghi chú *</span>
        <textarea
          name="resolveNote"
          required
          rows={2}
          maxLength={NOTE_MAX}
          className={`${INPUT_CLASS} mt-1`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={BTN_PRIMARY}
        disabled={!ready}
        onClick={() => {
          if (picked !== null && noteTrim !== '') onSubmit(picked, noteTrim);
        }}
      >
        Xác nhận khớp
      </button>
    </div>
  );
}
