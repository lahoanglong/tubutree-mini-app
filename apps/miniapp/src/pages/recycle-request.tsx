import { pausedNote } from '@tubutree/app-core/waste-copy';
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Input, Page, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteRequestDetailDTO, WasteRequestLineDTO } from '@tubutree/shared-types';
import {
  WASTE_QUERY_KEYS,
  cancelWasteRequest,
  getWasteMe,
  getWastePoints,
  getWasteRequest,
  invalidateAfterWasteWrite,
  setWasteTracking,
} from '../services/waste-api';
import { getErrorMessage, isNotFoundError } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { QrCode } from '../components/qr-code';
import { SupportContact } from '../components/support-contact';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { Timeline } from '../components/ui/timeline';
import { openingStatus, todayHoursText } from '@tubutree/app-core/waste-hours';
import { copyText } from '../utils/clipboard';
import { formatDate, formatNumber, formatPoints } from '../utils/format';
import { formatPhoneDisplay } from '../utils/phone';
import { METHOD_LABELS, SHORTFALL_LABELS, TIMELINE_STEPS, closedLabel, dayMonth, pointAddress, isRequestPaused, requestStatusText, timelineFor } from '../utils/waste-labels';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;
const BLOCK: CSSProperties = {
  ...COLUMN,
  gap: 10,
  padding: 16,
  background: 'var(--color-bg-surface)',
  borderRadius: 'var(--radius-card)',
};
const CELL: CSSProperties = { textAlign: 'left', padding: '8px 4px', verticalAlign: 'top' };

const QR_POLL_MS = 5000;
const POINT_PAUSED = 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác';
const POINT_QUOTA_FULL = 'Điểm này tạm hết hạn mức tháng này, hãy chọn điểm khác';

