'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { WasteMethod, WastePointDTO } from '@tubutree/shared-types';
import { wasteMeQuery, wastePointsQuery } from '@tubutree/app-core/queries/waste';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { loadPointsNav, saveReturn, type WastePointsNav } from '@/lib/recycle-wizard';
import { usePublicConfig } from '@/lib/use-public-config';
import { includesFolded } from '@/lib/vn-fold';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { LOGIN_TEXT, METHOD_LABELS } from './recycle-labels';
import { WastePointPicker } from './waste-point-picker';

const WIZARD_METHOD_STEP = '/doi-rac/tao?step=method';
const SWITCH_METHODS: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP'];

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/** Khớp không phân biệt hoa thường và dấu trên tên điểm, phường/xã và tên đường. */
export function filterPointsByText(points: readonly WastePointDTO[], q: string): WastePointDTO[] {
  if (!q.trim()) return [...points];
  return points.filter((p) => [p.name, p.communeName, p.addressLine].some((field) => includesFolded(field, q)));
}

export function RecyclePoints() {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const authed = phase === 'authenticated';

  const [nav, setNav] = useState<WastePointsNav | null>(null);
  const [ready, setReady] = useState(false);
  // Nav đọc ở client sau khi gắn vào cây: lần render đầu của server và client phải giống nhau.
  useEffect(() => {
    setNav(loadPointsNav());
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && !nav && phase !== 'loading' && phase !== 'guest') router.replace('/doi-rac/tao');
  }, [ready, nav, phase, router]);

  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const pointsQ = useQuery({ ...wastePointsQuery(coreHttp, null), enabled: authed });
  const me = meQ.data;
  const points = pointsQ.data;
  const leave = me !== undefined && (!me.programmeEnabled || me.blocked);
  useEffect(() => {
    if (leave) router.replace('/doi-rac');
  }, [leave, router]);

  const [tabSel, setTab] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const provinces = useMemo(() => {
    const out: { code: string; name: string }[] = [];
    for (const p of points ?? []) if (!out.some((x) => x.code === p.provinceCode)) out.push({ code: p.provinceCode, name: p.provinceName });
    return out;
  }, [points]);
  const tab = tabSel ?? provinces[0]?.code ?? '';

  const shell = (content: ReactNode, bar?: ReactNode) => (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Điểm nhận gần bạn" backHref={nav?.returnTo ?? '/doi-rac/tao'} backLabel="Quay lại" />
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
  if (phase === 'guest') return shell(<LoginRequired message={LOGIN_TEXT} returnTo="/doi-rac/tao" />);
  if (!ready || !nav) return shell(skeleton);
  const loadError = (meQ.isError && meQ.error) || (pointsQ.isError && pointsQ.error);
  if (loadError) {
    return shell(
      <ErrorState
        message={errText(loadError)}
        onRetry={() => {
          void meQ.refetch();
          void pointsQ.refetch();
        }}
      />,
    );
  }
  if (!me || !points || leave) return shell(skeleton);
  // Chưa có SĐT đã xác minh thì web không xin được (chỉ Zalo xin được): chỉ chỉ đường sang Mini App, không có đường lách (Q2).
  if (me.eligibility !== 'OK') return shell(<MiniAppOnlyNotice path="/doi-rac/tao" />);

  const tabItems = provinces.map((x) => ({ key: x.code, label: x.name }));
  const list = filterPointsByText(points.filter((p) => p.provinceCode === tab), q);
  const pickedPoint = list.find((p) => p.id === picked) ?? null;
  const canChoose =
    pickedPoint !== null && !pickedPoint.quotaFull && nav.selectedItemIds.every((id) => pickedPoint.acceptedItemIds.includes(id));

  const choose = () => {
    if (!pickedPoint || !canChoose) return;
    saveReturn({ ...nav.draft, method: 'DROP_OFF', pointId: pickedPoint.id, pickedPoint });
    router.replace(nav.returnTo);
  };

  const canSwitchMethod = nav.returnTo === WIZARD_METHOD_STEP && !me.shipLockedAt;
  const switchMethods = canSwitchMethod
    ? SWITCH_METHODS.filter((m) => (m === 'MAIL_IN' ? cfg.waste.mailin && me.laneFlags.mailin : cfg.waste.pickup && me.laneFlags.pickup))
    : [];
  const switchMethod = (m: WasteMethod) => {
    saveReturn({ ...nav.draft, method: m });
    router.replace(nav.returnTo);
  };

  const chooseButton = (
    <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!canChoose} onClick={choose}>
      Chọn điểm này
    </button>
  );

  return shell(
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
        <input
          type="search"
          aria-label="Tìm điểm nhận"
          placeholder="Tên điểm, phường/xã hoặc tên đường"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${ui.field} pl-9`}
        />
      </div>
      <p className="text-xs text-stone-600">Web không dùng vị trí của bạn: chọn tỉnh để xem các điểm nhận. Muốn xem điểm gần bạn, mở Tubu Tree trên Zalo.</p>
      {tabItems.length > 0 && <SegmentedTabs scroll value={tab} onChange={setTab} items={tabItems} label="Tỉnh" />}
      {list.length > 0 ? (
        <WastePointPicker
          points={list}
          value={picked}
          onChange={setPicked}
          items={me.items.filter((i) => i.status === 'ACTIVE')}
          selectedItemIds={nav.selectedItemIds}
        />
      ) : (
        <p className={`${ui.card} p-6 text-center text-sm text-stone-700`}>Không tìm thấy điểm nhận nào</p>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-stone-900">Chưa có điểm gần bạn?</h2>
        <p className="text-sm text-stone-700">Gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm.</p>
        <div className="flex flex-wrap gap-2">
          {switchMethods.map((m) => (
            <button key={m} type="button" className={ui.btnSecondary} onClick={() => switchMethod(m)}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </section>
      <div data-desktop-action className="hidden md:block">
        {chooseButton}
      </div>
      <StickyActionBar label="Chọn điểm nhận">{chooseButton}</StickyActionBar>
    </>,
  );
}
