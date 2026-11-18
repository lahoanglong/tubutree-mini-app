import { useEffect, useMemo, useRef, useState } from 'react';
import { dropOffDayLimitText, itemQtyMax } from '@tubutree/app-core/waste-copy';
import { consentStillValid, WASTE_RULES_UPDATED_NOTE } from '@tubutree/app-core/waste-consent';
import { sameProvince } from '@tubutree/app-core/waste-province';
import { packagingWizardLines, preferredWasteMethodFromSearch, returnPackagingOrderFromSearch } from '@tubutree/app-core/second-order-invite';
import { isMethodLocked, orderWasteMethods, WASTE_METHODS_BASE } from '@tubutree/app-core/waste-method-order';
import {
  EMPTY_HOME_PICKUP_FORM,
  homePickupBatteryBlocked,
  homePickupCreateBody,
  homePickupEnabled,
  type HomePickupForm,
} from '@tubutree/app-core/recycle-home-pickup-state';
import {
  homePickupCreateState,
  homePickupQuoteView,
  homePickupSubmitLabel,
  homePickupUnavailableText,
} from '@tubutree/app-core/recycle-home-pickup-view';
import { Page, useLocation, useNavigate, useSnackbar } from 'zmp-ui';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLockedMutation } from '../components/game/use-locked-mutation';
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
  getReturnPackaging,
  getWasteMe,
  getWastePoints,
  getWasteRules,
  invalidateAfterWasteWrite,
  previewWaste,
} from '../services/waste-api';
import { getLoyaltyRewards } from '../services/account-api';
import { getProvinces } from '../services/geo-api';
import { getZaloAccessToken, requestZaloLocation } from '../services/zmp-bridge';
import { trackRecycleStep } from '../services/recycle-funnel';
import { getErrorCode, getErrorMessage, getLoadErrorMessage, isStaleStateError } from '../services/api';
import { settleWithin } from '../utils/settle-within';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useIdempotencyKey } from '../hooks/use-idempotency-key';
import { useHomePickupQuote } from '../hooks/use-home-pickup-quote';
import { usePublicConfig } from '../hooks/use-public-config';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { Checkbox } from '../components/ui/form';
import { PageHeader } from '../components/ui/page-header';
import { WasteItemThumb } from '../components/waste-item-thumb';
import { HomePickupComposer } from '../components/recycle-home-pickup';
import { ProgressBar } from '../components/ui/progress-bar';
import { QuantitySelector } from '../components/ui/quantity-selector';
import { Skeleton } from '../components/ui/skeleton';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Text } from '../components/ui/text';
import {
  ITEMS_NEXT_HINT,
  MAX_OPEN_VIEW_CTA,
  QUICK_QTY_STEPS,
  WAREHOUSE_ONLY_TEXT,
  WASTE_CONSENT_TEXT,
  WASTE_PENDING_POINTS_SUBNOTE,
  WASTE_RULES_LINK,
  createBlockedHint,
  defaultPointId,
  maxOpenNotice,
  pendingPointsText,
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
  /** Lựa chọn ở khối "Shipper lấy tận nhà" (giữ khi khách mở Thể lệ rồi quay lại). */
  homePickup?: HomePickupForm;
};
export type WastePointsNavState = { returnTo: string; draft: WasteWizardDraft; selectedItemIds: string[] };
export type WastePointsReturnState = { draft: WasteWizardDraft };

const EMPTY_DRAFT: WasteWizardDraft = { lines: {}, method: null, pointId: null, pickedPoint: null, provinceCode: null, nearby: null };

// Back from the request page lands on the items entry that still carries the submitted draft; a module-level marker (the
// stack entry's state is cloned, so identity does not survive) lets that entry leave instead of re-creating the request.
// Keyed per wizard session (sid), not by quantities, so a later fresh entry with the same quantities is not mistaken for it.
const submittedSids = new Set<string>();