export function DeclaredCountedTable({ lines }: { lines: readonly WasteRequestLineDTO[] }) {
  return (
    <table aria-label="Đã khai và đã đếm" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <th scope="col" style={CELL}>
            <Text variant="caption" tone="secondary" as="span">Món</Text>
          </th>
          <th scope="col" style={CELL}>
            <Text variant="caption" tone="secondary" as="span">Đã khai</Text>
          </th>
          <th scope="col" style={CELL}>
            <Text variant="caption" tone="secondary" as="span">Đã đếm</Text>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.itemId} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <td style={CELL}>
              <Text variant="body-sm" as="span">{l.itemName}</Text>
            </td>
            <td style={CELL}>
              <Text variant="body-sm" as="span">{`${formatNumber(l.declaredQty)} ${l.unitLabel}`}</Text>
            </td>
            <td style={CELL}>
              <Text variant="body-sm" as="span">
                {l.receivedQty == null ? '—' : `${formatNumber(l.receivedQty)} ${l.unitLabel}`}
              </Text>
              {l.shortfallReason && (
                <Text variant="caption" tone="secondary" as="div">{SHORTFALL_LABELS[l.shortfallReason]}</Text>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrackingForm({
  id,
  initialCarrier,
  initialCode,
  onDone,
}: {
  id: string;
  initialCarrier: string;
  initialCode: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [carrier, setCarrier] = useState(initialCarrier);
  const [code, setCode] = useState(initialCode);
  const m = useMutation({
    mutationFn: () => setWasteTracking(id, { carrier: carrier.trim(), trackingCode: code.trim() }),
    onSuccess: async () => {
      await invalidateAfterWasteWrite(qc);
      openSnackbar({ text: 'Đã lưu mã vận đơn', type: 'success' });
      onDone?.();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const ready = carrier.trim() !== '' && code.trim() !== '';
  return (
    <div style={{ ...COLUMN, gap: 10 }}>
      <Field label="Hãng">
        <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
      </Field>
      <Field label="Mã vận đơn">
        <Input value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button fullWidth disabled={!ready || m.isPending} loading={m.isPending} onPress={() => m.mutate()}>
        Đã gửi
      </Button>
    </div>
  );
}

export default function RecycleRequestPage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const { id = '' } = useParams();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();

  const [qrOpen, setQrOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editingTracking, setEditingTracking] = useState(false);

  useEffect(() => {
    if (phase === 'guest') navigate('/recycle', { replace: true });
  }, [phase, navigate]);

  const authed = phase === 'authenticated';
  // Mở mã QR ở quầy thì hỏi lại trạng thái mỗi 5 giây để thấy ngay lúc nhân viên xác nhận; dừng khi đóng tấm mã hoặc yêu cầu không còn chờ.
  const q = useQuery({
    queryKey: WASTE_QUERY_KEYS.request(id),
    queryFn: () => getWasteRequest(id),
    enabled: authed,
    refetchInterval: (query) => (qrOpen && query.state.data?.status === 'OPEN' ? QR_POLL_MS : false),
  });
  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: authed });
  const r: WasteRequestDetailDTO | undefined = q.data;
  const liveStatus = r?.status;
  useEffect(() => {
    if (!qrOpen || !liveStatus || liveStatus === 'OPEN') return;
    setQrOpen(false);
    if (liveStatus === 'COMPLETED') navigate(`/recycle/done/${id}`, { replace: true });
  }, [qrOpen, liveStatus, id, navigate]);
  const pointsQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.points(null),
    queryFn: () => getWastePoints(),
    enabled: authed && r?.method === 'DROP_OFF' && r.status === 'OPEN',
  });
  const cancel = useMutation({
    mutationFn: () => cancelWasteRequest(id),
    onSuccess: async () => {
      await invalidateAfterWasteWrite(qc);
      setCancelOpen(false);
      openSnackbar({ text: 'Đã huỷ yêu cầu', type: 'success' });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const shell = (content: ReactNode, title = 'Yêu cầu đổi rác', subtitle?: string) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={title} subtitle={subtitle} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>{content}</div>
    </Page>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (q.isError) {
    if (isNotFoundError(q.error)) {
      return shell(
        <EmptyState
          art="search"
          heading="Không tìm thấy yêu cầu"
          ctaLabel="Xem yêu cầu của tôi"
          onCta={() => navigate('/recycle/requests', { replace: true })}
        />,
      );
    }
    return shell(<ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />);
  }
  if (!r) return shell(<Skeleton height={120} />);

  const me = meQ.data;
  const open = r.status === 'OPEN';
  const editPath = `/recycle/r/${id}/edit`;
  const canEdit =
    r.editable &&
    cfg.waste.enabled &&
    me?.programmeEnabled !== false &&
    !me?.blocked &&
    !(r.method !== 'DROP_OFF' && me?.shipLockedAt);
  const t = timelineFor(r);
  const closed = t ? null : closedLabel(r);

  const pauseFacts = {
    programmeEnabled: me?.programmeEnabled,
    blocked: me?.blocked,
    shipLockedAt: me?.shipLockedAt,
    cfg: { enabled: cfg.waste.enabled, pickup: cfg.waste.pickup, isLoaded: cfg.isLoaded },
  };
  const paused = isRequestPaused(r, pauseFacts);
  const pausedPickup = paused && r.method === 'PICKUP';
  const dropOffPaused = paused && r.method === 'DROP_OFF';

  const quotaFull =
    r.method === 'DROP_OFF' &&
    open &&
    r.pointAvailable &&
    (pointsQ.data ?? []).some((p) => p.id === r.point?.id && p.quotaFull);

  const cancelButton = (
    <Button variant="ghost" fullWidth onPress={() => setCancelOpen(true)} style={{ color: 'var(--color-text-danger)' }}>
      Huỷ yêu cầu
    </Button>
  );
  const changePointButton = canEdit ? (
    <Button variant="secondary" fullWidth onPress={() => navigate(editPath)}>
      Đổi điểm nhận
    </Button>
  ) : null;

  const prep: string[] = [];
  for (const line of r.lines) {
    const text = me?.items.find((i) => i.id === line.itemId)?.prepInstructions;
    if (text && !prep.includes(text)) prep.push(text);
  }

  const recipient = r.point;
  const mailBlock =
    r.method === 'MAIL_IN' && open ? (
      <section style={BLOCK}>
        <Heading variant="display-md" as="p">{r.code}</Heading>
        <Text variant="body-sm">Ghi mã này lên kiện, mỗi kiện một yêu cầu</Text>
        {recipient && (
          <div data-recipient style={{ ...COLUMN, gap: 2 }}>
            <Text variant="body-md" style={{ fontWeight: 600 }}>{recipient.name}</Text>
            {recipient.phone && <Text variant="body-sm">{formatPhoneDisplay(recipient.phone)}</Text>}
            <Text variant="body-sm">{pointAddress(recipient)}</Text>
            <div style={{ marginTop: 8 }}>
              <Button
                variant="secondary"
                onPress={async () => {
                  if (await copyText([recipient.name, recipient.phone, pointAddress(recipient)].filter(Boolean).join('\n'))) {
                    openSnackbar({ text: 'Đã sao chép', type: 'success' });
                  }
                }}
              >
                Sao chép
              </Button>
            </div>
          </div>
        )}
        <Text variant="body-sm">Đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn</Text>
        <Text variant="body-sm">Kho từ chối kiện còn cước phải trả khi nhận</Text>
        <Text variant="body-sm" tone="secondary">{`Nhập mã vận đơn trước ${dayMonth(r.expiresAt ?? r.createdAt)}`}</Text>
        <TrackingForm id={id} initialCarrier={r.carrier ?? ''} initialCode={r.trackingCode ?? ''} />
      </section>
    ) : null;

  const pickupBlock =
    r.method === 'PICKUP' && open ? (
      <section style={BLOCK}>
        <Heading variant="display-md" as="p">{r.code}</Heading>
        <Text variant="body-sm">Ghi mã này lên túi</Text>
        {r.orderCode ? (
          <Text variant="body-md" style={{ fontWeight: 600 }}>{`Đã gắn vào đơn ${r.orderCode}`}</Text>
        ) : pausedPickup ? (
          <>
            <Text variant="body-sm">
              {`Yêu cầu này chưa gắn được vào đơn lúc này và sẽ tự hết hạn ngày ${dayMonth(r.expiresAt ?? r.createdAt)}`}
            </Text>
            {r.cancellable && cancelButton}
          </>
        ) : (
          <>
            <Text variant="body-sm">Gắn yêu cầu này vào đơn mua kế tiếp ở bước thanh toán</Text>
            <Button fullWidth onPress={() => navigate('/')}>Đi mua hàng</Button>
          </>
        )}
      </section>
    ) : null;

  const pointNotice =
    r.method === 'DROP_OFF' && open && (!r.pointAvailable || quotaFull) ? (
      <section style={BLOCK}>
        <Text variant="body-sm">{r.pointAvailable ? POINT_QUOTA_FULL : POINT_PAUSED}</Text>
        {changePointButton}
      </section>
    ) : null;

  const hoursLine = r.point ? [todayHoursText(r.point.openingHours, new Date()), openingStatus(r.point.openingHours, new Date()).text].filter(Boolean).join(' · ') : '';
  const stepHints =
    r.method === 'DROP_OFF' && open && r.point && r.pointAvailable && !quotaFull && !dropOffPaused
      ? {
          1: (
            <>
              <Text variant="caption" tone="secondary" as="span">{`Mang tới ${r.point.name} trước ${dayMonth(r.expiresAt ?? r.createdAt)}`}</Text>
              <Text variant="caption" tone="secondary" as="span">{pointAddress(r.point)}</Text>
              <Text variant="caption" tone="secondary" as="span">{hoursLine}</Text>
            </>
          ),
        }
      : undefined;
  const codeBlockShown = mailBlock !== null || pickupBlock !== null;

  return shell(
    <>
      {t && (
        <div>
          <Badge tone={paused ? 'warning' : 'brand'}>{requestStatusText(r, { blocked: !!me?.blocked, paused })}</Badge>
        </div>
      )}
      {mailBlock}
      {pickupBlock}
      {pointNotice}
      {paused && (
        <Text variant="body-sm" tone="secondary" as="p" style={{ margin: 0 }}>
          {pausedNote(r, pauseFacts, dayMonth(r.expiresAt ?? r.createdAt))}
        </Text>
      )}
      {t ? (
        <Timeline steps={TIMELINE_STEPS[r.method]} current={t.current} hints={stepHints} />
      ) : (
        closed && (
          <section style={{ ...COLUMN, gap: 4 }}>
            <Heading variant="title-md" as="h2">{closed.label}</Heading>
            {closed.reason && <Text variant="body-sm" tone="secondary">{closed.reason}</Text>}
          </section>
        )
      )}
      {open && (
        <div style={{ ...COLUMN, gap: 10 }}>
          {r.method === 'DROP_OFF' &&
            (dropOffPaused ? (
              <Text variant="body-sm">Tạm chưa mang tới điểm được</Text>
            ) : (
              <Button fullWidth onPress={() => setQrOpen(true)}>Xem mã QR</Button>
            ))}
          {canEdit && (
            <Button variant="secondary" fullWidth onPress={() => navigate(editPath)}>
              Sửa món
            </Button>
          )}
          {r.cancellable && !pausedPickup && cancelButton}
        </div>
      )}
      {r.method === 'MAIL_IN' && r.trackingCode && (
        <section style={BLOCK}>
          <Heading variant="title-md" as="h2">Vận chuyển</Heading>
          <Text variant="body-md">{`${r.carrier ?? ''} · ${r.trackingCode}`}</Text>
          {r.status === 'IN_TRANSIT' &&
            (editingTracking ? (
              <TrackingForm
                id={id}
                initialCarrier={r.carrier ?? ''}
                initialCode={r.trackingCode}
                onDone={() => setEditingTracking(false)}
              />
            ) : (
              <div>
                <Button variant="secondary" onPress={() => setEditingTracking(true)}>Sửa</Button>
              </div>
            ))}
        </section>
      )}
      <DeclaredCountedTable lines={r.lines} />
      {t && r.status !== 'COMPLETED' && r.estimatedPoints > 0 && (
        <Text variant="body-md" as="div" style={{ fontWeight: 600, textAlign: 'right' }}>{`Ước tính ${formatPoints(r.estimatedPoints)}`}</Text>
      )}
      {r.status === 'COMPLETED' && (
        <Button fullWidth onPress={() => navigate(`/recycle/done/${id}`)}>Xem kết quả cộng điểm</Button>
      )}
      <section style={{ ...COLUMN, gap: 8 }}>
        <SupportContact />
      </section>

      <BottomSheet
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Mã đổi rác"
        footer={
          <Button fullWidth onPress={() => setQrOpen(false)}>
            Theo dõi yêu cầu
          </Button>
        }
      >
        <div style={{ ...COLUMN, alignItems: 'center', gap: 10, textAlign: 'center' }}>
          {!r.pointAvailable && (
            <>
              <Text variant="body-sm">{POINT_PAUSED}</Text>
              {changePointButton}
            </>
          )}
          <QrCode value={r.code} />
          <Heading variant="display-md" as="p">{r.code}</Heading>
          {r.point && (
            <div style={{ ...COLUMN, gap: 2 }}>
              <Text variant="body-md" style={{ fontWeight: 600 }}>{r.point.name}</Text>
              <Text variant="body-sm" tone="secondary">{pointAddress(r.point)}</Text>
              <Text variant="body-sm" tone="secondary">{hoursLine}</Text>
            </div>
          )}
          <Text variant="body-sm">{`Giữ chỗ tới ${formatDate(r.expiresAt)}`}</Text>
          {prep.map((p) => (
            <Text key={p} variant="body-sm">{p}</Text>
          ))}
          <Text variant="body-sm" tone="secondary">
            Điểm chỉ cộng sau khi điểm nhận đếm xong theo số thực nhận, không vượt số đã khai
          </Text>
        </div>
      </BottomSheet>

      <BottomSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Huỷ yêu cầu này?"
        footer={
          <Button variant="danger" fullWidth loading={cancel.isPending} onPress={() => cancel.mutate()}>
            Xác nhận huỷ
          </Button>
        }
      >
        <Text variant="body-md">{`Mã ${r.code} sẽ hết hiệu lực. Bạn có thể tạo yêu cầu mới bất cứ lúc nào.`}</Text>
      </BottomSheet>
    </>,
    codeBlockShown ? 'Yêu cầu đổi rác' : r.code,
    METHOD_LABELS[r.method],
  );
}
