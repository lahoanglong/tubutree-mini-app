import { useEffect, useMemo, useRef, useState } from 'react';
import { dropOffDayLimitText, itemQtyMax } from '@tubutree/app-core/waste-copy';
import { sameProvince } from '@tubutree/app-core/waste-province';
import { Page, useLocation, useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WasteCreateRequest,
  WasteLineInput,
  WasteMeDTO,
  WasteMeItemDTO,
  WasteMethod,
  WastePointDTO,
  WastePreviewDTO,
  WastePreviewRequest,
} from '@tubutree/shared-types';
import {
  WASTE_QUERY_KEYS,
  createWasteRequest,
  getNearbyWastePoints,
  getWasteMe,
  getWastePoints,
  invalidateAfterWasteWrite,
  previewWaste,
} from '../services/waste-api';
import { getLoyaltyRewards } from '../services/account-api';
import { getProvinces } from '../services/geo-api';
import { getZaloAccessToken, requestZaloLocation } from '../services/zmp-bridge';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useIdempotencyKey } from '../hooks/use-idempotency-key';
import { usePublicConfig } from '../hooks/use-public-config';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { Checkbox } from '../components/ui/form';
import { PageHeader } from '../components/ui/page-header';
import { WasteItemThumb } from '../components/waste-item-thumb';
import { ProgressBar } from '../components/ui/progress-bar';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { Skeleton } from '../components/ui/skeleton';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Text } from '../components/ui/text';
import {
  ITEMS_NEXT_HINT,
  QUICK_QTY_STEPS,
  WAREHOUSE_ONLY_TEXT,
  WASTE_CONSENT_TEXT,
  WASTE_RULES_LINK,
  createBlockedHint,
  defaultPointId,
  readLastPointId,
  wasteStepCopy,
  writeLastPointId,
} from '@tubutree/app-core/waste-copy';
import { newIdempotencyKey } from '../utils/idempotency';
import { formatPoints, formatVnd } from '../utils/format';
import { useDebounced } from '../utils/use-debounced';
import {
  METHOD_LABELS,
  PREVIEW_DEBOUNCE_MS,
  UNCAPPED_QTY_MAX,
  blockMessage,
  capSentence,
  monthRemainingText,
  feeExceedsPoints,
  feeRangeText,
  groupProgressText,
  isFastest,
  nextRewardProgress,
  pointAddress,
  ruleText,
  type BlockContext,
} from '../utils/waste-labels';

export type WasteWizardDraft = {
  lines: Record<string, number>;
  method: WasteMethod | null;
  pointId: string | null;
  pickedPoint: WastePointDTO | null;
  provinceCode: string | null;
  nearby: WastePointDTO[] | null;
  sid?: string;
};
export type WastePointsNavState = { returnTo: string; draft: WasteWizardDraft; selectedItemIds: string[] };
export type WastePointsReturnState = { draft: WasteWizardDraft };

const EMPTY_DRAFT: WasteWizardDraft = { lines: {}, method: null, pointId: null, pickedPoint: null, provinceCode: null, nearby: null };

// Back from the request page lands on the items entry that still carries the submitted draft; a module-level marker (the
// stack entry's state is cloned, so identity does not survive) lets that entry leave instead of re-creating the request.
// Keyed per wizard session (sid), not by quantities, so a later fresh entry with the same quantities is not mistaken for it.
const submittedSids = new Set<string>();

const BASE_ORDER: readonly WasteMethod[] = ['DROP_OFF', 'PICKUP', 'MAIL_IN'];
const MAIL_FIRST_ORDER: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP', 'DROP_OFF'];
const METHOD_LINE: Record<WasteMethod, string> = {
  DROP_OFF: 'Miễn phí, nhận điểm khi người ở điểm xác nhận',
  MAIL_IN: 'Tự gửi qua hãng bất kỳ và tự trả phí ship',
  PICKUP: 'Miễn phí, bưu tá lấy khi giao đơn Tubu kế tiếp',
};
const browserStore = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const PACKAGING_TEXT = 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn';
const POSTAGE_TEXT = 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận';
const PARCEL_COUNT_TEXT = 'Mỗi kiện là một yêu cầu riêng: có nhiều kiện thì tạo nhiều yêu cầu, mỗi kiện một mã TR-.';

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function toLineInputs(lines: Record<string, number>): WasteLineInput[] {
  return Object.entries(lines)
    .filter(([, qty]) => qty > 0)
    .map(([itemId, declaredQty]) => ({ itemId, declaredQty }))
    .sort((a, b) => codeUnitCompare(a.itemId, b.itemId));
}