const METHOD_LINE: Record<WasteMethod, string> = {
  DROP_OFF: 'Miễn phí, nhận điểm khi người ở điểm xác nhận',
  MAIL_IN: 'Tự gửi qua hãng bất kỳ và tự trả phí ship',
  PICKUP: 'Miễn phí, bưu tá lấy khi giao đơn Tubu kế tiếp',
  HOME_PICKUP: 'Bưu tá tới tận nhà lấy, trừ phí ship bằng Điểm Xanh',
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

const isLocked = isMethodLocked;

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
  // Thẻ "Giữ bao bì gửi kèm đơn sau" ở chi tiết đơn mở màn này với ?method=PICKUP: chọn sẵn đường kèm đơn thay vì điểm nhận gần nhất.
  const preferredMethod = preferredWasteMethodFromSearch(location.search);
  const [draft, setDraft] = useState<WasteWizardDraft>(stateDraft ?? (preferredMethod ? { ...EMPTY_DRAFT, method: preferredMethod } : EMPTY_DRAFT));
  useEffect(() => {
    if (stateDraft) setDraft(stateDraft);
  }, [stateDraft]);

  // Khách mở Thể lệ rồi quay lại thì giữ cả cách giao lẫn các ô đồng ý (lưu vào state của mục lịch sử trước khi rời trang).
  const stateConsents = (location.state as { consents?: { consent: boolean; packaging: boolean; postage: boolean; version?: string | null } } | null)?.consents;
  const [consent, setConsent] = useState(stateConsents?.consent ?? false);
  const [ackVersion, setAckVersion] = useState<string | null>(stateConsents?.version ?? null);
  const [packagingConsent, setPackagingConsent] = useState(stateConsents?.packaging ?? false);
  const [postageConsent, setPostageConsent] = useState(stateConsents?.postage ?? false);
  const openRules = () => {
    navigate(`/recycle/new?step=${step}`, { replace: true, state: { draft, consents: { consent, packaging: packagingConsent, postage: postageConsent, version: ackVersion } } });
    navigate('/recycle/rules');
  };

  // Phiên bản thể lệ hiện hành: ô đồng ý chỉ còn hiệu lực khi khách tick đúng phiên bản này (admin đổi số thì phải tick lại).
  const rulesQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'rules-version'],
    queryFn: () => getWasteRules().then((r) => r.version ?? null),
    staleTime: 0,
    enabled: phase === 'authenticated' && step === 'method',
  });
  const rulesVersion = rulesQ.data;
  const consentValid = consent && consentStillValid(ackVersion, rulesVersion);
  const consentStale = consent && !consentValid && ackVersion !== null;
  const toggleConsent = () => {
    setConsent(!consentValid);
    setAckVersion(consentValid ? null : (rulesVersion ?? null));
  };

  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: phase === 'authenticated' });
  const me: WasteMeDTO | undefined = meQ.data;
  // Thẻ ở chi tiết đơn đã giao mở màn này với ?from=<mã đơn>: điền sẵn bao bì của đơn đó một lần, chỉ khi khách chưa chọn món nào.
  const fromOrder = returnPackagingOrderFromSearch(location.search);
  const packQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.returnPackaging(fromOrder ?? ''),
    queryFn: () => getReturnPackaging(fromOrder ?? ''),
    enabled: phase === 'authenticated' && step === 'items' && !stateDraft && fromOrder !== null && cfg.returnPackagingNudgeEnabled === true,
    staleTime: 60_000,
  });
  const packSeeded = useRef(false);
  useEffect(() => {
    const suggestion = packQ.data?.suggestion;
    if (packSeeded.current || !me || !suggestion) return;
    packSeeded.current = true;
    const lines = packagingWizardLines(suggestion, me.items.filter((i) => i.status === 'ACTIVE'), UNCAPPED_QTY_MAX);
    if (Object.keys(lines).length > 0) setDraft((d) => (Object.keys(d.lines).length > 0 ? d : { ...d, lines }));
  }, [me, packQ.data]);
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
    return [...WASTE_METHODS_BASE, 'HOME_PICKUP' as const].filter((m) => {
      if (m === 'DROP_OFF') return cfg.waste.dropoff && me.laneFlags.dropoff;
      if (m === 'MAIL_IN') return cfg.waste.mailin && me.laneFlags.mailin && shipOk;
      if (m === 'HOME_PICKUP') return homePickupEnabled({ cfgPickup: cfg.waste.pickup, lanePickup: me.laneFlags.pickup, shipLocked: !shipOk });
      return cfg.waste.pickup && me.laneFlags.pickup && shipOk;
    });
  }, [me, cfg.waste.dropoff, cfg.waste.mailin, cfg.waste.pickup]);

  // Shipper lấy tận nhà có luồng báo phí riêng, không có bản xem trước.
  const previewMethods = useMemo(() => enabledMethods.filter((m) => m !== 'HOME_PICKUP'), [enabledMethods]);
  const previewQueries = useQueries({
    queries: previewMethods.map((method) => {
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
  const previewFailed = previewMethods.filter((_, i) => previewQueries[i]?.isError);
  const previews: Partial<Record<WasteMethod, MethodPreview>> = {};
  // useQueries tạo observer mới mỗi khi khoá đổi nên data về undefined; giữ kết quả cuối riêng cho thứ tự thẻ để thẻ không nhảy chỗ.
  const lastPreview = useRef<Partial<Record<WasteMethod, WastePreviewDTO>>>({});
  previewMethods.forEach((m, i) => {
    const data = previewQueries[i]?.data;
    if (data) lastPreview.current[m] = data;
    previews[m] = { data };
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
        if (!loc) {
          trackRecycleStep('geo_denied');
          return;
        }
        trackRecycleStep('geo_granted');
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
  const homePickupForm = draft.homePickup ?? EMPTY_HOME_PICKUP_FORM;
  const hp = useHomePickupQuote({
    enabled: selected === 'HOME_PICKUP' && step === 'method' && phase === 'authenticated',
    form: homePickupForm,
    lines: lineInputs,
    items: me?.items ?? [],
  });
  const hpBatteryBlocked = selected === 'HOME_PICKUP' && me ? homePickupBatteryBlocked(lineInputs, me.items, hp.address?.province) : false;
  const hpView = hp.quote ? homePickupQuoteView({ quote: hp.quote, batteryBlocked: hpBatteryBlocked }) : null;
  const setHomePickup = (patch: Partial<HomePickupForm>) =>
    setDraft((d) => ({ ...d, homePickup: { ...(d.homePickup ?? EMPTY_HOME_PICKUP_FORM), ...patch } }));

  const feeShortTrackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hpView?.needFeePayment || !hp.effective.addressId) return;
    const sig = `${hp.effective.addressId}:${hp.effective.weightGrams}:${hpView.cashDueVnd}`;
    if (feeShortTrackedRef.current === sig) return;
    feeShortTrackedRef.current = sig;
    trackRecycleStep('fee_short_shown', 'HOME_PICKUP');
  }, [hpView?.needFeePayment, hpView?.cashDueVnd, hp.effective.addressId, hp.effective.weightGrams]);

  // Cùng khoá cho các lần bấm lại khi nội dung đơn không đổi; đổi địa chỉ, số kg hay cách trả thì sang khoá mới (máy chủ trả 409 cho cùng khoá khác nội dung).
  const keyContent = {
    method: draft.method,
    lines: lineInputs,
    pointId: draft.method === 'DROP_OFF' ? draft.pointId : null,
    homePickup:
      draft.method === 'HOME_PICKUP'
        ? {
            addressId: hp.effective.addressId,
            weightGrams: hp.effective.weightGrams,
            ...(hpView?.needFeePayment && hp.effective.payment ? { payment: hp.effective.payment } : {}),
          }
        : null,
  };
  const { key, rotate } = useIdempotencyKey(keyContent);
  const consentVersion = ackVersion ?? rulesVersion;
  const body: WasteCreateRequest | null =
    selected === 'HOME_PICKUP'
      ? homePickupCreateBody({
          form: hpView?.needFeePayment ? hp.effective : { ...hp.effective, payment: null },
          lines: lineInputs,
          consentVersion,
          expectedCashVnd: hpView?.needFeePayment ? hpView.cashDueVnd : null,
        })
      : selected
        ? {
            method: selected,
            lines: lineInputs,
            ...(selected === 'DROP_OFF' ? { pointId: draft.pointId ?? undefined } : {}),
            consent: true,
            ...(consentVersion ? { consentVersion } : {}),
            ...(selected === 'MAIL_IN' ? { packagingConsent: true, postagePaidConsent: true } : {}),
          }
        : null;
  const [maxOpenHit, setMaxOpenHit] = useState<number | null>(null);
  const create = useLockedMutation({
    mutationFn: () => {
      if (!body) throw new Error('Chưa chọn cách giao');
      return createWasteRequest(body, key);
    },
    onSuccess: async (r) => {
      rotate();
      if (r.method === 'DROP_OFF' && draft.pointId) writeLastPointId(browserStore(), draft.pointId);
      if (draft.sid) submittedSids.add(draft.sid);
      trackRecycleStep('submitted', r.method);
      await invalidateAfterWasteWrite(qc);
      navigate(`/recycle/r/${r.id}`, { replace: true });
    },
    // Máy chủ từ chối kiểu dữ liệu cũ (luật đổi rác đã đổi, không còn nhận loại này, 409 thử lại): trả Promise để khoá giữ tới khi
    // thể lệ, hồ sơ, ước tính và điểm nhận tải lại xong (tối đa `settleWithin`). Lỗi tạm thì chỉ tải lại phiên bản thể lệ và nhả khoá ngay.
    onError: (e) => {
      openSnackbar({ text: homePickupUnavailableText(e) ?? getErrorMessage(e), type: 'error' });
      const code = getErrorCode(e);
      if (code === 'WASTE_MAX_OPEN') {
        setMaxOpenHit(me?.thresholds.maxOpenRequests ?? 2);
      }
      if (code === 'WASTE_FEE_BANK_DISABLED' || (selected === 'HOME_PICKUP' && hp.effective.payment === 'WALLET' && !isStaleStateError(e))) {
        setHomePickup({ payment: null });
      }
      const refreshRules = qc.invalidateQueries({ queryKey: [...WASTE_QUERY_KEYS.all, 'rules-version'] });
      const feeError = code === 'WASTE_FEE_CHANGED' || code === 'WASTE_FEE_NEED_PAYMENT' || code === 'WASTE_FEE_BANK_DISABLED' || hp.effective.payment === 'WALLET';
      if (!isStaleStateError(e) && !feeError) return undefined;
      return settleWithin(
        Promise.all([
          refreshRules,
          qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.me }),
          qc.invalidateQueries({ queryKey: [...WASTE_QUERY_KEYS.all, 'preview'] }),
          qc.invalidateQueries({ queryKey: [...WASTE_QUERY_KEYS.all, 'pickup-quote'] }),
          qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.points(null) }),
          qc.invalidateQueries({ queryKey: ['wallet'] }),
        ]),
      );
    },
  });

  const shell = (content: React.ReactNode, subtitle: string, bar?: React.ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Đổi rác" subtitle={subtitle} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: bar ? 'calc(var(--sticky-bar-h, 9rem) + var(--space-gutter))' : 'calc(var(--space-gutter) + var(--safe-bottom))', gap: 16 }}>{content}</div>
      {bar}
    </Page>
  );
  const subtitle = step === 'items' ? wasteStepCopy.items : wasteStepCopy.method;

  if (phase === 'unavailable') return shell(<SessionUnavailable />, subtitle);
  if (phase === 'authenticated' && meQ.isError) {
    return shell(<ErrorState message={getLoadErrorMessage(meQ.error)} onRetry={() => meQ.refetch()} />, subtitle);
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

  // W179-B: chặn sớm khi đã đủ trần yêu cầu mở (hoặc đua thiết bị nhận WASTE_MAX_OPEN) — đúng 1 thông báo và 1 nút dẫn tới danh sách.
  const maxOpenReached = me.openRequests.length >= me.thresholds.maxOpenRequests || maxOpenHit !== null;
  if (maxOpenReached) {
    const maxLimit = maxOpenHit ?? me.thresholds.maxOpenRequests;
    return shell(
      <Card variant="outline">
        <Text variant="body-md" as="div" data-testid="waste-max-open-notice" style={{ fontWeight: 600 }}>
          {maxOpenNotice(maxLimit)}
        </Text>
      </Card>,
      subtitle,
      <StickyActionBar
        primary={
          <Button fullWidth onPress={() => navigate('/recycle/requests')}>
            {MAX_OPEN_VIEW_CTA}
          </Button>
        }
      />,
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
          <Text variant="body-md" as="div" numeric style={{ fontWeight: 600 }}>
            {pendingPointsText(formatPoints(p.estimatedPoints))}
          </Text>
          <Text variant="caption" tone="tertiary" as="div">
            {WASTE_PENDING_POINTS_SUBNOTE}
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
  const order = orderWasteMethods(
    enabledMethods,
    Object.fromEntries(enabledMethods.map((m) => [m, previews[m]?.data ?? lastPreview.current[m]])),
    noPointInProvince,
    previewFailed,
  );
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
    setDraft((d) => ({ ...d, method: m, ...(m !== 'HOME_PICKUP' ? { homePickup: undefined } : {}) }));
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
  const consentsOk = consentValid && (selected !== 'MAIL_IN' || (packagingConsent && postageConsent));
  const hpState = homePickupCreateState({
    addressId: hp.effective.addressId,
    quoteState: hp.quoteState,
    view: hpView,
    consentOk: consentValid,
    payment: hp.effective.payment,
  });
  const canCreate =
    selected === 'HOME_PICKUP'
      ? hpState.ok
      : selected !== null && !isLocked(selectedPreview) && consentsOk && (selected !== 'DROP_OFF' || draft.pointId !== null);

  const blockedHint = canCreate
    ? null
    : selected === 'HOME_PICKUP'
      ? hpState.hint
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
            <Text variant="body-sm" as="span" numeric style={{ fontWeight: 600 }}>
              {pendingPointsText(formatPoints(pv.estimatedPoints))}
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
          {m === 'HOME_PICKUP' && checked && (
            <HomePickupComposer
              addresses={hp.addresses}
              addressesStatus={hp.addressesStatus}
              onRetryAddresses={hp.refetchAddresses}
              selectedAddressId={hp.effective.addressId}
              onSelectAddress={(id) => setHomePickup({ addressId: id })}
              weightGrams={hp.weightGrams}
              onWeight={(g) => setHomePickup({ weightGrams: g })}
              quoteState={hp.quoteState}
              view={hpView}
              quoteErrorText={hp.quoteErrorText}
              onRetryQuote={hp.refetchQuote}
              selectedPayment={hp.effective.payment ?? null}
              onSelectPayment={(pay) => {
                trackRecycleStep(pay === 'WALLET' ? 'fee_path_wallet' : 'fee_path_bank', 'HOME_PICKUP');
                setHomePickup({ payment: pay });
              }}
              onAttachNextOrder={
                enabledMethods.includes('PICKUP')
                  ? () => {
                      trackRecycleStep('fee_path_attach', 'PICKUP');
                      selectMethod('PICKUP');
                    }
                  : undefined
              }
              onOpenExistingPickup={(reqId) => {
                trackRecycleStep('fee_path_attach', 'PICKUP');
                navigate(`/recycle/r/${reqId}`);
              }}
              onSwitchDropOff={
                enabledMethods.includes('DROP_OFF') && !isLocked(previews.DROP_OFF?.data)
                  ? () => {
                      trackRecycleStep('fee_path_dropoff', 'DROP_OFF');
                      selectMethod('DROP_OFF');
                    }
                  : undefined
              }
              disabled={create.isPending}
            />
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
          <Checkbox checked={consentValid} onChange={toggleConsent} label={WASTE_CONSENT_TEXT} />
          {consentStale && (
            <Text variant="caption" tone="warning" as="div">{WASTE_RULES_UPDATED_NOTE}</Text>
          )}
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
          {selected === 'HOME_PICKUP' ? homePickupSubmitLabel(hpView, hp.effective.payment) : 'Tạo yêu cầu'}
        </Button>
      }
    />,
  );
}
