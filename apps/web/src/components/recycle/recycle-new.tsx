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
import { wasteMeQuery, wastePointsQuery } from '@tubutree/app-core/queries/waste';
import { rewardsQuery } from '@tubutree/app-core/queries/loyalty';
import {
  ITEMS_NEXT_HINT,
  WASTE_CONSENT_TEXT,
  WASTE_RULES_LINK,
  createBlockedHint,
  defaultPointId,
  readLastPointId,
  wasteStepCopy,
  writeLastPointId,
} from '@tubutree/app-core/waste-copy';
import { friendlyError as errText } from '@/lib/friendly-error';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { useDebounced } from '@/lib/use-debounced';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { usePublicConfig } from '@/lib/use-public-config';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearWizardStorage,
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
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { WasteItemStep } from './waste-item-step';
import {
  LOGIN_TEXT,
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
  type BlockContext,
} from './recycle-labels';

const BASE_ORDER: readonly WasteMethod[] = ['DROP_OFF', 'PICKUP', 'MAIL_IN'];
const MAIL_FIRST_ORDER: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP', 'DROP_OFF'];
const browserStore = () => (typeof window === 'undefined' ? undefined : window.localStorage);
const PACKAGING_TEXT = 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn';
const POSTAGE_TEXT = 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận';
const PARCEL_COUNT_TEXT = 'Mỗi kiện là một yêu cầu riêng: có nhiều kiện thì tạo nhiều yêu cầu, mỗi kiện một mã TR-.';
const STEP1_CAP_BLOCKS: readonly string[] = ['ITEM_MONTH_CAP', 'POINTS_MONTH_CAP', 'ITEM_DAY_CAP'];
const WIZARD_PATH = '/doi-rac/tao';
const METHOD_STEP_PATH = `${WIZARD_PATH}?step=method`;

