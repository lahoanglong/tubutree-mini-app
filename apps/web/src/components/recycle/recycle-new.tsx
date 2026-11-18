'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WasteCreateRequest,
  WasteLineInput,
  WasteMeDTO,
  WasteMethod,
  WastePreviewDTO,
  WastePreviewRequest,
} from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, WASTE_WRITE_INVALIDATE_KEYS, createWasteRequest, previewWaste } from '@tubutree/app-core/api/waste';
import { getProvinces } from '@tubutree/app-core/api/geo';
import { returnPackagingQuery, wasteMeQuery, wastePointsQuery, wasteRulesVersionQuery } from '@tubutree/app-core/queries/waste';
import { rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import {
  ITEMS_NEXT_HINT,
  MAX_OPEN_VIEW_CTA,
  WASTE_CONSENT_TEXT,
  WASTE_PENDING_POINTS_SUBNOTE,
  WASTE_RULES_LINK,
  createBlockedHint,
  defaultPointId,
  homePickupCopy,
  maxOpenNotice,
  pendingPointsText,
  readLastPointId,
  wasteStepCopy,
  writeLastPointId,
} from '@tubutree/app-core/waste-copy';
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
import { errorCode } from '@tubutree/app-core/api/error-status';
import {
  homePickupCreateState,
  homePickupQuoteView,
  homePickupSubmitLabel,
  homePickupUnavailableText,
} from '@tubutree/app-core/recycle-home-pickup-view';
import { friendlyActionError as actErrText, friendlyError as errText } from '@/lib/friendly-error';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { settleWithin } from '@/lib/settle-within';
import { useDebounced } from '@/lib/use-debounced';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useHomePickupQuote } from '@/lib/use-home-pickup-quote';
import { usePublicConfig } from '@/lib/use-public-config';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearWizardStorage,
  markSubmitted,
  takeSubmitted,
  loadDraft,
  markResume,
  peekResume,
  takeResume,
  saveDraft,
  savePointsNav,
  takeReturn,
  toLineInputs,
  type WasteWizardDraft,
} from '@/lib/recycle-wizard';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { useRovingGroup } from '@/lib/use-roving-group';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { WasteItemStep } from './waste-item-step';
import { HomePickupComposer } from './recycle-home-pickup';
import { WebRecyclePhoneCard } from './web-recycle-phone-card';
import { trackRecycleStep } from '@/lib/recycle-funnel';
import { clearRepeatNotes, readRepeatNotes, type RepeatNotes } from '@/components/refill/repeat-notes';
import {
  METHOD_LABELS,
  METHOD_LINE,
  PREVIEW_DEBOUNCE_MS,
  blockMessage,
  feeExceedsPoints,
  feeRangeText,
  formatPoints,
  formatVnd,
  nextRewardProgress,
  pointAddress,
  UNCAPPED_QTY_MAX,
  type BlockContext,
} from './recycle-labels';

const browserStore = () => (typeof window === 'undefined' ? undefined : window.localStorage);
const PACKAGING_TEXT = 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn';
const POSTAGE_TEXT = 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận';
const PARCEL_COUNT_TEXT = 'Mỗi kiện là một yêu cầu riêng: có nhiều kiện thì tạo nhiều yêu cầu, mỗi kiện một mã TR-.';
const STEP1_CAP_BLOCKS: readonly string[] = ['ITEM_MONTH_CAP', 'POINTS_MONTH_CAP', 'ITEM_DAY_CAP'];
const WIZARD_PATH = '/doi-rac/tao';
const METHOD_STEP_PATH = `${WIZARD_PATH}?step=method`;

const isLocked = isMethodLocked;

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-stone-900">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-6 w-6 flex-none accent-forest-600" />
      <span>{label}</span>
    </label>
  );
}

/** Thanh hành động: dính đáy trên điện thoại, nằm cuối trang từ md; hai bản cùng nội dung nên bản máy tính gắn data-desktop-action. */
function Actions({ label, summary, children }: { label: string; summary?: ReactNode; children: ReactNode }) {
  const body = (
    <div className="flex items-center gap-3 max-md:flex-col max-md:items-stretch max-md:gap-2">
      {summary && <div className="min-w-0 flex-1">{summary}</div>}
      <div className={`${summary ? 'flex-none' : 'flex-1'} max-md:w-full`}>{children}</div>
    </div>
  );
  return (
    <>
      <div data-desktop-action className="hidden md:block">
        {body}
      </div>
      <StickyActionBar label={label}>{body}</StickyActionBar>
    </>
  );
}

