import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Input, Page, useSnackbar } from 'zmp-ui';
import { CheckCircle2, ChevronDown, ScanLine } from 'lucide-react';
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
import { WASTE_QUERY_KEYS, deskConfirm, deskFulfilGift, deskLookup, deskReject, getDeskPoints } from '../services/waste-api';
import { getErrorMessage } from '../services/api';
import { extractWasteLookupCode, normalizeWasteLookupCode } from '@tubutree/app-core/waste-code-input';
import { scanCode } from '../services/zmp-bridge';
import { usePublicConfig } from '../hooks/use-public-config';
import { AuthGate } from '../components/ui/auth-gate';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { ProgressBar } from '../components/ui/progress-bar';
import { PageHeader } from '../components/ui/page-header';
import { WasteDeskPerk, WasteDeskReport } from '../components/waste-desk-perk';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { Heading, Text } from '../components/ui/text';
import { formatDate, formatNumber, formatPoints } from '../utils/format';
import { DESK_REJECTION_OPTIONS, METHOD_LABELS, PAUSED_TEXT, SHORTFALL_LABELS } from '../utils/waste-labels';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;
const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  width: '100%',
  height: 44,
  padding: '0 40px 0 12px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  font: 'inherit',
};

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

function QuotaCard({ point }: { point: WasteDeskPointDTO }) {
  if (point.kind === 'WAREHOUSE') {
    return (
      <Card>
        <Text variant="body-md" as="div">{`Hôm nay còn xác nhận được ${formatNumber(point.staffDailyCapRemaining)} điểm`}</Text>
      </Card>
    );
  }
  return (
    <Card>
      <div style={{ ...COLUMN, gap: 4 }}>
        <Text variant="body-sm" tone="secondary" as="div">Hạn mức điểm tháng này</Text>
        {point.quota ? (
          <>
            <Text variant="body-md" as="div">{`Đã dùng ${formatNumber(point.quota.used)} / ${formatNumber(point.quota.limit)} điểm`}</Text>
            {point.quota.limit > 0 && <ProgressBar value={point.quota.used} max={point.quota.limit} />}
            <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{`Còn lại ${formatNumber(point.quota.remaining)} điểm`}</Text>
          </>
        ) : (
          <Text variant="body-md" as="div">Không giới hạn theo tháng</Text>
        )}
      </div>
    </Card>
  );
}

function RejectSheet({
  open,
  onClose,
  pending,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onSubmit: (reason: WasteRejectionReason, note: string) => void;
}) {
  const [reason, setReason] = useState<WasteRejectionReason | null>(null);
  const [note, setNote] = useState('');
  const noteRequired = reason === 'OTHER';
  const ready = reason !== null && (!noteRequired || note.trim() !== '');
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Từ chối cả yêu cầu"
      footer={
        <Button
          fullWidth
          variant="danger"
          disabled={!ready}
          loading={pending}
          onPress={() => {
            if (reason) onSubmit(reason, note.trim());
          }}
        >
          Từ chối yêu cầu
        </Button>
      }
    >
      <div style={{ ...COLUMN, gap: 12 }}>
        <div role="radiogroup" aria-label="Lý do từ chối" style={{ ...COLUMN, gap: 4 }}>
          {DESK_REJECTION_OPTIONS.map((o) => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <input
                type="radio"
                name="reject-reason"
                aria-label={o.label}
                checked={reason === o.value}
                onChange={() => setReason(o.value)}
              />
              <Text variant="body-md">{o.label}</Text>
            </label>
          ))}
        </div>
        {reason === null && <Text variant="body-sm" tone="secondary" as="div">Chọn một lý do</Text>}
        <Field label={noteRequired ? 'Ghi chú (bắt buộc với lý do Khác)' : 'Ghi chú (không bắt buộc)'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </BottomSheet>
  );
}

