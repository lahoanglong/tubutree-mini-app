import { useEffect, useMemo, useState } from 'react';
import { createdTodayVn } from '@tubutree/app-core/waste-copy';
import type { ReactNode } from 'react';
import { Page, useLocation, useNavigate, useParams, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteLineInput } from '@tubutree/shared-types';
import {
  WASTE_QUERY_KEYS,
  editWasteRequest,
  getWasteMe,
  getWasteRequest,
  invalidateAfterWasteWrite,
  previewWaste,
} from '../services/waste-api';
import { getErrorMessage } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Button } from '../components/ui/button';
import { ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Text } from '../components/ui/text';
import { formatDate, formatNumber, formatPoints } from '../utils/format';
import { useDebounced } from '../utils/use-debounced';
import { PREVIEW_DEBOUNCE_MS, pointAddress } from '../utils/waste-labels';
import { WasteItemStep, toLineInputs } from './recycle-new';
import type { WastePointsNavState, WastePointsReturnState, WasteWizardDraft } from './recycle-new';

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

export default function RecycleEditPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const { id = '' } = useParams();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();

  const authed = phase === 'authenticated';
  const q = useQuery({ queryKey: WASTE_QUERY_KEYS.request(id), queryFn: () => getWasteRequest(id), enabled: authed });
  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: authed });
  const r = q.data;
  const me = meQ.data;

  const stateDraft = (location.state as WastePointsReturnState | null)?.draft;
  const base = useMemo<WasteWizardDraft | null>(() => {
    if (!r) return null;
    return (
      stateDraft ?? {
        lines: Object.fromEntries(r.lines.map((l) => [l.itemId, l.declaredQty])),
        method: r.method,
        pointId: r.point?.id ?? null,
        pickedPoint: null,
        provinceCode: null,
        nearby: null,
      }
    );
  }, [r, stateDraft]);
  const [edited, setEdited] = useState<WasteWizardDraft | null>(null);
  const draft = edited ?? base;
  const lines = draft?.lines ?? {};
  const lineInputs = toLineInputs(lines);
  const method = r?.method ?? 'DROP_OFF';
  const isDropOff = method === 'DROP_OFF';
  const pointId = draft?.pointId ?? null;

  const ready = r !== undefined && (me !== undefined || meQ.isError);
  const canEdit =
    r !== undefined &&
    r.editable &&
    cfg.waste.enabled &&
    me?.programmeEnabled !== false &&
    !me?.blocked &&
    !(r.method !== 'DROP_OFF' && me?.shipLockedAt);
  const leave = ready && !canEdit;
  useEffect(() => {
    if (leave) navigate(`/recycle/r/${id}`, { replace: true });
  }, [leave, navigate, id]);

  const linesKey = useDebounced(JSON.stringify(lineInputs), PREVIEW_DEBOUNCE_MS);
  const debounced = useMemo(() => JSON.parse(linesKey) as WasteLineInput[], [linesKey]);
  const previewQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'preview', 'edit', id, method, pointId, debounced],
    queryFn: () => previewWaste({ lines: debounced, method, ...(isDropOff ? { pointId: pointId ?? undefined } : {}) }),
    enabled: authed && ready && !leave && debounced.length > 0,
  });

  const save = useMutation({
    mutationFn: () => editWasteRequest(id, { lines: lineInputs, ...(isDropOff && pointId ? { pointId } : {}) }),
    onSuccess: async () => {
      await invalidateAfterWasteWrite(qc);
      navigate(`/recycle/r/${id}`, { replace: true });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const shell = (content: ReactNode, subtitle?: string, bar?: ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sửa yêu cầu" subtitle={subtitle} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 160, gap: 16 }}>{content}</div>
      {bar}
    </Page>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (q.isError) return shell(<ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />);
  if (meQ.isError && !me) return shell(<ErrorState message={getErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />);
  if (!r || !draft || !ready || leave || !me) return shell(<Skeleton height={120} />, r?.code);

  const setLine = (itemId: string, n: number) => setEdited((d) => ({ ...(d ?? draft), lines: { ...(d ?? draft).lines, [itemId]: n } }));
  const activeIds = new Set(me.items.filter((i) => i.status === 'ACTIVE').map((i) => i.id));
  const gone = r.lines.filter((l) => !activeIds.has(l.itemId) && (lines[l.itemId] ?? 0) > 0);
  const shownPoint = draft.pickedPoint ?? r.point;
  const p = debounced.length > 0 ? previewQ.data : undefined;

  const changePoint = () => {
    const state: WastePointsNavState = {
      returnTo: `/recycle/r/${id}/edit`,
      draft: { ...draft, method: r.method },
      selectedItemIds: lineInputs.map((l) => l.itemId),
    };
    navigate('/recycle/points', { replace: true, state });
  };

  const summary = (
    <div>
      {p && (
        <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
          {`Ước tính mới ${formatPoints(p.estimatedPoints)}`}
        </Text>
      )}
      <Text variant="caption" tone="secondary" as="div">
        Điểm ước tính có thể thay đổi theo mức quy đổi hiện hành
      </Text>
      <Text variant="caption" tone="secondary" as="div">
        {`Hạn giữ chỗ không đổi: ${formatDate(r.expiresAt)}`}
      </Text>
    </div>
  );

  return shell(
    <>
      {gone.map((l) => (
        <div key={l.itemId} style={{ ...COLUMN, gap: 8, padding: 12, borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-surface)' }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {`${l.itemName}: ${formatNumber(l.declaredQty)} ${l.unitLabel}`}
          </Text>
          <Text variant="caption" tone="danger" as="div">
            Món này hiện chưa nhận
          </Text>
          <div>
            <Button variant="secondary" onPress={() => setLine(l.itemId, 0)}>
              Bỏ món này
            </Button>
          </div>
        </div>
      ))}
      <WasteItemStep
        items={me.items}
        lines={lines}
        onChange={setLine}
        allowance={Object.fromEntries(r.lines.map((l) => [l.itemId, l.declaredQty]))}
        dayCap={createdTodayVn(r.createdAt)}
      />
      {isDropOff && shownPoint && (
        <div style={{ ...COLUMN, gap: 8 }}>
          <div>
            <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
              {shownPoint.name}
            </Text>
            <Text variant="caption" tone="secondary" as="div">
              {pointAddress(shownPoint)}
            </Text>
          </div>
          <div>
            <Button variant="secondary" onPress={changePoint}>
              Đổi điểm nhận
            </Button>
          </div>
        </div>
      )}
    </>,
    r.code,
    <StickyActionBar
      summary={summary}
      primary={
        <Button fullWidth disabled={lineInputs.length === 0 || gone.length > 0} loading={save.isPending} onPress={() => save.mutate()}>
          Lưu thay đổi
        </Button>
      }
    />,
  );
}
