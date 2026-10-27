'use client';

import { HAZARDOUS_DESK_NOTES } from '@tubutree/app-core/waste-copy';
import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WasteConfirmLineInput,
  WasteDeskGiftDTO,
  WasteDeskPointDTO,
  WasteDeskRequestDTO,
  WasteMatchInput,
  WasteRejectionReason,
  WasteShortfallReason,
} from '@tubutree/shared-types';
import { normalizeWasteLookupCode } from '@tubutree/app-core/waste-code-input';
import { WASTE_QUERY_KEYS, deskConfirm, deskFulfilGift, deskLookup, deskReject } from '@tubutree/app-core/api/waste';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { deskPointsQuery } from '@tubutree/app-core/queries/waste';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatCount } from '@/lib/checkout-points';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Sheet } from '@/components/ui/sheet';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { loadErrorText } from '@/lib/error-text';
import { WasteDeskPerk, WasteDeskReport } from './recycle-desk-perk';
import { DESK_REJECTION_OPTIONS, METHOD_LABELS, PAUSED_TEXT, SHORTFALL_LABELS, formatPoints } from './recycle-labels';

const PATH = '/doi-rac/quay';
const CARD = `flex flex-col gap-3 p-4 max-md:gap-1 max-md:p-3 ${skin.card}`;
const NO_PERMISSION = 'Tài khoản này không có quyền nhận hàng tại điểm';
const DANGER_BTN =
  'inline-flex min-h-11 w-full items-center justify-center rounded-control border border-danger-fg bg-danger-bg px-5 text-sm font-semibold text-danger-fg transition active:scale-95 disabled:opacity-50 disabled:active:scale-100';

const GIFT_STATUS_TEXT: Record<Exclude<WasteDeskGiftDTO['status'], 'READY'>, string> = {
  FULFILLED: 'Quà đã được trao',
  CANCELLED: 'Lượt đổi quà đã huỷ',
};

interface DeskDone {
  code: string;
  customerName: string;
  pointsAwarded: number;
  /** Chỉ số máy chủ trả về; null khi điểm không giới hạn hạn mức. */
  remaining: { label: string; value: number } | null;
}

type DeskLine = WasteDeskRequestDTO['lines'][number];
type Notice = { text: string; ok: boolean };

const errText = (e: unknown) => (errorStatus(e) === 403 ? NO_PERMISSION : loadErrorText(e));

/** Ước tính phía máy khách: máy chủ vẫn áp trần và hạn mức khi xác nhận. */
export function deskPreviewPoints(
  lines: readonly { unitsPerPoint: number; pointsPerGroup: number }[],
  received: Readonly<Record<string, number>>,
  ids: readonly string[],
): number {
  return lines.reduce((sum, l, i) => {
    const qty = received[ids[i] as string] ?? 0;
    return sum + Math.floor(qty / l.unitsPerPoint) * l.pointsPerGroup;
  }, 0);
}

const isReadOnly = (r: WasteDeskRequestDTO) => r.status === 'COMPLETED' || r.status === 'REJECTED';

const isShort = (l: DeskLine, received: Readonly<Record<string, number>>) => (received[l.itemId] ?? 0) < l.declaredQty;

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Nhận hàng tại điểm" backHref="/doi-rac" backLabel="Đổi rác" />
      {children}
    </main>
  );
}

function QuotaCard({ point }: { point: WasteDeskPointDTO }) {
  if (point.kind === 'WAREHOUSE') {
    return (
      <section aria-label="Hạn mức" className={CARD}>
        <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{`Hôm nay còn xác nhận được ${formatCount(point.staffDailyCapRemaining)} điểm`}</p>
      </section>
    );
  }
  return (
    <section aria-label="Hạn mức" className={`${CARD} gap-1`}>
      <p className="text-sm text-stone-600">Hạn mức điểm tháng này</p>
      {point.quota ? (
        <>
          <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{`Đã dùng ${formatCount(point.quota.used)} / ${formatCount(point.quota.limit)} điểm`}</p>
          {point.quota.limit > 0 && <ProgressBar value={point.quota.used} max={point.quota.limit} ariaLabel="Mức dùng hạn mức điểm nhận rác" />}
          <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{`Còn lại ${formatCount(point.quota.remaining)} điểm`}</p>
        </>
      ) : (
        <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">Không giới hạn theo tháng</p>
      )}
    </section>
  );
}

