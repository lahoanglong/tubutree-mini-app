'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteRequestDetailDTO } from '@tubutree/shared-types';
import { WASTE_WRITE_INVALIDATE_KEYS, cancelWasteRequest, setWasteTracking } from '@tubutree/app-core/api/waste';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { wasteMeQuery, wastePointsQuery, wasteRequestQuery } from '@tubutree/app-core/queries/waste';
import { openingStatus, todayHoursText } from '@tubutree/app-core/waste-hours';
import { friendlyError as errText } from '@/lib/friendly-error';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { QrCode } from '@/components/ui/qr-code';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { DeclaredCountedTable } from './declared-counted-table';
import { SupportContact } from '@/components/support-contact';
import { RecycleTimeline } from './recycle-timeline';
import {
  METHOD_LABELS,
  PAUSED_TEXT,
  TIMELINE_STEPS,
  closedLabel,
  dayMonth,
  formatPoints,
  isRequestPaused,
  pointAddress,
  requestStatusText,
  timelineFor,
} from './recycle-labels';

const QR_POLL_MS = 5000;
const POINT_PAUSED = 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác';
const POINT_QUOTA_FULL = 'Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác';
const BLOCK = `flex flex-col gap-2.5 p-4 ${skin.card}`;
const DANGER_BTN =
  'inline-flex min-h-11 w-full items-center justify-center rounded-control border border-danger-fg bg-danger-bg px-5 text-sm font-semibold text-danger-fg transition active:scale-95 disabled:opacity-50 disabled:active:scale-100';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useRefreshAfterWrite() {
  const qc = useQueryClient();
  return () => Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

function TrackingForm({
  id,
  initialCarrier,
  initialCode,
  onSaved,
  onDone,
}: {
  id: string;
  initialCarrier: string;
  initialCode: string;
  onSaved: () => void;
  onDone?: () => void;
}) {
  const refresh = useRefreshAfterWrite();
  const [carrier, setCarrier] = useState(initialCarrier);
  const [code, setCode] = useState(initialCode);
  const m = useMutation({
    mutationFn: () => setWasteTracking(coreHttp, id, { carrier: carrier.trim(), trackingCode: code.trim() }),
    onSuccess: async () => {
      await refresh();
      onSaved();
      onDone?.();
    },
  });
  const ready = carrier.trim() !== '' && code.trim() !== '';
  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Hãng">
        <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className={ui.field} />
      </Field>
      <Field label="Mã vận đơn">
        <input value={code} onChange={(e) => setCode(e.target.value)} className={ui.field} />
      </Field>
      {m.isError && (
        <p role="alert" className={ui.error}>
          {errText(m.error)}
        </p>
      )}
      <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!ready || m.isPending} onClick={() => m.mutate()}>
        Đã gửi
      </button>
    </div>
  );
}

function Shell({ children, title = 'Yêu cầu đổi rác', subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title={title} subtitle={subtitle} backHref="/doi-rac/yeu-cau" backLabel="Yêu cầu của tôi" />
      {children}
    </main>
  );
}