const CONSENT_KEY = 'tubu.waste.consents';

export function RecycleNew() {
  const methodGroup = useRovingGroup({ activate: false });
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const authed = phase === 'authenticated';

  const step = params.get('step') === 'method' ? 'method' : 'items';

  const [draft, setDraft] = useState<WasteWizardDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  const submitted = useRef(false);
  // Khoá "Tạo yêu cầu" bằng ref: `isPending` chỉ đúng sau lần vẽ kế, và sau khi tạo xong trang còn nằm đó tới lúc chuyển hướng
  // xong (khoá Idempotency-Key đã xoay), nên chỉ nhả khi lỗi; thành công thì giữ tới khi trang bị thay.
  const createBusy = useRef(false);
  const toPicker = useRef(false);
  const resumeSeen = useRef<boolean | null>(null);
  // "Gửi lại như lần trước": phần lần trước đã bị bỏ, nói ở đúng bước (loại rác / cách gửi). Vào mới (không nối tiếp) thì bỏ lời báo cũ.
  const [repeatNotes, setRepeatNotes] = useState<RepeatNotes | null>(null);
  // Nháp đọc ở client sau khi gắn vào cây: lần render đầu của server và client phải giống nhau.
  useEffect(() => {
    const back = takeReturn();
    if (back) saveDraft(back);
    // Bước 2 chỉ đọc cờ (nạp lại trang vẫn giữ nháp); bước 1 đọc rồi xoá cờ, nên vào mới từ trang chủ thì không có cờ.
    // Ref giữ giá trị đã đọc qua lần chạy lại của StrictMode, vì cleanup bên dưới đã xoá cờ.
    const resume = resumeSeen.current ?? (step === 'method' ? peekResume() : takeResume());
    resumeSeen.current = resume;
    if (resume && step === 'method') markResume();
    if (resume) setRepeatNotes(readRepeatNotes());
    else clearRepeatNotes();
    const next = back ?? (resume ? loadDraft() : null);
    if (!next && step === 'items') clearDraft();
    // Hàm cập nhật giữ giá trị đã đọc khi effect chạy lần hai (StrictMode), vì cờ đã bị xoá ở lần đầu.
    // Thẻ "Giữ bao bì gửi kèm đơn sau" ở chi tiết đơn mở trang này với ?method=PICKUP: chọn sẵn đường kèm đơn thay vì điểm nhận gần nhất.
    const preferred = preferredWasteMethodFromSearch(params.toString());
    setDraft((prev) => (prev !== EMPTY_DRAFT ? prev : (next ?? (preferred ? { ...EMPTY_DRAFT, method: preferred } : EMPTY_DRAFT))));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Rời wizard (trừ sang trang chọn điểm) thì bỏ cờ: Next không remount khi đổi ?step, nên cờ không tự mất ở lần vào sau.
  useEffect(
    () => () => {
      if (!toPicker.current) takeResume();
    },
    [],
  );
  // Khách vãng lai về trang Đổi rác (có giới thiệu và nút đăng nhập) như Mini App, không đứng ở cổng dưới tiêu đề "Bước 1/2".
  useEffect(() => {
    if (phase === 'guest') {
      clearWizardStorage();
      router.replace('/doi-rac');
    }
  }, [phase, router]);
  useEffect(() => {
    if (step === 'items' && takeSubmitted()) router.replace('/doi-rac');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ready && !submitted.current) saveDraft(draft);
  }, [draft, ready]);

  const [consent, setConsent] = useState(false);
  const [ackVersion, setAckVersion] = useState<string | null>(null);
  const [packagingConsent, setPackagingConsent] = useState(false);
  const [postageConsent, setPostageConsent] = useState(false);
  // Khách mở Thể lệ rồi quay lại thì giữ các ô đồng ý (cách giao nằm trong nháp, đã lưu cùng lúc).
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(CONSENT_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(CONSENT_KEY);
      const c = JSON.parse(raw) as { consent?: boolean; packaging?: boolean; postage?: boolean; version?: string | null };
      setConsent(c.consent === true);
      setAckVersion(typeof c.version === 'string' ? c.version : null);
      setPackagingConsent(c.packaging === true);
      setPostageConsent(c.postage === true);
    } catch {
      // Không có sessionStorage thì chỉ mất các ô đồng ý, khách tích lại.
    }
  }, []);
  const openRules = () => {
    toPicker.current = true;
    saveDraft(draft);
    markResume();
    try {
      window.sessionStorage.setItem(CONSENT_KEY, JSON.stringify({ consent, packaging: packagingConsent, postage: postageConsent, version: ackVersion }));
    } catch {
      // như trên
    }
  };

  // Phiên bản thể lệ hiện hành: ô đồng ý chỉ còn hiệu lực khi khách tick đúng phiên bản này (admin đổi số thì phải tick lại).
  const rulesQ = useQuery({ ...wasteRulesVersionQuery(coreHttp), enabled: authed && step === 'method' });
  const rulesVersion = rulesQ.data;
  const consentValid = consent && consentStillValid(ackVersion, rulesVersion);
  const consentStale = consent && !consentValid && ackVersion !== null;
  const toggleConsent = () => {
    setConsent(!consentValid);
    setAckVersion(consentValid ? null : (rulesVersion ?? null));
  };

  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const me: WasteMeDTO | undefined = meQ.data;
  const leave = me !== undefined && (!me.programmeEnabled || me.blocked || me.eligibility === 'GUEST');
  useEffect(() => {
    if (leave) router.replace('/doi-rac');
  }, [leave, router]);
  const eligible = me?.eligibility === 'OK';
  const activeIds = useMemo(() => (me ? new Set(me.items.filter((i) => i.status === 'ACTIVE').map((i) => i.id)) : null), [me]);
  // Món bị ẩn hoặc sắp ra mắt sau khi nháp được lưu (nạp lại trang, quay từ trang chọn điểm) thì người dùng không thấy để bỏ, nên cắt khỏi nháp.
  useEffect(() => {
    if (!activeIds || !eligible) return;
    setDraft((d) => {
      const kept = Object.fromEntries(Object.entries(d.lines).filter(([id]) => activeIds.has(id)));
      return Object.keys(kept).length === Object.keys(d.lines).length ? d : { ...d, lines: kept };
    });
  }, [activeIds, eligible]);
  // Thẻ ở chi tiết đơn đã giao mở trang này với ?from=<mã đơn>: điền sẵn bao bì của đơn đó một lần, chỉ khi nháp chưa có món nào.
  const fromOrder = returnPackagingOrderFromSearch(params.toString());
  const packQ = useQuery({
    ...returnPackagingQuery(coreHttp, fromOrder ?? ''),
    enabled: authed && step === 'items' && fromOrder !== null && cfg.returnPackagingNudgeEnabled === true,
    staleTime: 60_000,
  });
  const packSeeded = useRef(false);
  useEffect(() => {
    const suggestion = packQ.data?.suggestion;
    if (packSeeded.current || !ready || !me || !eligible || !suggestion) return;
    packSeeded.current = true;
    const lines = packagingWizardLines(suggestion, me.items.filter((i) => i.status === 'ACTIVE'), UNCAPPED_QTY_MAX);
    if (Object.keys(lines).length > 0) setDraft((d) => (Object.keys(d.lines).length > 0 ? d : { ...d, lines }));
  }, [ready, me, eligible, packQ.data]);
  const lineInputs = toLineInputs(draft.lines).filter((l) => !activeIds || activeIds.has(l.itemId));
  const missingDraft = ready && eligible && step === 'method' && lineInputs.length === 0;
  useEffect(() => {
    if (missingDraft) router.replace(WIZARD_PATH);
  }, [missingDraft, router]);

  // Ước tính bước 1. Chuỗi JSON mới là thứ được debounce: toLineInputs trả mảng mới ở mỗi lần render.
  const linesKey = useDebounced(JSON.stringify(lineInputs), PREVIEW_DEBOUNCE_MS);
  const debounced = useMemo(() => (JSON.parse(linesKey) as WasteLineInput[]).filter((l) => !activeIds || activeIds.has(l.itemId)), [linesKey, activeIds]);
  const itemsPreviewQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'preview', debounced],
    queryFn: () => previewWaste(coreHttp, { lines: debounced }),
    enabled: step === 'items' && debounced.length > 0 && authed && eligible,
  });
  const rewardsQ = useQuery({ ...rewardsQuery(coreHttp), enabled: step === 'items' && authed && eligible });

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
        queryFn: () => previewWaste(coreHttp, body),
        enabled: step === 'method' && body.lines.length > 0,
      };
    }),
  });
  const previewFailed = previewMethods.filter((_, i) => previewQueries[i]?.isError);
  const previews: Partial<Record<WasteMethod, WastePreviewDTO | undefined>> = {};
  // useQueries tạo observer mới mỗi khi khoá đổi nên data về undefined; giữ kết quả cuối riêng cho thứ tự thẻ để thẻ không nhảy chỗ.
  const lastPreview = useRef<Partial<Record<WasteMethod, WastePreviewDTO>>>({});
  const orderPreviews: Partial<Record<WasteMethod, WastePreviewDTO | undefined>> = {};
  previewMethods.forEach((m, i) => {
    const data = previewQueries[i]?.data;
    if (data) lastPreview.current[m] = data;
    previews[m] = data;
    orderPreviews[m] = data ?? lastPreview.current[m];
  });

  const pointsQ = useQuery({ ...wastePointsQuery(coreHttp, null), enabled: step === 'method' && authed && eligible });
  const wantProvinces = step === 'method' && eligible && enabledMethods.includes('MAIL_IN');
  const provincesQ = useQuery({ queryKey: ['geo', 'provinces'], queryFn: () => getProvinces(coreHttp), enabled: wantProvinces });

  // Chọn sẵn "Mang tới điểm nhận" với điểm lần trước để khách đỡ phải chạm nhiều lần; không có gợi ý thì để khách tự chọn.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!ready || prefilled.current || step !== 'method' || draft.method !== null || !pointsQ.data || !enabledMethods.includes('DROP_OFF')) return;
    prefilled.current = true;
    const id = defaultPointId(pointsQ.data, lineInputs.map((l) => l.itemId), readLastPointId(browserStore()));
    const point = id ? pointsQ.data.find((pt) => pt.id === id) : undefined;
    if (point) setDraft((d) => ({ ...d, method: 'DROP_OFF', pointId: point.id, pickedPoint: point }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, step, draft.method, pointsQ.data, enabledMethods]);

  const selected = draft.method && enabledMethods.includes(draft.method) ? draft.method : null;
  const homePickupForm = draft.homePickup ?? EMPTY_HOME_PICKUP_FORM;
  const hp = useHomePickupQuote({
    enabled: selected === 'HOME_PICKUP' && step === 'method' && authed,
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
  const create = useMutation({
    mutationFn: () => {
      if (!body) throw new Error('Chưa chọn cách giao');
      return createWasteRequest(coreHttp, body, key);
    },
    onSuccess: async (r) => {
      rotate();
      if (r.method === 'DROP_OFF' && draft.pointId) writeLastPointId(browserStore(), draft.pointId);
      submitted.current = true;
      trackRecycleStep('submitted', r.method);
      clearWizardStorage();
      markSubmitted();
      await settleWithin(Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey }))));
      router.replace(`/doi-rac/yeu-cau/${r.id}`);
    },
    onError: (e) => {
      createBusy.current = false;
      const code = errorCode(e);
      if (code === 'WASTE_MAX_OPEN') {
        setMaxOpenHit(me?.thresholds.maxOpenRequests ?? 2);
      }
      if (code === 'WASTE_FEE_BANK_DISABLED' || (selected === 'HOME_PICKUP' && hp.effective.payment === 'WALLET' && code !== 'WASTE_FEE_CHANGED')) {
        setHomePickup({ payment: null });
      }
      void qc.invalidateQueries({ queryKey: wasteRulesVersionQuery(coreHttp).queryKey });
      void qc.invalidateQueries({ queryKey: [...WASTE_QUERY_KEYS.all, 'pickup-quote'] });
      void qc.invalidateQueries({ queryKey: WASTE_QUERY_KEYS.me });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const creating = create.isPending || create.isSuccess;
  const createNow = () => {
    if (createBusy.current) return;
    createBusy.current = true;
    create.mutate();
  };

  const subtitle = step === 'items' ? wasteStepCopy.items : wasteStepCopy.method;
  // Lời báo cách gửi/điểm nhận cũ đã đóng chỉ hiện tới khi khách chọn lại xong.
  const methodOpen = draft.method === null || (draft.method === 'DROP_OFF' && !draft.pointId);
  const repeatNote = step === 'items' ? repeatNotes?.items : methodOpen ? repeatNotes?.method : null;
  const shell = (content: ReactNode, bar?: ReactNode) => (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12 tabular-nums">
      <PageHeader title="Đổi rác" subtitle={subtitle} backHref={step === 'method' ? WIZARD_PATH : '/doi-rac'} backLabel={step === 'method' ? 'Chọn món' : 'Đổi rác lấy quà'} />
      {repeatNote && (
        <p data-testid="waste-repeat-note" className="text-sm text-warning-fg">
          {repeatNote}
        </p>
      )}
      {content}
      {bar}
    </main>
  );
  const skeleton = (
    <>
      <Skeleton height={80} rounded="rounded-card" />
      <Skeleton height={80} rounded="rounded-card" />
      <Skeleton height={80} rounded="rounded-card" />
    </>
  );

  if (phase === 'loading') return shell(<AuthLoading />);
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') return shell(skeleton);
  if (meQ.isError) return shell(<ErrorState message={errText(meQ.error)} onRetry={() => meQ.refetch()} />);
  if (!me || leave || !ready || missingDraft) return shell(skeleton);
  if (me.eligibility !== 'OK') return shell(<WebRecyclePhoneCard />);

  // W179-B: chặn sớm khi đã đủ trần yêu cầu mở (hoặc đua thiết bị nhận WASTE_MAX_OPEN) — đúng 1 thông báo và 1 nút dẫn tới danh sách.
  const maxOpenReached = me.openRequests.length >= me.thresholds.maxOpenRequests || maxOpenHit !== null;
  if (maxOpenReached) {
    const maxLimit = maxOpenHit ?? me.thresholds.maxOpenRequests;
    return shell(
      <>
        <div className={`${skin.card} p-4`}>
          <p data-testid="waste-max-open-notice" className="text-sm font-semibold text-stone-900">
            {maxOpenNotice(maxLimit)}
          </p>
        </div>
        <Actions label="Xem yêu cầu đang mở">
          <Link href="/doi-rac/yeu-cau" className={`${ui.btnPrimary} w-full`}>
            {MAX_OPEN_VIEW_CTA}
          </Link>
        </Actions>
      </>,
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
      saveDraft(draft);
      markResume();
      router.push(METHOD_STEP_PATH);
    };
    const p = debounced.length > 0 ? itemsPreviewQ.data : undefined;
    const capBlock = p?.blocks.find((b) => STEP1_CAP_BLOCKS.includes(b.code));
    // Ước tính xong gần nhất có thể thuộc số lượng cũ: chờ debounce và lời gọi mới rồi mới mở nút.
    const previewStale = linesKey !== JSON.stringify(lineInputs) || itemsPreviewQ.isFetching;
    const reward = p && !capBlock ? nextRewardProgress(rewardsQ.data, p.estimatedPoints) : null;
    const noLines = lineInputs.length === 0;
    const summary = noLines ? (
      <p className="text-sm text-stone-600">{ITEMS_NEXT_HINT}</p>
    ) : p ? (
      capBlock ? (
        <p className="text-sm font-semibold text-danger-fg">
          {blockMessage(capBlock, { items: me.items, maxOpenRequests: me.thresholds.maxOpenRequests, itemCaps: p.itemCaps })}
        </p>
      ) : (
        <div className="tabular-nums">
          <p className="text-sm font-semibold text-stone-900">{pendingPointsText(formatPoints(p.estimatedPoints))}</p>
          <p className="text-xs text-stone-600">{WASTE_PENDING_POINTS_SUBNOTE}</p>
          <p className="text-xs text-stone-600">{`Dùng như ${formatVnd(p.pointsValueVnd)} khi mua sắm`}</p>
          {reward && <p className="text-xs text-stone-600">{`Còn ${formatPoints(reward.missing)} tới ${reward.rewardName}`}</p>}
        </div>
      )
    ) : undefined;
    return shell(
      <>
        <WasteItemStep items={me.items} lines={draft.lines} onChange={onChange} />
        <Actions label="Tiếp tục đổi rác" summary={summary}>
          <button type="button" className={`${ui.btnPrimary} w-full`} disabled={lineInputs.length === 0 || !!capBlock || previewStale} onClick={next}>
            Tiếp tục
          </button>
        </Actions>
      </>,
    );
  }

  const mailPreview = previews.MAIL_IN;
  const province = mailPreview?.feeEstimate?.provinceCode ?? draft.provinceCode;
  const noPointInProvince = province != null && pointsQ.data !== undefined && !pointsQ.data.some((pt) => sameProvince(pt.provinceCode, province));
  const order = orderWasteMethods(enabledMethods, orderPreviews, noPointInProvince, previewFailed);
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
    saveDraft(draft);
    markResume();
    toPicker.current = true;
    savePointsNav({ returnTo: METHOD_STEP_PATH, draft, selectedItemIds: lineInputs.map((l) => l.itemId) });
    router.replace('/doi-rac/diem-nhan');
  };

  const selectedPreview = selected ? previews[selected] : undefined;
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
  const unlockedOthers = (m: WasteMethod) => order.filter((o) => o !== m && !isLocked(previews[o]));

  const renderCard = (m: WasteMethod) => {
    const pv = previews[m];
    const locked = isLocked(pv);
    const checked = selected === m;
    const fee = m === 'MAIL_IN' ? pv?.feeEstimate : null;
    // Tỉnh chưa có điểm nhận thì API trả chính mã tỉnh làm tên; khi danh sách tỉnh chưa về thì bỏ cụm tên tỉnh, không in mã số.
    const feeProvince = fee ? (provincesQ.data?.find((pr) => pr.code === fee.provinceCode)?.name ?? (fee.provinceName === fee.provinceCode ? null : fee.provinceName)) : null;
    const showProvince = m === 'MAIL_IN' && checked && provincesQ.data && (draft.provinceCode !== null || pv?.blocks.some((b) => b.code === 'NEED_PROVINCE'));
    return (
      <div key={m} className={`${ui.card} p-4 ${checked ? 'border-2 border-forest-600' : ''} ${m === 'HOME_PICKUP' ? 'md:col-span-3' : ''}`}>
        <button
          type="button"
          role="radio"
          data-method={m}
          aria-checked={checked}
          aria-disabled={locked}
          onClick={() => {
            if (!locked) selectMethod(m);
          }}
          className={`flex min-h-11 w-full flex-col gap-1 text-left ${locked ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <span className={`flex flex-col gap-1 ${locked ? 'opacity-60' : ''}`}>
          <span className="text-sm font-semibold text-stone-900">{METHOD_LABELS[m]}</span>
          <span className="text-xs text-stone-600">{METHOD_LINE[m]}</span>
          {pv && <span className="text-sm font-semibold tabular-nums text-stone-900">{pendingPointsText(formatPoints(pv.estimatedPoints))}</span>}
          {fee && (
            <span className="text-xs text-stone-600">{`Phí ship ước tính${feeProvince ? ` từ ${feeProvince}` : ''}: ${feeRangeText(fee)}, ước tính theo bảng giá niêm yết`}</span>
          )}
          {m === 'MAIL_IN' && <span className="text-xs text-stone-600">{`Gói tối thiểu ${formatPoints(me.thresholds.mailinMinPoints)}`}</span>}
          {m === 'PICKUP' && <span className="text-xs text-stone-600">{`Tối thiểu ${formatPoints(me.thresholds.pickupMinPoints)} ước tính`}</span>}
          </span>
          {pv?.blocks
            .filter((b) => b.code !== 'NEED_PROVINCE' || checked)
            .map((b) => (
              <span key={`${b.code}-${b.itemId ?? ''}`} className={`text-xs ${b.code === 'NEED_PROVINCE' ? 'text-stone-600' : 'text-warning-fg'}`}>
                {blockMessage(b, ctxFor(pv, m))}
              </span>
            ))}
        </button>
        <div className="mt-2 flex flex-col gap-2">
          {showProvince && (
            <select
              aria-label="Chọn tỉnh để ước tính phí ship"
              value={draft.provinceCode ?? ''}
              onChange={(e) => {
                const code = e.target.value || null;
                setDraft((d) => ({ ...d, provinceCode: code }));
              }}
              className={ui.field}
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
            <p className="text-xs text-stone-600">{`Mỗi kiện tối đa ${me.parcelLimits.maxWeightKg} kg, cạnh dài tối đa ${me.parcelLimits.maxEdgeCm} cm. Hàng gửi về kho không hoàn lại. Kiện còn cước phải trả khi nhận bị kho từ chối ngay ở cửa.`}</p>
          )}
          {m === 'PICKUP' && (
            <p className="text-xs text-stone-600">{`Mỗi kiện tối đa ${me.parcelLimits.maxWeightKg} kg, cạnh dài tối đa ${me.parcelLimits.maxEdgeCm} cm.`}</p>
          )}
          {m === 'MAIL_IN' && pv && feeExceedsPoints(pv) && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-warning-fg">Phí ship có thể cao hơn giá trị điểm bạn nhận được</p>
              {unlockedOthers(m).map((o) => (
                <button key={o} type="button" className={skin.btnSecondary} onClick={() => selectMethod(o)}>
                  {`Chọn ${METHOD_LABELS[o]}`}
                </button>
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
                router.push(`/doi-rac/yeu-cau/${reqId}`);
              }}
              onSwitchDropOff={
                enabledMethods.includes('DROP_OFF') && !isLocked(previews.DROP_OFF)
                  ? () => {
                      trackRecycleStep('fee_path_dropoff', 'DROP_OFF');
                      selectMethod('DROP_OFF');
                    }
                  : undefined
              }
              disabled={creating}
            />
          )}
          {m === 'DROP_OFF' && checked && (
            <div className="flex flex-col gap-2">
              {draft.pickedPoint && (
                <div>
                  <p className="text-sm font-semibold text-stone-900">{draft.pickedPoint.name}</p>
                  <p className="text-xs text-stone-600">{pointAddress(draft.pickedPoint)}</p>
                </div>
              )}
              <button type="button" className={`${skin.btnSecondary} self-start`} onClick={pickPoint}>
                {draft.pickedPoint ? 'Đổi điểm nhận' : 'Chọn điểm nhận'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return shell(
    <>
      {showShipLocked && (
        <div className={`${skin.card} p-4`}>
          <p className="text-sm font-semibold text-stone-900">{blockMessage({ code: 'SHIP_LOCKED' }, ctxFor(undefined))}</p>
        </div>
      )}
      {order.length === 0 ? (
        <div className={`${skin.card} p-4`}>
          <p className="text-sm font-semibold text-stone-900">Hiện chưa có cách giao nào đang mở, bạn quay lại sau nhé.</p>
        </div>
      ) : (
        <div ref={methodGroup.ref} onKeyDown={methodGroup.onKeyDown} role="radiogroup" aria-label="Cách giao" className="grid gap-3 md:grid-cols-3">
          {order.map(renderCard)}
        </div>
      )}
      {selected && (
        <div className="flex flex-col">
          <Check checked={consentValid} onChange={toggleConsent} label={WASTE_CONSENT_TEXT} />
          {consentStale && <p role="status" className="text-xs font-semibold text-warning-fg">{WASTE_RULES_UPDATED_NOTE}</p>}
          <Link href="/doi-rac/quy-dinh" onClick={openRules} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-forest-700 underline">
            {WASTE_RULES_LINK}
          </Link>
          {selected === 'MAIL_IN' && (
            <>
              <Check checked={packagingConsent} onChange={() => setPackagingConsent((v) => !v)} label={PACKAGING_TEXT} />
              <Check checked={postageConsent} onChange={() => setPostageConsent((v) => !v)} label={POSTAGE_TEXT} />
              <p className="text-xs text-stone-600">{PARCEL_COUNT_TEXT}</p>
            </>
          )}
        </div>
      )}
      {create.isError && (
        <p role="alert" className={ui.error}>
          {homePickupUnavailableText(create.error) ?? actErrText(create.error)}
        </p>
      )}
      <Actions label="Tạo yêu cầu đổi rác" summary={blockedHint ? <p className="text-sm text-stone-600">{blockedHint}</p> : undefined}>
        <button
          type="button"
          className={`${ui.btnPrimary} w-full`}
          disabled={!canCreate}
          aria-busy={creating || undefined}
          aria-disabled={creating || undefined}
          onClick={createNow}
        >
          {creating ? homePickupCopy.creating : selected === 'HOME_PICKUP' ? homePickupSubmitLabel(hpView, hp.effective.payment) : 'Tạo yêu cầu'}
        </button>
      </Actions>
    </>,
  );
}