const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

interface WasteItemStepProps {
  items: readonly WasteMeItemDTO[];
  lines: Readonly<Record<string, number>>;
  onChange: (itemId: string, qty: number) => void;
  allowance?: Readonly<Record<string, number>>;
  /** Sai khi sửa một yêu cầu không tạo hôm nay: máy chủ tính trần ngày theo ngày của yêu cầu nên khách không áp trần ngày. */
  dayCap?: boolean;
}

export function WasteItemStep({ items, lines, onChange, allowance, dayCap = true }: WasteItemStepProps) {
  const sorted = useMemo(() => items.filter((i) => i.status !== 'HIDDEN').sort((a, b) => a.sortOrder - b.sortOrder), [items]);
  return (
    <div style={{ ...COLUMN, gap: 12 }}>
      {sorted.map((item) => {
        const qty = lines[item.id] ?? 0;
        const dayLine = dropOffDayLimitText(item, allowance?.[item.id] ?? 0, dayCap);
        const cap = capSentence(item, dayLine !== null);
        const monthLeft = monthRemainingText(item);
        const progress = groupProgressText(qty, item);
        const comingSoon = item.status === 'COMING_SOON';
        return (
          <div
            key={item.id}
            data-item
            data-status={item.status}
            aria-disabled={comingSoon || undefined}
            style={{
              display: 'flex',
              gap: 12,
              padding: 12,
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
            }}
          >
            <span data-item-media>
              <WasteItemThumb item={item} />
            </span>
            <div style={{ ...COLUMN, gap: 4, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text variant="body-md" as="span" tone={comingSoon ? 'tertiary' : 'primary'} style={{ fontWeight: 600 }}>
                  {item.name}
                </Text>
                {comingSoon && <Badge>Sắp nhận</Badge>}
              </div>
              <Text variant="caption" tone={comingSoon ? 'tertiary' : 'secondary'} as="div">
                {ruleText(item)}
              </Text>
              {item.warehouseOnly && (
                <div>
                  <Badge tone="info" size="sm">{WAREHOUSE_ONLY_TEXT}</Badge>
                </div>
              )}
              {item.prepInstructions && (
                <Text variant="caption" tone="tertiary" as="div">
                  {item.prepInstructions}
                </Text>
              )}
              {cap && (
                <Text variant="caption" tone="tertiary" as="div">
                  {cap}
                </Text>
              )}
              {monthLeft && (
                <Text variant="caption" tone={item.monthRemainingQty === 0 ? 'warning' : 'secondary'} as="div">
                  {monthLeft}
                </Text>
              )}
              {dayLine && item.status === 'ACTIVE' && (
                <Text variant="caption" tone="warning" as="div">
                  {dayLine}
                </Text>
              )}
              {item.status === 'ACTIVE' && (
                <div style={{ ...COLUMN, gap: 8, marginTop: 4 }}>
                  <div>
                    <QuantitySelector
                      size="sm"
                      editable
                      quickSteps={QUICK_QTY_STEPS}
                      min={0}
                      max={itemQtyMax(item, allowance?.[item.id] ?? 0, UNCAPPED_QTY_MAX, dayCap)}
                      value={qty}
                      onChange={(n) => onChange(item.id, n)}
                    />
                  </div>
                  {progress && <ProgressBar value={qty % item.unitsPerPoint} max={item.unitsPerPoint} label={progress} />}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type MethodPreview = { data: WastePreviewDTO | undefined };

function isLocked(preview: WastePreviewDTO | undefined): boolean {
  return preview?.blocks.some((b) => b.code !== 'NEED_PROVINCE') ?? false;
}

const STEP1_CAP_BLOCKS: readonly string[] = ['ITEM_MONTH_CAP', 'POINTS_MONTH_CAP', 'ITEM_DAY_CAP'];

const SELECT_STYLE = {
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  font: 'inherit',
} as const;

export default function RecycleNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();

  const step = new URLSearchParams(location.search).get('step') === 'method' ? 'method' : 'items';
  const stateDraft = (location.state as { draft?: WasteWizardDraft } | null)?.draft;
  const [draft, setDraft] = useState<WasteWizardDraft>(stateDraft ?? EMPTY_DRAFT);
  useEffect(() => {
    if (stateDraft) setDraft(stateDraft);
  }, [stateDraft]);

  // Khách mở Thể lệ rồi quay lại thì giữ cả cách giao lẫn các ô đồng ý (lưu vào state của mục lịch sử trước khi rời trang).
  const stateConsents = (location.state as { consents?: { consent: boolean; packaging: boolean; postage: boolean } } | null)?.consents;
  const [consent, setConsent] = useState(stateConsents?.consent ?? false);
  const [packagingConsent, setPackagingConsent] = useState(stateConsents?.packaging ?? false);
  const [postageConsent, setPostageConsent] = useState(stateConsents?.postage ?? false);
  const openRules = () => {
    navigate(`/recycle/new?step=${step}`, { replace: true, state: { draft, consents: { consent, packaging: packagingConsent, postage: postageConsent } } });
    navigate('/recycle/rules');
  };

  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: phase === 'authenticated' });
  const me: WasteMeDTO | undefined = meQ.data;
  const leave = phase === 'guest' || (me !== undefined && (!me.programmeEnabled || me.eligibility !== 'OK' || me.blocked));
  useEffect(() => {
    if (leave) navigate('/recycle', { replace: true });
  }, [leave, navigate]);
  const [replayed] = useState(() => step === 'items' && !!stateDraft?.sid && submittedSids.has(stateDraft.sid));
  useEffect(() => {
    if (replayed) navigate('/recycle', { replace: true });
  }, [replayed, navigate]);
  const missingDraft = step === 'method' && !stateDraft;
  useEffect(() => {
    if (missingDraft) navigate('/recycle/new', { replace: true });
  }, [missingDraft, navigate]);

  const lineInputs = toLineInputs(draft.lines);

  // Step 1 estimate. The JSON string is what gets debounced: toLineInputs returns a new array every render.
  const linesKey = useDebounced(JSON.stringify(lineInputs), PREVIEW_DEBOUNCE_MS);
  const debounced = useMemo(() => JSON.parse(linesKey) as WasteLineInput[], [linesKey]);
  const itemsPreviewQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'preview', debounced],
    queryFn: () => previewWaste({ lines: debounced }),
    enabled: step === 'items' && debounced.length > 0,
  });
  const rewardsQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.rewards,
    queryFn: getLoyaltyRewards,
    enabled: step === 'items' && phase === 'authenticated',
  });

  const enabledMethods = useMemo(() => {
    if (!me) return [];
    const shipOk = !me.shipLockedAt;
    return BASE_ORDER.filter((m) => {
      if (m === 'DROP_OFF') return cfg.waste.dropoff && me.laneFlags.dropoff;
      if (m === 'MAIL_IN') return cfg.waste.mailin && me.laneFlags.mailin && shipOk;
      return cfg.waste.pickup && me.laneFlags.pickup && shipOk;
    });
  }, [me, cfg.waste.dropoff, cfg.waste.mailin, cfg.waste.pickup]);

  const previewQueries = useQueries({
    queries: enabledMethods.map((method) => {
      const body: WastePreviewRequest = {
        lines: lineInputs,
        method,
        ...(method === 'DROP_OFF' && draft.pointId ? { pointId: draft.pointId } : {}),
        ...(method === 'MAIL_IN' && draft.provinceCode ? { provinceCode: draft.provinceCode } : {}),
      };
      return {
        queryKey: [...WASTE_QUERY_KEYS.all, 'preview', body],
        queryFn: () => previewWaste(body),
        enabled: step === 'method' && body.lines.length > 0,
      };
    }),
  });
  const previews: Partial<Record<WasteMethod, MethodPreview>> = {};
  enabledMethods.forEach((m, i) => {
    previews[m] = { data: previewQueries[i]?.data };
  });

  const pointsQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.points(null),
    queryFn: () => getWastePoints(),
    enabled: step === 'method',
  });
  const wantProvinces = step === 'method' && enabledMethods.includes('MAIL_IN');
  const provincesQ = useQuery({ queryKey: ['geo', 'provinces'], queryFn: getProvinces, enabled: wantProvinces });

  const dropoffEnabled = cfg.waste.dropoff && !!me?.laneFlags.dropoff;
  const needNearby = step === 'method' && dropoffEnabled && draft.nearby === null;
  const locationTried = useRef(false);
  const [locationSettled, setLocationSettled] = useState(false);
  useEffect(() => {
    if (step === 'items') locationTried.current = false;
  }, [step]);
  useEffect(() => {
    if (!needNearby || locationTried.current) return;
    locationTried.current = true;
    void (async () => {
      try {
        const loc = await requestZaloLocation();
        if (!loc) return;
        const { accessToken } = await getZaloAccessToken();
        const nearby = await getNearbyWastePoints({ locationToken: loc.token, zaloAccessToken: accessToken });
        // Without any distance the server could not resolve the location (spec 4.4): treat as no location.
        if (nearby.some((p) => p.distanceKm != null)) setDraft((d) => ({ ...d, nearby }));
      } catch {
        // Location only decorates the cards; a failure shows nothing (spec 16.1).
      } finally {
        setLocationSettled(true);
      }
    })();
  }, [needNearby]);

  // Chọn sẵn "Mang tới điểm nhận" với điểm lần trước (hoặc điểm gần nhất khi đã có vị trí) để khách đỡ phải chạm nhiều lần; không có gợi ý thì để khách tự chọn.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || step !== 'method' || draft.method !== null || !pointsQ.data || !enabledMethods.includes('DROP_OFF')) return;
    const ids = toLineInputs(draft.lines).map((l) => l.itemId);
    const live = draft.nearby ? pointsQ.data.map((pt) => ({ ...pt, distanceKm: draft.nearby?.find((n) => n.id === pt.id)?.distanceKm ?? null })) : pointsQ.data;
    const id = defaultPointId(live, ids, readLastPointId(browserStore()));
    const point = id ? pointsQ.data.find((pt) => pt.id === id) : undefined;
    if (point) {
      prefilled.current = true;
      setDraft((d) => ({ ...d, method: 'DROP_OFF', pointId: point.id, pickedPoint: point }));
    } else if (locationSettled || !needNearby) {
      // Không có điểm lần trước dùng được và vị trí đã có kết quả (hoặc không cần): thôi, để khách tự chọn.
      prefilled.current = true;
    }
  }, [step, draft.method, draft.lines, draft.nearby, pointsQ.data, enabledMethods, locationSettled, needNearby]);

  const selected = draft.method && enabledMethods.includes(draft.method) ? draft.method : null;
  const keyContent = { method: draft.method, lines: lineInputs, pointId: draft.method === 'DROP_OFF' ? draft.pointId : null };
  const { key, rotate } = useIdempotencyKey(keyContent);
  const body: WasteCreateRequest | null = selected
    ? {
        method: selected,
        lines: lineInputs,
        ...(selected === 'DROP_OFF' ? { pointId: draft.pointId ?? undefined } : {}),
        consent: true,
        ...(selected === 'MAIL_IN' ? { packagingConsent: true, postagePaidConsent: true } : {}),
      }
    : null;
  const create = useMutation({
    mutationFn: () => {
      if (!body) throw new Error('Chưa chọn cách giao');
      return createWasteRequest(body, key);
    },
    onSuccess: async (r) => {
      rotate();
      if (r.method === 'DROP_OFF' && draft.pointId) writeLastPointId(browserStore(), draft.pointId);
      if (draft.sid) submittedSids.add(draft.sid);
      await invalidateAfterWasteWrite(qc);
      navigate(`/recycle/r/${r.id}`, { replace: true });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const shell = (content: React.ReactNode, subtitle: string, bar?: React.ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Đổi rác" subtitle={subtitle} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 160, gap: 16 }}>{content}</div>
      {bar}
    </Page>
  );
  const subtitle = step === 'items' ? wasteStepCopy.items : wasteStepCopy.method;

  if (phase === 'unavailable') return shell(<SessionUnavailable />, subtitle);
  if (phase === 'authenticated' && meQ.isError) {
    return shell(<ErrorState message={getLoadErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />, subtitle);
  }
  if (!me || leave || missingDraft || replayed) {
    return shell(
      <>
        <Skeleton height={80} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
        <Skeleton height={80} radius="var(--radius-card)" />
      </>,
      subtitle,
    );
  }

  if (step === 'items') {
    const onChange = (itemId: string, qty: number) =>
      setDraft((d) => {
        const lines = { ...d.lines };
        if (qty > 0) lines[itemId] = qty;
        else delete lines[itemId];
        return { ...d, lines };
      });
    const next = () => {
      const stamped = { ...draft, sid: draft.sid ?? newIdempotencyKey() };
      navigate('/recycle/new', { replace: true, state: { draft: stamped } });
      navigate('/recycle/new?step=method', { state: { draft: stamped } });
    };
    const p = debounced.length > 0 ? itemsPreviewQ.data : undefined;
    const capBlock = p?.blocks.find((b) => STEP1_CAP_BLOCKS.includes(b.code));
    // The last finished preview may belong to older quantities: wait for the debounce and the new request before enabling.
    const previewStale = linesKey !== JSON.stringify(lineInputs) || itemsPreviewQ.isFetching;
    const reward = p && !capBlock ? nextRewardProgress(rewardsQ.data, p.estimatedPoints) : null;
    const noLines = lineInputs.length === 0;
    const summary = noLines ? (
      <Text variant="body-sm" tone="secondary" as="div">
        {ITEMS_NEXT_HINT}
      </Text>
    ) : p ? (
      capBlock ? (
        <Text variant="body-md" tone="danger" as="div" style={{ fontWeight: 600 }}>
          {blockMessage(capBlock, { items: me.items, maxOpenRequests: me.thresholds.maxOpenRequests, itemCaps: p.itemCaps })}
        </Text>
      ) : (
        <div>
          <Text variant="body-md" as="div" style={{ fontWeight: 600 }}>
            {`Ước tính ${formatPoints(p.estimatedPoints)}`}
          </Text>
          <Text variant="caption" tone="secondary" as="div">
            {`Dùng như ${formatVnd(p.pointsValueVnd)} khi mua sắm`}
          </Text>
          {reward && (
            <Text variant="caption" tone="tertiary" as="div">
              {`Còn ${formatPoints(reward.missing)} tới ${reward.rewardName}`}
            </Text>
          )}
        </div>
      )
    ) : undefined;
    return shell(
      <WasteItemStep items={me.items} lines={draft.lines} onChange={onChange} />,
      subtitle,
      <StickyActionBar
        summary={summary}
        primary={
          <Button fullWidth disabled={lineInputs.length === 0 || !!capBlock || previewStale} onPress={next}>
            Tiếp tục
          </Button>
        }
      />,
    );
  }

  const mailPreview = previews.MAIL_IN?.data;
  const province = mailPreview?.feeEstimate?.provinceCode ?? draft.provinceCode;
  const noPointInProvince = province != null && pointsQ.data !== undefined && !pointsQ.data.some((pt) => sameProvince(pt.provinceCode, province));
  // Thẻ đang khoá (chưa đủ điểm tối thiểu) luôn xếp cuối: lựa chọn dùng được phải nằm trên.
  const order = (noPointInProvince ? MAIL_FIRST_ORDER : BASE_ORDER)
    .filter((m) => enabledMethods.includes(m))
    .sort((a, b) => Number(isLocked(previews[a]?.data)) - Number(isLocked(previews[b]?.data)));
  const nearestKm = (draft.nearby ?? []).reduce<number | null>(
    (min, pt) => (pt.distanceKm == null ? min : min == null ? pt.distanceKm : Math.min(min, pt.distanceKm)),
    null,
  );
  const showShipLocked = !!me.shipLockedAt && ((cfg.waste.mailin && me.laneFlags.mailin) || (cfg.waste.pickup && me.laneFlags.pickup));
  const ctxFor = (pv: WastePreviewDTO | undefined, method?: WasteMethod): BlockContext => ({
    items: me.items,
    maxOpenRequests: me.thresholds.maxOpenRequests,
    itemCaps: pv?.itemCaps ?? [],
    method,
  });

  const selectMethod = (m: WasteMethod) => {
    if (m === draft.method) return;
    setDraft((d) => ({ ...d, method: m }));
    setConsent(false);
    setPackagingConsent(false);
    setPostageConsent(false);
  };
  const pickPoint = () => {
    const state: WastePointsNavState = {
      returnTo: '/recycle/new?step=method',
      draft,
      selectedItemIds: lineInputs.map((l) => l.itemId),
    };
    navigate('/recycle/points', { replace: true, state });
  };

  const selectedPreview = selected ? previews[selected]?.data : undefined;
  const consentsOk = consent && (selected !== 'MAIL_IN' || (packagingConsent && postageConsent));
  const canCreate =
    selected !== null &&
    !isLocked(selectedPreview) &&
    consentsOk &&
    (selected !== 'DROP_OFF' || draft.pointId !== null) &&
    !create.isPending;

  const blockedHint = canCreate
    ? null
    : createBlockedHint({ selected: selected !== null, needsPoint: selected === 'DROP_OFF', pointChosen: draft.pointId !== null, consentsOk });

  const unlockedOthers = (m: WasteMethod) => order.filter((o) => o !== m && !isLocked(previews[o]?.data));

  const renderCard = (m: WasteMethod) => {
    const pv = previews[m]?.data;
    const locked = isLocked(pv);
    const checked = selected === m;
    const fee = m === 'MAIL_IN' ? pv?.feeEstimate : null;
    // Tỉnh chưa có điểm nhận thì API trả chính mã tỉnh làm tên; khi danh sách tỉnh chưa về thì bỏ cụm tên tỉnh, không in mã số.
    const feeProvince = fee ? (provincesQ.data?.find((pr) => pr.code === fee.provinceCode)?.name ?? (fee.provinceName === fee.provinceCode ? null : fee.provinceName)) : null;
    const showProvince = m === 'MAIL_IN' && checked && provincesQ.data && (draft.provinceCode !== null || pv?.blocks.some((b) => b.code === 'NEED_PROVINCE'));
    return (
      <Card
        key={m}
        variant="outline"
        style={checked ? { border: '2px solid var(--color-action-primary-bg)' } : undefined}
      >
        <button
          type="button"
          role="radio"
          data-method={m}
          aria-checked={checked}
          aria-disabled={locked}
          onClick={() => {
            if (!locked) selectMethod(m);
          }}
          style={{
            ...COLUMN,
            gap: 4,
            width: '100%',
            padding: 0,
            margin: 0,
            border: 0,
            background: 'none',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            cursor: locked ? 'default' : 'pointer',
          }}
        >
          <span style={{ ...COLUMN, gap: 4, opacity: locked ? 0.6 : 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text variant="body-md" as="span" style={{ fontWeight: 600 }}>
              {METHOD_LABELS[m]}
            </Text>
            {m === 'DROP_OFF' && isFastest(nearestKm) && <Badge tone="brand">Nhanh nhất</Badge>}
          </span>
          <Text variant="caption" tone="secondary" as="span">
            {METHOD_LINE[m]}
          </Text>
          {pv && (
            <Text variant="body-sm" as="span" style={{ fontWeight: 600 }}>
              {`Ước tính ${formatPoints(pv.estimatedPoints)}`}
            </Text>
          )}
          {fee && (
            <Text variant="caption" tone="secondary" as="span">
              {`Phí ship ước tính${feeProvince ? ` từ ${feeProvince}` : ''}: ${feeRangeText(fee)}, ước tính theo bảng giá niêm yết`}
            </Text>
          )}
          {m === 'MAIL_IN' && (
            <Text variant="caption" tone="secondary" as="span">
              {`Gói tối thiểu ${formatPoints(me.thresholds.mailinMinPoints)}`}
            </Text>
          )}
          {m === 'PICKUP' && (
            <Text variant="caption" tone="secondary" as="span">
              {`Tối thiểu ${formatPoints(me.thresholds.pickupMinPoints)} ước tính`}
            </Text>
          )}
          </span>
          {pv?.blocks
            .filter((b) => b.code !== 'NEED_PROVINCE' || checked)
            .map((b) => (
              <Text key={`${b.code}-${b.itemId ?? ''}`} variant="caption" tone={b.code === 'NEED_PROVINCE' ? 'secondary' : 'warning'} as="span">
                {blockMessage(b, ctxFor(pv, m))}
              </Text>
            ))}
        </button>
        <div style={{ ...COLUMN, gap: 8, marginTop: 8 }}>
          {showProvince && (
            <select
              aria-label="Chọn tỉnh để ước tính phí ship"
              value={draft.provinceCode ?? ''}
              onChange={(e) => {
                const code = e.target.value || null;
                setDraft((d) => ({ ...d, provinceCode: code }));
              }}
              style={SELECT_STYLE}
            >
              <option value="">Chọn tỉnh</option>
              {provincesQ.data?.map((pr) => (
                <option key={pr.code} value={pr.code}>
                  {pr.name}
                </option>
              ))}
            </select>
          )}
          {m === 'MAIL_IN' && (
            <Text variant="caption" tone="tertiary" as="div">
              {`Mỗi kiện tối đa ${me.parcelLimits.maxWeightKg} kg, cạnh dài tối đa ${me.parcelLimits.maxEdgeCm} cm. Hàng gửi về kho không hoàn lại. Kiện còn cước phải trả khi nhận bị kho từ chối ngay ở cửa.`}
            </Text>
          )}
          {m === 'PICKUP' && (
            <Text variant="caption" tone="tertiary" as="div">
              {`Mỗi kiện tối đa ${me.parcelLimits.maxWeightKg} kg, cạnh dài tối đa ${me.parcelLimits.maxEdgeCm} cm.`}
            </Text>
          )}
          {m === 'MAIL_IN' && pv && feeExceedsPoints(pv) && (
            <div style={{ ...COLUMN, gap: 8 }}>
              <Text variant="body-sm" tone="warning" as="div" style={{ fontWeight: 600 }}>
                Phí ship có thể cao hơn giá trị điểm bạn nhận được
              </Text>
              {unlockedOthers(m).map((o) => (
                <Button key={o} variant="secondary" onPress={() => selectMethod(o)}>
                  {`Chọn ${METHOD_LABELS[o]}`}
                </Button>
              ))}
            </div>
          )}
          {m === 'DROP_OFF' && checked && (
            <div style={{ ...COLUMN, gap: 8 }}>
              {draft.pickedPoint && (
                <div>
                  <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                    {draft.pickedPoint.name}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {pointAddress(draft.pickedPoint)}
                  </Text>
                </div>
              )}
              <Button variant="secondary" onPress={pickPoint}>
                {draft.pickedPoint ? 'Đổi điểm nhận' : 'Chọn điểm nhận'}
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return shell(
    <>
      {showShipLocked && (
        <Card variant="outline">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {blockMessage({ code: 'SHIP_LOCKED' }, ctxFor(undefined))}
          </Text>
        </Card>
      )}
      {order.length === 0 ? (
        <Card variant="outline">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            Hiện chưa có cách giao nào đang mở, bạn quay lại sau nhé.
          </Text>
        </Card>
      ) : (
        <div role="radiogroup" aria-label="Cách giao" style={{ ...COLUMN, gap: 12 }}>
          {order.map(renderCard)}
        </div>
      )}
      {selected && (
        <div style={{ ...COLUMN, gap: 4 }}>
          <Checkbox checked={consent} onChange={() => setConsent((v) => !v)} label={WASTE_CONSENT_TEXT} />
          <div>
            <Button variant="ghost" onPress={openRules}>
              {WASTE_RULES_LINK}
            </Button>
          </div>
          {selected === 'MAIL_IN' && (
            <>
              <Checkbox checked={packagingConsent} onChange={() => setPackagingConsent((v) => !v)} label={PACKAGING_TEXT} />
              <Checkbox checked={postageConsent} onChange={() => setPostageConsent((v) => !v)} label={POSTAGE_TEXT} />
              <Text variant="caption" tone="tertiary" as="div">
                {PARCEL_COUNT_TEXT}
              </Text>
            </>
          )}
        </div>
      )}
    </>,
    subtitle,
    <StickyActionBar
      summary={
        blockedHint ? (
          <Text variant="body-sm" tone="secondary" as="div">
            {blockedHint}
          </Text>
        ) : undefined
      }
      primary={
        <Button fullWidth disabled={!canCreate} loading={create.isPending} onPress={() => create.mutate()}>
          Tạo yêu cầu
        </Button>
      }
    />,
  );
}