export function RecycleRequestDetail({ id }: { id: string }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const refresh = useRefreshAfterWrite();
  const path = `/doi-rac/yeu-cau/${id}`;
  const editPath = `${path}/sua`;

  const [qrOpen, setQrOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editingTracking, setEditingTracking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const authed = phase === 'authenticated';
  // Mở mã QR ở quầy thì hỏi lại trạng thái mỗi 5 giây để thấy ngay lúc nhân viên xác nhận; dừng khi đóng tấm mã hoặc yêu cầu không còn chờ.
  const q = useQuery({
    ...wasteRequestQuery(coreHttp, id),
    enabled: authed,
    refetchInterval: (query) => (qrOpen && query.state.data?.status === 'OPEN' ? QR_POLL_MS : false),
  });
  const liveStatus = q.data?.status;
  useEffect(() => {
    if (!qrOpen || !liveStatus || liveStatus === 'OPEN') return;
    setQrOpen(false);
    if (liveStatus === 'COMPLETED') router.replace(`/doi-rac/xong/${id}`);
  }, [qrOpen, liveStatus, id, router]);
  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const r: WasteRequestDetailDTO | undefined = q.data;
  const pointsQ = useQuery({
    ...wastePointsQuery(coreHttp, null),
    enabled: authed && r?.method === 'DROP_OFF' && r.status === 'OPEN',
  });
  const cancel = useMutation({
    mutationFn: () => cancelWasteRequest(coreHttp, id),
    onSuccess: async () => {
      await refresh();
      setCancelOpen(false);
      setNotice({ text: 'Đã huỷ yêu cầu', ok: true });
    },
  });

  if (phase === 'loading') return <Shell><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell><LoginRequired message="Đăng nhập để xem yêu cầu đổi rác của bạn." returnTo={path} /></Shell>;
  if (q.isError) {
    if (errorStatus(q.error) === 404) {
      return (
        <Shell>
          <div className={`flex flex-col items-center gap-3 p-8 text-center ${skin.card}`}>
            <p className="text-base font-semibold text-stone-900">Không tìm thấy yêu cầu</p>
            <Link href="/doi-rac/yeu-cau" className={ui.btnPrimary}>
              Xem yêu cầu của tôi
            </Link>
          </div>
        </Shell>
      );
    }
    return <Shell><ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} /></Shell>;
  }
  if (!r) return <Shell><Skeleton height={120} rounded="rounded-card" /></Shell>;

  const me = meQ.data;
  const open = r.status === 'OPEN';
  const canEdit =
    r.editable &&
    cfg.waste.enabled &&
    me?.programmeEnabled !== false &&
    !me?.blocked &&
    !(r.method !== 'DROP_OFF' && me?.shipLockedAt);
  const t = timelineFor(r);
  const closed = t ? null : closedLabel(r);

  const paused = isRequestPaused(r, {
    programmeEnabled: me?.programmeEnabled,
    blocked: me?.blocked,
    shipLockedAt: me?.shipLockedAt,
    cfg: { enabled: cfg.waste.enabled, pickup: cfg.waste.pickup, isLoaded: cfg.isLoaded },
  });
  const pausedPickup = paused && r.method === 'PICKUP';
  const dropOffPaused = paused && r.method === 'DROP_OFF';
  const quotaFull =
    r.method === 'DROP_OFF' && open && r.pointAvailable && (pointsQ.data ?? []).some((p) => p.id === r.point?.id && p.quotaFull);

  const cancelButton = (
    <button
      type="button"
      className="inline-flex min-h-11 w-full items-center justify-center rounded-control px-5 text-sm font-semibold text-danger-fg transition active:scale-95"
      onClick={() => {
        cancel.reset();
        setCancelOpen(true);
      }}
    >
      Huỷ yêu cầu
    </button>
  );
  const changePointLink = canEdit ? (
    <Link href={editPath} className={`${skin.btnSecondary} w-full`}>
      Đổi điểm nhận
    </Link>
  ) : null;

  const prep: string[] = [];
  for (const line of r.lines) {
    const text = me?.items.find((i) => i.id === line.itemId)?.prepInstructions;
    if (text && !prep.includes(text)) prep.push(text);
  }

  const recipient = r.point;
  const mailBlock =
    r.method === 'MAIL_IN' && open ? (
      <section className={BLOCK}>
        <p className="font-display text-2xl font-semibold text-stone-900">{r.code}</p>
        <p className="text-sm text-stone-800">Ghi mã này lên kiện, mỗi kiện một yêu cầu</p>
        {recipient && (
          <div data-recipient className="flex flex-col gap-0.5">
            <p className="text-base font-semibold text-stone-900">{recipient.name}</p>
            {recipient.phone && <p className="text-sm text-stone-800">{formatPhoneDisplay(recipient.phone)}</p>}
            <p className="text-sm text-stone-800">{pointAddress(recipient)}</p>
            <div className="mt-2">
              <button
                type="button"
                className={skin.btnSecondary}
                onClick={async () => {
                  const ok = await copyText([recipient.name, recipient.phone, pointAddress(recipient)].filter(Boolean).join('\n'));
                  setNotice(ok ? { text: 'Đã sao chép', ok } : { text: 'Không sao chép được, hãy chọn và chép thủ công.', ok });
                }}
              >
                Sao chép
              </button>
            </div>
          </div>
        )}
        <p className="text-sm text-stone-800">Đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn</p>
        <p className="text-sm text-stone-800">Kho từ chối kiện còn cước phải trả khi nhận</p>
        <p className="text-sm text-stone-600">{`Nhập mã vận đơn trước ${dayMonth(r.expiresAt ?? r.createdAt)}`}</p>
        <TrackingForm
          id={id}
          initialCarrier={r.carrier ?? ''}
          initialCode={r.trackingCode ?? ''}
          onSaved={() => setNotice({ text: 'Đã lưu mã vận đơn', ok: true })}
        />
      </section>
    ) : null;

  const pickupBlock =
    r.method === 'PICKUP' && open ? (
      <section className={BLOCK}>
        <p className="font-display text-2xl font-semibold text-stone-900">{r.code}</p>
        <p className="text-sm text-stone-800">Ghi mã này lên túi</p>
        {r.orderCode ? (
          <p className="text-base font-semibold text-stone-900">{`Đã gắn vào đơn ${r.orderCode}`}</p>
        ) : pausedPickup ? (
          <>
            <p className="text-sm text-stone-800">
              {`Thu kèm rác đang tạm dừng, yêu cầu này chưa gắn được vào đơn và sẽ tự hết hạn ngày ${dayMonth(r.expiresAt ?? r.createdAt)}`}
            </p>
            {r.cancellable && cancelButton}
          </>
        ) : (
          <>
            <p className="text-sm text-stone-800">Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán</p>
            <Link href="/" className={`${ui.btnPrimary} w-full`}>
              Đi mua hàng
            </Link>
          </>
        )}
      </section>
    ) : null;

  const pointNotice =
    r.method === 'DROP_OFF' && open && (!r.pointAvailable || quotaFull) ? (
      <section className={BLOCK}>
        <p className="text-sm text-stone-800">{r.pointAvailable ? POINT_QUOTA_FULL : POINT_PAUSED}</p>
        {changePointLink}
      </section>
    ) : null;

  const hoursLine = r.point ? [todayHoursText(r.point.openingHours, new Date()), openingStatus(r.point.openingHours, new Date()).text].filter(Boolean).join(' · ') : '';
  const stepHints =
    r.method === 'DROP_OFF' && open && r.point && r.pointAvailable && !quotaFull && !dropOffPaused
      ? {
          1: (
            <>
              <span className="text-xs text-stone-600">{`Mang tới ${r.point.name} trước ${dayMonth(r.expiresAt ?? r.createdAt)}`}</span>
              <span className="text-xs text-stone-600">{pointAddress(r.point)}</span>
              <span className="text-xs text-stone-600">{hoursLine}</span>
            </>
          ),
        }
      : undefined;
  const codeBlockShown = mailBlock !== null || pickupBlock !== null;

  return (
    <Shell title={codeBlockShown ? 'Yêu cầu đổi rác' : r.code} subtitle={METHOD_LABELS[r.method]}>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'text-sm font-semibold text-success-fg' : ui.error}>
          {notice.text}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          {t && (
            <div>
              <Badge tone={paused ? 'warning' : 'brand'}>{requestStatusText(r, { blocked: !!me?.blocked, paused })}</Badge>
            </div>
          )}
          {mailBlock}
          {pickupBlock}
          {pointNotice}
          {paused && (
            <p className="text-sm text-stone-600">{`${PAUSED_TEXT}. Yêu cầu sẽ hết hạn ngày ${dayMonth(r.expiresAt ?? r.createdAt)} nếu chương trình chưa mở lại.`}</p>
          )}
          {t ? (
            <RecycleTimeline steps={TIMELINE_STEPS[r.method]} current={t.current} hints={stepHints} />
          ) : (
            closed && (
              <section className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-stone-900">{closed.label}</h2>
                {closed.reason && <p className="text-sm text-stone-600">{closed.reason}</p>}
              </section>
            )
          )}
          {open && (
            <div className="flex flex-col gap-2.5">
              {r.method === 'DROP_OFF' &&
                (dropOffPaused ? (
                  <p className="text-sm text-stone-800">{PAUSED_TEXT}</p>
                ) : (
                  <button type="button" className={`${ui.btnPrimary} w-full`} onClick={() => setQrOpen(true)}>
                    Xem mã QR
                  </button>
                ))}
              {canEdit && (
                <Link href={editPath} className={`${skin.btnSecondary} w-full`}>
                  Sửa món
                </Link>
              )}
              {r.cancellable && !pausedPickup && cancelButton}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {r.method === 'MAIL_IN' && r.trackingCode && (
            <section className={BLOCK}>
              <h2 className="text-base font-semibold text-stone-900">Vận chuyển</h2>
              <p className="text-base text-stone-900">{`${r.carrier ?? ''} · ${r.trackingCode}`}</p>
              {r.status === 'IN_TRANSIT' &&
                (editingTracking ? (
                  <TrackingForm
                    id={id}
                    initialCarrier={r.carrier ?? ''}
                    initialCode={r.trackingCode}
                    onSaved={() => setNotice({ text: 'Đã lưu mã vận đơn', ok: true })}
                    onDone={() => setEditingTracking(false)}
                  />
                ) : (
                  <div>
                    <button type="button" className={skin.btnSecondary} onClick={() => setEditingTracking(true)}>
                      Sửa
                    </button>
                  </div>
                ))}
            </section>
          )}
          <DeclaredCountedTable lines={r.lines} />
          {t && r.status !== 'COMPLETED' && r.estimatedPoints > 0 && (
            <p className="text-right text-base font-semibold text-stone-900">{`Ước tính ${formatPoints(r.estimatedPoints)}`}</p>
          )}
          {r.status === 'COMPLETED' && (
            <Link href={`/doi-rac/xong/${id}`} className={`${ui.btnPrimary} w-full`}>
              Xem kết quả cộng điểm
            </Link>
          )}
          <section className="flex flex-col gap-2">
            <SupportContact />
          </section>
        </div>
      </div>

      <Sheet
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Mã đổi rác"
        footer={
          <button type="button" className={`${ui.btnPrimary} w-full`} onClick={() => setQrOpen(false)}>
            Theo dõi yêu cầu
          </button>
        }
      >
        <div className="flex flex-col items-center gap-2.5 text-center">
          {!r.pointAvailable && (
            <>
              <p className="text-sm text-stone-800">{POINT_PAUSED}</p>
              {changePointLink}
            </>
          )}
          <QrCode value={r.code} />
          <p className="font-display text-2xl font-semibold text-stone-900">{r.code}</p>
          {r.point && (
            <div className="flex flex-col gap-0.5">
              <p className="text-base font-semibold text-stone-900">{r.point.name}</p>
              <p className="text-sm text-stone-600">{pointAddress(r.point)}</p>
              <p className="text-sm text-stone-600">{hoursLine}</p>
            </div>
          )}
          <p className="text-sm text-stone-800">{`Giữ chỗ tới ${formatDate(r.expiresAt)}`}</p>
          {prep.map((p) => (
            <p key={p} className="text-sm text-stone-800">
              {p}
            </p>
          ))}
          <p className="text-sm text-stone-600">Điểm chỉ cộng sau khi điểm nhận đếm xong theo số thực nhận, không vượt số đã khai</p>
        </div>
      </Sheet>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Huỷ yêu cầu này?"
        footer={
          <button type="button" className={DANGER_BTN} disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            Xác nhận huỷ
          </button>
        }
      >
        <p className="text-sm text-stone-800">{`Mã ${r.code} sẽ hết hiệu lực. Bạn có thể tạo yêu cầu mới bất cứ lúc nào.`}</p>
        {cancel.isError ? (
          <p role="alert" className={ui.error}>
            {errText(cancel.error)}
          </p>
        ) : null}
      </Sheet>
    </Shell>
  );
}