function RejectSheet({
  open,
  onClose,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  error: unknown;
  onSubmit: (reason: WasteRejectionReason, note: string) => void;
}) {
  const [reason, setReason] = useState<WasteRejectionReason | null>(null);
  const [note, setNote] = useState('');
  const noteRequired = reason === 'OTHER';
  const ready = reason !== null && (!noteRequired || note.trim() !== '');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Từ chối cả yêu cầu"
      footer={
        <button
          type="button"
          className={DANGER_BTN}
          disabled={!ready || pending}
          onClick={() => {
            if (reason) onSubmit(reason, note.trim());
          }}
        >
          Từ chối yêu cầu
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Lý do từ chối" className="flex flex-col gap-1">
          {DESK_REJECTION_OPTIONS.map((o) => (
            <label key={o.value} className="flex min-h-11 items-center gap-2.5 text-base text-stone-900">
              <input
                type="radio"
                name="reject-reason"
                aria-label={o.label}
                checked={reason === o.value}
                onChange={() => setReason(o.value)}
                className="h-5 w-5 accent-forest-600"
              />
              <span aria-hidden="true">{o.label}</span>
            </label>
          ))}
        </div>
        {reason === null && <p className="text-sm text-stone-600">Chọn một lý do</p>}
        <Field label={noteRequired ? 'Ghi chú (bắt buộc với lý do Khác)' : 'Ghi chú (không bắt buộc)'}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={ui.field} />
        </Field>
        {error ? (
          <p role="alert" className={ui.error}>
            {errText(error)}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Thanh xác nhận: dính đáy trên điện thoại, nằm trong thẻ yêu cầu từ md; hai bản cùng nội dung. */
function ConfirmBar({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const body = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">{summary}</div>
      <div className="flex-none">{children}</div>
    </div>
  );
  return (
    <>
      <div data-desktop-action className="hidden md:block">
        {body}
      </div>
      <StickyActionBar label="Xác nhận đã nhận">{body}</StickyActionBar>
    </>
  );
}

function DeskBody({ points }: { points: WasteDeskPointDTO[] }) {
  const qc = useQueryClient();
  const [pointId, setPointId] = useState(points[0]!.id);
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<WasteDeskRequestDTO | null>(null);
  const [gift, setGift] = useState<WasteDeskGiftDTO | null>(null);
  const [lookedUpCode, setLookedUpCode] = useState('');
  const [received, setReceived] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, WasteShortfallReason | ''>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [done, setDone] = useState<DeskDone | null>(null);

  const point = points.find((p) => p.id === pointId) ?? points[0]!;

  const find = useMutation({
    mutationFn: (c: string) => deskLookup(coreHttp, c),
    onMutate: () => setNotice(null),
    onSuccess: (res, c) => {
      setLookup(res.type === 'REQUEST' ? res.request : null);
      setGift(res.type === 'GIFT' ? res.redemption : null);
      setLookedUpCode(c);
      setDone(null);
      setReceived(
        res.type === 'REQUEST' && !isReadOnly(res.request)
          ? Object.fromEntries(res.request.lines.map((l) => [l.itemId, l.declaredQty]))
          : {},
      );
      setReasons({});
    },
    onError: (e) => setNotice({ text: errText(e), ok: false }),
  });

  const request = lookup;
  const readOnly = !!request && isReadOnly(request);
  // Bưu kiện tra bằng mã TR- ghi trên kiện (cơ sở khớp TR_CODE); không có cơ sở khớp máy chủ trả 409 (spec 15.3, 15.5).
  const match: WasteMatchInput | undefined =
    request && request.method !== 'DROP_OFF' && request.status !== 'RECEIVED' ? { parcelCode: request.code } : undefined;

  const finish = () => {
    setLookup(null);
    void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.desk });
  };

  const confirm = useMutation({
    mutationFn: (req: WasteDeskRequestDTO) => {
      const lines: WasteConfirmLineInput[] = req.lines.map((l) => {
        const reason = reasons[l.itemId];
        return {
          itemId: l.itemId,
          declaredQty: l.declaredQty,
          receivedQty: received[l.itemId] ?? 0,
          ...(isShort(l, received) && reason ? { shortfallReason: reason } : {}),
        };
      });
      return deskConfirm(coreHttp, req.id, { lines, ...(match ? { match } : {}) });
    },
    onMutate: () => setNotice(null),
    onSuccess: (res, req) => {
      // Bưu kiện về kho có thể tra khi đang chọn tab đối tác: hạn mức mới thuộc điểm của yêu cầu, không phải tab đang chọn.
      const target = points.some((p) => p.id === req.pointId) ? req.pointId : point.id;
      qc.setQueryData<WasteDeskPointDTO[]>(WASTE_QUERY_KEYS.desk, (old) =>
        old?.map((p) => (p.id === target ? { ...p, quota: res.quota, staffDailyCapRemaining: res.staffDailyCapRemaining } : p)),
      );
      const targetPoint = points.find((p) => p.id === target) ?? point;
      setDone({
        code: req.code,
        customerName: req.customerName,
        pointsAwarded: res.pointsAwarded,
        remaining: res.quota
          ? { label: 'Hạn mức còn lại', value: res.quota.remaining }
          : targetPoint.kind === 'WAREHOUSE'
            ? { label: 'Còn được xác nhận hôm nay', value: res.staffDailyCapRemaining }
            : null,
      });
      setCode('');
      finish();
    },
    onError: (e) => setNotice({ text: errText(e), ok: false }),
  });

  const reject = useMutation({
    mutationFn: (v: { req: WasteDeskRequestDTO; reason: WasteRejectionReason; note: string }) =>
      deskReject(coreHttp, v.req.id, {
        rejectionReason: v.reason,
        ...(v.note ? { rejectionNote: v.note } : {}),
        ...(match ? { match } : {}),
      }),
    onSuccess: (res) => {
      setNotice({ text: `Đã từ chối yêu cầu ${res.code}`, ok: true });
      setRejectOpen(false);
      finish();
    },
  });

  const fulfil = useMutation({
    mutationFn: (v: { code: string; pointId: string; giftName: string }) => deskFulfilGift(coreHttp, { code: v.code, pointId: v.pointId }),
    onMutate: () => setNotice(null),
    onSuccess: (_res, v) => {
      setGift(null);
      setNotice({ text: `Đã trao ${v.giftName}`, ok: true });
    },
    onError: (e) => setNotice({ text: errText(e), ok: false }),
  });

  const missingReason = !!request && request.lines.some((l) => isShort(l, received) && !reasons[l.itemId]);
  const preview = request ? deskPreviewPoints(request.lines, received, request.lines.map((l) => l.itemId)) : 0;
  const search = () => {
    const norm = normalizeWasteLookupCode(code);
    if (norm === '' || find.isPending) return;
    setCode(norm);
    find.mutate(norm);
  };

  return (
    <div className="flex flex-col gap-4">
      {points.length > 1 && (
        <SegmentedTabs scroll value={pointId} onChange={setPointId} items={points.map((p) => ({ key: p.id, label: p.name }))} label="Điểm nhận" />
      )}
      {points.length === 1 && <p className="text-sm text-stone-600 md:hidden">{point.name}</p>}
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start">
        <div className="flex flex-col gap-4 max-md:order-2">
          {points.length === 1 && <p className="text-sm text-stone-600 max-md:hidden">{point.name}</p>}
          <QuotaCard point={point} />
          {point.kind === 'PARTNER' && (
            <p className="text-sm text-stone-600">Tubu cộng điểm cho khách theo số bạn xác nhận. Điểm không do cửa hàng cộng.</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <Field label="Mã yêu cầu hoặc mã nhận quà">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: TR-6NY3J"
                autoCapitalize="characters"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') search();
                }}
                className={ui.field}
              />
            </Field>
            <button type="button" className={`${ui.btnPrimary} w-full`} disabled={code.trim() === '' || find.isPending} onClick={search}>
              Tra mã
            </button>
          </div>

          {notice && (
            <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'text-sm font-semibold text-success-fg' : ui.error}>
              {notice.text}
            </p>
          )}

          {done && (
            <section role="status" className={`${CARD} items-center text-center`}>
              <CheckCircle2 className="h-8 w-8 text-forest-600" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold text-stone-900">{`Đã ghi nhận. Tubu sẽ cộng ${formatPoints(done.pointsAwarded)} cho khách`}</h2>
              <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{`Yêu cầu ${done.code} của ${done.customerName} đã xong`}</p>
              {done.remaining && <p className="text-sm text-stone-600">{`${done.remaining.label}: ${formatPoints(done.remaining.value)}`}</p>}
              <button
                type="button"
                className={`${skin.btnSecondary} w-full`}
                onClick={() => {
                  setDone(null);
                  setCode('');
                  setLookup(null);
                  setGift(null);
                }}
              >
                Nhận yêu cầu khác
              </button>
            </section>
          )}

          {request && (
            <section aria-label={`Yêu cầu ${request.code}`} className={CARD}>
              <div className="flex flex-col gap-0.5">
                <h2 className="font-display text-lg font-semibold text-stone-900">{request.code}</h2>
                <p className="text-sm text-stone-600">{METHOD_LABELS[request.method]}</p>
                <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{request.customerName}</p>
                {request.customerPhone && <p className="text-sm text-stone-600">{request.customerPhone}</p>}
              </div>

              {readOnly && (
                <p className={`text-base font-semibold ${request.status === 'COMPLETED' ? 'text-success-fg' : 'text-danger-fg'}`}>
                  {request.status === 'COMPLETED' ? 'Đã xác nhận' : 'Đã từ chối'}
                </p>
              )}

              {request.lines.map((l) => (
                <div key={l.itemId} data-line className="flex flex-col gap-1.5">
                  <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{l.itemName}</p>
                  {readOnly ? (
                    request.status === 'COMPLETED' && <p className="text-sm text-stone-600">{`Đã nhận ${l.receivedQty ?? 0} ${l.unitLabel}`}</p>
                  ) : (
                    <>
                      <p className="text-sm text-stone-600">{`Khách khai ${l.declaredQty} ${l.unitLabel}`}</p>
                      {l.hazardous && HAZARDOUS_DESK_NOTES.map((t) => <p key={t} className="text-sm text-danger-fg">{t}</p>)}
                        <>
                          <div className="flex items-center gap-3">
                            <QuantitySelector
                              size="sm"
                              min={0}
                              max={l.declaredQty}
                              value={received[l.itemId] ?? 0}
                              onChange={(n) => setReceived((r) => ({ ...r, [l.itemId]: n }))}
                            />
                            <span className="text-xs text-stone-600">{`Tối đa ${l.declaredQty}`}</span>
                          </div>
                          {isShort(l, received) && (
                            <div className="flex flex-col gap-1">
                              <p className="text-sm text-stone-600">Lý do nhận thiếu</p>
                              <div className="relative">
                                <select
                                  aria-label={`Lý do nhận thiếu: ${l.itemName}`}
                                  value={reasons[l.itemId] ?? ''}
                                  onChange={(e) => setReasons((r) => ({ ...r, [l.itemId]: e.target.value as WasteShortfallReason | '' }))}
                                  className={`${ui.field} appearance-none pr-10`}
                                >
                                  <option value="" disabled>
                                    Chọn lý do
                                  </option>
                                  {Object.entries(SHORTFALL_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
                              </div>
                            </div>
                          )}
                        </>
                    </>
                  )}
                </div>
              ))}

              {!readOnly && (
                <>
                  <ConfirmBar
                    summary={
                      <div className="flex flex-col gap-0.5">
                        <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{`Điểm Tubu sẽ cộng cho khách: ${formatPoints(preview)}`}</p>
                        {missingReason && <p className="text-sm text-stone-600">Chọn lý do cho món nhận thiếu để xác nhận</p>}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className={`${ui.btnPrimary} w-full`}
                      disabled={missingReason || confirm.isPending}
                      onClick={() => confirm.mutate(request)}
                    >
                      Xác nhận đã nhận
                    </button>
                  </ConfirmBar>
                  <button
                    type="button"
                    className={`${skin.btnSecondary} w-full`}
                    onClick={() => {
                      reject.reset();
                      setRejectOpen(true);
                    }}
                  >
                    Từ chối cả yêu cầu
                  </button>
                </>
              )}
            </section>
          )}

          {gift && (
            <section aria-label={gift.giftName} className={CARD}>
              <div className="flex flex-col gap-0.5">
                <h2 className="font-display text-lg font-semibold text-stone-900">{gift.giftName}</h2>
                <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">{gift.customerName}</p>
                {gift.claimExpiresAt && <p className="text-sm text-stone-600">{`Hạn nhận ${formatDate(gift.claimExpiresAt)}`}</p>}
              </div>
              {!point.giftHandoverEnabled ? (
                <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] text-stone-900">Điểm này không trao quà</p>
              ) : gift.status !== 'READY' ? (
                <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{GIFT_STATUS_TEXT[gift.status]}</p>
              ) : (
                <button
                  type="button"
                  className={`${ui.btnPrimary} w-full`}
                  disabled={fulfil.isPending}
                  onClick={() => fulfil.mutate({ code: lookedUpCode, pointId: point.id, giftName: gift.giftName })}
                >
                  Trao quà
                </button>
              )}
            </section>
          )}

          <WasteDeskPerk key={point.id} point={point} />
          <WasteDeskReport pointId={point.id} />
        </div>
      </div>

      {request && (
        <RejectSheet
          key={request.id}
          open={rejectOpen}
          onClose={() => setRejectOpen(false)}
          pending={reject.isPending}
          error={reject.error}
          onSubmit={(reason, note) => reject.mutate({ req: request, reason, note })}
        />
      )}
    </div>
  );
}

function DeskContent() {
  const pointsQ = useQuery(deskPointsQuery(coreHttp));
  const cfg = usePublicConfig();
  if (pointsQ.isPending) return <Skeleton height={120} rounded="rounded-card" />;
  if (pointsQ.isError) {
    if (errorStatus(pointsQ.error) === 403) {
      return (
        <div className={`flex flex-col items-center gap-3 p-8 text-center ${skin.card}`}>
          <p className="text-base max-md:text-[length:var(--type-body-md-size)] max-md:leading-[var(--type-body-md-lh)] font-semibold text-stone-900">{NO_PERMISSION}</p>
          <Link href="/doi-rac" className={ui.btnPrimary}>
            Về Đổi rác
          </Link>
        </div>
      );
    }
    return <ErrorState message={errText(pointsQ.error)} onRetry={() => void pointsQ.refetch()} />;
  }
  if (pointsQ.data.length === 0) {
    // Máy chủ bỏ qua điểm của đại lý khi chương trình tắt, nên danh sách rỗng lúc đó không có nghĩa là mất quyền.
    if (!cfg.isLoaded) return <Skeleton height={120} rounded="rounded-card" />;
    const text = cfg.waste.enabled ? 'Tài khoản của bạn chưa được gắn với điểm nhận nào' : PAUSED_TEXT;
    return <p className={`${skin.card} p-8 text-center text-base text-stone-900`}>{text}</p>;
  }
  return <DeskBody points={pointsQ.data} />;
}

export function RecycleDesk() {
  const phase = useAuthPhase();
  if (phase === 'loading') return <Shell><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell><LoginRequired message="Đăng nhập để nhận hàng tại điểm." returnTo={PATH} /></Shell>;
  return (
    <Shell>
      <DeskContent />
    </Shell>
  );
}