function DeskBody({ points }: { points: WasteDeskPointDTO[] }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [pointId, setPointId] = useState(points[0]!.id);
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<WasteDeskRequestDTO | null>(null);
  const [gift, setGift] = useState<WasteDeskGiftDTO | null>(null);
  const [lookedUpCode, setLookedUpCode] = useState('');
  const [received, setReceived] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, WasteShortfallReason | ''>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [done, setDone] = useState<DeskDone | null>(null);
  const [scanning, setScanning] = useState(false);

  const point = points.find((p) => p.id === pointId) ?? points[0]!;

  const find = useMutation({
    mutationFn: (c: string) => deskLookup(c),
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
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const search = () => {
    const norm = normalizeWasteLookupCode(code);
    if (norm === '' || find.isPending) return;
    setCode(norm);
    find.mutate(norm);
  };

  const scan = async () => {
    if (scanning || find.isPending) return;
    setScanning(true);
    try {
      const res = await scanCode();
      if (res.kind === 'cancelled') return;
      const scanned = res.kind === 'ok' ? extractWasteLookupCode(res.content) : null;
      if (scanned) {
        setCode(scanned);
        find.mutate(scanned);
      } else {
        openSnackbar({ text: res.kind === 'ok' ? 'Mã QR này không phải mã Đổi rác. Hãy quét lại hoặc gõ mã bên dưới.' : 'Chưa quét được. Hãy thử lại hoặc gõ mã bên dưới.', type: 'error' });
      }
    } finally {
      setScanning(false);
    }
  };

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
      return deskConfirm(req.id, { lines, ...(match ? { match } : {}) });
    },
    onSuccess: (res, req) => {
      openSnackbar({ text: `Tubu sẽ cộng ${formatPoints(res.pointsAwarded)} cho khách`, type: 'success' });
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
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const reject = useMutation({
    mutationFn: (v: { req: WasteDeskRequestDTO; reason: WasteRejectionReason; note: string }) =>
      deskReject(v.req.id, {
        rejectionReason: v.reason,
        ...(v.note ? { rejectionNote: v.note } : {}),
        ...(match ? { match } : {}),
      }),
    onSuccess: (res) => {
      openSnackbar({ text: `Đã từ chối yêu cầu ${res.code}`, type: 'success' });
      setRejectOpen(false);
      finish();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const fulfil = useMutation({
    mutationFn: (v: { code: string; pointId: string; giftName: string }) => deskFulfilGift({ code: v.code, pointId: v.pointId }),
    onSuccess: (_res, v) => {
      setGift(null);
      openSnackbar({ text: `Đã trao ${v.giftName}`, type: 'success' });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const missingReason = !!request && request.lines.some((l) => isShort(l, received) && !reasons[l.itemId]);
  const preview = request
    ? deskPreviewPoints(request.lines, received, request.lines.map((l) => l.itemId))
    : 0;

  return (
    <div style={{ ...COLUMN, gap: 16 }}>
      {points.length > 1 && (
        <SegmentedTabs scroll value={pointId} onChange={setPointId} items={points.map((p) => ({ key: p.id, label: p.name }))} />
      )}
      {points.length === 1 && <Text variant="body-sm" tone="secondary" as="div">{point.name}</Text>}
      <div style={{ ...COLUMN, gap: 10 }}>
        <Button size="lg" fullWidth icon={ScanLine} loading={scanning} onPress={scan}>
          Quét mã của khách
        </Button>
        <form
          style={{ ...COLUMN, gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Field label="Mã yêu cầu hoặc mã nhận quà">
            <Input placeholder="VD: TR-6NY3J" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button fullWidth variant="secondary" disabled={code.trim() === ''} loading={find.isPending} onPress={search}>
            Tra mã
          </Button>
        </form>
      </div>

      <QuotaCard point={point} />
      {point.kind === 'PARTNER' && (
        <Text variant="body-sm" tone="secondary" as="div">
          Tubu cộng điểm cho khách theo số bạn xác nhận. Điểm không do cửa hàng cộng.
        </Text>
      )}

      {done && (
        <Card>
          <div role="status" style={{ ...COLUMN, gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <Icon icon={CheckCircle2} size="lg" tone="brand" />
            <Heading variant="title-md" as="h2">{`Đã ghi nhận. Tubu sẽ cộng ${formatPoints(done.pointsAwarded)} cho khách`}</Heading>
            <Text variant="body-md" as="div">{`Yêu cầu ${done.code} của ${done.customerName} đã xong`}</Text>
            {done.remaining && (
              <Text variant="body-sm" tone="secondary" as="div">{`${done.remaining.label}: ${formatPoints(done.remaining.value)}`}</Text>
            )}
            <Button
              fullWidth
              variant="secondary"
              onPress={() => {
                setDone(null);
                setCode('');
                setLookup(null);
                setGift(null);
              }}
            >
              Nhận yêu cầu khác
            </Button>
          </div>
        </Card>
      )}

      {request && (
        <Card>
          <div style={{ ...COLUMN, gap: 12 }}>
            <div style={{ ...COLUMN, gap: 2 }}>
              <Heading variant="title-md" as="h2">{request.code}</Heading>
              <Text variant="body-sm" tone="secondary" as="div">{METHOD_LABELS[request.method]}</Text>
              <Text variant="body-md" as="div">{request.customerName}</Text>
              {request.customerPhone && <Text variant="body-sm" tone="secondary" as="div">{request.customerPhone}</Text>}
            </div>

            {readOnly && (
              <Text variant="body-md" tone={request.status === 'COMPLETED' ? 'success' : 'danger'} as="div" style={{ fontWeight: 600 }}>
                {request.status === 'COMPLETED' ? 'Đã xác nhận' : 'Đã từ chối'}
              </Text>
            )}

            {request.lines.map((l) => (
              <div key={l.itemId} data-line style={{ ...COLUMN, gap: 6 }}>
                <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{l.itemName}</Text>
                {readOnly ? (
                  request.status === 'COMPLETED' && (
                    <Text variant="body-sm" tone="secondary" as="div">{`Đã nhận ${l.receivedQty ?? 0} ${l.unitLabel}`}</Text>
                  )
                ) : (
                  <>
                    <Text variant="body-sm" tone="secondary" as="div">{`Khách khai ${l.declaredQty} ${l.unitLabel}`}</Text>
                    {l.hazardous && <Text variant="body-sm" tone="danger" as="div">Cất riêng vào thùng kín, không lẫn rác khác</Text>}
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <QuantitySelector
                            size="sm"
                            min={0}
                            max={l.declaredQty}
                            value={received[l.itemId] ?? 0}
                            onChange={(n) => setReceived((r) => ({ ...r, [l.itemId]: n }))}
                          />
                          <Text variant="caption" tone="tertiary" as="span">{`Tối đa ${l.declaredQty}`}</Text>
                        </div>
                        {isShort(l, received) && (
                          <div style={{ ...COLUMN, gap: 4 }}>
                            <Text variant="body-sm" tone="secondary" as="div">Lý do nhận thiếu</Text>
                            <div style={{ position: 'relative' }}>
                              <select
                                aria-label={`Lý do nhận thiếu: ${l.itemName}`}
                                value={reasons[l.itemId] ?? ''}
                                onChange={(e) => setReasons((r) => ({ ...r, [l.itemId]: e.target.value as WasteShortfallReason | '' }))}
                                style={SELECT_STYLE}
                              >
                                <option value="" disabled>Chọn lý do</option>
                                {Object.entries(SHORTFALL_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                              <span style={{ position: 'absolute', right: 12, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                <Icon icon={ChevronDown} size="sm" tone="muted" />
                              </span>
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
                <Button fullWidth variant="secondary" onPress={() => setRejectOpen(true)}>
                  Từ chối cả yêu cầu
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {gift && (
        <Card>
          <div style={{ ...COLUMN, gap: 12 }}>
            <div style={{ ...COLUMN, gap: 2 }}>
              <Heading variant="title-md" as="h2">{gift.giftName}</Heading>
              <Text variant="body-md" as="div">{gift.customerName}</Text>
              {gift.claimExpiresAt && (
                <Text variant="body-sm" tone="secondary" as="div">{`Hạn nhận ${formatDate(gift.claimExpiresAt)}`}</Text>
              )}
            </div>
            {!point.giftHandoverEnabled ? (
              <Text variant="body-md" as="div">Điểm này không trao quà</Text>
            ) : gift.status !== 'READY' ? (
              <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>{GIFT_STATUS_TEXT[gift.status]}</Text>
            ) : (
              <Button
                size="lg"
                fullWidth
                disabled={fulfil.isPending}
                loading={fulfil.isPending}
                onPress={() => fulfil.mutate({ code: lookedUpCode, pointId: point.id, giftName: gift.giftName })}
              >
                Trao quà
              </Button>
            )}
          </div>
        </Card>
      )}

      <WasteDeskPerk point={point} />
      <WasteDeskReport pointId={point.id} />

      {request && !readOnly && (
        <>
          <div aria-hidden style={{ height: 150 }} />
          <StickyActionBar
            summary={
              <div style={{ ...COLUMN, gap: 2 }}>
                <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
                  {`Điểm Tubu sẽ cộng cho khách: ${formatPoints(preview)}`}
                </Text>
                {missingReason && (
                  <Text variant="body-sm" tone="secondary" as="div">Chọn lý do cho món nhận thiếu để xác nhận</Text>
                )}
              </div>
            }
            primary={
              <Button size="lg" fullWidth disabled={missingReason} loading={confirm.isPending} onPress={() => confirm.mutate(request)}>
                Xác nhận đã nhận
              </Button>
            }
          />
        </>
      )}

      {request && (
        <RejectSheet
          key={request.id}
          open={rejectOpen}
          onClose={() => setRejectOpen(false)}
          pending={reject.isPending}
          onSubmit={(reason, note) => reject.mutate({ req: request, reason, note })}
        />
      )}
    </div>
  );
}

function DeskContent() {
  const pointsQ = useQuery({ queryKey: WASTE_QUERY_KEYS.desk, queryFn: getDeskPoints });
  const cfg = usePublicConfig();
  if (pointsQ.isPending) return <Skeleton height={120} />;
  if (pointsQ.isError) {
    return <ErrorState message={getErrorMessage(pointsQ.error)} onRetry={() => void pointsQ.refetch()} retrying={pointsQ.isFetching} />;
  }
  if (pointsQ.data.length === 0) {
    // Máy chủ bỏ qua điểm của đại lý khi chương trình tắt, nên danh sách rỗng lúc đó không có nghĩa là mất quyền.
    if (!cfg.isLoaded) return <Skeleton height={120} />;
    if (!cfg.waste.enabled) return <EmptyState art="box" heading={PAUSED_TEXT} />;
    return <EmptyState art="box" heading="Tài khoản của bạn chưa được gắn với điểm nhận nào" />;
  }
  return <DeskBody points={pointsQ.data} />;
}

export default function RecycleDeskPage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Nhận hàng tại điểm" />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 48, gap: 16 }}>
        <AuthGate>
          <DeskContent />
        </AuthGate>
      </div>
    </Page>
  );
}