function isLocked(preview: WastePreviewDTO | undefined): boolean {
  return preview?.blocks.some((b) => b.code !== 'NEED_PROVINCE') ?? false;
}

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
  const toPicker = useRef(false);
  const resumeSeen = useRef<boolean | null>(null);
  // Nháp đọc ở client sau khi gắn vào cây: lần render đầu của server và client phải giống nhau.
  useEffect(() => {
    const back = takeReturn();
    if (back) saveDraft(back);
    // Bước 2 chỉ đọc cờ (nạp lại trang vẫn giữ nháp); bước 1 đọc rồi xoá cờ, nên vào mới từ trang chủ thì không có cờ.
    // Ref giữ giá trị đã đọc qua lần chạy lại của StrictMode, vì cleanup bên dưới đã xoá cờ.
    const resume = resumeSeen.current ?? (step === 'method' ? peekResume() : takeResume());
    resumeSeen.current = resume;
    if (resume && step === 'method') markResume();
    const next = back ?? (resume ? loadDraft() : null);
    if (!next && step === 'items') clearDraft();
    // Hàm cập nhật giữ giá trị đã đọc khi effect chạy lần hai (StrictMode), vì cờ đã bị xoá ở lần đầu.
    setDraft((prev) => (prev !== EMPTY_DRAFT ? prev : (next ?? EMPTY_DRAFT)));
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
  useEffect(() => {
    if (phase === 'guest') clearWizardStorage();
  }, [phase]);
  useEffect(() => {
    if (ready && !submitted.current) saveDraft(draft);
  }, [draft, ready]);

  const [consent, setConsent] = useState(false);
  const [packagingConsent, setPackagingConsent] = useState(false);
  const [postageConsent, setPostageConsent] = useState(false);
  // Khách mở Thể lệ rồi quay lại thì giữ các ô đồng ý (cách giao nằm trong nháp, đã lưu cùng lúc).
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(CONSENT_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(CONSENT_KEY);
      const c = JSON.parse(raw) as { consent?: boolean; packaging?: boolean; postage?: boolean };
      setConsent(c.consent === true);
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
      window.sessionStorage.setItem(CONSENT_KEY, JSON.stringify({ consent, packaging: packagingConsent, postage: postageConsent }));
    } catch {
      // như trên
    }
  };

  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const me: WasteMeDTO | undefined = meQ.data;
  const leave = me !== undefined && (!me.programmeEnabled || me.blocked);
  useEffect(() => {
    if (leave) router.replace('/doi-rac');
  }, [leave, router]);
  const activeIds = useMemo(() => (me ? new Set(me.items.filter((i) => i.status === 'ACTIVE').map((i) => i.id)) : null), [me]);
  // Món bị ẩn hoặc sắp ra mắt sau khi nháp được lưu (nạp lại trang, quay từ trang chọn điểm) thì người dùng không thấy để bỏ, nên cắt khỏi nháp.
  useEffect(() => {
    if (!activeIds) return;
    setDraft((d) => {
      const kept = Object.fromEntries(Object.entries(d.lines).filter(([id]) => activeIds.has(id)));
      return Object.keys(kept).length === Object.keys(d.lines).length ? d : { ...d, lines: kept };
    });
  }, [activeIds]);
  const lineInputs = toLineInputs(draft.lines).filter((l) => !activeIds || activeIds.has(l.itemId));
  const missingDraft = ready && step === 'method' && lineInputs.length === 0;
  useEffect(() => {
    if (missingDraft) router.replace(WIZARD_PATH);
  }, [missingDraft, router]);

  // Ước tính bước 1. Chuỗi JSON mới là thứ được debounce: toLineInputs trả mảng mới ở mỗi lần render.
  const linesKey = useDebounced(JSON.stringify(lineInputs), PREVIEW_DEBOUNCE_MS);
  const debounced = useMemo(() => (JSON.parse(linesKey) as WasteLineInput[]).filter((l) => !activeIds || activeIds.has(l.itemId)), [linesKey, activeIds]);
  const itemsPreviewQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'preview', debounced],
    queryFn: () => previewWaste(coreHttp, { lines: debounced }),
    enabled: step === 'items' && debounced.length > 0 && authed && !!me,
  });
  const rewardsQ = useQuery({ ...rewardsQuery(coreHttp), enabled: step === 'items' && authed });

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
        queryFn: () => previewWaste(coreHttp, body),
        enabled: step === 'method' && body.lines.length > 0,
      };
    }),
  });
  const previews: Partial<Record<WasteMethod, WastePreviewDTO | undefined>> = {};
  enabledMethods.forEach((m, i) => {
    previews[m] = previewQueries[i]?.data;
  });

  const pointsQ = useQuery({ ...wastePointsQuery(coreHttp, null), enabled: step === 'method' && authed });
  const wantProvinces = step === 'method' && enabledMethods.includes('MAIL_IN');
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
      return createWasteRequest(coreHttp, body, key);
    },
    onSuccess: async (r) => {
      rotate();
      if (r.method === 'DROP_OFF' && draft.pointId) writeLastPointId(browserStore(), draft.pointId);
      submitted.current = true;
      clearWizardStorage();
      await Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
      router.replace(`/doi-rac/yeu-cau/${r.id}`);
    },
  });

  const subtitle = step === 'items' ? wasteStepCopy.items : wasteStepCopy.method;
  const shell = (content: ReactNode, bar?: ReactNode) => (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Đổi rác" subtitle={subtitle} backHref={step === 'method' ? WIZARD_PATH : '/doi-rac'} backLabel={step === 'method' ? 'Chọn món' : 'Đổi rác lấy quà'} />
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
  if (phase === 'guest') return shell(<LoginRequired message={LOGIN_TEXT} returnTo={WIZARD_PATH} />);
  if (meQ.isError) return shell(<ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} />);
  if (!me || leave || !ready || missingDraft) return shell(skeleton);
  // Chưa có SĐT đã xác minh thì web không xin được (chỉ Zalo xin được): chỉ chỉ đường sang Mini App, không có đường lách (Q2).
  if (me.eligibility !== 'OK') return shell(<MiniAppOnlyNotice path={WIZARD_PATH} />);

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
        <div>
          <p className="text-sm font-semibold text-stone-900">{`Ước tính ${formatPoints(p.estimatedPoints)}`}</p>
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
  const noPointInProvince = province != null && pointsQ.data !== undefined && !pointsQ.data.some((pt) => pt.provinceCode === province);
  const order = (noPointInProvince ? MAIL_FIRST_ORDER : BASE_ORDER).filter((m) => enabledMethods.includes(m));
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
    saveDraft(draft);
    markResume();
    toPicker.current = true;
    savePointsNav({ returnTo: METHOD_STEP_PATH, draft, selectedItemIds: lineInputs.map((l) => l.itemId) });
    router.replace('/doi-rac/diem-nhan');
  };

  const selectedPreview = selected ? previews[selected] : undefined;
  const consentsOk = consent && (selected !== 'MAIL_IN' || (packagingConsent && postageConsent));
  const canCreate =
    selected !== null && !isLocked(selectedPreview) && consentsOk && (selected !== 'DROP_OFF' || draft.pointId !== null) && !create.isPending;
  const blockedHint = canCreate
    ? null
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
      <div key={m} className={`${ui.card} p-4 ${checked ? 'border-2 border-forest-600' : ''}`}>
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
          {pv && <span className="text-sm font-semibold text-stone-900">{`Ước tính ${formatPoints(pv.estimatedPoints)}`}</span>}
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
        <div role="radiogroup" aria-label="Cách giao" className="grid gap-3 md:grid-cols-3">
          {order.map(renderCard)}
        </div>
      )}
      {selected && (
        <div className="flex flex-col">
          <Check checked={consent} onChange={() => setConsent((v) => !v)} label={WASTE_CONSENT_TEXT} />
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
          {errText(create.error)}
        </p>
      )}
      <Actions label="Tạo yêu cầu đổi rác" summary={blockedHint ? <p className="text-sm text-stone-600">{blockedHint}</p> : undefined}>
        <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!canCreate} onClick={() => create.mutate()}>
          {create.isPending ? 'Đang tạo…' : 'Tạo yêu cầu'}
        </button>
      </Actions>
    </>,
  );
}
